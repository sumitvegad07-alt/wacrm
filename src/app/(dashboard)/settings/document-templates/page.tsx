import { redirect } from "next/navigation";

// Document templates are managed from the Settings "Document" tab; the bare
// /settings/document-templates path has no index page. Redirect instead of 404-ing.
export default function SettingsDocumentTemplatesIndexPage() {
  redirect("/settings?tab=document");
}
