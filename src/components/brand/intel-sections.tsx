"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Brand, BrandIntelSection } from "@/lib/types";
import { useBrand } from "@/lib/brand-store";
import { uid } from "@/lib/utils";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

export function IntelSections({ brand }: { brand: Brand }) {
  const { updateBrand } = useBrand();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<BrandIntelSection | null>(null);

  const sections = [...brand.sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const isNew = draft ? !brand.sections.some((s) => s.id === draft.id) : false;

  const startNew = () => {
    setDraft({ id: uid("sec"), title: "", sectionType: "custom", content: "", sortOrder: sections.length });
    setOpen(true);
  };
  const startEdit = (s: BrandIntelSection) => {
    setDraft({ ...s });
    setOpen(true);
  };
  const save = () => {
    if (!draft || !draft.title.trim()) return;
    const exists = brand.sections.some((s) => s.id === draft.id);
    const next = exists
      ? brand.sections.map((s) => (s.id === draft.id ? draft : s))
      : [...brand.sections, draft];
    updateBrand(brand.id, { sections: next });
    setOpen(false);
  };
  const remove = () => {
    if (!draft) return;
    updateBrand(brand.id, { sections: brand.sections.filter((s) => s.id !== draft.id) });
    setOpen(false);
  };

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Every system reads these sections at generation time.
        </p>
        <Button size="sm" variant="outline" onClick={startNew}>
          <Plus className="size-4" /> Add section
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <BentoCard key={s.id} className="group flex flex-col p-5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <h3 className="font-display text-base font-medium tracking-tight">{s.title}</h3>
              <button
                onClick={() => startEdit(s)}
                className="rounded-full p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                aria-label="Edit section"
              >
                <Pencil className="size-3.5" />
              </button>
            </div>
            {s.sectionType && (
              <Badge variant="muted" className="mb-3 w-fit">
                {s.sectionType}
              </Badge>
            )}
            <div className="relative max-h-36 overflow-hidden">
              {s.content ? (
                <Markdown>{s.content}</Markdown>
              ) : (
                <p className="text-sm italic text-muted-foreground">No content yet — click to add.</p>
              )}
              {s.content && s.content.length > 220 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
              )}
            </div>
          </BentoCard>
        ))}
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{isNew ? "Add section" : "Edit section"}</SheetTitle>
            <SheetDescription>Markdown supported.</SheetDescription>
          </SheetHeader>
          {draft && (
            <SheetBody className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Brand Voice & Tone"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Input
                  value={draft.sectionType}
                  onChange={(e) => setDraft({ ...draft, sectionType: e.target.value })}
                  placeholder="voice, audience, products…"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Content</Label>
                <Textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  rows={12}
                  className="min-h-[260px] font-mono text-[13px]"
                  placeholder="Write the section content…"
                />
              </div>
            </SheetBody>
          )}
          <SheetFooter>
            {!isNew && (
              <Button variant="ghost" className="mr-auto text-destructive hover:bg-destructive/10" onClick={remove}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save}>Save</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
