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

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

// runReport is the JSON shape emitted by `gp-pipeline run --json`.
type runReport struct {
	OK                  bool   `json:"ok"`
	Step                string `json:"step"`
	TicketID            string `json:"ticketId,omitempty"`
	Filename            string `json:"filename,omitempty"`
	ENFilename          string `json:"enFilename,omitempty"`
	WorkDir             string `json:"workDir,omitempty"`
	CodexPrimaryVerdict string `json:"codexPrimaryVerdict,omitempty"`
	CodexVerdict        string `json:"codexVerdict,omitempty"`
	DedupVerdict        string `json:"dedupVerdict,omitempty"`
	RalphPassed         bool   `json:"ralphPassed,omitempty"`
	// SourceDistance is the GP source-distance outcome (verdict, rewrite
	// rounds, aligner calls and the evidence directory in the work dir).
	SourceDistance *pipeline.SourceDistanceOutcome `json:"sourceDistance,omitempty"`
	// EnglishCheck is the GP English verbatim check: PASS, or
	// SKIPPED_VERBATIM when the English version was dropped.
	EnglishCheck     string         `json:"englishCheck,omitempty"`
	TranslateModel   string         `json:"translateModel,omitempty"`
	TranslateHarness string         `json:"translateHarness,omitempty"`
	Timings          map[string]int `json:"timings,omitempty"`
	ElapsedMs        int64          `json:"elapsedMs"`
	ErrorCode        int            `json:"errorCode,omitempty"`
	Error            string         `json:"error,omitempty"`
	DryRun           bool           `json:"dryRun,omitempty"`
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
	"source-distance": pipeline.StepSourceDistance,
	"4.7":             pipeline.StepRalph, "ralph": pipeline.StepRalph,
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
		Long: fmt.Sprintf(`run wires the individual step subcommands into a single monolithic
invocation covering the whole pipeline (step sequence, prompt templates,
frontmatter shape, commit message, exit codes).

Steps, in order:
  1     fetch            capture the source into the work directory
  1.5   eval             evaluate worthiness (skipped with --force)
  1.7   dedup            check the dedup gate
  2     write            draft the zh-tw article from the source
  3     review           review the draft
  4     refine           apply the review and write final.mdx
  4.2   post-fixer       GP only: kaomoji, glossary links and related reading,
                         applied to final.mdx in the work dir
  4.4   source-distance  GP only: pair, score and stamp final.mdx (see below)
  4.6   credits          stamp pipeline credits into the frontmatter
  4.7   ralph            run the 4-stage tribunal (GP: scores only, never
                         rewrites or re-fixes the stamped body)
  4.8   translate        produce the en sidecar (only when the tribunal passed;
                         skipped otherwise — zh-tw deploys alone)
  5     deploy           allocate ticket ID, rename, validate, build, commit, push

GP is a ShroomDog-picked reading guide in Mogu's voice (ShroomDog 精選導讀),
not a translation. Every GP refine output must pass the content checks the
pre-commit hook runs on a post: what they flag goes back to refine,
at most %[3]d times, and a body that still fails them is never paired or
stamped (exit 14). After the post-fixer, source-distance asks a
pinned Claude aligner which guide sentences restate which source sentences,
and the program scores that: a draft that reads like a translation goes back
to refine with only the flagged passages, then through the post-fixer again,
at most %[1]d rewrites. Zero alignments, or a draft still failing after the last
rewrite, stops with exit %[2]d: nothing is deployed and the counter is untouched;
every round's evidence stays in the work dir. A GP English version must pass a
verbatim check against the source; one that does not is dropped without a
retranslation, the zh-tw stamp records englishSkipped: verbatim, and zh-tw
deploys alone.

Without --file, --prefix is required: a run never picks a series on its own,
and a missing --prefix fails before any work dir, fetch, or model call.

--from-step resumes partway through a previous run. --file is required
when --from-step skips the fetch stage and no tweet URL is given. With
--file, the file's series (gp-/mp-/sd-/lv-/levelup-) decides the run, and an
explicit --prefix must match it. --from-step source-distance (GP only)
re-pairs and re-scores the work dir's final.mdx without rewriting the draft.

--dry-run stops before the deploy stage (matches bash --dry-run).

Exit codes: 1 ingress or usage error, 2 eval split, 10 fetch failed,
11 incomplete capture, 12 eval SKIP, 13 dedup BLOCK, 14 a step or the aligner
failed, 16 validate-posts rejected, 17 build failed, 18 push failed,
%[2]d GP source distance did not pass, 124 timeout.

Use --fake-provider <json> only to test without spending credits or to pin
canned responses for regression tests.`, pipeline.MaxSourceDistanceRewrites, pipeline.SourceDistanceExitCode, pipeline.MaxContentLintFixes),
		Args: cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			var tweetURL string
			if len(args) == 1 {
				tweetURL = args[0]
			}
			return runRun(cmd.Context(), state, runOpts{
				TweetURL:     tweetURL,
				FromStep:     fromStep,
				DryRun:       dryRun,
				Force:        force,
				RalphBar:     ralphBar,
				ExistingFile: existingFile,
				Prefix:       prefix,
				PrefixSet:    cmd.Flags().Changed("prefix"),
				SkipBuild:    skipBuild,
				SkipPush:     skipPush,
				SkipValidate: skipValidate,
				SkipDedup:    skipDedup,
				Angle:        angle,
				SourceLabel:  sourceLabel,
			})
		},
	}
	cmd.Flags().StringVar(&fromStep, "from-step", "", "resume from step: setup/fetch/eval/dedup/write/review/refine/source-distance (GP)/ralph/translate/deploy")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "stop before the deploy step")
	cmd.Flags().BoolVar(&force, "force", false, "skip the eval gate (still runs everything else)")
	cmd.Flags().IntVar(&ralphBar, "bar", 8, "ralph quality bar (advisory — tribunal has its own internal bar)")
	cmd.Flags().StringVar(&existingFile, "file", "", "resume from an existing post in src/content/posts/; its filename sets the series")
	cmd.Flags().StringVar(&prefix, "prefix", "", "ticket prefix (GP / MP / SD / Lv); required without --file, and must match the --file series when given")
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
	// PrefixSet reports an explicit --prefix; only then must it agree with
	// the series named by --file.
	PrefixSet    bool
	SkipBuild    bool
	SkipPush     bool
	SkipValidate bool
	SkipDedup    bool
	Angle        string
	SourceLabel  string
}

