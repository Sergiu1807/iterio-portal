import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { callClaude as callClaudeCore, textOf } from "@/lib/providers/claude";
import { SYSTEM_KEY } from "./constants";

/**
 * LLM shims for the ported video pipeline. The Adly pipeline calls two helpers
 * (callGPT for the GPT steps, callClaude for the Claude steps); here both route
 * to Iterio's single metered Claude provider — so no OpenAI dependency. EN-only.
 */
export type Language = "en";

function mapModel(model?: string): string | undefined {
  if (!model) return undefined;
  if (model.includes("opus")) return "claude-opus-4-8"; // current opus (ported code names 4-6)
  if (model.includes("sonnet")) return "claude-sonnet-4-6";
  return undefined; // fall to provider default
}

/** Ported `callGPT({systemPrompt, userMessage})` → Claude. */
export async function callGPT({ systemPrompt, userMessage }: { systemPrompt: string; userMessage: string; model?: string }): Promise<string> {
  const resp = await callClaudeCore({
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    maxTokens: 8000,
    systemKey: SYSTEM_KEY,
  });
  return textOf(resp).trim();
}

type PortedMessage = { role: "user" | "assistant"; content: string | Anthropic.ContentBlockParam[] };

/** Ported `callClaude({system, messages, model, maxTokens, budgetTokens})` → {text}. */
export async function callClaude(opts: {
  system: string;
  messages: PortedMessage[];
  maxTokens?: number;
  budgetTokens?: number; // ignored (no extended thinking)
  model?: string;
}): Promise<{ text: string }> {
  const resp = await callClaudeCore({
    system: opts.system,
    messages: opts.messages as Anthropic.MessageParam[],
    maxTokens: opts.maxTokens ?? 4000,
    model: mapModel(opts.model),
    timeoutMs: 180_000,
    systemKey: SYSTEM_KEY,
  });
  return { text: textOf(resp).trim() };
}
