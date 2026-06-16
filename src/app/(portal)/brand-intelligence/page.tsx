"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, Star, ExternalLink, Image as ImageIcon, Maximize2 } from "lucide-react";
import { useBrand } from "@/lib/brand-store";
import { uid, cn } from "@/lib/utils";
import type { Brand } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { BentoCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/ui/brand-mark";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { IntelSections } from "@/components/brand/intel-sections";
import { AddResourceDialog } from "@/components/brand/add-resource-dialog";

/** Signed display URLs for product images (1:1 + 9:16), keyed by product id.
 *  Resolved on demand from /api/brands/[id]/product-media — never stored in the
 *  brand object (which keeps the raw storage paths). */
type ProductMedia = Record<string, { image: string | null; video: string | null }>;

export default function BrandIntelligencePage() {
  const { currentBrand, updateBrand, isReady } = useBrand();

  if (!isReady) {
    return <div className="h-64 animate-pulse rounded-[var(--radius)] bg-muted/50" />;
  }
  if (!currentBrand) {
    return <p className="py-20 text-center text-muted-foreground">Add a brand first.</p>;
  }
  const brand = currentBrand;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Brand Intelligence"
        title={brand.name}
        description="The single source of truth every system reads — voice, audience, products, guardrails."
        actions={<BrandMark name={brand.name} color={brand.brandColor} size={52} />}
      />

      <Tabs defaultValue="intel">
        <TabsList className="flex-wrap">
          <TabsTrigger value="intel">Intelligence</TabsTrigger>
          <TabsTrigger value="products">Products ({brand.products.length})</TabsTrigger>
          <TabsTrigger value="audience">Audience ({brand.personas.length})</TabsTrigger>
          <TabsTrigger value="usps">USPs ({brand.usps.length})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors ({brand.competitors.length})</TabsTrigger>
          <TabsTrigger value="identity">Identity</TabsTrigger>
        </TabsList>

        <TabsContent value="intel">
          <IntelSections brand={brand} />
        </TabsContent>

        <TabsContent value="products">
          <ProductsTab brand={brand} />
        </TabsContent>

        <TabsContent value="audience">
          <ResourceHeader
            label="Personas"
            add={
              <AddResourceDialog
                title="Add persona"
                fields={[
                  { name: "name", label: "Name", placeholder: "The Optimizer" },
                  { name: "demographics", label: "Demographics", placeholder: "F, 34–45, urban" },
                  { name: "psychographics", label: "Psychographics", textarea: true },
                  { name: "painPoints", label: "Pain points", textarea: true },
                  { name: "desires", label: "Desires", textarea: true },
                ]}
                onSubmit={(v) =>
                  updateBrand(brand.id, {
                    personas: [...brand.personas, { id: uid("persona"), name: v.name, demographics: v.demographics, psychographics: v.psychographics, painPoints: v.painPoints, desires: v.desires }],
                  })
                }
                trigger={<AddButton />}
              />
            }
          />
          {brand.personas.length === 0 ? (
            <Empty text="No personas yet." />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {brand.personas.map((p) => (
                <BentoCard key={p.id} className="group relative p-5">
                  <RemoveBtn onClick={() => updateBrand(brand.id, { personas: brand.personas.filter((x) => x.id !== p.id) })} />
                  <h3 className="mb-1 font-display text-base font-medium">{p.name}</h3>
                  {p.demographics && <p className="mb-3 text-xs text-muted-foreground">{p.demographics}</p>}
                  <dl className="space-y-2 text-sm">
                    {p.painPoints && <Field label="Pains" value={p.painPoints} />}
                    {p.desires && <Field label="Desires" value={p.desires} />}
                    {p.psychographics && <Field label="Mindset" value={p.psychographics} />}
                  </dl>
                </BentoCard>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="usps">
          <ResourceHeader
            label="USPs"
            add={
              <AddResourceDialog
                title="Add USP"
                fields={[
                  { name: "text", label: "Statement", placeholder: "Third-party tested, transparent doses", textarea: true },
                  { name: "category", label: "Category", placeholder: "Trust" },
                ]}
                onSubmit={(v) =>
                  updateBrand(brand.id, { usps: [...brand.usps, { id: uid("usp"), text: v.text, category: v.category }] })
                }
                trigger={<AddButton />}
              />
            }
          />
          {brand.usps.length === 0 ? (
            <Empty text="No USPs yet." />
          ) : (
            <div className="space-y-2.5">
              {brand.usps.map((u) => (
                <BentoCard key={u.id} className="group relative flex items-center gap-3 p-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Star className="size-3.5" />
                  </span>
                  <div className="flex-1">
                    <p className="text-sm">{u.text}</p>
                  </div>
                  {u.isPrimary && <Badge variant="default">Primary</Badge>}
                  {u.category && <Badge variant="muted">{u.category}</Badge>}
                  <RemoveBtn onClick={() => updateBrand(brand.id, { usps: brand.usps.filter((x) => x.id !== u.id) })} />
                </BentoCard>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="competitors">
          <ResourceHeader
            label="Competitors"
            add={
              <AddResourceDialog
                title="Add competitor"
                fields={[
                  { name: "name", label: "Name", placeholder: "Ritual" },
                  { name: "websiteUrl", label: "Website", placeholder: "https://…" },
                  { name: "instagramHandle", label: "Instagram", placeholder: "@handle" },
                  { name: "type", label: "Type", placeholder: "Direct" },
                ]}
                onSubmit={(v) =>
                  updateBrand(brand.id, {
                    competitors: [...brand.competitors, { id: uid("comp"), name: v.name, websiteUrl: v.websiteUrl, instagramHandle: v.instagramHandle, type: v.type }],
                  })
                }
                trigger={<AddButton />}
              />
            }
          />
          {brand.competitors.length === 0 ? (
            <Empty text="No competitors tracked yet." />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {brand.competitors.map((c) => (
                <BentoCard key={c.id} className="group relative flex items-center gap-3 p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{c.name}</h3>
                      {c.type && <Badge variant="muted">{c.type}</Badge>}
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {c.instagramHandle && <span>{c.instagramHandle}</span>}
                      {c.websiteUrl && (
                        <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                          Site <ExternalLink className="size-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  <RemoveBtn onClick={() => updateBrand(brand.id, { competitors: brand.competitors.filter((x) => x.id !== c.id) })} />
                </BentoCard>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="identity">
          <IdentityTab brand={brand} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ResourceHeader({ label, add }: { label: string; add: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <p className="text-sm text-muted-foreground">{label} feed every system that needs them.</p>
      {add}
    </div>
  );
}

function AddButton() {
  return (
    <Button size="sm" variant="outline">
      <Plus className="size-4" /> Add
    </Button>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
      aria-label="Remove"
    >
      <X className="size-3.5" />
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground/85">{value}</dd>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function ProductsTab({ brand }: { brand: Brand }) {
  const { updateBrand } = useBrand();
  const [media, setMedia] = useState<ProductMedia | null>(null);
  const reSigningRef = useRef(false);

  const fetchMedia = useCallback(async () => {
    const r = await fetch(`/api/brands/${brand.id}/product-media`).catch(() => null);
    if (r && r.ok) setMedia(((await r.json()) as { media: ProductMedia }).media ?? {});
  }, [brand.id]);

  // Load signed image URLs whenever the active brand changes.
  useEffect(() => {
    setMedia(null);
    fetchMedia();
  }, [fetchMedia]);

  // Signed URLs expire (~1h). On an <img> error, re-fetch fresh ones once,
  // collapsing a storm of simultaneous errors into a single request.
  const onReSign = useCallback(() => {
    if (reSigningRef.current) return;
    reSigningRef.current = true;
    fetchMedia().finally(() => {
      setTimeout(() => {
        reSigningRef.current = false;
      }, 3000);
    });
  }, [fetchMedia]);

  return (
    <>
      <ResourceHeader
        label="Products"
        add={
          <AddResourceDialog
            title="Add product"
            fields={[
              { name: "name", label: "Name", placeholder: "Daily Stack" },
              { name: "category", label: "Category", placeholder: "Supplement" },
              { name: "price", label: "Price", placeholder: "$68/mo" },
              { name: "keyBenefits", label: "Key benefits", placeholder: "What it does", textarea: true },
            ]}
            onSubmit={(v) =>
              updateBrand(brand.id, {
                products: [...brand.products, { id: uid("prod"), name: v.name, category: v.category, price: v.price, keyBenefits: v.keyBenefits }],
              })
            }
            trigger={<AddButton />}
          />
        }
      />
      {brand.products.length === 0 ? (
        <Empty text="No products yet." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {brand.products.map((p) => (
            <BentoCard key={p.id} className="group relative p-5">
              <RemoveBtn onClick={() => updateBrand(brand.id, { products: brand.products.filter((x) => x.id !== p.id) })} />
              <ProductImages media={media?.[p.id]} loading={media === null} name={p.name} onReSign={onReSign} />
              <div className="mb-2 flex items-center gap-2">
                <h3 className="font-display text-base font-medium">{p.name}</h3>
                {p.isHero && <Badge variant="accent"><Star className="size-3" /> Hero</Badge>}
              </div>
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {p.category && <Badge variant="muted">{p.category}</Badge>}
                {p.price && <Badge variant="outline">{p.price}</Badge>}
              </div>
              {p.keyBenefits && <p className="text-sm leading-relaxed text-muted-foreground">{p.keyBenefits}</p>}
            </BentoCard>
          ))}
        </div>
      )}
    </>
  );
}

/** The 1:1 (static) + 9:16 (video) product images, side by side. */
function ProductImages({
  media,
  loading,
  name,
  onReSign,
}: {
  media: { image: string | null; video: string | null } | undefined;
  loading: boolean;
  name: string;
  onReSign: () => void;
}) {
  const [zoom, setZoom] = useState<{ src: string; ratio: "1:1" | "9:16" } | null>(null);
  return (
    <>
      <div className="mb-3 flex gap-2">
        <ProductThumb src={media?.image ?? null} ratio="1:1" loading={loading} alt={`${name} — square`} onReSign={onReSign} onZoom={(src) => setZoom({ src, ratio: "1:1" })} />
        <ProductThumb src={media?.video ?? null} ratio="9:16" loading={loading} alt={`${name} — portrait`} onReSign={onReSign} onZoom={(src) => setZoom({ src, ratio: "9:16" })} />
      </div>
      <Dialog open={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-w-md p-3">
          {zoom && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={zoom.src} alt={name} className={cn("mx-auto w-full rounded-xl", zoom.ratio === "9:16" && "max-h-[78vh] w-auto")} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProductThumb({
  src,
  ratio,
  loading,
  alt,
  onReSign,
  onZoom,
}: {
  src: string | null;
  ratio: "1:1" | "9:16";
  loading: boolean;
  alt: string;
  onReSign: () => void;
  onZoom: (src: string) => void;
}) {
  const [errored, setErrored] = useState(false);
  const triedRef = useRef(false);

  // Reset error/retry tracking when a fresh signed URL arrives.
  useEffect(() => {
    setErrored(false);
    triedRef.current = false;
  }, [src]);

  const show = !!src && !errored;
  return (
    <div className={cn("relative h-32 shrink-0 overflow-hidden rounded-xl border border-border/60 bg-muted", ratio === "1:1" ? "aspect-square" : "aspect-[9/16]")}>
      {show ? (
        <button type="button" onClick={() => onZoom(src!)} className="group/thumb block size-full" aria-label={`Expand ${alt}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src!}
            alt={alt}
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover/thumb:scale-105"
            onError={() => {
              if (!triedRef.current) {
                triedRef.current = true;
                onReSign();
              } else {
                setErrored(true);
              }
            }}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-foreground/0 opacity-0 transition-all group-hover/thumb:bg-foreground/15 group-hover/thumb:opacity-100">
            <Maximize2 className="size-4 text-white drop-shadow" />
          </span>
        </button>
      ) : loading ? (
        <div className="size-full animate-pulse bg-muted" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground/40">
          <ImageIcon className="size-5" />
        </div>
      )}
      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-card/85 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground backdrop-blur">{ratio}</span>
    </div>
  );
}

function IdentityTab({ brand }: { brand: Brand }) {
  const { updateBrand } = useBrand();
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <BentoCard className="p-6">
        <h3 className="mb-4 font-display text-base font-medium">Palette</h3>
        <div className="flex flex-wrap gap-3">
          {brand.palette.map((c, i) => (
            <div key={i} className="text-center">
              <div className="size-16 rounded-2xl border border-border/60" style={{ background: c.hex, boxShadow: "var(--inner-light)" }} />
              <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{c.hex}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{c.role}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-1.5">
          <label className="text-[13px] font-medium text-foreground/80">Brand color</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={brand.brandColor}
              onChange={(e) => updateBrand(brand.id, { brandColor: e.target.value })}
              className="size-10 cursor-pointer rounded-lg border border-border bg-transparent"
            />
            <span className="font-mono text-sm text-muted-foreground">{brand.brandColor}</span>
            <span className="text-xs text-muted-foreground">Drives the workspace tint.</span>
          </div>
        </div>
      </BentoCard>

      <BentoCard className="p-6">
        <h3 className="mb-4 font-display text-base font-medium">Identity</h3>
        <dl className="space-y-3 text-sm">
          <IdRow label="Tagline" value={brand.tagline} />
          <IdRow label="Vibe" value={brand.vibe} />
          <IdRow label="Category" value={brand.category} />
          <IdRow label="Market" value={brand.primaryMarket} />
          <IdRow label="Currency" value={brand.currency} />
          <IdRow label="Website" value={brand.website} />
          <IdRow label="Onboarded via" value={brand.onboardingSource} />
        </dl>
      </BentoCard>
    </div>
  );
}

function IdRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex gap-3 border-b border-border/50 pb-2.5 last:border-0">
      <dt className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-foreground/85">{value || "—"}</dd>
    </div>
  );
}
