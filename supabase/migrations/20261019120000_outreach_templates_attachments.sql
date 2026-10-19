-- ============================================================
-- 20261019120000_outreach_templates_attachments.sql
--
-- Two things the WhatsApp sender did not have: wordings that outlive a
-- campaign, and more than one attachment.
--
-- WHY THE WORDINGS MOVE OUT OF THE CAMPAIGN
--
-- re_outreach_campaigns.variants is a snapshot. That is right for a campaign —
-- editing a wording tomorrow must not change what is halfway through sending —
-- but it meant the founder's four wordings only existed inside whichever
-- campaign he last typed them into, and a stopped or deleted campaign took
-- them with it. He retypes them every time.
--
-- re_outreach_templates is the library: not referenced by any campaign, not
-- reachable by any cascade, so nothing a campaign does can remove it. Starting
-- a campaign copies the library into campaigns.variants exactly as before, and
-- the snapshot keeps doing its job.
--
-- WHY THE ATTACHMENTS ARE SLOTS AND NOT A LIST
--
-- Slot order is the order they are sent in, and the founder replaces one file
-- at a time. A fixed slot makes "replace the PDF" one upsert with nothing to
-- renumber. The rules live in outreach-attachments.ts.
--
-- RLS IS ON WITH NO POLICIES, like every other re_* table. Platform-owner
-- data, reachable only through the service role after requireFounder().
-- ============================================================

-- ── The message library ──
create table if not exists public.re_outreach_templates (
  id         uuid primary key default gen_random_uuid(),
  -- 1-4, and the order they are shown in. Unique because this is one founder's
  -- one library, not a per-user list: two rows claiming slot 2 would make the
  -- page's order depend on insertion time.
  position   integer not null unique check (position between 1 and 4),
  body       text not null check (btrim(body) <> ''),
  owner_id   uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.re_outreach_templates is
  'The founder''s saved outreach wordings. Copied into a campaign at start; never deleted by one.';

-- ── The standing attachments ──
create table if not exists public.re_outreach_attachments (
  -- The primary key IS the slot: there is exactly one file per slot, and an
  -- upsert on conflict is how a replacement happens.
  slot       integer primary key check (slot between 1 and 2),
  -- Object key inside the private `outreach` bucket. Unique per upload, so a
  -- signed URL minted for the previous file cannot serve the new one.
  path       text not null,
  file_name  text not null,
  mime_type  text not null,
  -- 'image' shows as a photo in the chat, 'document' as a file card. Handed
  -- straight to WA-JS as its sendFileMessage type.
  kind       text not null check (kind in ('image','document')),
  size_bytes bigint not null default 0,
  owner_id   uuid not null,
  updated_at timestamptz not null default now()
);

comment on table public.re_outreach_attachments is
  'The two standing outreach files. Snapshotted into a campaign at start, so replacing one never changes what is already sending.';

alter table public.re_outreach_templates   enable row level security;
alter table public.re_outreach_attachments enable row level security;

-- ── The campaign's snapshot of the files ──
--
-- jsonb and not a reference, for the same reason the recipient rows snapshot
-- the lead's name and city: a campaign at 50 a day runs for weeks, and the
-- founder replacing the brochure in week two must not silently change what the
-- remaining 400 people receive. Each element is
-- {slot, path, file_name, mime_type, kind}, read by orderAttachments().
alter table public.re_outreach_campaigns
  add column if not exists attachments jsonb not null default '[]'::jsonb;

comment on column public.re_outreach_campaigns.attachments is
  'Snapshot of re_outreach_attachments taken when the campaign was created. Sent in slot order after the text.';

-- The single-attachment column it replaces. Safe to drop: nothing ever wrote
-- it — the page had no upload box — so every row holds null.
alter table public.re_outreach_campaigns
  drop column if exists attachment_path;
