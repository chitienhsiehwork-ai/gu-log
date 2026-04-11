// Package dedup is a thin wrapper around scripts/dedup-gate.mjs, the
// Node.js deduplication gate that lives in gu-log's existing tooling.
//
// Why shell out instead of porting: dedup-gate.mjs shares normalisation
// logic with scripts/validate-posts.mjs (import { normalizeUrl,
// extractTweetId, computeSimilarity } from './dedup-gate.mjs'). Porting
// it would either duplicate logic or leave Astro's build depending on Go
// — both bad. Keep the gate in Node and wrap it.
package dedup

import (
	"context"
	"fmt"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// Verdict is the three-state outcome dedup-gate.mjs returns.
type Verdict string

const (
	VerdictPass  Verdict = "PASS"
	VerdictWarn  Verdict = "WARN"
	VerdictBlock Verdict = "BLOCK"
)

// Result is the parsed verdict plus the raw stdout of dedup-gate.mjs so
// callers can surface the full explanation in --json mode.
type Result struct {
	Verdict Verdict
	Raw     string
	// Matches is a best-effort parse of the file/title lines the gate
	// reported as duplicates, for easier display. Empty on a PASS.
	Matches []string
}

// Options controls the dedup check. All fields are required except
// Series, which defaults to "SP" to match the bash pipeline's default
// when the prefix is not explicitly set.
type Options struct {
	ScriptPath string // absolute path to scripts/dedup-gate.mjs
	URL        string // source URL being checked
	Title      string // proposed title
	Series     string // ticket prefix (SP / CP / SD / Lv)
}

// Check runs the dedup gate with the given options and parses the verdict.
// The gate exits 0 on PASS, non-zero on BLOCK, and the raw stdout contains
// PASS/WARN/BLOCK somewhere on its first output lines.
func Check(ctx context.Context, opts Options) (*Result, error) {
	if opts.ScriptPath == "" {
		return nil, fmt.Errorf("dedup: ScriptPath is required")
	}
	if opts.URL == "" && opts.Title == "" {
		return nil, fmt.Errorf("dedup: URL or Title required")
	}
	series := opts.Series
	if series == "" {
		series = "SP"
	}

	args := []string{
		opts.ScriptPath,
		"--series", series,
	}
	if opts.URL != "" {
		args = append(args, "--url", opts.URL)
	}
	if opts.Title != "" {
		args = append(args, "--title", opts.Title)
	}

	res, runErr := runner.Run(ctx, "node", args...)
	stdout := string(res.Stdout)
	verdict := parseVerdict(stdout)

	// The gate exits non-zero on BLOCK — that is its contract, NOT a
	// crash. Only surface runErr if we also failed to parse a verdict
	// keyword out of the stdout, because that is the only signal that
	// something genuinely went wrong.
	if verdict == "" {
		if runErr != nil {
			return nil, fmt.Errorf("dedup: gate crashed: %w (stdout: %s)", runErr, stdout)
		}
		return nil, fmt.Errorf("dedup: gate output contained no PASS/WARN/BLOCK keyword: %s", stdout)
	}

	return &Result{
		Verdict: verdict,
		Raw:     stdout,
		Matches: parseMatches(stdout),
	}, nil
}

func parseVerdict(stdout string) Verdict {
	// The gate prints either a standalone verdict line ("PASS" / "WARN" /
	// "BLOCK") or a prefixed line like "BLOCK: Duplicate of SP-170 (tweet
	// ID match): ...". Some older revisions use "[BLOCK]" brackets. Scan
	// ALL lines from top to bottom and return the first match, since the
	// BLOCK reason is typically printed on a single line followed by
	// stack details.
	for _, line := range strings.Split(stdout, "\n") {
		l := strings.TrimSpace(line)
		switch {
		case l == "PASS", strings.HasPrefix(l, "PASS:"), strings.HasPrefix(l, "[PASS]"):
			return VerdictPass
		case l == "WARN", strings.HasPrefix(l, "WARN:"), strings.HasPrefix(l, "[WARN]"):
			return VerdictWarn
		case l == "BLOCK", strings.HasPrefix(l, "BLOCK:"), strings.HasPrefix(l, "[BLOCK]"):
			return VerdictBlock
		}
	}
	return ""
}

func parseMatches(stdout string) []string {
	var out []string
	for _, line := range strings.Split(stdout, "\n") {
		l := strings.TrimSpace(line)
		if strings.HasPrefix(l, "- ") || strings.HasPrefix(l, "• ") {
			out = append(out, strings.TrimLeft(l, "-• "))
		}
	}
	return out
}
