package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
)

// PipelineURL is the URL stamped into the pipelineUrl frontmatter field.
// Matches the value at scripts/sp-pipeline.sh line 1161.
const PipelineURL = "https://github.com/chitienhsiehwork-ai/clawd-workspace/blob/master/scripts/shroom-feed-pipeline.sh"

// PipelineEntry is one row of the translatedBy.pipeline block.
type PipelineEntry struct {
	Role    string
	Model   string
	Harness string
}

// Credits is the Go port of scripts/sp-pipeline.sh Step 4.6. It rewrites
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

	// Default the per-stage metadata to the Opus/Codex/Opus triple the
	// bash pipeline uses as a fallback (lines 1164-1169). A real run
	// would have populated these in Write/Review/Refine.
	writeModel := nonEmpty(s.WriteModel, "Opus 4.6")
	writeHarness := nonEmpty(s.WriteHarness, "Claude Code CLI")
	reviewModel := nonEmpty(s.ReviewModel, "GPT-5.4")
	reviewHarness := nonEmpty(s.ReviewHarness, "Codex CLI")
	refineModel := nonEmpty(s.RefineModel, "Opus 4.6")
	refineHarness := nonEmpty(s.RefineHarness, "Claude Code CLI")

	// Patch the top-level model line to match the actual writer.
	f.SetNestedScalar("translatedBy", "model", quoted(writeModel))
	// Replace harness with a summary string and inject the 4-entry pipeline.
	f.SetNestedScalar("translatedBy", "harness", `"Gemini CLI + Codex CLI"`)

	entries := []PipelineEntry{
		{Role: "Written", Model: writeModel, Harness: writeHarness},
		{Role: "Reviewed", Model: reviewModel, Harness: reviewHarness},
		{Role: "Refined", Model: refineModel, Harness: refineHarness},
		{Role: "Orchestrated", Model: "Opus 4.6", Harness: "OpenClaw"},
	}
	f.SetBlock("  pipeline", renderPipelineBlock("  pipeline", entries))
	f.SetNestedScalar("translatedBy", "pipelineUrl", quoted(PipelineURL))

	if err := os.WriteFile(finalPath, f.Bytes(), 0o644); err != nil {
		return fmt.Errorf("credits: write final.mdx: %w", err)
	}
	s.Log.OK("Step 4.6: pipeline credits stamped")
	return nil
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
