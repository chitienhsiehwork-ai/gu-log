// Package pipeline holds the shared State struct and per-step methods that
// the gp-pipeline run orchestrator calls. It is intentionally separate from
// cmd/gp-pipeline so that unit tests can exercise State.Eval / Write /
// Review / Refine / Credits / Ralph / Deploy without spinning up cobra.
//
// Phase 2b ships State + Eval + Write + Review + Refine. Phase 3 adds
// Credits + Ralph + Deploy. Phase 2c adds Run and wires them together.
package pipeline

import (
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

// Step integer encoding — kept aligned with the retired bash pipeline's step_to_int.
const (
	StepSetup     = 0
	StepFetch     = 10
	StepDedupURL  = 12
	StepEval      = 15
	StepDedup     = 17
	StepWrite     = 20
	StepReview    = 30
	StepRefine    = 40
	StepRalph     = 47
	StepTranslate = 48 // Go-only step, no bash equivalent (gu-log #546)
	StepDeploy    = 50
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
	// Usually $TMPDIR/gp-pending-<unix>-pipeline — outside the repo; see
	// resolveWorkDir in cmd/gp-pipeline/fetch.go.
	WorkDir string
	// Prefix is the ticket prefix: "GP", "MP", "SD", "Lv".
	Prefix string
	// FromStepInt gates steps — a step whose integer is less than this
	// is skipped (with a SKIPPED log line). Defaults to 0 (run everything).
	FromStepInt int
	// DryRun disables the Deploy step.
	DryRun bool
	// Force skips the Eval step (matches bash --force).
	Force bool
	// RalphBar is the minimum tribunal score (advisory — current bash
	// tribunal.sh has its own internal bar).
	RalphBar int
	// ExistingFile is set when resuming via --file <basename>. Empty for
	// fresh runs.
	ExistingFile string
	// KeepWorkDir disables the cleanup handler for --keep-work-dir runs.
	KeepWorkDir bool
	// SkipBuild disables `pnpm run build` in Deploy. Used by tests that
	// do not want to boot the Astro build.
	SkipBuild bool
	// SkipPush disables `git push` in Deploy. Used by tests + the
	// future --skip-push flag on `gp-pipeline run`.
	SkipPush bool
	// SkipValidate disables `node scripts/validate-posts.mjs` in Deploy.
	// Tests only.
	SkipValidate bool
	// SkipDedup bypasses both dedup gates (Step 1.2 URL + Step 1.7 topic).
	// Escape hatch for confirmed false positives — e.g. a topic-similarity
	// BLOCK against a same-author post on a genuinely different thesis. The
	// override is logged loudly so it never happens silently.
	SkipDedup bool

	// Angle is an optional narrative directive passed to the Write and
	// Refine prompts. When non-empty, the article is structurally pivoted
	// around this angle instead of treating every section of the source
	// material with equal weight.
	Angle string

	// SourceLabel overrides the `source:` frontmatter line emitted by the
	// Write step. Empty = auto-derive from the fetch result.
	SourceLabel string

	// ── Dependencies injected by the caller ────────────────────────────

	Cfg              *config.Config
	Log              *logx.Logger
	Dispatcher       *llm.Dispatcher
	WriterDispatcher *llm.Dispatcher
	JudgeDispatcher  *llm.Dispatcher
	Counter          *counter.Counter

	// ── Fields populated during the run ────────────────────────────────

	// SourcePath is the absolute path to source-tweet.md after Fetch.
	SourcePath string
	// AuthorHandle is the @-handle without the @, e.g. "nickbaumann_".
	// For generic (non-X) URLs this is the hostname used for filename slug
	// generation; the `source:` frontmatter line uses ResolveSourceField.
	AuthorHandle string
	// SourceIsX is true when the captured source came from x.com / twitter.com.
	// False for generic articles fetched via curl + HTML cleanup.
	SourceIsX bool
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

	// PromptTicketID is "<PREFIX>-PENDING" until Deploy bumps the counter
	// and rewrites the pending frontmatter.
	PromptTicketID string
	// TicketNumber is the integer allocated by Deploy.
	TicketNumber int

	// ActiveFilename is the filename currently sitting in POSTS_DIR while
	// the pipeline runs. Starts as gp-pending-<date>-<author>-<slug>.mdx
	// and is renamed to gp-<N>-... by Deploy.
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
	CodexPrimaryVerdict string
	CodexVerdict        string
	DedupVerdict        string
	RalphPassed         bool

	// Timings per step (seconds), matches bash summary output.
	Timings map[string]int
}

func (s *State) writerDispatcher() *llm.Dispatcher {
	if s.WriterDispatcher != nil {
		return s.WriterDispatcher
	}
	return s.Dispatcher
}

func (s *State) judgeDispatcher() *llm.Dispatcher {
	if s.JudgeDispatcher != nil {
		return s.JudgeDispatcher
	}
	return s.Dispatcher
}

// NewState constructs a State with sensible defaults. Fields left empty
// by the caller are filled in: Timings is always non-nil; Prefix defaults
// to "GP"; RalphBar defaults to 8; TranslatedDate defaults to empty and
// should be populated before the Write step runs.
func NewState() *State {
	return &State{
		Prefix:         "GP",
		RalphBar:       8,
		PromptTicketID: "GP-PENDING",
		Timings:        map[string]int{},
	}
}

// shouldSkipBelow reports whether a step with the given integer should be
// skipped because the caller used --from-step to start later in the chain.
func (s *State) shouldSkipBelow(stepInt int) bool {
	return stepInt < s.FromStepInt
}

// ResolveSourceField returns the value to interpolate into the write prompt's
// `source:` line. Priority:
//  1. s.SourceLabel — caller-supplied override
//  2. s.SourceIsX -> "@<handle> on X"
//  3. fallback -> s.AuthorHandle
func (s *State) ResolveSourceField() string {
	if s.SourceLabel != "" {
		return s.SourceLabel
	}
	if s.SourceIsX {
		if s.AuthorHandle == "" {
			return "X (handle missing)"
		}
		return "@" + s.AuthorHandle + " on X"
	}
	if s.AuthorHandle != "" {
		return s.AuthorHandle
	}
	return "Unknown source"
}
