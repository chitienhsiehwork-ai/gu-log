package pipeline

import "github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/slug"

// sanitizeSlug is ported from the retired bash pipeline's sanitize_slug().
// The bash implementation lowercases, strips apostrophes, collapses any
// non-[a-z0-9] run into "-", trims leading/trailing "-", collapses runs
// of "-", and falls back to "article" on an empty result.
func sanitizeSlug(input string) string {
	return slug.Sanitize(input)
}
