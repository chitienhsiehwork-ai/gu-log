package main

import (
	"context"
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
)

type dispatcherRole string

const (
	dispatcherWriter  dispatcherRole = "writer"
	dispatcherJudge   dispatcherRole = "judge"
	dispatcherAligner dispatcherRole = "aligner"
)

// buildAlignerDispatcher returns the source-distance aligner route: the pinned,
// contained, tool-less Claude call (or the VM profile's Claude route). It
// refuses an aligner pin equal to the writer pin before any call, and stops on
// quota instead of sleeping so the run resumes with --from-step
// source-distance.
func buildAlignerDispatcher(ctx context.Context, state *rootState) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeForRole(state.fakeProviderPath, string(dispatcherAligner))
		if err != nil {
			return nil, fmt.Errorf("build aligner dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	if state.cfg == nil || state.cfg.RepoRoot == "" {
		return nil, fmt.Errorf("build aligner dispatcher: repo root is unknown")
	}
	providers, err := llm.AlignerProviders(ctx, state.cfg.RepoRoot)
	if err != nil {
		return nil, fmt.Errorf("build aligner dispatcher: %w", err)
	}
	disp, err := llm.NewDispatcher(state.log, providers...)
	if err != nil {
		return nil, err
	}
	disp.ConfigureQuotaPolicy(llm.AlignerQuotaPolicy())
	return disp, nil
}

// buildDispatcherForRole returns the canonical role-specific provider chain.
// The provider policy is owned by internal/llm; there is no compatibility flag
// that silently changes routing.
func buildDispatcherForRole(state *rootState, role dispatcherRole) (*llm.Dispatcher, error) {
	if state.fakeProviderPath != "" {
		fake, err := llm.LoadFakeForRole(state.fakeProviderPath, string(role))
		if err != nil {
			return nil, fmt.Errorf("build dispatcher: %w", err)
		}
		return llm.NewDispatcher(state.log, fake)
	}
	runtimeRole := llm.RuntimeWriter
	if role == dispatcherJudge {
		runtimeRole = llm.RuntimeReviewer
	}
	var providers []llm.Provider
	active := false
	var err error
	if state.cfg != nil && state.cfg.RepoRoot != "" {
		providers, active, err = llm.ProvidersForRuntime(
			context.Background(), state.cfg.RepoRoot, runtimeRole,
		)
	}
	if err != nil {
		return nil, fmt.Errorf("build dispatcher: %w", err)
	}
	if !active {
		switch role {
		case dispatcherJudge:
			providers = llm.JudgeChainWithClaudeFallback(state.judgeAllowClaude)
		default:
			providers, err = llm.WritingChain()
			if err != nil {
				return nil, fmt.Errorf("build dispatcher: %w", err)
			}
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
