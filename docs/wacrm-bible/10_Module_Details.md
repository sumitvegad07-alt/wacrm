*WACRM Engineering Bible* > *Deep Specifications* > *Deep Module Specifications*
[← 09_Future_Roadmap](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/09_Future_Roadmap.md) | [📖 Master Index](file:///c:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [11_Web_vs_Mobile_Gap →](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/11_Web_vs_Mobile_Gap.md)
---

# WACRM Engineering Bible - Deep Module Specifications

*This document contains the complete technical engineering specification for every module in WACRM. It is the absolute source of truth for technical implementation logic, relationships, and edge cases.*

> [!IMPORTANT]
> **Business Rules Moved**
> For Business Goals, Workflows, Conversions, and Lifecycle Rules, refer to [23_PRODUCT_RULES.md](file:///c:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/23_PRODUCT_RULES.md). This document (10) focuses strictly on database tables and APIs.

---

## 1. Contacts Module (CRM Core)

### Technical Implementation
- **Tables:** `contacts`, `tags`, `contact_tags`, `custom_fields`, `contact_custom_values`, `module_activities`.
- **API / Hooks:** Queried natively on client via `supabase-js`.
- **Relationships:**
  - One-to-Many: `site_visits`, `tasks`, `deals`, `conversations`.
  - Many-to-Many: `tags` (via `contact_tags`).
- **Edge Cases:** 
  - *Duplicate Phones:* `contacts.phone` has a unique constraint per `account_id`. Phone numbers must be normalized (E.164) before insertion.

---

## 2. Field Force: Location Tracking & Attendance

### Technical Implementation
- **Tables:** `tracking_sessions`, `location_pings`.
- **Mobile Dependencies:** `expo-location` (Foreground Service), `expo-battery`.
- **Realtime:** Web dashboard subscribes to `location_pings` using `supabase.channel('public:location_pings')`.
- **Offline Behavior:** If mobile drops network, `lib/location.ts` queues pings in local `expo-file-system`.
- **Edge Cases:**
  - *Timer Drift:* Android OS fires location callbacks irregularly. The local 10-minute throttle explicitly ignores rapid consecutive callbacks.

---

## 3. Field Force: Site Visits

### Technical Implementation
- **Tables:** `site_visits`, `geofences`.
- **Relationships:** Links to `contact_id` and `user_id`.
- **Validation:** Check-out cannot occur without a Check-in. Check-in requires `expo-camera` permission.

---

## 4. Expense Management

### Technical Implementation
- **Tables:** `expenses`, `expense_types`, `expense_rate_tiers`.
- **Storage:** `odometer_photos` bucket.
- **Edge Cases:** 
  - *Approval Editing:* Once approved, the record is locked via RLS and cannot be modified by the Field Agent.

---

## 5. WhatsApp Inbox & Automation

### Technical Implementation
- **Tables:** `conversations`, `messages`, `message_templates`.
- **Dependencies:** Meta Graph API (Cloud API).
- **Limitations:** Only supports text and basic media. No native mobile inbox UI yet.
- **Automations:** `automations` table intercepts inbound messages based on keywords before marking them "unread" for humans.
