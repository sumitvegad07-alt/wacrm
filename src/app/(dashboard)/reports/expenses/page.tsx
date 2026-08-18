import { ReportViewer } from "@/components/reports/report-viewer";
import { expenseReportConfig } from "@/lib/reports/expenseReportConfig";

export const metadata = {
  title: "Expense Reports | WACRM",
};

export default function ExpenseReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={expenseReportConfig} />
    </div>
  );
}
