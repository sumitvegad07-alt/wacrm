'use client';

/**
 * "Provide DMS Access" — gives one customer a login to the distributor portal.
 *
 * Lives in its own file so the 1,100-line customer form only renders it in one
 * line. Renders NOTHING unless the account holds the DMS add-on (and the viewer
 * is an admin, because the API behind it requires one).
 *
 * Server error text is shown verbatim: the route already words every refusal
 * (seat cap, missing add-on, taken login, order-hierarchy level) for an admin.
 */

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { FormGrid } from '@/components/shared/form-grid';

export interface PortalAccessBlockProps {
  /** Null/undefined while a customer is being created: there is nothing to attach a login to yet. */
  contactId?: string | null;
  portalEmail?: string | null;
  portalAccess?: boolean | null;
  portalAccessRevokedAt?: string | null;
  /** contacts.portal_access_set_by (a profiles.id) and portal_access_set_at. */
  setBy?: string | null;
  setAt?: string | null;
  /**
   * Called after any successful write. Pass the page's FULL reload (e.g.
   * `refreshAll`), never a local setState: a block that refetches itself
   * leaves the rest of the page stale.
   */
  onChanged: () => void;
}

interface ApiBody {
  ok?: boolean;
  error?: string;
  warning?: string;
}

async function call(method: 'POST' | 'PATCH' | 'DELETE', contactId: string, payload?: Record<string, string>) {
  const url =
    method === 'DELETE'
      ? `/api/portal-access?contact_id=${encodeURIComponent(contactId)}`
      : '/api/portal-access';
  const res = await fetch(url, {
    method,
    headers: method === 'DELETE' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify({ contact_id: contactId, ...payload }),
  });
  let body: ApiBody = {};
  try {
    body = (await res.json()) as ApiBody;
  } catch {
    /* non-JSON body: fall through to the status check */
  }
  // A non-2xx means nothing durable changed. A 2xx with `warning` IS success.
  return { ok: res.ok && body.ok !== false, body };
}

