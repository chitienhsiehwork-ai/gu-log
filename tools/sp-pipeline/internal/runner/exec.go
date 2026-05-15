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

// Options is the full knob set for a subprocess invocation. Both Run and
// RunWithStdin are thin wrappers over RunWithOptions and exist for the
// common "no stdin, no CWD override" and "just stdin" cases.
type Options struct {
	// Name is the binary to execute (relative names are resolved via PATH).
	Name string
	// Args is the argument vector (not including Name).
	Args []string
	// Stdin, when non-empty, is piped into the child process stdin.
	Stdin []byte
	// WorkDir is the child process CWD. Empty means inherit the parent.
	WorkDir string
}

// Run executes name with args, using the provided context for cancellation
// and timeout. Stdin is empty; use RunWithStdin when you need to feed data.
func Run(ctx context.Context, name string, args ...string) (*Result, error) {
	return RunWithStdin(ctx, nil, name, args...)
}

// RunWithStdin executes name with args and pipes stdin into the process.
func RunWithStdin(ctx context.Context, stdin []byte, name string, args ...string) (*Result, error) {
	return RunWithOptions(ctx, Options{Name: name, Args: args, Stdin: stdin})
}

// RunWithOptions is the full-featured entry point. It handles cancellation,
// stdout/stderr capture, optional stdin, and optional working directory.
func RunWithOptions(ctx context.Context, opts Options) (*Result, error) {
	cmd := exec.CommandContext(ctx, opts.Name, opts.Args...)
	if opts.WorkDir != "" {
		cmd.Dir = opts.WorkDir
	}

	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	if len(opts.Stdin) > 0 {
		cmd.Stdin = bytes.NewReader(opts.Stdin)
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
		return res, fmt.Errorf("%s exited with code %d: %s", opts.Name, res.ExitCode, trimStderr(res.Stderr))
	}
	return res, fmt.Errorf("running %s: %w", opts.Name, err)
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
