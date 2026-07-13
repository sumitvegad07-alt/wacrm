*WACRM Engineering Bible* > *Core Architecture* > *UI Design System & SOP*
[← 07_Permission_System](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/07_Permission_System.md) | [📖 Master Index](file:///C:/Users/Xitij/Desktop/wacrm/docs/WACRM_BIBLE.md) | [09_Future_Roadmap →](file:///C:/Users/Xitij/Desktop/wacrm/docs/wacrm-bible/09_Future_Roadmap.md)
---

# WACRM Engineering Bible - UI Design System & SOP

*Version: v1.0*

## 1. Aesthetic Identity
WACRM positions itself as a premium, modern SaaS. The visual identity relies on:
- **Dark Mode First:** Deep, sophisticated dark backgrounds (zinc/slate scale) by default, providing high contrast for vibrant accent colors.
- **Glassmorphism:** Subtle blurs and translucent background layers (`bg-background/80 backdrop-blur-sm`) on sticky headers and modals.
- **Micro-interactions:** Interactive elements must have clear, smooth hover states (`hover:bg-muted transition-colors`).
- **High Contrast Actions:** Primary actions (like "Punch In" or "Approve Expense") must use solid, vibrant backgrounds (`bg-primary`, `bg-green-600`) with white text. Never use outlined or low-contrast buttons for critical actions.

## 2. Web Component Library (`src/components/ui`)
We utilize Shadcn UI, which provides accessible, unstyled Radix UI primitives wrapped in Tailwind CSS. 
*Rule: Never build a raw `<button class="...">` or `<input>`. Always import from `@/components/ui`.*

### Core Primitives
- **Button:** `<Button variant="default | outline | ghost | destructive" size="sm | default | lg">`
- **Dialog (Modals):** Used for creating new records (e.g., "New Contact"). Contains `DialogHeader`, `DialogTitle`, and `DialogContent`.
- **Sheet (Drawers):** Used for complex filtering menus or deep-dive details that slide in from the right.
- **Table:** The standard data grid. Includes `<TableHeader>`, `<TableRow>`, `<TableCell>`.
- **Form:** Integrates tightly with `react-hook-form` and `zod` for automatic validation rendering.

## 3. Mobile Component Design (`wacrm-mobile`)
Mobile UI does not use Tailwind. It uses React Native `StyleSheet`.

### Mobile Rules
- **Safe Area:** Always wrap root screens in `<SafeAreaView>` to prevent UI from hiding behind notches or bottom swipe bars.
- **Keyboard Avoidance:** Any screen with text inputs must use `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>` to prevent the keyboard from obscuring the input.
- **Offline States:** Always provide visual feedback if a list is empty or failing to load due to network drops (`ActivityIndicator`).
- **Touch Targets:** Minimum height of 48px for all clickable elements to comply with mobile accessibility standards.

## 4. Engineering SOP for New Features

When a PM requests a new feature, engineers must follow this flow:
1. **Database First:** Write the `supabase/migrations/XXX_feature.sql` file. Define the table, `account_id`, and RLS policies.
2. **Types:** Run the Supabase CLI to generate the updated TypeScript types.
3. **API / Actions:** Write the Next.js Server Action or API Route.
4. **UI Assembly:** Build the View (List/Table) and the Form (Create/Edit) using standard components.
5. **Mobile Gap Check:** Determine if this feature needs to be replicated on the mobile app. (e.g., "Settings" = Web only. "Expense upload" = Mobile required).
