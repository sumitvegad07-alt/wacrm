"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, Pencil, RotateCcw } from "lucide-react";

import { archiveAssetAsUser, restoreAssetAsUser } from "@/lib/service/assets/browser";
import { AssetError, type AssetConflict } from "@/lib/service/assets/errors";
import {
  interpretRestoreError,
  newCodeStart,
  validateNewAssetCode,
  type AssetActionGates,
} from "@/lib/service/assets/detail-view";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared";

export interface AssetActionsProps {
  assetId: string;
  assetCode: string;
  assetName: string;
  /** Which buttons to offer. Decided on the server from the viewer's rights (assetActionGates). */
  gates: AssetActionGates;
}

/** The asset the clashing code now belongs to, as a link that opens in a new tab. */
function HolderLink({ holder }: { holder: AssetConflict | null }) {
  if (!holder) return <>another asset</>;
  return (
    <>
      asset{" "}
      <Link
        href={`/service/assets/${holder.id}`}
        target="_blank"
        rel="noopener"
        className="font-medium underline underline-offset-2"
      >
        {holder.asset_code}
      </Link>
    </>
  );
}

/**
 * Edit, Archive and Restore for one asset. The ONLY client part of the detail header.
 *
 * Archive and Restore never go through a form: they are the targeted archiveAsset / restoreAsset
 * calls, so an ordinary save can never post `deleted_at`. The buttons shown come from the server's
 * rights; the database (a trigger requiring delete_service_assets) is still the real gate, and its
 * refusal comes back as a readable message in a toast.
 *
 * Restore has a dead end the dialog below exists to escape: archiving frees an asset's code, a new
 * asset can take it, and a plain restore then collides. The way out is to restore AND re-code in one
 * step, which the database allows for archived rows only.
 */
export function AssetActions({ assetId, assetCode, assetName, gates }: AssetActionsProps) {
  const router = useRouter();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // The new-code dialog. `clash` is set when it opens: the code that collided and who holds it.
  const [recodeOpen, setRecodeOpen] = useState(false);
  const [clash, setClash] = useState<{ code: string | null; holder: AssetConflict | null }>({
    code: null,
    holder: null,
  });
  const [codeInput, setCodeInput] = useState("");
  const [codeError, setCodeError] = useState<React.ReactNode>(null);
  const [recoding, setRecoding] = useState(false);

  const start = newCodeStart(assetCode);

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await archiveAssetAsUser(assetId);
      toast.success(`${assetCode} archived`);
      setArchiveOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof AssetError ? err.message : "Could not archive the asset. Please try again.");
    } finally {
      setArchiving(false);
    }
  };

  const openRecode = (clashingCode: string | null, holder: AssetConflict | null) => {
    setClash({ code: clashingCode ?? assetCode, holder });
    setCodeInput(start);
    setCodeError(null);
    setRecodeOpen(true);
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await restoreAssetAsUser(assetId);
      toast.success(`${assetCode} re-activated`);
      router.refresh();
    } catch (err) {
      const outcome = interpretRestoreError(err);
      if (outcome.kind === "needs-new-code") openRecode(outcome.clashingCode, outcome.holder);
      else toast.error(outcome.message);
    } finally {
      setRestoring(false);
    }
  };

  const handleRecode = async () => {
    const checked = validateNewAssetCode(codeInput, clash.code, start);
    if (!checked.ok) {
      setCodeError(checked.message);
      return;
    }
    setRecoding(true);
    setCodeError(null);
    try {
      const saved = await restoreAssetAsUser(assetId, { newCode: checked.code });
      toast.success(`Re-activated as ${saved.asset_code}`);
      setRecodeOpen(false);
      router.refresh();
    } catch (err) {
      const outcome = interpretRestoreError(err);
      if (outcome.kind === "needs-new-code") {
        // The code just typed is taken too. Say who has it and keep the dialog open.
        setClash({ code: outcome.clashingCode ?? checked.code, holder: outcome.holder });
        setCodeError(
          <>
            {outcome.clashingCode ?? checked.code} is already used by <HolderLink holder={outcome.holder} />. Try a
            different code.
          </>,
        );
      } else {
        setCodeError(outcome.message);
      }
    } finally {
      setRecoding(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {gates.edit && (
          <Link href={`/service/assets/${assetId}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <Pencil className="size-3.5" /> Edit
          </Link>
        )}
        {gates.archive && (
          <Button type="button" variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
            <Archive className="size-3.5" /> Archive
          </Button>
        )}
        {gates.restore && (
          <Button type="button" size="sm" onClick={handleRestore} disabled={restoring}>
            <RotateCcw className="size-3.5" /> {restoring ? "Restoring..." : "Restore"}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Archive Asset"
        description={
          <>
            Archive <span className="font-medium text-foreground">{assetName}</span> ({assetCode})? It moves to
            Inactive and disappears from the default list. You can bring it back any time: tick &ldquo;Show
            Inactive&rdquo; on the list, open it, and press Restore.
          </>
        }
        variant="danger"
        confirmLabel="Archive"
        loading={archiving}
        onConfirm={handleArchive}
      />

      <Dialog
        open={recodeOpen}
        onOpenChange={(open) => {
          if (!recoding) setRecodeOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md p-6" showCloseButton={!recoding}>
          <DialogHeader>
            <DialogTitle>Give this asset a new code</DialogTitle>
            <DialogDescription>
              The code <span className="font-mono font-medium text-foreground">{clash.code ?? assetCode}</span> now
              belongs to <HolderLink holder={clash.holder} />. Two assets cannot share a code, so type a new one
              and this asset will be re-activated with it. The old code stays with the other asset.
            </DialogDescription>
          </DialogHeader>

          <form
            id="recode-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRecode();
            }}
            className="space-y-1.5"
          >
            <Label htmlFor="recode-input" className="text-muted-foreground">
              New asset code
            </Label>
            <Input
              id="recode-input"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value);
                setCodeError(null);
              }}
              disabled={recoding}
              autoFocus
              autoComplete="off"
              aria-invalid={Boolean(codeError) || undefined}
              aria-describedby={codeError ? "recode-error" : undefined}
              className="bg-background font-mono text-foreground"
            />
            {codeError && (
              <p id="recode-error" role="alert" className="text-xs text-destructive">
                {codeError}
              </p>
            )}
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRecodeOpen(false)} disabled={recoding}>
              Cancel
            </Button>
            <Button type="submit" form="recode-form" disabled={recoding}>
              {recoding ? "Restoring..." : "Re-activate with this code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
