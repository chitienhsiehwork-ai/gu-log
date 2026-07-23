package prompts

import (
	"strings"
	"testing"
)

func TestRender_Eval(t *testing.T) {
	out, err := Render("eval-codex", EvalData{
		LineCount:      42,
		Source:         "fake tweet body\nwith two lines",
		OutputFilename: "eval-codex-primary.json",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"(42 lines)",
		"fake tweet body",
		"eval-codex-primary.json",
		`"verdict":"GO"|"SKIP"`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered eval prompt", want)
		}
	}
}

func TestRender_Write(t *testing.T) {
	out, err := Render("write", WriteData{
		Prefix:         "GP",
		TicketID:       "GP-170",
		OriginalDate:   "2026-04-10",
		TranslatedDate: "2026-04-11",
		AuthorHandle:   "nickbaumann_",
		SourceField:    "@nickbaumann_ on X",
		TweetURL:       "https://x.com/nickbaumann_/status/2042705384306336083",
		Model:          "GPT-5.5",
		Harness:        "Codex CLI",
		StyleGuide:     "STYLE_GUIDE_PLACEHOLDER",
		Source:         "SOURCE_PLACEHOLDER",
		Angle:          "",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"GP-170",
		"2026-04-10",
		"2026-04-11",
		"@nickbaumann_ on X",
		"https://x.com/nickbaumann_/status/2042705384306336083",
		"never add a series tag",
		"STYLE_GUIDE_PLACEHOLDER",
		"SOURCE_PLACEHOLDER",
		"draft-v1.mdx",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered write prompt", want)
		}
	}
	// Empty angle = no NARRATIVE ANGLE section emitted.
	if strings.Contains(out, "NARRATIVE ANGLE") {
		t.Errorf("write prompt emitted NARRATIVE ANGLE section despite empty Angle")
	}
}

func TestRender_Write_WithAngleAndCustomSource(t *testing.T) {
	out, err := Render("write", WriteData{
		Prefix:         "GP",
		TicketID:       "GP-PENDING",
		OriginalDate:   "2026-04-28",
		TranslatedDate: "2026-04-28",
		AuthorHandle:   "docs.openclaw.ai",
		TweetURL:       "https://docs.openclaw.ai/automation",
		StyleGuide:     "GUIDE",
		Source:         "BODY",
		SourceField:    "OpenClaw Docs",
		Angle:          "Focus on Task Flow while introducing the others. Use intriguing stories.",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"source: OpenClaw Docs",
		"NARRATIVE ANGLE",
		"Focus on Task Flow",
		"STRUCTURAL directive",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered write prompt with angle:\n---\n%s\n---", want, out)
		}
	}
	// X-handle format should NOT appear when SourceField is overridden.
	if strings.Contains(out, "@docs.openclaw.ai on X") {
		t.Errorf("write prompt leaked X-style source when SourceField was overridden")
	}
}

func TestRender_Review(t *testing.T) {
	out, err := Render("review", ReviewData{TicketID: "MP-278"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.Contains(out, "review.md") {
		t.Errorf("missing output path in review prompt")
	}
	if !strings.Contains(out, "MP-278") {
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
	out, err := Render("refine", RefineData{TicketID: "GP-170"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"GP-170",
		"final.mdx",
		"MoguNote",
		"'../../components/MoguNote.astro'",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered refine prompt", want)
		}
	}
	if strings.Contains(out, "NARRATIVE ANGLE") {
		t.Errorf("refine prompt emitted NARRATIVE ANGLE section despite empty Angle")
	}
}

func TestRender_Refine_WithAngle(t *testing.T) {
	out, err := Render("refine", RefineData{
		TicketID: "GP-PENDING",
		Angle:    "Focus on Task Flow while introducing the others.",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"NARRATIVE ANGLE",
		"Focus on Task Flow",
		"angle-pivoted structure is intentional",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in rendered refine prompt with angle:\n---\n%s\n---", want, out)
		}
	}
}

func TestRender_TranslateNamesDistinctMDXComponents(t *testing.T) {
	out, err := Render("translate", TranslateData{TicketID: "GP-7", Source: "body"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, component := range []string{"MoguNote", "ShroomDogNote"} {
		if !strings.Contains(out, component) {
			t.Errorf("translate prompt missing component %q", component)
		}
	}
	if strings.Contains(out, "MoguNote, "+"MoguNote") {
		t.Fatal("translate prompt repeats MoguNote instead of naming the supported components")
	}
}

func TestRender_MissingKey_Errors(t *testing.T) {
	// Use a data shape that does NOT satisfy EvalData — text/template with
	// missingkey=error must fail fast.
	_, err := Render("eval-codex", map[string]any{"LineCount": 10})
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
