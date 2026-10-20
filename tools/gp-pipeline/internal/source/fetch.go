package source

import (
	"context"
	"fmt"
	"html"
	nethttp "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// FetchResult describes what a successful source capture looks like.
//
// Path is the file the capture was written to (always absolute). Handle and
// Date are best-effort observations from the source. Empty values remain
// unknown; callers must not replace missing source metadata with guessed
// values. An empty Handle for an X URL is suspicious and should be logged.
type FetchResult struct {
	Path       string
	Handle     string
	Date       string
	FetchedVia string
	Bytes      int
	// IsX is true when the source URL was handled by FetchX. Generic and
	// YouTube captures set it to false so downstream steps do not render
	// the frontmatter source as "@handle on X".
	IsX bool
	// FinalURL is the URL the capture was actually read from, observed by
	// the transport after validated redirects (generic captures only).
	// Empty when the adapter has no trusted final-URL observation.
	FinalURL string
}

// FetchOptions controls how Fetch behaves.
type FetchOptions struct {
	// WorkDir is the directory the source-tweet.md will be written into.
	// Must exist before Fetch is called.
	WorkDir string
	// WorkRoot binds YouTube candidate I/O to an already-open directory.
	// Canonical runs may leave it nil and CaptureYouTube opens WorkDir itself.
	WorkRoot *os.Root
	// VerifyWorkDir detects path replacement before and after external tools.
	VerifyWorkDir func() error
	// FetchXArticleScript is the absolute path to scripts/fetch-x-article.sh.
	FetchXArticleScript string
	// FetchArticleScript is the absolute path to scripts/fetch-article.py.
	FetchArticleScript string
}

// xURLRe matches https://x.com/... and twitter.com/... URLs.
var xURLRe = regexp.MustCompile(`^https?://(?:www\.)?(?:x|twitter)\.com/`)

// nonCanonicalIPv4Re catches the legacy numeric forms accepted by curl and
// libc resolvers but intentionally rejected by net.ParseIP: a single 32-bit
// integer, shortened dotted forms, octal components, and hexadecimal
// components. Callers must check net.ParseIP first so canonical public IPv4
// addresses remain valid.
var nonCanonicalIPv4Re = regexp.MustCompile(
	`(?i)^(?:0x[0-9a-f]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|[0-9]+)){0,3}$`,
)

// Fetch routes a URL to the best available fetcher. X / Twitter URLs go
// through FetchX (fxtwitter quality). Allowlisted YouTube hosts always go
// through FetchYouTube and fail closed; they never fall back to generic HTML,
// because the resulting page is only a JavaScript shell. Everything else goes
// through FetchGeneric (readability extraction with curl cleanup fallback).
func Fetch(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	if xURLRe.MatchString(url) {
		return FetchX(ctx, url, opts)
	}
	if IsYouTubeOwnedHostURL(url) {
		return FetchYouTube(ctx, url, opts)
	}
	return FetchGeneric(ctx, url, opts)
}

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

	parsed := ParseCaptureHeader(res.Stdout)
	parsed.Path = outPath
	parsed.Bytes = len(res.Stdout)
	parsed.IsX = true
	return parsed, nil
}

// safeGetFunc is the one network entry point for generic captures. Tests
// stub it; production always goes through the safe bounded transport.
var safeGetFunc = func(ctx context.Context, urlStr, userAgent string) (*safeGetResult, error) {
	return newSafeHTTPClient().get(ctx, urlStr, userAgent)
}

// SetTransportForTests replaces the generic-capture transport and returns a
// restore func. Tests outside this package use it to keep captures hermetic;
// production code must never call it.
func SetTransportForTests(fn func(ctx context.Context, urlStr, userAgent string) (finalURL string, body []byte, err error)) (restore func()) {
	prev := safeGetFunc
	safeGetFunc = func(ctx context.Context, urlStr, userAgent string) (*safeGetResult, error) {
		finalURL, body, err := fn(ctx, urlStr, userAgent)
		if err != nil {
			return nil, err
		}
		return &safeGetResult{FinalURL: finalURL, Body: body, ContentType: "text/html"}, nil
	}
	return func() { safeGetFunc = prev }
}

