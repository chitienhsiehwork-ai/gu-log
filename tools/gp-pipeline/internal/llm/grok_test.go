package llm

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGrokProviderRunUsesConfiguredModelAndEffort(t *testing.T) {
	binDir := t.TempDir()
	captureArgs := filepath.Join(t.TempDir(), "args.txt")
	capturePWD := filepath.Join(t.TempDir(), "pwd.txt")
	captureSystemd := filepath.Join(t.TempDir(), "systemd-args.txt")
	grokPath := filepath.Join(binDir, "grok")
	script := `#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = "--help" ]; then
  exit 0
fi
if [ "${1:-}" = "models" ]; then
  printf 'Default model: grok-4.5\nAvailable models:\n  * grok-4.5 (default)\n'
  exit 0
fi
printf '%s\n' "$PWD" > "$CAPTURE_PWD"
printf '%s\n' "$@" > "$CAPTURE_ARGS"
printf 'grok-ok\n'
`
	if err := os.WriteFile(grokPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake grok: %v", err)
	}
	writeExecutable(t, filepath.Join(binDir, "codex"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(binDir, "systemd-run"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$CAPTURE_SYSTEMD"
while [ "$#" -gt 0 ]; do
  if [ "$1" = -- ]; then
    shift
    break
  fi
  shift
done
[ "$#" -gt 0 ]
exec "$@"
`)

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAPTURE_ARGS", captureArgs)
	t.Setenv("CAPTURE_PWD", capturePWD)
	t.Setenv("CAPTURE_SYSTEMD", captureSystemd)
	t.Setenv("TRIBUNAL_RUNTIME_PROFILE", "vm-codex")

	workDir := t.TempDir()
	provider := NewGrok(repoRootForRoutingTest(t), "grok-4.5", "low")
	out, err := provider.Run(
		context.Background(), "hello prompt", RunOptions{WorkDir: workDir},
	)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "grok-ok" {
		t.Fatalf("output = %q, want grok-ok", out)
	}

	pwd, err := os.ReadFile(capturePWD)
	if err != nil {
		t.Fatalf("read captured pwd: %v", err)
	}
	if strings.TrimSpace(string(pwd)) != workDir {
		t.Fatalf("grok cwd = %q, want %q", strings.TrimSpace(string(pwd)), workDir)
	}
	rawArgs, err := os.ReadFile(captureArgs)
	if err != nil {
		t.Fatalf("read captured args: %v", err)
	}
	joined := strings.Join(strings.Split(strings.TrimSpace(string(rawArgs)), "\n"), " ")
	for _, want := range []string{
		"--model grok-4.5",
		"--reasoning-effort low",
		"--sandbox workspace",
		"--permission-mode bypassPermissions",
		"--tools read_file,grep,list_dir,search_replace",
		"--no-subagents",
		"--disable-web-search",
		"--verbatim",
		"--single hello prompt",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("grok args %q missing %q", joined, want)
		}
	}
	systemdArgs, err := os.ReadFile(captureSystemd)
	if err != nil {
		t.Fatalf("read systemd args: %v", err)
	}
	systemdJoined := strings.Join(
		strings.Split(strings.TrimSpace(string(systemdArgs)), "\n"), " ",
	)
	for _, want := range []string{
		"--slice=tribunal-runtime.slice",
		"--property=KillMode=control-group",
		"--property=UnsetEnvironment=CLAUDE_CODE_OAUTH_TOKEN CLAUDE_API_KEY ANTHROPIC_API_KEY XAI_API_KEY GROK_API_KEY",
	} {
		if !strings.Contains(systemdJoined, want) {
			t.Fatalf("systemd args %q missing %q", systemdJoined, want)
		}
	}

	if _, err := provider.Run(
		context.Background(), "probe prompt", RunOptions{},
	); err != nil {
		t.Fatalf("probe Run: %v", err)
	}
	probePWD, err := os.ReadFile(capturePWD)
	if err != nil {
		t.Fatalf("read probe pwd: %v", err)
	}
	probeDir := strings.TrimSpace(string(probePWD))
	if !strings.Contains(filepath.Base(probeDir), "gp-grok-probe-") {
		t.Fatalf("probe cwd = %q, want disposable gp-grok-probe dir", probeDir)
	}
	if _, err := os.Stat(probeDir); !os.IsNotExist(err) {
		t.Fatalf("probe cwd still exists after Run: %q (err=%v)", probeDir, err)
	}
}
