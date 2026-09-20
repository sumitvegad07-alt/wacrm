'use client';
import { useState } from 'react';
import type { TemplateStep } from '@/lib/implementation/types';

export function ContentTabs({ step }: { step: TemplateStep }) {
  const tabs: string[] = [];
  if (step.video_url) tabs.push('Watch');
  if (step.quick_steps.length) tabs.push('Read');
  if (step.media.some((m) => m.media_type === 'image')) tabs.push('Screenshots');
  const [active, setActive] = useState(tabs[0] ?? 'Read');
  if (tabs.length === 0) return null;
  return (
    <div className="rounded-xl border">
      <div className="flex gap-1 border-b p-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setActive(t)}
            className={`rounded-lg px-3 py-1.5 text-sm ${active === t ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>{t}</button>
        ))}
      </div>
      <div className="p-4">
        {active === 'Watch' && step.video_url && (
          <div className="aspect-video"><iframe className="h-full w-full rounded-lg" src={step.video_url} title="Walkthrough" allowFullScreen /></div>
        )}
        {active === 'Read' && (
          <ol className="list-decimal space-y-1 pl-5 text-sm">{step.quick_steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        )}
        {active === 'Screenshots' && (
          <div className="grid gap-3 sm:grid-cols-2">
            {step.media.filter((m) => m.media_type === 'image').map((m) => (
              <figure key={m.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- author-supplied screenshot URLs, not Next-optimizable assets */}
                <img src={m.url} alt={m.caption ?? ''} className="rounded-lg border" />
                {m.caption && <figcaption className="mt-1 text-xs text-muted-foreground">{m.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
