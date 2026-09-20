'use client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export function BackToGettingStarted() {
  const params = useSearchParams();
  if (params.get('from') !== 'getting-started') return null;
  const step = params.get('step');
  return (
    <Link href={`/getting-started${step ? `?step=${step}` : ''}`}
      className="mb-3 inline-flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-sm text-primary shadow-sm">
      <ArrowLeft className="h-4 w-4" /> Back to Getting Started
    </Link>
  );
}
