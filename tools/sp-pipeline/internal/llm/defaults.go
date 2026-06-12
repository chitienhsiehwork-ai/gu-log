package llm

// DefaultWritingChain returns the provider ordering used for article writing
// and review/refine steps. Codex GPT-5.5 low is the only default provider:
// Anthropic and Gemini subscriptions are not assumed to exist on the Clawd VM.
func DefaultWritingChain() []Provider {
	return []Provider{
		NewCodexGPT55Low(),
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

// ProbeChain returns the providers `doctor --probe-llm` should canary. It is
// the symmetric counterpart to WritingChain for the health-check path: codex
// GPT-5.5 is probed wherever it exists, and only when no codex binary is on
// PATH — the CCC / Claude Code on the web sandbox case, where only `claude`
// ships — is a Claude Opus probe appended so doctor reports the provider the
// pipeline would actually use instead of a misleading codex "missing".
//
// Claude is appended ONLY when codex is absent, mirroring WritingChain's
// invariant: codex present → Claude is never probed, so VPS/mac doctor output
// is byte-for-byte unchanged. DefaultProbeChain() stays codex-only for callers
// that want to probe codex explicitly.
func ProbeChain() []Provider {
	chain := DefaultProbeChain()
	if anyAvailable(chain) {
		return chain
	}
	return append(chain, NewClaudeOpus())
}

// WritingChain returns the provider chain the pipeline actually dispatches
// through (eval / write / review / refine). Codex GPT-5.5 is the primary
// everywhere it exists. When no codex binary is on PATH — the CCC / Claude
// Code on the web sandbox case, where only `claude` ships — a Claude Opus
// fallback is appended so `sp-pipeline run` can complete end to end.
//
// Claude is appended ONLY when codex is absent, so the VPS/mac behaviour is
// byte-for-byte unchanged: codex present → Claude is never in the chain,
// preserving the "Claude is not a safe default dependency" invariant. This is
// auto-detection (binary-on-PATH), not a flag — a codex that is present but
// fails at runtime still surfaces its error rather than silently retrying on
// Claude.
func WritingChain() []Provider {
	chain := DefaultWritingChain()
	if anyAvailable(chain) {
		return chain
	}
	return append(chain, NewClaudeOpus())
}

// EffectiveStamp returns the (model, harness) display labels for the runtime
// provider that WritingChain will resolve to. Frontmatter stampers (credits,
// ralph) use it so a Claude-fallback run is recorded honestly as
// "Opus 4.6" / "Claude Code CLI" instead of the hardcoded GPT-5.5 / Codex
// labels. When nothing is on PATH (offline / FakeProvider test runs) it keeps
// the historical codex labels so those paths do not suddenly flip to Claude.
func EffectiveStamp() (model, harness string) {
	chain := DefaultWritingChain()
	if anyAvailable(chain) {
		m := chain[0].Model()
		return DisplayName(m), HarnessName(m)
	}
	if c := NewClaudeOpus(); c.Available() {
		return DisplayName(c.Model()), HarnessName(c.Model())
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
