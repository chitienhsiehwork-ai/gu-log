// Package slug owns the canonical filename-slot contract shared by the
// pipeline generator and standalone deploy validation.
package slug

import (
	"regexp"
	"strings"
)

// canonicalRe is exactly the shape emitted by Sanitize: lowercase ASCII
// letters/digits separated by single hyphens, with no leading or trailing
// separator. Keeping generation and ingress validation in this package
// prevents deploy from accepting path components the generator cannot emit.
var canonicalRe = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// Sanitize lowercases input, strips ASCII apostrophes, replaces every other
// non-ASCII-alphanumeric run with one hyphen, trims separators, and falls back
// to "article" when no filename-safe characters remain.
func Sanitize(input string) string {
	lower := strings.ToLower(input)
	lower = strings.ReplaceAll(lower, "'", "")

	var b strings.Builder
	lastWasDash := true
	for _, r := range lower {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastWasDash = false
			continue
		}
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

// IsCanonical reports whether value could have been emitted by Sanitize.
func IsCanonical(value string) bool {
	return canonicalRe.MatchString(value)
}
