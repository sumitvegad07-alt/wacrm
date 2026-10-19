import { ReportViewer } from "@/components/reports/report-viewer";
import { outstandingReportConfig } from "@/lib/reports/outstandingReportConfig";

export const metadata = {
  title: "Customer Outstanding | WACRM",
};

export default function CustomerOutstandingReportPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={outstandingReportConfig} />
    </div>
  );
}
