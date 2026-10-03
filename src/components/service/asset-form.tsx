"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Lock, Package } from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { PERMISSIONS } from "@/lib/auth/permissions-registry";
import type { AssetDetail } from "@/lib/service/assets/api";
import { createAssetAsUser, updateAssetAsUser } from "@/lib/service/assets/browser";
import { ASSET_STATUSES } from "@/lib/service/assets/filters";
import {
  buildCreateInput,
  buildUpdateInput,
  customerLabel,
  describeSaveError,
  firstErrorField,
  initialValues,
  localIsoDate,
  validateAssetForm,
  type AssetFormErrors,
  type AssetFormField,
  type AssetFormValues,
} from "@/lib/service/assets/form-model";
import { assetStatusLabel, type FilterOption } from "@/lib/service/assets/list-view";
import type { AssetFormLookups } from "@/lib/service/assets/lookups";
import type { AssetStatus, CustomerAsset } from "@/lib/service/types";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { FormActions, FormPageShell, FormSection, PageLoader } from "@/components/shared";
import { TerritoryPicker } from "@/components/territories/territory-picker";
import { CustomerFilter as CustomerPicker, type CustomerOption } from "@/components/service/customer-filter";

const LIST_HREF = "/service/assets";

export interface AssetFormProps {
  /** Present = edit this asset; absent = create. The detail row, so the customer and product names are already joined. */
  asset?: AssetDetail;
  /** Lock the customer (the form was opened from that customer's page). The field becomes read-only. */
  lockedContactId?: string;
  /** What to call the locked customer. Falls back to "Selected customer" when the caller has no label. */
  lockedContactLabel?: string;
  /** The current account. The server page supplies it; the form never reads it from the client. */
  accountId: string;
  /** Picker data, loaded on the server by loadAssetFormLookups. */
  lookups: AssetFormLookups;
  /**
   * Called with the saved row instead of navigating. Omit it and the form goes back to the asset
   * list. A host that embeds the form (a panel, a dialog) passes this and `onCancel`.
   */
  onSaved?: (asset: CustomerAsset) => void;
  /** Called by Cancel and the back arrow. Defaults to the asset list. */
  onCancel?: () => void;
}

type SerialClash = { serial: string | undefined; conflictId: string | null; conflictCode: string | null; message: string };

const NATIVE_SELECT =
  "h-9 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

/** The same option list, plus the saved value when it is no longer offered (an archived type, an inactive product). */
function withCurrent(options: FilterOption[], id: string | null | undefined, name: string | null | undefined): FilterOption[] {
  if (!id || options.some((o) => o.value === id)) return options;
  return [{ value: id, label: name?.trim() ? `${name.trim()} (inactive)` : "Current value (inactive)" }, ...options];
}

