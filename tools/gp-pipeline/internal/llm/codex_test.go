package llm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexProviderRunUsesGPT55MediumDangerFullAccess(t *testing.T) {
	binDir := t.TempDir()
	captureArgs := filepath.Join(t.TempDir(), "args.txt")
	capturePWD := filepath.Join(t.TempDir(), "pwd.txt")
	codexPath := filepath.Join(binDir, "codex")
	script := `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$PWD" > "$CAPTURE_PWD"
printf '%s\n' "$@" > "$CAPTURE_ARGS"
out=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
    break
  fi
  shift
done
if [ -z "$out" ]; then
  echo "missing -o" >&2
  exit 2
fi
printf 'codex-ok\n' > "$out"
`
	if err := os.WriteFile(codexPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake codex: %v", err)
	}

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAPTURE_ARGS", captureArgs)
	t.Setenv("CAPTURE_PWD", capturePWD)

	workDir := t.TempDir()
	out, err := NewCodexGPT55Medium().Run(context.Background(), "hello prompt", RunOptions{WorkDir: workDir})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "codex-ok" {
		t.Fatalf("output = %q, want codex-ok", out)
	}

	pwd, err := os.ReadFile(capturePWD)
	if err != nil {
		t.Fatalf("read captured pwd: %v", err)
	}
	if strings.TrimSpace(string(pwd)) != workDir {
		t.Fatalf("codex cwd = %q, want %q", strings.TrimSpace(string(pwd)), workDir)
	}

	rawArgs, err := os.ReadFile(captureArgs)
	if err != nil {
		t.Fatalf("read captured args: %v", err)
	}
	args := strings.Split(strings.TrimSpace(string(rawArgs)), "\n")
	joined := strings.Join(args, " ")

	mustContain := []string{
		"exec",
		"--model gpt-5.5",
		"-c model_reasoning_effort=\"medium\"",
		"--sandbox danger-full-access",
		"--skip-git-repo-check",
		"-- hello prompt",
	}
	for _, want := range mustContain {
		if !strings.Contains(joined, want) {
			t.Fatalf("codex args %q missing %q", joined, want)
		}
	}
	// Exclude the -o <path> pair before the forbidden scan: the capture
	// file lives under TMPDIR, and a TMPDIR like /tmp/claude-501 would
	// otherwise false-positive the "claude" check.
	var scanned []string
	for i := 0; i < len(args); i++ {
		if args[i] == "-o" {
			i++
			continue
		}
		scanned = append(scanned, args[i])
	}
	joinedScan := strings.Join(scanned, " ")
	for _, forbidden := range []string{"--full-auto", "workspace-write", "claude", "gemini"} {
		if strings.Contains(joinedScan, forbidden) {
			t.Fatalf("codex args %q unexpectedly contain %q", joinedScan, forbidden)
		}
	}
}

func TestDefaultJudgeAndProbeChainsAreCodexGPT55(t *testing.T) {
	for name, tc := range map[string]struct {
		chain  []Provider
		effort string
	}{
		"judge": {chain: DefaultJudgeChain(), effort: "medium"},
		"probe": {chain: DefaultProbeChain(), effort: "medium"},
	} {
		chain := tc.chain
		if len(chain) != 1 {
			t.Fatalf("%s chain length = %d, want 1", name, len(chain))
		}
		if chain[0].Name() != "codex-gpt-5.5" {
			t.Fatalf("%s provider = %q, want codex-gpt-5.5", name, chain[0].Name())
		}
		if chain[0].Model() != ModelGPT55 {
			t.Fatalf("%s model = %q, want %q", name, chain[0].Model(), ModelGPT55)
		}
		codex, ok := chain[0].(*CodexProvider)
		if !ok {
			t.Fatalf("%s provider type = %T, want *CodexProvider", name, chain[0])
		}
		if got := codex.reasoningEffort(); got != tc.effort {
			t.Fatalf("%s effort = %q, want %q", name, got, tc.effort)
		}
	}
}

func TestCodexOnlyRunScopedOverrideUsesRequestedModel(t *testing.T) {
	t.Setenv("GP_CODEX_MODEL", "gpt-5.6-sol")
	t.Setenv("GP_WRITER_PROVIDER", "codex")

	for name, chain := range map[string][]Provider{
		"writer": WritingChain(),
		"judge":  DefaultJudgeChain(),
	} {
		if len(chain) != 1 {
			t.Fatalf("%s chain length = %d, want 1", name, len(chain))
		}
		if got := chain[0].Model(); got != ModelGPT56Sol {
			t.Fatalf("%s model = %q, want %q", name, got, ModelGPT56Sol)
		}
		if got := DisplayName(chain[0].Model()); got != "GPT-5.6-Sol" {
			t.Fatalf("%s display name = %q, want GPT-5.6-Sol", name, got)
		}
		if got := HarnessName(chain[0].Model()); got != "Codex CLI" {
			t.Fatalf("%s harness = %q, want Codex CLI", name, got)
		}
	}
}

func TestDefaultWritingChainUsesPinnedClaudeOpus(t *testing.T) {
	chain := DefaultWritingChain()
	if len(chain) != 1 {
		t.Fatalf("writing chain length = %d, want 1", len(chain))
	}
	// Name() stays the family label for logs...
	if chain[0].Name() != "claude-opus" {
		t.Fatalf("writing provider = %q, want claude-opus", chain[0].Name())
	}
	// ...but Model() must keep the pinned version so provenance stamps the real
	// build (regression: it used to collapse to the family → "Opus 4.8").
	if chain[0].Model() != ModelID(ClaudeOpusPinned) {
		t.Fatalf("writing model = %q, want %q", chain[0].Model(), ClaudeOpusPinned)
	}
	if got := DisplayName(chain[0].Model()); got != "Opus 4.5" {
		t.Fatalf("writing DisplayName = %q, want Opus 4.5", got)
	}
}
