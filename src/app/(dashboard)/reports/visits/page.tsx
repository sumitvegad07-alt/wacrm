import { ReportViewer } from "@/components/reports/report-viewer";
import { visitReportConfig } from "@/lib/reports/visitReportConfig";

export const metadata = {
  title: "Visit Reports | WACRM",
};

export default function VisitReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={visitReportConfig} />
    </div>
  );
}
