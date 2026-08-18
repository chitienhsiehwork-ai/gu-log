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
	// All MP checklist items must survive rendering without inheriting GP-only items.
	for i := 1; i <= 11; i++ {
		needle := "\n" + itoa(i) + "."
		if !strings.Contains(out, needle) {
			t.Errorf("checklist item %d missing from review prompt", i)
		}
	}
}

func TestRender_Refine(t *testing.T) {
	out, err := Render("refine", RefineData{Prefix: "GP", TicketID: "GP-170"})
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
		Prefix:   "GP",
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

func TestRender_MPWriteContractAllowsSelectionButRequiresClaimClosure(t *testing.T) {
	out, err := Render("write", WriteData{
		Prefix:         "MP",
		TicketID:       "MP-PENDING",
		OriginalDate:   "2026-08-16",
		TranslatedDate: "2026-08-16",
		SourceField:    "Source Author",
		TweetURL:       "https://example.com/source",
		StyleGuide:     "GUIDE",
		Source:         "SOURCE",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"Mogu owns the body voice",
		"MAY omit whole claims",
		"complete claim closure",
		"correct speaker, conditions, hedges, controlling caveats, evidence scope, and confidence level",
		"must not attribute those additions to the source author",
		"Do not fabricate facts, quotes, numbers, causality, citations, or lived experience",
		"A complete MP needs no MoguNote",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("MP write prompt missing %q", want)
		}
	}
	for _, forbidden := range []string{"Cover ALL of it", "Cover ALL tweets"} {
		if strings.Contains(out, forbidden) {
			t.Errorf("MP write prompt still requires translation completeness via %q", forbidden)
		}
	}
}

func TestRender_MPReviewAndRefineDoNotRequireMoguNoteOrTranslationCompleteness(t *testing.T) {
	review, err := Render("review", ReviewData{Prefix: "MP", TicketID: "MP-278"})
	if err != nil {
		t.Fatalf("Render review: %v", err)
	}
	refine, err := Render("refine", RefineData{Prefix: "MP", TicketID: "MP-278"})
	if err != nil {
		t.Fatalf("Render refine: %v", err)
	}
	for _, want := range []string{
		"may omit whole source claims",
		"Do not score translation completeness",
		"Mogu may synthesize, disagree, extend, or infer in the body",
		"do not require, add, or reward one by count",
	} {
		if !strings.Contains(review, want) {
			t.Errorf("MP review prompt missing %q", want)
		}
	}
	for _, want := range []string{
		"do not restore omitted source sections",
		"speaker, conditions, hedges, controlling caveats, evidence scope, and confidence level",
		"Do not add one merely because the article has none",
	} {
		if !strings.Contains(refine, want) {
			t.Errorf("MP refine prompt missing %q", want)
		}
	}
	if strings.Contains(review, "Coverage Completeness") {
		t.Fatal("MP review prompt still includes translation completeness")
	}
	for _, forbidden := range []string{
		"no hallucinated claims beyond source context",
		"every number in translation must trace back to source",
		"source limitations, caveats, and conditions must be preserved",
		"conclusion must not introduce claims beyond source material",
		"all commentary goes through MoguNote",
	} {
		if strings.Contains(review, forbidden) {
			t.Errorf("MP review prompt still includes GP-only rule %q", forbidden)
		}
	}
}

func TestRender_GPWriteContractKeepsTranslationCompleteness(t *testing.T) {
	out, err := Render("write", WriteData{
		Prefix:         "GP",
		TicketID:       "GP-PENDING",
		OriginalDate:   "2026-08-16",
		TranslatedDate: "2026-08-16",
		SourceField:    "Source Author",
		TweetURL:       "https://example.com/source",
		StyleGuide:     "GUIDE",
		Source:         "SOURCE",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	for _, want := range []string{
		"Cover ALL of it",
		"Cover ALL tweets",
		"Put Mogu/gu-log opinions",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("GP write prompt lost translation boundary %q", want)
		}
	}
	if strings.Contains(out, "MAY omit whole claims") {
		t.Fatal("GP write prompt inherited MP selection freedom")
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
	} {
		if !strings.Contains(out, want) {
			t.Errorf("translate prompt missing provenance boundary %q", want)
		}
	}
	if strings.Contains(out, "structurally valid") {
		t.Fatal("translate prompt still delegates ambiguous provenance structure to the model")
	}
}

func TestRender_VibeGateIsSourceBlind(t *testing.T) {
	out, err := Render("vibe-gate", PreservationGateData{
		Version: "v1", SourceSHA256: "source-hash", TranslationSHA256: "translation-hash",
		BodyProjectionSHA256: "projection-hash", Source: "SECRET_SOURCE_SENTENCE", Translation: "譯文內容",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if strings.Contains(out, "SECRET_SOURCE_SENTENCE") {
		t.Fatal("cold-read vibe prompt leaked the source")
	}
	for _, want := range []string{"譯文內容", `"source_quote":""`, "忠實度與 source evidence 由另一位 reviewer 負責", "opaque provenance ID", "只會收到 canonical body", "拿不準就保留"} {
		if !strings.Contains(out, want) {
			t.Errorf("vibe prompt missing %q", want)
		}
	}
}

func TestRender_SourceRolesKeepNaturalTranslationBoundary(t *testing.T) {
	translator, err := Render("source-translate", SourceTranslateData{
		Version: "v1", SourceSHA256: "hash", Source: "SOURCE",
		CanonicalTerminology: `[{"term":"Agent","forbiddenZhTw":["代理人"]}]`,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"忠實不是逐字搬運", "productivity ouroboros", "演算法動態", "自然語言 prompt 與 thinking trace", "inline code、code fence 或 blockquote", "資料鍵與不可翻譯的值"} {
		if !strings.Contains(translator, want) {
			t.Errorf("translator prompt missing %q", want)
		}
	}
	for _, want := range []string{"runtime 提供的 canonical terminology", `"term":"Agent"`, `"forbiddenZhTw":["代理人"]`} {
		if !strings.Contains(translator, want) {
			t.Errorf("translator prompt missing terminology context %q", want)
		}
	}
	reviewer, err := Render("source-review", PreservationGateData{Version: "v1", SourceSHA256: "source", TranslationSHA256: "translation", Source: "SOURCE", Translation: "BODY"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Fidelity 看語意，不看字面", "不得要求恢復 natural hard gate", "BODY", "SOURCE", "不要做 byte arithmetic"} {
		if !strings.Contains(reviewer, want) {
			t.Errorf("source reviewer prompt missing %q", want)
		}
	}
}

func TestRender_CorrectorTreatsSuggestionAsDiagnostic(t *testing.T) {
	out, err := Render("correct", CorrectData{Version: "v1", Source: "10x me", Translation: "讓我十倍成長", ApprovedFindingsJSON: "[]"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"suggested_replacement 只是指出問題方向", "不是必須照抄", "不改變語氣強弱", "不要加入 source 沒有的強化詞"} {
		if !strings.Contains(out, want) {
			t.Errorf("corrector prompt missing %q", want)
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