export function PortalAccessBlock({
  contactId,
  portalEmail,
  portalAccess,
  portalAccessRevokedAt,
  setBy,
  setAt,
  onChanged,
}: PortalAccessBlockProps) {
  const { hasDMS, canManageMembers, account, accountId } = useAuth();

  // What this block has just done, shown until the parent's reload brings the
  // same truth back through props (the list page's `contact` prop is a
  // snapshot that does not refresh).
  const [local, setLocal] = useState<{ email: string; active: boolean } | null>(null);
  useEffect(() => {
    setLocal(null);
  }, [portalEmail, portalAccess, portalAccessRevokedAt]);

  const email = local?.email ?? portalEmail ?? '';
  const hasLogin = email !== '';
  const active = local ? local.active : portalAccess === true && !portalAccessRevokedAt;

  const [wantOpen, setWantOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [seatsUsed, setSeatsUsed] = useState<number | null>(null);
  const [seatsTick, setSeatsTick] = useState(0);
  const [setByName, setSetByName] = useState<string | null>(null);

  const show = hasDMS && canManageMembers;

  useEffect(() => {
    if (!show || !accountId) return;
    let alive = true;
    void (async () => {
      const { data, error: err } = await createClient().rpc('portal_seats_used', {
        p_account_id: accountId,
      });
      if (alive) setSeatsUsed(err || typeof data !== 'number' ? null : data);
    })();
    return () => {
      alive = false;
    };
    // seatsTick: bumped after every write. The portal* props: the count also
    // moves when the parent reloads with a different state.
  }, [show, accountId, seatsTick, portalAccess, portalEmail, portalAccessRevokedAt]);

  useEffect(() => {
    if (!show || !setBy) {
      setSetByName(null);
      return;
    }
    let alive = true;
    void (async () => {
      const { data } = await createClient()
        .from('profiles')
        .select('full_name, email')
        .eq('id', setBy)
        .maybeSingle();
      if (alive) setSetByName(data?.full_name || data?.email || null);
    })();
    return () => {
      alive = false;
    };
  }, [show, setBy]);

  const finish = useCallback(
    (next: { email: string; active: boolean }, message: string, warn?: string) => {
      setLocal(next);
      setPassword('');
      setError(null);
      setNotice(message);
      setWarning(warn ?? null);
      setSeatsTick((n) => n + 1);
      onChanged();
    },
    [onChanged],
  );

  if (!show) return null;

  const seatsLimit = account?.portal_seats_limit ?? 0;
  const seatsLine = seatsUsed === null ? null : `${seatsUsed} of ${seatsLimit} logins used`;

  if (!contactId) {
    return (
      <section className="rounded-lg border border-border bg-card p-4 space-y-1" data-testid="portal-access-block">
        <h3 className="text-section font-semibold text-foreground">Provide DMS Access</h3>
        <p className="text-body text-muted-foreground">
          Save this customer first. Once it exists, open it again to give it a DMS login.
        </p>
        {seatsLine && <p className="text-caption text-muted-foreground">{seatsLine}</p>}
      </section>
    );
  }

  const open = active || wantOpen;
  const status = active ? 'Login active' : hasLogin ? 'Access withdrawn' : 'No login yet';

  function begin() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setWarning(null);
  }

  async function save() {
    if (!contactId || busy) return;
    begin();
    try {
      // A withdrawn login is restored with its stored email; a new one uses the typed email.
      const sendEmail = hasLogin ? email : loginEmail.trim();
      const payload: Record<string, string> = { email: sendEmail };
      if (password !== '' || !hasLogin) payload.password = password;
      const r = await call('POST', contactId, payload);
      if (!r.ok) {
        setError(r.body.error ?? 'Could not save the login.');
        return;
      }
      finish(
        { email: sendEmail, active: true },
        hasLogin ? 'Access restored.' : 'Login created.',
        r.body.warning,
      );
      setWantOpen(false);
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!contactId || busy) return;
    begin();
    try {
      const r = await call('PATCH', contactId, { password });
      if (!r.ok) {
        setError(r.body.error ?? 'Could not reset the password.');
        return;
      }
      finish({ email, active }, 'Password reset.', r.body.warning);
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!contactId || busy) return;
    if (!window.confirm('Remove this customer’s DMS access? The login is kept and the seat is freed. You can restore it later.')) return;
    begin();
    try {
      const r = await call('DELETE', contactId);
      if (!r.ok) {
        setError(r.body.error ?? 'Could not remove access.');
        return;
      }
      finish({ email, active: false }, 'Access removed.', r.body.warning);
      setWantOpen(false);
    } catch {
      setError('Could not reach the server. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  // This block sits inside the customer <form>: Enter in a field must not submit the customer.
  const noSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3" data-testid="portal-access-block">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-section font-semibold text-foreground">Provide DMS Access</h3>
          <p className="text-caption text-muted-foreground">{status}</p>
        </div>
        <Switch
          checked={open}
          disabled={busy}
          aria-label="Provide DMS Access"
          onCheckedChange={(on: boolean) => {
            if (on) setWantOpen(true);
            else if (active) void revoke();
            else setWantOpen(false);
          }}
        />
      </div>

      {open && (
        <div className="space-y-3">
          <FormGrid variant="dialog">
            <div className="space-y-1">
              <Label htmlFor="portal-login-email">Login email</Label>
              <Input
                id="portal-login-email"
                type="email"
                autoComplete="off"
                value={hasLogin ? email : loginEmail}
                readOnly={hasLogin}
                disabled={busy}
                onChange={(e) => setLoginEmail(e.target.value)}
                onKeyDown={noSubmit}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="portal-login-password">{hasLogin ? 'New password' : 'Password'}</Label>
              <Input
                id="portal-login-password"
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={noSubmit}
              />
            </div>
          </FormGrid>

          <div className="flex flex-wrap gap-2">
            {!active && (
              <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
                {hasLogin ? 'Restore access' : 'Save login'}
              </Button>
            )}
            {active && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || password === ''}
                onClick={() => void reset()}
              >
                Reset password
              </Button>
            )}
            {active && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke()}>
                Remove access
              </Button>
            )}
          </div>
        </div>
      )}

      {hasLogin && (setAt || setByName) && !local && (
        <p className="text-caption text-muted-foreground">
          Last changed
          {setByName ? ` by ${setByName}` : ''}
          {setAt ? ` on ${new Date(setAt).toLocaleString()}` : ''}.
        </p>
      )}
      {seatsLine && <p className="text-caption text-muted-foreground">{seatsLine}</p>}
      {notice && !error && (
        <p className="text-caption text-foreground" role="status">
          {notice}
        </p>
      )}
      {warning && (
        <p className="text-caption text-amber-600" role="status">
          {warning}
        </p>
      )}
      {error && (
        <p className="text-caption text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
