import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { expenseReportConfig } from "@/lib/reports/expenseReportConfig";

export const metadata = {
  title: "Expense Reports | WACRM",
};

export default function ExpenseReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={expenseReportConfig} />
    </ReportPageLayout>
  );
}
