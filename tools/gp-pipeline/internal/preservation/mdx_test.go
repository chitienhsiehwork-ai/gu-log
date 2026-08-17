package preservation

import (
	"bytes"
	"strings"
	"testing"
)

func TestEscapeMDXImageAltBraces(t *testing.T) {
	input := strings.Join([]string{
		`![JSON {"label":"pelican"}](https://example.com/image.jpg)`,
		`![already \{"safe":true\}](https://example.com/safe.jpg)`,
		"`![inline {code}](ignored)`",
		"`第一行",
		`![multiline inline {"x":1}](ignored)`,
		"第三行`",
		`這只是文字：![not an image {"x":1}]，沒有圖片網址。`,
		"```",
		`![fenced {code}](ignored)`,
		"```",
		`{"ordinary":"json"}`,
	}, "\n")
	want := strings.Join([]string{
		`![JSON \{"label":"pelican"\}](https://example.com/image.jpg)`,
		`![already \{"safe":true\}](https://example.com/safe.jpg)`,
		"`![inline {code}](ignored)`",
		"`第一行",
		`![multiline inline {"x":1}](ignored)`,
		"第三行`",
		`這只是文字：![not an image {"x":1}]，沒有圖片網址。`,
		"```",
		`![fenced {code}](ignored)`,
		"```",
		`{"ordinary":"json"}`,
	}, "\n")
	if got := string(EscapeMDXImageAltBraces([]byte(input))); got != want {
		t.Fatalf("EscapeMDXImageAltBraces mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}

func TestEscapeMDXImageAltBracesWithOffsets(t *testing.T) {
	input := []byte(`before ![JSON {"x":1}](https://example.com/image.jpg) after`)
	oldText := `![JSON {"x":1}](https://example.com/image.jpg)`
	start := bytes.Index(input, []byte(oldText))
	end := start + len(oldText)

	canonical, offsets := EscapeMDXImageAltBracesWithOffsets(input)
	got := string(canonical[offsets[start]:offsets[end]])
	want := `![JSON \{"x":1\}](https://example.com/image.jpg)`
	if got != want {
		t.Fatalf("mapped image anchor = %q, want %q", got, want)
	}
}
