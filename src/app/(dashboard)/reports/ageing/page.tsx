import { ReportViewer } from "@/components/reports/report-viewer";
import { ageingReportConfig } from "@/lib/reports/ageingReportConfig";

export const metadata = {
  title: "Ageing Reports | WACRM",
};

export default function AgeingReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={ageingReportConfig} />
    </div>
  );
}
