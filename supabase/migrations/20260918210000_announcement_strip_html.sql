-- Announcement notifications were built from the raw rich-text content, so the
-- body leaked HTML tags (e.g. "<p>..."). Strip tags in the generator, and clean
-- the tags out of any announcement notifications already created.

CREATE OR REPLACE FUNCTION process_notification_outbox(p_limit int DEFAULT 300)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ev record; s jsonb;
  v_category text; v_right text; v_entity text; v_actor uuid; v_who text; v_title text; v_body text;
  v_cands uuid[]; cand uuid; created int := 0; ins int;
BEGIN
  FOR ev IN
    SELECT * FROM notification_outbox WHERE status='pending' ORDER BY occurred_at LIMIT p_limit FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      s := ev.record_snapshot; v_actor := NULL; v_cands := ARRAY[]::uuid[];
      IF ev.event_type IN ('order_created','customer_created','lead_created','deal_created','expense_created','payment_created','task_completed') THEN
        v_category := 'team_activity'; v_right := 'receive_team_activity_notifications';
        v_actor := notif_resolve_profile(ev.account_id, CASE ev.event_type WHEN 'expense_created' THEN s->>'employee_id' WHEN 'order_created' THEN NULL ELSE s->>'user_id' END);
        SELECT array_agg(id) INTO v_cands FROM (
          SELECT p.id FROM profiles p WHERE p.account_id=ev.account_id AND p.account_role IN ('owner','admin') AND p.status<>'inactive'
          UNION SELECT p.manager_id FROM profiles p WHERE p.id=v_actor AND p.manager_id IS NOT NULL) q;
      ELSIF ev.event_type='task_assigned' THEN
        v_category := 'task'; v_right := 'receive_task_notifications';
        v_actor := notif_resolve_profile(ev.account_id, s->>'user_id');
        v_cands := ARRAY[ notif_resolve_profile(ev.account_id, s->>'assigned_user_id') ];
      ELSIF ev.event_type IN ('lead_assigned','deal_assigned') THEN
        v_category := 'assignment'; v_right := 'receive_assignment_notifications';
        v_actor := notif_resolve_profile(ev.account_id, s->>'user_id');
        v_cands := ARRAY[ notif_resolve_profile(ev.account_id, CASE ev.event_type WHEN 'lead_assigned' THEN s->>'owner_id' ELSE s->>'assigned_to' END) ];
      ELSIF ev.event_type='announcement_published' THEN
        v_category := 'announcement'; v_right := 'receive_announcement_notifications';
        v_actor := notif_resolve_profile(ev.account_id, s->>'created_by');
        IF COALESCE(jsonb_array_length(s->'employee_ids'),0)=0 AND COALESCE(jsonb_array_length(s->'employee_role_ids'),0)=0 THEN
          SELECT array_agg(id) INTO v_cands FROM profiles WHERE account_id=ev.account_id AND status<>'inactive';
        ELSE
          SELECT array_agg(pid) INTO v_cands FROM (
            SELECT notif_resolve_profile(ev.account_id, e) AS pid FROM jsonb_array_elements_text(COALESCE(s->'employee_ids','[]'::jsonb)) e
            UNION SELECT p.id FROM profiles p WHERE p.account_id=ev.account_id AND p.status<>'inactive'
              AND p.employee_role_id::text IN (SELECT jsonb_array_elements_text(COALESCE(s->'employee_role_ids','[]'::jsonb)))) q;
        END IF;
      ELSE
        UPDATE notification_outbox SET status='skipped', processed_at=now() WHERE id=ev.id; CONTINUE;
      END IF;

      v_entity := CASE ev.event_type
        WHEN 'order_created' THEN 'order' WHEN 'customer_created' THEN 'contact'
        WHEN 'lead_created' THEN 'lead' WHEN 'lead_assigned' THEN 'lead'
        WHEN 'deal_created' THEN 'deal' WHEN 'deal_assigned' THEN 'deal'
        WHEN 'expense_created' THEN 'expense' WHEN 'payment_created' THEN 'payment'
        WHEN 'task_completed' THEN 'task' WHEN 'task_assigned' THEN 'task' ELSE 'announcement' END;

      SELECT COALESCE(full_name, email) INTO v_who FROM profiles WHERE id=v_actor;
      v_who := COALESCE(v_who, 'A team member');

      v_title := CASE ev.event_type
        WHEN 'order_created' THEN 'New order' WHEN 'customer_created' THEN 'New customer'
        WHEN 'lead_created' THEN 'New lead' WHEN 'deal_created' THEN 'New deal'
        WHEN 'expense_created' THEN 'New expense' WHEN 'payment_created' THEN 'Payment collected'
        WHEN 'task_completed' THEN 'Task completed' WHEN 'task_assigned' THEN 'Task assigned to you'
        WHEN 'lead_assigned' THEN 'Lead assigned to you' WHEN 'deal_assigned' THEN 'Deal assigned to you'
        ELSE COALESCE(NULLIF(regexp_replace(COALESCE(s->>'title',''), '<[^>]*>', '', 'g'), ''), 'New announcement') END;

      v_body := CASE ev.event_type
        WHEN 'order_created' THEN trim(v_who||' created order '||COALESCE(s->>'order_number',''))
        WHEN 'customer_created' THEN v_who||' added '||COALESCE(s->>'name','a customer')
        WHEN 'lead_created' THEN trim(v_who||' added lead '||COALESCE(s->>'name',''))
        WHEN 'deal_created' THEN trim(v_who||' created deal '||COALESCE(s->>'title',''))
        WHEN 'expense_created' THEN trim(v_who||' submitted expense '||COALESCE(s->>'expense_number',''))
        WHEN 'payment_created' THEN v_who||' recorded a payment'
        WHEN 'task_completed' THEN v_who||' completed "'||COALESCE(s->>'title','a task')||'"'
        WHEN 'task_assigned' THEN COALESCE(s->>'title','You have a new task')
        WHEN 'lead_assigned' THEN COALESCE(s->>'name','A lead was assigned to you')
        WHEN 'deal_assigned' THEN COALESCE(s->>'title','A deal was assigned to you')
        ELSE left(trim(regexp_replace(COALESCE(s->>'content',''), '<[^>]*>', '', 'g')), 140) END;

      FOREACH cand IN ARRAY v_cands LOOP
        IF cand IS NULL OR cand=v_actor THEN CONTINUE; END IF;
        IF NOT notif_has_right(cand, v_right) THEN CONTINUE; END IF;
        IF notif_is_muted(cand, v_category) THEN CONTINUE; END IF;
        INSERT INTO notifications (account_id, recipient_user_id, category, event_type, source_event_id, title, body, data)
        VALUES (ev.account_id, cand, v_category, ev.event_type, ev.id, v_title, v_body, jsonb_build_object('entity', v_entity, 'id', ev.record_id))
        ON CONFLICT (source_event_id, recipient_user_id) DO NOTHING;
        GET DIAGNOSTICS ins = ROW_COUNT; created := created + ins;
      END LOOP;

      UPDATE notification_outbox SET status='done', processed_at=now() WHERE id=ev.id;
    EXCEPTION WHEN OTHERS THEN
      UPDATE notification_outbox SET status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END, attempts=attempts+1, last_error=SQLERRM WHERE id=ev.id;
    END;
  END LOOP;
  RETURN created;
END $$;

-- Clean tags out of any announcement notifications already created.
UPDATE notifications
SET body = trim(regexp_replace(COALESCE(body, ''), '<[^>]*>', '', 'g')),
    title = COALESCE(NULLIF(regexp_replace(COALESCE(title, ''), '<[^>]*>', '', 'g'), ''), title)
WHERE event_type = 'announcement_published' AND (body ~ '<[^>]*>' OR title ~ '<[^>]*>');
