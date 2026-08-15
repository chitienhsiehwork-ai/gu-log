package llm

import (
	"context"
	"os"
	"path/filepath"
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

func TestProvidersForRuntimeResolvesVMCodexRoles(t *testing.T) {
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "codex"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(binDir, "grok"), `#!/bin/sh
if [ "${1:-}" = models ]; then
  printf 'Default model: grok-4.6\nAvailable models:\n  * grok-4.6 (default)\n  * grok-4.5\n'
fi
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "vm-codex")
	t.Setenv("TRIBUNAL_REVIEWER_REMAINING_PCT", "50")

	repoRoot := repoRootForRoutingTest(t)
	writers, active, err := ProvidersForRuntime(
		context.Background(), repoRoot, RuntimeWriter,
	)
	if err != nil {
		t.Fatalf("writer route: %v", err)
	}
	if !active || len(writers) != 1 || writers[0].Name() != "grok-build-grok-4.6" {
		t.Fatalf("writer route = (%v, %v), want Grok active", writers, active)
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

	for role, want := range map[RuntimeRole]string{
		RuntimeTranslator:     "grok-build-grok-4.6",
		RuntimeSourceReviewer: "codex-gpt-5.6-sol",
		RuntimeCorrector:      "codex-gpt-5.6-sol",
		RuntimeCommentary:     "grok-build-grok-4.6",
		RuntimeVibeScorer:     "codex-gpt-5.5",
	} {
		providers, active, err := ProvidersForRuntime(context.Background(), repoRoot, role)
		if err != nil || !active || len(providers) != 1 || providers[0].Name() != want {
			t.Errorf("%s route = (%v, %v, %v), want %s", role, providers, active, err, want)
		}
	}
}

func TestProvidersForRuntimeHonorsGrokQuotaActions(t *testing.T) {
	binDir := t.TempDir()
	writeExecutable(t, filepath.Join(binDir, "codex"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(binDir, "grok"), `#!/bin/sh
if [ "${1:-}" = models ]; then
  printf 'Default model: grok-4.6\nAvailable models:\n  * grok-4.6 (default)\n  * grok-4.5\n'
fi
exit 0
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "vm-codex")
	t.Setenv("TRIBUNAL_GROK_REMAINING_PCT", "9")

	_, active, err := ProvidersForRuntime(
		context.Background(), repoRootForRoutingTest(t), RuntimeWriter,
	)
	if err == nil || !active || !strings.Contains(err.Error(), "action=pause") {
		t.Fatalf("writer low-quota route = (active=%v, err=%v), want pause", active, err)
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
