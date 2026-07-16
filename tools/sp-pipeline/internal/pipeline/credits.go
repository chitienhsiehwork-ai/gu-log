package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
)

// PipelineURL is the URL stamped into the pipelineUrl frontmatter field.
// Points at this repo's pipeline entry (scripts/gp-pipeline.sh execs into
// tools/gp-pipeline), not the retired clawd-workspace feed pipeline.
const PipelineURL = "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/gp-pipeline.sh"

// PipelineEntry is one row of the translatedBy.pipeline block.
type PipelineEntry struct {
	Role    string
	Model   string
	Harness string
}

// Credits is the Go port of scripts/gp-pipeline.sh Step 4.6. It rewrites
// the nested `translatedBy.model` and `translatedBy.harness` scalars and
// injects a 4-entry `translatedBy.pipeline` block + `pipelineUrl` field.
// This runs BEFORE ralph — ralph then overwrites the pipeline block with
// a 6-entry version. Both stamps exist in the bash pipeline because
// --from-step semantics need the intermediate state to be present.
//
// The written file is $WORK_DIR/final.mdx; caller must have run Refine
// (or copied an existing draft) first.
func (s *State) Credits(ctx context.Context) error {
	if s.shouldSkipBelow(StepRalph) && s.ExistingFile != "" {
		// Matches bash "Step 4.6 credits SKIPPED" branch at line 1155.
		s.Log.Info("Step 4.6: pipeline credits — SKIPPED (using existing credits)")
		return nil
	}
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	data, err := os.ReadFile(finalPath)
	if err != nil {
		return fmt.Errorf("credits: read final.mdx: %w", err)
	}

	f, err := frontmatter.Parse(data)
	if err != nil {
		return fmt.Errorf("credits: parse final.mdx: %w", err)
	}

	// Default skipped-stage metadata to each role's runtime provider. Writers
	// use Opus-on-Mac / Codex-on-VM; reviewers and tribunal judges use full
	// Codex GPT-5.5.
	writerModel, writerHarness := s.StampLabels()
	judgeModel, judgeHarness := s.JudgeStampLabels()
	writeModel := nonEmpty(s.WriteModel, writerModel)
	writeHarness := nonEmpty(s.WriteHarness, writerHarness)
	reviewModel := nonEmpty(s.ReviewModel, judgeModel)
	reviewHarness := nonEmpty(s.ReviewHarness, judgeHarness)
	refineModel := nonEmpty(s.RefineModel, writerModel)
	refineHarness := nonEmpty(s.RefineHarness, writerHarness)

	// Patch the top-level model line to match the actual writer.
	f.SetNestedScalar("translatedBy", "model", quoted(writeModel))
	// Replace harness with a summary string and inject the 4-entry pipeline.
	f.SetNestedScalar("translatedBy", "harness", quoted(writeHarness))

	entries := []PipelineEntry{
		{Role: "Written", Model: writeModel, Harness: writeHarness},
		{Role: "Reviewed", Model: reviewModel, Harness: reviewHarness},
		{Role: "Refined", Model: refineModel, Harness: refineHarness},
		{Role: "Orchestrated", Model: judgeModel, Harness: "gp-pipeline"},
	}
	f.SetNestedBlock("translatedBy", "pipeline", renderPipelineBlock("  pipeline", entries))
	f.SetNestedScalar("translatedBy", "pipelineUrl", quoted(PipelineURL))

	if err := os.WriteFile(finalPath, f.Bytes(), 0o644); err != nil {
		return fmt.Errorf("credits: write final.mdx: %w", err)
	}
	s.Log.OK("Step 4.6: pipeline credits stamped")
	return nil
}

// StampLabels resolves the (model, harness) display labels for the writer
// provider. It reads the resolved dispatcher (deterministic for a given run and
// for FakeProvider tests) and falls back to probing PATH when no dispatcher is
// wired.
func (s *State) StampLabels() (model, harness string) {
	if s.Dispatcher != nil {
		for _, p := range s.Dispatcher.Providers() {
			if p.Available() {
				return llm.DisplayName(p.Model()), llm.HarnessName(p.Model())
			}
		}
	}
	return llm.EffectiveStamp()
}

// JudgeStampLabels resolves the default judge model/harness used by review and
// tribunal scoring when a specific per-stage result is unavailable.
func (s *State) JudgeStampLabels() (model, harness string) {
	if s.JudgeDispatcher != nil {
		for _, p := range s.JudgeDispatcher.Providers() {
			if p.Available() {
				m := p.Model()
				if reporter, ok := p.(interface{ ActualModel() llm.ModelID }); ok {
					if actual := reporter.ActualModel(); actual != "" {
						m = actual
					}
				}
				return llm.DisplayName(m), llm.HarnessName(p.Model())
			}
		}
	}
	for _, p := range llm.DefaultJudgeChain() {
		if p.Available() {
			return llm.DisplayName(p.Model()), llm.HarnessName(p.Model())
		}
	}
	return llm.DisplayName(llm.ModelGPT55), llm.HarnessName(llm.ModelGPT55)
}

// renderPipelineBlock builds a YAML snippet for a translatedBy.pipeline
// array. indentedKey is usually "  pipeline". The block's children are
// indented 4 spaces further than indentedKey.
func renderPipelineBlock(indentedKey string, entries []PipelineEntry) string {
	// Derive the child indent by adding 2 spaces to the key's indent.
	keyIndent := leadingWhitespace(indentedKey)
	childIndent := keyIndent + "  "

	var b strings.Builder
	b.WriteString(indentedKey + ":\n")
	for _, e := range entries {
		b.WriteString(childIndent + "- role: " + quoted(e.Role) + "\n")
		b.WriteString(childIndent + "  model: " + quoted(e.Model) + "\n")
		b.WriteString(childIndent + "  harness: " + quoted(e.Harness) + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func leadingWhitespace(s string) string {
	i := 0
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	return s[:i]
}

func nonEmpty(s, fallback string) string {
	if s == "" {
		return fallback
	}
	return s
}

func quoted(s string) string {
	if strings.HasPrefix(s, `"`) && strings.HasSuffix(s, `"`) {
		return s
	}
	return `"` + s + `"`
}
