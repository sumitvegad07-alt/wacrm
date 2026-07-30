"use client";

import { ExpenseForm } from "@/components/expenses/expense-form";
import { useRouter } from "next/navigation";

export default function NewExpensePage() {
  const router = useRouter();

  return (
    <ExpenseForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/expenses");
      }}
      onSaved={() => {
        router.push("/expenses");
      }}
      asPage={true}
    />
  );
}
