*WACRM Engineering Bible* > *Deep Specifications* > *Component Library (Web)*
[← 13_Navigation_Flow](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/13_Navigation_Flow.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [15_Testing_Checklist →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/15_Testing_Checklist.md)
---

# WACRM Engineering Bible - Component Library (Web)

*This document catalogs the reusable React components found in `src/components`. Rebuilding existing UI is strictly prohibited.*

## 1. Generic Primitives (`src/components/ui`)
Powered by Shadcn UI. These are domain-agnostic.
- **`<Button>`:** Use `variant="primary"` for main actions. Use `variant="destructive"` for deletions.
- **`<Input>` / `<Textarea>`:** Always wrap inside a `<FormField>` from `react-hook-form` to gain automatic Zod validation text.
- **`<Dialog>`:** Standard center-screen modal. Use for simple confirmations or short 1-2 input forms.
- **`<Sheet>`:** Slide-out drawer from the right. Use for complex forms (e.g., "Create Contact" or "Edit Expense").
- **`<DataTable>`:** Generic wrapper around `@tanstack/react-table`. Supports sorting, filtering, and pagination out of the box.

## 2. Domain-Specific Components

### 2.1 CRM & Contacts
- **`<ContactSelector>`:** An async dropdown component that searches contacts. Used when creating Tasks or Site Visits.
- **`<Timeline>`:** Renders `module_activities`. Takes an array of events and draws the vertical line with icons based on `activity_type`.

### 2.2 Location & Tracking
- **`<MapContainer>`:** Wrapper around `react-leaflet`. Handles tile loading and marker clustering.
- **`<AgentTracker>`:** Subscribes to `public:location_pings` and moves a car/dot icon smoothly across the `<MapContainer>` using Framer Motion interpolation.

### 2.3 Inbox
- **`<ChatBubble>`:** Renders inbound/outbound WhatsApp messages. Handles media attachments and "read" ticks identically to the native WhatsApp app.

## 3. Engineering Rules for Components
1. **No External Fetching inside UI Components:** A `Button` or `Card` should never call `supabase.from()`. Pass data down as props.
2. **Tailwind Merge (`cn`):** Always use the `cn()` utility when exposing a `className` prop to ensure Tailwind classes resolve specificity correctly (e.g., overriding a default `bg-blue-500` with `bg-red-500`).
