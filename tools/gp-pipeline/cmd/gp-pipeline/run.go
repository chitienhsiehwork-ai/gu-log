package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// runReport is the JSON shape emitted by `gp-pipeline run --json`.
type runReport struct {
	OK                  bool           `json:"ok"`
	Step                string         `json:"step"`
	TicketID            string         `json:"ticketId,omitempty"`
	Filename            string         `json:"filename,omitempty"`
	ENFilename          string         `json:"enFilename,omitempty"`
	WorkDir             string         `json:"workDir,omitempty"`
	CodexPrimaryVerdict string         `json:"codexPrimaryVerdict,omitempty"`
	CodexVerdict        string         `json:"codexVerdict,omitempty"`
	DedupVerdict        string         `json:"dedupVerdict,omitempty"`
	RalphPassed         bool           `json:"ralphPassed,omitempty"`
	Timings             map[string]int `json:"timings,omitempty"`
	ElapsedMs           int64          `json:"elapsedMs"`
	ErrorCode           int            `json:"errorCode,omitempty"`
	Error               string         `json:"error,omitempty"`
	DryRun              bool           `json:"dryRun,omitempty"`
}

// stepNameToInt maps the --from-step string values (names or numbers) to
// the pipeline.StepXxx constants. The numeric aliases match the retired
// bash pipeline's step numbering so old muscle memory keeps working.
var stepNameToInt = map[string]int{
	"0": pipeline.StepSetup, "setup": pipeline.StepSetup,
	"1": pipeline.StepFetch, "fetch": pipeline.StepFetch,
	"1.5": pipeline.StepEval, "eval": pipeline.StepEval,
	"1.7": pipeline.StepDedup, "dedup": pipeline.StepDedup,
	"2": pipeline.StepWrite, "write": pipeline.StepWrite,
	"3": pipeline.StepReview, "review": pipeline.StepReview,
	"4": pipeline.StepRefine, "refine": pipeline.StepRefine,
	"4.7": pipeline.StepRalph, "ralph": pipeline.StepRalph,
	"4.8": pipeline.StepTranslate, "translate": pipeline.StepTranslate,
	"5": pipeline.StepDeploy, "deploy": pipeline.StepDeploy,
}

func newRunCmd(state *rootState) *cobra.Command {
	var (
		fromStep     string
		dryRun       bool
		force        bool
		ralphBar     int
		existingFile string
		prefix       string
		skipBuild    bool
		skipPush     bool
		skipValidate bool
		skipDedup    bool
		angle        string
		sourceLabel  string
	)
	cmd := &cobra.Command{
		Use:   "run [tweet_url]",
		Short: "Run the full pipeline end-to-end",
		Long: `run wires the individual step subcommands into a single monolithic
invocation covering the whole pipeline (step sequence, prompt templates,
frontmatter shape, commit message, exit codes).

Steps, in order:
  1     fetch      capture the tweet into the work directory
  1.5   eval       evaluate worthiness (skipped with --force)
  1.7   dedup      check the dedup gate
  2     write      draft the zh-tw MDX
  3     review     run the 12-point review checklist
  4     refine     apply review feedback → final.mdx
  4.6   credits    stamp pipeline credits into the frontmatter
  4.7   ralph      run the 4-stage tribunal
  4.8   translate  produce the en sidecar (only when the tribunal passed;
                   skipped otherwise — zh-tw deploys alone)
  5     deploy     allocate ticket ID, rename, validate, build, commit, push

--from-step resumes partway through a previous run. --file is required
when --from-step skips the fetch stage and no tweet URL is given.
--from-step translate treats --file as an already tribunal-passed zh-tw
article, matching the standalone translate recovery command.

--dry-run stops before the deploy stage (matches bash --dry-run).

Use --fake-provider <json> only to test without spending credits or to pin
canned responses for regression tests.`,
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var tweetURL string
			if len(args) == 1 {
				tweetURL = args[0]
			}
			// Fail at ingress: any non-canonical prefix must not reach the
			// fetch, evaluation, or writing stages.
			if err := counter.ValidatePrefix(prefix); err != nil {
				return err
			}
			return runRun(cmd.Context(), state, runOpts{
				TweetURL:     tweetURL,
				FromStep:     fromStep,
				DryRun:       dryRun,
				Force:        force,
				RalphBar:     ralphBar,
				ExistingFile: existingFile,
				Prefix:       prefix,
				SkipBuild:    skipBuild,
				SkipPush:     skipPush,
				SkipValidate: skipValidate,
				SkipDedup:    skipDedup,
				Angle:        angle,
				SourceLabel:  sourceLabel,
			})
		},
	}
	cmd.Flags().StringVar(&fromStep, "from-step", "", "resume from step: setup/fetch/eval/dedup/write/review/refine/ralph/translate/deploy")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "stop before the deploy step")
	cmd.Flags().BoolVar(&force, "force", false, "skip the eval gate (still runs everything else)")
	cmd.Flags().IntVar(&ralphBar, "bar", 8, "ralph quality bar (advisory — tribunal has its own internal bar)")
	cmd.Flags().StringVar(&existingFile, "file", "", "resume from an existing file in src/content/posts/ (already tribunal-passed at translate)")
	cmd.Flags().StringVar(&prefix, "prefix", "GP", "ticket prefix (GP / MP / SD / Lv)")
	cmd.Flags().BoolVar(&skipBuild, "skip-build", false, "skip pnpm run build in the deploy step (testing only)")
	cmd.Flags().BoolVar(&skipPush, "skip-push", false, "skip git push in the deploy step (testing only)")
	cmd.Flags().BoolVar(&skipValidate, "skip-validate", false, "skip validate-posts.mjs in the deploy step (testing only)")
	cmd.Flags().BoolVar(&skipDedup, "skip-dedup", false, "bypass both dedup gates — only for confirmed false positives (e.g. same-author, different thesis)")
	cmd.Flags().StringVar(&angle, "angle", "", "optional narrative angle to make the article spine")
	cmd.Flags().StringVar(&sourceLabel, "source-label", "", "override the `source:` frontmatter line")
	return cmd
}

