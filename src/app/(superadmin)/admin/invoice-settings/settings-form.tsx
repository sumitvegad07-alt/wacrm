"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { GST_STATES, gstStateCodeFromGstin, gstStateName } from "@/lib/gst/states";
import type { InvoiceSettingsRow } from "@/lib/invoices/types";
import { errorMessage } from '@/lib/errors/message';

// ============================================================
// OZZO's seller details, as printed on every invoice.
//
// The signature image goes to the `avatars` bucket under the founder's own user
// id — the same proven path the company-logo upload uses. NOT `document_assets`:
// its insert policy requires the first folder to be an account id the uploader
// is a member of, so a `platform/` prefix there is rejected outright.
// ============================================================

const MAX_IMAGE_BYTES = 1024 * 1024;
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const BLANK: InvoiceSettingsRow = {
  firm_name: "",
  address: "",
  pincode: "",
  state: "",
  gst_state_code: "",
  gstin: "",
  pan: "",
  phone: "",
  email: "",
  bank_name: "",
  bank_account_no: "",
  ifsc: "",
  upi_id: "",
  declaration:
    "We declare that this invoice shows the actual price of the services described and that all particulars are true and correct.",
  default_terms: "",
  signature_url: null,
  logo_url: null,
  next_gst_seq_override: null,
  next_non_gst_seq_override: null,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-6 space-y-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function SettingsForm() {
  const { user } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<InvoiceSettingsRow>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [missingTable, setMissingTable] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/admin/invoice-settings");
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Before the migration has been applied there is no table to read.
        if (String(payload?.error ?? "").includes("platform_invoice_settings")) {
          setMissingTable(true);
        } else {
          toast.error(payload?.error ?? "Could not load the invoice settings");
        }
        setLoading(false);
        return;
      }

      if (payload?.settings) {
        setData({ ...BLANK, ...payload.settings });
      }
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const set = <K extends keyof InvoiceSettingsRow>(key: K, value: InvoiceSettingsRow[K]) =>
    setData((prev) => ({ ...prev, [key]: value }));

  const onPickState = (name: string) => {
    const match = GST_STATES.find((s) => s.name === name);
    setData((prev) => ({
      ...prev,
      state: name,
      // Name and code are always set together — the pairing the order module
      // depends on to decide intra- versus inter-state.
      gst_state_code: match?.code ?? "",
    }));
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error("Unsupported image type. Use PNG, JPG or WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image is too large. Maximum 1 MB.");
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingSignature(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  async function save() {
    setSaving(true);
    try {
      let signatureUrl = data.signature_url;

      if (pendingSignature && user) {
        const ext = pendingSignature.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${user.id}/invoice-signature-${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, pendingSignature, {
            cacheControl: "3600",
            upsert: true,
            contentType: pendingSignature.type,
          });
        if (uploadError) throw new Error(`Signature upload failed: ${uploadError.message}`);

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(path);
        signatureUrl = publicUrl;
      }

      const res = await fetch("/api/admin/invoice-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, signature_url: signatureUrl }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error ?? "Could not save the invoice settings");

      setData((prev) => ({ ...prev, signature_url: signatureUrl }));
      setPendingSignature(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      toast.success("Invoice settings saved");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save the invoice settings"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invoice settings…
      </div>
    );
  }

  if (missingTable) {
    return (
      <div className="max-w-xl bg-card border border-border rounded-xl p-6 space-y-2">
        <h1 className="text-lg font-semibold">Invoice settings</h1>
        <p className="text-sm text-muted-foreground">
          The invoices migration has not been applied to the database yet. Run{" "}
          <code className="text-xs">
            supabase/migrations/20261020120000_platform_invoices.sql
          </code>{" "}
          and reload this page.
        </p>
      </div>
    );
  }

  // The GSTIN wins: the API derives the state code from it on save.
  const gstinState = gstStateName(gstStateCodeFromGstin(data.gstin));
  const stateMismatch =
    !!gstinState && !!data.state && gstinState !== data.state ? gstinState : null;

  const currentSignature = previewUrl ?? data.signature_url;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/invoices"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Invoices
          </Link>
          <h1 className="text-2xl font-bold mt-1">Invoice Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your own details, as printed on every invoice.
          </p>
        </div>
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save
        </Button>
      </div>

      <Section title="Firm">
        <Field label="Firm name" wide>
          <Input
            value={data.firm_name}
            onChange={(e) => set("firm_name", e.target.value)}
            placeholder="OZZO Technologies"
          />
        </Field>
        <Field label="Address" wide>
          <Textarea
            value={data.address}
            onChange={(e) => set("address", e.target.value)}
            rows={2}
          />
        </Field>
        <Field label="Pincode">
          <Input value={data.pincode} onChange={(e) => set("pincode", e.target.value)} />
        </Field>
        <Field
          label="State"
          hint="Decides whether a customer in the same state is charged CGST + SGST or IGST."
        >
          <select
            value={data.state}
            onChange={(e) => onPickState(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option value="">Select a state…</option>
            {GST_STATES.map((s) => (
              <option key={s.code} value={s.name}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Phone">
          <Input value={data.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="Email">
          <Input value={data.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
      </Section>

      <Section title="Tax">
        <Field
          label="GSTIN"
          hint={
            stateMismatch ? (
              <span className="text-amber-600 dark:text-amber-400">
                This GSTIN belongs to {stateMismatch}, not the state selected above. The GSTIN
                wins — it is what decides the tax split.
              </span>
            ) : (
              "15 characters. Its first two digits are your state code."
            )
          }
        >
          <Input
            value={data.gstin}
            onChange={(e) => set("gstin", e.target.value.toUpperCase())}
            placeholder="24AAAAA0000A1Z5"
          />
        </Field>
        <Field label="PAN">
          <Input
            value={data.pan}
            onChange={(e) => set("pan", e.target.value.toUpperCase())}
            placeholder="AAAAA0000A"
          />
        </Field>
      </Section>

      <Section title="Bank">
        <Field label="Bank name">
          <Input value={data.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
        </Field>
        <Field label="Account number">
          <Input
            value={data.bank_account_no}
            onChange={(e) => set("bank_account_no", e.target.value)}
          />
        </Field>
        <Field label="IFSC">
          <Input
            value={data.ifsc}
            onChange={(e) => set("ifsc", e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="UPI ID">
          <Input value={data.upi_id} onChange={(e) => set("upi_id", e.target.value)} />
        </Field>
      </Section>

      <Section title="Document">
        <Field label="Declaration" wide>
          <Textarea
            value={data.declaration}
            onChange={(e) => set("declaration", e.target.value)}
            rows={2}
          />
        </Field>
        <Field
          label="Default terms"
          wide
          hint="Pre-filled on a new invoice. Editable per invoice."
        >
          <Textarea
            value={data.default_terms}
            onChange={(e) => set("default_terms", e.target.value)}
            rows={3}
            placeholder="Payment due within 7 days. Subscription is non-refundable once activated."
          />
        </Field>

        <Field label="Signature" wide hint="PNG, JPG or WebP, up to 1 MB.">
          <div className="flex items-center gap-4">
            {currentSignature ? (
              // Not next/image: this is a user-uploaded public URL whose
              // dimensions are unknown, and the print template renders the same
              // plain <img> so the two match.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentSignature}
                alt="Authorised signature"
                className="h-16 w-auto max-w-[200px] object-contain border border-border rounded bg-white p-1"
              />
            ) : (
              <span className="text-sm text-muted-foreground">No signature uploaded</span>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onPickFile}
              className="hidden"
            />
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Choose image
            </Button>
            {currentSignature ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setPendingSignature(null);
                  set("signature_url", null);
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Remove
              </Button>
            ) : null}
          </div>
        </Field>

        <Field
          label="Next GST invoice number"
          hint="Leave blank unless you have already issued invoices this financial year outside OZZO. The series never goes backwards, so a number already passed is ignored."
        >
          <Input
            type="number"
            min={1}
            value={data.next_gst_seq_override ?? ""}
            onChange={(e) =>
              set(
                "next_gst_seq_override",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </Field>
        <Field label="Next non-GST invoice number" hint="Same, for the B series.">
          <Input
            type="number"
            min={1}
            value={data.next_non_gst_seq_override ?? ""}
            onChange={(e) =>
              set(
                "next_non_gst_seq_override",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </Field>
      </Section>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}
