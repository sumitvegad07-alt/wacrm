import { redirect } from "next/navigation";

// WhatsApp templates are managed from the Settings "Templates" tab; the bare
// /settings/templates path has no index page. Redirect instead of 404-ing.
export default function SettingsTemplatesIndexPage() {
  redirect("/settings?tab=templates");
}
