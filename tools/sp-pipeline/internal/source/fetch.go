package source

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"net"
	nethttp "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
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
	// IsX is true when the source URL was handled by FetchX. Generic and
	// YouTube captures set it to false so downstream steps do not render
	// the frontmatter source as "@handle on X".
	IsX bool
}

// FetchOptions controls how Fetch behaves.
type FetchOptions struct {
	// WorkDir is the directory the source-tweet.md will be written into.
	// Must exist before Fetch is called.
	WorkDir string
	// FetchXArticleScript is the absolute path to scripts/fetch-x-article.sh.
	FetchXArticleScript string
	// FetchArticleScript is the absolute path to scripts/fetch-article.py.
	FetchArticleScript string
}

// xURLRe matches https://x.com/... and twitter.com/... URLs.
var xURLRe = regexp.MustCompile(`^https?://(?:www\.)?(?:x|twitter)\.com/`)
var youtubeURLRe = regexp.MustCompile(`^https?://(?:www\.)?(?:youtube\.com|youtu\.be)/`)

// Fetch routes a URL to the best available fetcher. X / Twitter URLs go
// through FetchX (fxtwitter quality); everything else goes through
// FetchGeneric (curl + minimal HTML cleanup). This is the entry point
// callers should use by default — FetchX and FetchGeneric remain exported
// for tests and for callers that want to force a specific path.
func Fetch(ctx context.Context, url string, opts FetchOptions) (*FetchResult, error) {
	if xURLRe.MatchString(url) {
		return FetchX(ctx, url, opts)
	}
	if youtubeURLRe.MatchString(url) {
		if _, err := runner.LookPath("yt-dlp"); err == nil {
			return FetchYouTube(ctx, url, opts)
		}
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

	parsed := parseCaptureHeader(res.Stdout)
	parsed.Path = outPath
	parsed.Bytes = len(res.Stdout)
	parsed.IsX = true
	return parsed, nil
}

// FetchGeneric fetches an arbitrary http(s) URL via curl and writes the
// result to WorkDir/source-tweet.md with a header compatible with the rest
// of the pipeline. HTML pages pass through a minimal cleanup (drop script /
// style / comments, decode entities, collapse whitespace) so the LLM gets
// readable prose instead of a raw SSR dump.
//
// This is the default fallback when a URL doesn't match the X-specific
// fetcher. Validation uses ValidateArticleCapture, the looser validator
// designed for generic article captures (paywall / JS-shell detection).
//
// User-Agent is pinned to a browser-like string so the fetcher looks real
// to anti-bot WAFs. This is a capture tool for content the user has already
// chosen to translate — not a scraper — so a browser UA is appropriate.
func FetchGeneric(ctx context.Context, urlStr string, opts FetchOptions) (*FetchResult, error) {
	if err := validateSafeHTTPURL(urlStr); err != nil {
		return nil, fmt.Errorf("fetchgeneric: %w", err)
	}
	if opts.WorkDir == "" {
		return nil, fmt.Errorf("fetchgeneric: WorkDir is required")
	}

	host := hostname(urlStr)
	date := time.Now().Format("2006-01-02")
	outPath := filepath.Join(opts.WorkDir, "source-tweet.md")

	if opts.FetchArticleScript != "" {
		if _, err := exec.LookPath("python3"); err == nil {
			if res, runErr := runner.Run(ctx, "python3", opts.FetchArticleScript, urlStr); runErr == nil {
				body := strings.TrimSpace(string(res.Stdout))
				if body != "" {
					header := fmt.Sprintf("@%s — %s\nSource URL: %s\nFetched via: fetch-article.py\n\n", host, date, urlStr)
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
						}, nil
					}
				}
			}
		}
	}

	ua := "Mozilla/5.0 (compatible; gp-pipeline/1; +https://gu-log.vercel.app)"
	res, err := runner.Run(ctx, "curl", "-sSL", "--max-time", "60", "-A", ua, urlStr)
	if err != nil {
		return nil, fmt.Errorf("fetchgeneric: curl: %w", err)
	}

	body := cleanupHTML(res.Stdout)

	header := fmt.Sprintf("@%s — %s\nSource URL: %s\nFetched via: curl\n\n", host, date, urlStr)
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
		FetchedVia: "curl",
		Bytes:      len(payload),
		IsX:        false,
	}, nil
}

type youtubeMetadata struct {
	Title      string `json:"title"`
	Channel    string `json:"channel"`
	Uploader   string `json:"uploader"`
	UploadDate string `json:"upload_date"`
	Duration   int    `json:"duration"`
}

