import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { productSummaryReportConfig } from "@/lib/reports/productSummaryReportConfig";

export const metadata = {
  title: "Product Summary | WACRM",
};

export default function ProductSummaryReportPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={productSummaryReportConfig} />
    </ReportPageLayout>
  );
}
