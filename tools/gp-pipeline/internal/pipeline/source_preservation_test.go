package pipeline

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/preservation"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
)

func gpFakeDispatcher(t *testing.T, name string, model llm.ModelID, outputs ...string) *llm.Dispatcher {
	t.Helper()
	fake := &llm.FakeProvider{NameStr: name, ModelID: model, AvailableV: true}
	for _, output := range outputs {
		fake.WithResponses(llm.FakeResponse{Output: output})
	}
	dispatcher, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatal(err)
	}
	return dispatcher
}

func TestLegacyShadowCharacterizesRetiredUnsafeGPFlow(t *testing.T) {
	writePrompt, err := prompts.Render("write", prompts.WriteData{Prefix: "GP", TicketID: "GP-PENDING", Angle: "改成品牌故事", StyleGuide: "style", Source: "I tell my story."})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(writePrompt, "STRUCTURAL directive") || strings.Contains(writePrompt, "保留第一人稱") {
		t.Fatalf("legacy writer no longer characterizes angle-driven voice-changing authority:\n%s", writePrompt)
	}
	refinePrompt, err := prompts.Render("refine", prompts.RefineData{TicketID: "GP-PENDING"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(refinePrompt, "corrected final article") {
		t.Fatalf("legacy refine no longer requests a full article:\n%s", refinePrompt)
	}

	tmp := t.TempDir()
	scriptsDir, postsDir, workDir := filepath.Join(tmp, "scripts"), filepath.Join(tmp, "posts"), filepath.Join(tmp, "work")
	for _, dir := range []string{scriptsDir, postsDir, workDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal.sh"), []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workDir, "final.mdx"), []byte("---\ntitle: Legacy\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewState()
	s.LegacyShadow, s.Log, s.WorkDir, s.AuthorHandle, s.Title = true, logx.New(), workDir, "legacy", "Legacy"
	s.Cfg = &config.Config{RepoRoot: tmp, ScriptsDir: scriptsDir, PostsDir: postsDir}
	dispatcher := gpFakeDispatcher(t, "legacy-writer", llm.ModelGPT55)
	s.Dispatcher, s.WriterDispatcher, s.JudgeDispatcher = dispatcher, dispatcher, dispatcher
	if err := s.Ralph(context.Background()); err != nil {
		t.Fatalf("legacy shadow must preserve advisory Tribunal failure: %v", err)
	}
	if s.RalphPassed {
		t.Fatal("fixture Tribunal should fail")
	}
}

func artifactJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func newGPState(t *testing.T, source, translation string) (*State, []byte) {
	t.Helper()
	repoRoot := findRepoRoot()
	if repoRoot == "" {
		t.Skip("repo root unavailable")
	}
	workDir := t.TempDir()
	sourceBytes := []byte(source)
	sourcePath := filepath.Join(workDir, "source-tweet.md")
	if err := os.WriteFile(sourcePath, sourceBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	translatorArtifact := preservation.SourceTranslationArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(sourceBytes), TranslationMDX: translation, SlopCandidates: []preservation.Finding{}}
	s := NewState()
	s.Cfg = &config.Config{RepoRoot: repoRoot, ScriptsDir: filepath.Join(repoRoot, "scripts"), PostsDir: filepath.Join(t.TempDir(), "posts")}
	if err := os.MkdirAll(s.Cfg.PostsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	s.Log, s.WorkDir, s.SourcePath = logx.New(), workDir, sourcePath
	s.TweetURL, s.PromptTicketID, s.OriginalDate, s.TranslatedDate = "https://example.com/source", "GP-PENDING", "2026-08-15", "2026-08-15"
	s.SourceLabel, s.AuthorHandle, s.GPProfile = "Example", "example", "fixture"
	s.GPProfileSHA256 = preservation.SHA256([]byte("fixture"))
	s.TranslatorDispatcher = gpFakeDispatcher(t, "fake-translator", llm.ModelGrok46, artifactJSON(t, translatorArtifact))
	return s, sourceBytes
}

func passReview(source, translation []byte) preservation.ReviewArtifact {
	return preservation.ReviewArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), Verdict: "PASS", Findings: []preservation.Finding{}}
}

func passVibe(source, translation []byte, projection preservation.Projection) preservation.GateEnvelope {
	return preservation.GateEnvelope{Version: preservation.ContractVersion, Gate: "vibe-scorer", SourceSHA256: preservation.SHA256(source), BodyProjectionSHA256: projection.SHA256, Verdict: "PASS", Findings: []preservation.Finding{}}
}

func emptyCommentary(source, translation []byte) preservation.CommentaryArtifact {
	return preservation.CommentaryArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), Candidates: []preservation.CommentaryCandidate{}}
}

