package pipeline

import (
	"strings"
)

// sanitizeSlug is the Go port of scripts/sp-pipeline.sh sanitize_slug().
// The bash implementation lowercases, strips apostrophes, collapses any
// non-[a-z0-9] run into "-", trims leading/trailing "-", collapses runs
// of "-", and falls back to "article" on an empty result.
func sanitizeSlug(input string) string {
	// Lowercase + strip apostrophes.
	lower := strings.ToLower(input)
	lower = strings.ReplaceAll(lower, "'", "")

	var b strings.Builder
	lastWasDash := true // suppress leading dashes
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastWasDash = false
			continue
		}
		// Any non-alphanum becomes a dash, but collapse runs.
		if !lastWasDash {
			b.WriteByte('-')
			lastWasDash = true
		}
	}
	out := strings.TrimRight(b.String(), "-")
	if out == "" {
		return "article"
	}
	return out
}
