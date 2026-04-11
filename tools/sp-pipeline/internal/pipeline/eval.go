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
// independent evaluators and requires them both to return GO. The bash
// pipeline calls one through run_with_fallback (Opus-primary) and the
// other through a direct `codex exec` call; the Go port invokes the
// dispatcher twice with different output filenames and parses each JSON
// result.
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

	// Run both evaluators sequentially. The bash pipeline runs them
	// sequentially too — Gemini first, then Codex — and parallelising is
	// not worth the complexity gain given that LLM latency dominates.
	geminiResult, err := s.runEvalProvider(ctx, "eval-gemini", lineCount, string(source), "eval-gemini.json")
	if err != nil {
		return NewStepError(14, fmt.Errorf("eval: gemini evaluator failed: %w", err))
	}
	codexResult, err := s.runEvalProvider(ctx, "eval-codex", lineCount, string(source), "eval-codex.json")
	if err != nil {
		return NewStepError(14, fmt.Errorf("eval: codex evaluator failed: %w", err))
	}

	// Sanitise the codex file in case the real Codex CLI appended logging.
	codexFile := filepath.Join(s.WorkDir, "eval-codex.json")
	if data, readErr := os.ReadFile(codexFile); readErr == nil {
		if cleaned, ok := llm.SanitizeCodexJSON(data); ok {
			if err := os.WriteFile(codexFile, cleaned, 0o644); err != nil {
				return fmt.Errorf("eval: rewrite sanitised codex json: %w", err)
			}
		}
	}

	geminiVerdict, err := parseEvalFile(filepath.Join(s.WorkDir, "eval-gemini.json"))
	if err != nil {
		return fmt.Errorf("eval: parse gemini verdict: %w", err)
	}
	codexVerdict, err := parseEvalFile(codexFile)
	if err != nil {
		return fmt.Errorf("eval: parse codex verdict: %w", err)
	}

	s.GeminiVerdict = geminiVerdict.Verdict
	s.CodexVerdict = codexVerdict.Verdict
	if s.SuggestedTitle == "" {
		s.SuggestedTitle = geminiVerdict.SuggestedTitle
	}

	// Silence the unused vars from runEvalProvider — the file writes are
	// what we actually care about; the returned output strings are just a
	// sanity check that the dispatcher did something.
	_, _ = geminiResult, codexResult

	switch {
	case geminiVerdict.Verdict == "GO" && codexVerdict.Verdict == "GO":
		s.Log.Info("Step 1.5 decision: GO/GO")
		s.Log.Info("Gemini reason: %s", geminiVerdict.Reason)
		s.Log.Info("Codex reason: %s", codexVerdict.Reason)
		return nil
	case geminiVerdict.Verdict == "SKIP" && codexVerdict.Verdict == "SKIP":
		s.Log.Info("Step 1.5 decision: SKIP/SKIP")
		s.Log.Info("Gemini reason: %s", geminiVerdict.Reason)
		s.Log.Info("Codex reason: %s", codexVerdict.Reason)
		s.Log.OK("Both evaluators said SKIP; exiting cleanly")
		return NewStepError(12, errors.New("eval: SKIP/SKIP — source not SP-worthy"))
	default:
		s.Log.Warn("Gemini verdict: %s | reason: %s", geminiVerdict.Verdict, geminiVerdict.Reason)
		s.Log.Warn("Codex verdict: %s | reason: %s", codexVerdict.Verdict, codexVerdict.Reason)
		s.Log.Warn("SPLIT DECISION — run with --force to override, or let Clawd decide")
		return NewStepError(2, fmt.Errorf("eval: split verdict (gemini=%s, codex=%s)",
			geminiVerdict.Verdict, codexVerdict.Verdict))
	}
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
	return s.Dispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
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