func TestGPPreservationHappyPathSealsManifestAndRoleProvenance(t *testing.T) {
	ctx := context.Background()
	source := "# Source\n\nI took a break. I came back. I noticed my habits. I did not miss AI.\n"
	translation := "---\nticketId: GP-PENDING\ntitle: 我沒有想念 AI\noriginalDate: 2026-08-15\ntranslatedDate: 2026-08-15\nsource: Example\nsourceUrl: https://example.com/source\nsummary: 我休息後重新看見自己的 AI 習慣。\nlang: zh-tw\ntags: [ai]\n---\n\n# 來源\n\n我休息了一陣子。我回來了。我注意到自己的習慣。我沒有想念 AI。\n"
	s, sourceBytes := newGPState(t, source, translation)
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatal(err)
	}
	translated, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`originalDate: "2026-08-15"`, `translatedDate: "2026-08-15"`} {
		if !strings.Contains(string(translated), want) {
			t.Fatalf("source translation did not canonicalize %q:\n%s", want, translated)
		}
	}
	delete(s.RoleRuns, "translator")
	s.FromStepInt = StepSourceGate
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatalf("restore translator provenance: %v", err)
	}
	if _, ok := s.RoleRuns["translator"]; !ok {
		t.Fatal("translator provenance was not restored from durable artifact")
	}
	s.FromStepInt = 0
	translationBytes := translated
	projection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	s.SourceReviewerDispatcher = gpFakeDispatcher(t, "fake-source-reviewer", llm.ModelGPT56Sol, artifactJSON(t, passReview(sourceBytes, translationBytes)))
	s.VibeScorerDispatcher = gpFakeDispatcher(t, "fake-vibe", llm.ModelGrok45, artifactJSON(t, passVibe(sourceBytes, translationBytes, projection)))
	s.CommentaryDispatcher = gpFakeDispatcher(t, "fake-commentary", llm.ModelGrok46, artifactJSON(t, emptyCommentary(sourceBytes, translationBytes)))
	if err := s.PreserveGP(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.WorkDir, "final.mdx")); !os.IsNotExist(err) {
		t.Fatalf("source-preservation must not produce enrichment output: %v", err)
	}
	// Simulate a process interruption after the hard gates: the independent
	// enrichment stage must resume from the sealed workdir without rerunning
	// translation or source review.
	s.FromStepInt = StepEnrich
	if err := s.Enrich(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Credits(ctx); err != nil {
		t.Fatal(err)
	}
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	if err := s.ValidateGPPublishManifest(ctx, finalPath); err != nil {
		t.Fatal(err)
	}
	final, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"provider: \"fake-translator\"", "artifactSha256:", "verdict: \"PASS\"", "role: \"vibe-scorer\""} {
		if !strings.Contains(string(final), want) {
			t.Errorf("final provenance missing %q:\n%s", want, final)
		}
	}
	for _, role := range []string{"translator", "source-reviewer", "vibe-scorer", "commentary"} {
		if run := s.RoleRuns[role]; run.Provider == "" || run.Model == "" || run.Harness == "" || run.ArtifactSHA256 == "" || run.CompletedAt.IsZero() {
			t.Errorf("incomplete %s provenance: %#v", role, run)
		}
	}

	// A new process resuming at Ralph has no in-memory role runs. Every prior
	// role must be reconstructed from sealed workdir artifacts before Credits.
	s.RoleRuns = map[string]RoleRun{}
	s.FromStepInt = StepRalph
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatalf("recover source translation: %v", err)
	}
	if err := s.PreserveGP(ctx); err != nil {
		t.Fatalf("recover preservation gates: %v", err)
	}
	if err := s.Enrich(ctx); err != nil {
		t.Fatalf("recover enrichment: %v", err)
	}
	if err := s.Credits(ctx); err != nil {
		t.Fatalf("stamp credits after process recovery: %v", err)
	}
	for _, role := range []string{"translator", "source-reviewer", "vibe-scorer", "commentary"} {
		if _, ok := s.RoleRuns[role]; !ok {
			t.Errorf("full recovery did not restore %s provenance", role)
		}
	}
}

