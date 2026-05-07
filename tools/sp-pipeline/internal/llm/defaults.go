package llm

// DefaultWritingChain returns the provider ordering used for article writing
// and review/refine steps. Codex GPT-5.5 medium is the only default provider:
// Anthropic and Gemini subscriptions are not assumed to exist on the Clawd VM.
func DefaultWritingChain() []Provider {
	return []Provider{
		NewCodexGPT55Medium(),
	}
}

// DefaultProbeChain returns the providers the doctor subcommand should ping.
// Keep this aligned with the production default chain so doctor does not fail
// or warn on intentionally unavailable Claude/Gemini subscriptions.
func DefaultProbeChain() []Provider {
	return []Provider{
		NewCodexGPT55Medium(),
	}
}
