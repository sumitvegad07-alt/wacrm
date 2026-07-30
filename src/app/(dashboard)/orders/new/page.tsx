"use client";

import { OrderForm } from "@/components/orders/order-form";
import { useRouter } from "next/navigation";

export default function NewOrderPage() {
  const router = useRouter();

  return (
    <OrderForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push("/orders");
      }}
      onSaved={() => {
        router.push("/orders");
      }}
      asPage={true}
    />
  );
}
