package main

import (
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
)

type dispatcherRole string

const (
	dispatcherWriter dispatcherRole = "writer"
	dispatcherJudge  dispatcherRole = "judge"
)

// buildDispatcher returns a role-specific Dispatcher honoring the
// --fake-provider flag. Writers use Claude Opus alias on Macs where Claude Code
// is installed, falling back to full Codex GPT-5.5 only when Claude is absent.
// Judges use full Codex GPT-5.5, never mini.
func buildDispatcher(state *rootState, opusOnly bool) (*llm.Dispatcher, error) {
	return buildDispatcherForRole(state, dispatcherWriter, opusOnly)
}

func buildDispatcherForRole(state *rootState, role dispatcherRole, opusOnly bool) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeFromJSON(state.fakeProviderPath)
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	var providers []llm.Provider
	switch role {
	case dispatcherJudge:
		providers = llm.JudgeChain()
	default:
		providers = llm.WritingChain()
	}
	_ = opusOnly
	return llm.NewDispatcher(state.log, providers...)
}
