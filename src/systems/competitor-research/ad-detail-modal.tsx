"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, Download, Trophy, FileText, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Ad } from "./ui-types";
import { longevityBadge } from "./ui-utils";

export function AdDetailModal({ ad, onClose }: { ad: Ad | null; onClose: () => void }) {
  const [card, setCard] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [mediaError, setMediaError] = useState(false);

  if (!ad) return null;
  const badge = longevityBadge(ad.snapshotDate, ad.adStartDate);
  const snapFmt = ad.snapshotDate ? new Date(ad.snapshotDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const cards = ad.cardUrls ?? [];

  return (
    <Dialog open={!!ad} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0">
        <div className="grid max-h-[85vh] gap-0 md:grid-cols-2">
          {/* Left: media */}
          <div className="flex items-start justify-center bg-surface p-5">
            <div className="w-full">
              {mediaError ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl bg-muted p-6 text-center">
                  <AlertCircle className="size-7 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Media unavailable</p>
                </div>
              ) : ad.videoUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={ad.videoUrl} poster={ad.thumbUrl ?? undefined} controls preload="metadata" className="w-full rounded-xl" onError={() => setMediaError(true)} />
              ) : cards.length > 0 ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cards[card]} alt={`Card ${card + 1}`} className="w-full rounded-xl" onError={() => setMediaError(true)} />
                  <div className="mt-3 flex items-center justify-center gap-3">
                    <button onClick={() => setCard(Math.max(0, card - 1))} disabled={card === 0} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                      <ChevronLeft className="size-5" />
                    </button>
                    <span className="text-xs font-medium text-muted-foreground">Card {card + 1} of {cards.length}</span>
                    <button onClick={() => setCard(Math.min(cards.length - 1, card + 1))} disabled={card === cards.length - 1} className="rounded-full p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30">
                      <ChevronRight className="size-5" />
                    </button>
                  </div>
                </div>
              ) : ad.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ad.thumbUrl} alt="" className="w-full rounded-xl" onError={() => setMediaError(true)} />
              ) : (
                <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-muted p-6">
                  <p className="whitespace-pre-wrap text-center text-sm text-muted-foreground">{ad.displayPrimaryText || "Text ad — no media"}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: details */}
          <div className="max-h-[85vh] space-y-5 overflow-y-auto p-6">
            <div className="space-y-2">
              <h2 className="font-display text-xl font-medium tracking-tight">{ad.creativeAngle || ad.headlineTitle || "Ad details"}</h2>
              {ad.adDescription && <p className="text-sm text-muted-foreground">{ad.adDescription}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{ad.brandPageName ?? "Unknown"}</span>
                {badge && <Badge variant={badge.variant}>{badge.label} · {badge.days}d</Badge>}
                {snapFmt && <span>fetched {snapFmt}</span>}
              </div>
            </div>

            <Section title="Strategy" show={!!(ad.targetPersona || ad.coreMotivation || ad.proofMechanism)}>
              <Row label="Audience" value={ad.targetPersona} />
              <Row label="Motivation" value={ad.coreMotivation} />
              <Row label="Proof" value={ad.proofMechanism} />
            </Section>

            <Section title="Hooks" show={!!(ad.visualHook || ad.spokenHook)}>
              <Row label="Visual" value={ad.visualHook} />
              <Row label="Spoken" value={ad.spokenHook} />
            </Section>

            <Section title="Closing" show={!!ad.outroOffer}>
              <p className="text-sm text-foreground/85">{ad.outroOffer}</p>
            </Section>

            {ad.fullTranscript && (
              <div className="space-y-2">
                <button onClick={() => setTranscriptOpen(!transcriptOpen)} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                  Transcript {transcriptOpen ? "▾" : "▸"}
                </button>
                {transcriptOpen && <p className="whitespace-pre-wrap rounded-xl bg-muted/50 p-3 text-sm text-foreground/85">{ad.fullTranscript}</p>}
              </div>
            )}

            <Section title="Funnel & Copy" show>
              <Row label="Headline" value={ad.headlineTitle} />
              {ad.displayPrimaryText && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Copy: </span>
                  <span className="text-foreground/85">{ad.displayPrimaryText}</span>
                </div>
              )}
              <Row label="CTA" value={ad.ctaButtonType} />
              {ad.destinationUrl && (
                <div className="text-sm">
                  <span className="font-medium text-muted-foreground">Landing: </span>
                  <a href={ad.destinationUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{ad.displayDomain || "link"}</a>
                </div>
              )}
              <Row label="DCO" value={ad.isDco ? "Yes" : "No"} />
            </Section>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              {ad.platformsDisplay && <span>{ad.platformsDisplay}</span>}
              {ad.adLibraryUrl && (
                <Button asChild size="sm" variant="outline">
                  <a href={ad.adLibraryUrl} target="_blank" rel="noreferrer">Ad Library <ExternalLink className="size-3.5" /></a>
                </Button>
              )}
              {(ad.videoUrl || ad.thumbUrl) && (
                <Button asChild size="sm" variant="ghost">
                  <a href={(ad.videoUrl || ad.thumbUrl)!} target="_blank" rel="noreferrer" download>
                    <Download className="size-3.5" /> Download
                  </a>
                </Button>
              )}
              <DeferredAction icon={<Trophy className="size-3.5" />} label="Save to Winners" hint="Coming with the Winners library" />
              <DeferredAction icon={<FileText className="size-3.5" />} label="Generate Brief" hint="Coming with Brief Generation" />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, show, children }: { title: string; show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="text-sm">
      <span className="font-medium text-muted-foreground">{label}: </span>
      <span className="text-foreground/85">{value}</span>
    </div>
  );
}

function DeferredAction({ icon, label, hint }: { icon: React.ReactNode; label: string; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("inline-flex cursor-not-allowed items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground/60")}>
          {icon} {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
