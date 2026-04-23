package source

import (
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
