import { ReportViewer } from "@/components/reports/report-viewer";
import { quotationReportConfig } from "@/lib/reports/quotationReportConfig";

export const metadata = {
  title: "Quotation Reports | WACRM",
};

export default function QuotationReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={quotationReportConfig} />
    </div>
  );
}
