// Package pipeline holds the shared State struct and per-step methods that
// the sp-pipeline run orchestrator calls. It is intentionally separate from
// cmd/sp-pipeline so that unit tests can exercise State.Eval / Write /
// Review / Refine / Credits / Ralph / Deploy without spinning up cobra.
//
// Phase 2b ships State + Eval + Write + Review + Refine. Phase 3 adds
// Credits + Ralph + Deploy. Phase 2c adds Run and wires them together.
package pipeline

import (
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// Step integer encoding — matches scripts/sp-pipeline.sh step_to_int.
const (
	StepSetup  = 0
	StepFetch  = 10
	StepEval   = 15
	StepDedup  = 17
	StepWrite  = 20
	StepReview = 30
	StepRefine = 40
	StepRalph  = 47
	StepDeploy = 50
)

// State is the mutable snapshot of an in-flight pipeline run. Each step
// reads some fields, mutates others, and passes the whole struct through
// to the next step. This is the Go equivalent of the pile of `$WORK_DIR`,
// `$PROMPT_TICKET_ID`, `$WRITE_MODEL`, `$TITLE` globals in the bash
// pipeline, but contained in a single value that tests can construct.
type State struct {
	// ── Inputs (set before the run starts) ─────────────────────────────

	// TweetURL is the original source URL. Empty when resuming via --file.
	TweetURL string
	// WorkDir is the absolute path to the per-run scratch directory.
	// Usually $GU_LOG_DIR/tmp/sp-pending-<unix>-pipeline.
	WorkDir string
	// Prefix is the ticket prefix: "SP", "CP", "SD", "Lv".
	Prefix string
	// FromStepInt gates steps — a step whose integer is less than this
	// is skipped (with a SKIPPED log line). Defaults to 0 (run everything).
	FromStepInt int
	// DryRun disables the Deploy step.
	DryRun bool
	// Force skips the Eval step (matches bash --force).
	Force bool
	// OpusMode pins every LLM step to Claude Opus (no Codex fallback).
	OpusMode bool
	// RalphBar is the minimum tribunal score (advisory — current bash
	// ralph-all-claude.sh has its own internal bar).
	RalphBar int
	// ExistingFile is set when resuming via --file <basename>. Empty for
	// fresh runs.
	ExistingFile string
	// KeepWorkDir disables the cleanup handler for --keep-work-dir runs.
	KeepWorkDir bool
	// SkipBuild disables `npm run build` in Deploy. Used by tests that
	// do not want to boot the Astro build.
	SkipBuild bool
	// SkipPush disables `git push` in Deploy. Used by tests + the
	// future --skip-push flag on `sp-pipeline run`.
	SkipPush bool
	// SkipValidate disables `node scripts/validate-posts.mjs` in Deploy.
	// Tests only.
	SkipValidate bool

	// ── Dependencies injected by the caller ────────────────────────────

	Cfg        *config.Config
	Log        *logx.Logger
	Dispatcher *llm.Dispatcher
	Counter    *counter.Counter

	// ── Fields populated during the run ────────────────────────────────

	// SourcePath is the absolute path to source-tweet.md after Fetch.
	SourcePath string
	// AuthorHandle is the @-handle without the @, e.g. "nickbaumann_".
	AuthorHandle string
	// OriginalDate is YYYY-MM-DD of the source publication.
	OriginalDate string
	// TranslatedDate is YYYY-MM-DD of the translation run (today).
	TranslatedDate string

	// SuggestedTitle comes from the Eval step's JSON and is used as a
	// fallback if the writer does not set one.
	SuggestedTitle string
	// Title is extracted from the draft frontmatter by Ralph.
	Title string

	// DateStamp is YYYYMMDD used in filenames.
	DateStamp string
	// AuthorSlug is the sanitised author handle.
	AuthorSlug string
	// TitleSlug is the sanitised title.
	TitleSlug string

	// PromptTicketID is "PENDING" until the Deploy step bumps the counter
	// and rewrites the pending frontmatter.
	PromptTicketID string
	// SPNumber is the integer allocated by Deploy.
	SPNumber int

	// ActiveFilename is the filename currently sitting in POSTS_DIR while
	// the pipeline runs. Starts as sp-pending-<date>-<author>-<slug>.mdx
	// and is renamed to sp-<N>-... by Deploy.
	ActiveFilename   string
	ActiveENFilename string
	// Filename / ENFilename are the final names set by Deploy.
	Filename   string
	ENFilename string

	// Per-stage model metadata for the credits frontmatter block.
	WriteModel    string
	WriteHarness  string
	ReviewModel   string
	ReviewHarness string
	RefineModel   string
	RefineHarness string

	// Verdicts / outcomes.
	GeminiVerdict string
	CodexVerdict  string
	DedupVerdict  string
	RalphPassed   bool

	// Timings per step (seconds), matches bash summary output.
	Timings map[string]int
}

// NewState constructs a State with sensible defaults. Fields left empty
// by the caller are filled in: Timings is always non-nil; Prefix defaults
// to "SP"; RalphBar defaults to 8; TranslatedDate defaults to empty and
// should be populated before the Write step runs.
func NewState() *State {
	return &State{
		Prefix:         "SP",
		RalphBar:       8,
		PromptTicketID: "PENDING",
		Timings:        map[string]int{},
	}
}

// shouldSkipBelow reports whether a step with the given integer should be
// skipped because the caller used --from-step to start later in the chain.
func (s *State) shouldSkipBelow(stepInt int) bool {
	return stepInt < s.FromStepInt
}

// firstTag returns the mandatory first tag for the Write step. Matches
// bash lines 1021-1022: CP → "clawd-picks", everything else → "shroom-picks".
func (s *State) firstTag() string {
	if s.Prefix == "CP" {
		return "clawd-picks"
	}
	return "shroom-picks"
}
