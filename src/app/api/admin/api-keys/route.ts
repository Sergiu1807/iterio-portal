import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAdmin, isAuthError } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { CONFIGURABLE_KEYS, encryptKey, getApiKey, maskKey } from "@/lib/api-keys";
import { systemsForKey } from "@/lib/infra";

export async function GET() {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

  const keys = await Promise.all(
    CONFIGURABLE_KEYS.map(async (k) => {
      const value = await getApiKey(k.keyName);
      const inDb = (await db.select({ id: schema.apiKeys.id, updatedAt: schema.apiKeys.updatedAt, updatedBy: schema.apiKeys.updatedBy }).from(schema.apiKeys).where(eq(schema.apiKeys.keyName, k.keyName)).limit(1))[0];
      return {
        keyName: k.keyName,
        label: k.label,
        description: k.description,
        configured: !!value,
        masked: value ? maskKey(value) : null,
        source: inDb ? "custom" : value ? "env" : "not_set",
        updatedAt: inDb?.updatedAt ?? null,
        updatedBy: inDb?.updatedBy ?? null,
        systems: systemsForKey(k.keyName),
      };
    })
  );
  return NextResponse.json({ keys });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  const { keyName, value } = (await req.json()) as { keyName?: string; value?: string };
  if (!keyName || !CONFIGURABLE_KEYS.some((k) => k.keyName === keyName)) {
    return NextResponse.json({ error: "Unknown key" }, { status: 400 });
  }
  if (!value?.trim()) {
    return NextResponse.json({ error: "Value required" }, { status: 400 });
  }
  const meta = CONFIGURABLE_KEYS.find((k) => k.keyName === keyName)!;
  await db
    .insert(schema.apiKeys)
    .values({
      keyName,
      encryptedValue: encryptKey(value.trim()),
      label: meta.label,
      description: meta.description,
      updatedBy: auth.profile.email ?? auth.user.id,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: schema.apiKeys.keyName,
      set: {
        encryptedValue: encryptKey(value.trim()),
        updatedBy: auth.profile.email ?? auth.user.id,
        updatedAt: new Date(),
      },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  const { keyName } = (await req.json()) as { keyName?: string };
  if (!keyName) return NextResponse.json({ error: "keyName required" }, { status: 400 });
  await db.delete(schema.apiKeys).where(eq(schema.apiKeys.keyName, keyName));
  return NextResponse.json({ ok: true });
}
