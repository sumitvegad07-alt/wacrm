import { ReportViewer } from "@/components/reports/report-viewer";
import { salesReportConfig } from "@/lib/reports/salesReportConfig";

export const metadata = {
  title: "Sales Reports | WACRM",
};

export default function SalesReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={salesReportConfig} />
    </div>
  );
}
