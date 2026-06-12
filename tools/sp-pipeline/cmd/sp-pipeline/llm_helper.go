package main

import (
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
)

// buildDispatcher returns a Dispatcher honoring the --fake-provider flag.
// When the flag is set, the dispatcher is a single FakeProvider loaded
// from JSON. Otherwise it is llm.WritingChain(): Codex GPT-5.5 as the
// primary, plus an auto-detected Claude Opus fallback when no codex binary is
// on PATH (the CCC sandbox case). The old Opus-primary/Gemini-assisted
// pipeline is intentionally not the default — Codex stays primary wherever it
// exists; Claude only enters the chain when codex is absent.
//
// The opusOnly parameter is kept for CLI compatibility, but no longer changes
// provider routing: the Claude fallback is driven by codex availability, not
// by this flag.
func buildDispatcher(state *rootState, opusOnly bool) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeFromJSON(state.fakeProviderPath)
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	providers := llm.WritingChain()
	_ = opusOnly
	return llm.NewDispatcher(state.log, providers...)
}
