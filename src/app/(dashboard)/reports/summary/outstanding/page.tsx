import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { outstandingReportConfig } from "@/lib/reports/outstandingReportConfig";

export const metadata = {
  title: "Customer Outstanding | WACRM",
};

export default function CustomerOutstandingReportPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={outstandingReportConfig} />
    </ReportPageLayout>
  );
}
