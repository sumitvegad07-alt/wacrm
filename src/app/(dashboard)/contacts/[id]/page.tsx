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

export default function ContactDetailsPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  const supabase = createClient();
  const { defaultCurrency } = useAuth();

  const [contact, setContact] = useState<Contact | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  
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
      toast.error("Contact not found");
      router.push("/contacts");
      return;
    }
    setContact(contactData);

    // 2. Fetch everything else in parallel
    const [
      tagsRes,
      contactTagsRes,
      notesRes,
      fieldsRes,
      valuesRes,
      dealsRes,
      tasksRes
    ] = await Promise.all([
      supabase.from('tags').select('*'),
      supabase.from('contact_tags').select('tag_id').eq('contact_id', id),
      supabase.from('contact_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('custom_fields').select('*').eq('module_name', 'contact').order('field_name'),
      supabase.from('contact_custom_values').select('*').eq('contact_id', id),
      supabase.from('deals').select('*, stage:pipeline_stages(*)').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('contact_id', id).order('created_at', { ascending: false })
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

  const plannedTasks = tasks.filter(t => t.status !== 'Completed' && t.status !== 'Cancelled');
  const pastTasks = tasks.filter(t => t.status === 'Completed' || t.status === 'Cancelled');

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
              {contact.name || "Unnamed Contact"}
              {tags.map(t => (
                <Badge key={t.id} style={{ backgroundColor: t.color + '20', color: t.color, borderColor: t.color + '40' }} variant="outline">
                  {t.name}
                </Badge>
              ))}
            </h1>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-4">
              <span className="flex items-center gap-1"><Phone className="size-3" /> {contact.phone}</span>
              {contact.email && <span className="flex items-center gap-1"><Mail className="size-3" /> {contact.email}</span>}
              {contact.company && <span className="flex items-center gap-1"><Building2 className="size-3" /> {contact.company}</span>}
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
            <h3 className="text-lg font-semibold mb-4">Contact Details</h3>
            
            <div className="grid grid-cols-2 gap-y-6 gap-x-4">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Name</p>
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
              <div>
                <p className="text-sm text-muted-foreground mb-1">Company</p>
                <p className="font-medium">{contact.company || '-'}</p>
              </div>
            </div>

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
        <div className="bg-card border border-border rounded-lg flex flex-col overflow-hidden h-[calc(100vh-140px)] sticky top-6">
          <div className="p-4 border-b border-border bg-muted/30">
            <h3 className="font-semibold flex items-center gap-2">
              <Calendar className="size-4" />
              Timeline
            </h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-8">
            {/* Planned Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Planned</h4>
              {plannedTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No upcoming activities.</p>
              ) : (
                <div className="space-y-4">
                  {plannedTasks.map(task => (
                    <div key={task.id} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-primary before:ring-4 before:ring-card">
                      <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border last:hidden" />
                      <p className="text-sm font-medium">
                        <Link href={`/tasks/${task.id}`} className="hover:underline text-primary">{task.title}</Link>
                      </p>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{task.priority}</Badge>
                        {task.due_date && <span>Scheduled: {new Date(task.due_date).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Past Section */}
            <div>
              <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Past</h4>
              {notes.length === 0 && pastTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground italic pl-2 border-l-2 border-border">No past activities.</p>
              ) : (
                <div className="space-y-4 pb-4">
                  {/* Sort combined past events by date */}
                  {[
                    ...notes.map(n => ({ type: 'note', date: new Date(n.created_at), data: n })),
                    ...pastTasks.map(t => ({ type: 'task', date: new Date(t.created_at), data: t }))
                  ].sort((a, b) => b.date.getTime() - a.date.getTime()).map((event, i, arr) => (
                    <div key={`${event.type}-${event.data.id}`} className="relative pl-6 before:absolute before:left-1.5 before:top-2 before:h-2 before:w-2 before:rounded-full before:bg-muted-foreground/40 before:ring-4 before:ring-card">
                      {i !== arr.length - 1 && <div className="absolute left-2 top-4 bottom-[-16px] w-[1px] bg-border" />}
                      
                      {event.type === 'note' ? (
                        <div className="bg-muted/40 rounded p-3 text-sm border border-border/50">
                          <p className="font-semibold text-xs text-muted-foreground mb-1">Note Added</p>
                          <p className="whitespace-pre-wrap">{(event.data as ContactNote).note_text}</p>
                          <p className="text-[10px] text-muted-foreground mt-2">{event.date.toLocaleString()}</p>
                        </div>
                      ) : (
                        <div className="text-sm">
                          <p className="font-medium flex items-center gap-2">
                            <CheckSquare className="size-3 text-green-500" />
                            <Link href={`/tasks/${event.data.id}`} className="hover:underline line-through text-muted-foreground">
                              {(event.data as Task).title}
                            </Link>
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">Completed task • {event.date.toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
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
