'use client';

import { Badge } from '@/components/ui/badge';
import { getStatusColor } from '@/lib/payments/statuses';

interface PaymentStatusBadgeProps {
  status: string;
  className?: string;
}

export function PaymentStatusBadge({ status, className = '' }: PaymentStatusBadgeProps) {
  const colorClass = getStatusColor(status);
  
  return (
    <Badge variant="outline" className={`capitalize text-xs px-2.5 py-1 ${colorClass} ${className}`}>
      {status}
    </Badge>
  );
}
