"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MetricCard } from "./metric-card";
import { SkeletonCard } from "./skeleton";
import { DollarSign, AlertCircle, Clock, PieChart, BarChart } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  fetchTodaysCollection,
  fetchMonthlyCollection,
  fetchCollectionByPaymentType,
  fetchCollectionByUser,
  fetchTotalOutstanding,
  fetchPendingApprovalAging,
  fetchOverdueCustomers,
  fetchCreditExceededCustomers,
} from "@/lib/dashboard/payment-queries";

export function TodaysCollectionWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<number | null>(null);
  
  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchTodaysCollection(db, accountId).then(setData);
  }, [accountId]);

  if (data === null) return <SkeletonCard />;

  return (
    <MetricCard
      title="Today's Collection"
      value={formatCurrency(data, defaultCurrency)}
      icon={DollarSign}
    />
  );
}

export function MonthlyCollectionWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<{current: number, previous: number} | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchMonthlyCollection(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <SkeletonCard />;

  const diff = data.current - data.previous;
  const percent = data.previous ? (diff / data.previous) * 100 : 0;
  const label = `${diff >= 0 ? '+' : ''}${formatCurrency(diff, defaultCurrency)} (${percent.toFixed(1)}%) vs last month`;

  return (
    <MetricCard
      title="Monthly Collection"
      value={formatCurrency(data.current, defaultCurrency)}
      icon={DollarSign}
      delta={{ sign: diff, label }}
    />
  );
}

export function OutstandingAmountWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<number | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchTotalOutstanding(db, accountId).then(setData);
  }, [accountId]);

  if (data === null) return <SkeletonCard />;

  return (
    <MetricCard
      title="Total Outstanding"
      value={formatCurrency(data, defaultCurrency)}
      icon={AlertCircle}
      className={data > 100000 ? "border-red-500/20" : ""}
    />
  );
}

export function CollectionByTypeWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<{name: string, amount: number}[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchCollectionByPaymentType(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <Card className="h-[300px] animate-pulse bg-muted/20" />;

  const total = data.reduce((sum, item) => sum + item.amount, 0);

  return (
    <Card className="flex flex-col h-[300px]">
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <PieChart className="size-4" />
          Collection by Type
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
        {data.length === 0 ? (
           <p className="text-sm text-muted-foreground text-center my-auto">No data</p>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-4">
              {data.map((item, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{item.name}</span>
                    <span className="font-medium">{formatCurrency(item.amount, defaultCurrency)}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary" 
                      style={{ width: `${total ? (item.amount / total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function CollectionByUserWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<{name: string, amount: number}[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchCollectionByUser(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <Card className="h-[300px] animate-pulse bg-muted/20" />;

  const max = Math.max(...data.map(d => d.amount), 0);

  return (
    <Card className="flex flex-col h-[300px]">
      <CardHeader>
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart className="size-4" />
          Collection by User
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
        {data.length === 0 ? (
           <p className="text-sm text-muted-foreground text-center my-auto">No data</p>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-4">
              {data.map((item, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{item.name}</span>
                    <span className="font-medium">{formatCurrency(item.amount, defaultCurrency)}</span>
                  </div>
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500" 
                      style={{ width: `${max ? (item.amount / max) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function PendingApprovalAgingWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<{count: number, payments: any[]} | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchPendingApprovalAging(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <Card className="h-[300px] animate-pulse bg-muted/20" />;

  return (
    <Card className="flex flex-col h-[300px] border-amber-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-500" />
            Stale Pending Approvals
          </div>
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-200">
            {data.count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {data.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-8">No stale pending payments</p>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-3">
              {data.payments.map((p, i) => (
                <div key={i} className="flex justify-between items-center text-sm p-2 rounded-md bg-secondary/50">
                  <div>
                    <p className="font-medium">{p.customer}</p>
                    <p className="text-xs text-muted-foreground">{p.payment_number} • {p.days_pending} days old</p>
                  </div>
                  <div className="font-medium text-amber-600">
                    {formatCurrency(p.amount, defaultCurrency)}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function OverdueCustomersWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<any[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchOverdueCustomers(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <Card className="h-[300px] animate-pulse bg-muted/20" />;

  return (
    <Card className="flex flex-col h-[300px] border-red-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-red-500" />
            Overdue Customers
          </div>
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-200">
            {data.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-8">No overdue customers</p>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-3">
              {data.map((c, i) => (
                <div key={i} className="flex justify-between items-center text-sm p-2 rounded-md bg-secondary/50">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-red-500 font-medium">Overdue by {c.days_overdue} days</p>
                  </div>
                  <div className="font-medium">
                    {formatCurrency(c.outstanding, defaultCurrency)}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export function CreditExceededWidget() {
  const { accountId, defaultCurrency } = useAuth();
  const [data, setData] = useState<any[] | null>(null);

  useEffect(() => {
    if (!accountId) return;
    const db = createClient();
    fetchCreditExceededCustomers(db, accountId).then(setData);
  }, [accountId]);

  if (!data) return <Card className="h-[300px] animate-pulse bg-muted/20" />;

  return (
    <Card className="flex flex-col h-[300px] border-orange-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4 text-orange-500" />
            Credit Limit Exceeded
          </div>
          <Badge variant="outline" className="bg-orange-500/10 text-orange-600 border-orange-200">
            {data.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center mt-8">No customers over limit</p>
        ) : (
          <ScrollArea className="h-full pr-4">
            <div className="space-y-3">
              {data.map((c, i) => (
                <div key={i} className="flex flex-col gap-1 text-sm p-2 rounded-md bg-secondary/50">
                  <div className="flex justify-between">
                    <span className="font-medium">{c.name}</span>
                    <span className="font-medium text-orange-600">{formatCurrency(c.outstanding, defaultCurrency)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Limit: {formatCurrency(c.credit_limit, defaultCurrency)}</span>
                    <span>Exceeded: {formatCurrency(Math.abs(c.available_credit), defaultCurrency)}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
