import { ReportViewer } from "@/components/reports/report-viewer";
import { dsrReportConfig } from "@/lib/reports/dsrReportConfig";

export const metadata = {
  title: "DSR | WACRM",
};

export default function DsrReportPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={dsrReportConfig} />
    </div>
  );
}
