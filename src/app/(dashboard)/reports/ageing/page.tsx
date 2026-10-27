import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { ageingReportConfig } from "@/lib/reports/ageingReportConfig";

export const metadata = {
  title: "Ageing Reports | WACRM",
};

export default function AgeingReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={ageingReportConfig} />
    </ReportPageLayout>
  );
}
