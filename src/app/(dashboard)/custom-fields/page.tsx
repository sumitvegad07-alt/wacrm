import { redirect } from "next/navigation";

// Custom fields are configured per module at /custom-fields/<module>; there is no
// bare index. Redirect /custom-fields to the first module instead of 404-ing.
export default function CustomFieldsIndexPage() {
  redirect("/custom-fields/contact");
}
