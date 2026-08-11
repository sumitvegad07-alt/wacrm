import { ReportViewer } from "@/components/reports/report-viewer";
import { orderReportConfig } from "@/lib/reports/orderReportConfig";

export const metadata = {
  title: "Order Reports | WACRM",
};

export default function OrderReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={orderReportConfig} />
    </div>
  );
}
