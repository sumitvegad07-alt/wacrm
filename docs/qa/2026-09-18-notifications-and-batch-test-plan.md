# Manual Test Plan — Notifications & Alarms + Batch (2026-09-18)

Covers the 9-item batch: Notifications & Alarms (items 1–6), collaborator-delete
fix (#7), timeline dustbin (#8), dropdown keyboard nav (#9).

**Legend:** ✅ live on web now · 📱 mobile, needs a new build + FCM to activate ·
⏳ blocked on the cron being scheduled.

---

## 0. Prerequisites before testing

| # | Setup | Why |
|---|-------|-----|
| P1 | **Schedule `/api/notifications/cron`** every minute (same scheduler as `/api/automations/events/cron`, header `x-cron-secret: <AUTOMATION_CRON_SECRET>`). | Nothing fans out to users until this runs. Until then events sit in `notification_outbox` (verified: 1 real `task_assigned` already captured and pending). |
| P2 | In **Team → Roles**, grant the new **Notifications & Alarms** rights to the roles under test (admins/owners already have all). | Rights gate delivery; no right → no notification. |
| P3 | 📱 Add **FCM credentials in EAS** and build a **new AAB/APK**. | Mobile push + `expo-notifications` are inert on the current build. |
| P4 | Have at least: one **admin** user, one **rep** user with a reporting setup, both able to log into web (and mobile once P3 is done). | Team-activity + assignment tests need distinct actor/recipient. |

---

## 1. Web notification centre (bell) ✅⏳

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| WB-1 | Bell appears | Log into web portal. Look at the top-right header. | A bell icon shows between search and the theme toggle. |
| WB-2 | Unread badge | (After P1 and a generated notification for this user.) | A red badge with the unread count sits on the bell (`9+` above 9). |
| WB-3 | Open centre | Click the bell. | A dropdown lists recent notifications, newest first; unread rows have a coloured left dot and tinted background. |
| WB-4 | Real-time arrival | Keep the portal open. Have someone trigger a notification for you (e.g. assign you a lead). | Within ~1 min (cron cadence) the item appears **without refreshing**, badge count rises. |
| WB-5 | Mark one read | Click a notification. | It navigates to the related record; the row becomes read (dot clears), badge count drops. |
| WB-6 | Mark all read | Open the bell, click **Mark all read**. | All rows become read, badge disappears. |
| WB-7 | Empty state | With no notifications. | Bell shows no badge; opening it shows “You’re all caught up.” |
| WB-8 | Isolation | Log in as a different user. | You see only **your** notifications, never another user’s. |

## 2. Team-activity → admin notifications (item 3) ✅⏳

Recipients = the rep’s manager (if reporting hierarchy set) + all account admins/owners, minus the actor, minus muted, only those with **Receive team activity** right.

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| TA-1 | Order created | As a **rep**, create an order. As an **admin**, watch the bell. | Admin gets a “New order” notification naming the rep; the rep (actor) does **not**. |
| TA-2 | Expense / payment / lead / customer / deal created | As a rep, create each. | Admin gets one notification per event, correct title (“New expense/lead/customer/deal”, “Payment collected”). |
| TA-3 | Task completed | As a rep, mark an assigned task Completed. | Admin gets “Task completed”. |
| TA-4 | Right removed | Remove **Receive team activity** from the admin’s role, repeat TA-1. | Admin gets **no** team-activity notification. |
| TA-5 | Self-action | As an admin, create an order yourself. | You do **not** notify yourself (self-skip). |

## 3. Assignment notifications (item 2) ✅⏳

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| AS-1 | Lead assigned | Assign a lead to rep B. | Rep B gets “Lead assigned to you” (needs **Receive assignment** right). |
| AS-2 | Deal assigned | Change a deal’s assignee to rep B. | Rep B gets “Deal assigned to you”. |
| AS-3 | Task assigned | Create/assign a task to rep B. | Rep B gets “Task assigned to you” (needs **Receive task** right). |
| AS-4 | Assign to self | Assign a lead to yourself. | No notification (self-skip). |
| AS-5 | Reassign | Move a lead from rep B to rep C. | Rep C is notified; rep B is not re-notified. |

## 4. Announcements (item 2) ✅⏳

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| AN-1 | Targeted announcement | Publish a `tenant_announcement` to specific employees/roles. | Only targeted, right-holding users are notified; title = announcement title. |
| AN-2 | Broadcast | Publish with no employee/role targets. | All active users with the **Receive announcement** right are notified. |

## 5. Rights gate & personal mute (items 4 & 5) ✅

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| RG-1 | Rights visible | Team → Roles → edit a role. | A **Notifications & Alarms** group lists the 5 category rights with descriptions. |
| RG-2 | No right, no notify | Give a rep none of the notification rights; trigger events for them. | Rep receives nothing in any category. |
| RG-3 | Grant one category | Grant only **Receive task**; trigger a task-assign + a lead-assign. | Rep gets the task one only, not the lead one. |
| RG-4 | Mute via UI (web) | Go to **Settings → Notifications**. Turn a category **off**. Trigger that event for yourself. | That category stops arriving; others still arrive. Only categories your role grants are listed. |
| RG-5 | Unmute | Turn it back **on**; trigger again. | Notifications resume. Setting persists across reload. |
| RG-6 | Mute via UI (📱 mobile) | In the app, open the bell → gear (Notification settings). Toggle a category off. | Same behaviour as web; shared `notification_preferences`. |
| RG-7 | Default seed (existing tenants) | As an existing rep (non-admin role), with no manual grant. | The rep already holds task/assignment/announcement/punch rights (backfilled) and receives those notifications. |
| RG-8 | Default seed (new account) | Provision a brand-new account; inspect the default **Sales Executive** role. | It has the 4 rep notification rights pre-granted; team-activity is not. |

## 6. 📱 Mobile push (items 2 & 3)

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| MP-1 | Permission + token | Fresh install, log in; accept the notification permission prompt. | A row appears in `push_tokens` for this user/device. |
| MP-2 | Push received (app background) | Trigger an assignment/announcement/team-activity for this user; background the app. | A system push notification arrives with the correct title/body. |
| MP-3 | Tap opens centre/record | Tap the push. | App opens; the item is visible in the notification centre. |
| MP-4 | In-app centre | Tap the bell on the home header. | Notification list shows, mark-read + deep-link work like web. |
| MP-5 | Rights respected | Remove a category right; trigger it. | No push for that category. |

## 7. 📱 Mobile task reminders (item 1)

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| TR-1 | Reminder fires | Create a task assigned to yourself with a **reminder date/time** a few minutes out (needs **Receive task** right). Lock the phone. | At that time a local notification “Task reminder” fires with the task title, even with the app closed. |
| TR-2 | No right | Remove **Receive task**; relaunch; set another reminder. | No reminder is scheduled/fired. |
| TR-3 | Completed task | Complete a task that had a future reminder; relaunch. | Its reminder no longer fires. |
| TR-4 | Timezone | Reminder time shows/fires at the account-local (IST) wall-clock time, not UTC. | Fires at the intended local time. |

## 8. 📱 Mobile punch alarms (item 6)

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| PA-1 | Alarms scheduled | With **Receive punch alarm** right and shift times set in Org Settings, log in. Lock the phone. | At shift **start** a high-priority “Time to punch in” alarm (sound + vibration) fires; at shift **end**, “Time to punch out”. |
| PA-2 | Reboot survives | Reboot the phone before shift start. | The alarm still fires (re-armed on boot). |
| PA-3 | No right | Remove the punch-alarm right; relaunch. | No punch alarms fire. |
| PA-4 | Shift change | Admin changes shift times; rep relaunches app. | Next day’s alarms fire at the new times. |

## 9. Collaborator delete fix (#7) ✅

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| CO-1 | Remove via chip × (lead) | Open a **Lead** with ≥1 collaborator. Below the picker, click the **×** on a collaborator chip. | The collaborator is removed immediately and the change persists (reload confirms). |
| CO-2 | Remove via chip × (deal) | Same on a **Deal**. | Same — removal works and persists. |
| CO-3 | Remove via dropdown | Open the collaborators dropdown, click a selected (ticked) member. | It de-selects and persists — including members added via mobile/older flows (id-space). |
| CO-4 | Add still works | Add a collaborator via the dropdown. | Chip appears and persists. |
| CO-5 | No-permission | As a user without collaborator-manage rights. | The picker is disabled; no × shown. |

## 10. Timeline dustbin soft-delete (#8) ✅

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| TL-1 | Delete planned task | On a lead/deal/contact/order detail, in the **Timeline → Planned**, click the **trash** icon on a task. | Task disappears from the timeline; toast “Task removed”. |
| TL-2 | Delete past task | In **Timeline → Past**, click trash on a completed task. | It disappears; toast “Task removed”. |
| TL-3 | Delete a note | On a note created via the timeline **ADD**, click its trash. | Note disappears; toast “Note removed”. |
| TL-4 | Soft, not hard | After TL-1, check the Tasks list with an “Inactive” filter (or DB `is_active=false`). | The task still exists, marked inactive (not hard-deleted). |
| TL-5 | Persists | Reload the detail page. | Removed items stay gone. |
| TL-6 | Cross-module | Repeat on a Deal and a Contact. | Same behaviour (shared component). |

## 11. Dropdown keyboard navigation (#9) ✅

Applies to searchable dropdowns across all modules (lead source/status/owner, expense/payment type, etc.).

| ID | Test case | Steps | Expected result |
|----|-----------|-------|-----------------|
| KB-1 | Auto-focus | Open any searchable dropdown. | The search box is focused; you can type immediately. |
| KB-2 | Filter + arrows | Type a few letters, then press **↓ / ↑**. | The highlight moves through the filtered options and scrolls into view. |
| KB-3 | Enter selects | Highlight an option, press **Enter**. | That option is selected and the dropdown closes. |
| KB-4 | Enter creates | On a dropdown with create enabled, type a new value (no match), press **Enter**. | It creates and selects the new value. |
| KB-5 | Escape | Press **Esc**. | The dropdown closes without changing the value. |
| KB-6 | Mouse parity | Hover options with the mouse. | Hover moves the same highlight; clicking selects. |

---

## Known gaps / not yet built (call out in results)
- **Separate lead/contact notes delete (#8)**: only task-notes are removable today; `lead_notes`/`contact_notes` need a 1-line `is_active` migration to be deletable.
- **#9 breadth**: keyboard nav is delivered for the searchable dropdown (the main gap). Full form-wide Enter-to-next-field behaviour is a larger, separate pass.
- 📱 All mobile items require the new build + FCM (P3).

## Evidence already captured (no manual step needed)
- Migration applied to prod: 4 tables, 14 triggers, realtime on, **0 security advisories**.
- A real `task_assigned` event was captured into `notification_outbox` correctly (full snapshot, actor set) — triggers verified live.
- Generator decision logic: 12 unit tests green (rights, mute, self-skip, active-only, dedupe, hierarchy pool). Both repos typecheck clean.
