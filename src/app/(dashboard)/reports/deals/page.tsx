import { ReportViewer } from "@/components/reports/report-viewer";
import { dealReportConfig } from "@/lib/reports/dealReportConfig";

export const metadata = {
  title: "Deal Reports | WACRM",
};

export default function DealReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={dealReportConfig} />
    </div>
  );
}
