'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useLocationPresence, type LocationStatus } from '@/hooks/use-location-presence';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, SignalHigh, Clock, UserX } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';


interface StaffProfile {
  user_id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

export default function FieldStaffPage() {
  const { accountId } = useAuth();
  const { entries, getStatus, now } = useLocationPresence(true);
  const [profiles, setProfiles] = useState<Map<string, StaffProfile>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    const fetchProfiles = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, avatar_url')
        .eq('account_id', accountId);

      if (data) {
        const map = new Map<string, StaffProfile>();
        for (const p of data) map.set(p.user_id, p);
        setProfiles(map);
      }
      setLoading(false);
    };
    fetchProfiles();
  }, [accountId]);

  const StatusBadge = ({ status }: { status: LocationStatus }) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
            <SignalHigh className="size-3 mr-1" /> Active
          </Badge>
        );
      case 'stale':
        return (
          <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-200">
            <Clock className="size-3 mr-1" /> Stale
          </Badge>
        );
      case 'offline':
        return (
          <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200">
            <UserX className="size-3 mr-1" /> Offline
          </Badge>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-6 py-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Field Staff</h1>
          <p className="text-sm text-muted-foreground">Monitor real-time location and visits.</p>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-muted/20 p-6">
        <div className="mx-auto flex max-w-6xl flex-col lg:flex-row gap-6">
          
          {/* Staff List */}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            <h2 className="text-lg font-medium text-foreground">Active Sessions</h2>
            
            <div className="flex flex-col gap-3">
              {loading ? (
                <div className="rounded-xl border border-border bg-card p-6 text-center text-muted-foreground">
                  Loading field staff...
                </div>
              ) : entries.length === 0 ? (
                <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground flex flex-col items-center justify-center">
                  <MapPin className="size-8 text-muted-foreground/50 mb-3" />
                  <p>No active field staff sessions.</p>
                  <p className="text-sm mt-1">Staff will appear here when they clock in via the mobile app.</p>
                </div>
              ) : (
                entries.map(([userId, ping]) => {
                  const profile = profiles.get(userId);
                  const status = getStatus(userId);
                  const lastSeen = new Date(ping.recorded_at).getTime();
                  // A simple relative time string, bypassing full formatLastSeen for now
                  const minsDiff = Math.max(0, Math.floor((now - lastSeen) / 60_000));

                  return (
                    <div key={userId} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-4">
                        <Avatar className="size-10 border border-border">
                          {profile?.avatar_url && <AvatarImage src={profile.avatar_url} />}
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {profile?.full_name?.charAt(0) || profile?.email?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium text-foreground">
                            {profile?.full_name || profile?.email || 'Unknown User'}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Navigation className="size-3" />
                            {ping.lat.toFixed(5)}, {ping.lng.toFixed(5)}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge status={status} />
                        <span className="text-xs text-muted-foreground">
                          {minsDiff < 1 ? 'Just now' : `${minsDiff}m ago`}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Map Placeholder */}
          <div className="w-full lg:w-[500px] xl:w-[600px] shrink-0 flex flex-col gap-4">
            <h2 className="text-lg font-medium text-foreground">Live Map</h2>
            <div className="relative rounded-xl border border-border bg-card overflow-hidden h-[500px] flex items-center justify-center bg-[url('https://maps.wikimedia.org/osm-intl/12/1209/1539.png')] bg-cover bg-center">
              <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px]" />
              <div className="relative z-10 flex flex-col items-center justify-center text-center p-6 bg-card/90 rounded-lg shadow-sm border border-border max-w-sm">
                <MapPin className="size-10 text-primary mb-3" />
                <h3 className="text-base font-medium text-foreground mb-1">Map View Unavailable</h3>
                <p className="text-sm text-muted-foreground">
                  The live map component requires a mapping provider (e.g. Mapbox). It will be enabled in the next phase of rollout.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
