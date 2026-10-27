import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { dsrReportConfig } from "@/lib/reports/dsrReportConfig";

export const metadata = {
  title: "DSR | WACRM",
};

export default function DsrReportPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={dsrReportConfig} />
    </ReportPageLayout>
  );
}
