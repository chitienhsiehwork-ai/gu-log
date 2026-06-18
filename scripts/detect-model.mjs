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

/**
 * SSOT: the concrete Opus build the floating `opus` alias currently resolves to.
 *
 * Model SELECTION stays on the alias everywhere (`claude -p --model opus`), so a
 * silent Anthropic bump auto-floats the judges to the latest Opus. But RECORDING
 * must stamp the concrete version, never the literal string "opus" — readers and
 * calibration history want "Opus 4.8", not an opaque alias.
 *
 * Most paths capture the concrete id at runtime from Claude Code's own JSON
 * (`claude -p --output-format json` → `.model`); see the Go pipeline's
 * ClaudeProvider.ActualModel(). This constant is the documented fallback for
 * paths that genuinely cannot read runtime metadata (the bash tribunal judge
 * exec writes its score to a file and only greps stdout for quota errors, so it
 * can't cheaply parse JSON metadata). It is used ONLY for recording.
 *
 * ⚠️ BUMP THIS when a newer Opus ships and the `opus` alias moves to it.
 */
export const OPUS_ALIAS_CURRENT = 'claude-opus-4-8';

/**
 * Resolve a model selector to the concrete id used for RECORDING. The literal
 * floating alias "opus" (optionally provider-prefixed, e.g. "anthropic/opus")
 * maps to OPUS_ALIAS_CURRENT; concrete ids and other providers pass through
 * untouched. Selection stays on the alias — only the stamped value resolves.
 */
export function resolveRecordedModelId(selector) {
  if (!selector) return selector;
  const id = selector.includes('/') ? selector.split('/').pop() : selector;
  if (id === 'opus') return OPUS_ALIAS_CURRENT;
  return selector;
}

const MODEL_MAP = {
  // Anthropic
  'claude-opus-4-8': 'Opus 4.8',
  'claude-opus-4-7': 'Opus 4.7',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5': 'Opus 4.5',
  'claude-opus-4': 'Opus 4',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5': 'Sonnet 4.5',
  'claude-sonnet-4': 'Sonnet 4',
  'claude-haiku-4-5': 'Haiku 4.5',
  'claude-haiku-3-5': 'Haiku 3.5',
  // Google
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3-pro': 'Gemini 3 Pro',
  // OpenAI Codex
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.4': 'GPT-5.4',
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

  // Resolve the floating `opus` alias to its concrete build first, so a judge
  // recorded on the alias still displays a concrete "Opus 4.x", never "opus".
  fullModelId = resolveRecordedModelId(fullModelId);

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
  // `--id <selector>` emits the concrete model ID (alias resolved) for the bash
  // recording path to consume; without it, emit the human display name.
  if (process.argv[2] === '--id') {
    console.log(resolveRecordedModelId(process.argv[3] || ''));
    process.exit(0);
  }
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