func TestSourceTranslateDispatchIncludesCanonicalTerminology(t *testing.T) {
	s, _ := newGPState(t, "# Source\n\nAn agent helps.\n", "---\nlang: zh-tw\n---\n\nAgent 會幫忙。\n")
	provider, ok := s.TranslatorDispatcher.Providers()[0].(*llm.FakeProvider)
	if !ok {
		t.Fatal("translator test dispatcher is not backed by FakeProvider")
	}

	if err := s.SourceTranslate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(provider.Called) != 1 {
		t.Fatalf("translator dispatch count = %d, want 1", len(provider.Called))
	}
	for _, want := range []string{`"term":"Agent"`, `"forbiddenZhTw":["代理人"]`, "使用標準用詞"} {
		if !strings.Contains(provider.Called[0].Prompt, want) {
			t.Errorf("dispatched translator prompt missing %q", want)
		}
	}
}

func TestSourceTranslateValidatesSlopCandidatesBeforeCanonicalizingDates(t *testing.T) {
	ctx := context.Background()
	source := []byte("# Source\n\nI took a break.\n")
	translation := "---\nticketId: GP-PENDING\ntitle: 休息\noriginalDate: 2026-08-15\ntranslatedDate: 2026-08-15\nsource: Example\nsourceUrl: https://example.com/source\nsummary: 我休息了一下。\nlang: zh-tw\ntags: [ai]\n---\n\n我休息了一陣子。\n\n我休息了一陣子。\n"
	s, _ := newGPState(t, string(source), translation)
	oldText := "我休息了一陣子。"
	start := strings.LastIndex(translation, oldText)
	finding := preservation.Finding{
		ID: "slop-1", IssueType: "approved_slop", SourceQuote: "I took a break.",
		SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256([]byte(translation)),
		StartByte: start, EndByte: start + len(oldText), OldText: oldText,
		OldTextSHA256: preservation.SHA256([]byte(oldText)), Approved: false,
	}
	artifact := preservation.SourceTranslationArtifact{
		Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source),
		TranslationMDX: translation, SlopCandidates: []preservation.Finding{finding},
	}
	s.TranslatorDispatcher = gpFakeDispatcher(t, "fake-translator", llm.ModelGrok46, artifactJSON(t, artifact))

	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatalf("valid pre-canonicalization slop candidate was rejected: %v", err)
	}
	translated, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(translated), `originalDate: "2026-08-15"`) || !strings.Contains(string(translated), `translatedDate: "2026-08-15"`) {
		t.Fatalf("dates were not canonicalized after candidate validation:\n%s", translated)
	}
	artifactData, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translate.json"))
	if err != nil {
		t.Fatal(err)
	}
	var persisted preservation.SourceTranslationArtifact
	if err := json.Unmarshal(artifactData, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.TranslationMDX != string(translated) {
		t.Fatal("durable artifact translation differs from canonical translation")
	}
	if err := preservation.ValidateFindings(source, []byte(persisted.TranslationMDX), persisted.SlopCandidates); err != nil {
		t.Fatalf("durable artifact contains stale slop candidates: %v", err)
	}
	s.FromStepInt = StepSourceGate
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatalf("consistent durable artifact did not recover: %v", err)
	}
	persisted.SlopCandidates[0].TranslationSHA256 = "stale"
	staleData, err := json.Marshal(persisted)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.WorkDir, "source-translate.json"), staleData, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.SourceTranslate(ctx); err == nil || !strings.Contains(err.Error(), "recovery slop candidates") {
		t.Fatalf("recovery accepted stale nested finding: %v", err)
	}
}

