*WACRM Engineering Bible* > *Core Architecture* > *Permission & Security System*
[← 06_Web_Architecture](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/06_Web_Architecture.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [08_UI_Design_System →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/08_UI_Design_System.md)
---

# WACRM Engineering Bible - Permission & Security System

*Version: v1.0*

WACRM employs a dual-layer permission system. The Database enforces strict hierarchical security, while the application layer dictates user-friendly feature scoping.

## 1. System Roles (The Hard Security Layer)
Defined in `profiles.account_role`. This is a strict Enum enforced at the PostgreSQL database level via Row Level Security (RLS). 

| Role | Database Authority | Business Equivalent |
|------|--------------------|---------------------|
| **Owner** | Ultimate authority. Can bypass delete restrictions, transfer account ownership, and access billing. | CEO / Founder |
| **Admin** | Can insert/update/delete almost all operational and configuration tables within the `account_id`. | Operations Manager |
| **Agent** | Restricted to operational tables (Contacts, Tasks, Messages). Cannot modify configurations (WhatsApp Webhooks, API Keys). | Field Agent / Field Agent |
| **Viewer**| Strictly SELECT only. Cannot INSERT or UPDATE any operational data. | Auditor / Board Member |

### 1.1 RLS Implementation
Almost every RLS policy uses this core function:
```sql
CREATE POLICY "Agents can view contacts" ON contacts
FOR SELECT USING (
  is_account_member(account_id, 'agent')
);
```

## 2. Business Roles & Scopes (The Soft UI Layer)
Defined in `employee_roles.permissions` as a JSONB column. 
While System Roles determine *if* a user can write to a table, Business Roles determine *which rows* they should see in the UI.

### 2.1 Data Scopes
- **Own:** User can only see records where `user_id = auth.uid()`.
- **Team:** User can see records owned by users reporting to their `team_id`.
- **Company / All:** User can see all records across the `account_id` (Requires Admin system role).

*Security Note:* UI hiding is not security. If a user with "Own" scope uses an API tool like Postman to query the Supabase endpoint directly, RLS might allow them to see the whole table if they are an 'Agent'. True Row-level scoping must be applied in the SQL policies if strict isolation is required.

## 3. Mobile Device Approval Flow
WACRM implements MDM-lite (Mobile Device Management) features to prevent field agents from punching in on unauthorized devices (e.g., logging in on a friend's phone to fake attendance).

1. **First Login:** When a user logs into the mobile app for the very first time, the device UUID is stored in `employee_devices` and automatically marked as `Approved`.
2. **Subsequent Logins:** If the user logs out and logs in on a *new* phone, the new device UUID is logged as `Pending`. 
3. **Gating:** The mobile app detects the `Pending` state and blocks access to the Home Screen.
4. **Admin Action:** An Admin must log into the Web Dashboard (`/settings/team`) and manually approve the new device before the user can punch in.

## 4. API Key Security
- **Generation:** Only Admins/Owners can generate API keys (`/settings/developers`).
- **Storage:** Keys are hashed in the database using `pgcrypto`. The raw key is shown to the user only once.
- **Usage:** API requests must include `Authorization: Bearer <raw_key>`. The backend hashes the incoming key and compares it against the database.
