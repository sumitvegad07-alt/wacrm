"use client"

import { useState } from 'react'
import { FunnelChart, Funnel, LabelList, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import { LayoutList, BarChart2, Filter } from 'lucide-react'

interface JourneyProps {
  data: { name: string; value: number; fill: string }[]
  loading: boolean
}

export function ContactJourneyMatrix({ data, loading }: JourneyProps) {
  const [view, setView] = useState<'funnel' | 'bar' | 'table'>('funnel')

  if (loading) {
    return (
      <Card className="h-[400px]">
        <CardHeader>
          <CardTitle className="text-lg">Lead/Contact Journey Matrix</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-full">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-[400px] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">Lead/Contact Journey Matrix</CardTitle>
        <div className="flex bg-muted rounded-md p-1">
          <Button variant="ghost" size="sm" className={`h-7 px-2 ${view === 'funnel' ? 'bg-background shadow-sm' : ''}`} onClick={() => setView('funnel')}>
            <Filter className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 ${view === 'bar' ? 'bg-background shadow-sm' : ''}`} onClick={() => setView('bar')}>
            <BarChart2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 ${view === 'table' ? 'bg-background shadow-sm' : ''}`} onClick={() => setView('table')}>
            <LayoutList className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No journey data available
          </div>
        ) : view === 'funnel' ? (
          <ResponsiveContainer width="100%" height="100%">
            <FunnelChart>
              <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Funnel dataKey="value" data={data} isAnimationActive>
                <LabelList position="right" fill="currentColor" stroke="none" dataKey="name" className="text-sm font-medium" />
                <LabelList position="center" fill="#fff" stroke="none" dataKey="value" className="text-sm font-bold" />
              </Funnel>
            </FunnelChart>
          </ResponsiveContainer>
        ) : view === 'bar' ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 30, left: 40, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="opacity-10" />
              <XAxis type="number" axisLine={false} tickLine={false} />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <Tooltip cursor={{ fill: 'currentColor', opacity: 0.05 }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={30}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="overflow-auto h-full rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: row.fill }} />
                      {row.name}
                    </TableCell>
                    <TableCell className="text-right">{row.value}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
