'use client';

import { useSearchParams } from 'next/navigation';
import { DispatchForm } from '@/components/dispatches/dispatch-form';

export default function NewDispatchPage() {
  const params = useSearchParams();
  const orderId = params.get('orderId') || undefined;
  return <DispatchForm prefillOrderId={orderId} />;
}