// FetchYouTube captures a YouTube video's metadata and English transcript via
// yt-dlp. YouTube pages rendered through curl are mostly JS shell; for SP
// writing we need the transcript, not the page chrome.
func FetchYouTube(ctx context.Context, urlStr string, opts FetchOptions) (*FetchResult, error) {
	if err := validateSafeHTTPURL(urlStr); err != nil {
		return nil, fmt.Errorf("fetchyoutube: %w", err)
	}
	if opts.WorkDir == "" {
		return nil, fmt.Errorf("fetchyoutube: WorkDir is required")
	}

	metaRes, err := runner.Run(ctx, "yt-dlp", "-J", "--skip-download", urlStr)
	if err != nil {
		return nil, fmt.Errorf("fetchyoutube: metadata: %w", err)
	}
	var meta youtubeMetadata
	if err := json.Unmarshal(metaRes.Stdout, &meta); err != nil {
		return nil, fmt.Errorf("fetchyoutube: parse metadata: %w", err)
	}

	subBase := filepath.Join(opts.WorkDir, "youtube-sub")
	_, err = runner.Run(ctx, "yt-dlp",
		"--skip-download",
		"--write-auto-subs",
		"--write-subs",
		"--sub-langs", "en.*,en",
		"--sub-format", "vtt",
		"-o", subBase+".%(ext)s",
		urlStr,
	)
	if err != nil {
		return nil, fmt.Errorf("fetchyoutube: subtitles: %w", err)
	}

	subFiles, err := filepath.Glob(subBase + "*.vtt")
	if err != nil {
		return nil, fmt.Errorf("fetchyoutube: glob subtitles: %w", err)
	}
	if len(subFiles) == 0 {
		return nil, &ValidationError{Reason: "fetchyoutube: no English subtitles/transcript found"}
	}
	sort.Strings(subFiles)
	subData, err := os.ReadFile(subFiles[0])
	if err != nil {
		return nil, fmt.Errorf("fetchyoutube: read subtitle: %w", err)
	}
	transcript := cleanupVTT(subData)
	if len(strings.Fields(transcript)) < 200 {
		return nil, &ValidationError{Reason: "fetchyoutube: transcript too short"}
	}

	channel := firstNonEmpty(meta.Channel, meta.Uploader, hostname(urlStr))
	date := formatYouTubeDate(meta.UploadDate)
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	title := firstNonEmpty(meta.Title, "Untitled YouTube video")

	header := fmt.Sprintf("@%s — %s\nSource URL: %s\nFetched via: yt-dlp transcript\n\n", sanitizeHandle(channel), date, urlStr)
	body := fmt.Sprintf("Title: %s\nChannel: %s\nDuration: %s\n\nTranscript:\n\n%s\n", title, channel, formatDuration(meta.Duration), transcript)
	payload := []byte(header + body)

	if verr := ValidateArticleCapture(payload); verr != nil {
		return nil, verr
	}

	outPath := filepath.Join(opts.WorkDir, "source-tweet.md")
	if err := os.WriteFile(outPath, payload, 0o644); err != nil {
		return nil, fmt.Errorf("fetchyoutube: writing capture to %s: %w", outPath, err)
	}

	return &FetchResult{
		Path:       outPath,
		Handle:     "@" + sanitizeHandle(channel),
		Date:       date,
		FetchedVia: "yt-dlp transcript",
		Bytes:      len(payload),
		IsX:        false,
	}, nil
}

var vttTimestampRe = regexp.MustCompile(`^\d\d:\d\d:\d\d\.\d\d\d\s+-->\s+\d\d:\d\d:\d\d\.\d\d\d`)
var vttTagRe = regexp.MustCompile(`<[^>]+>`)

func cleanupVTT(in []byte) string {
	lines := strings.Split(string(in), "\n")
	out := make([]string, 0, len(lines))
	seenLast := ""
	for _, line := range lines {
		line = strings.TrimSpace(strings.TrimRight(line, "\r"))
		if line == "" ||
			line == "WEBVTT" ||
			strings.HasPrefix(line, "Kind:") ||
			strings.HasPrefix(line, "Language:") ||
			strings.HasPrefix(line, "NOTE") ||
			vttTimestampRe.MatchString(line) {
			continue
		}
		line = vttTagRe.ReplaceAllString(line, "")
		line = html.UnescapeString(line)
		line = strings.Join(strings.Fields(line), " ")
		if line == "" || line == seenLast {
			continue
		}
		out = append(out, line)
		seenLast = line
	}
	return strings.Join(out, "\n")
}

func formatYouTubeDate(s string) string {
	if len(s) != 8 {
		return ""
	}
	return s[:4] + "-" + s[4:6] + "-" + s[6:8]
}

func formatDuration(seconds int) string {
	if seconds <= 0 {
		return "unknown"
	}
	h := seconds / 3600
	m := (seconds % 3600) / 60
	s := seconds % 60
	if h > 0 {
		return fmt.Sprintf("%d:%02d:%02d", h, m, s)
	}
	return fmt.Sprintf("%d:%02d", m, s)
}

func sanitizeHandle(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "youtube"
	}
	return s
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// validateSafeHTTPURL rejects non-http(s) schemes, malformed URLs, and
// obvious internal / loopback targets. Not a full SSRF block — DNS
// rebinding and redirects can still land on private IPs — but it stops
// the casual ways ("file://", "http://localhost/admin") to misuse the
// fetcher if this pipeline ever runs somewhere with internal services.
func validateSafeHTTPURL(raw string) error {
	u, err := nethttp.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http(s) URLs are supported, got %q", u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("URL has no host")
	}
	lower := strings.ToLower(host)
	if lower == "localhost" || lower == "localhost.localdomain" {
		return fmt.Errorf("localhost is not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() {
			return fmt.Errorf("internal / loopback IP %s is not allowed", ip)
		}
	}
	return nil
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
