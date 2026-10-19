package source

import "testing"

func TestParseCaptureHeaderKeepsFullGenericHost(t *testing.T) {
	cases := []struct {
		name, header, handle, date string
	}{
		{"generic host", "@www.anthropic.com — 2026-01-09\nSource URL: https://www.anthropic.com/engineering/x\nFetched via: fetch-article.py\n", "@www.anthropic.com", "2026-01-09"},
		{"hyphenated host", "@developer.nvidia-blog.com — 2026-02-01\nSource URL: https://developer.nvidia-blog.com/a\n", "@developer.nvidia-blog.com", "2026-02-01"},
		{"x handle", "@nickbaumann_ — 2026-03-04\nSource URL: https://x.com/nickbaumann_/status/1\nFetched via: fxtwitter\n", "@nickbaumann_", "2026-03-04"},
		{"single-char handle no date", "@a\nSource URL: https://x.com/a/status/1\n", "@a", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ParseCaptureHeader([]byte(tc.header))
			if got.Handle != tc.handle || got.Date != tc.date {
				t.Fatalf("ParseCaptureHeader() = handle %q date %q, want %q %q", got.Handle, got.Date, tc.handle, tc.date)
			}
		})
	}
}
