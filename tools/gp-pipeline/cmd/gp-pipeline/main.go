// Command gp-pipeline is gu-log's translation pipeline CLI; the canonical
// entrypoint is the self-compiling wrapper tools/gp-pipeline/gp-pipeline.
// See tools/gp-pipeline/README.md for the migration history and
// tools/gp-pipeline/SKILL.md for the agent-facing subcommand contract.
package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

// Version is kept explicit until release automation injects a tagged build.
const Version = "0.1.0-dev"

// Global state shared by subcommands via the root command's PersistentPreRunE.
type rootState struct {
	cfg     *config.Config
	log     *logx.Logger
	json    bool
	verbose bool
	// timeout is the pipeline-wide deadline (ctx.WithTimeout).
	timeout time.Duration
	// fakeProviderPath, when non-empty, causes LLM subcommands to build a
	// dispatcher backed by a FakeProvider loaded from JSON instead of the
	// real Codex chain. Hidden from --help because it is a
	// test-only affordance.
	fakeProviderPath string
	judgeAllowClaude bool
}

var (
	flagJSON             bool
	flagVerbose          bool
	flagTimeout          time.Duration
	flagWorkDir          string
	flagFakeProvider     string
	flagJudgeAllowClaude bool
)

// buildRoot constructs the root cobra.Command. Extracted so tests can build
// a fresh tree without touching package-level state.
func buildRoot() *cobra.Command {
	state := &rootState{}

	root := &cobra.Command{
		Use:   "gp-pipeline",
		Short: "gu-log translation pipeline (Gu-log Picks)",
		Long: `gp-pipeline ("Gu-log Picks") is the Go implementation of gu-log's
GP/MP translation pipeline. The canonical entrypoint is
tools/gp-pipeline/gp-pipeline; ticket prefixes are GP/MP and post filename
slugs are gp-/mp-.

It is split into composable subcommands so an agent (or a human) can run
one step at a time without inheriting the whole pipeline's side effects:

  fetch      capture a tweet / article into a work directory
  status     inspect an active/recent run from work-dir + repo artifacts
  eval       decide whether a source is GP-worthy
  dedup      check whether the source is already covered
  write      draft the zh-tw MDX only (en is a separate, later step)
  review     run the 12-point review checklist
  refine     apply the review back into the draft
  ralph      run the 4-judge tribunal
  translate  produce the en sidecar, but only after ralph passed
             (zh-tw-first: never translates an unstable draft)
  deploy     validate, build, commit, push
  run        run the whole pipeline end-to-end
  doctor     check that every external dependency is reachable
  counter    read / bump the ticket counter

Use --help on any subcommand for details. See tools/gp-pipeline/README.md
for the migration history and current operational notes.`,
		Version:       Version,
		SilenceErrors: true,
		SilenceUsage:  true,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			state.log = logx.New()
			state.log.SetJSON(flagJSON)
			state.log.SetVerbose(flagVerbose)
			state.json = flagJSON
			state.verbose = flagVerbose
			state.timeout = flagTimeout
			state.fakeProviderPath = flagFakeProvider
			state.judgeAllowClaude = flagJudgeAllowClaude || truthyEnv("GP_JUDGE_ALLOW_CLAUDE")

			cfg, err := config.Resolve("")
			if err != nil {
				return fmt.Errorf("resolving repo root: %w", err)
			}
			state.cfg = cfg
			return nil
		},
	}

	root.PersistentFlags().BoolVar(&flagJSON, "json", false,
		"emit machine-readable JSON on stdout instead of human-readable text")
	root.PersistentFlags().BoolVarP(&flagVerbose, "verbose", "v", false,
		"enable verbose logging to stderr")
	root.PersistentFlags().DurationVar(&flagTimeout, "timeout", 50*time.Minute,
		"wall-clock timeout for the entire invocation (e.g. 50m, 1h30m)")
	root.PersistentFlags().StringVar(&flagWorkDir, "work-dir", "",
		"override the work directory (default: $TMPDIR/gp-pending-<epoch>-pipeline; lives outside the repo; Codex is invoked with --skip-git-repo-check)")
	root.PersistentFlags().StringVar(&flagFakeProvider, "fake-provider", "",
		"(test only) path to a JSON file with canned LLM responses; replaces the real provider chain")
	_ = root.PersistentFlags().MarkHidden("fake-provider")
	root.PersistentFlags().BoolVar(&flagJudgeAllowClaude, "judge-allow-claude", false,
		"allow judge steps to fall back to Claude only when Codex hits quota (default off; env GP_JUDGE_ALLOW_CLAUDE=1)")

	// Hide the auto-generated `completion` command by default — it is
	// noise in --help for an agent-facing CLI. Users who need completions
	// can still run `gp-pipeline completion bash` etc.
	root.CompletionOptions.HiddenDefaultCmd = true

	// Attach subcommands. Each subcommand closes over `state` so it has
	// access to the resolved config, logger, and flags.
	root.AddCommand(newDoctorCmd(state))
	root.AddCommand(newFetchCmd(state))
	root.AddCommand(newStatusCmd(state))
	root.AddCommand(newCounterCmd(state))
	root.AddCommand(newDedupCmd(state))
	root.AddCommand(newEvalCmd(state))
	root.AddCommand(newWriteCmd(state))
	root.AddCommand(newReviewCmd(state))
	root.AddCommand(newRefineCmd(state))
	root.AddCommand(newCreditsCmd(state))
	root.AddCommand(newRalphCmd(state))
	root.AddCommand(newTranslateCmd(state))
	root.AddCommand(newDeployCmd(state))
	root.AddCommand(newRunCmd(state))

	return root
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	root := buildRoot()
	if err := root.ExecuteContext(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[ERROR] %s\n", err)
		os.Exit(exitCodeFor(err))
	}
}

// ExitError wraps an error with a documented exit code so subcommands can
// signal specific failure modes (dedup BLOCK = 13, fetch validation = 11,
// timeout = 124, etc.). Subcommands construct these via newExitError();
// main.go unwraps them via errors.As.
type ExitError struct {
	Code int
	Err  error
}

func (e *ExitError) Error() string { return e.Err.Error() }
func (e *ExitError) Unwrap() error { return e.Err }

func newExitError(code int, err error) *ExitError {
	return &ExitError{Code: code, Err: err}
}

// exitCodeFor maps known error types to documented exit codes. See
// SKILL.md for the full exit code contract.
func exitCodeFor(err error) int {
	if err == nil {
		return 0
	}
	var ee *ExitError
	if errors.As(err, &ee) {
		return ee.Code
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return 124
	}
	return 1
}

func truthyEnv(key string) bool {
	switch os.Getenv(key) {
	case "1", "true", "TRUE", "yes", "YES", "on", "ON":
		return true
	default:
		return false
	}
}
