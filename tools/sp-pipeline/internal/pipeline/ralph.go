package pipeline

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/ralph"
)

// finalPipelineURL matches scripts/sp-pipeline.sh line 1290.
const finalPipelineURL = "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh"

// Ralph is the Go port of scripts/sp-pipeline.sh Step 4.7. It:
//
//  1. Computes the ActiveFilename (sp-pending-YYYYMMDD-<author>-<slug>.mdx
//     for new articles; the caller-provided filename when resuming).
//  2. Copies final.mdx into src/content/posts/ at that filename if it's
//     not already there.
//  3. Runs `bash scripts/tribunal-all-claude.sh <filename>` via the ralph
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

	// Run the tribunal.
	s.Log.Info("  Running 4-stage tribunal (tribunal-all-claude.sh)...")
	passed, err := ralph.Run(ctx, ralph.Options{
		RalphScript: filepath.Join(s.Cfg.ScriptsDir, "tribunal-all-claude.sh"),
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
	for _, fname := range []string{s.ActiveFilename, s.ActiveENFilename} {
		path := filepath.Join(postsDir, fname)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := normalizeRalphFrontmatter(path); err != nil {
			return fmt.Errorf("ralph: normalize %s: %w", fname, err)
		}
	}

	return nil
}

// normalizeRalphFrontmatter is the Go port of the Python heredoc at
// scripts/sp-pipeline.sh lines 1245-1300. It:
//
//  1. Parses the file's frontmatter.
//  2. Strips any existing pipeline: block and any pipelineUrl: line.
//  3. Rewrites harness: to "Gemini CLI + Codex CLI + Claude Code".
//  4. Inserts a canonical 6-entry pipeline: block after harness.
//  5. Inserts the canonical pipelineUrl.
func normalizeRalphFrontmatter(path string) error {
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
	f.SetNestedScalar("translatedBy", "harness", `"Gemini CLI + Codex CLI + Claude Code"`)

	// 6-entry canonical pipeline block.
	entries := []PipelineEntry{
		{Role: "Written", Model: "Opus 4.6", Harness: "Claude Code CLI"},
		{Role: "Reviewed", Model: "Opus 4.6", Harness: "Claude Code CLI"},
		{Role: "Refined", Model: "Opus 4.6", Harness: "Claude Code CLI"},
		{Role: "Scored", Model: "Opus 4.6", Harness: "Claude Code (vibe-opus-scorer)"},
		{Role: "Rewritten", Model: "Opus 4.6", Harness: "Claude Code"},
		{Role: "Orchestrated", Model: "Opus 4.6", Harness: "OpenClaw + Ralph Loop"},
	}
	f.SetBlock("  pipeline", renderPipelineBlock("  pipeline", entries))
	f.SetNestedScalar("translatedBy", "pipelineUrl", quoted(finalPipelineURL))

	return os.WriteFile(path, f.Bytes(), 0o644)
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
