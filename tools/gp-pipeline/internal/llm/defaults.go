package llm

import (
	"fmt"
	"os"
)

// DefaultWritingChain returns the preferred provider used for article writing
// and refine steps. Runtime availability and explicit provider selection are
// resolved by WritingChain.
func DefaultWritingChain() []Provider {
	return []Provider{
		NewClaudeOpusWriter(),
	}
}

// DefaultJudgeChain returns the provider ordering used for eval/review steps.
// Keep this on the full recommended Codex model, not a mini model.
func DefaultJudgeChain() []Provider {
	return []Provider{
		NewCodexGPT55Medium(),
	}
}

// DefaultProbeChain returns the providers the doctor subcommand should ping.
// Keep this on the same model as production while using medium effort for a
// slightly more conservative canary; doctor should not ping Claude/Gemini.
func DefaultProbeChain() []Provider {
	return []Provider{
		NewCodexGPT55Medium(),
	}
}

// ProbeChain returns the providers `doctor --probe-llm` should canary.
func ProbeChain() []Provider {
	return append(DefaultProbeChain(), NewClaudeOpus())
}

// WritingChain returns the provider chain the pipeline actually dispatches
// through for write/refine. Explicit provider choices are single-provider,
// fail-closed routes. When the provider is unset, Claude is preferred and
// Codex keeps VM runs alive when Claude is absent.
func WritingChain() ([]Provider, error) {
	provider := os.Getenv("GP_WRITER_PROVIDER")
	switch provider {
	case "codex":
		return []Provider{NewCodexGPT55Medium()}, nil
	case "claude":
		return []Provider{NewClaudeOpusWriter()}, nil
	case "":
		// Continue into automatic availability resolution below.
	default:
		return nil, fmt.Errorf(
			`invalid GP_WRITER_PROVIDER=%q; valid values are "claude", "codex", or unset`,
			provider,
		)
	}
	claude := NewClaudeOpusWriter()
	if claude.Available() {
		return []Provider{claude}, nil
	}
	return []Provider{NewCodexGPT55Medium()}, nil
}

// JudgeChain returns the provider chain for eval/review. Judges stay on the
// full recommended Codex model.
func JudgeChain() []Provider {
	return DefaultJudgeChain()
}

// JudgeChainWithClaudeFallback returns the Codex judge chain, with a Claude
// fallback in two distinct situations:
//
//   - Binary absence (automatic): on a box where codex isn't on PATH — the
//     CCC / Claude Code on the web sandbox — judges run on Claude so the eval /
//     review / tribunal gates still execute instead of dying with "binary not
//     found". This mirrors WritingChain and is exactly the behavior doctor.go
//     already documents ("falls back to claude when no codex binary is on PATH").
//   - Quota exhaustion (opt-in via allowClaude): codex is installed but rate
//     limited; only then do we add Claude as a secondary so the user keeps
//     control over the codex-vs-claude judging tradeoff on a healthy box.
func JudgeChainWithClaudeFallback(allowClaude bool) []Provider {
	codex := NewCodexGPT55Medium()
	if !codex.Available() {
		if claude := NewClaudeOpus(); claude.Available() {
			return []Provider{claude}
		}
		// Neither on PATH: keep codex so the failure is the familiar
		// "binary not found", not a confusing empty chain.
		return []Provider{codex}
	}
	if !allowClaude {
		return []Provider{codex}
	}
	return []Provider{codex, NewClaudeOpus()}
}

// EffectiveStamp returns the (model, harness) display labels for the runtime
// provider that WritingChain will resolve to. When nothing is on PATH (offline
// / FakeProvider test runs) it keeps Codex labels as the deterministic default.
func EffectiveStamp() (model, harness string, err error) {
	chain, err := WritingChain()
	if err != nil {
		return "", "", err
	}
	for _, p := range chain {
		if p.Available() {
			m := p.Model()
			if reporter, ok := p.(interface{ ActualModel() ModelID }); ok {
				if actual := reporter.ActualModel(); actual != "" {
					m = actual
				}
			}
			return DisplayName(m), HarnessName(p.Model()), nil
		}
	}
	return DisplayName(ModelGPT55), HarnessName(ModelGPT55), nil
}

// anyAvailable reports whether at least one provider in chain has its binary
// on PATH.
func anyAvailable(chain []Provider) bool {
	for _, p := range chain {
		if p.Available() {
			return true
		}
	}
	return false
}
