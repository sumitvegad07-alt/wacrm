"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TRIGGER = "data-active:bg-muted data-active:text-primary text-muted-foreground";

export interface AssetDetailTabsProps {
  /** Each panel is rendered on the server and handed in, so this file holds only the tab state. */
  details: ReactNode;
  timeline: ReactNode;
  jobs: ReactNode;
}

/** Details / Timeline / Service Jobs. The only client state on the detail page besides the actions. */
export function AssetDetailTabs({ details, timeline, jobs }: AssetDetailTabsProps) {
  return (
    <Tabs defaultValue="details" className="w-full gap-4">
      <TabsList className="bg-muted/50">
        <TabsTrigger value="details" className={TRIGGER}>
          Details
        </TabsTrigger>
        <TabsTrigger value="timeline" className={TRIGGER}>
          Timeline
        </TabsTrigger>
        <TabsTrigger value="jobs" className={TRIGGER}>
          Service Jobs
        </TabsTrigger>
      </TabsList>
      <TabsContent value="details">{details}</TabsContent>
      <TabsContent value="timeline">{timeline}</TabsContent>
      <TabsContent value="jobs">{jobs}</TabsContent>
    </Tabs>
  );
}
