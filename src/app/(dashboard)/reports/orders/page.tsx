import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { orderReportConfig } from "@/lib/reports/orderReportConfig";

export const metadata = {
  title: "Order Reports | WACRM",
};

export default function OrderReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={orderReportConfig} />
    </ReportPageLayout>
  );
}
