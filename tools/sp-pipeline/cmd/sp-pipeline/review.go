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

type reviewReport struct {
	OK         bool   `json:"ok"`
	Step       string `json:"step"`
	ReviewFile string `json:"reviewFile,omitempty"`
	Model      string `json:"model,omitempty"`
	ElapsedMs  int64  `json:"elapsedMs"`
	ErrorCode  int    `json:"errorCode,omitempty"`
	Error      string `json:"error,omitempty"`
}

func newReviewCmd(state *rootState) *cobra.Command {
	var (
		draftPath string
		workDir   string
		ticketID  string
		opusOnly  bool
	)
	cmd := &cobra.Command{
		Use:   "review",
		Short: "Run the 12-point review checklist against a draft",
		Long: `review is Step 3 of the pipeline. It points the LLM at draft-v1.mdx
and asks it to produce a review.md with blocker/major/minor findings.

Unlike write, this prompt does NOT embed the draft contents — the LLM
is expected to read draft-v1.mdx from --work-dir. This matches how the
bash pipeline runs ` + "`claude -p`" + ` in (cd $WORK_DIR && …).`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runReview(cmd.Context(), state, draftPath, workDir, ticketID, opusOnly)
		},
	}
	cmd.Flags().StringVar(&draftPath, "draft", "", "path to draft-v1.mdx (required; its parent is used as work-dir when --work-dir is empty)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory where review.md should land (defaults to dirname of --draft)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "PENDING", "ticketId for the review prompt header")
	cmd.Flags().BoolVar(&opusOnly, "opus", false, "use Claude Opus only (no Codex fallback)")
	_ = cmd.MarkFlagRequired("draft")
	return cmd
}

func runReview(ctx context.Context, state *rootState, draftPath, workDir, ticketID string, opusOnly bool) error {
	start := time.Now()
	absDraft, err := filepath.Abs(draftPath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(absDraft); err != nil {
		return fmt.Errorf("review: draft not found at %s", absDraft)
	}
	if workDir == "" {
		workDir = filepath.Dir(absDraft)
	}
	workDir, err = filepath.Abs(workDir)
	if err != nil {
		return err
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

	stepCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()

	err = s.Review(stepCtx)

	report := reviewReport{
		Step:       "review",
		ReviewFile: filepath.Join(workDir, "review.md"),
		Model:      s.ReviewModel,
		ElapsedMs:  time.Since(start).Milliseconds(),
	}
	if err != nil {
		report.ErrorCode = 14
		report.Error = err.Error()
		emitReviewReport(state, report)
		return newExitError(14, err)
	}
	report.OK = true
	emitReviewReport(state, report)
	return nil
}

func emitReviewReport(state *rootState, r reviewReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Println(r.ReviewFile)
	}
}
