import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { leadReportConfig } from "@/lib/reports/leadReportConfig";

export const metadata = {
  title: "Lead Reports | WACRM",
};

export default function LeadReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={leadReportConfig} />
    </ReportPageLayout>
  );
}
