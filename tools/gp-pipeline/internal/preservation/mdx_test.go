package preservation

import (
	"strings"
	"testing"
)

func TestEscapeMDXImageAltBraces(t *testing.T) {
	input := strings.Join([]string{
		`![JSON {"label":"pelican"}](https://example.com/image.jpg)`,
		`![already \{"safe":true\}](https://example.com/safe.jpg)`,
		"`![inline {code}](ignored)`",
		"```",
		`![fenced {code}](ignored)`,
		"```",
		`{"ordinary":"json"}`,
	}, "\n")
	want := strings.Join([]string{
		`![JSON \{"label":"pelican"\}](https://example.com/image.jpg)`,
		`![already \{"safe":true\}](https://example.com/safe.jpg)`,
		"`![inline {code}](ignored)`",
		"```",
		`![fenced {code}](ignored)`,
		"```",
		`{"ordinary":"json"}`,
	}, "\n")
	if got := string(EscapeMDXImageAltBraces([]byte(input))); got != want {
		t.Fatalf("EscapeMDXImageAltBraces mismatch\nwant:\n%s\n\ngot:\n%s", want, got)
	}
}
