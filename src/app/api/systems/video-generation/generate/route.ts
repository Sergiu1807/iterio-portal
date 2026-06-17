import { NextResponse, after } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { startVideoBatch, runVideoBatch, type VideoGenOpts } from "@/systems/video-generation/generate";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the prompt pipeline + submit runs in after()

export async function POST(req: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  if (auth.profile.role === "viewer") return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as Partial<VideoGenOpts>;
  if (!b.brandId || !b.videoType) return NextResponse.json({ error: "brandId + videoType required" }, { status: 400 });
  if (b.videoType === "ugc" && !b.productId && !(b.script && b.script.trim())) {
    return NextResponse.json({ error: "UGC needs a product or a script" }, { status: 400 });
  }
  // B-Roll is a product-hero format — it needs a product to render.
  if (b.videoType === "broll" && !b.productId) {
    return NextResponse.json({ error: "B-Roll needs a product" }, { status: 400 });
  }
  // Guard the Kie Seedance 2 param sets so an unsupported value never reaches Kie.
  const VALID_ASPECT = new Set(["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"]);
  const VALID_RES = new Set(["480p", "720p", "1080p"]);
  const VALID_DUR = new Set([5, 10, 15]);
  if (b.aspectRatio && !VALID_ASPECT.has(b.aspectRatio)) return NextResponse.json({ error: `Unsupported aspect ratio: ${b.aspectRatio}` }, { status: 400 });
  if (b.resolution && !VALID_RES.has(b.resolution)) return NextResponse.json({ error: `Unsupported resolution: ${b.resolution}` }, { status: 400 });
  if (b.duration && !VALID_DUR.has(b.duration)) return NextResponse.json({ error: `Unsupported duration: ${b.duration}` }, { status: 400 });

  const opts: VideoGenOpts = {
    brandId: b.brandId,
    videoType: b.videoType,
    arollStyle: b.arollStyle ?? null,
    productId: b.productId ?? null,
    characterIds: b.characterIds ?? [],
    sceneId: b.sceneId ?? null,
    script: b.script ?? null,
    duration: b.duration ?? 10,
    aspectRatio: b.aspectRatio ?? "9:16",
    resolution: b.resolution ?? "720p",
    variationCount: b.variationCount ?? 1,
  };

  try {
    const out = await startVideoBatch(opts);
    after(() => runVideoBatch(out.batchId, opts).catch((e) => console.warn("[video] after() failed", e)));
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 400 });
  }
}
