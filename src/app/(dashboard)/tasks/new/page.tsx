"use client";

import { TaskForm } from "@/components/tasks/task-form";
import { useRouter } from "@/lib/navigation";
export default function NewTaskPage() {
  const router = useRouter();

  return (
    <TaskForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/tasks");
      }}
      onSaved={() => {
        router.push("/tasks");
      }}
      asPage={true}
    />
  );
}
