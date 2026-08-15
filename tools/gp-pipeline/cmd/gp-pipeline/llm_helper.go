package main

import (
	"context"
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
)

type dispatcherRole string

const (
	dispatcherWriter         dispatcherRole = "writer"
	dispatcherJudge          dispatcherRole = "judge"
	dispatcherTranslator     dispatcherRole = "translator"
	dispatcherSourceReviewer dispatcherRole = "sourceReviewer"
	dispatcherCorrector      dispatcherRole = "corrector"
	dispatcherCommentary     dispatcherRole = "commentary"
	dispatcherVibeScorer     dispatcherRole = "vibeScorer"
)

func (r dispatcherRole) gpRuntimeRole() (llm.RuntimeRole, bool) {
	switch r {
	case dispatcherTranslator:
		return llm.RuntimeTranslator, true
	case dispatcherSourceReviewer:
		return llm.RuntimeSourceReviewer, true
	case dispatcherCorrector:
		return llm.RuntimeCorrector, true
	case dispatcherCommentary:
		return llm.RuntimeCommentary, true
	case dispatcherVibeScorer:
		return llm.RuntimeVibeScorer, true
	default:
		return "", false
	}
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
	runtimeRole, gpRole := role.gpRuntimeRole()
	if !gpRole {
		runtimeRole = llm.RuntimeWriter
	}
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
	if gpRole && !active {
		return nil, fmt.Errorf("build dispatcher: runtime has no declared GP route for %s", role)
	}
	if !active {
		providers = nil
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

type gpDispatchers struct {
	Profile        string
	Translator     *llm.Dispatcher
	SourceReviewer *llm.Dispatcher
	Corrector      *llm.Dispatcher
	Commentary     *llm.Dispatcher
	VibeScorer     *llm.Dispatcher
}

func buildGPDispatchers(state *rootState) (gpDispatchers, error) {
	if state.fakeProviderPath != "" {
		return buildFakeGPDispatchers(state)
	}
	resolved, err := llm.ResolveRuntime(context.Background(), state.cfg.RepoRoot, llm.RuntimeTranslator)
	if err != nil {
		return gpDispatchers{}, fmt.Errorf("validate GP runtime: %w", err)
	}
	if _, err := llm.LoadGPProfile(state.cfg.RepoRoot, resolved.RuntimeProfile); err != nil {
		return gpDispatchers{}, fmt.Errorf("validate GP profile: %w", err)
	}
	result := gpDispatchers{Profile: resolved.RuntimeProfile}
	for role, target := range map[dispatcherRole]**llm.Dispatcher{
		dispatcherTranslator:     &result.Translator,
		dispatcherSourceReviewer: &result.SourceReviewer,
		dispatcherCorrector:      &result.Corrector,
		dispatcherCommentary:     &result.Commentary,
		dispatcherVibeScorer:     &result.VibeScorer,
	} {
		dispatcher, err := buildDispatcherForRole(state, role)
		if err != nil {
			return gpDispatchers{}, fmt.Errorf("GP role %s preflight: %w", role, err)
		}
		if len(dispatcher.Providers()) != 1 {
			return gpDispatchers{}, fmt.Errorf("GP role %s must resolve to exactly one provider", role)
		}
		*target = dispatcher
	}
	return result, nil
}

func buildFakeGPDispatchers(state *rootState) (gpDispatchers, error) {
	result := gpDispatchers{Profile: "fixture"}
	for role, target := range map[dispatcherRole]**llm.Dispatcher{
		dispatcherTranslator:     &result.Translator,
		dispatcherSourceReviewer: &result.SourceReviewer,
		dispatcherCorrector:      &result.Corrector,
		dispatcherCommentary:     &result.Commentary,
		dispatcherVibeScorer:     &result.VibeScorer,
	} {
		dispatcher, err := buildDispatcherForRole(state, role)
		if err != nil {
			return gpDispatchers{}, err
		}
		*target = dispatcher
	}
	return result, nil
}
