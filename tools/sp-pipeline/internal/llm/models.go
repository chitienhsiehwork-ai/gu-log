// Package llm is the dispatcher layer around the external language model
// CLIs the pipeline calls — claude, codex, and gemini.
//
// Design notes:
//
//   - Each provider is a thin wrapper around exec.CommandContext. There is
//     no API client, no auth plumbing, no HTTP. The surrounding CLIs
//     (installed by the user) handle their own authentication, and we
//     inherit whatever credentials they already have.
//   - A Dispatcher composes a fallback chain. The default chain is Claude
//     Opus primary → Codex GPT-5.4 fallback, matching the current bash
//     script's "--opus mode is the default, Codex is the escape hatch"
//     behaviour.
//   - Canary probes (sp-pipeline doctor --probe-llm) send a single short
//     prompt through each provider independently, reporting which ones
//     respond non-interactively. This is the load-bearing early warning
//     that will catch the "claude -p wants a TTY in a non-TTY subprocess"
//     failure mode identified during the planning pass.
package llm

// ModelID is an enum-ish string identifying a specific model build.
// Keep this in sync with scripts/sp-pipeline.sh's model_display_name().
type ModelID string

const (
	ModelClaudeOpus   ModelID = "claude-opus"
	ModelGemini31Pro  ModelID = "gemini-3.1-pro-preview"
	ModelGPT54        ModelID = "gpt-5.4"
	ModelGPT53Codex   ModelID = "gpt-5.3-codex"
	ModelClaudeSonnet ModelID = "claude-sonnet"
	ModelClaudeHaiku  ModelID = "claude-haiku"
)

// DisplayName returns the human-readable model name the validator expects
// in translatedBy.model. Unknown IDs pass through unchanged so the caller
// fails loudly at validation time instead of silently truncating.
func DisplayName(m ModelID) string {
	switch m {
	case ModelClaudeOpus:
		return "Opus 4.6"
	case ModelClaudeSonnet:
		return "Sonnet 4.6"
	case ModelClaudeHaiku:
		return "Haiku 4.5"
	case ModelGemini31Pro:
		return "Gemini 3.1 Pro"
	case ModelGPT54:
		return "GPT-5.4"
	case ModelGPT53Codex:
		return "GPT-5.3-Codex"
	default:
		return string(m)
	}
}

// HarnessName returns the harness that drives a given model when shelled out
// from the pipeline. Mirrors scripts/sp-pipeline.sh's model_harness_name.
func HarnessName(m ModelID) string {
	switch m {
	case ModelClaudeOpus, ModelClaudeSonnet, ModelClaudeHaiku:
		return "Claude Code CLI"
	case ModelGemini31Pro:
		return "Gemini CLI"
	case ModelGPT54, ModelGPT53Codex:
		return "Codex CLI"
	default:
		return "Unknown Harness"
	}
}
