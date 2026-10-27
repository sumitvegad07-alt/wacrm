import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { salesReportConfig } from "@/lib/reports/salesReportConfig";

export const metadata = {
  title: "Sales Reports | WACRM",
};

export default function SalesReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={salesReportConfig} />
    </ReportPageLayout>
  );
}
