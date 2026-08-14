"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { computeCustomerFinancials } from "@/lib/payments/financials";
import { AlertTriangle, CheckCircle2, XCircle, CreditCard } from "lucide-react";


interface CustomerFinancialCardProps {
  contactId: string;
  accountId: string;
  canViewCreditLimit?: boolean;
  canViewOpeningBalance?: boolean;
  onDataLoaded?: (data: FinancialData | null) => void;
}

export interface FinancialData {
  totalOrders: number;
  approvedPayments: number;
  openingBalance: number;
  outstandingBalance: number;
  creditLimit: number | null;
  availableCredit: number | null;
  creditDays: number | null;
  isOverdue: boolean;
  overdueDays: number;
  paymentsEnabled: boolean;
}

export function CustomerFinancialCard({ contactId, accountId, canViewCreditLimit = false, canViewOpeningBalance = false, onDataLoaded }: CustomerFinancialCardProps) {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const { defaultCurrency } = useAuth();

  useEffect(() => {
    async function fetchData() {
      const db = createClient();
      
      const { data: account } = await db.from('accounts').select('settings').eq('id', accountId).single();
      const settings = account?.settings || {};
      const paymentsEnabled = settings.payments?.enabled !== false; 
      
      if (!paymentsEnabled) {
        const d = { paymentsEnabled: false } as FinancialData;
        setData(d);
        if (onDataLoaded) onDataLoaded(d);
        setLoading(false);
        return;
      }
      
      const [contactRes, ordersRes, paymentsRes, timeRes] = await Promise.all([
        db.from('contacts').select('credit_limit, credit_days, opening_balance').eq('id', contactId).single(),
        db.from('orders').select('total_amount, created_at').eq('contact_id', contactId).eq('status', 'Closed').order('created_at', { ascending: true }),
        db.from('payments').select('amount, verified_amount').eq('contact_id', contactId).eq('status', 'Approved'),
        db.rpc('get_server_time')
      ]);
      
      const contact = contactRes.data;
      if (!contact) {
        setLoading(false);
        return;
      }
      
      const serverTime = timeRes.data ? new Date(timeRes.data as string).getTime() : new Date().getTime();

      const computed = computeCustomerFinancials({
        openingBalance: contact.opening_balance,
        creditLimit: contact.credit_limit,
        creditDays: contact.credit_days,
        orders: ordersRes.data || [],
        payments: paymentsRes.data || [],
        now: serverTime,
      });

      const finalData = { ...computed, paymentsEnabled: true };
      
      setData(finalData);
      if (onDataLoaded) onDataLoaded(finalData);
      setLoading(false);
    }
    
    fetchData();
  }, [contactId, accountId]);

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="h-6 w-20 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data || !data.paymentsEnabled) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <CreditCard className="size-5" />
          Financial Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FinancialSnapshot 
          data={data} 
          currency={defaultCurrency} 
          canViewCreditLimit={canViewCreditLimit}
          canViewOpeningBalance={canViewOpeningBalance}
        />
      </CardContent>
    </Card>
  );
}

export function FinancialSnapshot({ 
  data, 
  currency,
  canViewCreditLimit = false,
  canViewOpeningBalance = false
}: { 
  data: FinancialData;
  currency: string;
  canViewCreditLimit?: boolean;
  canViewOpeningBalance?: boolean;
}) {
  const isWarning = data.creditLimit && data.availableCredit !== null && data.availableCredit < (data.creditLimit * 0.2);
  const isExceeded = data.creditLimit && data.availableCredit !== null && data.availableCredit < 0;
  
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Outstanding Balance</p>
        <p className="text-2xl font-bold">{formatCurrency(data.outstandingBalance, currency)}</p>
      </div>
      
      {canViewCreditLimit && data.creditLimit !== null && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Available Credit</p>
          <div className="flex items-center gap-2">
            <p className={`text-2xl font-bold ${isExceeded ? 'text-red-600' : isWarning ? 'text-amber-500' : 'text-emerald-600'}`}>
              {formatCurrency(data.availableCredit || 0, currency)}
            </p>
            {isExceeded ? (
              <XCircle className="size-4 text-red-600" />
            ) : isWarning ? (
              <AlertTriangle className="size-4 text-amber-500" />
            ) : (
              <CheckCircle2 className="size-4 text-emerald-600" />
            )}
          </div>
          <p className="text-xs text-muted-foreground">Limit: {formatCurrency(data.creditLimit, currency)}</p>
        </div>
      )}
      
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Payment Status</p>
        {data.isOverdue ? (
          <div>
            <p className="text-lg font-bold text-red-600 flex items-center gap-1">
              <AlertTriangle className="size-4" />
              Overdue
            </p>
            <p className="text-xs text-red-600 font-medium">By {data.overdueDays} days (Terms: {data.creditDays} days)</p>
          </div>
        ) : (
          <div>
            <p className="text-lg font-bold text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="size-4" />
              Healthy
            </p>
            {data.creditDays && <p className="text-xs text-muted-foreground">Terms: {data.creditDays} days</p>}
          </div>
        )}
      </div>
      
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Total Closed Orders</p>
        <p className="text-xl font-semibold">{formatCurrency(data.totalOrders, currency)}</p>
        <p className="text-xs text-muted-foreground">Paid: {formatCurrency(data.approvedPayments, currency)}</p>
      </div>
    </div>
  );
}