type runOpts struct {
	TweetURL     string
	FromStep     string
	DryRun       bool
	Force        bool
	RalphBar     int
	ExistingFile string
	Prefix       string
	SkipBuild    bool
	SkipPush     bool
	SkipValidate bool
	SkipDedup    bool
	Angle        string
	SourceLabel  string
}

func runRun(ctx context.Context, state *rootState, opts runOpts) error {
	start := time.Now()

	fromStepInt := 0
	if opts.FromStep != "" {
		v, ok := stepNameToInt[strings.ToLower(opts.FromStep)]
		if !ok {
			return fmt.Errorf("run: unknown step %q; valid: setup / fetch / eval / dedup / write / review / refine / ralph / translate / deploy", opts.FromStep)
		}
		fromStepInt = v
	}
	if fromStepInt == pipeline.StepTranslate && opts.ExistingFile == "" {
		return fmt.Errorf("run: --from-step translate requires --file <tribunal-passed zh-tw post>")
	}
	if err := counter.ValidatePrefix(opts.Prefix); err != nil {
		return err
	}
	if opts.TweetURL == "" && opts.ExistingFile == "" && fromStepInt < pipeline.StepWrite {
		return fmt.Errorf("run: tweet URL is required when not resuming via --file + --from-step")
	}

	writerDisp, err := buildDispatcherForRole(state, dispatcherWriter)
	if err != nil {
		return err
	}
	judgeDisp, err := buildDispatcherForRole(state, dispatcherJudge)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = writerDisp
	s.WriterDispatcher = writerDisp
	s.JudgeDispatcher = judgeDisp
	s.Counter = counter.New(state.cfg.CounterFile, "")
	s.TweetURL = opts.TweetURL
	s.Prefix = opts.Prefix
	s.PromptTicketID, err = counter.PendingTicketID(opts.Prefix)
	if err != nil {
		return err
	}
	s.FromStepInt = fromStepInt
	s.DryRun = opts.DryRun
	s.Force = opts.Force
	s.RalphBar = opts.RalphBar
	s.ExistingFile = opts.ExistingFile
	s.SkipBuild = opts.SkipBuild
	s.SkipPush = opts.SkipPush
	s.SkipValidate = opts.SkipValidate
	s.SkipDedup = opts.SkipDedup
	s.Angle = opts.Angle
	s.SourceLabel = opts.SourceLabel

	// Work dir: respect --work-dir from the root command.
	if flagWorkDir != "" {
		s.WorkDir = flagWorkDir
	}
	cleanup, err := pipeline.SetupWorkDir(s)
	if err != nil {
		return fmt.Errorf("run: %w", err)
	}
	defer cleanup()

	runErr := pipeline.Run(ctx, s)

	report := runReport{
		Step:                "run",
		TicketID:            s.PromptTicketID,
		Filename:            s.Filename,
		ENFilename:          s.ENFilename,
		WorkDir:             s.WorkDir,
		CodexPrimaryVerdict: s.CodexPrimaryVerdict,
		CodexVerdict:        s.CodexVerdict,
		DedupVerdict:        s.DedupVerdict,
		RalphPassed:         s.RalphPassed,
		Timings:             s.Timings,
		ElapsedMs:           time.Since(start).Milliseconds(),
		DryRun:              opts.DryRun,
	}
	if runErr != nil {
		var se *pipeline.StepError
		if errors.As(runErr, &se) {
			report.ErrorCode = se.Code
		} else {
			report.ErrorCode = 1
		}
		report.Error = runErr.Error()
		emitRunReport(state, report, s)
		return newExitError(report.ErrorCode, runErr)
	}
	report.OK = true
	emitRunReport(state, report, s)
	return nil
}

func emitRunReport(state *rootState, r runReport, s *pipeline.State) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	pipeline.PrintSummary(os.Stdout, s)
}
