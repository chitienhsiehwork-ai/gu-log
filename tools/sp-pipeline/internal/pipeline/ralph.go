package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/ralph"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// finalPipelineURL matches scripts/sp-pipeline.sh line 1290.
const finalPipelineURL = "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh"

// Ralph is the Go port of scripts/sp-pipeline.sh Step 4.7. It:
//
//  1. Computes the ActiveFilename (sp-pending-YYYYMMDD-<author>-<slug>.mdx
//     for new articles; the caller-provided filename when resuming).
//  2. Copies final.mdx into src/content/posts/ at that filename if it's
//     not already there.
//  3. Runs `bash scripts/tribunal.sh <filename>` via the ralph
//     package. Tribunal failures are logged-and-continued (bash behavior).
//  4. For each of {zh-tw, en} files in the posts dir, runs the
//     frontmatter normaliser that strips any existing pipeline block +
//     pipelineUrl and writes the canonical 6-entry block.
//
// Ralph always returns nil on step-level errors — the tribunal's own
// exit code is advisory only. Only file I/O errors propagate up.
func (s *State) Ralph(ctx context.Context) error {
	if s.shouldSkipBelow(StepRalph) {
		s.Log.Info("Step 4.7: ralph tribunal — SKIPPED (--from-step)")
		return nil
	}

	s.Log.Info("Step 4.7: ralph tribunal")

	// Decide which file the tribunal should operate on. The bash
	// pipeline uses _TITLE_SOURCE = posts/$FILENAME when --file is set,
	// otherwise $WORK_DIR/final.mdx.
	var titleSource string
	if s.ExistingFile != "" {
		titleSource = filepath.Join(s.Cfg.PostsDir, s.ExistingFile)
	} else {
		titleSource = filepath.Join(s.WorkDir, "final.mdx")
	}
	if _, err := os.Stat(titleSource); err != nil {
		return fmt.Errorf("ralph: title source %s missing: %w", titleSource, err)
	}

	// Extract the title from frontmatter for the filename slug.
	if s.Title == "" {
		if title, err := extractTitle(titleSource); err == nil && title != "" {
			s.Title = title
		}
	}
	if s.Title == "" {
		s.Title = s.PromptTicketID
	}

	s.DateStamp = time.Now().Format("20060102")
	s.AuthorSlug = sanitizeSlug(s.AuthorHandle)
	s.TitleSlug = sanitizeSlug(s.Title)

	if s.ExistingFile != "" {
		s.ActiveFilename = s.ExistingFile
		// en- companion is the existing filename with the en- prefix if
		// it doesn't already start with en-. The bash pipeline stores
		// EN_FILENAME separately; here we derive it consistently.
		if strings.HasPrefix(s.ActiveFilename, "en-") {
			s.ActiveENFilename = strings.TrimPrefix(s.ActiveFilename, "en-")
		} else {
			s.ActiveENFilename = "en-" + s.ActiveFilename
		}
	} else {
		prefixLower := strings.ToLower(s.Prefix)
		s.ActiveFilename = fmt.Sprintf("%s-pending-%s-%s-%s.mdx", prefixLower, s.DateStamp, s.AuthorSlug, s.TitleSlug)
		s.ActiveENFilename = "en-" + s.ActiveFilename
	}

	// Place the file in posts dir if not already there.
	postsDir := s.Cfg.PostsDir
	activePath := filepath.Join(postsDir, s.ActiveFilename)
	if _, err := os.Stat(activePath); err != nil {
		if s.ExistingFile != "" {
			return fmt.Errorf("ralph: existing file %s missing in posts dir", s.ActiveFilename)
		}
		finalPath := filepath.Join(s.WorkDir, "final.mdx")
		data, err := os.ReadFile(finalPath)
		if err != nil {
			return fmt.Errorf("ralph: read final.mdx: %w", err)
		}
		if err := os.MkdirAll(postsDir, 0o755); err != nil {
			return fmt.Errorf("ralph: mkdir posts: %w", err)
		}
		if err := os.WriteFile(activePath, data, 0o644); err != nil {
			return fmt.Errorf("ralph: copy final.mdx into posts: %w", err)
		}
	}

	s.runPostFixers(ctx, activePath)

	// Run the tribunal. tribunal.sh resolves the runtime provider per judge:
	// VibeScorer runs on Claude Opus 4.5 while Librarian/FactChecker/FreshEyes
	// stay on Codex GPT-5.5 (mac/VPS). When codex is absent (CCC sandbox) all
	// four judges fall back to Claude.
	s.Log.Info("  Running 4-stage tribunal (via tribunal.sh)...")
	passed, err := ralph.Run(ctx, ralph.Options{
		RalphScript: filepath.Join(s.Cfg.ScriptsDir, "tribunal.sh"),
		Filename:    s.ActiveFilename,
		StdoutFile:  filepath.Join(s.WorkDir, "tribunal-stdout.txt"),
	})
	if err != nil {
		// Ralph.Run only returns errors for misuse; bubble up.
		return fmt.Errorf("ralph: %w", err)
	}
	s.RalphPassed = passed
	if passed {
		s.Log.OK("  Tribunal PASS: %s", s.ActiveFilename)
	} else {
		s.Log.Warn("  Tribunal FAIL (see %s/tribunal-stdout.txt). Deploying best effort.", s.WorkDir)
	}

	// Frontmatter normaliser — for every file in {zh, en}, strip old
	// pipeline block + pipelineUrl, then inject the canonical 6-entry
	// block. Matches the Python heredoc at bash lines 1245-1300.
	writerModel, writerHarness := s.StampLabels()
	judgeModel, judgeHarness := s.JudgeStampLabels()
	writeModel := nonEmpty(s.WriteModel, writerModel)
	writeHarness := nonEmpty(s.WriteHarness, writerHarness)
	reviewModel := nonEmpty(s.ReviewModel, judgeModel)
	reviewHarness := nonEmpty(s.ReviewHarness, judgeHarness)
	refineModel := nonEmpty(s.RefineModel, writerModel)
	refineHarness := nonEmpty(s.RefineHarness, writerHarness)
	for _, fname := range []string{s.ActiveFilename, s.ActiveENFilename} {
		path := filepath.Join(postsDir, fname)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := normalizeRalphFrontmatter(path, PipelineStamp{
			WriteModel:    writeModel,
			WriteHarness:  writeHarness,
			ReviewModel:   reviewModel,
			ReviewHarness: reviewHarness,
			RefineModel:   refineModel,
			RefineHarness: refineHarness,
			JudgeModel:    judgeModel,
			JudgeHarness:  judgeHarness,
		}); err != nil {
			return fmt.Errorf("ralph: normalize %s: %w", fname, err)
		}
	}

	return nil
}

