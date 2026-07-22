"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Contact, Tag, ContactNote, CustomField, Deal, Task, Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, Phone, Mail, Building2, Calendar, CheckSquare, MessageSquare, Briefcase, FileText, Loader2, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useAuth } from "@/hooks/use-auth";
import { ContactForm } from "@/components/contacts/contact-form";
import { Timeline } from "@/components/shared/timeline";

export default function ContactDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency, accountId } = useAuth();

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

    // Order hierarchy config (drives the Customer Level field visibility)
    if (accountId) {
      const { data: acct } = await supabase.from("accounts").select("settings").eq("id", accountId).single();
      const os = acct?.settings?.order_settings;
      setHierarchy({ enabled: !!os?.hierarchy_enabled, levels: Array.isArray(os?.levels) ? os.levels : [] });
    }

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
  }, [id, supabase, router]);

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

  return (
    <div className="space-y-6 max-w-7xl mx-auto flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 bg-card border border-border p-4 rounded-lg">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
              {contact.company || contact.name || "Unnamed Customer"}
              {tags.map(t => (
                <Badge key={t.id} style={{ backgroundColor: t.color + '20', color: t.color, borderColor: t.color + '40' }} variant="outline">
                  {t.name}
                </Badge>
              ))}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
              {contact.name && <span className="flex items-center gap-1"><Building2 className="size-3" /> {contact.name}</span>}
              <span className="flex items-center gap-1"><Phone className="size-3" /> {contact.phone}</span>
              {contact.email && <span className="flex items-center gap-1"><Mail className="size-3" /> {contact.email}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => router.push(`/inbox?phone=${contact.phone}`)} variant="outline" className="gap-2">
            <MessageSquare className="size-4" />
            Message
          </Button>
          <Button onClick={() => setEditOpen(true)} className="gap-2">
            <Pencil className="size-4" />
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Column: Details & Custom Fields */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-lg font-semibold mb-4">Customer Details</h3>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Company Name</p>
                <p className="font-medium">{contact.company || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Contact Person</p>
                <p className="font-medium">{contact.name || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Phone Number</p>
                <p className="font-medium">{contact.phone}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Email</p>
                <p className="font-medium">{contact.email || '-'}</p>
              </div>
              {hierarchy.enabled && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Customer Level</p>
                  <select
                    value={(contact as any).hierarchy_level ?? ""}
                    onChange={async (e) => {
                      const val = e.target.value === "" ? null : parseInt(e.target.value);
                      setContact({ ...contact, hierarchy_level: val } as any);
                      const { error } = await supabase.from("contacts").update({ hierarchy_level: val }).eq("id", id);
                      if (error) toast.error("Failed to update level");
                      else toast.success("Customer level updated");
                    }}
                    className="text-sm bg-muted border border-border rounded-md px-2 py-1.5 font-medium w-full"
                  >
                    <option value="">Not set</option>
                    {hierarchy.levels.map((lvl) => (
                      <option key={lvl.position} value={lvl.position}>
                        {lvl.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Address & Location */}
            {(contact.address || contact.area || contact.city || contact.state || contact.country || contact.pincode || contact.latitude != null) && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-4">Address &amp; Location</h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {contact.address && <div className="col-span-2"><p className="text-sm text-muted-foreground mb-1">Full Address</p><p className="font-medium">{contact.address}</p></div>}
                  {contact.area && <div><p className="text-sm text-muted-foreground mb-1">Area</p><p className="font-medium">{contact.area}</p></div>}
                  {contact.city && <div><p className="text-sm text-muted-foreground mb-1">City</p><p className="font-medium">{contact.city}</p></div>}
                  {contact.state && <div><p className="text-sm text-muted-foreground mb-1">State</p><p className="font-medium">{contact.state}</p></div>}
                  {contact.country && <div><p className="text-sm text-muted-foreground mb-1">Country</p><p className="font-medium">{contact.country}</p></div>}
                  {contact.pincode && <div><p className="text-sm text-muted-foreground mb-1">Pincode</p><p className="font-medium">{contact.pincode}</p></div>}
                  {contact.latitude != null && contact.longitude != null && (
                    <div className="col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">Coordinates (geo-tagged)</p>
                      <p className="font-medium font-mono text-sm">{contact.latitude}, {contact.longitude}</p>
                    </div>
                  )}
                </div>
              </>
            )}

            {customFields.length > 0 && (
              <>
                <div className="my-6 border-t border-border/50" />
                <h3 className="text-lg font-semibold mb-4">Other Details</h3>
                <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                  {customFields.map((field) => {
                    const val = customValues[field.id];
                    return (
                      <div key={field.id}>
                        <p className="text-sm text-muted-foreground mb-1 capitalize">{field.field_name}</p>
                        {field.field_type === 'attachment' && val ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium flex items-center gap-1">
                            <FileText className="size-4" /> View Attachment
                          </a>
                        ) : (
                          <p className="font-medium break-words">{val || '-'}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
          
          <div className="bg-card border border-border rounded-lg p-5">
             <h3 className="text-lg font-semibold mb-4">Deals</h3>
             {deals.length === 0 ? (
               <p className="text-sm text-muted-foreground italic">No deals associated with this contact.</p>
             ) : (
               <div className="space-y-3">
                 {deals.map(deal => (
                   <div key={deal.id} className="flex items-center justify-between p-3 border border-border rounded-md hover:bg-muted/50 transition-colors">
                     <div>
                       <p className="font-medium text-primary hover:underline cursor-pointer">
                         <Link href={`/pipelines`}>{deal.title}</Link>
                       </p>
                       <p className="text-xs text-muted-foreground mt-1">
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
          </div>
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
          />
        </div>
      </div>

      <ContactForm
        open={editOpen}
        onOpenChange={setEditOpen}
        contact={contact}
        onSaved={fetchAllData}
      />
    </div>
  );
}
