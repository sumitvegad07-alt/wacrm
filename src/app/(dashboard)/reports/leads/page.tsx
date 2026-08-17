import { ReportViewer } from "@/components/reports/report-viewer";
import { leadReportConfig } from "@/lib/reports/leadReportConfig";

export const metadata = {
  title: "Lead Reports | WACRM",
};

export default function LeadReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={leadReportConfig} />
    </div>
  );
}