func (s *State) runPostFixers(ctx context.Context, postPath string) {
	if s.Cfg == nil || s.Cfg.ScriptsDir == "" {
		return
	}
	s.Log.Info("  Running deterministic fixers (kaomoji/glossary/related)...")

	type fixer struct {
		name string
		args []string
	}
	fixers := []fixer{
		{
			name: "kaomoji",
			args: []string{filepath.Join(s.Cfg.ScriptsDir, "add-kaomoji.mjs"), "--write", postPath},
		},
		{
			name: "glossary",
			args: []string{filepath.Join(s.Cfg.ScriptsDir, "apply-glossary-links.mjs"), postPath},
		},
		{
			name: "related",
			args: []string{filepath.Join(s.Cfg.ScriptsDir, "inject-related-posts.mjs"), "--file", postPath},
		},
	}
	for _, f := range fixers {
		if _, err := runner.RunWithOptions(ctx, runner.Options{
			Name:    "node",
			Args:    f.args,
			WorkDir: s.Cfg.RepoRoot,
		}); err != nil {
			s.Log.Warn("  fixer %s failed (advisory): %v", f.name, err)
		}
	}
}

// normalizeRalphFrontmatter is the Go port of the Python heredoc at
// scripts/sp-pipeline.sh lines 1245-1300. It:
//
//  1. Parses the file's frontmatter.
//  2. Strips any existing pipeline: block and any pipelineUrl: line.
//  3. Rewrites harness: to the runtime provider's harness (stampHarness).
//  4. Inserts a canonical 6-entry pipeline: block after harness.
//  5. Inserts the canonical pipelineUrl.
type PipelineStamp struct {
	WriteModel    string
	WriteHarness  string
	ReviewModel   string
	ReviewHarness string
	RefineModel   string
	RefineHarness string
	JudgeModel    string
	JudgeHarness  string
}

