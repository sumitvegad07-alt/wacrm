'use client';

import { useParams } from 'next/navigation';
import { DispatchForm } from '@/components/dispatches/dispatch-form';

export default function EditDispatchPage() {
  const { id } = useParams() as { id: string };
  return <DispatchForm dispatchId={id} />;
}
