package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
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
	)
	cmd := &cobra.Command{
		Use:   "review",
		Short: "Run the review checklist against a draft",
		Long: fmt.Sprintf(`review runs the full-draft review for a %s draft; the
ticket series picks the checklist. The ticket is --ticket-id, or else the
frontmatter ticketId of the draft (--draft, and the work dir's draft-v1.mdx
when that is another file); a draft without a canonical one, or two drafts of
different series, need --ticket-id, since review never picks a series. This
command points the LLM at draft-v1.mdx and asks it to produce a review.md
with blocker/major/minor findings.

Unlike write, this prompt does NOT embed the draft contents — the LLM
is expected to read draft-v1.mdx from --work-dir. This matches how the
pipeline runs `+"`codex exec`"+` in (cd $WORK_DIR && …).`, authorableSeries(" / ")),
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runReview(cmd.Context(), state, draftPath, workDir, ticketID)
		},
	}
	cmd.Flags().StringVar(&draftPath, "draft", "", "path to draft-v1.mdx (required; its parent is used as work-dir when --work-dir is empty)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory where review.md should land (defaults to dirname of --draft)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "", "canonical ticketId for the review prompt header (defaults to the draft's frontmatter ticketId)")
	_ = cmd.MarkFlagRequired("draft")
	return cmd
}

// draftIngress is the shared ingress of review and refine; it returns the
// ticket ID, its series (which picks the prompt), and the absolute work dir
// (--work-dir, or the --draft directory). The ticket is --ticket-id, or
// the drafts' frontmatter ticketId when the flag is unset (see draftTicket).
// An Lv ticket is refused, and so is an Lv draft whatever --ticket-id says:
// --draft and the work dir's draft-v1.mdx, the file the model actually reads.
// Every check comes before any work dir or model.
func draftIngress(command, draftPath, workDir, ticketID string) (ticket, prefix, absWorkDir string, err error) {
	if ticketID != "" {
		if prefix, err = authorableTicketPrefix(command, ticketID); err != nil {
			return "", "", "", err
		}
	}
	absDraft, err := filepath.Abs(draftPath)
	if err != nil {
		return "", "", "", err
	}
	if _, err := os.Stat(absDraft); err != nil {
		return "", "", "", fmt.Errorf("%s: draft not found at %s", command, absDraft)
	}
	if workDir == "" {
		workDir = filepath.Dir(absDraft)
	}
	if absWorkDir, err = filepath.Abs(workDir); err != nil {
		return "", "", "", err
	}
	if err := pipeline.RefuseLvFiles(command, absDraft, filepath.Join(absWorkDir, "draft-v1.mdx")); err != nil {
		return "", "", "", err
	}
	if ticketID == "" {
		if ticketID, prefix, err = draftTicket(command, absDraft, absWorkDir); err != nil {
			return "", "", "", err
		}
	}
	return ticketID, prefix, absWorkDir, nil
}

// authorableTicketPrefix returns the series of a canonical ticket ID and
// refuses Lv, which gp-pipeline does not write.
func authorableTicketPrefix(command, ticketID string) (string, error) {
	prefix, err := counter.PrefixOfTicketID(ticketID)
	if err != nil {
		return "", err
	}
	if !pipeline.IsAuthorable(prefix) {
		return "", pipeline.LvAuthoringError(command)
	}
	return prefix, nil
}

// draftTicket is the ticket and series of a review or refine run without
// --ticket-id, read from the frontmatter of --draft and of the work dir's
// draft-v1.mdx, the file the model reads, when that is another file. No
// command picks a series on the caller's behalf, so each draft must name a
// canonical ticket of the same series, or the run is refused, listing the
// series to choose from like write's missing --prefix. The ticket is the one
// of the file the model reads.
func draftTicket(command, absDraft, absWorkDir string) (string, string, error) {
	drafts := []string{absDraft}
	if modelDraft := filepath.Join(absWorkDir, "draft-v1.mdx"); modelDraft != absDraft {
		if _, statErr := os.Stat(modelDraft); statErr == nil {
			drafts = append(drafts, modelDraft)
		}
	}
	var ticket, prefix string
	for _, draft := range drafts {
		fileTicket, err := pipeline.PostTicketID(draft)
		if err != nil {
			return "", "", fmt.Errorf("%s: %w", command, err)
		}
		if fileTicket == "" {
			return "", "", fmt.Errorf("%s: --ticket-id is required: %s has no ticketId in its frontmatter; pass --ticket-id <series>-PENDING, series one of %v",
				command, draft, pipeline.AuthorablePrefixes)
		}
		if err := counter.ValidateTicketID(fileTicket); err != nil {
			return "", "", fmt.Errorf("%s: %s frontmatter: %w; fix it or pass --ticket-id <series>-PENDING, series one of %v",
				command, draft, err, pipeline.AuthorablePrefixes)
		}
		filePrefix, err := authorableTicketPrefix(command, fileTicket)
		if err != nil {
			return "", "", err
		}
		if prefix != "" && filePrefix != prefix {
			return "", "", fmt.Errorf("%s: --ticket-id is required: %s is %s but %s, the draft the model reads, is %s; pass --ticket-id <series>-PENDING, series one of %v",
				command, absDraft, prefix, draft, filePrefix, pipeline.AuthorablePrefixes)
		}
		ticket, prefix = fileTicket, filePrefix
	}
	return ticket, prefix, nil
}

func runReview(ctx context.Context, state *rootState, draftPath, workDir, ticketID string) error {
	start := time.Now()
	ticketID, prefix, workDir, err := draftIngress("review", draftPath, workDir, ticketID)
	if err != nil {
		return err
	}

	disp, err := buildDispatcherForRole(state, dispatcherJudge)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
	s.JudgeDispatcher = disp
	s.WorkDir = workDir
	s.PromptTicketID = ticketID
	s.Prefix = prefix

	err = s.Review(ctx)

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
