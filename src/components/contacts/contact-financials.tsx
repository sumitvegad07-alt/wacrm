'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { formatCurrency } from '@/lib/currency';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';
import { Contact } from '@/types';

interface ContactFinancialsProps {
  contact: Contact;
}

export function ContactFinancials({ contact }: ContactFinancialsProps) {
  const { defaultCurrency } = useAuth();
  const [loading, setLoading] = useState(true);
  
  const [financials, setFinancials] = useState({
    outstanding: 0,
    availableCredit: 0 as number | null,
    overdueDays: 0,
    isOverdue: false,
    totalClosedOrders: 0,
    totalApprovedPayments: 0,
  });

  useEffect(() => {
    if (!contact?.id) return;

    async function fetchFinancials() {
      setLoading(true);
      const supabase = createClient();
      
      const [ordersRes, paymentsRes] = await Promise.all([
        supabase.from('orders').select('total_amount, created_at').eq('contact_id', contact.id).eq('status', 'Closed'),
        supabase.from('payments').select('amount, verified_amount').eq('contact_id', contact.id).eq('status', 'Approved'),
      ]);

      const orders = ordersRes.data || [];
      const payments = paymentsRes.data || [];

      const totalClosedOrders = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
      const totalApprovedPayments = payments.reduce((sum, p) => sum + Number(p.verified_amount ?? p.amount ?? 0), 0);
      const opening = Number(contact.opening_balance || 0);

      const outstanding = totalClosedOrders - totalApprovedPayments + opening;
      const availableCredit = contact.credit_limit ? Number(contact.credit_limit) - outstanding : null;

      let isOverdue = false;
      let maxOverdueDays = 0;

      if (contact.credit_days) {
        let paidAmount = totalApprovedPayments;
        let currentOutstanding = opening;
        
        if (paidAmount >= currentOutstanding) {
          paidAmount -= currentOutstanding;
        } else {
          paidAmount = 0;
        }
        
        const sortedOrders = [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        
        for (const o of sortedOrders) {
          const amt = Number(o.total_amount || 0);
          if (paidAmount >= amt) {
            paidAmount -= amt;
          } else {
            paidAmount = 0;
            const daysOld = Math.floor((new Date().getTime() - new Date(o.created_at).getTime()) / (1000 * 3600 * 24));
            if (daysOld > contact.credit_days) {
              isOverdue = true;
              maxOverdueDays = Math.max(maxOverdueDays, daysOld - contact.credit_days);
            }
          }
        }
      }

      setFinancials({
        outstanding,
        availableCredit,
        overdueDays: maxOverdueDays,
        isOverdue,
        totalClosedOrders,
        totalApprovedPayments,
      });
      setLoading(false);
    }

    fetchFinancials();
  }, [contact]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currencyCode = defaultCurrency || 'USD';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-medium text-muted-foreground">Outstanding Balance</span>
            <span className="text-2xl font-bold mt-1">
              {formatCurrency(financials.outstanding, currencyCode)}
            </span>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-medium text-muted-foreground">Overdue Status</span>
            <div className="mt-2">
              {financials.isOverdue ? (
                <Badge variant="outline" className="bg-red-100 text-red-800 border-red-200 px-3 py-1 text-sm">
                  Overdue ({financials.overdueDays} days)
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 px-3 py-1 text-sm">
                  Good Standing
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Credit Limit</span>
            <div className="text-lg font-semibold mt-1">
              {contact.credit_limit ? formatCurrency(contact.credit_limit, currencyCode) : '-'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Available Credit</span>
            <div className="text-lg font-semibold mt-1">
              {financials.availableCredit !== null ? formatCurrency(financials.availableCredit, currencyCode) : '-'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Closed Orders</span>
            <div className="text-lg font-semibold mt-1">
              {formatCurrency(financials.totalClosedOrders, currencyCode)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Total Approved Payments</span>
            <div className="text-lg font-semibold mt-1 text-green-600">
              {formatCurrency(financials.totalApprovedPayments, currencyCode)}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
