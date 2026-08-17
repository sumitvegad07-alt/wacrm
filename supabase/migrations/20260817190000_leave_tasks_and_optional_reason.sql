-- ============================================================================
-- 20260817190000_leave_tasks_and_optional_reason.sql
--
-- 1. `tasks.leave_id` — lets a task be linked to a leave, the same way tasks
--    already link to orders, leads, expenses and payments. This is what the
--    shared <Timeline> needs to show tasks on the leave detail page.
--
-- 2. Founder decision: an admin rejecting or cancelling a leave MAY give a
--    reason but is no longer forced to. The columns stay and are still stored
--    whenever a reason is given; only the requirement is dropped.
--
--    The reason on the REQUEST itself stays mandatory (NOT NULL + non-blank
--    CHECK on `leaves.reason`) — that one is the employee explaining why they
--    want the time off, which is a different thing entirely.
-- ============================================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS leave_id UUID REFERENCES leaves(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_leave ON tasks (leave_id);

CREATE OR REPLACE FUNCTION update_leave_status(p_leave_id UUID, p_new_status TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE v_leave RECORD; v_caller UUID; v_is_admin BOOLEAN; v_is_self BOOLEAN; v_may_decide BOOLEAN; v_result JSONB;
BEGIN
  SELECT * INTO v_leave FROM leaves WHERE id = p_leave_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Leave not found or not accessible'; END IF;
  IF NOT is_account_member(v_leave.account_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='insufficient_privilege'; END IF;
  SELECT id INTO v_caller FROM profiles WHERE user_id = auth.uid() AND account_id = v_leave.account_id;
  v_is_admin := is_account_member(v_leave.account_id,'admin');
  v_is_self := v_caller IS NOT DISTINCT FROM v_leave.employee_id;
  IF v_leave.status = p_new_status THEN RETURN jsonb_build_object('id',p_leave_id,'status',v_leave.status,'unchanged',true); END IF;
  IF NOT leave_status_transition_allowed(v_leave.status, p_new_status) THEN
    RAISE EXCEPTION 'Cannot move a % leave to %', v_leave.status, p_new_status USING ERRCODE='check_violation'; END IF;

  IF p_new_status IN ('Approved','Rejected') THEN
    v_may_decide := v_is_admin OR has_permission(auth.uid(), v_leave.account_id,'approve_leaves') OR is_in_downline(v_caller, v_leave.employee_id);
    IF NOT v_may_decide THEN RAISE EXCEPTION 'You do not have permission to approve or reject leave' USING ERRCODE='insufficient_privilege'; END IF;
    -- A manager cannot sign off their own leave. An owner/admin can, because a single-admin
    -- account would otherwise have no way to approve anything; the log records it as such.
    IF v_is_self AND NOT v_is_admin THEN RAISE EXCEPTION 'You cannot approve your own leave' USING ERRCODE='insufficient_privilege'; END IF;
    -- No reason requirement here any more (founder decision). It is still stored when given.
  ELSE
    IF NOT (v_is_admin OR has_permission(auth.uid(), v_leave.account_id,'manage_leaves') OR (v_is_self AND v_leave.status='Pending')) THEN
      RAISE EXCEPTION 'You do not have permission to cancel this leave' USING ERRCODE='insufficient_privilege'; END IF;
  END IF;

  UPDATE leaves SET status = p_new_status,
    approved_by = CASE WHEN p_new_status='Approved' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN p_new_status='Approved' THEN NOW() ELSE approved_at END,
    rejected_by = CASE WHEN p_new_status='Rejected' THEN auth.uid() ELSE rejected_by END,
    rejected_at = CASE WHEN p_new_status='Rejected' THEN NOW() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_new_status='Rejected' THEN NULLIF(btrim(COALESCE(p_reason,'')),'') ELSE rejection_reason END,
    cancelled_by = CASE WHEN p_new_status='Cancelled' THEN auth.uid() ELSE cancelled_by END,
    cancelled_at = CASE WHEN p_new_status='Cancelled' THEN NOW() ELSE cancelled_at END,
    cancellation_reason = CASE WHEN p_new_status='Cancelled' THEN NULLIF(btrim(COALESCE(p_reason,'')),'') ELSE cancellation_reason END
   WHERE id = p_leave_id;

  INSERT INTO module_activities (account_id,user_id,module_name,record_id,action,message,details)
  VALUES (v_leave.account_id, auth.uid(),'leave',p_leave_id,'leave_'||lower(p_new_status),'Leave '||lower(p_new_status),
    jsonb_build_object('from_status',v_leave.status,'to_status',p_new_status,'reason',NULLIF(btrim(COALESCE(p_reason,'')),''),'self_approved',(v_is_self AND p_new_status='Approved')));

  SELECT to_jsonb(l) INTO v_result FROM leaves l WHERE l.id = p_leave_id;
  RETURN v_result;
END; $fn$;
