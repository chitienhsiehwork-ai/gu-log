package source

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateTweetCapture(t *testing.T) {
	// Structure: each case has a short name, the raw bytes to validate, and
	// whether we expect an error (and, if so, a substring to match against
	// the error reason so regressions flag the right rule).
	cases := []struct {
		name       string
		content    string
		wantErr    bool
		wantReason string
	}{
		{
			name: "clean fxtwitter capture",
			content: `@nickbaumann_ — 2026-04-10
Source URL: https://x.com/nickbaumann_/status/2042705384306336083
Fetched via: fxtwitter

=== MAIN TWEET ===
This is the body of the tweet. It contains several paragraphs, enough
characters to pass the minimum-length check, and it has the required
handle and date header so the validator is happy.`,
			wantErr: false,
		},
		{
			name: "clean with emoji date",
			content: `@pawelhuryn
📅 Thu Mar 14 09:00:00 +0000 2026
Source URL: https://x.com/pawelhuryn/status/123456789
=== MAIN TWEET ===
Something important about Product OS and how teams ship.
Another line, another pattern, another reason to read this.`,
			wantErr: false,
		},
		{
			name: "too short",
			content: `@alice 2026-04-10
Source URL: short`,
			wantErr:    true,
			wantReason: "too short",
		},
		{
			name:       "missing handle",
			content:    "Some body text that is long enough to clear the 120-character minimum length check but does not contain any @handle marker and that is what should cause the validator to reject this capture as missing required header metadata.\nSecond line.\nThird line.",
			wantErr:    true,
			wantReason: "required @handle",
		},
		{
			name: "contaminated with tool scaffolding",
			content: `@alice — 2026-04-10
tool=exec bash -lc 'curl https://api.example.com'
Process exited with code 0
Wrote the evaluation to eval-codex.json
File update: source-tweet.md
Tokens used: 3421`,
			wantErr:    true,
			wantReason: "tool-exec",
		},
		{
			name: "handle plus source shape no date",
			content: `@rohit4verse
Source URL: https://x.com/rohit4verse/status/111
=== MAIN TWEET ===
A tweet body long enough to clear the 120 character minimum threshold
even though it has no ISO date in the body. This should pass because
handle plus source-shape is an acceptable combination per the rule.`,
			wantErr: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateTweetCapture([]byte(tc.content))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected validation error, got nil")
				}
				if !IsValidationError(err) {
					t.Fatalf("expected *ValidationError, got %T", err)
				}
				if tc.wantReason != "" && !strings.Contains(err.Error(), tc.wantReason) {
					t.Fatalf("error %q does not contain expected reason %q", err.Error(), tc.wantReason)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestValidateArticleCapture(t *testing.T) {
	cases := []struct {
		name       string
		content    string
		wantErr    bool
		wantReason string
	}{
		{
			name: "clean readable article",
			content: `Understanding Bespoke CLIs for AI Agents

In this post we explain why a small CLI with flags and stable JSON is
more useful to a coding agent than a giant MCP connector. We cover three
examples from Nick Baumann's work on Codex at OpenAI.

The first thing to notice is that agents already know how to use flags.
They compose commands from the output of previous commands all the time.`,
			wantErr: false,
		},
		{
			name: "too short",
			content: `Title
One line.
Two lines.
Three lines.
Four lines.`,
			wantErr:    true,
			wantReason: "too short",
		},
		{
			name: "JS shell garbage",
			content: `import React from "react";
const x = 1;
let y = 2;
var z = 3;
export default function Page() {
  window.location = "/";
  document.title = "loading";
  return (() => null);
}
__next_f.push([1, "chunk"]);
webpack_require("./thing");`,
			wantErr:    true,
			wantReason: "code-shaped",
		},
		{
			name: "paywall shell",
			content: `Sign in to continue reading this article about the latest trends in
artificial intelligence and large language models and how they affect
software engineering workflows and developer productivity in 2026.
Please enable JavaScript to view the content and continue reading.
Already a subscriber? Log in to continue reading this full article.
Subscribe to continue reading the rest of this premium article today.
Just a moment — verifying you are human. This should not take long.`,
			wantErr:    true,
			wantReason: "paywall",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateArticleCapture([]byte(tc.content))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected validation error, got nil")
				}
				if tc.wantReason != "" && !strings.Contains(err.Error(), tc.wantReason) {
					t.Fatalf("error %q does not contain expected reason %q", err.Error(), tc.wantReason)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

// Smoke test using a fixture file to prove we can read testdata/ without
// blowing up on relative paths.
func TestValidateTweetCapture_Fixture(t *testing.T) {
	path := filepath.Join("..", "..", "testdata", "clean-fxtwitter.md")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("fixture not present: %v", err)
	}
	if err := ValidateTweetCapture(data); err != nil {
		t.Fatalf("clean fixture should validate, got: %v", err)
	}
}
