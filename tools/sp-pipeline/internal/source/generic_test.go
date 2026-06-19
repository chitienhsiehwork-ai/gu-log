package source

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateSafeHTTPURL(t *testing.T) {
	cases := []struct {
		name    string
		url     string
		wantErr bool
	}{
		{"https ok", "https://www.anthropic.com/news/claude-4-6", false},
		{"http ok", "http://example.com/article", false},
		{"ftp rejected", "ftp://example.com/file", true},
		{"file rejected", "file:///etc/passwd", true},
		{"javascript rejected", "javascript:alert(1)", true},
		{"localhost rejected", "http://localhost:8080/", true},
		{"loopback IP rejected", "http://127.0.0.1/secret", true},
		{"private RFC1918 rejected", "http://192.168.1.1/", true},
		{"link-local rejected", "http://169.254.169.254/latest/meta-data/", true},
		{"no host rejected", "https:///path", true},
		{"garbage rejected", "not a url", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateSafeHTTPURL(c.url)
			if c.wantErr && err == nil {
				t.Fatalf("want error for %q, got nil", c.url)
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error for %q: %v", c.url, err)
			}
		})
	}
}

func TestCleanupHTML_PlainTextPassThrough(t *testing.T) {
	in := []byte("Just some plain text.\n\nNo HTML here.")
	out := cleanupHTML(in)
	if string(out) != string(in) {
		t.Fatalf("plain text was modified:\n  want %q\n  got  %q", in, out)
	}
}

func TestCleanupHTML_StripsScriptsAndStyles(t *testing.T) {
	in := []byte(`<html><head>
<style>body { color: red; }</style>
<script>alert("xss")</script>
</head><body>
<h1>Claude Code 4.6 Released</h1>
<p>Anthropic shipped <em>Claude Opus 4.6</em> today with a 1M context window.</p>
<script type="application/json">{"bad":"json"}</script>
<p>Read more at <a href="/blog">the blog</a>.</p>
</body></html>`)
	out := cleanupHTML(in)
	s := string(out)
	if strings.Contains(s, "<script") || strings.Contains(s, "<style") {
		t.Fatalf("script/style not stripped: %q", s)
	}
	if strings.Contains(s, "alert(") || strings.Contains(s, "color: red") {
		t.Fatalf("script/style contents leaked: %q", s)
	}
	if !strings.Contains(s, "Claude Code 4.6 Released") {
		t.Fatalf("heading text was dropped: %q", s)
	}
	if !strings.Contains(s, "1M context window") {
		t.Fatalf("body text was dropped: %q", s)
	}
}

func TestCleanupHTML_DecodesEntities(t *testing.T) {
	in := []byte(`<p>Tom &amp; Jerry &mdash; &quot;hi&quot;</p>`)
	out := string(cleanupHTML(in))
	if !strings.Contains(out, "Tom & Jerry") || !strings.Contains(out, `"hi"`) {
		t.Fatalf("entities not decoded: %q", out)
	}
}

func TestHostname(t *testing.T) {
	cases := map[string]string{
		"https://www.anthropic.com/news/x":     "www.anthropic.com",
		"https://claude.com/product/agent-sdk": "claude.com",
		"http://example.com:8080/foo":          "example.com",
		"not a url":                            "unknown",
	}
	for in, want := range cases {
		if got := hostname(in); got != want {
			t.Errorf("hostname(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFetchGeneric_UsesCurlWhenFetchArticleScriptEmpty(t *testing.T) {
	tmp := t.TempDir()
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "curl"), `#!/usr/bin/env bash
cat <<'HTML'
<html><body>
<h1>Curl Article</h1>
<p>This fake curl article has enough prose to pass the generic source validator.</p>
<p>It includes multiple non-empty lines so the capture shape remains realistic.</p>
<p>The body is intentionally plain and boring because the test only checks routing.</p>
<p>One more line pads the capture beyond the minimum length without using the network.</p>
</body></html>
HTML
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	res, err := FetchGeneric(context.Background(), "https://example.com/article", FetchOptions{WorkDir: tmp})
	if err != nil {
		t.Fatalf("FetchGeneric: %v", err)
	}
	if res.FetchedVia != "curl" {
		t.Fatalf("FetchedVia = %q, want curl", res.FetchedVia)
	}
	data, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Fetched via: curl") {
		t.Fatalf("capture missing curl header:\n%s", data)
	}
}

func TestFetchGeneric_UsesFetchArticleScriptWhenValid(t *testing.T) {
	tmp := t.TempDir()
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "python3"), `#!/usr/bin/env bash
cat <<'TEXT'
Python Article
This cleaned article text came from the Python extractor and is already readable.
It has enough paragraphs to satisfy the article validator without HTML cleanup.
The exact body should be preserved because the extractor did the cleanup upstream.
This line pads the capture to a realistic size for downstream LLM prompts.
The final line ensures there are more than five non-empty lines in the payload.
TEXT
`)
	writeExecutable(t, filepath.Join(binDir, "curl"), `#!/usr/bin/env bash
echo "curl should not run" >&2
exit 9
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	res, err := FetchGeneric(context.Background(), "https://example.com/article", FetchOptions{
		WorkDir:            tmp,
		FetchArticleScript: filepath.Join(tmp, "fetch-article.py"),
	})
	if err != nil {
		t.Fatalf("FetchGeneric: %v", err)
	}
	if res.FetchedVia != "fetch-article.py" {
		t.Fatalf("FetchedVia = %q, want fetch-article.py", res.FetchedVia)
	}
	data, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	got := string(data)
	if !strings.Contains(got, "Fetched via: fetch-article.py") {
		t.Fatalf("capture missing python header:\n%s", got)
	}
	if !strings.Contains(got, "Python Article") {
		t.Fatalf("capture missing python body:\n%s", got)
	}
}

func TestFetchGeneric_FallsBackWhenFetchArticleOutputInvalid(t *testing.T) {
	tmp := t.TempDir()
	binDir := filepath.Join(tmp, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeExecutable(t, filepath.Join(binDir, "python3"), `#!/usr/bin/env bash
echo "too short"
`)
	writeExecutable(t, filepath.Join(binDir, "curl"), `#!/usr/bin/env bash
cat <<'HTML'
<html><body>
<h1>Fallback Article</h1>
<p>This fake curl article is long enough to prove invalid Python output falls back.</p>
<p>It has multiple non-empty lines and contains no blocked markers or code shell.</p>
<p>The fetcher should validate this fallback payload and write it successfully.</p>
<p>That keeps Python extractor failures advisory instead of making the pipeline fail.</p>
</body></html>
HTML
`)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	res, err := FetchGeneric(context.Background(), "https://example.com/article", FetchOptions{
		WorkDir:            tmp,
		FetchArticleScript: filepath.Join(tmp, "fetch-article.py"),
	})
	if err != nil {
		t.Fatalf("FetchGeneric: %v", err)
	}
	if res.FetchedVia != "curl" {
		t.Fatalf("FetchedVia = %q, want curl fallback", res.FetchedVia)
	}
	data, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Fallback Article") {
		t.Fatalf("capture missing fallback body:\n%s", data)
	}
}

func writeExecutable(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
