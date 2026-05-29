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
	for _, forbidden := range []string{"--full-auto", "workspace-write", "claude", "gemini"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("codex args %q unexpectedly contain %q", joined, forbidden)
		}
	}
}

func TestDefaultChainsAreCodexGPT55Only(t *testing.T) {
	for name, tc := range map[string]struct {
		chain  []Provider
		effort string
	}{
		"writing": {chain: DefaultWritingChain(), effort: "low"},
		"probe":   {chain: DefaultProbeChain(), effort: "medium"},
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
