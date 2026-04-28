// Command sp-pipeline is the Go rewrite of scripts/sp-pipeline.sh. It is
// still under construction — see tools/sp-pipeline/README.md for the
// migration plan and tools/sp-pipeline/SKILL.md for the agent-facing
// subcommand contract.
//
// Phase 1 wires up: scaffolding, `doctor`, `fetch`, and the LLM dispatcher
// (used by doctor --probe-llm). The other subcommands are stubbed as
// "not yet implemented" so the tree shape is already documented for
// future phases to fill in.
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

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// Version is hardcoded; Phase 2 will replace this with ldflags injection
// from the Makefile / wrapper script.
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
	// real claude/codex/gemini chain. Hidden from --help because it is a
	// test-only affordance.
	fakeProviderPath string
}

var (
	flagJSON         bool
	flagVerbose      bool
	flagTimeout      time.Duration
	flagWorkDir      string
	flagFakeProvider string
)

// buildRoot constructs the root cobra.Command. Extracted so tests can build
// a fresh tree without touching package-level state.
func buildRoot() *cobra.Command {
	state := &rootState{}

	root := &cobra.Command{
		Use:   "sp-pipeline",
		Short: "gu-log translation pipeline (Go rewrite of scripts/sp-pipeline.sh)",
		Long: `sp-pipeline is the Go rewrite of gu-log's SP/CP translation pipeline.

It is split into composable subcommands so an agent (or a human) can run
one step at a time without inheriting the whole pipeline's side effects:

  fetch      capture a tweet / article into a work directory
  eval       (stub) decide whether a source is SP-worthy
  dedup      (stub) check whether the source is already covered
  write      (stub) draft the zh-tw + en MDX pair
  review     (stub) run the 12-point review checklist
  refine     (stub) apply the review back into the draft
  ralph      (stub) run the 4-judge tribunal
  deploy     (stub) validate, build, commit, push
  run        (stub) run the whole pipeline end-to-end
  doctor     check that every external dependency is reachable
  counter    (stub) read / bump the ticket counter

Use --help on any subcommand for details. Phase 2b adds eval/write/
review/refine; Phase 3 adds credits/ralph/deploy; Phase 2c wires them
together as "run". See tools/sp-pipeline/README.md for the migration
roadmap.`,
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
		"override the work directory (default: $TMPDIR/sp-pending-<epoch>-pipeline; lives outside the repo to dodge claude -p CLAUDE.md auto-discovery)")
	root.PersistentFlags().StringVar(&flagFakeProvider, "fake-provider", "",
		"(test only) path to a JSON file with canned LLM responses; replaces the real provider chain")
	_ = root.PersistentFlags().MarkHidden("fake-provider")

	// Hide the auto-generated `completion` command by default — it is
	// noise in --help for an agent-facing CLI. Users who need completions
	// can still run `sp-pipeline completion bash` etc.
	root.CompletionOptions.HiddenDefaultCmd = true

	// Attach subcommands. Each subcommand closes over `state` so it has
	// access to the resolved config, logger, and flags.
	root.AddCommand(newDoctorCmd(state))
	root.AddCommand(newFetchCmd(state))
	root.AddCommand(newCounterCmd(state))
	root.AddCommand(newDedupCmd(state))
	root.AddCommand(newEvalCmd(state))
	root.AddCommand(newWriteCmd(state))
	root.AddCommand(newReviewCmd(state))
	root.AddCommand(newRefineCmd(state))
	root.AddCommand(newCreditsCmd(state))
	root.AddCommand(newRalphCmd(state))
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

// newStubCmds used to return placeholder subcommands for unimplemented
// steps. Phase 2c fills the last stub (`run`), so the function is now
// empty but retained as a seam for future subcommand additions.
func newStubCmds(state *rootState) []*cobra.Command {
	_ = state
	return nil
}
