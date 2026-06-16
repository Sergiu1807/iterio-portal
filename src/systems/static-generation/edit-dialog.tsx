"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import type { Generation } from "./ui-types";

type Row = { role: string; original: string; replacement: string };

/** Extract the on-canvas text of a generated ad, edit it, and re-render in place. */
export function EditCopyDialog({
  brandId,
  gen,
  onClose,
  onDone,
}: {
  brandId: string;
  gen: Generation | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gen) return;
    setRows([]);
    setError(null);
    setLoading(true);
    fetch(`/api/systems/static-generation/edit/extract`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, generationId: gen.id }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Could not read the ad");
        const { elements } = (await r.json()) as { elements: { role: string; text: string }[] };
        setRows(elements.map((e) => ({ role: e.role || "text", original: e.text, replacement: e.text })));
      })
      .catch((e) => setError(String(e.message ?? e)))
      .finally(() => setLoading(false));
  }, [gen, brandId]);

  const apply = async () => {
    if (!gen) return;
    const edits = rows.filter((r) => r.replacement.trim() && r.replacement.trim() !== r.original.trim()).map((r) => ({ original: r.original, replacement: r.replacement.trim() }));
    if (edits.length === 0) return toast.error("Change some copy first");
    setApplying(true);
    const r = await fetch(`/api/systems/static-generation/edit/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, generationId: gen.id, edits }),
    });
    setApplying(false);
    if (r.ok) {
      toast.success("Applying copy edits…");
      onDone();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Edit failed");
    }
  };

  return (
    <Dialog open={!!gen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl p-0">
        <div className="grid max-h-[85vh] gap-0 md:grid-cols-2">
          <div className="flex items-start justify-center bg-surface p-5">
            {gen?.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={gen.imageUrl} alt="" className="w-full rounded-xl" />
            )}
          </div>
          <div className="flex max-h-[85vh] flex-col p-6">
            <h2 className="mb-1 flex items-center gap-2 font-display text-lg font-medium">
              <Pencil className="size-4" /> Edit copy
            </h2>
            <p className="mb-4 text-xs text-muted-foreground">Edit the on-canvas text. The layout, style and imagery stay identical; a new edited version is created.</p>

            <div className="flex-1 space-y-3 overflow-y-auto pr-1">
              {loading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Reading the ad…
                </div>
              ) : error ? (
                <p className="py-8 text-sm text-destructive">{error}</p>
              ) : rows.length === 0 ? (
                <p className="py-8 text-sm text-muted-foreground">No editable text found on this image.</p>
              ) : (
                rows.map((row, i) => (
                  <div key={i} className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{row.role}</Label>
                    <Input value={row.replacement} onChange={(e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, replacement: e.target.value } : r)))} />
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-4">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={apply} disabled={applying || loading || rows.length === 0}>
                {applying ? <Loader2 className="size-4 animate-spin" /> : null} Apply edits
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
