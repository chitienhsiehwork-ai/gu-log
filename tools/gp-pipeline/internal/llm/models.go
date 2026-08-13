// Package llm is the dispatcher layer around the external language model
// CLIs the pipeline can call. Writing prefers the pinned Claude writer when
// available and otherwise uses Codex; judges default to Codex with an explicit
// Claude fallback policy. Gemini is available only for experiments.
//
// Design notes:
//
//   - Each provider is a thin wrapper around exec.CommandContext. There is
//     no API client, no auth plumbing, no HTTP. The surrounding CLIs
//     (installed by the user) handle their own authentication, and we
//     inherit whatever credentials they already have.
//   - A Dispatcher composes a fallback chain. The default chain is Codex
//     GPT-5.5 primary, matching the current local Codex actor workflow where Codex CLI
//     is the maintained local LLM harness.
//   - Canary probes (gp-pipeline doctor --probe-llm) send a single short
//     prompt through each provider independently, reporting which ones
//     respond non-interactively. This is the load-bearing early warning
//     that will catch CLI auth / non-interactive execution failures before a
//     long writing run spends real credits.
package llm

import (
	"regexp"
	"strings"
)

// ModelID is an enum-ish string identifying a specific model build.
// Display names were ported from the retired bash pipeline's model_display_name().
type ModelID string

const (
	ModelClaudeOpus   ModelID = "claude-opus"
	ModelGemini31Pro  ModelID = "gemini-3.1-pro-preview"
	ModelGPT55        ModelID = "gpt-5.5"
	ModelGPT56Sol     ModelID = "gpt-5.6-sol"
	ModelGPT56Luna    ModelID = "gpt-5.6-luna"
	ModelGrok46       ModelID = "grok-4.6"
	ModelGPT54        ModelID = "gpt-5.4"
	ModelGPT53Codex   ModelID = "gpt-5.3-codex"
	ModelClaudeSonnet ModelID = "claude-sonnet"
	ModelClaudeHaiku  ModelID = "claude-haiku"
)

// claudeFamilyRe matches concrete Claude build ids. The minor version is
// optional because the Claude 5 generation ships whole-number release names
// ("claude-opus-5", "claude-sonnet-5") while the 4.x line is major-minor
// ("claude-opus-4-5"). Without the optional group a 5-generation id falls
// through to DisplayName's default branch (raw id into provenance) and to
// HarnessName's "Unknown Harness" — both silent breakages.
var claudeFamilyRe = regexp.MustCompile(`claude-(opus|sonnet|haiku)-([0-9]+)(?:-([0-9]+))?`)
var grokFamilyRe = regexp.MustCompile(`^grok-([0-9]+)\.([0-9]+)$`)

// DisplayName returns the human-readable model name the validator expects
// in translatedBy.model. Unknown IDs pass through unchanged so the caller
// fails loudly at validation time instead of silently truncating.
//
// Claude/Gemini display names remain valid provenance values. Production
// credits record whichever configured provider actually handled the step.
func DisplayName(m ModelID) string {
	raw := string(m)
	normalized := strings.TrimPrefix(raw, "anthropic/")
	normalized = strings.TrimSuffix(normalized, "[1m]")
	if match := claudeFamilyRe.FindStringSubmatch(normalized); match != nil {
		family := strings.ToUpper(match[1][:1]) + match[1][1:]
		if match[3] == "" {
			return family + " " + match[2]
		}
		return family + " " + match[2] + "." + match[3]
	}
	if match := grokFamilyRe.FindStringSubmatch(normalized); match != nil {
		return "Grok " + match[1] + "." + match[2]
	}
	// Never display the floating `opus` alias verbatim. If a path ever stamps
	// the bare alias (e.g. runtime JSON reporting "opus" instead of a concrete
	// build), resolve it to the current concrete Opus — mirrors the JS SSOT
	// OPUS_ALIAS_CURRENT in scripts/detect-model.mjs (keep both in sync).
	if normalized == "opus" {
		return DisplayName(ModelClaudeOpus)
	}
	switch m {
	case ModelClaudeOpus:
		return "Opus 5"
	case ModelClaudeSonnet:
		return "Sonnet 4.6"
	case ModelClaudeHaiku:
		return "Haiku 4.5"
	case ModelGemini31Pro:
		return "Gemini 3.1 Pro"
	case ModelGPT55:
		return "GPT-5.5"
	case ModelGPT56Sol:
		return "GPT-5.6-Sol"
	case ModelGPT56Luna:
		return "GPT-5.6-Luna"
	case ModelGPT54:
		return "GPT-5.4"
	case ModelGPT53Codex:
		return "GPT-5.3-Codex"
	default:
		return string(m)
	}
}

// HarnessName returns the harness that drives a given model when shelled out
// from the pipeline. Ported from the retired bash pipeline's model_harness_name.
// Concrete Claude build ids (e.g. "claude-opus-4-5") map to the Claude harness
// via the family match, so a pinned writer model still resolves correctly.
func HarnessName(m ModelID) string {
	if claudeFamilyRe.MatchString(string(m)) {
		return "Claude Code CLI"
	}
	if grokFamilyRe.MatchString(string(m)) {
		return "Grok Build CLI"
	}
	switch m {
	case ModelClaudeOpus, ModelClaudeSonnet, ModelClaudeHaiku:
		return "Claude Code CLI"
	case ModelGemini31Pro:
		return "Gemini CLI"
	case ModelGPT56Sol, ModelGPT56Luna, ModelGPT55, ModelGPT54, ModelGPT53Codex:
		return "Codex CLI"
	default:
		return "Unknown Harness"
	}
}
