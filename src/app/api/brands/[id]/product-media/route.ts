import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/auth";
import { getBrandProductMedia } from "@/lib/brands";

/** Fresh signed URLs for a brand's product images (1:1 + 9:16), keyed by
 *  product id. The bucket is private, so signed URLs expire (~1h); the products
 *  tab fetches this on load and re-fetches on an <img> error to self-heal. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const media = await getBrandProductMedia(id);
  return NextResponse.json({ media });
}
