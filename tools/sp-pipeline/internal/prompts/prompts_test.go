package prompts

import (
	"strings"
	"testing"
)

func TestRender_Eval(t *testing.T) {
	out, err := Render("eval-gemini", EvalData{
		LineCount:      42,
		Source:         "fake tweet body\nwith two lines",
		OutputFilename: "eval-gemini.json",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"(42 lines)",
		"fake tweet body",
		"eval-gemini.json",
		`"verdict":"GO"|"SKIP"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered eval prompt", want)
		}
	}
}

func TestRender_Write(t *testing.T) {
	out, err := Render("write", WriteData{
		TicketID:       "SP-170",
		OriginalDate:   "2026-04-10",
		TranslatedDate: "2026-04-11",
		AuthorHandle:   "nickbaumann_",
		TweetURL:       "https://x.com/nickbaumann_/status/2042705384306336083",
		FirstTag:       "shroom-picks",
		StyleGuide:     "STYLE_GUIDE_PLACEHOLDER",
		Source:         "SOURCE_PLACEHOLDER",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"SP-170",
		"2026-04-10",
		"2026-04-11",
		"@nickbaumann_",
		"https://x.com/nickbaumann_/status/2042705384306336083",
		"shroom-picks",
		"STYLE_GUIDE_PLACEHOLDER",
		"SOURCE_PLACEHOLDER",
		"draft-v1.mdx",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered write prompt", want)
		}
	}
}

func TestRender_Review(t *testing.T) {
	out, err := Render("review", ReviewData{TicketID: "CP-278"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.Contains(out, "review.md") {
		t.Errorf("missing output path in review prompt")
	}
	if !strings.Contains(out, "CP-278") {
		t.Errorf("missing ticket id in review prompt")
	}
	// All 12 checklist items must survive rendering.
	for i := 1; i <= 12; i++ {
		needle := "\n" + itoa(i) + "."
		if !strings.Contains(out, needle) {
			t.Errorf("checklist item %d missing from review prompt", i)
		}
	}
}

func TestRender_Refine(t *testing.T) {
	out, err := Render("refine", RefineData{TicketID: "SP-170"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"SP-170",
		"final.mdx",
		"ClawdNote",
		"'../../components/ClawdNote.astro'",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered refine prompt", want)
		}
	}
}

func TestRender_MissingKey_Errors(t *testing.T) {
	// Use a data shape that does NOT satisfy EvalData — text/template with
	// missingkey=error must fail fast.
	_, err := Render("eval-gemini", map[string]any{"LineCount": 10})
	if err == nil {
		t.Fatalf("expected error for missing template key, got nil")
	}
}

// itoa is a tiny helper so we don't pull strconv into a test that only
// needs a single-digit int-to-string.
func itoa(i int) string {
	if i < 10 {
		return string(rune('0' + i))
	}
	return string(rune('0'+i/10)) + string(rune('0'+i%10))
}
