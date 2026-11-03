"use client";

import { useState, useEffect, useCallback } from "react";
import { useMarkRecordSeen } from "@/hooks/use-record-views";
import { useRouter } from "@/lib/navigation";
import { useParams } from "next/navigation";
import { Link } from "@/components/ui/link";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Tag, ContactNote, CustomField, Deal, Task, Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Phone, Mail, Building2, Calendar, CheckSquare, MessageSquare, Briefcase, FileText, Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import {
  BUYING_STATUS_OPTIONS,
  buyingStatusLabel,
  hasValidReason,
  isBuyingStatusEnabled,
  normalizeBuyingStatus,
  requiresReason,
  type BuyingStatus,
} from '@/lib/customers/buying-status';
import { ContactForm } from "@/components/contacts/contact-form";
import { Timeline } from "@/components/shared/timeline";
import {
  DetailPageLayout,
  DetailSection,
  DetailGrid,
  DetailItem,
} from "@/components/shared/detail-page-layout";
import { CustomerFinancialCard } from "@/components/payments/customer-financial-card";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import { errorMessage } from '@/lib/errors/message';
import { CustomerAssetsPanel } from "@/components/service/customer-assets-panel";
import { shouldShowCustomerAssets } from "@/lib/service/assets/customer-panel";

export default function ContactDetailsPage() {
  const { id } = useParams() as { id: string };

  // Opening the record is what clears its highlight on the list.
  useMarkRecordSeen("contact", id);
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency, accountId, account, isModuleEnabled, hasPermission, hasFSM, profile } = useAuth();
  // Setting Buyer / Yet to Buy by hand locks the row, so it is its own right.
  // Releasing that lock stays admin-only, which is why isAdmin is separate.
  const isAdmin = profile?.account_role === 'admin' || profile?.account_role === 'owner';
  const canSetBuyingStatus = isAdmin || hasPermission(PERMISSIONS.CUSTOMERS.MANAGE_BUYING_STATUS);
  // Non-null while the admin is typing a blacklist reason. The status is not
  // written until the reason is in, because the database will not accept a
  // blacklist without one.
  const [blacklistDraft, setBlacklistDraft] = useState<string | null>(null);
  const [savingBuyingStatus, setSavingBuyingStatus] = useState(false);

  /**
   * Write a hand-set Buying Status. The RPC is the only way in: it records the
   * lock and who/when in the same breath, and it is where the mandatory
   * blacklist reason is checked before the CHECK constraint can fire with a
   * constraint name instead of a sentence.
   */
  const applyBuyingStatus = async (next: BuyingStatus, reason: string | null) => {
    if (requiresReason(next) && !hasValidReason(reason)) {
      toast.error('Give a reason for blacklisting this customer.');
      return;
    }
    setSavingBuyingStatus(true);
    const previous = { status: contact?.buying_status, reason: contact?.buying_status_reason };
    setContact((c) => (c ? ({
      ...c,
      buying_status: next,
      buying_status_reason: requiresReason(next) ? (reason ?? '').trim() : null,
      buying_status_locked: true,
    }) : c));
    const { error } = await supabase.rpc('set_buying_status', {
      p_contact_id: id,
      p_status: next,
      p_reason: requiresReason(next) ? (reason ?? '').trim() : null,
    });
    setSavingBuyingStatus(false);
    if (error) {
      setContact((c) => (c ? ({
        ...c,
        buying_status: previous.status,
        buying_status_reason: previous.reason,
      }) : c));
      toast.error(errorMessage(error, 'Could not set Buying Status'));
      return;
    }
    setBlacklistDraft(null);
    toast.success(
      next === 'blacklist'
        ? 'Customer blacklisted. Order history will not change this.'
        : 'Buying Status set by hand. It will no longer follow order history.',
    );
  };

  const paymentEnabled = isModuleEnabled('payment');
  
  const canViewFinancials = hasPermission(PERMISSIONS.CUSTOMERS.VIEW_FINANCIALS);
  const canViewCreditLimit = hasPermission(PERMISSIONS.CUSTOMERS.VIEW_CUSTOMER_CREDIT_LIMIT);
  const canViewPaymentHistory = hasPermission(PERMISSIONS.CUSTOMERS.VIEW_CUSTOMER_PAYMENT_HISTORY);
  const canViewOpeningBalance = hasPermission(PERMISSIONS.CUSTOMERS.VIEW_OPENING_BALANCE);
  const canEditOpeningBalance = hasPermission(PERMISSIONS.CUSTOMERS.EDIT_OPENING_BALANCE);

  const [contact, setContact] = useState<Contact | null>(null);
  const [hierarchy, setHierarchy] = useState<{ enabled: boolean; levels: { position: number; name: string }[] }>({ enabled: false, levels: [] });
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    
    // 1. Fetch Contact
    const { data: contactData, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (contactError || !contactData) {
      toast.error("Customer not found");
      router.push("/contacts");
      return;
    }
    setContact(contactData);

    // Order hierarchy config (drives the Customer Level field visibility).
    //
    // Read from the account already in context, NOT re-fetched. This was a whole extra
    // round trip to Mumbai, and a BLOCKING one — it sat between the customer fetch and
    // the parallel batch below, so it added its full latency to every single time
    // anyone opened a customer. `useAuth` loads accounts.settings on the same row as
    // module_settings when the shell mounts, so the answer is already here.
    const os = (account?.settings as { order_settings?: { hierarchy_enabled?: boolean; levels?: unknown[] } } | null)
      ?.order_settings;
    setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? (os.levels as never[]) : [] });

    // 2. Fetch everything else in parallel
    const [
      tagsRes,
      contactTagsRes,
      notesRes,
      fieldsRes,
      valuesRes,
      dealsRes,
      tasksRes,
      activitiesRes
    ] = await Promise.all([
      supabase.from('tags').select('*'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', id),
      supabase.from('contact_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('module_name', 'contact').order('field_name'),
      supabase.from('contact_custom_values').select('*').eq('contact_id', id),
      supabase.from('deals').select('*, stage:pipeline_stages(*)').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('module_activities').select('*').eq('module_name', 'contact').eq('record_id', id).order('created_at', { ascending: false })
    ]);

    // Tags
    if (tagsRes.data && contactTagsRes.data) {
      const tagMap = new Map(tagsRes.data.map(t => [t.id, t]));
      const cTags = contactTagsRes.data.map(ct => tagMap.get(ct.tag_id)).filter(Boolean) as Tag[];
      setTags(cTags);
    }

    // Notes
    if (notesRes.data) setNotes(notesRes.data);

    // Custom Fields
    if (fieldsRes.data) setCustomFields(fieldsRes.data);
    if (valuesRes.data) {
      const map: Record<string, string> = {};
      valuesRes.data.forEach((v) => {
        map[v.custom_field_id] = v.value ?? '';
      });
      setCustomValues(map);
    }

    // Deals
    if (dealsRes.data) setDeals(dealsRes.data as Deal[]);
    
    // Tasks
    if (tasksRes.data) setTasks(tasksRes.data as Task[]);

    // Activities
    const activitiesData = activitiesRes.data;
    if (activitiesData && activitiesData.length > 0) {
      const userIds = Array.from(new Set(activitiesData.map((a: any) => a.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
        const profileMap = (profiles || []).reduce((acc: any, p: any) => {
          acc[p.user_id] = p;
          return acc;
        }, {});
        
        const enrichedActivities = activitiesData.map((a: any) => ({
          ...a,
          user: profileMap[a.user_id] || null
        }));
        setActivities(enrichedActivities);
      } else {
        setActivities(activitiesData);
      }
    } else {
      setActivities([]);
    }

    setLoading(false);
  }, [id, supabase, router, account?.settings]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh]">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!contact) return null;

  if (!contact) return null;

  // "Other Details" must not repeat the predefined fields already drawn above.
  //
  // Every field in `customFields` was rendered here, predefined ones included,
  // reading its value from `customValues` -- which only ever holds true custom
  // fields. A predefined field keeps its value on the contact row, so each one
  // printed a dash: thirteen of them, directly beneath the same values shown
  // correctly in Customer Details and Address & Location. Customers read that
  // as their data having been lost.
  //
  // Same shape as the product detail page: drop the keys already drawn, read
  // the rest from the row, and hide the ones with nothing in them.
  const NATIVE_SYSTEM_KEYS = new Set([
    // Customer Details
    'company', 'name', 'phone', 'email',
    // Address & Location
    'address', 'area', 'city', 'state', 'country', 'pincode',
    // Has its own editable control in Customer Details when hierarchy is on,
    // and means nothing when it is off.
    'hierarchy_level',
  ]);
  const contactRowValue = (key: string): string => {
    const raw = (contact as unknown as Record<string, unknown>)[key];
    if (raw == null || raw === '') return '';
    return String(raw);
  };
  const activeCustomFields = customFields.filter((f) => f.is_active !== false);
  // Predefined fields NOT drawn above (Customer Code, WhatsApp Number) now show
  // their real value instead of a permanent dash.
  const systemRows = activeCustomFields
    .filter((f) => f.system_key && !NATIVE_SYSTEM_KEYS.has(f.system_key))
    .map((f) => ({ field: f, value: contactRowValue(f.system_key as string) }))
    .filter((r) => r.value !== '');
  const extraFields = activeCustomFields.filter((f) => !f.system_key);

  return (
    <DetailPageLayout
      title={contact.company || contact.name || "Unnamed Customer"}
      onBack={() => router.back()}
      badges={tags.map((t) => (
        <Badge
          key={t.id}
          style={{ backgroundColor: t.color }}
          className="border-transparent font-semibold text-white shadow-sm"
        >
          {t.name}
        </Badge>
      ))}
      meta={
        <>
          {contact.name && (
            <span className="flex items-center gap-1">
              <Building2 className="size-3" /> {contact.name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Phone className="size-3" /> {contact.phone}
          </span>
          {contact.email && (
            <span className="flex items-center gap-1">
              <Mail className="size-3" /> {contact.email}
            </span>
          )}
        </>
      }
      actions={
        <>
          <Button
            onClick={() => router.push(`/inbox?phone=${contact.phone}`)}
            variant="outline"
            className="gap-2"
          >
            <MessageSquare className="size-4" />
            Message
          </Button>
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          
          {paymentEnabled && accountId && canViewFinancials && (
            <CustomerFinancialCard 
              contactId={id} 
              accountId={accountId} 
              canViewCreditLimit={canViewCreditLimit}
              canViewOpeningBalance={canViewOpeningBalance}
            />
          )}

          <DetailSection title="Customer Details">
            <DetailGrid>
              <DetailItem label="Company Name" value={contact.company} />
              <DetailItem label="Contact Person" value={contact.name} />
              <DetailItem label="Phone Number" value={contact.phone} />
              <DetailItem label="Email" value={contact.email} />
              {isBuyingStatusEnabled(account?.settings) && (
                <>
                  <DetailItem label="Buying Status">
                    {canSetBuyingStatus ? (
                      <select
                        value={blacklistDraft !== null ? 'blacklist' : normalizeBuyingStatus(contact.buying_status)}
                        onChange={(e) => {
                          const next = e.target.value as BuyingStatus;
                          // Blacklisting asks for the reason FIRST rather than
                          // firing and failing: the reason is mandatory in the
                          // database, so a save that skips it can only bounce.
                          if (requiresReason(next)) {
                            setBlacklistDraft(contact.buying_status_reason ?? '');
                            return;
                          }
                          setBlacklistDraft(null);
                          void applyBuyingStatus(next, null);
                        }}
                        className="text-body bg-muted border border-border rounded-md px-2 py-1.5 font-medium w-full"
                      >
                        {BUYING_STATUS_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-medium">
                        {buyingStatusLabel(contact.buying_status)}
                      </span>
                    )}
                  </DetailItem>

                  {/* The reason is mandatory, so it is asked for in the open
                      rather than behind a confirm dialog that can be dismissed. */}
                  {blacklistDraft !== null && (
                    <DetailItem label="Why is this customer blacklisted?" span={2}>
                      <Textarea
                        autoFocus
                        rows={2}
                        value={blacklistDraft}
                        placeholder="e.g. Cheque bounced twice, 90 days overdue"
                        onChange={(e) => setBlacklistDraft(e.target.value)}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={!hasValidReason(blacklistDraft) || savingBuyingStatus}
                          onClick={() => void applyBuyingStatus('blacklist', blacklistDraft)}
                        >
                          {savingBuyingStatus ? 'Saving…' : 'Blacklist this customer'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingBuyingStatus}
                          onClick={() => setBlacklistDraft(null)}
                        >
                          Cancel
                        </Button>
                        {!hasValidReason(blacklistDraft) && (
                          <span className="text-caption text-muted-foreground">
                            A reason is required.
                          </span>
                        )}
                      </div>
                    </DetailItem>
                  )}

                  {contact.buying_status === 'blacklist' && contact.buying_status_reason && (
                    <DetailItem label="Blacklisted because" span={2}>
                      <span className="text-body">{contact.buying_status_reason}</span>
                    </DetailItem>
                  )}

                  <DetailItem
                    label="First Order"
                    value={
                      contact.first_order_at
                        ? new Date(contact.first_order_at).toLocaleDateString()
                        : 'Never ordered'
                    }
                  />
                  {contact.buying_status_locked && (
                    <DetailItem label="Set by hand" span={2}>
                      <span className="text-caption text-muted-foreground">
                        {'Set by hand'}
                        {contact.buying_status_set_at
                          ? ` on ${new Date(contact.buying_status_set_at).toLocaleDateString()}`
                          : ''}
                        {'. It no longer follows order history'}
                        {isAdmin && contact.buying_status !== 'blacklist' ? '' : '.'}
                        {contact.buying_status === 'blacklist' &&
                          ' Set the status to Buyer or Yet to Buy to undo the blacklist — releasing the lock would let order history undo it by itself.'}
                      </span>
                      {/* Not offered while blacklisted: the database refuses it,
                          and obeying it would unblacklist somebody as a side
                          effect of the next invoice. */}
                      {isAdmin && contact.buying_status !== 'blacklist' && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="ml-1 h-auto p-0 text-caption"
                          onClick={async () => {
                            const { error } = await supabase.rpc('clear_buying_status_lock', { p_contact_id: id });
                            if (error) toast.error(errorMessage(error, 'Could not release the lock'));
                            else {
                              toast.success('Released. Buying Status follows order history again.');
                              router.refresh();
                            }
                          }}
                        >
                          — let it follow order history again
                        </Button>
                      )}
                    </DetailItem>
                  )}
                </>
              )}
              {hierarchy.enabled && (
                <DetailItem label="Customer Level">
                  <select
                    value={(contact as any).hierarchy_level ?? ""}
                    onChange={async (e) => {
                      const val = e.target.value === "" ? null : parseInt(e.target.value);
                      setContact({ ...contact, hierarchy_level: val } as any);
                      const { error } = await supabase.from("contacts").update({ hierarchy_level: val }).eq("id", id);
                      if (error) toast.error("Failed to update level");
                      else toast.success("Customer level updated");
                    }}
                    className="text-body bg-muted border border-border rounded-md px-2 py-1.5 font-medium w-full"
                  >
                    <option value="">Not set</option>
                    {hierarchy.levels.map((lvl) => (
                      <option key={lvl.position} value={lvl.position}>
                        {lvl.name}
                      </option>
                    ))}
                  </select>
                </DetailItem>
              )}
            </DetailGrid>

            {/* Address & Location */}
            {(contact.address || contact.area || contact.city || contact.state || contact.country || contact.pincode || contact.latitude != null) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="mb-4 text-section font-semibold text-foreground">Address &amp; Location</h3>
                <DetailGrid>
                  {contact.address && <DetailItem span="full" label="Full Address" value={contact.address} />}
                  {contact.area && <DetailItem label="Area" value={contact.area} />}
                  {contact.city && <DetailItem label="City" value={contact.city} />}
                  {contact.state && <DetailItem label="State" value={contact.state} />}
                  {contact.country && <DetailItem label="Country" value={contact.country} />}
                  {contact.pincode && <DetailItem label="Pincode" value={contact.pincode} />}
                  {contact.latitude != null && contact.longitude != null && (
                    <DetailItem span="full" label="Coordinates (geo-tagged)">
                      <span className="font-mono">{contact.latitude}, {contact.longitude}</span>
                    </DetailItem>
                  )}
                </DetailGrid>
              </>
            )}

            {(systemRows.length > 0 || extraFields.length > 0) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="mb-4 text-section font-semibold text-foreground">Other Details</h3>
                <DetailGrid>
                  {systemRows.map(({ field, value }) => (
                    <DetailItem
                      key={field.id}
                      label={field.field_name}
                      className="[&>p:first-child]:capitalize"
                      value={value}
                    />
                  ))}
                  {extraFields.map((field) => {
                    const val = customValues[field.id];
                    return (
                      <DetailItem
                        key={field.id}
                        label={field.field_name}
                        className="[&>p:first-child]:capitalize"
                        value={field.field_type === 'attachment' ? undefined : val}
                      >
                        {field.field_type === 'attachment' && val ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium flex items-center gap-1">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : undefined}
                      </DetailItem>
                    );
                  })}
                </DetailGrid>
              </>
            )}
          </DetailSection>
          
          <DetailSection title="Deals">
             {deals.length === 0 ? (
               <p className="text-body text-muted-foreground italic">No deals associated with this contact.</p>
             ) : (
               <div className="space-y-3">
                 {deals.map(deal => (
                   <div key={deal.id} className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 transition-colors">
                     <div>
                       <p className="font-medium text-primary hover:underline cursor-pointer">
                         <Link href={`/pipelines`}>{deal.title}</Link>
                       </p>
                       <p className="text-caption text-muted-foreground mt-1">
                         {deal.stage?.name || 'No Stage'} • {new Date(deal.created_at).toLocaleDateString()}
                       </p>
                     </div>
                     <div className="text-right">
                       <p className="font-semibold">{formatCurrency(deal.value, defaultCurrency)}</p>
                       <Badge variant={deal.status === 'won' ? 'default' : deal.status === 'lost' ? 'destructive' : 'outline'} className="mt-1">
                         {deal.status}
                       </Badge>
                     </div>
                   </div>
                 ))}
               </div>
             )}
          </DetailSection>

          {/* FSM only: not mounted (so nothing is fetched) unless the plan has the fsm line and the user can view assets. */}
          {shouldShowCustomerAssets({
            hasFSM,
            canView: hasPermission(PERMISSIONS.SERVICE_ASSETS.VIEW),
            accountId,
            contactId: id,
          }) && accountId && (
            <CustomerAssetsPanel
              contactId={id}
              accountId={accountId}
              canCreate={hasPermission(PERMISSIONS.SERVICE_ASSETS.CREATE)}
            />
          )}
        </div>

        {/* Right Column: Timeline */}
        <div className="w-full">
          <Timeline 
            moduleName="contact" 
            recordId={id} 
            tasks={tasks} 
            notes={notes}
            activities={activities} 
            onRefresh={fetchAllData}
            canViewPaymentHistory={canViewPaymentHistory}
          />
        </div>
      </div>

      <ContactForm
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact}
        onSaved={fetchAllData}
      />
    </DetailPageLayout>
  );
}
