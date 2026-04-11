// Package runner is the single place where sp-pipeline shells out to external
// binaries. Centralising it buys us:
//
//   - Consistent context-based timeout propagation (replaces the bash
//     watchdog that background-sleeps and kills -TERM).
//   - Uniform stderr capture so a failing subprocess surfaces the same way
//     whether it is claude/codex/gemini/bash/node/python.
//   - One obvious seam for tests to stub command execution without touching
//     the caller logic.
package runner

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
)

// Result is what every external command returns through this package.
type Result struct {
	Stdout   []byte
	Stderr   []byte
	ExitCode int
}

// Run executes name with args, using the provided context for cancellation
// and timeout. Stdin is empty; use RunWithStdin when you need to feed data.
func Run(ctx context.Context, name string, args ...string) (*Result, error) {
	return RunWithStdin(ctx, nil, name, args...)
}

// RunWithStdin executes name with args and pipes stdin into the process.
func RunWithStdin(ctx context.Context, stdin []byte, name string, args ...string) (*Result, error) {
	cmd := exec.CommandContext(ctx, name, args...)

	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	if len(stdin) > 0 {
		cmd.Stdin = bytes.NewReader(stdin)
	}

	err := cmd.Run()
	res := &Result{
		Stdout:   outBuf.Bytes(),
		Stderr:   errBuf.Bytes(),
		ExitCode: cmd.ProcessState.ExitCode(),
	}
	if err == nil {
		return res, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return res, fmt.Errorf("%s exited with code %d: %s", name, res.ExitCode, trimStderr(res.Stderr))
	}
	return res, fmt.Errorf("running %s: %w", name, err)
}

// LookPath is a thin wrapper around exec.LookPath so callers can mock it in
// tests without importing os/exec directly.
func LookPath(name string) (string, error) {
	return exec.LookPath(name)
}

func trimStderr(b []byte) string {
	const max = 512
	s := string(bytes.TrimSpace(b))
	if len(s) > max {
		return s[:max] + "...(truncated)"
	}
	return s
}
