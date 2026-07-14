// Package llm is the dispatcher layer around the external language model
// CLIs the pipeline can call. The maintained production runtime is Codex;
// older Claude/Gemini wrappers remain only for compatibility tests and
// historical fallback experiments.
//
// Design notes:
//
//   - Each provider is a thin wrapper around exec.CommandContext. There is
//     no API client, no auth plumbing, no HTTP. The surrounding CLIs
//     (installed by the user) handle their own authentication, and we
//     inherit whatever credentials they already have.
//   - A Dispatcher composes a fallback chain. The default chain is Codex
//     GPT-5.5 primary, matching the current mac-cdx workflow where Codex CLI
//     is the maintained local LLM harness.
//   - Canary probes (sp-pipeline doctor --probe-llm) send a single short
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
// Keep this in sync with scripts/sp-pipeline.sh's model_display_name().
type ModelID string

const (
	ModelClaudeOpus   ModelID = "claude-opus"
	ModelGemini31Pro  ModelID = "gemini-3.1-pro-preview"
	ModelGPT55        ModelID = "gpt-5.5"
	ModelGPT56Sol     ModelID = "gpt-5.6-sol"
	ModelGPT54        ModelID = "gpt-5.4"
	ModelGPT53Codex   ModelID = "gpt-5.3-codex"
	ModelClaudeSonnet ModelID = "claude-sonnet"
	ModelClaudeHaiku  ModelID = "claude-haiku"
)

var claudeFamilyRe = regexp.MustCompile(`claude-(opus|sonnet|haiku)-([0-9]+)-([0-9]+)`)

// DisplayName returns the human-readable model name the validator expects
// in translatedBy.model. Unknown IDs pass through unchanged so the caller
// fails loudly at validation time instead of silently truncating.
//
// Claude/Gemini display names are retained because historical frontmatter and
// old fake-provider tests may still mention them. New production credits should
// normally record GPT-5.5 + Codex CLI.
func DisplayName(m ModelID) string {
	raw := string(m)
	normalized := strings.TrimPrefix(raw, "anthropic/")
	normalized = strings.TrimSuffix(normalized, "[1m]")
	if match := claudeFamilyRe.FindStringSubmatch(normalized); match != nil {
		family := strings.ToUpper(match[1][:1]) + match[1][1:]
		return family + " " + match[2] + "." + match[3]
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
		return "Opus 4.8"
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
// Concrete Claude build ids (e.g. "claude-opus-4-5") map to the Claude harness
// via the family match, so a pinned writer model still resolves correctly.
func HarnessName(m ModelID) string {
	if claudeFamilyRe.MatchString(string(m)) {
		return "Claude Code CLI"
	}
	switch m {
	case ModelClaudeOpus, ModelClaudeSonnet, ModelClaudeHaiku:
		return "Claude Code CLI"
	case ModelGemini31Pro:
		return "Gemini CLI"
	case ModelGPT56Sol, ModelGPT55, ModelGPT54, ModelGPT53Codex:
		return "Codex CLI"
	default:
		return "Unknown Harness"
	}
}
