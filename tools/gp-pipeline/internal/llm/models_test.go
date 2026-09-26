package llm

import "testing"

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
