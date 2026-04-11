// Package ralph is a thin shell-out wrapper around
// scripts/tribunal-all-claude.sh — the standalone 4-judge tribunal that
// Phase 3 invokes as a black box.
//
// Why shell out instead of porting: tribunal-all-claude.sh is 372 lines of
// battle-tested bash with its own flock, quiet-hours logic, and progress
// JSON checkpoint. It has exit-code-1-on-failure semantics and does NOT
// call back into sp-pipeline.sh, so wrapping it is safe and the Go port
// of the tribunal itself is explicitly Phase 5 (optional polish).
package ralph

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// Options controls the ralph invocation. All fields are required.
type Options struct {
	// RalphScript is the absolute path to scripts/tribunal-all-claude.sh.
	RalphScript string
	// Filename is the basename of the article under src/content/posts.
	// The bash script strips any path component via $(basename "$1"),
	// so a bare filename works.
	Filename string
	// StdoutFile is the path to append tribunal stdout+stderr. Matches
	// the `>> $WORK_DIR/tribunal-stdout.txt 2>&1` redirect in bash.
	StdoutFile string
}

// Run executes the tribunal. The error return is always nil on
// clean exit — the bash pipeline logs-and-continues on tribunal failure,
// and this wrapper preserves that contract. Callers read `passed` to
// decide how to proceed.
func Run(ctx context.Context, opts Options) (passed bool, err error) {
	if opts.RalphScript == "" {
		return false, fmt.Errorf("ralph: RalphScript is required")
	}
	if opts.Filename == "" {
		return false, fmt.Errorf("ralph: Filename is required")
	}
	if opts.StdoutFile == "" {
		return false, fmt.Errorf("ralph: StdoutFile is required")
	}
	if _, err := os.Stat(opts.RalphScript); err != nil {
		return false, fmt.Errorf("ralph: script missing at %s", opts.RalphScript)
	}
	if err := os.MkdirAll(filepath.Dir(opts.StdoutFile), 0o755); err != nil {
		return false, fmt.Errorf("ralph: mkdir log parent: %w", err)
	}

	res, execErr := runner.Run(ctx, "bash", opts.RalphScript, opts.Filename)
	if res != nil {
		// Append captured output (stdout + stderr) to the log file. This
		// intentionally ignores file errors — the tribunal's own logging
		// is also written to .score-loop/logs/ by tribunal-all-claude.sh.
		if f, err := os.OpenFile(opts.StdoutFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
			_, _ = f.Write(res.Stdout)
			_, _ = f.Write(res.Stderr)
			_ = f.Close()
		}
	}
	// execErr is non-nil on any non-zero exit. Ralph's exit 1 means
	// "tribunal FAILED" (a caller-visible business outcome, not a bug),
	// so we return (passed=false, err=nil) in that case.
	return execErr == nil, nil
}
