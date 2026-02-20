#!/usr/bin/env node
/**
 * Model name mapping for translatedBy.model field.
 *
 * Usage in sub-agent task prompts:
 *   "Run `node scripts/detect-model.mjs` to get the correct model name for frontmatter"
 *
 * Or import the mapping:
 *   import { formatModelName } from './scripts/detect-model.mjs';
 */

const MODEL_MAP = {
  // Anthropic
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-opus-4': 'Opus 4',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4': 'Sonnet 4',
  'claude-haiku-3-5': 'Haiku 3.5',
  // Google
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
  // OpenAI Codex
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5-codex': 'GPT-5 Codex',
};

/**
 * Convert a full model identifier (e.g. "anthropic/claude-opus-4-6")
 * to a human-friendly name (e.g. "Opus 4.6")
 */
export function formatModelName(fullModelId) {
  if (!fullModelId) return 'Unknown';

  // Strip provider prefix (e.g., "anthropic/")
  const modelId = fullModelId.includes('/') ? fullModelId.split('/').pop() : fullModelId;

  // Direct match
  if (MODEL_MAP[modelId]) return MODEL_MAP[modelId];

  // Partial match
  for (const [key, value] of Object.entries(MODEL_MAP)) {
    if (modelId.includes(key)) return value;
  }

  // Fallback: return the model id cleaned up
  return modelId;
}

// CLI mode: read model from env or stdin
if (process.argv[1]?.endsWith('detect-model.mjs')) {
  const modelArg = process.argv[2] || process.env.OPENCLAW_MODEL || '';
  if (modelArg) {
    console.log(formatModelName(modelArg));
  } else {
    console.log('Usage: node scripts/detect-model.mjs <model-id>');
    console.log('  e.g.: node scripts/detect-model.mjs anthropic/claude-opus-4-6');
    console.log('  Output: Opus 4.6');
    console.log('');
    console.log('Available mappings:');
    for (const [key, value] of Object.entries(MODEL_MAP)) {
      console.log(`  ${key} → ${value}`);
    }
  }
}
