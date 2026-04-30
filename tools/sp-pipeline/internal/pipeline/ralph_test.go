package pipeline

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const ralphFixtureMDX = `---
title: "My Cool Post"
ticketId: SP-PENDING
translatedBy:
  model: "Opus 4.6"
  harness: "Claude Code CLI"
  pipeline:
    - role: "Old"
      model: "Old"
      harness: "Old"
  pipelineUrl: "https://stale.example.com/path"
---

Body content.
`

func TestExtractTitle(t *testing.T) {
	f := filepath.Join(t.TempDir(), "post.mdx")
	if err := os.WriteFile(f, []byte(ralphFixtureMDX), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := extractTitle(f)
	if err != nil {
		t.Fatalf("extractTitle: %v", err)
	}
	if got != "My Cool Post" {
		t.Fatalf("extractTitle = %q, want 'My Cool Post'", got)
	}
}

func TestExtractTitle_NoTitle(t *testing.T) {
	f := filepath.Join(t.TempDir(), "no-title.mdx")
	if err := os.WriteFile(f, []byte("---\nticketId: x\n---\nbody"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := extractTitle(f); err == nil {
		t.Fatal("expected error when title is missing")
	}
}

func TestExtractTitle_FileMissing(t *testing.T) {
	if _, err := extractTitle("/tmp/this-file-does-not-exist-xyz123.mdx"); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestNormalizeRalphFrontmatter_StripsAndCanonicalises(t *testing.T) {
	f := filepath.Join(t.TempDir(), "post.mdx")
	if err := os.WriteFile(f, []byte(ralphFixtureMDX), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := normalizeRalphFrontmatter(f); err != nil {
		t.Fatalf("normalize: %v", err)
	}
	out, _ := os.ReadFile(f)
	s := string(out)

	// Stale pipelineUrl gone, replaced by canonical
	if strings.Contains(s, "https://stale.example.com/path") {
		t.Error("stale pipelineUrl not stripped")
	}
	if !strings.Contains(s, "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh") {
		t.Error("canonical pipelineUrl not stamped")
	}
	// 6-entry block landed
	expectedRoles := []string{"Written", "Reviewed", "Refined", "Scored", "Rewritten", "Orchestrated"}
	for _, role := range expectedRoles {
		if !strings.Contains(s, `- role: "`+role+`"`) {
			t.Errorf("missing canonical role %q in:\n%s", role, s)
		}
	}
	// Old role stripped
	if strings.Contains(s, `- role: "Old"`) {
		t.Error("stale role 'Old' not stripped")
	}
	// Canonical summary harness
	if !strings.Contains(s, `harness: "Gemini CLI + Codex CLI + Claude Code"`) {
		t.Error("canonical summary harness missing")
	}
}

func TestNormalizeRalphFrontmatter_MissingFile(t *testing.T) {
	if err := normalizeRalphFrontmatter("/tmp/missing-xyz-123.mdx"); err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestNormalizeRalphFrontmatter_NoFrontmatter_Silent(t *testing.T) {
	// Bash heredoc silently no-ops on bad frontmatter; match it.
	f := filepath.Join(t.TempDir(), "no-fm.mdx")
	if err := os.WriteFile(f, []byte("just body, no frontmatter"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := normalizeRalphFrontmatter(f); err != nil {
		t.Fatalf("expected silent success on no-frontmatter, got %v", err)
	}
}

func TestFinalPipelineURL_Constant(t *testing.T) {
	want := "https://github.com/chitienhsiehwork-ai/gu-log/blob/main/scripts/sp-pipeline.sh"
	if finalPipelineURL != want {
		t.Fatalf("finalPipelineURL drift: %q, want %q", finalPipelineURL, want)
	}
}
