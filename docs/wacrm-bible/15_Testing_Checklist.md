*WACRM Engineering Bible* > *Deep Specifications* > *QA & Testing Checklist*
[← 14_Component_Library](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/14_Component_Library.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [16_Development_Workflow →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/16_Development_Workflow.md)
---

# WACRM Engineering Bible - QA & Testing Checklist

*This document defines the Enterprise Acceptance Criteria that must be passed before any major release.*

## 1. Row Level Security (RLS) Penetration Tests
*Goal: Ensure no tenant can see another tenant's data.*
- [ ] **Direct API Query:** Obtain a valid JWT for `Account A`. Use Postman to `GET /rest/v1/contacts?account_id=eq.{ACCOUNT_B_ID}`. Result must be `[]`.
- [ ] **Agent Escelation:** Obtain an Agent JWT. Attempt to `DELETE /rest/v1/whatsapp_config`. Result must be `401 Unauthorized`.
- [ ] **Device Spoofing:** Attempt to inject a fake `device_id` into the `employee_devices` table as an Agent.

## 2. Field Force Reliability (Mobile)
*Goal: Ensure background tracking cannot be killed easily and handles network loss.*
- [ ] **Deep Sleep Test:** Punch In. Minimize app. Turn screen off. Drive 2km over 20 minutes. Check Web Dashboard. Must see at least 2 location pings.
- [ ] **Offline Queue Test:** Punch In. Turn on Airplane Mode. Drive 1km. Turn off Airplane mode. Wait 1 minute. Verify all pings were flushed to the server with accurate `recorded_at` timestamps.
- [ ] **GPS Spoofing Check:** Use a "Fake GPS" developer app on Android. Attempt to punch in at a restricted Geofence. The app should (if implemented) detect `isMocked` and reject the check-in.

## 3. Realtime Concurrency
*Goal: Prevent race conditions in the WhatsApp Inbox and Tasks.*
- [ ] **Dual Inbox Read:** Agent A and Agent B open the same unread conversation. Agent A replies. Agent B's screen must immediately reflect the reply, and the unread count must drop to 0 for both.
- [ ] **Approval Race:** Two Admins open the same Expense claim. Admin A clicks "Approve". Admin B clicks "Reject" 1 second later. Admin B's request must fail gracefully (Record already processed).

## 4. WhatsApp Webhook Resilience
*Goal: Handle Meta's aggressive retry logic.*
- [ ] **Duplicate Payload Test:** Send the exact same Meta webhook payload twice within 500ms. The system must use the `wamid` (WhatsApp Message ID) as a unique constraint and ignore the second payload, returning 200 OK.

## 5. UI/UX Regressions
*Goal: Ensure the design system remains premium.*
- [ ] **Dark Mode Lock:** Ensure no white flashes occur during page loads on the web dashboard.
- [ ] **Mobile Keyboard:** Open "Add Contact" on mobile (small screen like iPhone SE). Focus the bottom-most input. The `<KeyboardAvoidingView>` must scroll the input above the keyboard.
