import "server-only";
/**
 * API key management — AES-256-GCM encrypted storage in the api_keys table,
 * with env-var fallback. getApiKey() reads the DB first with NO cache, so an
 * admin update takes effect on the very next call across every system.
 */
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const secret = process.env.API_KEYS_ENCRYPTION_SECRET;
  if (!secret) throw new Error("API_KEYS_ENCRYPTION_SECRET is not set");
  // .trim() guards the documented fleet gotcha: a trailing newline on the env
  // var silently changes the derived key and bricks every stored key.
  return crypto.createHash("sha256").update(secret.trim()).digest();
}

export function encryptKey(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptKey(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted key format");
  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(parts[2], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "••••••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

/** DB-first (client-configured) → env fallback. Empty string if neither. */
export async function getApiKey(keyName: string): Promise<string> {
  try {
    const [row] = await db
      .select()
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.keyName, keyName))
      .limit(1);
    if (row?.encryptedValue) return decryptKey(row.encryptedValue);
  } catch {
    /* DB read failed — fall back to env */
  }
  return (process.env[keyName] || "").trim();
}

/** Key names that currently resolve to a value (DB or env) — drives readiness. */
export async function getConfiguredKeyNames(): Promise<string[]> {
  const names = new Set<string>();
  try {
    const rows = await db.select({ keyName: schema.apiKeys.keyName }).from(schema.apiKeys);
    rows.forEach((r) => names.add(r.keyName));
  } catch {
    /* ignore */
  }
  for (const k of CONFIGURABLE_KEYS) {
    if ((process.env[k.keyName] || "").trim()) names.add(k.keyName);
  }
  return [...names];
}

/** The keys this lab can configure, with metadata for the Admin Panel. */
export const CONFIGURABLE_KEYS = [
  { keyName: "ANTHROPIC_API_KEY", label: "Anthropic Claude", description: "Creative analysis, brief & copy generation across systems." },
  { keyName: "GEMINI_API_KEY", label: "Google Gemini", description: "Vision analysis of competitor video/image creatives." },
  { keyName: "APIFY_TOKEN", label: "Apify", description: "Meta / TikTok / Instagram scrapers for Competitor Research." },
  { keyName: "KIE_AI_API_KEY", label: "Kie AI (image + video)", description: "Nano Banana 2 + GPT Image 2 (Static Ads) and Seedance 2 (Video Generation)." },
] as const;
