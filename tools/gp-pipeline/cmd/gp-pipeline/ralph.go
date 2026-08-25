package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

type ralphReport struct {
	OK             bool   `json:"ok"`
	Step           string `json:"step"`
	ActiveFilename string `json:"activeFilename,omitempty"`
	Passed         bool   `json:"passed"`
	ElapsedMs      int64  `json:"elapsedMs"`
	ErrorCode      int    `json:"errorCode,omitempty"`
	Error          string `json:"error,omitempty"`
}

func newRalphCmd(state *rootState) *cobra.Command {
	var (
		filename string
		workDir  string
	)
	cmd := &cobra.Command{
		Use:   "ralph",
		Short: "Run the 4-stage Codex tribunal on an existing posts/ file",
		Long: `ralph is Step 4.7 of the pipeline. It shells out to
scripts/tribunal.sh — the standalone 4-judge tribunal with its
own flock + quiet-hours logic — and then runs the frontmatter normaliser
that injects the canonical 6-entry pipeline: block.

Ralph logs-and-continues on tribunal failure (bash behavior). Use
--file to target an existing file in src/content/posts/.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runRalph(cmd.Context(), state, filename, workDir)
		},
	}
	cmd.Flags().StringVar(&filename, "file", "", "basename of the post in src/content/posts/ (required)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory for tribunal-stdout.txt (defaults to $REPO/tmp/gp-ralph-<unix>)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func runRalph(ctx context.Context, state *rootState, filename, workDir string) error {
	start := time.Now()
	prefix, err := postPrefixFromFilename(filename)
	if err != nil {
		return err
	}

	if workDir == "" {
		workDir = filepath.Join(state.cfg.RepoRoot, "tmp", fmt.Sprintf("gp-ralph-%d", time.Now().Unix()))
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("ralph: mkdir work-dir: %w", err)
	}

	// Reconstruct a minimal State so Ralph() can run. We treat the
	// caller-provided filename as --file (EXISTING_FILE).
	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.WorkDir = workDir
	s.ExistingFile = filename
	s.Prefix = prefix

	stepCtx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()

	err = s.Ralph(stepCtx)

	report := ralphReport{
		Step:           "ralph",
		ActiveFilename: s.ActiveFilename,
		Passed:         s.RalphPassed,
		ElapsedMs:      time.Since(start).Milliseconds(),
	}
	if err != nil {
		report.ErrorCode = 1
		report.Error = err.Error()
		emitRalphReport(state, report)
		return newExitError(1, err)
	}
	report.OK = true
	emitRalphReport(state, report)
	return nil
}

func postPrefixFromFilename(filename string) (string, error) {
	if filepath.Base(filename) != filename {
		return "", fmt.Errorf("ralph: --file must be a basename")
	}
	stem := strings.TrimPrefix(strings.ToLower(filename), "en-")
	series, _, ok := strings.Cut(stem, "-")
	if !ok {
		return "", fmt.Errorf("ralph: cannot infer series from filename %q", filename)
	}
	switch series {
	case "gp":
		return "GP", nil
	case "mp":
		return "MP", nil
	case "sd":
		return "SD", nil
	case "lv":
		return "Lv", nil
	default:
		return "", fmt.Errorf("ralph: unsupported post series %q", series)
	}
}

func emitRalphReport(state *rootState, r ralphReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.Passed {
		fmt.Println("PASS")
	} else {
		fmt.Println("FAIL (best-effort deployed)")
	}
}
