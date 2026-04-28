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
		opusOnly       bool
		angle          string
		sourceLabel    string
		sourceIsX      bool
	)
	cmd := &cobra.Command{
		Use:   "write",
		Short: "Draft the zh-tw MDX article from a captured source",
		Long: `write is Step 2 of the pipeline. It renders the write.tmpl prompt
with the source-tweet.md contents and WRITING_GUIDELINES.md embedded as
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
				OpusOnly:       opusOnly,
				Angle:          angle,
				SourceLabel:    sourceLabel,
				SourceIsX:      sourceIsX,
			})
		},
	}
	cmd.Flags().StringVar(&sourcePath, "source", "", "path to source-tweet.md (required)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory to write draft-v1.mdx into (defaults to dirname of --source)")
	cmd.Flags().StringVar(&ticketID, "ticket-id", "PENDING", "ticketId to interpolate into the prompt (usually PENDING until deploy)")
	cmd.Flags().StringVar(&originalDate, "original-date", "", "YYYY-MM-DD of the source publication")
	cmd.Flags().StringVar(&authorHandle, "author", "", "author handle WITHOUT @ prefix (or hostname for non-X sources)")
	cmd.Flags().StringVar(&tweetURL, "tweet-url", "", "canonical source URL")
	cmd.Flags().StringVar(&prefix, "prefix", "SP", "ticket prefix (SP / CP / SD / Lv) — controls first tag")
	cmd.Flags().StringVar(&translatedDate, "translated-date", "", "YYYY-MM-DD of the translation run (defaults to today)")
	cmd.Flags().BoolVar(&opusOnly, "opus", false, "use Claude Opus only (no Codex fallback)")
	cmd.Flags().StringVar(&angle, "angle", "", "narrative directive injected into the write prompt (e.g. \"focus on Task Flow while introducing the others\")")
	cmd.Flags().StringVar(&sourceLabel, "source-label", "", "override the `source:` frontmatter line; empty = auto from --source-is-x + --author")
	cmd.Flags().BoolVar(&sourceIsX, "source-is-x", true, "true = render \"@<author> on X\"; false = render hostname when --source-label is empty")
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
	OpusOnly       bool
	Angle          string
	SourceLabel    string
	SourceIsX      bool
}

func runWrite(ctx context.Context, state *rootState, opts writeOpts) error {
	start := time.Now()
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

	disp, err := buildDispatcher(state, opts.OpusOnly)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
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
