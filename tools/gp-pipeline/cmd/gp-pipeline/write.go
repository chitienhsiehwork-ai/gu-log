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

type writeReport struct {
	OK        bool   `json:"ok"`
	Step      string `json:"step"`
	DraftFile string `json:"draftFile,omitempty"`
	Model     string `json:"model,omitempty"`
	Harness   string `json:"harness,omitempty"`
	ElapsedMs int64  `json:"elapsedMs"`
	ErrorCode int    `json:"errorCode,omitempty"`
	Error     string `json:"error,omitempty"`
}

func newWriteCmd(state *rootState) *cobra.Command {
	var (
		sourcePath     string
		workDir        string
		ticketID       string
		originalDate   string
		authorHandle   string
		tweetURL       string
		prefix         string
		translatedDate string
		angle          string
		sourceLabel    string
		sourceIsX      bool
	)
	cmd := &cobra.Command{
		Use:   "write",
		Short: "Draft the zh-tw MDX article from a captured source",
		Long: `write is Step 2 of the pipeline. It renders the write.tmpl prompt
with the source-tweet.md contents and GU-LOG_WRITER_PROMPT.md embedded as
template variables, then runs it through the LLM dispatcher. The prompt
instructs the LLM to write draft-v1.mdx into the working directory.

The --ticket-id, --original-date, --author-handle, --tweet-url, and
--prefix flags populate the article's frontmatter. Most callers will
set these from the upstream fetch + counter steps.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runWrite(cmd.Context(), state, writeOpts{
				SourcePath:     sourcePath,
				WorkDir:        workDir,
				TicketID:       ticketID,
				OriginalDate:   originalDate,
				AuthorHandle:   authorHandle,
				TweetURL:       tweetURL,
				Prefix:         prefix,
				TranslatedDate: translatedDate,
				Angle:          angle,
				SourceLabel:    sourceLabel,
				SourceIsX:      sourceIsX,
			})
		},
	}
	cmd.Flags().StringVar(&sourcePath, "source", "", "path to source-tweet.md (required)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory to write draft-v1.mdx into (defaults to dirname of --source)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "", "canonical ticketId (defaults to <prefix>-PENDING)")
	cmd.Flags().StringVar(&originalDate, "original-date", "", "YYYY-MM-DD of the source publication")
	cmd.Flags().StringVar(&authorHandle, "author", "", "author handle WITHOUT @ prefix")
	cmd.Flags().StringVar(&tweetURL, "tweet-url", "", "canonical source URL")
	cmd.Flags().StringVar(&prefix, "prefix", "GP", "ticket prefix (GP / MP / SD / Lv)")
	cmd.Flags().StringVar(&translatedDate, "translated-date", "", "YYYY-MM-DD of the translation run (defaults to today)")
	cmd.Flags().StringVar(&angle, "angle", "", "optional narrative angle to make the article spine")
	cmd.Flags().StringVar(&sourceLabel, "source-label", "", "override the `source:` frontmatter line")
	cmd.Flags().BoolVar(&sourceIsX, "source-is-x", true, "treat --author as an X handle when auto-rendering source")
	_ = cmd.MarkFlagRequired("source")
	return cmd
}

type writeOpts struct {
	SourcePath     string
	WorkDir        string
	TicketID       string
	OriginalDate   string
	AuthorHandle   string
	TweetURL       string
	Prefix         string
	TranslatedDate string
	Angle          string
	SourceLabel    string
	SourceIsX      bool
}

func runWrite(ctx context.Context, state *rootState, opts writeOpts) error {
	start := time.Now()
	if opts.TicketID == "" {
		pending, err := counter.PendingTicketID(opts.Prefix)
		if err != nil {
			return err
		}
		opts.TicketID = pending
	}
	if err := counter.ValidateTicketIDForPrefix(opts.TicketID, opts.Prefix); err != nil {
		return err
	}
	absSource, err := filepath.Abs(opts.SourcePath)
	if err != nil {
		return err
	}
	workDir := opts.WorkDir
	if workDir == "" {
		workDir = filepath.Dir(absSource)
	}
	workDir, err = filepath.Abs(workDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("write: mkdir %s: %w", workDir, err)
	}

	disp, err := buildDispatcherForRole(state, dispatcherWriter)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
	s.WriterDispatcher = disp
	s.SourcePath = absSource
	s.WorkDir = workDir
	s.PromptTicketID = opts.TicketID
	s.OriginalDate = opts.OriginalDate
	s.AuthorHandle = opts.AuthorHandle
	s.TweetURL = opts.TweetURL
	s.Prefix = opts.Prefix
	s.TranslatedDate = opts.TranslatedDate
	s.Angle = opts.Angle
	s.SourceLabel = opts.SourceLabel
	s.SourceIsX = opts.SourceIsX

	stepCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()

	err = s.Write(stepCtx)

	report := writeReport{
		Step:      "write",
		DraftFile: filepath.Join(workDir, "draft-v1.mdx"),
		Model:     s.WriteModel,
		Harness:   s.WriteHarness,
		ElapsedMs: time.Since(start).Milliseconds(),
	}
	if err != nil {
		report.ErrorCode = 14
		report.Error = err.Error()
		emitWriteReport(state, report)
		return newExitError(14, err)
	}
	report.OK = true
	emitWriteReport(state, report)
	return nil
}

func emitWriteReport(state *rootState, r writeReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Println(r.DraftFile)
	}
}
