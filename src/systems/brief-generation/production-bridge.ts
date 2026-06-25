// Brief → Production handoff. Reuses the existing remake-prefill key the Static/Video
// create-tabs consume: VIDEO works as-is (script prefill); STATIC uses a brief-mode
// payload the Static create-tab reads (small additive reader, mode:"brief").
import type { Brief } from "./ui-types";
import type { VideoBriefJson, StaticBriefJson } from "./types";

const REMAKE_PREFILL_KEY = "iterio:remake-prefill";

function videoScriptText(j: VideoBriefJson): string {
  const parts: string[] = [];
  if (j.hook_frame) parts.push(`HOOK: ${j.hook_frame}`);
  if (Array.isArray(j.scene_list)) for (const s of j.scene_list) { if (s.vo) parts.push(s.vo); else if (s.on_screen_text) parts.push(s.on_screen_text); }
  else if (Array.isArray(j.script)) for (const b of j.script) { if (b.vo) parts.push(b.vo); }
  if (j.cta_frame) parts.push(`CTA: ${j.cta_frame}`);
  return parts.join("\n");
}

function staticBriefText(j: StaticBriefJson): string {
  const frames = Array.isArray(j.frames) ? j.frames : [];
  return frames
    .map((f, i) => [`Frame ${i + 1}`, f.headline ? `Headline: ${f.headline}` : "", f.subhead ? `Subhead: ${f.subhead}` : "", f.layout ? `Layout: ${f.layout}` : "", f.product_placement ? `Product: ${f.product_placement}` : "", f.proof_element ? `Proof: ${f.proof_element}` : "", f.cta ? `CTA: ${f.cta}` : ""].filter(Boolean).join("\n"))
    .join("\n\n");
}

export async function sendBriefToProduction(brief: Brief): Promise<void> {
  const j = (brief.briefJson ?? {}) as VideoBriefJson & StaticBriefJson;
  const compliance = { pass: brief.complianceNotesJson?.flag !== "banned", failures: brief.complianceNotesJson?.notes ?? [] };
  if (brief.format === "video") {
    sessionStorage.setItem(REMAKE_PREFILL_KEY, JSON.stringify({ target: "video", brandId: brief.brandId, conceptId: brief.id, script: videoScriptText(j), productId: brief.productId, videoType: "ugc", duration: 15, aspectRatio: "9:16", resolution: "720p", variationCount: 1, compliance }));
  } else {
    sessionStorage.setItem(REMAKE_PREFILL_KEY, JSON.stringify({ target: "static", mode: "brief", brandId: brief.brandId, conceptId: brief.id, briefText: staticBriefText(j), productId: brief.productId, compliance }));
  }
}
