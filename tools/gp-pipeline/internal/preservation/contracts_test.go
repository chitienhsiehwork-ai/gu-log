package preservation

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProviderStructuredOutputSchemasAreValidJSON(t *testing.T) {
	for name, schema := range map[string]string{
		"source translation": SourceTranslationJSONSchema,
		"gate envelope":      GateEnvelopeJSONSchema,
		"commentary":         CommentaryArtifactJSONSchema,
	} {
		t.Run(name, func(t *testing.T) {
			if !json.Valid([]byte(schema)) {
				t.Fatalf("invalid JSON schema: %s", schema)
			}
		})
	}
}

func validPatch(source, translation []byte, old, replacement string) PatchArtifact {
	start := bytes.Index(translation, []byte(old))
	return PatchArtifact{
		Version: ContractVersion, SourceSHA256: SHA256(source), TranslationSHA256: SHA256(translation),
		Provenance: Provenance{Role: "corrector", Provider: "codex", Model: "fixture-corrector", Harness: "go-test", CompletedAt: time.Now().UTC()},
		Patches: []Finding{{
			ID: "finding-1", IssueType: "fidelity", SourceQuote: "hedged",
			SourceSHA256: SHA256(source), TranslationSHA256: SHA256(translation),
			StartByte: start, EndByte: start + len([]byte(old)), OldText: old,
			OldTextSHA256: SHA256([]byte(old)), SuggestedReplacement: replacement, Approved: true,
		}},
	}
}

func TestApplyPatchesChangesOnlyApprovedBoundary(t *testing.T) {
	source := []byte("The author hedged this claim.")
	translation := []byte("---\ntitle: 測試\n---\n\n前文。\n\n這一定是真的。\n\n後文。\n")
	artifact := validPatch(source, translation, "一定", "可能")
	out, err := ApplyPatches(source, translation, artifact)
	if err != nil {
		t.Fatal(err)
	}
	want := bytes.Replace(translation, []byte("一定"), []byte("可能"), 1)
	if !bytes.Equal(out, want) {
		t.Fatalf("output mismatch:\n%s", out)
	}
	before := artifact.Patches[0].StartByte
	after := artifact.Patches[0].EndByte
	if !bytes.Equal(out[:before], translation[:before]) || !bytes.Equal(out[before+len([]byte("可能")):], translation[after:]) {
		t.Fatal("bytes outside the approved boundary changed")
	}
}

