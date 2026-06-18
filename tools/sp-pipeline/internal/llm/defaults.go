package llm

// DefaultWritingChain returns the provider ordering used for article writing
// and refine steps. On Macs with Claude Code installed, the pinned Opus build
// is the writer (NewClaudeOpusWriter), so the writing voice doesn't drift when
// Anthropic moves the floating alias. On the Clawd VM, where Claude is
// intentionally not a dependency, the runtime falls back to Codex GPT-5.5.
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
// through for write/refine. If Claude is installed, the pinned Opus build is
// the writer and a Claude runtime failure should fail loudly rather than
// silently writing with a different voice. If Claude is absent, Codex GPT-5.5
// keeps VM runs alive.
func WritingChain() []Provider {
	claude := NewClaudeOpusWriter()
	if claude.Available() {
		return []Provider{claude}
	}
	return []Provider{NewCodexGPT55Medium()}
}

// JudgeChain returns the provider chain for eval/review. Judges stay on the
// full recommended Codex model.
func JudgeChain() []Provider {
	return DefaultJudgeChain()
}

// JudgeChainWithClaudeFallback returns the normal Codex judge chain, with an
// explicit opt-in Claude judge fallback for Codex quota exhaustion only.
func JudgeChainWithClaudeFallback(allowClaude bool) []Provider {
	if !allowClaude {
		return JudgeChain()
	}
	return []Provider{
		NewCodexGPT55Medium(),
		NewClaudeOpus(),
	}
}

// EffectiveStamp returns the (model, harness) display labels for the runtime
// provider that WritingChain will resolve to. When nothing is on PATH (offline
// / FakeProvider test runs) it keeps Codex labels as the deterministic default.
func EffectiveStamp() (model, harness string) {
	chain := WritingChain()
	for _, p := range chain {
		if p.Available() {
			m := p.Model()
			if reporter, ok := p.(interface{ ActualModel() ModelID }); ok {
				if actual := reporter.ActualModel(); actual != "" {
					m = actual
				}
			}
			return DisplayName(m), HarnessName(p.Model())
		}
	}
	return DisplayName(ModelGPT55), HarnessName(ModelGPT55)
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
