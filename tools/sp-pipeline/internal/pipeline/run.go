package pipeline

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

// SetupWorkDir populates s.WorkDir with an absolute path (creating the
// directory if needed), and installs a cleanup trap that removes the
// directory on clean exit unless s.KeepWorkDir is true.
//
// Returns a cleanup function the caller should defer.
func SetupWorkDir(s *State) (cleanup func(), err error) {
	if s.WorkDir == "" {
		stamp := time.Now().Unix()
		s.WorkDir = filepath.Join(s.Cfg.RepoRoot, "tmp", fmt.Sprintf("sp-pending-%d-pipeline", stamp))
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
// Run is the Go equivalent of invoking scripts/sp-pipeline.sh <url>. It
// does NOT manage work-dir setup — call SetupWorkDir first — and does NOT
// print a step summary on the way out; the caller handles that via
// PrintSummary so the `run` subcommand can emit it in both human and
// --json shapes.
func Run(ctx context.Context, s *State) error {
	type step struct {
		name string
		fn   func(context.Context) error
	}
	steps := []step{
		{"fetch", s.Fetch},
		{"eval", s.Eval},
		{"dedup", s.Dedup},
		{"write", s.Write},
		{"review", s.Review},
		{"refine", s.Refine},
		{"credits", s.Credits},
		{"ralph", s.Ralph},
		{"deploy", s.Deploy},
	}
	for _, st := range steps {
		start := time.Now()
		if err := st.fn(ctx); err != nil {
			return err
		}
		if s.Timings == nil {
			s.Timings = map[string]int{}
		}
		s.Timings[st.name] = int(time.Since(start).Seconds())
	}
	return nil
}

// PrintSummary writes a human-readable pipeline summary to w, matching
// the field layout of scripts/sp-pipeline.sh Step 6. Used by the run
// subcommand after Run returns.
func PrintSummary(w io.Writer, s *State) {
	fmt.Fprintf(w, "\nPipeline Summary\n")
	fmt.Fprintf(w, "SP number   : %s\n", nonEmpty(fmt.Sprintf("%d", s.SPNumber), "PENDING"))
	fmt.Fprintf(w, "Title       : %s\n", nonEmpty(s.Title, "N/A"))
	fmt.Fprintf(w, "Filename    : %s\n", nonEmpty(s.Filename, nonEmpty(s.ActiveFilename, "N/A (dry-run)")))
	fmt.Fprintf(w, "Work dir    : %s\n", s.WorkDir)
	for _, name := range []string{"fetch", "eval", "dedup", "write", "review", "refine", "credits", "ralph", "deploy"} {
		fmt.Fprintf(w, "%-7s time: %ds\n", name, s.Timings[name])
	}
}
