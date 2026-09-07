import { redirect } from "next/navigation";

// Team is split into /team/roles and /team/employees; there is no bare index.
// Redirect /team to the roles screen instead of 404-ing.
export default function TeamIndexPage() {
  redirect("/team/roles");
}
