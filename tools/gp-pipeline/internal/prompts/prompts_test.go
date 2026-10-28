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
		Prefix:         "MP",
		TicketID:       "MP-170",
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
		"MP-170",
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
		Prefix:         "MP",
		TicketID:       "MP-PENDING",
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
	out, err := Render("review", ReviewData{Prefix: "MP", TicketID: "MP-278"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if !strings.Contains(out, "review.md") {
		t.Errorf("missing output path in review prompt")
	}
	if !strings.Contains(out, "MP-278") {
		t.Errorf("missing ticket id in review prompt")
	}
	// All MP checklist items must survive rendering.
	for i := 1; i <= 11; i++ {
		needle := "\n" + itoa(i) + "."
		if !strings.Contains(out, needle) {
			t.Errorf("checklist item %d missing from review prompt", i)
		}
	}
}

func TestRender_Refine(t *testing.T) {
	out, err := Render("refine", RefineData{Prefix: "MP", TicketID: "MP-170"})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"MP-170",
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
		Prefix:   "MP",
		TicketID: "MP-PENDING",
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

// TestRender_MPPromptsDropRetiredRules guards against retired
// translation-completeness rules coming back into the MP prompts. Wording of
// the current contract is not pinned here; openspec editorial-charter owns it.
func TestRender_MPPromptsDropRetiredRules(t *testing.T) {
	write, err := Render("write", WriteData{Prefix: "MP", TicketID: "MP-PENDING", Source: "SOURCE"})
	if err != nil {
		t.Fatalf("Render write: %v", err)
	}
	review, err := Render("review", ReviewData{Prefix: "MP", TicketID: "MP-278"})
	if err != nil {
		t.Fatalf("Render review: %v", err)
	}
	for _, forbidden := range []string{
		"Cover ALL of it",
		"Cover ALL tweets",
		"Do not fabricate facts, quotes, numbers, causality, citations, or lived experience",
	} {
		if strings.Contains(write, forbidden) {
			t.Errorf("MP write prompt still requires translation completeness via %q", forbidden)
		}
	}
	for _, forbidden := range []string{
		"Coverage Completeness",
		"no hallucinated claims beyond source context",
		"every number in translation must trace back to source",
		"source limitations, caveats, and conditions must be preserved",
		"conclusion must not introduce claims beyond source material",
		"all commentary goes through MoguNote",
	} {
		if strings.Contains(review, forbidden) {
			t.Errorf("MP review prompt still includes the translation-completeness rule %q", forbidden)
		}
	}
}

// TestRender_NoGPReadingGuideBranch: GP is a promoted MP (openspec
// gp-signature-picks), so no prompt keeps the retired reading-guide branch,
// its glossary context, or a GP-only rule; eval asks the same question of
// every source.
func TestRender_NoGPReadingGuideBranch(t *testing.T) {
	var rendered []string
	for _, prefix := range []string{"MP", "SD", "GP"} {
		for name, data := range map[string]any{
			"write":  WriteData{Prefix: prefix, TicketID: prefix + "-PENDING", Source: "SOURCE"},
			"review": ReviewData{Prefix: prefix, TicketID: prefix + "-PENDING"},
			"refine": RefineData{Prefix: prefix, TicketID: prefix + "-PENDING"},
		} {
			out, err := Render(name, data)
			if err != nil {
				t.Fatalf("Render %s %s: %v", prefix, name, err)
			}
			rendered = append(rendered, out)
		}
	}
	for _, template := range []string{"eval-codex", "eval-gemini"} {
		out, err := Render(template, EvalData{LineCount: 1, Source: "SOURCE", OutputFilename: "eval.json"})
		if err != nil {
			t.Fatal(err)
		}
		rendered = append(rendered, out)
	}
	translate, err := Render("translate", TranslateData{TicketID: "GP-7", Source: "body"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(translate, "quote it verbatim rather than back-translating") {
		t.Error("translate prompt lost the verbatim-quote rule a GP now shares with MP")
	}
	for _, out := range append(rendered, translate) {
		for _, retired := range []string{"reading guide", "精選導讀", "source-distance", "Canonical terminology", "Flagged passages", "Check report"} {
			if strings.Contains(out, retired) {
				t.Errorf("prompt still carries the retired GP branch (%q):\n%s", retired, out)
			}
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
	for _, want := range []string{
		"pipeline runtime writes them after translation",
		"`translatedBy.pipeline` and `translatedBy.pipelineUrl` IDENTICAL",
		"`/glossary#...` links to `/en/glossary#...`",
		"Give every English MoguNote a `summary`",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("translate prompt missing provenance boundary %q", want)
		}
	}
	if strings.Contains(out, "structurally valid") {
		t.Fatal("translate prompt still delegates ambiguous provenance structure to the model")
	}
}

func TestRender_EnglishSidecarDoesNotRestoreUnapprovedEmoji(t *testing.T) {
	out, err := Render("translate", TranslateData{TicketID: "GP-7", Source: "body"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Do not restore any Unicode emoji glyph", "Omit decorative glyphs", "natural English", "automated sidecar lane", "no glyph-retention exception", "Kaomoji"} {
		if !strings.Contains(out, want) {
			t.Errorf("English sidecar prompt missing emoji boundary %q", want)
		}
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
