# Notifications & Alarms — Design Spec

**Date:** 2026-09-18
**Author:** Claude Code (with founder approval)
**Scope:** Items 1–6 of the 2026-09-18 batch. Items 7 (collaborator delete bug), 8 (timeline dustbin/soft-delete), 9 (keyboard nav) are tracked separately.
**Status:** Approved architecture — implementing.

---

## 1. Goal

A cross-platform (web + mobile) in-app **Notifications & Alarms** system, gated by
per-category rights and softened by per-user mute toggles.

- **On-device local notifications** — task reminder at scheduled time; punch-in / punch-out
  alarms from org shift settings. Work offline, fire when app is closed.
- **Server-sent push + in-app center** — assignment alerts (lead / customer / task assigned),
  announcements, and admin team-activity alerts (order / expense / payment / task-completion /
  lead / customer / deal created).

## 2. Confirmed decisions (founder, 2026-09-18)

1. **Mobile delivery:** Full device push (Expo + FCM, needs new build) **and** on-device
   scheduled local notifications.
2. **Admin recipients (item 3):** the rep's reporting **manager (hierarchy)** + any Admin-role
   users holding the `receive_team_activity_notifications` right. Fall back to account admins
   when no manager is set.
3. **Control model:** **rights gate + personal mute toggles.** No right → category never
   generated for that user (enforced in the generator, not just UI). Within granted categories,
   each user may mute in their own settings. Web admins configured the same way.
4. **Punch alarm (item 6):** high-importance **notification with a distinct alarm sound +
   vibration** at each shift start/end. Re-armed daily and after reboot. NOT a full-screen
   clock alarm (SYSTEM_ALERT_WINDOW stays blocked).

## 3. Architecture

Two deliberately separate layers.

### Layer A — On-device local notifications (no server)
- `expo-notifications` schedules local notifications on the device.
- **Task reminder:** scheduled at the task's due date/time (account-local TZ — see
  `reports-and-dates-are-account-local` rule; never `toISOString`). Rescheduled on task
  create/edit/complete and on login; cancelled on complete/delete.
- **Punch alarms:** read `accounts.settings.tracking_settings.shiftStart/shiftEnd` ("HH:MM"),
  schedule two daily repeating notifications on the high-importance "Alarms" channel.
- Re-armed on: login, relevant data change, and `RECEIVE_BOOT_COMPLETED` (already granted).
- Both gated by rights (`receive_task_notifications`, `receive_punch_alarm`) + personal mute,
  evaluated on-device from the synced permission set.

### Layer B — Server-sent push + in-app center (reuses `automation_events`)
1. **DB triggers** emit rows into the existing `automation_events` queue for the new events:
   `lead_created`, `deal_created`, `expense_created`, `payment_created`, `task_completed`,
   `lead_assigned`, `customer_assigned`, `task_assigned`, `announcement_published`.
   (Existing `customer_created`, `order_created` are reused for admin team-activity.)
2. **Notification generator** — new cron worker (sibling to the WhatsApp `event-worker`), reads
   unprocessed events, resolves **internal-user** recipients (hierarchy + rights + mutes), and
   writes one `notifications` row per recipient. Inherits the queue's claim/dedup/staleness
   guards. Idempotent via a unique (event_id, recipient_user_id) key.
3. **Push dispatcher** — sends undelivered `notifications` rows to Expo Push API, marks
   `pushed_at`, prunes dead tokens. Web reads the same table via Supabase Realtime for the
   in-app bell/center (no push needed on web for v1; browser push deferred).

Recipient resolution reuses the reporting-hierarchy helpers already used by data-scope.

## 4. Data model (new tables, account-scoped, RLS on)

```
notifications
  id uuid pk
  account_id uuid  -> accounts
  recipient_user_id uuid            -- profiles.id
  category text                     -- task_reminder | assignment | announcement | team_activity | punch_alarm | ...
  event_type text                   -- source automation_events.event_type (nullable for local)
  source_event_id uuid null         -- automation_events.id (dedup)
  title text
  body text
  data jsonb                        -- { entity: 'lead'|'order'|..., id, deep_link }
  read_at timestamptz null
  pushed_at timestamptz null
  created_at timestamptz default now()
  UNIQUE (source_event_id, recipient_user_id)   -- generator idempotency

notification_preferences
  account_id uuid
  user_id uuid                      -- profiles.id
  category text
  muted boolean default false
  PRIMARY KEY (user_id, category)

push_tokens
  id uuid pk
  account_id uuid
  user_id uuid                      -- profiles.id
  expo_token text UNIQUE
  platform text                     -- 'android' | 'ios'
  last_seen timestamptz
```

RLS: recipient sees own `notifications`/`preferences`/`push_tokens`; generator/dispatcher use
service role. Follows existing account-isolation RLS conventions.

## 5. Rights (registry)

Add `PERMISSIONS.NOTIFICATIONS`:
- `receive_task_notifications`
- `receive_assignment_notifications`
- `receive_announcement_notifications`
- `receive_team_activity_notifications`   (item 3 admin alerts)
- `receive_punch_alarm`

No right → generator skips that category for that user; on-device layer skips scheduling.
Configured per role in the existing role editor (web); same categories apply to web + mobile.
Default role grants: reps get task + assignment + announcement + punch; managers/admins also
get team_activity. Legacy/full-access roles get all (zero-touch, per plan-entitlement pattern).

## 6. Web pieces
- Notification **bell + center** in header (Realtime-backed list, mark-read, deep-link).
- **Preferences** screen: per-category mute toggles (within granted rights).
- Admin config = existing role editor (new rights) + org-level category on/off in settings.
- API: `GET /api/notifications`, `POST /api/notifications/read`, cron routes for generator +
  dispatcher (siblings to `automations/events/cron`).

## 7. Mobile pieces  *(ships with next build)*
- Add `expo-notifications`; config plugin + Android channels (default + high-importance
  "Alarms" with custom sound). FCM credentials in EAS (one-time human step, documented).
- Push-token registration on login → upsert `push_tokens`.
- Local scheduler service: task reminders + shift alarms; re-arm on login/change/boot.
- In-app notification center screen + unread badge.
- All gated by synced rights + local mute prefs.

## 8. Sequencing
- **Slice 1 (web/DB, no build gate):** migration (tables, RLS, new event triggers, rights),
  generator worker + tests, push dispatcher skeleton, web notification center + preferences.
- **Slice 2 (mobile, build gate):** expo-notifications, token registration, local scheduler,
  mobile center; then FCM setup + new AAB/APK; device test.
- FCM credential setup + custom alarm sound asset = documented human steps.

## 9. Testing
- Generator recipient resolution (hierarchy + rights + mutes + fallback): unit tests.
- Idempotency: same event processed twice → one row per recipient.
- Trigger correctness: each new event enqueues exactly one `automation_events` row.
- Local scheduling TZ correctness (account-local, not UTC).

## 10. Out of scope (v1)
Browser web-push; true full-screen alarms; email/SMS channels; digest batching.
```
