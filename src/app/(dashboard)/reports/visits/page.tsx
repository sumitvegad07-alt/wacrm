import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { visitReportConfig } from "@/lib/reports/visitReportConfig";

export const metadata = {
  title: "Visit Reports | WACRM",
};

export default function VisitReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={visitReportConfig} />
    </ReportPageLayout>
  );
}
