"use client";

import { useState, useEffect, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DataTable } from "@/components/ui/data-table/data-table";
import { ColumnDef } from "@/components/ui/data-table/data-table-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, WalletCards, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/currency";
import { Badge } from "@/components/ui/badge";
import { ReportViewer } from "@/components/reports/report-viewer";
import { paymentReportConfig } from "@/lib/reports/paymentReportConfig";

export default function PaymentReportPage() {
  const router = useRouter();
  const { accountId, hasPermission, defaultCurrency } = useAuth();
  const supabase = createClient();
  
  // Tab 2: Customer Financials Data
  const [financialsData, setFinancialsData] = useState<any[]>([]);
  const [isLoadingFinancials, setIsLoadingFinancials] = useState(true);

  useEffect(() => {
    if (accountId && hasPermission("view_payment_reports")) {
      fetchFinancials();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const fetchFinancials = async () => {
    setIsLoadingFinancials(true);
    // Fetch contacts, their approved orders, and their approved payments
    const [contactsRes, ordersRes, paymentsRes] = await Promise.all([
      supabase.from("contacts").select("id, company, name, credit_limit, credit_days, opening_balance").eq("account_id", accountId),
      supabase.from("orders").select("contact_id, total_amount, created_at").eq("account_id", accountId).eq("status", "Closed"),
      supabase.from("payments").select("contact_id, amount, verified_amount").eq("account_id", accountId).eq("status", "Approved")
    ]);

    if (!contactsRes.error && contactsRes.data) {
      const orders = ordersRes.data || [];
      const payments = paymentsRes.data || [];

      // Group by contact
      const ordersByContact = orders.reduce((acc: any, o: any) => {
        if (!acc[o.contact_id]) acc[o.contact_id] = [];
        acc[o.contact_id].push(o);
        return acc;
      }, {});

      const paymentsByContact = payments.reduce((acc: any, p: any) => {
        if (!acc[p.contact_id]) acc[p.contact_id] = [];
        acc[p.contact_id].push(p);
        return acc;
      }, {});

      const computed = contactsRes.data.map(contact => {
        const contactOrders = ordersByContact[contact.id] || [];
        const contactPayments = paymentsByContact[contact.id] || [];

        const totalOrders = contactOrders.reduce((sum: number, o: any) => sum + o.total_amount, 0);
        const totalPaid = contactPayments.reduce((sum: number, p: any) => sum + (p.verified_amount ?? p.amount), 0);
        const opening = contact.opening_balance || 0;
        
        const outstanding = totalOrders - totalPaid + opening;
        const available = contact.credit_limit ? contact.credit_limit - outstanding : null;

        let isOverdue = false;
        let maxOverdueDays = 0;

        if (contact.credit_days) {
          let paidAmount = totalPaid;
          let currentOutstanding = opening;
          
          if (paidAmount >= currentOutstanding) {
            paidAmount -= currentOutstanding;
          } else {
            paidAmount = 0;
          }
          
          // Sort orders oldest first to apply payments
          const sortedOrders = [...contactOrders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
          
          for (const o of sortedOrders) {
            if (paidAmount >= o.total_amount) {
              paidAmount -= o.total_amount;
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

        return {
          ...contact,
          customer_name: contact.company || contact.name || "Unnamed",
          total_orders: totalOrders,
          total_paid: totalPaid,
          outstanding_amount: outstanding,
          available_credit: available,
          is_overdue: isOverdue,
          overdue_days: maxOverdueDays,
        };
      });

      // Filter out those with 0 outstanding and 0 limits to keep the report clean
      const relevant = computed.filter(c => c.outstanding_amount > 0 || c.credit_limit > 0 || c.is_overdue);
      setFinancialsData(relevant);
    }
    setIsLoadingFinancials(false);
  };

  const currencyCode = defaultCurrency || "USD";

  // Tab 2 Columns
  const financialColumns: ColumnDef<any>[] = [
    { id: "customer", label: "Customer", type: "text", render: (r: any) => <span className="font-medium">{r.customer_name}</span> },
    { id: "credit_limit", label: "Credit Limit", type: "text", render: (r: any) => <span>{r.credit_limit ? formatCurrency(r.credit_limit, currencyCode) : "-"}</span> },
    { id: "credit_days", label: "Credit Days", type: "text", render: (r: any) => <span>{r.credit_days ? `${r.credit_days} days` : "-"}</span> },
    { id: "outstanding_amount", label: "Outstanding", type: "text", render: (r: any) => (
      <span className={`font-medium ${r.outstanding_amount > 0 ? "text-amber-600 dark:text-amber-500" : ""}`}>
        {formatCurrency(r.outstanding_amount, currencyCode)}
      </span>
    )},
    { id: "available_credit", label: "Available Credit", type: "text", render: (r: any) => <span>{r.available_credit != null ? formatCurrency(r.available_credit, currencyCode) : "-"}</span> },
    { id: "overdue", label: "Overdue Status", type: "text", render: (r: any) => {
        if (!r.is_overdue) return <Badge variant="outline" className="bg-green-100 text-green-800">Good Standing</Badge>;
        return <Badge variant="outline" className="bg-red-100 text-red-800">Overdue ({r.overdue_days} days)</Badge>;
    }},
  ];

  if (!hasPermission("view_payment_reports")) {
    return <div className="p-8">You do not have permission to view payment reports.</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-4 p-8">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Payment Reports</h1>
      </div>

      <Tabs defaultValue="collections" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="collections" className="gap-2">
            <WalletCards className="h-4 w-4" />
            Collections
          </TabsTrigger>
          <TabsTrigger value="financials" className="gap-2">
            <Users className="h-4 w-4" />
            Customer Financials
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Collections */}
        <TabsContent value="collections" className="space-y-4">
          <ReportViewer config={paymentReportConfig} />
        </TabsContent>

        {/* Tab 2: Customer Financials */}
        <TabsContent value="financials">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-medium">Customer Credit & Overdue Summary</h3>
              </div>
              <DataTable
                columns={financialColumns}
                data={financialsData}
                storageKey="financial-report-table"
                isLoading={isLoadingFinancials}
                rowKey={(r) => r.id}
              />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
