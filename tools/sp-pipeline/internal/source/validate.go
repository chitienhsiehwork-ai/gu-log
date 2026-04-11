// Package source handles fetching and validating article / tweet captures.
//
// validate.go is the native Go port of the two Python heredoc validators
// embedded in scripts/sp-pipeline.sh (validate_tweet_source_capture and
// validate_article_source_capture). The bash versions are the source of
// truth while they still exist; any divergence should be caught by the
// table-driven tests in validate_test.go.
package source

import (
	"bytes"
	"errors"
	"regexp"
	"strings"
)

// ValidationError is returned when a capture fails a validator. It is a
// distinct type so callers (mostly the fetch step) can pattern-match and
// decide whether to fall back to a different fetcher.
type ValidationError struct {
	Reason string
}

func (e *ValidationError) Error() string { return "source validation failed: " + e.Reason }

// IsValidationError reports whether err is a *ValidationError.
func IsValidationError(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

// tweetBadMarkers are substrings that, when present in a tweet capture,
// strongly suggest the captured text is agent tool-use scaffolding instead
// of actual tweet content. Two or more hits fail the capture.
//
// Kept lowercase for case-insensitive matching.
var tweetBadMarkers = []string{
	"tool=exec",
	"process exited with code",
	"wrote the evaluation to",
	"workspace check confirms",
	"file update:",
	"tokens used",
	"/bin/bash -lc",
	"succeeded in ",
	"fetch-agent-stderr.log",
	"eval-codex.json",
	"eval-gemini.json",
	"plan updated",
	"exact_fetch_failed",
}

var (
	handleRe     = regexp.MustCompile(`@[A-Za-z0-9_]+`)
	isoDateRe    = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	sourceShapes = []string{
		"=== main tweet ===",
		"=== tweet(s) ===",
		"source url:",
		"tweet url:",
	}
)

// ValidateTweetCapture returns nil if content looks like a real tweet capture
// or a *ValidationError when it looks like contaminated output.
//
// Rules (mirroring scripts/sp-pipeline.sh validate_tweet_source_capture):
//   - must be at least 120 bytes and 3 non-empty lines long
//   - must not contain 2+ distinct "bad markers" (tool-exec scaffolding)
//   - must have either (@handle AND ISO-date) OR (@handle AND a source-shape
//     marker like "=== MAIN TWEET ===" / "Source URL:")
func ValidateTweetCapture(content []byte) error {
	text := strings.TrimSpace(string(content))
	if len(text) < 120 {
		return &ValidationError{Reason: "capture too short (<120 chars)"}
	}

	lines := nonEmptyLines(text)
	if len(lines) < 3 {
		return &ValidationError{Reason: "capture has fewer than 3 non-empty lines"}
	}

	lower := strings.ToLower(text)
	badHits := 0
	for _, marker := range tweetBadMarkers {
		if strings.Contains(lower, marker) {
			badHits++
			if badHits >= 2 {
				return &ValidationError{Reason: "capture contains tool-exec scaffolding markers"}
			}
		}
	}

	hasHandle := handleRe.FindStringIndex(text) != nil
	hasDate := isoDateRe.FindStringIndex(text) != nil || strings.Contains(text, "\U0001F4C5") // 📅
	hasShape := false
	for _, shape := range sourceShapes {
		if strings.Contains(lower, shape) {
			hasShape = true
			break
		}
	}
	if strings.Contains(text, "\U0001F4C5") {
		hasShape = true
	}

	if (hasHandle && hasDate) || (hasHandle && hasShape) {
		return nil
	}
	return &ValidationError{Reason: "capture missing required @handle + date/source-url header"}
}

// articleBlockedMarkers are lowercase substrings which appear in paywall /
// captcha / JS-challenge shells. Two or more hits on a short capture fail.
var articleBlockedMarkers = []string{
	"enable javascript",
	"please enable javascript",
	"please verify you are human",
	"just a moment",
	"access denied",
	"too many requests",
	"rate limit",
	"captcha",
	"subscribe to continue",
	"sign in to continue",
	"already a subscriber",
}

// articleCodeMarkers appear in SSR React blobs and other JS-heavy pages.
// More than 30% of non-empty lines containing one of these tokens fails.
var articleCodeMarkers = []string{
	"function",
	"const ",
	"let ",
	"var ",
	"import ",
	"export ",
	"window.",
	"document.",
	"=>",
	"__next",
	"webpack",
}

// ValidateArticleCapture applies the same validator used by sp-pipeline.sh
// for non-tweet article captures (readability-lxml output, curl+sed
// fallback, etc). Rules:
//
//   - at least 200 chars and 5 non-empty lines
//   - short captures (<6000 chars) with 2+ blocked markers fail
//   - more than 30% of lines containing code markers fails
func ValidateArticleCapture(content []byte) error {
	text := strings.TrimSpace(string(content))
	if len(text) < 200 {
		return &ValidationError{Reason: "capture too short (<200 chars)"}
	}
	lines := nonEmptyLines(text)
	if len(lines) < 5 {
		return &ValidationError{Reason: "capture has fewer than 5 non-empty lines"}
	}

	lower := strings.ToLower(text)
	blockedHits := 0
	for _, marker := range articleBlockedMarkers {
		if strings.Contains(lower, marker) {
			blockedHits++
		}
	}
	if blockedHits >= 2 && len(text) < 6000 {
		return &ValidationError{Reason: "capture looks like a paywall / JS-challenge shell"}
	}

	codeLines := 0
	for _, line := range lines {
		ll := strings.ToLower(line)
		for _, marker := range articleCodeMarkers {
			if strings.Contains(ll, marker) {
				codeLines++
				break
			}
		}
	}
	if float64(codeLines)/float64(len(lines)) > 0.3 {
		return &ValidationError{Reason: "capture is >30% code-shaped lines (SSR shell suspected)"}
	}
	return nil
}

func nonEmptyLines(text string) []string {
	raw := bytes.Split([]byte(text), []byte("\n"))
	out := make([]string, 0, len(raw))
	for _, b := range raw {
		if s := strings.TrimSpace(string(b)); s != "" {
			out = append(out, s)
		}
	}
	return out
}
