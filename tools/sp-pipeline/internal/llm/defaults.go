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
