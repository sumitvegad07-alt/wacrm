"use client";

import { PageLayout, PageHeader } from "@/components/shared";
import { AnnouncementForm } from "@/components/announcements/announcement-form";

export default function NewAnnouncementPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Create Announcement"
      >
        <p className="text-sm text-muted-foreground">Write a new announcement for your team.</p>
      </PageHeader>
      <AnnouncementForm />
    </PageLayout>
  );
}
