import { ReportViewer } from "@/components/reports/report-viewer";
import { productSummaryReportConfig } from "@/lib/reports/productSummaryReportConfig";

export const metadata = {
  title: "Product Summary | WACRM",
};

export default function ProductSummaryReportPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={productSummaryReportConfig} />
    </div>
  );
}
