import "server-only";
import { ApifyClient } from "apify-client";
import { getApiKey } from "@/lib/api-keys";
import { recordUsage } from "@/lib/usage";

async function getClient(): Promise<ApifyClient> {
  const token = await getApiKey("APIFY_TOKEN");
  if (!token) throw new Error("APIFY_TOKEN is not configured");
  return new ApifyClient({ token });
}

/** Fire an actor run asynchronously — returns immediately with the run id. */
export async function startApifyRun(
  actorId: string,
  input: Record<string, unknown>
): Promise<{ runId: string; datasetId?: string }> {
  const client = await getClient();
  const run = await client.actor(actorId).start(input);
  return { runId: run.id, datasetId: run.defaultDatasetId };
}

export type ApifyRunInfo = {
  status: string; // READY | RUNNING | SUCCEEDED | FAILED | ABORTED | TIMED-OUT
  datasetId?: string;
  usageUsd: number;
};

export async function getApifyRun(runId: string): Promise<ApifyRunInfo> {
  const client = await getClient();
  const run = await client.run(runId).get();
  return {
    status: run?.status ?? "UNKNOWN",
    datasetId: run?.defaultDatasetId,
    usageUsd: (run as { usageTotalUsd?: number } | undefined)?.usageTotalUsd ?? 0,
  };
}

export async function listApifyDataset<T = Record<string, unknown>>(
  datasetId: string,
  limit = 1000
): Promise<T[]> {
  const client = await getClient();
  const { items } = await client.dataset(datasetId).listItems({ limit, clean: true });
  return items as T[];
}

/** Record the real cost of a finished run (Apify reports usageTotalUsd). */
export async function recordApifyUsage(args: {
  runId: string;
  usageUsd: number;
  systemKey?: string;
  brandId?: string;
}): Promise<void> {
  await recordUsage({
    provider: "apify",
    systemKey: args.systemKey,
    brandId: args.brandId,
    keyName: "APIFY_TOKEN",
    units: {},
    costUsd: args.usageUsd,
    meta: { runId: args.runId },
  });
}