function Field({
  name,
  label,
  required,
  error,
  hint,
  children,
}: {
  name: string;
  label: string;
  required?: boolean;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div id={`asset-field-${name}`} className="space-y-1.5">
      <Label htmlFor={`asset-input-${name}`} className="text-muted-foreground">
        {label} {required && <span className="text-red-400">*</span>}
      </Label>
      {children}
      {error ? (
        <p id={`asset-error-${name}`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Move the user to the first thing they need to fix. */
function focusField(name: AssetFormField) {
  const wrap = document.getElementById(`asset-field-${name}`);
  if (!wrap) return;
  wrap.scrollIntoView({ block: "center", behavior: "smooth" });
  wrap.querySelector<HTMLElement>("input, textarea, select, button")?.focus({ preventScroll: true });
}

export function AssetForm({
  asset,
  lockedContactId,
  lockedContactLabel,
  accountId,
  lookups,
  onSaved,
  onCancel,
}: AssetFormProps) {
  const router = useRouter();
  const { hasPermission, profile, profileLoading } = useAuth();

  const isEdit = Boolean(asset);
  const canSave = hasPermission(isEdit ? PERMISSIONS.SERVICE_ASSETS.EDIT : PERMISSIONS.SERVICE_ASSETS.CREATE);

  const [values, setValues] = useState<AssetFormValues>(() => initialValues(asset, lockedContactId));
  const [customer, setCustomer] = useState<CustomerOption | null>(() => {
    if (lockedContactId) return { id: lockedContactId, label: lockedContactLabel?.trim() || "Selected customer" };
    if (!asset) return null;
    // The joined contact is null when this viewer's data scope hides it. The id is still real.
    return {
      id: asset.contact_id,
      label: asset.contact ? customerLabel(asset.contact) : "Customer (not visible to you)",
    };
  });

  // Validation only starts showing after the first Save click, then follows every keystroke.
  // `checkedOn` is the device date that click happened on (so render never reads the clock).
  const [checkedOn, setCheckedOn] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<AssetFormErrors>({});
  const [serialClash, setSerialClash] = useState<SerialClash | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [territoryKey, setTerritoryKey] = useState(0);
  const [territoryNotice, setTerritoryNotice] = useState(false);

  const validation = useMemo<AssetFormErrors>(
    () => (checkedOn ? validateAssetForm(values, checkedOn) : {}),
    [values, checkedOn],
  );
  const errors: AssetFormErrors = { ...validation, ...serverErrors };

  const assetTypes = useMemo(
    () => withCurrent(lookups.assetTypes, asset?.asset_type_id, asset?.asset_type?.name),
    [lookups.assetTypes, asset?.asset_type_id, asset?.asset_type?.name],
  );
  const products = useMemo(
    () => withCurrent(lookups.products, asset?.product_id, asset?.product?.name),
    [lookups.products, asset?.product_id, asset?.product?.name],
  );

  const set = <K extends AssetFormField>(field: K, value: AssetFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    // An error the server gave about a field is stale the moment that field changes.
    setServerErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field]; // delete, not `= undefined`: an undefined key would mask a live validation error in the merge below
      return next;
    });
    if (field === "serial_no") setSerialClash(null);
  };

  const goBack = () => (onCancel ? onCancel() : router.push(LIST_HREF));

  const handleSave = async () => {
    if (saving || !canSave) return;

    const today = localIsoDate();
    setCheckedOn(today);
    setBanner(null);
    setServerErrors({});
    setSerialClash(null);

    // Everything the database would refuse that we can know without asking it: no request is sent.
    const found = validateAssetForm(values, today);
    const first = firstErrorField(found);
    if (first) {
      focusField(first);
      return;
    }

    setSaving(true);
    try {
      let saved: CustomerAsset;
      if (asset) {
        const patch = buildUpdateInput(values, asset);
        if (Object.keys(patch).length === 0) {
          toast.info("Nothing was changed.");
          setSaving(false);
          return;
        }
        saved = await updateAssetAsUser(asset.id, patch);
      } else {
        saved = await createAssetAsUser(buildCreateInput(values, { accountId, createdBy: profile?.id ?? null }));
      }

      toast.success(isEdit ? `Saved ${saved.asset_code}` : `Asset ${saved.asset_code} created`);
      // `saving` stays true on success: the page is about to change, and re-enabling Save here would
      // let a fast second click create the same asset twice.
      if (onSaved) onSaved(saved);
      else {
        router.push(LIST_HREF);
        router.refresh();
      }
    } catch (err) {
      setSaving(false);
      const failure = describeSaveError(err);
      if (failure.kind === "banner" && failure.log) console.error("[asset-form] save failed:", err);
      if (failure.kind === "duplicate_serial") {
        setSerialClash({
          serial: failure.serial,
          conflictId: failure.conflict?.id ?? null,
          conflictCode: failure.conflict?.asset_code ?? null,
          message: failure.message,
        });
        focusField("serial_no");
      } else if (failure.kind === "field") {
        setServerErrors({ [failure.field]: failure.message });
        focusField(failure.field);
      } else {
        setBanner(failure.message);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  // ── Gate: who may be here ────────────────────────────────────────────────────
  const shell = (children: React.ReactNode, footer?: React.ReactNode) => (
    <FormPageShell
      icon={Package}
      title={isEdit ? `Edit Asset${asset ? ` ${asset.asset_code}` : ""}` : "Add Asset"}
      subtitle={
        isEdit
          ? "Update this asset's details."
          : "Record a machine or product installed at a customer's site."
      }
      onBack={goBack}
      footer={footer}
    >
      {children}
    </FormPageShell>
  );

  // `profileLoading` first: until the role loads, hasPermission() is false for everyone, and a
  // legitimate user must not see a flash of "no permission" (or a Save they cannot yet use).
  if (profileLoading) return shell(<PageLoader text="Loading..." minHeight="min-h-[160px]" />);

  if (!canSave) {
    return shell(
      <Alert>
        <AlertTriangle className="size-4 text-amber-600" />
        <AlertTitle>{isEdit ? "You can't edit assets" : "You can't add assets"}</AlertTitle>
        <AlertDescription>
          Your role does not include the &ldquo;{isEdit ? "edit" : "create"} service assets&rdquo; permission. Ask
          an administrator to turn it on for your role.
        </AlertDescription>
      </Alert>,
      <FormActions onCancel={goBack} cancelLabel="Back" saveDisabled onSave={() => undefined} saveLabel={isEdit ? "Save Changes" : "Create Asset"} />,
    );
  }

  const territoryLocked = Boolean(asset?.territory_id);
  const showTerritoryPicker = lookups.territories.length > 0;

  return shell(
    <fieldset disabled={saving} className="m-0 min-w-0 space-y-8 border-0 p-0">
      {banner && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Could not save</AlertTitle>
          <AlertDescription>{banner}</AlertDescription>
        </Alert>
      )}

      {lookups.failures.length > 0 && (
        <Alert>
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle>Some lists could not be loaded</AlertTitle>
          <AlertDescription>
            Could not load {lookups.failures.join(", ")}. You can still save, but those pickers may be empty.
            Refresh the page to try again.
          </AlertDescription>
        </Alert>
      )}

      {asset?.deleted_at && (
        <Alert>
          <AlertTriangle className="size-4 text-amber-600" />
          <AlertTitle>This asset is Inactive</AlertTitle>
          <AlertDescription>
            Your changes will be saved, but it stays hidden from the default list until it is re-activated.
          </AlertDescription>
        </Alert>
      )}

      <FormSection title="Identity">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
          {asset && (
            <Field name="asset_code" label="Asset code" hint="Assigned automatically and cannot be changed.">
              <div
                id="asset-input-asset_code"
                className="flex h-9 items-center rounded-md border border-border bg-muted px-2.5 font-mono text-sm text-foreground"
              >
                {asset.asset_code}
              </div>
            </Field>
          )}

          <Field name="contact_id" label="Customer" required error={errors.contact_id}>
            {lockedContactId ? (
              <div
                id="asset-input-contact_id"
                className="flex h-9 items-center gap-2 rounded-md border border-border bg-muted px-2.5 text-sm text-foreground"
              >
                <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{customer?.label}</span>
                <span className="sr-only">(locked)</span>
              </div>
            ) : (
              <CustomerPicker
                id="asset-input-contact_id"
                value={customer}
                onChange={(next) => {
                  if (!next) return;
                  setCustomer(next);
                  set("contact_id", next.id);
                }}
                clearable={false}
                invalid={Boolean(errors.contact_id)}
                placeholder="Search by name or phone"
                className="h-9 w-full bg-background text-sm"
              />
            )}
          </Field>

          <Field name="name" label="Asset name" required error={errors.name}>
            <Input
              id="asset-input-name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Water purifier"
              aria-invalid={Boolean(errors.name) || undefined}
              aria-describedby={errors.name ? "asset-error-name" : undefined}
              className="bg-background text-foreground"
            />
          </Field>

          <Field
            name="asset_type_id"
            label="Asset type"
            hint={assetTypes.length === 0 && !lookups.failures.includes("asset types") ? "No asset types are set up yet." : undefined}
          >
            <SearchableSelect
              options={assetTypes}
              value={values.asset_type_id}
              onChange={(v) => set("asset_type_id", v)}
              placeholder="Select asset type"
              searchPlaceholder="Search asset types..."
              emptyMessage="No asset types found."
              className="h-9 bg-background"
            />
          </Field>

          <Field name="product_id" label="Product">
            <SearchableSelect
              options={products}
              value={values.product_id}
              onChange={(v) => set("product_id", v)}
              placeholder="Select product"
              searchPlaceholder="Search products..."
              emptyMessage="No products found."
              className="h-9 bg-background"
            />
          </Field>

          <Field name="make" label="Make">
            <Input
              id="asset-input-make"
              value={values.make}
              onChange={(e) => set("make", e.target.value)}
              className="bg-background text-foreground"
            />
          </Field>

          <Field name="model_no" label="Model no.">
            <Input
              id="asset-input-model_no"
              value={values.model_no}
              onChange={(e) => set("model_no", e.target.value)}
              className="bg-background text-foreground"
            />
          </Field>

          <Field
            name="serial_no"
            label="Serial no."
            error={
              serialClash ? (
                serialClash.conflictId && serialClash.conflictCode ? (
                  <>
                    {serialClash.serial ? `Serial ${serialClash.serial}` : "That serial number"} already exists on asset{" "}
                    <Link
                      href={`/service/assets/${serialClash.conflictId}`}
                      target="_blank"
                      rel="noopener"
                      className="font-medium underline underline-offset-2"
                    >
                      {serialClash.conflictCode}
                    </Link>
                  </>
                ) : (
                  serialClash.message
                )
              ) : (
                errors.serial_no
              )
            }
          >
            <Input
              id="asset-input-serial_no"
              value={values.serial_no}
              onChange={(e) => set("serial_no", e.target.value)}
              aria-invalid={Boolean(serialClash || errors.serial_no) || undefined}
              aria-describedby={serialClash || errors.serial_no ? "asset-error-serial_no" : undefined}
              className="bg-background text-foreground"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Lifecycle">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2 lg:grid-cols-4">
          <Field name="installation_date" label="Installation date" error={errors.installation_date}>
            <Input
              id="asset-input-installation_date"
              type="date"
              value={values.installation_date}
              onChange={(e) => set("installation_date", e.target.value)}
              aria-invalid={Boolean(errors.installation_date) || undefined}
              aria-describedby={errors.installation_date ? "asset-error-installation_date" : undefined}
              className="bg-background text-foreground"
            />
          </Field>

          <Field name="warranty_start" label="Warranty start" error={errors.warranty_start}>
            <Input
              id="asset-input-warranty_start"
              type="date"
              value={values.warranty_start}
              onChange={(e) => set("warranty_start", e.target.value)}
              aria-invalid={Boolean(errors.warranty_start) || undefined}
              className="bg-background text-foreground"
            />
          </Field>

          <Field name="warranty_end" label="Warranty end" error={errors.warranty_end}>
            <Input
              id="asset-input-warranty_end"
              type="date"
              value={values.warranty_end}
              onChange={(e) => set("warranty_end", e.target.value)}
              aria-invalid={Boolean(errors.warranty_end) || undefined}
              aria-describedby={errors.warranty_end ? "asset-error-warranty_end" : undefined}
              className="bg-background text-foreground"
            />
          </Field>

          <Field name="status" label="Status">
            <select
              id="asset-input-status"
              className={NATIVE_SELECT}
              value={values.status}
              onChange={(e) => set("status", e.target.value as AssetStatus)}
            >
              {ASSET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {assetStatusLabel(s)}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Placement">
        <div className="grid grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
          <Field name="site_label" label="Site label" hint="Where at the customer's site, e.g. Kitchen or 2nd floor.">
            <Input
              id="asset-input-site_label"
              value={values.site_label}
              onChange={(e) => set("site_label", e.target.value)}
              className="bg-background text-foreground"
            />
          </Field>

          <div id="asset-field-territory_id" className="space-y-1.5 md:col-span-2">
            <Label className="text-muted-foreground">Territory</Label>
            {showTerritoryPicker ? (
              <TerritoryPicker
                key={territoryKey}
                rows={lookups.territories}
                settings={lookups.territorySettings}
                value={values.territory_id || null}
                onChange={(id) => {
                  // A territory can be changed but not removed: once set, the database refills a blank
                  // one from the customer, so "clear" would silently do nothing. Put the picker back.
                  if (id === null && territoryLocked) {
                    setTerritoryNotice(true);
                    setTerritoryKey((k) => k + 1);
                    return;
                  }
                  setTerritoryNotice(false);
                  set("territory_id", id ?? "");
                }}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {lookups.failures.includes("territories")
                  ? "Territories could not be loaded."
                  : "No territories are set up yet."}
              </p>
            )}
            <p className={territoryNotice ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs text-muted-foreground"}>
              {territoryLocked
                ? "Pick a different territory to move this asset. A territory can be changed but not removed."
                : "Inherited from the customer if left blank."}
            </p>
          </div>
        </div>
      </FormSection>

      <FormSection title="Notes">
        <Field name="notes" label="Notes">
          <Textarea
            id="asset-input-notes"
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={4}
            placeholder="Anything the technician should know about this asset."
            className="bg-background text-foreground"
          />
        </Field>
      </FormSection>
    </fieldset>,
    <FormActions
      onCancel={goBack}
      onSave={handleSave}
      saving={saving}
      saveLabel={isEdit ? "Save Changes" : "Create Asset"}
    />,
  );
}