func normalizeRalphFrontmatter(path string, stamp PipelineStamp) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		// Bash's Python heredoc exits 0 silently when frontmatter is
		// missing; match that behavior.
		return nil
	}

	// Strip any existing nested pipeline block.
	f.SetBlock("  pipeline", "") // replaces with empty, effectively deletes
	// Then strip any pipelineUrl line (nested under translatedBy).
	f.StripLinesMatching(func(line string) bool {
		trimmed := strings.TrimSpace(line)
		return strings.HasPrefix(trimmed, "pipelineUrl:")
	})

	// SetBlock("", ...) — because the previous call replaced with an
	// empty snippet, the header line "  pipeline:" is still present as
	// an orphan. Remove it too.
	f.StripLinesMatching(func(line string) bool {
		return strings.TrimSpace(line) == "pipeline:"
	})

	// Canonical harness summary.
	f.SetNestedScalar("translatedBy", "model", quoted(stamp.WriteModel))
	f.SetNestedScalar("translatedBy", "harness", quoted(stamp.WriteHarness))

	// 6-entry canonical pipeline block.
	entries := []PipelineEntry{
		{Role: "Written", Model: stamp.WriteModel, Harness: stamp.WriteHarness},
		{Role: "Reviewed", Model: stamp.ReviewModel, Harness: stamp.ReviewHarness},
		{Role: "Refined", Model: stamp.RefineModel, Harness: stamp.RefineHarness},
		{Role: "Scored", Model: stamp.JudgeModel, Harness: stamp.JudgeHarness + " + Tribunal"},
		{Role: "Rewritten", Model: stamp.WriteModel, Harness: stamp.WriteHarness + " + Tribunal"},
		{Role: "Orchestrated", Model: stamp.JudgeModel, Harness: "sp-pipeline + Tribunal"},
	}
	f.SetNestedScalar("translatedBy", "pipeline", "")
	f.SetBlock("  pipeline", renderPipelineBlock("  pipeline", entries))
	f.SetNestedScalar("translatedBy", "pipelineUrl", quoted(finalPipelineURL))

	// The `source:` value is LLM-authored free text (from --source-label
	// or the writer's own choice, e.g. "Simon Willison's Weblog") and its
	// quoting is whatever the writer LLM happened to produce — unquoted,
	// single-quoted, or double-quoted-but-unescaped are all possible and
	// some of those are invalid YAML (gu-log #546). Deterministically
	// re-serialize it here, the last frontmatter normalizer before the
	// file lands in posts dir, so the on-disk value is always valid YAML
	// regardless of what the LLM wrote.
	if raw, ok := f.GetScalar("source"); ok {
		value, err := decodeYAMLScalar(raw)
		if err != nil {
			// Writer output can itself be invalid YAML (the original #546
			// failure). Only use delimiter stripping as a recovery path after
			// the real parser rejects the scalar; valid escapes must be decoded
			// semantically before canonical re-serialization.
			value = unquoteInvalidScalarBestEffort(raw)
		}
		f.SetScalar("source", quoted(value))
	}

	return os.WriteFile(path, f.Bytes(), 0o644)
}

// decodeYAMLScalar parses one raw YAML scalar and returns its semantic value.
// A Node keeps numbers/bools/null as their original scalar text while still
// decoding YAML quote and escape syntax for strings.
func decodeYAMLScalar(raw string) (string, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte("value: "+raw+"\n"), &doc); err != nil {
		return "", err
	}
	if len(doc.Content) != 1 || len(doc.Content[0].Content) != 2 {
		return "", fmt.Errorf("source is not a single YAML scalar")
	}
	value := doc.Content[0].Content[1]
	if value.Kind != yaml.ScalarNode {
		return "", fmt.Errorf("source is YAML kind %d, want scalar", value.Kind)
	}
	return value.Value, nil
}

// unquoteInvalidScalarBestEffort strips one matching quote delimiter from
// invalid writer output. Valid YAML never reaches this fallback; it exists to
// recover common malformed forms such as 'Simon Willison's Weblog'.
func unquoteInvalidScalarBestEffort(raw string) string {
	if len(raw) >= 2 {
		if (raw[0] == '"' && raw[len(raw)-1] == '"') || (raw[0] == '\'' && raw[len(raw)-1] == '\'') {
			return raw[1 : len(raw)-1]
		}
	}
	return raw
}

// extractTitle scans a file's frontmatter for the title: line.
func extractTitle(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return "", err
	}
	val, ok := f.GetScalar("title")
	if !ok {
		return "", fmt.Errorf("title not found in %s", path)
	}
	// Strip surrounding quotes if present.
	return strings.Trim(val, `"`), nil
}
