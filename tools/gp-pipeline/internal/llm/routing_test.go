package llm

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestProvidersForRuntimeKeepsLegacyInactive(t *testing.T) {
	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "legacy")
	providers, active, err := ProvidersForRuntime(
		context.Background(), repoRootForRoutingTest(t), RuntimeWriter,
	)
	if err != nil {
		t.Fatalf("ProvidersForRuntime: %v", err)
	}
	if active || providers != nil {
		t.Fatalf("legacy route = (%v, %v), want (nil, false)", providers, active)
	}
}

// installRuntimeFakes puts fake codex and claude CLIs first on PATH so the
// real router's provider preflight runs without real credentials.
func installRuntimeFakes(t *testing.T, claudeLoggedIn bool) {
	t.Helper()
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "codex"), "#!/bin/sh\nexit 0\n")
	loggedIn := "false"
	if claudeLoggedIn {
		loggedIn = "true"
	}
	writeExecutable(t, filepath.Join(binDir, "claude"), `#!/bin/sh
if [ "${1:-}" = auth ] && [ "${2:-}" = status ]; then
  printf '{"loggedIn":`+loggedIn+`}\n'
  exit 0
fi
exit 1
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "vm-codex")
	t.Setenv("TRIBUNAL_REVIEWER_REMAINING_PCT", "50")
	t.Setenv("REPO_ROOT", "")
}

func TestProvidersForRuntimeResolvesVMRoles(t *testing.T) {
	installRuntimeFakes(t, true)
	repoRoot := repoRootForRoutingTest(t)

	providers, active, err := ProvidersForRuntime(context.Background(), repoRoot, RuntimeWriter)
	if err != nil || !active || len(providers) != 1 {
		t.Fatalf("writer route = (%v, %v, %v), want one active Claude provider", providers, active, err)
	}
	claude, ok := providers[0].(*ClaudeProvider)
	if !ok {
		t.Fatalf("writer provider = %T, want *ClaudeProvider", providers[0])
	}
	if claude.ModelFlag != ClaudeOpusPinned || !claude.Contained {
		t.Fatalf("writer provider = %+v, want the contained Claude model pin %q", claude, ClaudeOpusPinned)
	}
	if wantTools := []string{"Read", "Grep", "Glob", "Edit", "Write"}; !reflect.DeepEqual(claude.Tools, wantTools) {
		t.Fatalf("writer tools = %#v, want %#v", claude.Tools, wantTools)
	}

	reviewers, active, err := ProvidersForRuntime(
		context.Background(), repoRoot, RuntimeReviewer,
	)
	if err != nil {
		t.Fatalf("reviewer route: %v", err)
	}
	if !active || len(reviewers) != 1 || reviewers[0].Name() != "codex-gpt-5.6-sol" {
		t.Fatalf("reviewer route = (%v, %v), want Sol active", reviewers, active)
	}
	provider, ok := reviewers[0].(*CodexProvider)
	if !ok || provider.reasoningEffort() != "xhigh" {
		t.Fatalf("reviewer effort = %#v, want xhigh Codex provider", reviewers[0])
	}
	if provider.sandboxMode() != "read-only" {
		t.Fatalf("reviewer sandbox = %q, want read-only", provider.sandboxMode())
	}
}

// TestClaudeRuntimeToolsFailsClosedForNonWriterRoles keeps the least-privilege
// default: only the writer gets file tools, so any other role routed to Claude
// runs with no tools at all.
func TestClaudeRuntimeToolsFailsClosedForNonWriterRoles(t *testing.T) {
	for _, role := range []RuntimeRole{RuntimeReviewer, RuntimeRole("unknown")} {
		if got := claudeRuntimeTools(role); len(got) != 0 {
			t.Errorf("claudeRuntimeTools(%q) = %#v, want no tools", role, got)
		}
	}
}

// TestProvidersForRuntimeJudgesDoNotNeedClaude keeps the judge path free of
// Claude: a logged-out Claude CLI blocks only the article-writing routes.
func TestProvidersForRuntimeJudgesDoNotNeedClaude(t *testing.T) {
	installRuntimeFakes(t, false)
	repoRoot := repoRootForRoutingTest(t)
	if _, _, err := ProvidersForRuntime(context.Background(), repoRoot, RuntimeReviewer); err != nil {
		t.Fatalf("reviewer route with logged-out Claude: %v", err)
	}
	_, _, err := ProvidersForRuntime(context.Background(), repoRoot, RuntimeWriter)
	if err == nil || !strings.Contains(err.Error(), "claude") {
		t.Fatalf("writer route with logged-out Claude = %v, want a Claude preflight failure", err)
	}
}

// fakeRouterRoot returns a repo root whose router prints a fixed resolution,
// so the Go-side guards can be exercised independently of the shell router.
func fakeRouterRoot(t *testing.T, resolution string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "scripts"), 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(root, "scripts", "tribunal-model-router.sh"),
		"#!/usr/bin/env bash\nprintf '%s\\n' '"+resolution+"'\n")
	return root
}

func TestProvidersForRuntimeRejectsClaudePinDrift(t *testing.T) {
	root := fakeRouterRoot(t, `{"runtimeProfile":"vm-codex","role":"writer","provider":"claude","model":"claude-opus-drifted","reasoningEffort":"","quotaTier":"normal","remainingPercent":"unknown"}`)
	_, _, err := ProvidersForRuntime(context.Background(), root, RuntimeWriter)
	if err == nil || !strings.Contains(err.Error(), "pin drift") {
		t.Fatalf("drifted pin route error = %v, want a pin drift rejection", err)
	}
}

func repoRootForRoutingTest(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatalf("resolve repo root: %v", err)
	}
	return root
}

func writeExecutable(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
