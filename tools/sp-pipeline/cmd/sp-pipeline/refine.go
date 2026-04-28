package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/pipeline"
)

type refineReport struct {
	OK        bool   `json:"ok"`
	Step      string `json:"step"`
	FinalFile string `json:"finalFile,omitempty"`
	Model     string `json:"model,omitempty"`
	ElapsedMs int64  `json:"elapsedMs"`
	ErrorCode int    `json:"errorCode,omitempty"`
	Error     string `json:"error,omitempty"`
}

func newRefineCmd(state *rootState) *cobra.Command {
	var (
		draftPath  string
		reviewPath string
		workDir    string
		ticketID   string
		opusOnly   bool
		angle      string
	)
	cmd := &cobra.Command{
		Use:   "refine",
		Short: "Apply review feedback to a draft and produce final.mdx",
		Long: `refine is Step 4 of the pipeline. It reads draft-v1.mdx and review.md
from the work directory and asks the LLM to produce final.mdx with the
review's issues fixed. The prompt does NOT embed the draft or review
contents — the LLM reads them from --work-dir.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runRefine(cmd.Context(), state, draftPath, reviewPath, workDir, ticketID, opusOnly, angle)
		},
	}
	cmd.Flags().StringVar(&draftPath, "draft", "", "path to draft-v1.mdx (required — its parent becomes work-dir when unset)")
	cmd.Flags().StringVar(&reviewPath, "review", "", "path to review.md (defaults to <work-dir>/review.md)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory (defaults to dirname of --draft)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "PENDING", "ticketId for the refine prompt header")
	cmd.Flags().BoolVar(&opusOnly, "opus", false, "use Claude Opus only (no Codex fallback)")
	cmd.Flags().StringVar(&angle, "angle", "", "narrative directive — should match the --angle passed to write so refine doesn't flatten the angle when applying review feedback")
	_ = cmd.MarkFlagRequired("draft")
	return cmd
}

func runRefine(ctx context.Context, state *rootState, draftPath, reviewPath, workDir, ticketID string, opusOnly bool, angle string) error {
	start := time.Now()
	absDraft, err := filepath.Abs(draftPath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(absDraft); err != nil {
		return fmt.Errorf("refine: draft not found at %s", absDraft)
	}
	if workDir == "" {
		workDir = filepath.Dir(absDraft)
	}
	workDir, err = filepath.Abs(workDir)
	if err != nil {
		return err
	}

	// Review file defaulting is informational; the refine prompt asks the
	// LLM to read it by name from work-dir. Warn loudly if it's absent so
	// the user knows the refine is effectively a blind rewrite.
	if reviewPath == "" {
		reviewPath = filepath.Join(workDir, "review.md")
	}
	if _, err := os.Stat(reviewPath); err != nil {
		state.log.Warn("refine: review.md not found at %s — LLM will refine blind", reviewPath)
	}

	disp, err := buildDispatcher(state, opusOnly)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
	s.WorkDir = workDir
	s.PromptTicketID = ticketID
	s.Angle = angle

	stepCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	err = s.Refine(stepCtx)

	report := refineReport{
		Step:      "refine",
		FinalFile: filepath.Join(workDir, "final.mdx"),
		Model:     s.RefineModel,
		ElapsedMs: time.Since(start).Milliseconds(),
	}
	if err != nil {
		report.ErrorCode = 14
		report.Error = err.Error()
		emitRefineReport(state, report)
		return newExitError(14, err)
	}
	report.OK = true
	emitRefineReport(state, report)
	return nil
}

func emitRefineReport(state *rootState, r refineReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Println(r.FinalFile)
	}
}
