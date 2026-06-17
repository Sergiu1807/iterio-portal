"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Sparkles, Upload, Trash2, ChevronDown, RefreshCw, AlertTriangle, CheckCircle2, Wand2, Images, FolderOpen, Settings2 } from "lucide-react";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea, Label } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrand } from "@/lib/brand-store";
import { cn } from "@/lib/utils";
import { CreateTab } from "./create-tab";
import { GalleryTab } from "./gallery-tab";
import { LibraryTab } from "./library-tab";
import { GenActions } from "./result-tile";
import { EditCopyDialog } from "./edit-dialog";
import { isActive } from "./ui-utils";
import type { Generation } from "./ui-types";

type Config = {
  status: string; // placeholder | building | ready | error
  isPlaceholder: boolean;
  builtAt: string | null;
  buildError: string | null;
  agent1Prompt: string;
  agent2Prompt: string;
  briefAgent1Prompt: string | null;
  briefAgent2Prompt: string | null;
  hasLogo: boolean;
  logoUrl: string | null;
} | null;

export default function StaticGenerationSystem({ brandId }: { brandId: string }) {
  const { currentBrand } = useBrand();
  const [config, setConfig] = useState<Config | undefined>(undefined); // undefined = loading
  const [busy, setBusy] = useState(false);

  const loadConfig = useCallback(async () => {
    const r = await fetch(`/api/systems/static-generation/config?brandId=${brandId}`);
    if (r.ok) setConfig(((await r.json()) as { config: Config }).config);
  }, [brandId]);

  useEffect(() => {
    setConfig(undefined);
    loadConfig();
  }, [loadConfig]);

  // Poll while the prompt builder runs.
  useEffect(() => {
    if (config?.status !== "building") return;
    const iv = setInterval(loadConfig, 4000);
    return () => clearInterval(iv);
  }, [config?.status, loadConfig]);

  const runSetup = useCallback(async () => {
    setBusy(true);
    const r = await fetch(`/api/systems/static-generation/setup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId }),
    });
    setBusy(false);
    if (r.ok) {
      toast.success("Researching the brand & authoring the Static agents…");
      loadConfig();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Couldn't start setup");
    }
  }, [brandId, loadConfig]);

  if (config === undefined) {
    return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  }

  // ── Setup gate ──────────────────────────────────────────────────────────
  if (config === null) {
    return (
      <SetupGate
        title="Set up the Static studio"
        body={`We'll research ${currentBrand?.name ?? "this brand"}'s website, enrich its Brand Intelligence, and author this brand's two image agents. Starter prompts work immediately while it runs.`}
        action={
          <Button size="lg" onClick={runSetup} disabled={busy} className="cta-glow">
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Set up Static system
          </Button>
        }
      />
    );
  }

  if (config.status === "building") {
    return <SetupGate building title="Setting up your studio…" body="Researching the brand, enriching its intelligence, and authoring the Static agents. This takes a couple of minutes — you can leave; it keeps running." />;
  }

  // ── Workspace (ready | placeholder | error) ─────────────────────────────
  return (
    <StaticWorkspace
      brandId={brandId}
      brandName={currentBrand?.name}
      config={config}
      reloadConfig={loadConfig}
      onRebuild={runSetup}
      rebuilding={busy}
    />
  );
}

function StaticWorkspace({
  brandId,
  brandName,
  config,
  reloadConfig,
  onRebuild,
  rebuilding,
}: {
  brandId: string;
  brandName?: string;
  config: NonNullable<Config>;
  reloadConfig: () => void;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [editGen, setEditGen] = useState<Generation | null>(null);

  const loadGenerations = useCallback(async () => {
    const r = await fetch(`/api/systems/static-generation/generations?brandId=${brandId}`);
    if (r.ok) setGenerations(((await r.json()) as { generations: Generation[] }).generations);
  }, [brandId]);

  useEffect(() => {
    loadGenerations();
  }, [loadGenerations]);

  const activeCount = useMemo(() => generations.filter(isActive).length, [generations]);

  const renderActions = useCallback(
    (gen: Generation) => (
      <GenActions
        brandId={brandId}
        gen={gen}
        canRefineProduct={!!gen.productId}
        canRefineLogo={config.hasLogo}
        onDone={loadGenerations}
        onEdit={setEditGen}
      />
    ),
    [brandId, config.hasLogo, loadGenerations]
  );

  // Drive in-flight generations forward (cron is the prod backstop).
  useEffect(() => {
    if (activeCount === 0) return;
    let cancelled = false;
    const pump = async () => {
      await fetch(`/api/systems/static-generation/tick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brandId }),
      }).catch(() => {});
      if (!cancelled) await loadGenerations();
    };
    pump();
    const iv = setInterval(pump, 4000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [activeCount, brandId, loadGenerations]);

  return (
    <>
      <Tabs defaultValue="create" className="space-y-5">
        {/* studio top bar */}
        <BentoCard inset={false} className="brand-wash relative overflow-hidden border-border/60 px-5 py-4 md:px-7 md:py-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {brandName ? `${brandName} · Studio` : "Static Studio"}
              </p>
              <h1 className="font-display letterpress text-2xl font-semibold tracking-tight md:text-[28px]">Static Ad Generation</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {activeCount > 0 ? (
                <Badge variant="warning" className="gap-1.5">
                  <Loader2 className="size-3 animate-spin" /> {activeCount} generating
                </Badge>
              ) : (
                <StatusBadge config={config} />
              )}
              <TabsList className="flex-wrap">
                <TabsTrigger value="create"><Wand2 className="size-3.5" /> Create</TabsTrigger>
                <TabsTrigger value="gallery"><Images className="size-3.5" /> Gallery ({generations.length})</TabsTrigger>
                <TabsTrigger value="library"><FolderOpen className="size-3.5" /> Library</TabsTrigger>
                <TabsTrigger value="settings"><Settings2 className="size-3.5" /> Settings</TabsTrigger>
              </TabsList>
            </div>
          </div>
        </BentoCard>

        {config.isPlaceholder && config.status !== "error" && (
          <Banner tone="warning" icon={<AlertTriangle className="size-4" />}>
            Using starter prompts. Open <strong>Settings → Rebuild prompts</strong> to research this brand and author tailored agents.
          </Banner>
        )}
        {config.status === "error" && (
          <Banner tone="error" icon={<AlertTriangle className="size-4" />}>
            Prompt build failed{config.buildError ? `: ${config.buildError}` : ""}. Starter prompts are active — you can still generate, or retry from Settings.
          </Banner>
        )}

        <TabsContent value="create" className="mt-0">
          <CreateTab brandId={brandId} hasLogo={config.hasLogo} generations={generations} reload={loadGenerations} renderActions={renderActions} />
        </TabsContent>
        <TabsContent value="gallery" className="mt-0">
          <GalleryTab generations={generations} reload={loadGenerations} renderActions={renderActions} />
        </TabsContent>
        <TabsContent value="library" className="mt-0">
          <LibraryTab brandId={brandId} />
        </TabsContent>
        <TabsContent value="settings" className="mt-0">
          <SettingsPanel brandId={brandId} config={config} reload={reloadConfig} onRebuild={onRebuild} rebuilding={rebuilding} />
        </TabsContent>
      </Tabs>

      <EditCopyDialog
        brandId={brandId}
        gen={editGen}
        onClose={() => setEditGen(null)}
        onDone={() => {
          setEditGen(null);
          loadGenerations();
        }}
      />
    </>
  );
}

function StatusBadge({ config }: { config: NonNullable<Config> }) {
  if (config.status === "error") return <Badge variant="warning">Starter prompts</Badge>;
  if (config.isPlaceholder) return <Badge variant="muted">Starter prompts</Badge>;
  return (
    <Badge variant="success" className="gap-1.5">
      <CheckCircle2 className="size-3" /> Brand prompts ready
    </Badge>
  );
}

function SetupGate({ title, body, action, building }: { title: string; body: string; action?: React.ReactNode; building?: boolean }) {
  return (
    <div className="py-6">
      <BentoCard
        inset={false}
        className="brand-wash relative mx-auto flex max-w-2xl flex-col items-center gap-5 overflow-hidden border-border/60 px-6 py-20 text-center animate-fade-up"
      >
        <span className={cn("flex size-14 items-center justify-center rounded-2xl bg-accent/14 text-accent shadow-card", building && "cta-glow")}>
          {building ? <Loader2 className="size-7 animate-spin" /> : <Sparkles className="size-7" />}
        </span>
        <div className="space-y-2">
          <h2 className="font-display letterpress text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
        </div>
        {building ? (
          <div className="w-full max-w-sm space-y-2.5 pt-2">
            {["Researching the website", "Enriching brand intelligence", "Authoring the agents"].map((s) => (
              <div key={s} className="flex items-center gap-3">
                <span className="size-1.5 shrink-0 rounded-full bg-accent/60" />
                <span className="h-2 flex-1 rounded-full shimmer" />
                <span className="w-44 shrink-0 text-left text-[11px] text-muted-foreground">{s}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1">{action}</div>
        )}
      </BentoCard>
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "warning" | "error"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm",
        tone === "warning" ? "border-warning/30 bg-warning/8 text-foreground/80" : "border-destructive/30 bg-destructive/8 text-foreground/80"
      )}
    >
      <span className={cn("mt-0.5 shrink-0", tone === "warning" ? "text-warning" : "text-destructive")}>{icon}</span>
      <p>{children}</p>
    </div>
  );
}

// ── Settings: logo + prompt editor + rebuild ──────────────────────────────────

function SettingsPanel({
  brandId,
  config,
  reload,
  onRebuild,
  rebuilding,
}: {
  brandId: string;
  config: NonNullable<Config>;
  reload: () => void;
  onRebuild: () => void;
  rebuilding: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <LogoCard brandId={brandId} config={config} reload={reload} />
      <div className="space-y-3.5">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base font-medium">Brand agents</h3>
          <Button size="sm" variant="outline" onClick={onRebuild} disabled={rebuilding}>
            {rebuilding ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rebuild prompts
          </Button>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Create mode (reference → ad)</p>
        <PromptEditor brandId={brandId} label="Agent 1 — reference analyzer (vision → JSON)" field="agent1Prompt" value={config.agent1Prompt} reload={reload} />
        <PromptEditor brandId={brandId} label="Agent 2 — composer (→ image prompt)" field="agent2Prompt" value={config.agent2Prompt} reload={reload} />
        <hr className="divider-soft my-1" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">Brief mode (text brief → ad)</p>
        <PromptEditor brandId={brandId} label="Brief Agent 1 — brief analyzer (→ JSON)" field="briefAgent1Prompt" value={config.briefAgent1Prompt ?? ""} reload={reload} />
        <PromptEditor brandId={brandId} label="Brief Agent 2 — composer (→ image prompt)" field="briefAgent2Prompt" value={config.briefAgent2Prompt ?? ""} reload={reload} />
      </div>
    </div>
  );
}

function LogoCard({ brandId, config, reload }: { brandId: string; config: NonNullable<Config>; reload: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    const fd = new FormData();
    fd.append("brandId", brandId);
    fd.append("file", file);
    const r = await fetch(`/api/systems/static-generation/logo`, { method: "POST", body: fd });
    setBusy(false);
    if (r.ok) {
      toast.success("Logo saved");
      reload();
    } else {
      toast.error(((await r.json().catch(() => ({}))) as { error?: string })?.error ?? "Upload failed");
    }
  };

  const remove = async () => {
    setBusy(true);
    await fetch(`/api/systems/static-generation/logo?brandId=${brandId}`, { method: "DELETE" });
    setBusy(false);
    reload();
  };

  return (
    <BentoCard className="space-y-3 p-5">
      <h3 className="font-display text-base font-medium">Brand logo</h3>
      <p className="text-xs text-muted-foreground">Used for the “Refine logo” pass and Brief-mode ads.</p>
      <div className="flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted">
        {config.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={config.logoUrl} alt="Brand logo" className="max-h-full max-w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted-foreground/60">No logo yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {config.hasLogo ? "Replace" : "Upload"}
        </Button>
        {config.hasLogo && (
          <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
      </div>
    </BentoCard>
  );
}

function PromptEditor({
  brandId,
  label,
  field,
  value,
  reload,
}: {
  brandId: string;
  label: string;
  field: "agent1Prompt" | "agent2Prompt" | "briefAgent1Prompt" | "briefAgent2Prompt";
  value: string;
  reload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft.trim() !== value.trim();

  const save = async () => {
    setSaving(true);
    const r = await fetch(`/api/systems/static-generation/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brandId, [field]: draft }),
    });
    setSaving(false);
    if (r.ok) {
      toast.success("Prompt saved");
      reload();
    } else {
      toast.error("Save failed");
    }
  };

  return (
    <BentoCard className="p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <Label className="cursor-pointer">{label}</Label>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-[220px] font-mono text-xs leading-relaxed" />
          <div className="flex justify-end">
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      )}
    </BentoCard>
  );
}
