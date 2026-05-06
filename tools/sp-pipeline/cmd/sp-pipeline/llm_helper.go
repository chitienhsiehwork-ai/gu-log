package main

import (
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
)

// buildDispatcher returns a Dispatcher honoring the --fake-provider flag.
// When the flag is set, the dispatcher is a single FakeProvider loaded
// from JSON. Otherwise it is the real Codex-only chain. The old
// Opus-primary/Gemini-assisted pipeline is intentionally not the default now
// that those subscriptions are not assumed to be active.
//
// The opusOnly parameter is kept for CLI compatibility, but no longer changes
// provider routing because Claude is not a safe default dependency.
func buildDispatcher(state *rootState, opusOnly bool) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeFromJSON(state.fakeProviderPath)
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	providers := llm.DefaultWritingChain()
	_ = opusOnly
	return llm.NewDispatcher(state.log, providers...)
}
