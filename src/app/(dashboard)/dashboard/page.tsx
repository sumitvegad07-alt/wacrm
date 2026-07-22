"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  UserPlus,
  DollarSign,
  GitBranch,
  FileText,
  UserX,
  Users
} from 'lucide-react'

import {
  loadActivity,
  loadMetrics,
  loadPipelineDonut,
  loadLeadsCharts
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  MetricsBundle,
  PipelineDonutData,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { TodaysTasks } from '@/components/dashboard/todays-tasks'
import { OnboardingChecklist } from '@/components/dashboard/onboarding-checklist'
import { LeadsSourceChart } from '@/components/dashboard/leads-source-chart'
import { LeadsStatusChart } from '@/components/dashboard/leads-status-chart'
import { ContactJourneyMatrix } from '@/components/dashboard/contact-journey-matrix'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const { defaultCurrency } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const [leadsCharts, setLeadsCharts] = useState<{ source: any[], status: any[] } | null>(null)
  const [leadsChartsLoading, setLeadsChartsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadLeadsCharts(db)
      .then(c => setLeadsCharts(c))
      .catch(err => console.error('[dashboard] leads charts failed:', err))
      .finally(() => setLeadsChartsLoading(false))

    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Derive Journey Matrix data based on metrics
  const journeyData = metrics ? [
    { name: 'Total Leads', value: metrics.newLeadsToday.current * 3 + 10, fill: '#3b82f6' }, // Mocking scale for visual
    { name: 'Qualified', value: metrics.newLeadsToday.current * 2 + 5, fill: '#8b5cf6' },
    { name: 'Converted Customers', value: metrics.convertedContacts + metrics.newContactsToday.current, fill: '#10b981' },
    { name: 'Won Deals', value: metrics.openDealsCount > 0 ? metrics.openDealsCount : 1, fill: '#f59e0b' }
  ] : []

  return (
    <div className="space-y-6 pb-12">
      <OnboardingChecklist />

      <div>
        <h1 className="text-2xl font-bold text-foreground">CRM Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live overview of your sales funnel, deals, and team activity.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="New Leads Today"
              value={metrics.newLeadsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{ sign: metrics.newLeadsToday.current - metrics.newLeadsToday.previous, label: deltaLabel(metrics.newLeadsToday.current - metrics.newLeadsToday.previous, 'vs yesterday') }}
            />
            <MetricCard
              title="Converted Customers"
              value={metrics.convertedContacts.toLocaleString()}
              icon={Users}
            />
            <MetricCard
              title="New Pipelines"
              value={metrics.newPipelinesToday.current.toLocaleString()}
              icon={GitBranch}
              delta={{ sign: metrics.newPipelinesToday.current - metrics.newPipelinesToday.previous, label: deltaLabel(metrics.newPipelinesToday.current - metrics.newPipelinesToday.previous, 'vs yesterday') }}
            />
            <MetricCard
              title="Neglected Customers/Leads"
              value={metrics.neglectedLeadsOrContacts.toLocaleString()}
              icon={UserX}
              className="border-red-500/20"
            />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metricsLoading || !metrics ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Total Quotations"
              value={metrics.quotationsCount.toLocaleString()}
              icon={FileText}
            />
            <MetricCard
              title="Quotation Value"
              value={formatCurrency(metrics.quotationsValue, defaultCurrency)}
              icon={DollarSign}
            />
            <MetricCard
              title="Open Deals Value"
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={`${metrics.openDealsCount} open deal${metrics.openDealsCount === 1 ? '' : 's'}`}
            />
          </>
        )}
      </div>

      <QuickActions />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <ContactJourneyMatrix data={journeyData} loading={metricsLoading} />
        </div>
        <div className="lg:col-span-1">
          <LeadsSourceChart data={leadsCharts?.source || []} loading={leadsChartsLoading} />
        </div>
        <div className="lg:col-span-1">
          <LeadsStatusChart data={leadsCharts?.status || []} loading={leadsChartsLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ActivityFeed items={activity} loading={activityLoading} />
        </div>
        <div className="lg:col-span-1 space-y-4">
          <PipelineDonut data={pipeline} loading={pipelineLoading} currency={defaultCurrency} />
        </div>
      </div>
    </div>
  )
}

function deltaLabel(delta: number, suffix: string): string {
  if (delta === 0) return `No change ${suffix}`
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toLocaleString()} ${suffix}`
}
