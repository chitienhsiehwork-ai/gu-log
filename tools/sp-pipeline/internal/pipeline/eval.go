package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/prompts"
)

// StepError wraps an error with a pipeline exit code so cmd/sp-pipeline's
// main.go can translate it into os.Exit without knowing about every step's
// internal failure modes. This mirrors the ExitError type in main.go but
// lives in the pipeline package so State methods do not need to import the
// cobra command layer.
type StepError struct {
	Code int
	Err  error
}

func (e *StepError) Error() string { return e.Err.Error() }
func (e *StepError) Unwrap() error { return e.Err }

// NewStepError wraps err with a pipeline exit code.
func NewStepError(code int, err error) *StepError {
	return &StepError{Code: code, Err: err}
}

// evalJSON matches the {verdict, reason, suggested_title} JSON the eval
// prompts instruct the LLM to produce.
type evalJSON struct {
	Verdict        string `json:"verdict"`
	Reason         string `json:"reason"`
	SuggestedTitle string `json:"suggested_title"`
}

// Eval is the Go port of scripts/sp-pipeline.sh Step 1.5. It runs two
// independent Codex evaluator passes and requires them both to return GO.
// The old Opus/Gemini-assisted route is intentionally retired from the
// default pipeline because those subscriptions are not assumed to exist.
//
// Exit code mapping (via StepError):
//
//   - 0:  both GO (Continue)
//   - 12: both SKIP (no error, exit cleanly)
//   - 2:  split verdict (GO/SKIP mismatch) — caller asked for a run but
//     the two evaluators disagreed; human review needed
//
// Honors s.Force (skip the step entirely) and s.FromStepInt.
func (s *State) Eval(ctx context.Context) error {
	if s.shouldSkipBelow(StepEval) {
		s.Log.Info("Step 1.5: evaluate worthiness — SKIPPED (--from-step)")
		return nil
	}
	if s.Force {
		s.Log.Warn("--force enabled; skipping Step 1.5 evaluation")
		return nil
	}
	if s.SourcePath == "" {
		return fmt.Errorf("eval: SourcePath is empty (did Fetch run?)")
	}

	s.Log.Info("Step 1.5: evaluate worthiness")

	source, err := os.ReadFile(s.SourcePath)
	if err != nil {
		return fmt.Errorf("eval: read source: %w", err)
	}
	lineCount := countLines(source)

	// Run both Codex evaluator passes sequentially. Parallelising is not worth
	// the complexity gain given that LLM latency dominates and Codex already
	// handles its own provider-side scheduling.
	primaryResult, err := s.runEvalProvider(ctx, "eval-codex", lineCount, string(source), "eval-codex-primary.json")
	if err != nil {
		return NewStepError(14, fmt.Errorf("eval: codex primary evaluator failed: %w", err))
	}
	primaryFile := filepath.Join(s.WorkDir, "eval-codex-primary.json")
	if err := ensureEvalOutputFile(primaryFile, primaryResult.Output); err != nil {
		return fmt.Errorf("eval: materialise codex primary verdict: %w", err)
	}
	codexResult, err := s.runEvalProvider(ctx, "eval-codex", lineCount, string(source), "eval-codex.json")
	if err != nil {
		return NewStepError(14, fmt.Errorf("eval: codex evaluator failed: %w", err))
	}
	codexFile := filepath.Join(s.WorkDir, "eval-codex.json")
	if err := ensureEvalOutputFile(codexFile, codexResult.Output); err != nil {
		return fmt.Errorf("eval: materialise codex verdict: %w", err)
	}

	// Sanitise the codex file in case the real Codex CLI appended logging.
	if data, readErr := os.ReadFile(codexFile); readErr == nil {
		if cleaned, ok := llm.SanitizeCodexJSON(data); ok {
			if err := os.WriteFile(codexFile, cleaned, 0o644); err != nil {
				return fmt.Errorf("eval: rewrite sanitised codex json: %w", err)
			}
		}
	}

	primaryVerdict, err := parseEvalFile(primaryFile)
	if err != nil {
		return fmt.Errorf("eval: parse codex primary verdict: %w", err)
	}
	codexVerdict, err := parseEvalFile(codexFile)
	if err != nil {
		return fmt.Errorf("eval: parse codex verdict: %w", err)
	}

	s.CodexPrimaryVerdict = primaryVerdict.Verdict
	s.CodexVerdict = codexVerdict.Verdict
	if s.SuggestedTitle == "" {
		s.SuggestedTitle = primaryVerdict.SuggestedTitle
	}

	// Silence the unused vars from runEvalProvider — the file writes are
	// what we actually care about; the returned output strings are just a
	// sanity check that the dispatcher did something.
	_, _ = primaryResult, codexResult

	switch {
	case primaryVerdict.Verdict == "GO" && codexVerdict.Verdict == "GO":
		s.Log.Info("Step 1.5 decision: GO/GO")
		s.Log.Info("Codex primary reason: %s", primaryVerdict.Reason)
		s.Log.Info("Codex reason: %s", codexVerdict.Reason)
		return nil
	case primaryVerdict.Verdict == "SKIP" && codexVerdict.Verdict == "SKIP":
		s.Log.Info("Step 1.5 decision: SKIP/SKIP")
		s.Log.Info("Codex primary reason: %s", primaryVerdict.Reason)
		s.Log.Info("Codex reason: %s", codexVerdict.Reason)
		s.Log.OK("Both evaluators said SKIP; exiting cleanly")
		return NewStepError(12, errors.New("eval: SKIP/SKIP — source not SP-worthy"))
	default:
		s.Log.Warn("Codex primary verdict: %s | reason: %s", primaryVerdict.Verdict, primaryVerdict.Reason)
		s.Log.Warn("Codex verdict: %s | reason: %s", codexVerdict.Verdict, codexVerdict.Reason)
		s.Log.Warn("SPLIT DECISION — run with --force to override, or let Clawd decide")
		return NewStepError(2, fmt.Errorf("eval: split verdict (codexPrimary=%s, codex=%s)",
			primaryVerdict.Verdict, codexVerdict.Verdict))
	}
}