// FetchGeneric fetches an arbitrary http(s) URL and writes the result to
// WorkDir/source-tweet.md with a header compatible with the rest of the
// pipeline. The bytes come from the safe bounded transport (public IPs
// bound at dial time, validated redirects, size caps); extraction then runs
// offline. The readability extractor is preferred; when it is unavailable
// or its output fails validation, the SAME captured bytes pass through the
// minimal cleanup fallback. There is no second, unprotected network client.
//
// Validation uses ValidateArticleCapture, the looser validator designed for
// generic article captures (paywall / JS-shell detection).
//
// User-Agent is pinned to a browser-like string so the fetcher looks real
// to anti-bot WAFs. This is a capture tool for content the user has already
// chosen to translate — not a scraper — so a browser UA is appropriate.
func FetchGeneric(ctx context.Context, urlStr string, opts FetchOptions) (*FetchResult, error) {
	if opts.WorkDir == "" {
		return nil, fmt.Errorf("fetchgeneric: WorkDir is required")
	}

	ua := "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
		"AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
	fetched, err := safeGetFunc(ctx, urlStr, ua)
	if err != nil {
		return nil, fmt.Errorf("fetchgeneric: %w", err)
	}

	host := hostname(fetched.FinalURL)
	date := time.Now().Format("2006-01-02")
	outPath := filepath.Join(opts.WorkDir, "source-tweet.md")

	// Extraction attempt 1: readability over the captured bytes. The
	// extractor runs with --extract-only and MUST NOT download anything
	// itself; the transport above is the only network path.
	if opts.FetchArticleScript != "" {
		if _, err := exec.LookPath("python3"); err == nil {
			res, runErr := runner.RunWithStdin(ctx, fetched.Body,
				"python3", opts.FetchArticleScript, "--extract-only", fetched.FinalURL)
			if runErr == nil {
				body := strings.TrimSpace(string(res.Stdout))
				if body != "" {
					if publishedDate := parsePublishedDate(body); publishedDate != "" {
						date = publishedDate
					}
					header := fmt.Sprintf("@%s — %s\nSource URL: %s\nFetched via: fetch-article.py\n\n", host, date, fetched.FinalURL)
					payload := []byte(header + body + "\n")
					if verr := ValidateArticleCapture(payload); verr == nil {
						if err := os.WriteFile(outPath, payload, 0o644); err != nil {
							return nil, fmt.Errorf("fetchgeneric: writing capture to %s: %w", outPath, err)
						}
						return &FetchResult{
							Path:       outPath,
							Handle:     "@" + host,
							Date:       date,
							FetchedVia: "fetch-article.py",
							Bytes:      len(payload),
							IsX:        false,
							FinalURL:   fetched.FinalURL,
						}, nil
					}
				}
			}
		}
	}

	// Extraction attempt 2: minimal cleanup of the same captured bytes.
	body := cleanupHTML(fetched.Body)

	header := fmt.Sprintf("@%s — %s\nSource URL: %s\nFetched via: safehttp\n\n", host, date, fetched.FinalURL)
	payload := []byte(header + string(body))

	if verr := ValidateArticleCapture(payload); verr != nil {
		return nil, verr
	}

	if err := os.WriteFile(outPath, payload, 0o644); err != nil {
		return nil, fmt.Errorf("fetchgeneric: writing capture to %s: %w", outPath, err)
	}

	return &FetchResult{
		Path:       outPath,
		Handle:     "@" + host,
		Date:       date,
		FetchedVia: "safehttp",
		Bytes:      len(payload),
		IsX:        false,
		FinalURL:   fetched.FinalURL,
	}, nil
}

var publishedDateRe = regexp.MustCompile(`(?m)^Published:\s*(\d{4}-\d{2}-\d{2})\s*$`)

func parsePublishedDate(capture string) string {
	match := publishedDateRe.FindStringSubmatch(capture)
	if len(match) == 2 {
		if _, err := time.Parse("2006-01-02", match[1]); err != nil {
			return ""
		}
		return match[1]
	}
	return ""
}

// hostname returns the URL's host (without port) or "unknown" if parsing
// fails. Used as the synthetic @handle in the capture header.
func hostname(raw string) string {
	u, err := nethttp.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return "unknown"
	}
	return u.Hostname()
}

var (
	scriptRe   = regexp.MustCompile(`(?is)<script[^>]*>.*?</script>`)
	styleRe    = regexp.MustCompile(`(?is)<style[^>]*>.*?</style>`)
	commentRe  = regexp.MustCompile(`(?s)<!--.*?-->`)
	brRe       = regexp.MustCompile(`(?i)<br\s*/?>`)
	blockTagRe = regexp.MustCompile(`(?i)</(?:p|div|h[1-6]|li|tr|section|article|header|footer|nav|aside|main|blockquote)>`)
	anyTagRe   = regexp.MustCompile(`<[^>]+>`)
	wsRe       = regexp.MustCompile(`[ \t]+`)
	blankRe    = regexp.MustCompile(`\n{3,}`)
)

// cleanupHTML does minimal HTML → plaintext extraction sufficient to feed
// the capture into downstream LLM prompts. It is NOT a general-purpose
// readability implementation — it just strips the noisiest things
// (scripts, styles, tags) so the validator's "too much code-shaped content"
// rule doesn't misfire on legitimate article bodies.
//
// Plain text / markdown inputs (no angle brackets) pass through unchanged.
func cleanupHTML(in []byte) []byte {
	if !hasHTMLMarkers(in) {
		return in
	}
	s := string(in)
	s = scriptRe.ReplaceAllString(s, "")
	s = styleRe.ReplaceAllString(s, "")
	s = commentRe.ReplaceAllString(s, "")
	s = brRe.ReplaceAllString(s, "\n")
	s = blockTagRe.ReplaceAllString(s, "\n")
	s = anyTagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	s = wsRe.ReplaceAllString(s, " ")
	s = blankRe.ReplaceAllString(s, "\n\n")
	return []byte(strings.TrimSpace(s))
}

func hasHTMLMarkers(in []byte) bool {
	// Cheap heuristic: HTML always has a closing tag somewhere, or a
	// DOCTYPE declaration. Plain text / markdown shouldn't.
	s := string(in)
	return strings.Contains(s, "</") || strings.Contains(strings.ToLower(s), "<!doctype")
}

// ParseCaptureHeader pulls @handle, date, source type, and "Fetched via" out of the
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
func ParseCaptureHeader(content []byte) *FetchResult {
	out := &FetchResult{}
	lines := strings.SplitN(string(content), "\n", 5)

	// Generic captures use the full hostname as the handle (@www.anthropic.com),
	// so inner dots and hyphens must survive; X handles never contain them.
	handleDateRe := regexp.MustCompile(`^(@[A-Za-z0-9_](?:[A-Za-z0-9_.\-]*[A-Za-z0-9_])?)\s*[—\-]?\s*(\d{4}-\d{2}-\d{2})?`)
	fetchedViaRe := regexp.MustCompile(`^Fetched via:\s*(\S+)`)
	sourceURLRe := regexp.MustCompile(`^Source URL:\s*(\S+)`)

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
		if m := sourceURLRe.FindStringSubmatch(trimmed); m != nil {
			out.IsX = xURLRe.MatchString(m[1])
		}
	}
	return out
}