func runRun(ctx context.Context, state *rootState, opts runOpts) error {
	start := time.Now()
	// Fail at ingress: a missing or non-canonical series must not reach the
	// work dir, fetch, evaluation, or writing stages.
	prefix, err := resolveSeries("run", opts.Prefix, opts.PrefixSet, "--file", opts.ExistingFile)
	if err != nil {
		return err
	}
	opts.Prefix = prefix

	fromStepInt := 0
	if opts.FromStep != "" {
		v, ok := stepNameToInt[strings.ToLower(opts.FromStep)]
		if !ok {
			return fmt.Errorf("run: unknown step %q; valid: setup / fetch / eval / dedup / write / review / refine / source-distance / ralph / translate / deploy", opts.FromStep)
		}
		fromStepInt = v
	}
	if fromStepInt == pipeline.StepSourceDistance && opts.Prefix != "GP" {
		return fmt.Errorf("run: --from-step source-distance only applies to GP; %s has no source-distance step", opts.Prefix)
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
	if opts.TweetURL != "" && fromStepInt <= pipeline.StepFetch && source.IsYouTubeOwnedHostURL(opts.TweetURL) {
		if _, err := source.ParseYouTubeURL(opts.TweetURL); err != nil {
			return fmt.Errorf("run: %w", err)
		}
		if err := source.RequireYTDLP(); err != nil {
			return newExitError(10, fmt.Errorf("run: %w", err))
		}
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Counter = counter.New(state.cfg.CounterFile, "")
	s.TweetURL = opts.TweetURL
	s.Prefix = opts.Prefix
	pendingTicketID, err := counter.PendingTicketID(opts.Prefix)
	if err != nil {
		return err
	}
	s.PromptTicketID = pendingTicketID
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
	// Establish the durable workdir before provider/profile preflight so even a
	// failure before the first content step leaves a report and recovery state.
	if flagWorkDir != "" {
		s.WorkDir = flagWorkDir
	}
	cleanup, err := pipeline.SetupWorkDir(s)
	if err != nil {
		return fmt.Errorf("run: %w", err)
	}
	defer cleanup()
	recordPreflightFailure := func(role string, preflightErr error) error {
		s.RecordRoleFailure(role, preflightErr)
		s.RecordRunFailure("provider-preflight", preflightErr)
		emitRunReport(state, runReport{
			Step:      "run",
			TicketID:  s.PromptTicketID,
			WorkDir:   s.WorkDir,
			Timings:   s.Timings,
			ElapsedMs: time.Since(start).Milliseconds(),
			ErrorCode: 1,
			Error:     preflightErr.Error(),
			DryRun:    s.DryRun,
		}, s)
		return newExitError(1, preflightErr)
	}

	judgeDisp, err := buildDispatcherForRole(state, dispatcherJudge)
	if err != nil {
		return recordPreflightFailure(string(dispatcherJudge), err)
	}
	s.JudgeDispatcher = judgeDisp
	writerDisp, err := buildDispatcherForRole(state, dispatcherWriter)
	if err != nil {
		return recordPreflightFailure(string(dispatcherWriter), err)
	}
	s.Dispatcher, s.WriterDispatcher = writerDisp, writerDisp
	if s.Prefix == "GP" && fromStepInt <= pipeline.StepSourceDistance {
		alignerDisp, err := buildAlignerDispatcher(ctx, state)
		if err != nil {
			return recordPreflightFailure(string(dispatcherAligner), err)
		}
		s.AlignerDispatcher = alignerDisp
	}

	runErr := pipeline.Run(ctx, s)

	report := runReport{
		Step:                "run",
		TicketID:            s.PromptTicketID,
		Filename:            s.Filename,
		ENFilename:          selectRunReportENFilename(s.Cfg.PostsDir, s.ENFilename, s.ActiveENFilename),
		WorkDir:             s.WorkDir,
		CodexPrimaryVerdict: s.CodexPrimaryVerdict,
		CodexVerdict:        s.CodexVerdict,
		DedupVerdict:        s.DedupVerdict,
		RalphPassed:         s.RalphPassed,
		SourceDistance:      s.SourceDistanceResult,
		EnglishCheck:        s.EnglishCheck,
		TranslateModel:      s.TranslateModel,
		TranslateHarness:    s.TranslateHarness,
		Timings:             s.Timings,
		ElapsedMs:           time.Since(start).Milliseconds(),
		DryRun:              s.DryRun,
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

// resolveSeries picks the series a run or standalone deploy works on, and the
// article decides: with a file, its filename series wins and an explicitly set
// --prefix must agree; without one, --prefix is required and has no default.
func resolveSeries(command, prefix string, prefixSet bool, fileFlag, filename string) (string, error) {
	if filename == "" {
		if prefix == "" {
			return "", fmt.Errorf("%s: --prefix is required without %s; choose one of %v", command, fileFlag, counter.ValidPrefixes)
		}
		if err := counter.ValidatePrefix(prefix); err != nil {
			return "", err
		}
		return prefix, nil
	}
	if prefixSet {
		if err := counter.ValidatePrefix(prefix); err != nil {
			return "", err
		}
	}
	series, err := pipeline.SeriesFromFilename(filename)
	if err != nil {
		return "", fmt.Errorf("%s: %s: %w", command, fileFlag, err)
	}
	if prefixSet && prefix != series {
		return "", fmt.Errorf("%s: --prefix %s does not match %s %s (series %s); drop --prefix or pass the matching file", command, prefix, fileFlag, filename, series)
	}
	return series, nil
}

// selectRunReportENFilename reports only an English artifact that exists as
// a regular file in PostsDir. The deployed name is authoritative when both
// deployed and active names exist; recovery runs that stop before deploy fall
// back to the sidecar written by Translate.
func selectRunReportENFilename(postsDir, finalName, activeName string) string {
	for _, candidate := range []string{finalName, activeName} {
		if candidate == "" || filepath.Base(candidate) != candidate || strings.ContainsAny(candidate, `/\`) {
			continue
		}
		info, err := os.Lstat(filepath.Join(postsDir, candidate))
		if err == nil && info.Mode().IsRegular() {
			return candidate
		}
	}
	return ""
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
