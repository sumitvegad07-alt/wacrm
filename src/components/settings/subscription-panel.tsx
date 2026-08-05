'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { SettingsPanelHead } from './settings-panel-head';

interface SubscriptionData {
  customerId: string;
  startDate: string;
  expiryDate: string;
  customerCreated: number;
  staffCreated: number;
}

export function SubscriptionPanel() {
  const { accountId } = useAuth();
  const supabase = createClient();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!accountId) return;
      try {
        const [acctRes, profilesRes, contactsRes] = await Promise.all([
          supabase.from('accounts').select('created_at, customer_id, subscription_expires_at').eq('id', accountId).single(),
          supabase.from('profiles').select('id', { count: 'exact' }).eq('account_id', accountId),
          supabase.from('contacts').select('id', { count: 'exact' }).eq('account_id', accountId),
        ]);

        const createdAt = acctRes.data?.created_at ? new Date(acctRes.data.created_at) : new Date();
        const expiryDate = acctRes.data?.subscription_expires_at 
          ? new Date(acctRes.data.subscription_expires_at) 
          : new Date(createdAt);
        
        if (!acctRes.data?.subscription_expires_at) {
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        }

        setData({
          customerId: acctRes.data?.customer_id || '-',
          startDate: createdAt.toLocaleDateString('en-GB').replace(/\//g, '-'),
          expiryDate: expiryDate.toLocaleDateString('en-GB').replace(/\//g, '-'),
          staffCreated: profilesRes.count || 0,
          customerCreated: contactsRes.count || 0,
        });
      } catch (err) {
        console.error('Failed to load subscription data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [accountId, supabase]);

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <section className="w-full animate-in fade-in-50 duration-200">
      <SettingsPanelHead title="Subscription" />
      
      <div className="mt-6 space-y-6 w-full">
        <div className="bg-muted/30 border border-border p-6 rounded-md text-center">
          <p className="text-sm font-semibold uppercase text-muted-foreground tracking-wide">
            Your Unique Customer ID Is
          </p>
          <p className="text-2xl font-bold text-success mt-1">{data.customerId}</p>
        </div>

        <div>
          <h3 className="text-sm font-medium text-foreground border-b border-border pb-2 mb-4">
            Subscription Duration
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
            <div className="bg-muted/30 border border-border p-4 rounded-md">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Start Date</p>
              <p className="text-lg font-bold text-success mt-1">{data.startDate}</p>
            </div>
            <div className="bg-muted/30 border border-border p-4 rounded-md">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Latest Renewal Date</p>
              <p className="text-lg font-bold text-primary mt-1">-</p>
            </div>
            <div className="bg-muted/30 border border-border p-4 rounded-md">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Expiry Date</p>
              <p className="text-lg font-bold text-danger mt-1">{data.expiryDate}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-foreground border-b border-border pb-2 mb-4">
            User Limit Detail
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
            <div className="bg-muted/30 border border-border p-4 rounded-md">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Customer</p>
              <p className="text-[10px] text-muted-foreground mb-1">( Created / Limit )</p>
              <p className="text-xl font-bold">
                <span className="text-success">{data.customerCreated}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-danger">50</span>
              </p>
            </div>
            <div className="bg-muted/30 border border-border p-4 rounded-md">
              <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">Staff User</p>
              <p className="text-[10px] text-muted-foreground mb-1">( Created / Limit )</p>
              <p className="text-xl font-bold">
                <span className="text-success">{data.staffCreated}</span>
                <span className="text-muted-foreground mx-1">/</span>
                <span className="text-danger">20</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