func TestApplyPatchesRejectsStaleOverlapParagraphAndFrontmatter(t *testing.T) {
	source := []byte("The author hedged this claim.")
	translation := []byte("---\ntitle: 測試\n---\n\n第一段。\n\n第二段一定是真的。\n")
	cases := map[string]func(*PatchArtifact){
		"stale hash":        func(a *PatchArtifact) { a.TranslationSHA256 = strings.Repeat("0", 64) },
		"old text mismatch": func(a *PatchArtifact) { a.Patches[0].OldText = "必然" },
		"cross paragraph": func(a *PatchArtifact) {
			start := bytes.Index(translation, []byte("第一段"))
			end := bytes.Index(translation, []byte("第二段")) + len([]byte("第二段"))
			p := &a.Patches[0]
			p.StartByte, p.EndByte, p.OldText = start, end, string(translation[start:end])
			p.OldTextSHA256 = SHA256(translation[start:end])
		},
		"frontmatter": func(a *PatchArtifact) {
			start := bytes.Index(translation, []byte("測試"))
			p := &a.Patches[0]
			p.StartByte, p.EndByte, p.OldText = start, start+len([]byte("測試")), "測試"
			p.OldTextSHA256 = SHA256([]byte("測試"))
		},
		"overlap": func(a *PatchArtifact) { a.Patches = append(a.Patches, a.Patches[0]) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			a := validPatch(source, translation, "一定", "可能")
			mutate(&a)
			if _, err := ApplyPatches(source, translation, a); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestValidateManifestRejectsMissingStaleAndInvalidVerdicts(t *testing.T) {
	source, projection := []byte("source"), []byte("body")
	now := time.Now().UTC()
	gate := func(name string) GateEnvelope {
		return GateEnvelope{Version: ContractVersion, Gate: name, SourceSHA256: SHA256(source), BodyProjectionSHA256: SHA256(projection), Verdict: "PASS", Provenance: Provenance{Role: name, Provider: "fixture", Model: name + "-model", Harness: "go-test", CompletedAt: now}}
	}
	m := PublishManifest{Version: ContractVersion, SourceSHA256: SHA256(source), BodyProjectionSHA256: SHA256(projection), Verdict: "PASS", Gates: []GateEnvelope{gate("source-reviewer"), gate("vibe-scorer")}, CompletedAt: now}
	if err := ValidateManifest(m, source, projection, []string{"source-reviewer", "vibe-scorer"}); err != nil {
		t.Fatal(err)
	}
	tests := map[string]func(*PublishManifest){
		"missing gate":       func(m *PublishManifest) { m.Gates = m.Gates[:1] },
		"stale source":       func(m *PublishManifest) { m.SourceSHA256 = strings.Repeat("0", 64) },
		"gate fail":          func(m *PublishManifest) { m.Gates[0].Verdict = "FAIL" },
		"invalid verdict":    func(m *PublishManifest) { m.Gates[0].Verdict = "MAYBE" },
		"missing provenance": func(m *PublishManifest) { m.Gates[0].Provenance.Model = "" },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			copy := m
			copy.Gates = append([]GateEnvelope(nil), m.Gates...)
			mutate(&copy)
			if ValidateManifest(copy, source, projection, []string{"source-reviewer", "vibe-scorer"}) == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}

func TestValidateVerdictFindingsRequiresConsistentEnvelope(t *testing.T) {
	finding := Finding{ID: "finding-1"}
	for name, tc := range map[string]struct {
		verdict  string
		findings []Finding
		wantErr  bool
	}{
		"pass without findings": {verdict: "PASS"},
		"fail with finding":     {verdict: "FAIL", findings: []Finding{finding}},
		"pass with finding":     {verdict: "PASS", findings: []Finding{finding}, wantErr: true},
		"fail without finding":  {verdict: "FAIL", wantErr: true},
		"unknown":               {verdict: "MAYBE", wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			err := ValidateVerdictFindings(tc.verdict, tc.findings)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateVerdictFindings() error = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestDeterministicNaturalFindings(t *testing.T) {
	source := []byte("I recently left. I came back. My habits worried me. I did not miss it.")
	direct := []byte("我最近離開了一陣子。我回來後，開始擔心自己的習慣。我並不想念它。")
	if got := DeterministicNaturalFindings(source, direct); len(got) != 0 {
		t.Fatalf("direct translation findings: %v", got)
	}
	rewritten := []byte("Brent Fitzgerald 放了假。寫這篇文章的人看到演算法動態，形容這是生產力銜尾蛇。")
	if got := DeterministicNaturalFindings(source, rewritten); len(got) < 3 {
		t.Fatalf("rewritten findings = %v, want voice + two terms", got)
	}
}

func TestCanonicalizeFindingAnchorsUsesUniqueExactText(t *testing.T) {
	translation := []byte("---\ntitle: 測試\n---\n\n我一直滑演算法動態。\n")
	finding := Finding{ID: "natural-feed", IssueType: "natural_zh_tw", OldText: "演算法動態", StartByte: 1, EndByte: 2, OldTextSHA256: "wrong"}
	got, err := CanonicalizeFindingAnchors(translation, []Finding{finding})
	if err != nil {
		t.Fatal(err)
	}
	start := bytes.Index(translation, []byte("演算法動態"))
	if got[0].StartByte != start || got[0].EndByte != start+len([]byte("演算法動態")) || got[0].OldTextSHA256 != SHA256([]byte("演算法動態")) {
		t.Fatalf("canonical anchor = %#v", got[0])
	}

	ambiguous := []byte("演算法動態，還是演算法動態")
	if _, err := CanonicalizeFindingAnchors(ambiguous, []Finding{finding}); err == nil {
		t.Fatal("ambiguous exact-text anchor must fail")
	}
}

func TestGP273RegressionPrefersSourceAlignedFirstPersonTranslation(t *testing.T) {
	fixture := func(name string) []byte {
		t.Helper()
		data, err := os.ReadFile(filepath.Join("testdata", "gp-273", name))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	source := fixture("source.txt")
	direct := fixture("source-aligned-zh-tw.mdx")
	published := fixture("published-rewrite.mdx")
	if got := DeterministicSourceFindings(source, direct); len(got) != 0 {
		t.Fatalf("source-aligned first-person translation should pass deterministic gates: %v", got)
	}
	got := strings.Join(DeterministicSourceFindings(source, published), "\n")
	for _, want := range []string{"第一人稱", "演算法動態", "unsupported packaging", "重複結語"} {
		if !strings.Contains(got, want) {
			t.Errorf("published rewrite findings missing %q:\n%s", want, got)
		}
	}
}
