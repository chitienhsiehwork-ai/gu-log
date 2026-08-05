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
	grokPath := filepath.Join(binDir, "grok")
	script := `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$PWD" > "$CAPTURE_PWD"
printf '%s\n' "$@" > "$CAPTURE_ARGS"
printf 'grok-ok\n'
`
	if err := os.WriteFile(grokPath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake grok: %v", err)
	}

	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("CAPTURE_ARGS", captureArgs)
	t.Setenv("CAPTURE_PWD", capturePWD)

	workDir := t.TempDir()
	out, err := NewGrok("grok-4.5", "low").Run(
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
}
