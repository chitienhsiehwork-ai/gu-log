package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/candidate"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// stampReport is the JSON shape emitted by `gp-pipeline stamp --json`.
type stampReport struct {
	OK   bool   `json:"ok"`
	Step string `json:"step"`
	*pipeline.StampOutcome
	ElapsedMs int64  `json:"elapsedMs"`
	ErrorCode int    `json:"errorCode,omitempty"`
	Error     string `json:"error,omitempty"`
}

func newStampCmd(state *rootState) *cobra.Command {
	var (
		file       string
		sourcePath string
	)
	cmd := &cobra.Command{
		Use:   "stamp --file <post> [--source <capture>]",
		Short: "Check an existing GP post against its source and write its source-distance stamp",
		Long: fmt.Sprintf(`stamp runs the source-distance check on one existing GP post: a zh-tw
post gets two independent alignments and scoring, an English post gets the
verbatim n-gram check. Use it after writing a GP by hand, after ShroomDog adds
a ShroomDogNote, or after any other edit that voids the stamp.

A pass writes only the sourceDistance stamp; the body is never changed. A
passing English post also clears the zh-tw stamp's englishSkipped mark. A post
that does not pass (including zero alignments) exits %[1]d, prints the flagged
passages, and stays unchanged; stamp never rewrites anything.

The source is fetched from the post's sourceUrl into a work directory outside
the repo, or read from --source, a capture file outside the repo. Only a GP
post with an external source can carry a stamp: anything else fails at ingress
with exit 1, before any fetch or model call.

Exit codes: 0 stamped, 1 not a post that takes a stamp or bad input,
10 fetch failed, 14 the aligner failed, %[1]d did not pass.`, pipeline.SourceDistanceExitCode),
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runStamp(cmd.Context(), state, file, sourcePath)
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "the post to stamp: a path, or a filename in src/content/posts/ (required)")
	cmd.Flags().StringVar(&sourcePath, "source", "", "a source capture outside the repo (default: fetch the post's sourceUrl)")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

func runStamp(ctx context.Context, state *rootState, fileArg, sourceArg string) error {
	start := time.Now()
	file, err := resolvePostPath(state.cfg, fileArg)
	if err != nil {
		return newExitError(1, fmt.Errorf("stamp: %w", err))
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Prefix = "GP"
	target, err := s.InspectStampTarget(ctx, file)
	if err != nil {
		return newExitError(1, fmt.Errorf("stamp: %w", err))
	}
	if !target.Required {
		return newExitError(1, fmt.Errorf("stamp: %s takes no source-distance stamp: only a GP post with an external sourceUrl that is not taken down carries one", filepath.Base(file)))
	}
	if sourceArg != "" {
		capture, err := filepath.Abs(sourceArg)
		if err != nil {
			return newExitError(1, fmt.Errorf("stamp: --source: %w", err))
		}
		if info, err := os.Stat(capture); err != nil || !info.Mode().IsRegular() {
			return newExitError(1, fmt.Errorf("stamp: --source %s is not a readable file", sourceArg))
		}
		if candidate.ResolvesWithin(state.cfg.RepoRoot, capture) {
			return newExitError(1, fmt.Errorf("stamp: --source %s is inside the repo; keep source captures outside it (openspec post-takedown)", sourceArg))
		}
		s.SourcePath = capture
	}
	workDir := flagWorkDir
	if workDir == "" {
		workDir, err = os.MkdirTemp("", "gp-stamp-")
		if err != nil {
			return fmt.Errorf("stamp: %w", err)
		}
	}
	if workDir, err = filepath.Abs(workDir); err != nil {
		return err
	}
	if candidate.ResolvesWithin(state.cfg.RepoRoot, workDir) {
		return newExitError(1, fmt.Errorf("stamp: --work-dir %s is inside the repo; the fetched source must stay outside it", workDir))
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("stamp: %w", err)
	}
	s.WorkDir = workDir
	if target.Lang != "en" {
		disp, err := buildAlignerDispatcher(ctx, state)
		if err != nil {
			return newExitError(1, fmt.Errorf("stamp: %w", err))
		}
		s.AlignerDispatcher = disp
	}

	outcome, runErr := s.StampPost(ctx, file, target)
	report := stampReport{Step: "stamp", StampOutcome: outcome, ElapsedMs: time.Since(start).Milliseconds()}
	if runErr != nil {
		code := 1
		var se *pipeline.StepError
		if errors.As(runErr, &se) {
			code = se.Code
		}
		report.ErrorCode, report.Error = code, runErr.Error()
		emitStampReport(state, report)
		return newExitError(code, runErr)
	}
	if outcome.Verdict != pipeline.SourceDistancePass {
		code := pipeline.SourceDistanceExitCode
		err := fmt.Errorf("stamp: %s did not pass (%s); the file is unchanged", filepath.Base(file), outcome.Verdict)
		report.ErrorCode, report.Error = code, err.Error()
		emitStampReport(state, report)
		return newExitError(code, err)
	}
	report.OK = true
	emitStampReport(state, report)
	return nil
}

func emitStampReport(state *rootState, r stampReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	o := r.StampOutcome
	if o == nil {
		return
	}
	switch {
	case r.OK:
		fmt.Printf("stamped %s (%s", o.File, o.Lang)
		if o.AlignerCalls > 0 {
			fmt.Printf(", %d aligner calls", o.AlignerCalls)
		}
		fmt.Printf("; evidence %s)\n", o.Evidence)
		if o.EnglishSkippedCleared {
			fmt.Println("cleared englishSkipped on the zh-tw stamp")
		}
	case o.Verdict == pipeline.SourceDistanceZero:
		fmt.Printf("%s: no sentence aligned to the source; check that sourceUrl and the capture are the right source (evidence %s)\n", o.File, o.Evidence)
	case o.Lang == "en":
		fmt.Printf("%s copies the source verbatim (%s): %s\nevidence %s\n", o.File, strings.Join(o.Fails, ", "), string(o.Metrics), o.Evidence)
	default:
		fmt.Printf("%s still reads like a translation of the source. Flagged passages:\n\n%s\nevidence %s\n", o.File, o.Report, o.Evidence)
	}
}

// resolvePostPath accepts a path (as given, or relative to the repo root) or
// a bare filename in src/content/posts/.
func resolvePostPath(cfg *config.Config, arg string) (string, error) {
	candidates := []string{arg}
	if !filepath.IsAbs(arg) {
		candidates = append(candidates, filepath.Join(cfg.RepoRoot, arg), filepath.Join(cfg.PostsDir, filepath.Base(arg)))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return filepath.Abs(candidate)
		}
	}
	return "", fmt.Errorf("--file %s is not a post file", arg)
}
