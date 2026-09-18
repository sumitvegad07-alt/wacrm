-- Notification push delivery via pg_net -> Expo Push API (self-contained; no
-- external scheduler, no secret — the Expo endpoint needs no auth, and Android
-- delivery uses the FCM V1 service-account key configured in EAS credentials).
--
-- Runs after the generator each minute. Sends one Expo message per
-- (unpushed notification x recipient device token), then stamps pushed_at on
-- every unpushed row so nothing is resent; recipients with no device token just
-- keep the in-app / web copy.

CREATE OR REPLACE FUNCTION send_pending_push()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, net AS $$
DECLARE
  v_msgs  jsonb;
  v_count int := 0;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
           'to', t.expo_token,
           'title', n.title,
           'body', COALESCE(n.body, ''),
           'sound', 'default',
           'channelId', 'default',
           'priority', 'high',
           'data', n.data
         )),
         count(*)
    INTO v_msgs, v_count
  FROM notifications n
  JOIN push_tokens t ON t.user_id = n.recipient_user_id
  WHERE n.pushed_at IS NULL;

  IF v_msgs IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := v_msgs
    );
  END IF;

  UPDATE notifications SET pushed_at = now() WHERE pushed_at IS NULL;
  RETURN COALESCE(v_count, 0);
END $$;

-- One tick: generate, then push (push isolated so a delivery hiccup never rolls
-- back generation).
CREATE OR REPLACE FUNCTION run_notifications_tick()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM process_notification_outbox();
  BEGIN
    PERFORM send_pending_push();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'send_pending_push failed: %', SQLERRM;
  END;
END $$;

-- Point the every-minute job at the combined tick.
DO $$ BEGIN PERFORM cron.unschedule('notification-generator');
EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('notification-generator', '* * * * *', $$ SELECT public.run_notifications_tick(); $$);
