package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/llm"
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

	// Default the per-stage metadata to the runtime provider's labels. A real
	// run populates these from the dispatcher result in Write/Review/Refine;
	// the defaults only matter when a stage was skipped via --from-step. They
	// follow whichever provider WritingChain resolved to (Codex GPT-5.5
	// normally, Claude Opus in the CCC sandbox fallback) so a Claude run is
	// stamped honestly rather than mislabelled as GPT-5.5.
	stampModel, stampHarness := s.StampLabels()
	writeModel := nonEmpty(s.WriteModel, stampModel)
	writeHarness := nonEmpty(s.WriteHarness, stampHarness)
	reviewModel := nonEmpty(s.ReviewModel, stampModel)
	reviewHarness := nonEmpty(s.ReviewHarness, stampHarness)
	refineModel := nonEmpty(s.RefineModel, stampModel)
	refineHarness := nonEmpty(s.RefineHarness, stampHarness)

	// Patch the top-level model line to match the actual writer.
	f.SetNestedScalar("translatedBy", "model", quoted(writeModel))
	// Replace harness with a summary string and inject the 4-entry pipeline.
	f.SetNestedScalar("translatedBy", "harness", quoted(writeHarness))

	entries := []PipelineEntry{
		{Role: "Written", Model: writeModel, Harness: writeHarness},
		{Role: "Reviewed", Model: reviewModel, Harness: reviewHarness},
		{Role: "Refined", Model: refineModel, Harness: refineHarness},
		{Role: "Orchestrated", Model: stampModel, Harness: "sp-pipeline"},
	}
	f.SetNestedBlock("translatedBy", "pipeline", renderPipelineBlock("  pipeline", entries))
	f.SetNestedScalar("translatedBy", "pipelineUrl", quoted(PipelineURL))

	if err := os.WriteFile(finalPath, f.Bytes(), 0o644); err != nil {
		return fmt.Errorf("credits: write final.mdx: %w", err)
	}
	s.Log.OK("Step 4.6: pipeline credits stamped")
	return nil
}

// StampLabels resolves the (model, harness) display labels for the provider
// the pipeline actually ran through, so frontmatter credits/ralph stamps are
// honest about whether a post was written/scored by Codex GPT-5.5 or the
// Claude Opus CCC fallback. It reads the resolved dispatcher (deterministic
// for a given run and for FakeProvider tests) and falls back to probing PATH
// via llm.EffectiveStamp when no dispatcher is wired.
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
