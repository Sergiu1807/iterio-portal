import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage, computeTokenCost } from "@/lib/usage";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

export type CallClaudeParams = {
  model?: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  tools?: Anthropic.Tool[];
  toolChoice?: Anthropic.MessageCreateParams["tool_choice"];
  // metering context
  systemKey?: string;
  brandId?: string;
};

/** Metered Anthropic call — records token usage + cost into usage_events. */
export async function callClaude(params: CallClaudeParams): Promise<Anthropic.Message> {
  const apiKey = await getApiKey("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const client = new Anthropic({ apiKey });
  const model = params.model ?? DEFAULT_CLAUDE_MODEL;

  const resp = await client.messages.create({
    model,
    max_tokens: params.maxTokens ?? 4096,
    system: params.system,
    messages: params.messages,
    tools: params.tools,
    tool_choice: params.toolChoice,
    temperature: params.temperature,
  });

  const inT = resp.usage?.input_tokens ?? 0;
  const outT = resp.usage?.output_tokens ?? 0;
  await recordUsage({
    provider: "anthropic",
    systemKey: params.systemKey,
    brandId: params.brandId,
    keyName: "ANTHROPIC_API_KEY",
    model,
    units: { inputTokens: inT, outputTokens: outT },
    costUsd: computeTokenCost(model, inT, outT),
  });

  return resp;
}

/** Extract the input of a forced tool_use block (structured-output pattern). */
export function toolResult<T>(resp: Anthropic.Message, toolName?: string): T | null {
  for (const block of resp.content) {
    if (block.type === "tool_use" && (!toolName || block.name === toolName)) {
      return block.input as T;
    }
  }
  return null;
}

/** Concatenate any text blocks in a response. */
export function textOf(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
