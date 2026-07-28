"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, MessageSquare, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { extractVariableIndices, TEMPLATE_LIMITS } from "@/lib/whatsapp/template-validators";

export default function EditWhatsAppTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const templateId = resolvedParams.id;
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    category: "Marketing" as "Marketing" | "Utility" | "Authentication",
    language: "en",
    header_format: "none" as "none" | "text" | "image" | "video" | "document",
    header_content: "",
    body_text: "",
    footer_text: ""
  });

  useEffect(() => {
    async function loadTemplate() {
      setLoading(true);
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("id", templateId)
        .single();

      if (error || !data) {
        toast.error("Template not found");
        router.push("/settings?tab=templates");
        return;
      }

      setForm({
        name: data.name || "",
        category: data.category || "Marketing",
        language: data.language || "en",
        header_format: data.header_format || "none",
        header_content: data.header_content || "",
        body_text: data.body_text || "",
        footer_text: data.footer_text || ""
      });
      setLoading(false);
    }
    loadTemplate();
  }, [templateId, supabase, router]);

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.body_text.trim()) {
      toast.error("Body Text is required");
      return;
    }
    if (form.body_text.length > TEMPLATE_LIMITS.bodyMaxLength) {
      toast.error(`Body exceeds maximum limit of ${TEMPLATE_LIMITS.bodyMaxLength} characters`);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("whatsapp_templates")
        .update({
          category: form.category,
          language: form.language,
          header_format: form.header_format === "none" ? null : form.header_format,
          header_content: form.header_content || null,
          body_text: form.body_text,
          footer_text: form.footer_text || null
        })
        .eq("id", templateId);

      if (error) throw error;

      toast.success("WhatsApp template updated successfully");
      router.push("/settings?tab=templates");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to update template");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

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
              <MessageSquare className="w-6 h-6 text-primary" />
              Edit WhatsApp Template: {form.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Modify template content and resubmit for verification.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveTemplate} className="space-y-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Left 2 Cols: Form Editor */}
          <div className="lg:col-span-2 space-y-8">
            <Card className="p-6 border-border shadow-sm space-y-6">
              <h2 className="text-lg font-semibold text-foreground border-b border-border pb-3">General Metadata</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>Template Name</Label>
                  <Input value={form.name} disabled className="bg-muted" />
                  <p className="text-xs text-muted-foreground">Template names cannot be changed after creation.</p>
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
              <Button type="submit" disabled={saving} className="min-w-[150px]">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
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
