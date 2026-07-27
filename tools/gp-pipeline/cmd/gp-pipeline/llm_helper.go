package main

import (
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
)

type dispatcherRole string

const (
	dispatcherWriter dispatcherRole = "writer"
	dispatcherJudge  dispatcherRole = "judge"
)

// buildDispatcherForRole returns the canonical role-specific provider chain.
// The provider policy is owned by internal/llm; there is no compatibility flag
// that silently changes routing.
func buildDispatcherForRole(state *rootState, role dispatcherRole) (*llm.Dispatcher, error) {
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
		providers = llm.JudgeChainWithClaudeFallback(state.judgeAllowClaude)
	default:
		var err error
		providers, err = llm.WritingChain()
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
	}
	disp, err := llm.NewDispatcher(state.log, providers...)
	if err != nil {
		return nil, err
	}
	policy := llm.DefaultQuotaPolicy()
	if role == dispatcherJudge {
		policy.AllowClaudeJudgeFallback = state.judgeAllowClaude
	}
	disp.ConfigureQuotaPolicy(policy)
	return disp, nil
}
