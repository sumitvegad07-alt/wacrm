import { ReportViewer } from "@/components/reports/report-viewer";
import { taskReportConfig } from "@/lib/reports/taskReportConfig";

export const metadata = {
  title: "Task Reports | WACRM",
};

export default function TaskReportsPage() {
  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <ReportViewer config={taskReportConfig} />
    </div>
  );
}
