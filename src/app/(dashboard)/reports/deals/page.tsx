import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { dealReportConfig } from "@/lib/reports/dealReportConfig";

export const metadata = {
  title: "Deal Reports | WACRM",
};

export default function DealReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={dealReportConfig} />
    </ReportPageLayout>
  );
}