// ensureEvalOutputFile handles the Codex exec behavior where the model may
// return the requested JSON in its final answer instead of writing the
// prompt-specified file. If the file already exists and is non-empty, it is
// left untouched. Otherwise the final answer is sanitised and written to the
// expected path.
func ensureEvalOutputFile(path, output string) error {
	if info, err := os.Stat(path); err == nil && info.Size() > 0 {
		return nil
	}
	if strings.TrimSpace(output) == "" {
		return nil
	}
	data := []byte(output)
	if cleaned, ok := llm.SanitizeCodexJSON(data); ok {
		data = cleaned
	}
	return os.WriteFile(path, data, 0o644)
}

// runEvalProvider renders one of the two eval templates and runs it through
// the dispatcher with WorkDir set so the prompt's "write to foo.json in the
// current directory" instruction actually lands in the run's work dir.
func (s *State) runEvalProvider(ctx context.Context, template string, lineCount int, source, outputFilename string) (*llm.RunResult, error) {
	prompt, err := prompts.Render(template, prompts.EvalData{
		LineCount:      lineCount,
		Source:         source,
		OutputFilename: outputFilename,
	})
	if err != nil {
		return nil, err
	}
	disp := s.judgeDispatcher()
	if disp == nil {
		return nil, fmt.Errorf("eval: judge dispatcher is nil")
	}
	return disp.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
}

// parseEvalFile reads an eval-*.json file and validates its shape.
func parseEvalFile(path string) (*evalJSON, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("%s missing or unreadable: %w", filepath.Base(path), err)
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return nil, fmt.Errorf("%s is empty", filepath.Base(path))
	}
	var ev evalJSON
	if err := json.Unmarshal(data, &ev); err != nil {
		return nil, fmt.Errorf("%s: parse JSON: %w", filepath.Base(path), err)
	}
	if ev.Verdict != "GO" && ev.Verdict != "SKIP" {
		return nil, fmt.Errorf("%s: invalid verdict %q (expected GO or SKIP)", filepath.Base(path), ev.Verdict)
	}
	return &ev, nil
}

func countLines(data []byte) int {
	if len(data) == 0 {
		return 0
	}
	// bash's `wc -l` counts newlines, so a final line without a trailing
	// newline does not add to the count. Match that behaviour.
	n := 0
	for _, b := range data {
		if b == '\n' {
			n++
		}
	}
	return n
}
