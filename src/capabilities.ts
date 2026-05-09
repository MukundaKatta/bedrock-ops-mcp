/**
 * Static capability table for AWS Bedrock foundation models, ported from
 * the Python bedrock-ops _capability_data.py. Sourced from AWS Bedrock
 * model documentation as of 2026-04-30.
 *
 * Data is treated as configuration, not API: new models added in patch
 * releases. Add via `registerModel()` for a model not yet in the table.
 */

export interface ModelCapabilities {
  model_id: string;
  family: string;
  max_input_tokens: number;
  max_output_tokens: number;
  supports_vision: boolean;
  supports_tool_use: boolean;
  supports_prompt_cache: boolean;
  supports_thinking: boolean;
  supports_streaming: boolean;
  supports_cross_region_inference: boolean;
  available_regions: ReadonlyArray<string>;
}

const US_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2'] as const;
const US_PLUS_EU = [
  ...US_REGIONS,
  'eu-central-1',
  'eu-west-1',
  'eu-west-3',
] as const;
const US_EU_AP = [
  ...US_PLUS_EU,
  'ap-southeast-1',
  'ap-northeast-1',
  'ap-south-1',
] as const;

const TABLE = new Map<string, ModelCapabilities>();

function add(cap: ModelCapabilities): void {
  TABLE.set(cap.model_id, cap);
}

// Anthropic Claude family
add({
  model_id: 'anthropic.claude-sonnet-4-20250514-v1:0',
  family: 'anthropic.claude',
  max_input_tokens: 200_000,
  max_output_tokens: 64_000,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: true,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_EU_AP,
});

add({
  model_id: 'anthropic.claude-opus-4-20250514-v1:0',
  family: 'anthropic.claude',
  max_input_tokens: 200_000,
  max_output_tokens: 32_000,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: true,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

add({
  model_id: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
  family: 'anthropic.claude',
  max_input_tokens: 200_000,
  max_output_tokens: 64_000,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: true,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_PLUS_EU,
});

add({
  model_id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  family: 'anthropic.claude',
  max_input_tokens: 200_000,
  max_output_tokens: 8_192,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_EU_AP,
});

add({
  model_id: 'anthropic.claude-3-5-haiku-20241022-v1:0',
  family: 'anthropic.claude',
  max_input_tokens: 200_000,
  max_output_tokens: 8_192,
  supports_vision: false,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

// Amazon Nova family
add({
  model_id: 'amazon.nova-pro-v1:0',
  family: 'amazon.nova',
  max_input_tokens: 300_000,
  max_output_tokens: 5_000,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

add({
  model_id: 'amazon.nova-lite-v1:0',
  family: 'amazon.nova',
  max_input_tokens: 300_000,
  max_output_tokens: 5_000,
  supports_vision: true,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

add({
  model_id: 'amazon.nova-micro-v1:0',
  family: 'amazon.nova',
  max_input_tokens: 128_000,
  max_output_tokens: 5_000,
  supports_vision: false,
  supports_tool_use: true,
  supports_prompt_cache: true,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

// Mistral
add({
  model_id: 'mistral.mistral-large-2407-v1:0',
  family: 'mistral',
  max_input_tokens: 128_000,
  max_output_tokens: 8_192,
  supports_vision: false,
  supports_tool_use: true,
  supports_prompt_cache: false,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: false,
  available_regions: ['us-west-2', 'eu-west-3'],
});

// Meta Llama
add({
  model_id: 'meta.llama3-3-70b-instruct-v1:0',
  family: 'meta.llama',
  max_input_tokens: 128_000,
  max_output_tokens: 2_048,
  supports_vision: false,
  supports_tool_use: true,
  supports_prompt_cache: false,
  supports_thinking: false,
  supports_streaming: true,
  supports_cross_region_inference: true,
  available_regions: US_REGIONS,
});

const CROSS_REGION_PREFIXES = new Set(['us', 'eu', 'apac', 'us-gov']);

function stripCrossRegionPrefix(modelId: string): string {
  const idx = modelId.indexOf('.');
  if (idx === -1) return modelId;
  const head = modelId.slice(0, idx);
  if (CROSS_REGION_PREFIXES.has(head)) {
    return modelId.slice(idx + 1);
  }
  return modelId;
}

export function lookupCapabilities(modelId: string): ModelCapabilities | null {
  const bare = stripCrossRegionPrefix(modelId);
  return TABLE.get(bare) ?? null;
}

export function listKnownModels(): string[] {
  return Array.from(TABLE.keys()).sort();
}

export function registerModel(cap: ModelCapabilities): void {
  TABLE.set(cap.model_id, cap);
}
