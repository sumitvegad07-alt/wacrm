import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { quotationReportConfig } from "@/lib/reports/quotationReportConfig";

export const metadata = {
  title: "Quotation Reports | WACRM",
};

export default function QuotationReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={quotationReportConfig} />
    </ReportPageLayout>
  );
}
