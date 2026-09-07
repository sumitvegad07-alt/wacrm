import { redirect } from "next/navigation";

// The reports live at /reports/<type> (sales, orders, payments, …); there is no
// bare index. Redirect a typed/bookmarked /reports to the default report instead
// of 404-ing.
export default function ReportsIndexPage() {
  redirect("/reports/sales");
}
