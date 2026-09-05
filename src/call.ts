import type { Config, ModelProfile } from "./config.js";
import { makeProvider } from "./providers/index.js";
import type { GenerateOptions, GenerateResult } from "./providers/types.js";
import { cloudGate } from "./gate.js";
import { logEvent, recordCost } from "./ledger.js";
import { estimateCostUsd, knownModel, roughTokenEstimate } from "./pricing.js";

/** Thrown when the budget gate refuses a call. Never fall back past this. */
export class GateBlockedError extends Error {
  constructor(reason: string) {
    super(`Cloud call blocked by budget gate: ${reason}`);
    this.name = "GateBlockedError";
  }
}

/**
 * One gated provider call: budget gate → generate → ledger. Cloud calls log a
 * `cloud_call` (approved:false on gate refusal, approved:true on success) and
 * a real-token `cost` event, and print the per-call cost line. Local (ollama)
 * calls skip the gate and cost bookkeeping entirely.
 */
export async function gatedCall(args: {
  config: Config;
  taskId: string;
  profile: ModelProfile;
  prompt: string;
  gen?: GenerateOptions;
}): Promise<GenerateResult> {
  const { config, taskId, profile, prompt, gen } = args;
  const provider = makeProvider(profile, config);
  const model = profile.model ?? "(default)";

  if (provider.isCloud) {
    const estChars = (gen?.system?.length ?? 0) + prompt.length;
    const est = knownModel(model) ? estimateCostUsd(model, roughTokenEstimate(estChars), 2048) : undefined;
    const gate = await cloudGate({ config, taskId, provider: provider.name, model, costEstimateUsd: est });
    if (!gate.allowed) {
      await logEvent({ type: "cloud_call", taskId, provider: provider.name, model, approved: false });
      throw new GateBlockedError(gate.reason);
    }
  }

  const result = await provider.generate(prompt, gen ?? {});

  if (provider.isCloud) {
    await logEvent({ type: "cloud_call", taskId, provider: provider.name, model: result.model, approved: true });
  }
  const line = await recordCost(result, taskId);
  if (line) console.log(line);
  else if (provider.isCloud) console.log(`   cost: (no usage reported by provider)`);

  return result;
}
