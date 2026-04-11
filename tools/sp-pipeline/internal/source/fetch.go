package source

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// FetchResult describes what a successful source capture looks like.
//
// Path is the file the capture was written to (always absolute). Handle and
// Date are best-effort parses of the capture header; an empty Date is
// acceptable (the caller can fall back to "today") but an empty Handle for
// an X URL is suspicious and the caller should log a warning.
type FetchResult struct {
	Path       string
	Handle     string
	Date       string
	FetchedVia string
	Bytes      int
}

// FetchOptions controls how Fetch behaves.
type FetchOptions struct {
	// WorkDir is the directory the source-tweet.md will be written into.
	// Must exist before Fetch is called.
	WorkDir string
	// FetchXArticleScript is the absolute path to scripts/fetch-x-article.sh.
	FetchXArticleScript string
}

// xURLRe matches https://x.com/... and twitter.com/... URLs.
var xURLRe = regexp.MustCompile(`^https?://(?:www\.)?(?:x|twitter)\.com/`)

// FetchX fetches a tweet / X article URL into WorkDir/source-tweet.md by
// shelling out to scripts/fetch-x-article.sh, validating the result, and
// returning a parsed FetchResult.
//
// This function intentionally does NOT try to reimplement the fxtwitter
// JSON parsing — that script is stable, production-tested, and living in
// scripts/ where it is reachable by other bash tooling too. Phase 5 of the
// migration plan ports it to native Go.
func FetchX(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	if !xURLRe.MatchString(url) {
		return nil, fmt.Errorf("fetchx: %q is not an x.com / twitter.com URL", url)
	}
	if opts.WorkDir == "" {
		return nil, fmt.Errorf("fetchx: WorkDir is required")
	}
	if opts.FetchXArticleScript == "" {
		return nil, fmt.Errorf("fetchx: FetchXArticleScript is required")
	}
	if fi, err := os.Stat(opts.FetchXArticleScript); err != nil || fi.IsDir() {
		return nil, fmt.Errorf("fetchx: helper script not found at %s", opts.FetchXArticleScript)
	}

	res, err := runner.Run(ctx, "bash", opts.FetchXArticleScript, url)
	if err != nil {
		return nil, fmt.Errorf("fetchx: %w", err)
	}

	if verr := ValidateTweetCapture(res.Stdout); verr != nil {
		return nil, verr
	}

	outPath := filepath.Join(opts.WorkDir, "source-tweet.md")
	if err := os.WriteFile(outPath, res.Stdout, 0o644); err != nil {
		return nil, fmt.Errorf("fetchx: writing capture to %s: %w", outPath, err)
	}

	parsed := parseCaptureHeader(res.Stdout)
	parsed.Path = outPath
	parsed.Bytes = len(res.Stdout)
	return parsed, nil
}

// parseCaptureHeader pulls @handle, date, and "Fetched via" out of the
// first few lines of a fetch-x-article.sh capture.
//
// Expected first three lines:
//
//	@handle — YYYY-MM-DD
//	Source URL: https://x.com/handle/status/ID
//	Fetched via: fxtwitter
//
// Any missing field is left as empty string. We never fail here — the
// validator already ran.
func parseCaptureHeader(content []byte) *FetchResult {
	out := &FetchResult{}
	lines := strings.SplitN(string(content), "\n", 5)

	handleDateRe := regexp.MustCompile(`^(@[A-Za-z0-9_]+)\s*[—\-]?\s*(\d{4}-\d{2}-\d{2})?`)
	fetchedViaRe := regexp.MustCompile(`^Fetched via:\s*(\S+)`)

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if m := handleDateRe.FindStringSubmatch(trimmed); m != nil && out.Handle == "" {
			out.Handle = m[1]
			if len(m) >= 3 {
				out.Date = m[2]
			}
			continue
		}
		if m := fetchedViaRe.FindStringSubmatch(trimmed); m != nil && out.FetchedVia == "" {
			out.FetchedVia = m[1]
			continue
		}
	}
	return out
}
