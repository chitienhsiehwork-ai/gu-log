package llm

import (
	"fmt"
	"os"
)

// DefaultWritingChain returns the provider used for article writing and refine
// steps: the pinned Claude model. WritingChain adds the GP_WRITER_PROVIDER
// validation on top.
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

// WritingChain returns the provider chain for the legacy (no runtime profile)
// write, refine and English sidecar steps: only the pinned Claude model, with
// no fallback (openspec claude-prose-writing-runtime).
func WritingChain() ([]Provider, error) {
	switch provider := os.Getenv("GP_WRITER_PROVIDER"); provider {
	case "", "claude":
		return []Provider{NewClaudeOpusWriter()}, nil
	case "codex":
		return nil, fmt.Errorf(
			`GP_WRITER_PROVIDER=codex is retired: gu-log articles are written only with the Claude model; unset it or set "claude"`,
		)
	default:
		return nil, fmt.Errorf(
			`invalid GP_WRITER_PROVIDER=%q; the only valid value is "claude" (or unset)`,
			provider,
		)
	}
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
//     found". This is the behavior doctor.go documents ("falls back to claude
//     when no codex binary is on PATH"). Judges only: writing never falls back.
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
// / FakeProvider test runs) it stamps the pinned Claude model as the
// deterministic default.
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
	pinned := ModelID(ClaudeOpusPinned)
	return DisplayName(pinned), HarnessName(pinned), nil
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
