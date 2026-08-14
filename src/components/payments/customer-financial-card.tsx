"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/currency";
import { fetchCustomerFinancials } from "@/lib/payments/financials";
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
      
      // Shared with the payment form so both screens can never disagree about what a
      // customer owes — see fetchCustomerFinancials().
      const computed = await fetchCustomerFinancials(db, contactId);

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
        <p className="text-sm text-muted-foreground">
          {data.outstandingBalance < 0 ? 'Customer Credit' : 'Outstanding Balance'}
        </p>
        <p className="text-2xl font-bold">{formatCurrency(Math.abs(data.outstandingBalance), currency)}</p>
        {data.outstandingBalance < 0 && (
          <p className="text-xs text-muted-foreground">Paid in advance of what is owed</p>
        )}
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
              Within Credit Terms
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

      {/* Without this the card can read "Outstanding 10,000 / Closed Orders 0 / Paid 0",
          three figures that visibly contradict each other. The opening balance is the
          missing term, so finance can reconcile the total on the screen itself. */}
      {canViewOpeningBalance && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Opening Balance</p>
          <p className="text-xl font-semibold">{formatCurrency(data.openingBalance, currency)}</p>
          <p className="text-xs text-muted-foreground">
            Opening + Closed Orders &minus; Paid = {formatCurrency(data.outstandingBalance, currency)}
          </p>
        </div>
      )}
    </div>
  );
}

