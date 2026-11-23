import { ReportViewer } from "@/components/reports/report-viewer";
import { ReportPageLayout } from "@/components/shared";
import { taskReportConfig } from "@/lib/reports/taskReportConfig";

export const metadata = {
  title: "Task Reports",
};

export default function TaskReportsPage() {
  return (
    <ReportPageLayout>
      <ReportViewer config={taskReportConfig} />
    </ReportPageLayout>
  );
}
