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
	RuntimeReviewer RuntimeRole = "reviewer"
	RuntimeWriter   RuntimeRole = "writer"
	// RuntimeAligner is the source-distance aligner: a Claude call with its
	// own pin (.claude/agents/source-aligner.md), no tools, structured output.
	RuntimeAligner RuntimeRole = "aligner"
)

type ResolvedRuntime struct {
	RuntimeProfile   string `json:"runtimeProfile"`
	Role             string `json:"role"`
	Provider         string `json:"provider"`
	Model            string `json:"model"`
	ReasoningEffort  string `json:"reasoningEffort"`
	QuotaTier        string `json:"quotaTier"`
	RemainingPercent string `json:"remainingPercent"`
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
	return runtime, nil
}

// claudeRuntimeTools is the least-privilege tool set of a Claude route. The
// router routes only article-writing steps and the source aligner to Claude
// (the single list lives in scripts/tribunal-model-router.sh). The writer
// drafts files inside its own work dir; any other role that reaches Claude,
// including the aligner, gets no tools at all, so an injected source cannot
// touch the work dir's files.
func claudeRuntimeTools(role RuntimeRole) []string {
	if role == RuntimeWriter {
		return []string{"Read", "Grep", "Glob", "Edit", "Write"}
	}
	return []string{}
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
	switch runtime.Provider {
	case "claude":
		// The router reads the writer pin from .claude/agents/tribunal-writer.md;
		// the Go side pins ClaudeOpusPinned. Refuse to pick one when they
		// disagree. The aligner's pin has a single SSOT that both sides read.
		want, source := ClaudeOpusPinned, ".claude/agents/tribunal-writer.md"
		if role == RuntimeAligner {
			pin, err := AlignerPin(repoRoot)
			if err != nil {
				return nil, true, err
			}
			want, source = pin, AlignerAgentPath
		}
		if runtime.Model != want {
			return nil, true, fmt.Errorf(
				"Claude model pin drift: the router resolved %q from %s but gp-pipeline expects %q; update both pins together",
				runtime.Model, source, want,
			)
		}
		return []Provider{&ClaudeProvider{
			ModelFlag: want, Contained: true, Tools: claudeRuntimeTools(role),
		}}, true, nil
	case "codex":
		return []Provider{&CodexProvider{
			ModelName:       runtime.Model,
			ReasoningEffort: runtime.ReasoningEffort,
			Sandbox:         "read-only",
		}}, true, nil
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
