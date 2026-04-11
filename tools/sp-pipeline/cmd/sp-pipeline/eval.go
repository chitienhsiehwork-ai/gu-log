package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/pipeline"
)

// evalReport is the --json output shape.
type evalReport struct {
	OK             bool   `json:"ok"`
	Step           string `json:"step"`
	GeminiVerdict  string `json:"geminiVerdict,omitempty"`
	CodexVerdict   string `json:"codexVerdict,omitempty"`
	SuggestedTitle string `json:"suggestedTitle,omitempty"`
	GeminiFile     string `json:"geminiFile,omitempty"`
	CodexFile      string `json:"codexFile,omitempty"`
	ElapsedMs      int64  `json:"elapsedMs"`
	ErrorCode      int    `json:"errorCode,omitempty"`
	Error          string `json:"error,omitempty"`
}

func newEvalCmd(state *rootState) *cobra.Command {
	var (
		sourcePath string
		workDir    string
		force      bool
		opusOnly   bool
	)
	cmd := &cobra.Command{
		Use:   "eval",
		Short: "Evaluate whether a captured source is SP-worthy",
		Long: `eval runs the two-evaluator gate that Step 1.5 of sp-pipeline.sh does.

It renders the eval-gemini.tmpl and eval-codex.tmpl prompts, passes them
through the LLM dispatcher with --work-dir as CWD so the prompts' "write
JSON to <file> in current directory" instructions land correctly, then
compares the two verdicts:

  GO/GO     → exit 0 (continue)
  SKIP/SKIP → exit 12 (not SP-worthy; caller should drop from queue)
  split     → exit 2  (needs human review; rerun with --force to override)

--force skips the gate entirely and exits 0 without calling the LLM.`,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runEval(cmd.Context(), state, sourcePath, workDir, force, opusOnly)
		},
	}
	cmd.Flags().StringVar(&sourcePath, "source", "", "path to source-tweet.md (required)")
	cmd.Flags().StringVar(&workDir, "work-dir", "", "work directory for eval output files (defaults to parent dir of --source)")
	cmd.Flags().BoolVar(&force, "force", false, "skip the gate and exit 0 without calling the LLM")
	cmd.Flags().BoolVar(&opusOnly, "opus", false, "use Claude Opus only (no Codex fallback)")
	_ = cmd.MarkFlagRequired("source")
	return cmd
}

func runEval(ctx context.Context, state *rootState, sourcePath, workDir string, force, opusOnly bool) error {
	start := time.Now()

	if sourcePath == "" {
		return fmt.Errorf("eval: --source is required")
	}
	absSource, err := filepath.Abs(sourcePath)
	if err != nil {
		return err
	}
	if workDir == "" {
		workDir = filepath.Dir(absSource)
	}
	workDir, err = filepath.Abs(workDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return fmt.Errorf("eval: mkdir %s: %w", workDir, err)
	}

	disp, err := buildDispatcher(state, opusOnly)
	if err != nil {
		return err
	}

	s := pipeline.NewState()
	s.Cfg = state.cfg
	s.Log = state.log
	s.Dispatcher = disp
	s.SourcePath = absSource
	s.WorkDir = workDir
	s.Force = force

	stepCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	err = s.Eval(stepCtx)

	report := evalReport{
		Step:           "eval",
		GeminiVerdict:  s.GeminiVerdict,
		CodexVerdict:   s.CodexVerdict,
		SuggestedTitle: s.SuggestedTitle,
		GeminiFile:     filepath.Join(workDir, "eval-gemini.json"),
		CodexFile:      filepath.Join(workDir, "eval-codex.json"),
		ElapsedMs:      time.Since(start).Milliseconds(),
	}

	if err != nil {
		var se *pipeline.StepError
		if errors.As(err, &se) {
			report.ErrorCode = se.Code
		} else {
			report.ErrorCode = 14
		}
		report.Error = err.Error()
		emitEvalReport(state, report)
		return newExitError(report.ErrorCode, err)
	}

	report.OK = true
	emitEvalReport(state, report)
	return nil
}

func emitEvalReport(state *rootState, r evalReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Printf("%s/%s\n", r.GeminiVerdict, r.CodexVerdict)
	}
}

// compile-time checks that imports are used by the tests in this file's
// sibling packages too — otherwise `go vet` complains about "imported but
// not used" when new subcommands refactor.
var (
	_ = logx.LevelInfo
	_ = config.Config{}
)
