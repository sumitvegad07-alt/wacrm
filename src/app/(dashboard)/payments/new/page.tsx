'use client';

import { PaymentForm } from '@/components/payments/payment-form';
import { useRouter } from "@/lib/navigation";
export default function NewPaymentPage() {
  const router = useRouter();

  return (
    <PaymentForm
      open={true}
      onOpenChange={(open) => {
        if (!open) router.push('/payments');
      }}
      onSaved={() => {
        router.push('/payments');
      }}
      asPage={true}
    />
  );
}
