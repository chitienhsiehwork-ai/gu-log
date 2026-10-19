package llm

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// TestDisplayNameWholeNumberReleases locks the Claude 5 generation naming:
// those builds ship as whole-number release names (claude-opus-5) with no
// decimal minor, unlike the 4.x line (claude-opus-4-5). Both must render, and
// neither may fall through to the raw build id — an unrendered id fails
// validate-posts.mjs Rule 15 at commit time. Mirrors MODEL_MAP in
// scripts/detect-model.mjs.
func TestDisplayNameWholeNumberReleases(t *testing.T) {
	cases := map[ModelID]string{
		"claude-opus-5":     "Opus 5",
		"claude-sonnet-5":   "Sonnet 5",
		"claude-opus-4-5":   "Opus 4.5",
		"claude-haiku-4-5":  "Haiku 4.5",
		"anthropic/opus-5":  "anthropic/opus-5", // not a claude-* build id, passes through
		"claude-opus-5[1m]": "Opus 5",
	}
	for id, want := range cases {
		if got := DisplayName(id); got != want {
			t.Errorf("DisplayName(%q) = %q, want %q", id, got, want)
		}
	}
}

// TestHarnessNameWholeNumberReleases guards the other consumer of the family
// regex: a whole-number build must still resolve to the Claude harness, not
// "Unknown Harness".
func TestHarnessNameWholeNumberReleases(t *testing.T) {
	for _, id := range []ModelID{"claude-opus-5", "claude-opus-4-5", ModelID(ClaudeOpusPinned)} {
		if got := HarnessName(id); got != "Claude Code CLI" {
			t.Errorf("HarnessName(%q) = %q, want Claude Code CLI", id, got)
		}
	}
}

// TestAliasDisplayMatchesOpusAliasCurrent keeps the display fallback for the
// bare `opus` alias on the build scripts/detect-model.mjs records for it
// (OPUS_ALIAS_CURRENT, the SSOT), so a run that never learns the concrete
// build is not stamped with an older Opus.
func TestAliasDisplayMatchesOpusAliasCurrent(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(repoRootForRoutingTest(t), "scripts", "detect-model.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`export const OPUS_ALIAS_CURRENT = '([^']+)';`).FindSubmatch(src)
	if m == nil {
		t.Fatal("OPUS_ALIAS_CURRENT not found in scripts/detect-model.mjs")
	}
	want := DisplayName(ModelID(m[1]))
	for _, alias := range []ModelID{ModelClaudeOpus, "opus", "anthropic/opus"} {
		if got := DisplayName(alias); got != want {
			t.Errorf("DisplayName(%q) = %q, want %q (OPUS_ALIAS_CURRENT %s)", alias, got, want, m[1])
		}
	}
}
