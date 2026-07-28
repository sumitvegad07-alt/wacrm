"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, MessageSquarePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { extractVariableIndices, TEMPLATE_LIMITS } from "@/lib/whatsapp/template-validators";

export default function NewWhatsAppTemplatePage() {
  const router = useRouter();
  const supabase = createClient();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "Marketing" as "Marketing" | "Utility" | "Authentication",
    language: "en",
    header_format: "none" as "none" | "text" | "image" | "video" | "document",
    header_content: "",
    body_text: "",
    footer_text: ""
  });

  const variables = extractVariableIndices(form.body_text);

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.body_text.trim()) {
      toast.error("Template Name and Body Text are required");
      return;
    }
    if (form.body_text.length > TEMPLATE_LIMITS.bodyMaxLength) {
      toast.error(`Body exceeds maximum limit of ${TEMPLATE_LIMITS.bodyMaxLength} characters`);
      return;
    }

    setCreating(true);
    try {
      // First try calling our API route if available, or direct insert
      const res = await fetch("/api/whatsapp/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          category: form.category,
          language: form.language,
          components: [
            form.header_format !== "none" && {
              type: "HEADER",
              format: form.header_format.toUpperCase(),
              ...(form.header_format === "text" && { text: form.header_content })
            },
            {
              type: "BODY",
              text: form.body_text
            },
            form.footer_text.trim() && {
              type: "FOOTER",
              text: form.footer_text.trim()
            }
          ].filter(Boolean)
        })
      });

      if (!res.ok) {
        // Fallback to supabase insert if API endpoint returns error or isn't running Meta sync
        const { error } = await supabase.from("whatsapp_templates").insert({
          name: form.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          category: form.category,
          language: form.language,
          header_format: form.header_format === "none" ? null : form.header_format,
          header_content: form.header_content || null,
          body_text: form.body_text,
          footer_text: form.footer_text || null,
          status: "PENDING"
        });
        if (error) throw error;
      }

      toast.success("WhatsApp template submitted for approval");
      router.push("/settings?tab=templates");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to create template");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 w-full max-w-none space-y-8">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-6 border-b border-border">
        <div className="flex items-center gap-4">
          <Link href="/settings?tab=templates">
            <Button variant="outline" size="icon" className="shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
              <MessageSquarePlus className="w-6 h-6 text-primary" />
              Create WhatsApp Template
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Design a rich WhatsApp message template to submit for Meta verification.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleCreateTemplate} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Left 2 Cols: Form Editor */}
          <div className="lg:col-span-2 space-y-8">
            <Card className="p-6 border-border shadow-sm space-y-6">
              <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">General Metadata</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name">Template Name *</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. welcome_offer_oct"
                    required
                  />
                  <p className="text-xs text-muted-foreground">Lowercase, numbers, and underscores only.</p>
                </div>

                <div className="space-y-2">
                  <Label>Category *</Label>
                  <Select value={form.category} onValueChange={(v: any) => setForm({ ...form, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Marketing">Marketing</SelectItem>
                      <SelectItem value="Utility">Utility</SelectItem>
                      <SelectItem value="Authentication">Authentication</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Language *</Label>
                  <Select value={form.language} onValueChange={v => setForm({ ...form, language: v || "en" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English (en)</SelectItem>
                      <SelectItem value="es">Spanish (es)</SelectItem>
                      <SelectItem value="hi">Hindi (hi)</SelectItem>
                      <SelectItem value="ar">Arabic (ar)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Card>

            <Card className="p-6 border-border shadow-sm space-y-6">
              <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">Message Components</h2>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Header (Optional)</Label>
                  <Select value={form.header_format} onValueChange={(v: any) => setForm({ ...form, header_format: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="text">Text Header</SelectItem>
                      <SelectItem value="image">Image Header</SelectItem>
                      <SelectItem value="video">Video Header</SelectItem>
                      <SelectItem value="document">Document Header</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {form.header_format === "text" && (
                  <div className="space-y-2">
                    <Label htmlFor="header_content">Header Text</Label>
                    <Input
                      id="header_content"
                      value={form.header_content}
                      onChange={e => setForm({ ...form, header_content: e.target.value })}
                      placeholder="e.g. Special Discount Announcement"
                      maxLength={TEMPLATE_LIMITS.headerTextMaxLength}
                    />
                  </div>
                )}

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="body_text">Body Message *</Label>
                    <span className="text-xs text-muted-foreground">
                      {form.body_text.length} / {TEMPLATE_LIMITS.bodyMaxLength}
                    </span>
                  </div>
                  <Textarea
                    id="body_text"
                    value={form.body_text}
                    onChange={e => setForm({ ...form, body_text: e.target.value })}
                    placeholder="Hello {{1}}, we have a special offer for you! Order before {{2}} to get 20% off."
                    rows={6}
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Use <code className="bg-muted px-1 rounded">{"{{1}}"}</code>, <code className="bg-muted px-1 rounded">{"{{2}}"}</code> for dynamic customer variables.
                  </p>
                </div>

                <div className="space-y-2 pt-2">
                  <Label htmlFor="footer_text">Footer Text (Optional)</Label>
                  <Input
                    id="footer_text"
                    value={form.footer_text}
                    onChange={e => setForm({ ...form, footer_text: e.target.value })}
                    placeholder="e.g. Reply STOP to unsubscribe"
                    maxLength={TEMPLATE_LIMITS.footerMaxLength}
                  />
                </div>
              </div>
            </Card>

            <div className="flex items-center justify-end gap-4 pt-4">
              <Link href="/settings?tab=templates">
                <Button variant="outline" type="button">Cancel</Button>
              </Link>
              <Button type="submit" disabled={creating} className="min-w-[150px]">
                {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Submit Template
              </Button>
            </div>
          </div>

          {/* Right Col: Live WhatsApp Preview Card */}
          <div className="space-y-6">
            <Card className="p-5 border-border shadow-md bg-[#efeae2] dark:bg-[#0c1317] sticky top-6">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Live WhatsApp Preview
              </div>

              <div className="bg-white dark:bg-[#1f2c34] rounded-lg p-3 shadow-sm border border-border/40 text-sm max-w-sm">
                {form.header_format === "text" && form.header_content && (
                  <div className="font-bold text-foreground mb-1">
                    {form.header_content}
                  </div>
                )}
                {["image", "video", "document"].includes(form.header_format) && (
                  <div className="bg-muted/70 rounded h-28 flex items-center justify-center text-xs text-muted-foreground mb-2 font-medium">
                    [{form.header_format.toUpperCase()} HEADER]
                  </div>
                )}

                <div className="text-foreground whitespace-pre-wrap leading-relaxed">
                  {form.body_text || <span className="text-muted-foreground italic">Type message body to preview...</span>}
                </div>

                {form.footer_text && (
                  <div className="text-[11px] text-muted-foreground mt-2 pt-1 border-t border-border/30">
                    {form.footer_text}
                  </div>
                )}

                <div className="text-[10px] text-muted-foreground text-right mt-1">
                  {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
