package main

import (
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
)

// buildDispatcher returns a Dispatcher honoring the --fake-provider flag.
// When the flag is set, the dispatcher is a single FakeProvider loaded
// from JSON. Otherwise it is the real Opus-primary → Codex-fallback chain
// that matches the bash pipeline's default.
//
// The opusOnly parameter matches --opus mode: when true, the Codex fallback
// is dropped so only Claude Opus is tried.
func buildDispatcher(state *rootState, opusOnly bool) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeFromJSON(state.fakeProviderPath)
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	providers := llm.DefaultWritingChain()
	if opusOnly && len(providers) > 1 {
		providers = providers[:1]
	}
	return llm.NewDispatcher(state.log, providers...)
}
