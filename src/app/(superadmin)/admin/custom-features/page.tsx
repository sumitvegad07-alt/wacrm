"use client";

import { useEffect, useState } from "react";
import { Link } from "@/components/ui/link";
import { AlertTriangle, Wrench } from "lucide-react";
import type { CustomFeature } from "@/lib/plans/custom-features";

/**
 * The per-client feature register.
 *
 * Exists because in a year nobody will remember which client was given what.
 * Every fix here is global by default, so a one-off built for one company is
 * exactly the thing a later change breaks silently — and the only way to test
 * it is to know it is there. This screen is that knowledge, and it is generated
 * from the code catalogue plus the live grants, so it cannot drift.
 */

interface AccountRef {
  id: string;
  customer_id: string | null;
  name: string | null;
}
type RegisterEntry = CustomFeature & { accounts: AccountRef[] };
interface Payload {
  columnMissing: boolean;
  features: RegisterEntry[];
  grantedKeysNotInCatalog: { key: string; accounts: AccountRef[] }[];
}

function CompanyList({ accounts }: { accounts: AccountRef[] }) {
  if (accounts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Built, but not switched on for anybody yet.
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {accounts.map((a) => (
        <li key={a.id}>
          <Link
            href={`/admin/companies/${a.id}`}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
          >
            <span className="font-medium">{a.name ?? "Unnamed"}</span>
            {a.customer_id && (
              <span className="text-muted-foreground">{a.customer_id}</span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function CustomFeaturesRegisterPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/custom-features");
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload.error || "Failed to load");
        setData(payload as Payload);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Wrench className="h-6 w-6 text-primary" />
          Custom features
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Things built for one client and switched on only for them. One app in
          the stores, one portal, one deploy — the feature is simply off for
          every other company. Granted per company on its own page under
          Companies; a client cannot switch one on themselves.
        </p>
      </div>

      {loading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {data?.columnMissing && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="space-y-1 text-sm">
            <p className="font-medium">The database is not ready yet.</p>
            <p className="text-muted-foreground">
              Paste <code>RUN-THIS-IN-SUPABASE-custom-features.sql</code> into
              the Supabase SQL Editor and press Run. Until then nothing can be
              granted, and no client is affected.
            </p>
          </div>
        </div>
      )}

      {data && !data.columnMissing && data.features.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-medium">Nothing custom exists yet.</p>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            That is the right state. When a client asks for something we do not
            want to give everybody, OZZO builds it behind a switch and it
            appears in this list — then you tick it for that company. No
            separate app, no separate build, no separate link.
          </p>
        </div>
      )}

      {data?.features.map((f) => (
        <div key={f.key} className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold">{f.label}</h2>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{f.key}</code>
            {f.retired && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                retired
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{f.description}</p>
          <p className="text-xs text-muted-foreground">
            Asked by {f.requestedBy} · since {f.since} · affects{" "}
            {f.surfaces.join(", ")}
            {f.retired && f.retiredNote ? ` · ${f.retiredNote}` : ""}
          </p>
          <div className="space-y-1">
            <p className="text-xs font-medium">
              Switched on for {f.accounts.length}{" "}
              {f.accounts.length === 1 ? "company" : "companies"}
            </p>
            <CompanyList accounts={f.accounts} />
          </div>
        </div>
      ))}

      {data && data.grantedKeysNotInCatalog.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-base font-semibold">
              Switches that no longer exist in the app
            </h2>
          </div>
          <p className="text-sm text-muted-foreground">
            These keys are stored on a company but this version of the app does
            not know them, so they grant nothing. Either the key was typed by
            hand, or it was deleted from the code instead of being retired. Tell
            OZZO engineering; the client is not getting what this suggests.
          </p>
          {data.grantedKeysNotInCatalog.map((s) => (
            <div key={s.key} className="space-y-1">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.key}</code>
              <CompanyList accounts={s.accounts} />
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">How to keep this list short</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            Charge for a customisation — one-time to build, and yearly to keep
            it working. Every switch is a branch somebody has to test forever.
          </li>
          <li>
            When a SECOND client asks for the same thing, stop treating it as
            custom: make it an ordinary setting for everyone, default off, and
            retire the switch. That is how the product grows without the
            maintenance growing with it.
          </li>
          <li>
            An extra field, a different print format or a different rule usually
            needs no switch at all — Custom Fields, Document Templates and the
            account settings already do those per company.
          </li>
        </ul>
      </div>
    </div>
  );
}
