package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestLoadGPProfileRoutesArticleWritingToClaudePin locks the owner decision:
// every GP role that writes article text uses the Claude model pin, and the
// gates that judge that text run on different models.
func TestLoadGPProfileRoutesArticleWritingToClaudePin(t *testing.T) {
	profile, err := LoadGPProfile(repoRootForRoutingTest(t), "vm-codex")
	if err != nil {
		t.Fatal(err)
	}
	if len(profile) != len(RequiredGPRoles) {
		t.Fatalf("roles = %d", len(profile))
	}
	for _, role := range []RuntimeRole{RuntimeTranslator, RuntimeCorrector, RuntimeCommentary} {
		cfg := profile[role]
		if cfg.Provider != "claude" || cfg.Model != ClaudeOpusPinned || cfg.ReasoningEffort != "" {
			t.Fatalf("%s = %+v, want provider claude on pin %q without effort", role, cfg, ClaudeOpusPinned)
		}
	}
	for _, gate := range []RuntimeRole{RuntimeSourceReviewer, RuntimeVibeScorer} {
		cfg := profile[gate]
		if cfg.Provider == "claude" || cfg.Model == ClaudeOpusPinned {
			t.Fatalf("gate %s = %+v, must stay independent of the Claude writing pin", gate, cfg)
		}
	}
}

func writeGPProfileFixture(t *testing.T, roles string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{"profiles":{"test":{` + roles + `}}}`
	if err := os.WriteFile(filepath.Join(root, "config", "llm-pipeline.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

const (
	fixtureTranslator     = `"translator":{"provider":"claude","promptContract":"source-translate-v2","outputContract":"source-translation-v1"}`
	fixtureSourceReviewer = `"sourceReviewer":{"provider":"codex","model":"review","reasoningEffort":"high","promptContract":"source-review-v2","outputContract":"gate-envelope-v1"}`
	fixtureCorrector      = `"corrector":{"provider":"claude","promptContract":"bounded-correct-v1","outputContract":"bounded-patch-v1"}`
	fixtureCommentary     = `"commentary":{"provider":"claude","promptContract":"commentary-candidates-v1","outputContract":"enrichment-candidates-v1"}`
	fixtureVibeScorer     = `"vibeScorer":{"provider":"codex","model":"vibe","reasoningEffort":"high","promptContract":"vibe-gate-v1","outputContract":"gate-envelope-v1"}`
)

func gpRolesFixture(overrides map[string]string) string {
	roles := map[string]string{
		"translator":     fixtureTranslator,
		"sourceReviewer": fixtureSourceReviewer,
		"corrector":      fixtureCorrector,
		"commentary":     fixtureCommentary,
		"vibeScorer":     fixtureVibeScorer,
	}
	for key, value := range overrides {
		roles[key] = value
	}
	parts := make([]string, 0, len(roles))
	for _, key := range []string{"translator", "sourceReviewer", "corrector", "commentary", "vibeScorer"} {
		if roles[key] != "" {
			parts = append(parts, roles[key])
		}
	}
	return strings.Join(parts, ",")
}

func TestLoadGPProfileAcceptsCompleteFixture(t *testing.T) {
	root := writeGPProfileFixture(t, gpRolesFixture(nil))
	if _, err := LoadGPProfile(root, "test"); err != nil {
		t.Fatalf("LoadGPProfile: %v", err)
	}
}

func TestLoadGPProfileRejectsLegacyAndMissingRoles(t *testing.T) {
	if _, err := LoadGPProfile(repoRootForRoutingTest(t), "legacy"); err == nil {
		t.Fatal("legacy must not publish GP")
	}
	root := writeGPProfileFixture(t, gpRolesFixture(map[string]string{"commentary": ""}))
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "missing role commentary") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadGPProfileRejectsNonClaudeArticleWritingRole(t *testing.T) {
	for role, cfg := range map[string]string{
		"translator": `"translator":{"provider":"grok","model":"grok-4.6","reasoningEffort":"low","promptContract":"source-translate-v2","outputContract":"source-translation-v1"}`,
		"corrector":  `"corrector":{"provider":"codex","model":"gpt-5.6-sol","reasoningEffort":"xhigh","promptContract":"bounded-correct-v1","outputContract":"bounded-patch-v1"}`,
		"commentary": `"commentary":{"provider":"grok","model":"grok-4.6","reasoningEffort":"low","promptContract":"commentary-candidates-v1","outputContract":"enrichment-candidates-v1"}`,
	} {
		root := writeGPProfileFixture(t, gpRolesFixture(map[string]string{role: cfg}))
		_, err := LoadGPProfile(root, "test")
		if err == nil || !strings.Contains(err.Error(), "must use provider claude") {
			t.Fatalf("%s error = %v, want a Claude-only rejection", role, err)
		}
	}
}

func TestLoadGPProfileRejectsDeclaredClaudeModel(t *testing.T) {
	root := writeGPProfileFixture(t, gpRolesFixture(map[string]string{
		"translator": `"translator":{"provider":"claude","model":"claude-opus-9","promptContract":"source-translate-v2","outputContract":"source-translation-v1"}`,
	}))
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "must not declare model") {
		t.Fatalf("error = %v, want the pin to stay out of config", err)
	}
}

func TestLoadGPProfileRejectsGateSharingWritingModel(t *testing.T) {
	root := writeGPProfileFixture(t, gpRolesFixture(map[string]string{
		"vibeScorer": `"vibeScorer":{"provider":"codex","model":"` + ClaudeOpusPinned + `","reasoningEffort":"high","promptContract":"vibe-gate-v1","outputContract":"gate-envelope-v1"}`,
	}))
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "share model") {
		t.Fatalf("error = %v, want the gate/writer model collision rejected", err)
	}
}

func TestLoadGPProfileRejectsContractLabelDrift(t *testing.T) {
	root := writeGPProfileFixture(t, gpRolesFixture(map[string]string{
		"translator": `"translator":{"provider":"claude","promptContract":"stale-translate-v0","outputContract":"source-translation-v1"}`,
	}))
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "does not match executable contract") {
		t.Fatalf("error = %v", err)
	}
}

func TestGPProfileFingerprintIncludesRuntimePromptContext(t *testing.T) {
	profile, err := LoadGPProfile(repoRootForRoutingTest(t), "vm-codex")
	if err != nil {
		t.Fatal(err)
	}
	before, err := GPProfileFingerprint(profile, `[{"term":"Agent","forbiddenZhTw":["舊譯"]}]`)
	if err != nil {
		t.Fatal(err)
	}
	after, err := GPProfileFingerprint(profile, `[{"term":"Agent","forbiddenZhTw":["代理人"]}]`)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("terminology context change did not invalidate GP profile fingerprint")
	}
}

// TestGPProfileFingerprintBindsClaudePin proves that a future owner pin change
// invalidates earlier publish manifests even though config never names it.
func TestGPProfileFingerprintBindsClaudePin(t *testing.T) {
	profile, err := LoadGPProfile(repoRootForRoutingTest(t), "vm-codex")
	if err != nil {
		t.Fatal(err)
	}
	before, err := GPProfileFingerprint(profile)
	if err != nil {
		t.Fatal(err)
	}
	moved := GPProfile{}
	for role, cfg := range profile {
		if gpProseRoles[role] {
			cfg.Model = "claude-opus-next-pin"
		}
		moved[role] = cfg
	}
	after, err := GPProfileFingerprint(moved)
	if err != nil {
		t.Fatal(err)
	}
	if before == after {
		t.Fatal("Claude pin change did not invalidate the GP profile fingerprint")
	}
}
