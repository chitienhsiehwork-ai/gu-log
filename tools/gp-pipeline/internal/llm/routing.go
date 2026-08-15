package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type RuntimeRole string

const (
	RuntimeReviewer       RuntimeRole = "reviewer"
	RuntimeWriter         RuntimeRole = "writer"
	RuntimeTranslator     RuntimeRole = "translator"
	RuntimeSourceReviewer RuntimeRole = "sourceReviewer"
	RuntimeCorrector      RuntimeRole = "corrector"
	RuntimeCommentary     RuntimeRole = "commentary"
	RuntimeVibeScorer     RuntimeRole = "vibeScorer"
)

type ResolvedRuntime struct {
	RuntimeProfile   string `json:"runtimeProfile"`
	Role             string `json:"role"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	ReasoningEffort  string `json:"reasoningEffort"`
	QuotaTier        string `json:"quotaTier"`
	RemainingPercent string `json:"remainingPercent"`
	QuotaAction      string `json:"quotaAction"`
}

// ResolveRuntime delegates to the Bash router so gp-pipeline and Tribunal use
// identical profile detection, compatibility checks, and strict <20% routing.
func ResolveRuntime(ctx context.Context, repoRoot string, role RuntimeRole) (ResolvedRuntime, error) {
	router := filepath.Join(repoRoot, "scripts", "tribunal-model-router.sh")
	if _, err := os.Stat(router); err != nil {
		profile := os.Getenv("TRIBUNAL_RUNTIME_PROFILE")
		if profile == "" || profile == "legacy" {
			return ResolvedRuntime{
				RuntimeProfile: "legacy",
				Role:           string(role),
				QuotaTier:      "legacy",
				QuotaAction:    "run",
			}, nil
		}
		return ResolvedRuntime{}, fmt.Errorf("resolve %s runtime: %w", role, err)
	}
	routerCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	out, err := exec.CommandContext(
		routerCtx, "bash", router, string(role), "--json",
	).CombinedOutput()
	if err != nil {
		return ResolvedRuntime{}, fmt.Errorf(
			"resolve %s runtime: %w: %s", role, err, strings.TrimSpace(string(out)),
		)
	}
	var runtime ResolvedRuntime
	if err := json.Unmarshal(out, &runtime); err != nil {
		return ResolvedRuntime{}, fmt.Errorf("parse %s runtime: %w", role, err)
	}
	if runtime.RuntimeProfile == "" {
		return ResolvedRuntime{}, fmt.Errorf("resolve %s runtime: profile missing", role)
	}
	if runtime.RuntimeProfile != "legacy" && (runtime.Provider == "" || runtime.Model == "") {
		return ResolvedRuntime{}, fmt.Errorf("resolve %s runtime: provider/model missing", role)
	}
	if runtime.QuotaAction == "" {
		runtime.QuotaAction = "run"
	}
	return runtime, nil
}

// ProvidersForRuntime returns a VM-specific provider only when vm-codex is
// active. Legacy actors get active=false and continue through existing routing.
func ProvidersForRuntime(
	ctx context.Context, repoRoot string, role RuntimeRole,
) (providers []Provider, active bool, err error) {
	runtime, err := ResolveRuntime(ctx, repoRoot, role)
	if err != nil {
		return nil, false, err
	}
	if runtime.RuntimeProfile == "legacy" {
		return nil, false, nil
	}
	if runtime.QuotaAction == "pause" || runtime.QuotaAction == "defer" {
		return nil, true, fmt.Errorf(
			"%s runtime held by Grok quota policy: action=%s remaining=%s%%",
			role, runtime.QuotaAction, runtime.RemainingPercent,
		)
	}
	switch runtime.Provider {
	case "codex":
		return []Provider{&CodexProvider{
			ModelName:       runtime.Model,
			ReasoningEffort: runtime.ReasoningEffort,
			Sandbox:         "read-only",
		}}, true, nil
	case "grok":
		return []Provider{
			NewGrok(repoRoot, runtime.Model, runtime.ReasoningEffort),
		}, true, nil
	default:
		return nil, false, fmt.Errorf(
			"unsupported provider %q for runtime role %s", runtime.Provider, role,
		)
	}
}

func ProbeChainForRuntime(ctx context.Context, repoRoot string) ([]Provider, error) {
	writer, active, err := ProvidersForRuntime(ctx, repoRoot, RuntimeWriter)
	if err != nil {
		return nil, err
	}
	if !active {
		return ProbeChain(), nil
	}
	reviewer, _, err := ProvidersForRuntime(ctx, repoRoot, RuntimeReviewer)
	if err != nil {
		return nil, err
	}
	return append(writer, reviewer...), nil
}
