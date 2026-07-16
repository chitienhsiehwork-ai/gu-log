package pipeline

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/observability"
)

// SetupWorkDir populates s.WorkDir with an absolute path (creating the
// directory if needed), and installs a cleanup trap that removes the
// directory on clean exit unless s.KeepWorkDir is true.
//
// The default work directory lives OUTSIDE the repo (under os.TempDir())
// rather than under <repo>/tmp/. These are disposable scratch dirs, not git
// worktrees. The maintained Codex route therefore runs with
// --skip-git-repo-check and writes requested artifacts into this directory
// without inheriting repo-level side effects.
//
// The deploy step still copies final.mdx into <repo>/src/content/posts,
// so this only affects intermediate scratch files.
//
// Returns a cleanup function the caller should defer.
func SetupWorkDir(s *State) (cleanup func(), err error) {
	if s.WorkDir == "" {
		stamp := time.Now().Unix()
		s.WorkDir = filepath.Join(os.TempDir(), fmt.Sprintf("sp-pending-%d-pipeline", stamp))
	}
	abs, absErr := filepath.Abs(s.WorkDir)
	if absErr != nil {
		return func() {}, absErr
	}
	s.WorkDir = abs
	if err := os.MkdirAll(s.WorkDir, 0o755); err != nil {
		return func() {}, fmt.Errorf("setup work-dir: %w", err)
	}
	cleanup = func() {}
	// We intentionally do NOT auto-remove the work dir even on clean exits
	// — it is useful for debugging, and the bash pipeline also leaves it
	// around under tmp/ (which is in .gitignore). KeepWorkDir is therefore
	// a no-op placeholder for now; wire cleanup logic here when needed.
	_ = s.KeepWorkDir
	return cleanup, nil
}

// Run executes the full pipeline end-to-end: Fetch → Eval → Dedup → Write
// → Review → Refine → Credits → Ralph → Deploy → Summary. Each step
// honors s.FromStepInt so callers can resume partway through.
//
// Run is the Go equivalent of invoking scripts/gp-pipeline.sh <url>. It
// does NOT manage work-dir setup — call SetupWorkDir first — and does NOT
// print a step summary on the way out; the caller handles that via
// PrintSummary so the `run` subcommand can emit it in both human and
// --json shapes.
func Run(ctx context.Context, s *State) error {
	type step struct {
		name string
		fn   func(context.Context) error
	}
	if s.Cfg != nil {
		writeSnapshotBestEffort(s, "setup", "", "running", "")
	}
	steps := []step{
		{"fetch", s.Fetch},
		{"dedup-url", s.DedupURL},
		{"eval", s.Eval},
		{"dedup", s.Dedup},
		{"write", s.Write},
		{"review", s.Review},
		{"refine", s.Refine},
		{"credits", s.Credits},
		{"ralph", s.Ralph},
		{"deploy", s.Deploy},
	}
	lastCompleted := ""
	for _, st := range steps {
		writeSnapshotBestEffort(s, st.name, lastCompleted, "running", "")
		start := time.Now()
		if err := st.fn(ctx); err != nil {
			writeSnapshotBestEffort(s, st.name, lastCompleted, "failed", err.Error())
			return err
		}
		if s.Timings == nil {
			s.Timings = map[string]int{}
		}
		s.Timings[st.name] = int(time.Since(start).Seconds())
		lastCompleted = st.name
		writeSnapshotBestEffort(s, st.name, lastCompleted, "running", "")
	}
	writeSnapshotBestEffort(s, lastCompleted, lastCompleted, "completed", "")
	return nil
}

func writeSnapshotBestEffort(s *State, currentStep, lastCompleted, runState, errText string) {
	if s == nil || s.Cfg == nil || s.WorkDir == "" {
		return
	}
	if err := observability.WriteSnapshot(s.Cfg, observability.SnapshotInput{
		WorkDir:           s.WorkDir,
		RepoRoot:          s.Cfg.RepoRoot,
		Prefix:            s.Prefix,
		TweetURL:          s.TweetURL,
		TicketID:          s.PromptTicketID,
		CurrentStep:       currentStep,
		LastCompletedStep: lastCompleted,
		RunState:          runState,
		ActiveFilename:    s.ActiveFilename,
		ActiveENFilename:  s.ActiveENFilename,
		Filename:          s.Filename,
		ENFilename:        s.ENFilename,
		Error:             errText,
	}); err != nil && s.Log != nil {
		s.Log.Warn("observability snapshot failed: %v", err)
	}
}

// PrintSummary writes a human-readable pipeline summary to w, matching
// the field layout of scripts/gp-pipeline.sh Step 6. Used by the run
// subcommand after Run returns.
func PrintSummary(w io.Writer, s *State) {
	fmt.Fprintf(w, "\nPipeline Summary\n")
	fmt.Fprintf(w, "SP number   : %s\n", nonEmpty(fmt.Sprintf("%d", s.SPNumber), "PENDING"))
	fmt.Fprintf(w, "Title       : %s\n", nonEmpty(s.Title, "N/A"))
	fmt.Fprintf(w, "Filename    : %s\n", nonEmpty(s.Filename, nonEmpty(s.ActiveFilename, "N/A (dry-run)")))
	fmt.Fprintf(w, "Work dir    : %s\n", s.WorkDir)
	for _, name := range []string{"fetch", "dedup-url", "eval", "dedup", "write", "review", "refine", "credits", "ralph", "deploy"} {
		fmt.Fprintf(w, "%-7s time: %ds\n", name, s.Timings[name])
	}
}
