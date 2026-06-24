"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, AlertTriangle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { confidenceMeta } from "./ui-utils";
import { AssetUploader } from "./asset-uploader";
import type { IntelRow } from "./ui-types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = Record<string, any>;
const clone = (o: unknown): Any => JSON.parse(JSON.stringify(o ?? {}));
const linesToArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const arrToLines = (a?: string[]) => (a ?? []).join("\n");

export function B3Editor({ row, brandId, readOnly, onReload }: { row: IntelRow; brandId: string; readOnly?: boolean; onReload: () => void }) {
  const [b3, setB3] = useState<Any>(() => clone(row.json));
  const version = row.version;
  const conf = (row.confidenceJson ?? {}) as Record<string, number>;
  const gaps = row.gapsJson ?? [];

  const commit = async (path: string, value: unknown) => {
    if (readOnly) return;
    const res = await fetch("/api/brand-foundation/b3", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, version, path, value }),
    });
    if (!res.ok) {
      toast.error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? "Save failed — reloading");
      onReload();
    }
  };

  // edit a field locally (no commit); commit the whole section on blur (reads current b3 from closure)
  const editField = (section: string, field: string, val: unknown) => setB3((p) => ({ ...p, [section]: { ...(p[section] ?? {}), [field]: val } }));
  const commitSection = (section: string) => commit(section, b3[section]);
  // commit a computed field value immediately (line-array fields)
  const commitField = (section: string, field: string, val: unknown) => {
    const next = { ...(b3[section] ?? {}), [field]: val };
    setB3((p) => ({ ...p, [section]: next }));
    commit(section, next);
  };
  // replace a whole section (object-array sections); commit immediately
  const setSection = (section: string, val: unknown) => {
    setB3((p) => ({ ...p, [section]: val }));
    commit(section, val);
  };

  const ConfBadge = ({ section }: { section: string }) => {
    const m = confidenceMeta(conf[section]);
    return m ? <Badge variant={m.variant}>{m.label}</Badge> : null;
  };

  return (
    <div className="space-y-4">
      {gaps.length > 0 && (
        <BentoCard className="brand-wash space-y-1 p-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" /> {gaps.length} gap{gaps.length === 1 ? "" : "s"} flagged — fill these for a stronger foundation
          </p>
          <ul className="ml-5 list-disc text-xs text-muted-foreground">
            {gaps.map((g, i) => (
              <li key={i}><span className="font-medium text-foreground/80">{g.field}</span>: {g.reason}</li>
            ))}
          </ul>
        </BentoCard>
      )}

      <Tabs defaultValue="snapshot">
        <TabsList className="flex-wrap">
          {[
            ["snapshot", "Snapshot"], ["positioning", "Positioning"], ["personas", "Personas"], ["triggers", "Triggers"],
            ["proof", "Proof"], ["offers", "Offers"], ["products", "Products"], ["voice", "Voice"],
            ["creative", "Creative DNA"], ["winners", "Winners"], ["compliance", "Compliance"], ["channels", "Channels"], ["gaps", "Gaps"],
          ].map(([v, l]) => (
            <TabsTrigger key={v} value={v}>{l}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="snapshot">
          <Card title="Brand snapshot" badge={<ConfBadge section="brand_snapshot" />}>
            <Txt label="Name" v={b3.brand_snapshot?.name} on={(x) => editField("brand_snapshot", "name", x)} blur={() => commitSection("brand_snapshot")} ro={readOnly} />
            <Txt label="Category" v={b3.brand_snapshot?.category} on={(x) => editField("brand_snapshot", "category", x)} blur={() => commitSection("brand_snapshot")} ro={readOnly} />
            <Txt label="One-liner" v={b3.brand_snapshot?.one_liner} on={(x) => editField("brand_snapshot", "one_liner", x)} blur={() => commitSection("brand_snapshot")} ro={readOnly} />
            <Area label="Mission" v={b3.brand_snapshot?.mission} on={(x) => editField("brand_snapshot", "mission", x)} blur={() => commitSection("brand_snapshot")} ro={readOnly} />
            <Area label="Founder story" v={b3.brand_snapshot?.founder_story} on={(x) => editField("brand_snapshot", "founder_story", x)} blur={() => commitSection("brand_snapshot")} ro={readOnly} />
          </Card>
        </TabsContent>

        <TabsContent value="positioning">
          <Card title="Positioning" badge={<ConfBadge section="positioning" />}>
            <Area label="Statement" v={b3.positioning?.statement} on={(x) => editField("positioning", "statement", x)} blur={() => commitSection("positioning")} ro={readOnly} />
            <Lines label="Differentiators (one per line)" v={b3.positioning?.differentiators} commit={(arr) => commitField("positioning", "differentiators", arr)} ro={readOnly} />
            <Txt label="Category belief" v={b3.positioning?.category_belief} on={(x) => editField("positioning", "category_belief", x)} blur={() => commitSection("positioning")} ro={readOnly} />
            <Txt label="Enemy" v={b3.positioning?.enemy} on={(x) => editField("positioning", "enemy", x)} blur={() => commitSection("positioning")} ro={readOnly} />
            <Txt label="Price tier" v={b3.positioning?.price_tier} on={(x) => editField("positioning", "price_tier", x)} blur={() => commitSection("positioning")} ro={readOnly} />
          </Card>
        </TabsContent>

        <TabsContent value="personas">
          <ObjArray title="Personas" badge={<ConfBadge section="personas" />} items={b3.personas ?? []} onChange={(a) => setSection("personas", a)} ro={readOnly}
            blank={{ name: "", demographics: "", pains: [], desires: [], objections: [], their_words: [] }}
            fields={[
              { k: "name", label: "Name", kind: "text" }, { k: "demographics", label: "Demographics", kind: "text" },
              { k: "psychographics", label: "Psychographics", kind: "area" }, { k: "pains", label: "Pains", kind: "lines" },
              { k: "desires", label: "Desires", kind: "lines" }, { k: "objections", label: "Objections", kind: "lines" },
              { k: "their_words", label: "Their words (verbatim)", kind: "lines" },
            ]}
            titleOf={(it) => it.name || "Persona"} />
        </TabsContent>

        <TabsContent value="triggers">
          <Card title="Emotional triggers" badge={<ConfBadge section="emotional_triggers" />}>
            <Lines label="One trigger per line" v={b3.emotional_triggers} commit={(arr) => setSection("emotional_triggers", arr)} ro={readOnly} />
          </Card>
        </TabsContent>

        <TabsContent value="proof">
          <ObjArray title="Proof mechanisms" badge={<ConfBadge section="proof_mechanisms" />} items={b3.proof_mechanisms ?? []} onChange={(a) => setSection("proof_mechanisms", a)} ro={readOnly}
            blank={{ type: "", detail: "", evidence: "" }}
            fields={[{ k: "type", label: "Type", kind: "text" }, { k: "detail", label: "Detail", kind: "area" }, { k: "evidence", label: "Evidence", kind: "text" }]}
            titleOf={(it) => it.type || it.detail || "Proof"} />
        </TabsContent>

        <TabsContent value="offers">
          <ObjArray title="Offers" badge={<ConfBadge section="offers" />} items={b3.offers ?? []} onChange={(a) => setSection("offers", a)} ro={readOnly}
            blank={{ name: "", pricing: "", subscription: "", promo: "" }}
            fields={[{ k: "name", label: "Name", kind: "text" }, { k: "pricing", label: "Pricing", kind: "text" }, { k: "subscription", label: "Subscription", kind: "text" }, { k: "promo", label: "Promo", kind: "text" }]}
            titleOf={(it) => it.name || "Offer"} />
        </TabsContent>

        <TabsContent value="products">
          <ObjArray title="Products" badge={<ConfBadge section="products" />} items={b3.products ?? []} onChange={(a) => setSection("products", a)} ro={readOnly}
            blank={{ name: "", format: "", price: "", ingredients: [], claims_made: [], is_hero: false }}
            fields={[
              { k: "name", label: "Name", kind: "text" }, { k: "format", label: "Format", kind: "text" }, { k: "price", label: "Price", kind: "text" },
              { k: "ingredients", label: "Ingredients", kind: "lines" }, { k: "claims_made", label: "Claims made", kind: "lines" }, { k: "is_hero", label: "Hero product", kind: "bool" },
            ]}
            titleOf={(it) => it.name || "Product"} />
        </TabsContent>

        <TabsContent value="voice">
          <Card title="Voice profile" badge={<ConfBadge section="voice_profile" />}>
            <Txt label="Tone" v={b3.voice_profile?.tone} on={(x) => editField("voice_profile", "tone", x)} blur={() => commitSection("voice_profile")} ro={readOnly} />
            <Txt label="Sentence style" v={b3.voice_profile?.sentence_style} on={(x) => editField("voice_profile", "sentence_style", x)} blur={() => commitSection("voice_profile")} ro={readOnly} />
            <Lines label="Vocabulary" v={b3.voice_profile?.vocabulary} commit={(arr) => commitField("voice_profile", "vocabulary", arr)} ro={readOnly} />
            <Lines label="Banned words" v={b3.voice_profile?.banned_words} commit={(arr) => commitField("voice_profile", "banned_words", arr)} ro={readOnly} />
            <Lines label="Examples" v={b3.voice_profile?.examples} commit={(arr) => commitField("voice_profile", "examples", arr)} ro={readOnly} />
          </Card>
        </TabsContent>

        <TabsContent value="creative">
          <Card title="Creative DNA" badge={<ConfBadge section="creative_dna" />}>
            <Area label="Visual style" v={b3.creative_dna?.visual_style} on={(x) => editField("creative_dna", "visual_style", x)} blur={() => commitSection("creative_dna")} ro={readOnly} />
            <Lines label="Do" v={b3.creative_dna?.do} commit={(arr) => commitField("creative_dna", "do", arr)} ro={readOnly} />
            <Lines label="Don't" v={b3.creative_dna?.dont} commit={(arr) => commitField("creative_dna", "dont", arr)} ro={readOnly} />
          </Card>
          <div className="mt-3 space-y-2">
            <Label>Brand assets</Label>
            <AssetUploader brandId={brandId} />
          </div>
        </TabsContent>

        <TabsContent value="winners">
          <ObjArray title="Competitor winners" badge={<ConfBadge section="winner_patterns" />} items={b3.winner_patterns?.competitor ?? []} onChange={(a) => setSection("winner_patterns", { ...(b3.winner_patterns ?? {}), competitor: a })} ro={readOnly}
            blank={{ angle: "", hook: "", why_it_wins: "" }}
            fields={[{ k: "angle", label: "Angle", kind: "text" }, { k: "hook", label: "Hook", kind: "text" }, { k: "why_it_wins", label: "Why it wins", kind: "area" }]}
            titleOf={(it) => it.angle || it.hook || "Pattern"} />
          <div className="h-3" />
          <ObjArray title="Our winners" items={b3.winner_patterns?.own ?? []} onChange={(a) => setSection("winner_patterns", { ...(b3.winner_patterns ?? {}), own: a })} ro={readOnly}
            blank={{ angle: "", hook: "", why_it_wins: "" }}
            fields={[{ k: "angle", label: "Angle", kind: "text" }, { k: "hook", label: "Hook", kind: "text" }, { k: "why_it_wins", label: "Why it wins", kind: "area" }]}
            titleOf={(it) => it.angle || it.hook || "Pattern"} />
        </TabsContent>

        <TabsContent value="compliance">
          <Card title="Compliance" badge={<ConfBadge section="compliance" />}>
            <Area label="Summary" v={b3.compliance?.summary} on={(x) => editField("compliance", "summary", x)} blur={() => commitSection("compliance")} ro={readOnly} />
            <Lines label="Banned phrasings" v={b3.compliance?.banned_phrasings} commit={(arr) => commitField("compliance", "banned_phrasings", arr)} ro={readOnly} />
            <Lines label="Required disclaimers" v={b3.compliance?.required_disclaimers} commit={(arr) => commitField("compliance", "required_disclaimers", arr)} ro={readOnly} />
          </Card>
        </TabsContent>

        <TabsContent value="channels">
          <ObjArray title="Channels" badge={<ConfBadge section="channels" />} items={b3.channels ?? []} onChange={(a) => setSection("channels", a)} ro={readOnly}
            blank={{ channel: "", notes: "", what_works: "" }}
            fields={[{ k: "channel", label: "Channel", kind: "text" }, { k: "notes", label: "Notes", kind: "area" }, { k: "what_works", label: "What works natively", kind: "area" }]}
            titleOf={(it) => it.channel || "Channel"} />
        </TabsContent>

        <TabsContent value="gaps">
          <Card title="Gap analysis & founder intent" badge={<ConfBadge section="gap_analysis" />}>
            <Lines label="Unmet desires" v={b3.gap_analysis?.unmet_desires} commit={(arr) => commitField("gap_analysis", "unmet_desires", arr)} ro={readOnly} />
            <Lines label="Whitespace angles" v={b3.gap_analysis?.whitespace_angles} commit={(arr) => commitField("gap_analysis", "whitespace_angles", arr)} ro={readOnly} />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── shared field components ─────────────────────────────────────────────────
function Card({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <BentoCard className="space-y-3 p-5">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-base font-medium">{title}</h3>
        {badge}
      </div>
      {children}
    </BentoCard>
  );
}

function Txt({ label, v, on, blur, ro }: { label: string; v?: string; on: (x: string) => void; blur: () => void; ro?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={v ?? ""} onChange={(e) => on(e.target.value)} onBlur={blur} disabled={ro} />
    </div>
  );
}
function Area({ label, v, on, blur, ro }: { label: string; v?: string; on: (x: string) => void; blur: () => void; ro?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Textarea value={v ?? ""} onChange={(e) => on(e.target.value)} onBlur={blur} disabled={ro} className="min-h-[72px]" />
    </div>
  );
}
function Lines({ label, v, commit, ro }: { label: string; v?: string[]; commit: (arr: string[]) => void; ro?: boolean }) {
  const [text, setText] = useState(arrToLines(v));
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={() => commit(linesToArr(text))} disabled={ro} className="min-h-[72px]" />
    </div>
  );
}

type FieldCfg = { k: string; label: string; kind: "text" | "area" | "lines" | "bool" };
function ObjArray({
  title, badge, items, onChange, blank, fields, titleOf, ro,
}: {
  title: string; badge?: React.ReactNode; items: Any[]; onChange: (a: Any[]) => void;
  blank: Any; fields: FieldCfg[]; titleOf: (it: Any) => string; ro?: boolean;
}) {
  const [local, setLocal] = useState<Any[]>(() => items);
  const editLocal = (i: number, k: string, val: unknown) => setLocal((p) => p.map((it, j) => (j === i ? { ...it, [k]: val } : it)));
  const persistWith = (next: Any[]) => { setLocal(next); onChange(next); };

  return (
    <Card title={title} badge={badge}>
      {local.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
      <div className="space-y-3">
        {local.map((it, i) => (
          <div key={i} className="space-y-2.5 rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{titleOf(it)}</span>
              {!ro && (
                <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => persistWith(local.filter((_, j) => j !== i))} aria-label="Remove">
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
            {fields.map((f) =>
              f.kind === "bool" ? (
                <label key={f.k} className="flex items-center gap-2 text-sm">
                  <Switch checked={!!it[f.k]} onCheckedChange={(c) => { if (!ro) persistWith(local.map((x, j) => (j === i ? { ...x, [f.k]: c } : x))); }} /> {f.label}
                </label>
              ) : f.kind === "lines" ? (
                <Lines key={f.k} label={f.label} v={it[f.k]} commit={(arr) => persistWith(local.map((x, j) => (j === i ? { ...x, [f.k]: arr } : x)))} ro={ro} />
              ) : f.kind === "area" ? (
                <Area key={f.k} label={f.label} v={it[f.k]} on={(x) => editLocal(i, f.k, x)} blur={() => onChange(local)} ro={ro} />
              ) : (
                <Txt key={f.k} label={f.label} v={it[f.k]} on={(x) => editLocal(i, f.k, x)} blur={() => onChange(local)} ro={ro} />
              )
            )}
          </div>
        ))}
      </div>
      {!ro && (
        <Button size="sm" variant="outline" onClick={() => persistWith([...local, { ...blank }])}>
          <Plus className="size-4" /> Add
        </Button>
      )}
    </Card>
  );
}
