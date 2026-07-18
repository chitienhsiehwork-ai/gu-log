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

type translateReport struct {
	OK         bool   `json:"ok"`
	Step       string `json:"step"`
	ENFilename string `json:"enFilename,omitempty"`
	Model      string `json:"model,omitempty"`
	ElapsedMs  int64  `json:"elapsedMs"`
	ErrorCode  int    `json:"errorCode,omitempty"`
	Error      string `json:"error,omitempty"`
}

func newTranslateCmd(state *rootState) *cobra.Command {
	var (
		file       string
		enFilename string
		workDir    string
		ticketID   string
		opusOnly   bool
	)
	cmd := &cobra.Command{
		Use:   "translate",
		Short: "Produce the en sidecar for a tribunal-passed zh-tw article",
		Long: `translate is Step 4.8 of the pipeline. Inside "run" it fires
automatically after ralph, but only when the tribunal passed — that keeps it
aligned with CONTRIBUTING.md's zh-tw-first SOP (translate only after zh-tw
is stable).

This standalone subcommand exists for recovery: an existing file in
src/content/posts/ that already passed the tribunal but is missing its en-
sidecar (for example if the automated "run" pipeline's translate step was
interrupted, or the article predates this subcommand's existence).

--file assumes the article already passed the tribunal — the standalone
subcommand does not re-check RalphPassed (there is no in-flight State to
check it against).`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runTranslate(cmd.Context(), state, translateCmdOpts{
				File:       file,
				ENFilename: enFilename,
				WorkDir:    workDir,
				TicketID:   ticketID,
				OpusOnly:   opusOnly,
			})
		},
	}
	cmd.Flags().StringVar(&file, "file", "", "zh-tw filename already in src/content/posts/ (required)")
	cmd.Flags().StringVar(&enFilename, "en-file", "", "output en filename (defaults to en-<file>)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "scratch work directory for the LLM call (defaults to a temp dir)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "PENDING", "ticketId to interpolate into the prompt")
	cmd.Flags().BoolVar(&opusOnly, "opus", false, "deprecated compatibility flag; writer routing is automatic")
	_ = cmd.MarkFlagRequired("file")
	return cmd
}

type translateCmdOpts struct {
	File       string
	ENFilename string
	WorkDir    string
	TicketID   string
	OpusOnly   bool
}

func runTranslate(ctx context.Context, state *rootState, opts translateCmdOpts) error {
	start := time.Now()

	workDir := opts.WorkDir
	if workDir == "" {
		stamp := time.Now().Unix()
		workDir = filepath.Join(os.TempDir(), fmt.Sprintf("sp-translate-%d", stamp))
	}
	workDir, err := filepath.Abs(workDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("translate: mkdir %s: %w", workDir, err)
	}

	disp, err := buildDispatcherForRole(state, dispatcherWriter, opts.OpusOnly)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
	s.WriterDispatcher = disp
	s.WorkDir = workDir
	s.PromptTicketID = opts.TicketID
	s.ActiveFilename = opts.File
	s.ActiveENFilename = opts.ENFilename
	// The standalone subcommand's whole purpose is to translate an
	// already-tribunal-passed article, so it always proceeds.
	s.RalphPassed = true

	stepCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	err = s.Translate(stepCtx)

	report := translateReport{
		Step:       "translate",
		ENFilename: s.ActiveENFilename,
		ElapsedMs:  time.Since(start).Milliseconds(),
	}
	if err != nil {
		report.ErrorCode = 14
		report.Error = err.Error()
		emitTranslateReport(state, report)
		return newExitError(14, err)
	}
	report.OK = true
	emitTranslateReport(state, report)
	return nil
}

func emitTranslateReport(state *rootState, r translateReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Println(r.ENFilename)
	}
}
