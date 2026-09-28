package pipeline

import (
	"context"
	"encoding/json"
	"errors"
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
		s.WorkDir = filepath.Join(os.TempDir(), fmt.Sprintf("gp-pending-%d-pipeline", stamp))
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

// stageEditorialContext mirrors the canonical editorial inputs into the
// scratch work directory before an editorial provider runs. Providers use
// WorkDir as their only reliable filesystem context, so relative references
// in write/review/refine prompts cannot depend on access to RepoRoot.
func (s *State) stageEditorialContext() error {
	if s == nil || s.Cfg == nil {
		return fmt.Errorf("stage editorial context: pipeline config is nil")
	}
	type contextFile struct {
		source string
		dest   string
	}
	files := []contextFile{
		{s.Cfg.WritingGuide, "GU-LOG_WRITER_PROMPT.md"},
		{filepath.Join(s.Cfg.RepoRoot, "CONTRIBUTING.md"), "CONTRIBUTING.md"},
		{filepath.Join(s.Cfg.RepoRoot, "docs", "shroomdog-editorial-feedback.md"), filepath.Join("docs", "shroomdog-editorial-feedback.md")},
		{filepath.Join(s.Cfg.RepoRoot, "openspec", "specs", "editorial-charter", "spec.md"), filepath.Join("openspec", "specs", "editorial-charter", "spec.md")},
		{filepath.Join(s.Cfg.RepoRoot, "scripts", "vibe-scoring-standard.md"), filepath.Join("scripts", "vibe-scoring-standard.md")},
	}
	for _, file := range files {
		data, err := os.ReadFile(file.source)
		if err != nil {
			return fmt.Errorf("read %s: %w", file.source, err)
		}
		dest := filepath.Join(s.WorkDir, file.dest)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return fmt.Errorf("create context directory for %s: %w", file.dest, err)
		}
		if err := os.WriteFile(dest, data, 0o644); err != nil {
			return fmt.Errorf("write staged %s: %w", file.dest, err)
		}
	}
	return nil
}

// ErrGPPaused rejects GP writing, publishing, and ticket allocation while the
// series is paused (openspec: gp-pipeline-publish-integrity). It states a
// structural fact of this binary — the whole-article translation flow is
// retired and no GP flow replaces it yet — rather than copying the site's
// GP_SERIES_PAUSED flag. The commentary-format change brings GP back.
var ErrGPPaused = errors.New("GP 暫停中: new GP posts are paused — whole-article translations need the source author's consent first, so gp-pipeline has no GP writing or publishing flow until the commentary format ships (openspec: editorial-charter)")

type pipelineStep struct {
	name string
	fn   func(context.Context) error
}

func stepsForState(s *State) []pipelineStep {
	return []pipelineStep{
		{"fetch", s.Fetch},
		{"dedup-url", s.DedupURL},
		{"eval", s.Eval},
		{"dedup", s.Dedup},
		{"write", s.Write},
		{"review", s.Review},
		{"refine", s.Refine},
		{"credits", s.Credits},
		{"ralph", s.Ralph},
		{"translate", s.Translate},
		{"deploy", s.Deploy},
	}
}

// Run executes the full write-review-refine pipeline end-to-end and honors
// s.FromStepInt so callers can resume partway through. GP has no flow while
// it is paused, so Run refuses it before any snapshot, recovery hydration, or
// step — the CLI ingress is not the only guard.
//
// Run is the single-invocation entrypoint of the pipeline. It
// does NOT manage work-dir setup — call SetupWorkDir first — and does NOT
// print a step summary on the way out; the caller handles that via
// PrintSummary so the `run` subcommand can emit it in both human and
// --json shapes.
func Run(ctx context.Context, s *State) error {
	if s.Prefix == "GP" {
		return fmt.Errorf("run: %w", ErrGPPaused)
	}
	// Hydrate and validate an existing post before any recovery prompt runs.
	// Otherwise review/refine would still see the fresh-run placeholder (for
	// example GP-PENDING) and could rewrite an allocated article's identity.
	if s.ExistingFile != "" {
		if err := s.prepareExistingPost(); err != nil {
			return fmt.Errorf("run: prepare existing post: %w", err)
		}
	}

	if s.Cfg != nil {
		writeSnapshotBestEffort(s, "setup", "", "running", "")
	}
	steps := stepsForState(s)
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

// RecordRunFailure makes setup/preflight failures visible to status and
// recovery tooling even when the main step loop never started.
func (s *State) RecordRunFailure(step string, runErr error) {
	errText := ""
	if runErr != nil {
		errText = runErr.Error()
	}
	writeSnapshotBestEffort(s, step, "", "failed", errText)
}

// roleFailureVersion labels <role>-failure.json for humans; no tool parses it.
const roleFailureVersion = "gp-pipeline-role-failure/v1"

// RecordRoleFailure persists provider/profile failures before returning so a
// resumed run has durable evidence instead of only ephemeral stderr.
func (s *State) RecordRoleFailure(role string, runErr error) {
	if s == nil || s.WorkDir == "" || runErr == nil {
		return
	}
	_ = writeJSON(filepath.Join(s.WorkDir, role+"-failure.json"), map[string]any{
		"version":      roleFailureVersion,
		"role":         role,
		"error":        runErr.Error(),
		"completed_at": time.Now().UTC(),
	})
}

// writeJSON writes value as two-space indented JSON ending in a newline.
func writeJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

// PrintSummary writes a human-readable pipeline summary to w, matching
// the retired bash pipeline's Step 6 field layout. Used by the run
// subcommand after Run returns.
func PrintSummary(w io.Writer, s *State) {
	ticketNumber := "PENDING"
	if s.TicketNumber > 0 {
		ticketNumber = fmt.Sprintf("%d", s.TicketNumber)
	}
	fmt.Fprintf(w, "\nPipeline Summary\n")
	fmt.Fprintf(w, "Ticket no.  : %s\n", ticketNumber)
	fmt.Fprintf(w, "Title       : %s\n", nonEmpty(s.Title, "N/A"))
	fmt.Fprintf(w, "Filename    : %s\n", nonEmpty(s.Filename, nonEmpty(s.ActiveFilename, "N/A (dry-run)")))
	fmt.Fprintf(w, "Work dir    : %s\n", s.WorkDir)
	for _, name := range []string{"fetch", "dedup-url", "eval", "dedup", "write", "review", "refine", "credits", "ralph", "translate", "deploy"} {
		fmt.Fprintf(w, "%-7s time: %ds\n", name, s.Timings[name])
	}
}