func TestGPCorrectionIsBoundedAndRerunsAllGates(t *testing.T) {
	ctx := context.Background()
	source := []byte("# Source\n\nI think this number may be correct. I checked it. My confidence is limited. I remain cautious.\n")
	translation := "---\nticketId: GP-PENDING\ntitle: 保留不確定性\noriginalDate: 2026-08-15\ntranslatedDate: 2026-08-15\nsource: Example\nsourceUrl: https://example.com/source\nsummary: 我對數字仍然保留不確定性。\nlang: zh-tw\ntags: [ai]\n---\n\n# 來源\n\n我覺得這個數字一定正確。我檢查過，但我的信心有限，我仍然很謹慎。\n"
	s, _ := newGPState(t, string(source), translation)
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatal(err)
	}
	translationBytes := []byte(translation)
	start := strings.Index(translation, "一定")
	finding := preservation.Finding{ID: "hedge", IssueType: "fidelity", SourceQuote: "may be correct", SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translationBytes), StartByte: len([]byte(translation[:start])), EndByte: len([]byte(translation[:start+len("一定")])), OldText: "一定", OldTextSHA256: preservation.SHA256([]byte("一定")), SuggestedReplacement: "可能", Approved: true}
	failReview := preservation.ReviewArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translationBytes), Verdict: "FAIL", Findings: []preservation.Finding{finding}}
	patch := preservation.PatchArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translationBytes), Patches: []preservation.Finding{finding}}
	patch.Patches[0].SuggestedReplacement = "可能"
	corrected := strings.Replace(translation, "一定", "可能", 1)
	correctedBytes := []byte(corrected)
	path := filepath.Join(s.WorkDir, "source-translation.mdx")
	projection1, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, correctedBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	projection2, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, translationBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	s.SourceReviewerDispatcher = gpFakeDispatcher(t, "fake-source-reviewer", llm.ModelGPT56Sol, artifactJSON(t, failReview), artifactJSON(t, passReview(source, correctedBytes)))
	s.VibeScorerDispatcher = gpFakeDispatcher(t, "fake-vibe", llm.ModelGrok45, artifactJSON(t, passVibe(source, translationBytes, projection1)), artifactJSON(t, passVibe(source, correctedBytes, projection2)))
	s.CorrectorDispatcher = gpFakeDispatcher(t, "fake-corrector", llm.ModelGPT56Sol, artifactJSON(t, patch))
	s.CommentaryDispatcher = gpFakeDispatcher(t, "fake-commentary", llm.ModelGrok46, artifactJSON(t, emptyCommentary(source, correctedBytes)))
	if err := s.PreserveGP(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != corrected {
		t.Fatalf("corrected body changed outside patch:\n%s", got)
	}
	if _, err := os.Stat(filepath.Join(s.WorkDir, "source-review-attempt-2.json")); err != nil {
		t.Fatal("source gate did not rerun")
	}
	if _, err := os.Stat(filepath.Join(s.WorkDir, "vibe-gate-attempt-2.json")); err != nil {
		t.Fatal("vibe gate did not rerun")
	}

	// Resume in a fresh process at source-preservation. The gates rerun, but
	// the prior bounded correction must be replay-verified and credited.
	s.RoleRuns = map[string]RoleRun{}
	s.FromStepInt = StepSourceGate
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatalf("recover translator before source-preservation: %v", err)
	}
	correctedProjection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	s.SourceReviewerDispatcher = gpFakeDispatcher(t, "recovery-source-reviewer", llm.ModelGPT56Sol, artifactJSON(t, passReview(source, correctedBytes)))
	s.VibeScorerDispatcher = gpFakeDispatcher(t, "recovery-vibe", llm.ModelGrok45, artifactJSON(t, passVibe(source, correctedBytes, correctedProjection)))
	if err := s.PreserveGP(ctx); err != nil {
		t.Fatalf("recover corrected source-preservation: %v", err)
	}
	if _, ok := s.RoleRuns["corrector"]; !ok {
		t.Fatal("corrector provenance was not restored after replay verification")
	}
	s.FromStepInt = StepEnrich
	s.CommentaryDispatcher = gpFakeDispatcher(t, "recovery-commentary", llm.ModelGrok46, artifactJSON(t, emptyCommentary(source, correctedBytes)))
	if err := s.Enrich(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Credits(ctx); err != nil {
		t.Fatal(err)
	}
	final, err := os.ReadFile(filepath.Join(s.WorkDir, "final.mdx"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(final), `role: "corrector"`) {
		t.Fatalf("recovered credits omitted corrector provenance:\n%s", final)
	}

	var stale preservation.PatchArtifact
	correctorPath := filepath.Join(s.WorkDir, "corrector.json")
	data, err := os.ReadFile(correctorPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := preservation.DecodeStrict(data, &stale); err != nil {
		t.Fatal(err)
	}
	stale.ResultTranslationSHA256 = strings.Repeat("0", 64)
	if err := preservation.WriteJSON(correctorPath, stale); err != nil {
		t.Fatal(err)
	}
	delete(s.RoleRuns, "corrector")
	if err := s.restoreOptionalCorrectorRun(); err == nil {
		t.Fatal("stale corrector result hash must not be credited")
	}
}

func TestGPNaturalCalibrationFindingCanBeCorrectedBeforeDeterministicRecheck(t *testing.T) {
	ctx := context.Background()
	source := []byte("# Source\n\nI keep scrolling an algorithmic feed. I notice my habit. I want to stop. My attention matters.\n")
	translation := "---\nticketId: GP-PENDING\ntitle: 停下來\noriginalDate: 2026-08-15\ntranslatedDate: 2026-08-15\nsource: Example\nsourceUrl: https://example.com/source\nsummary: 我想停止無止境滑動。\nlang: zh-tw\ntags: [ai]\n---\n\n# 來源\n\n我一直滑演算法動態。我注意到自己的習慣。我想停下來。我的注意力很重要。\n"
	s, _ := newGPState(t, string(source), translation)
	if err := s.SourceTranslate(ctx); err != nil {
		t.Fatal(err)
	}
	translationBytes := []byte(translation)
	start := strings.Index(translation, "演算法動態")
	finding := preservation.Finding{ID: "natural-feed", IssueType: "natural_zh_tw", SourceQuote: "", SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translationBytes), StartByte: len([]byte(translation[:start])), EndByte: len([]byte(translation[:start+len("演算法動態")])), OldText: "演算法動態", OldTextSHA256: preservation.SHA256([]byte("演算法動態")), SuggestedReplacement: "推薦動態", Approved: true}
	failVibe := preservation.GateEnvelope{Version: preservation.ContractVersion, Gate: "vibe-scorer", SourceSHA256: preservation.SHA256(source), Verdict: "FAIL", Findings: []preservation.Finding{finding}}
	patch := preservation.PatchArtifact{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translationBytes), Patches: []preservation.Finding{finding}}
	corrected := strings.Replace(translation, "演算法動態", "推薦動態", 1)
	correctedBytes := []byte(corrected)
	path := filepath.Join(s.WorkDir, "source-translation.mdx")
	projection1, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	failVibe.BodyProjectionSHA256 = projection1.SHA256
	if err := os.WriteFile(path, correctedBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	projection2, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, translationBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	s.SourceReviewerDispatcher = gpFakeDispatcher(t, "fake-source-reviewer", llm.ModelGPT56Sol, artifactJSON(t, passReview(source, translationBytes)), artifactJSON(t, passReview(source, correctedBytes)))
	s.VibeScorerDispatcher = gpFakeDispatcher(t, "fake-vibe", llm.ModelGrok45, artifactJSON(t, failVibe), artifactJSON(t, passVibe(source, correctedBytes, projection2)))
	s.CorrectorDispatcher = gpFakeDispatcher(t, "fake-corrector", llm.ModelGPT56Sol, artifactJSON(t, patch))
	if err := s.PreserveGP(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != corrected {
		t.Fatalf("natural-language correction did not stay bounded:\n%s", got)
	}
	if findings := preservation.DeterministicNaturalFindings(source, got); len(findings) != 0 {
		t.Fatalf("corrected translation still fails deterministic natural gate: %v", findings)
	}
}

func TestGPRecoveryAndDeployRejectMissingOrStaleManifest(t *testing.T) {
	ctx := context.Background()
	source := []byte("source")
	body := []byte("---\ntitle: T\n---\n\nbody\n")
	s := NewState()
	s.Cfg = &config.Config{RepoRoot: findRepoRoot()}
	s.Log, s.WorkDir = logx.New(), t.TempDir()
	s.GPProfile, s.GPProfileSHA256 = "fixture", preservation.SHA256([]byte("fixture"))
	if err := os.WriteFile(filepath.Join(s.WorkDir, "source-tweet.md"), source, 0o644); err != nil {
		t.Fatal(err)
	}
	bodyPath := filepath.Join(s.WorkDir, "source-translation.mdx")
	if err := os.WriteFile(bodyPath, body, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateGPPublishManifest(ctx, bodyPath); err == nil {
		t.Fatal("missing manifest must fail")
	}
	projection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, bodyPath)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	gate := func(name string) preservation.GateEnvelope {
		return preservation.GateEnvelope{Version: preservation.ContractVersion, Gate: name, SourceSHA256: preservation.SHA256(source), BodyProjectionSHA256: projection.SHA256, Verdict: "PASS", Provenance: preservation.Provenance{Role: name, Provider: "fixture", Model: name, Harness: "test", CompletedAt: now}}
	}
	manifest := preservation.PublishManifest{Version: preservation.ContractVersion, ProfileSHA256: s.GPProfileSHA256, SourceSHA256: preservation.SHA256(source), BodyProjectionSHA256: projection.SHA256, Verdict: "PASS", Gates: []preservation.GateEnvelope{gate("source-reviewer"), gate("vibe-scorer")}, CompletedAt: now}
	if err := preservation.WriteJSON(filepath.Join(s.WorkDir, "gp-publish-gate.json"), manifest); err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateGPPublishManifest(ctx, bodyPath); err != nil {
		t.Fatal(err)
	}
	s.GPProfileSHA256 = preservation.SHA256([]byte("changed-profile"))
	if err := s.ValidateGPPublishManifest(ctx, bodyPath); err == nil {
		t.Fatal("manifest from a different runtime profile must fail")
	}
	s.GPProfileSHA256 = preservation.SHA256([]byte("fixture"))
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	if err := os.WriteFile(finalPath, body, 0o644); err != nil {
		t.Fatal(err)
	}
	commentary := preservation.CommentaryArtifact{
		Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(body), Candidates: []preservation.CommentaryCandidate{},
		Provenance: preservation.Provenance{Role: "commentary", Provider: "fixture", Model: "commentary", Harness: "test", CompletedAt: now},
	}
	if err := preservation.WriteJSON(filepath.Join(s.WorkDir, "commentary-candidates.json"), commentary); err != nil {
		t.Fatal(err)
	}
	s.FromStepInt = StepRalph
	if err := s.Enrich(ctx); err != nil {
		t.Fatalf("post-enrichment recovery rejected fresh final: %v", err)
	}
	gotFinal, err := os.ReadFile(finalPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotFinal) != string(body) {
		t.Fatalf("recovery silently replaced final enrichment artifact:\n%s", gotFinal)
	}
	for _, role := range []string{"source-reviewer", "vibe-scorer", "commentary"} {
		if _, ok := s.RoleRuns[role]; !ok {
			t.Errorf("recovery did not restore %s provenance", role)
		}
	}
	if err := os.WriteFile(bodyPath, append(body, []byte("mutated\n")...), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := s.ValidateGPPublishManifest(ctx, bodyPath); err == nil {
		t.Fatal("stale body verdict must fail")
	}
}

func TestGPFileRecoveryCannotReconstructFrozenTranslationFromEnrichedPost(t *testing.T) {
	root := t.TempDir()
	postsDir := filepath.Join(root, "posts")
	workDir := filepath.Join(root, "work")
	for _, dir := range []string{postsDir, workDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	filename := "gp-1-enriched.mdx"
	enriched := "---\ntitle: Enriched\n---\n\n原文。\n\n<MoguNote>\n補充。\n</MoguNote>\n"
	if err := os.WriteFile(filepath.Join(postsDir, filename), []byte(enriched), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewState()
	s.Cfg = &config.Config{RepoRoot: root, PostsDir: postsDir}
	s.Log, s.WorkDir, s.ExistingFile, s.FromStepInt = logx.New(), workDir, filename, StepSourceGate
	if err := s.SourceTranslate(context.Background()); err == nil || !strings.Contains(err.Error(), "original frozen source-translation.mdx") {
		t.Fatalf("unsafe file-only recovery error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "source-translation.mdx")); !os.IsNotExist(err) {
		t.Fatalf("enriched post was copied into frozen translation artifact: %v", err)
	}
}

func TestLegacyShadowDeployAlwaysSkipsMutations(t *testing.T) {
	s := NewState()
	s.Log = logx.New()
	s.LegacyShadow = true
	if err := s.Deploy(context.Background()); err != nil {
		t.Fatalf("comparison-only legacy shadow should skip deploy before reading config: %v", err)
	}
}

func TestGPGenericTribunalFailureIsNonMutatingCalibrationEvidence(t *testing.T) {
	tmp := t.TempDir()
	scriptsDir := filepath.Join(tmp, "scripts")
	postsDir := filepath.Join(tmp, "posts")
	workDir := filepath.Join(tmp, "work")
	for _, dir := range []string{scriptsDir, postsDir, workDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(scriptsDir, "tribunal.sh"), []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	final := []byte("---\ntitle: Faithful\n---\n\nsource-aligned body\n")
	if err := os.WriteFile(filepath.Join(workDir, "final.mdx"), final, 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewState()
	s.Cfg = &config.Config{RepoRoot: tmp, ScriptsDir: scriptsDir, PostsDir: postsDir}
	s.Log, s.WorkDir, s.Prefix, s.PromptTicketID = logx.New(), workDir, "GP", "GP-PENDING"
	s.AuthorHandle = "author"
	if err := s.Ralph(context.Background()); err != nil {
		t.Fatalf("generic Tribunal score must not override passed GP source gates: %v", err)
	}
	if s.RalphPassed {
		t.Fatal("fixture Tribunal should fail")
	}
	got, err := os.ReadFile(filepath.Join(postsDir, s.ActiveFilename))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(final) {
		t.Fatalf("GP Tribunal failure mutated the source-aligned body:\n%s", got)
	}
}
