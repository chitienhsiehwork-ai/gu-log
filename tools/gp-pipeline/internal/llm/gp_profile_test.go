package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadGPProfileRequiresCompleteDistinctTextRoles(t *testing.T) {
	profile, err := LoadGPProfile(repoRootForRoutingTest(t), "vm-codex")
	if err != nil {
		t.Fatal(err)
	}
	if len(profile) != len(RequiredGPRoles) {
		t.Fatalf("roles = %d", len(profile))
	}
	models := map[string]bool{}
	for _, role := range []RuntimeRole{RuntimeTranslator, RuntimeCorrector, RuntimeVibeScorer} {
		model := profile[role].Model
		if models[model] {
			t.Fatalf("text role model %q reused", model)
		}
		models[model] = true
	}
}

func TestLoadGPProfileRejectsLegacyMissingAndDuplicateRoles(t *testing.T) {
	if _, err := LoadGPProfile(repoRootForRoutingTest(t), "legacy"); err == nil {
		t.Fatal("legacy must not publish GP")
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{"profiles":{"test":{"translator":{"provider":"grok","model":"same","reasoningEffort":"low","promptContract":"source-translate-v1","outputContract":"source-translation-v1"},"sourceReviewer":{"provider":"codex","model":"review","reasoningEffort":"high","promptContract":"source-review-v1","outputContract":"gate-envelope-v1"},"corrector":{"provider":"codex","model":"same","reasoningEffort":"high","promptContract":"bounded-correct-v1","outputContract":"bounded-patch-v1"},"commentary":{"provider":"grok","model":"comment","reasoningEffort":"low","promptContract":"commentary-candidates-v1","outputContract":"enrichment-candidates-v1"},"vibeScorer":{"provider":"grok","model":"vibe","reasoningEffort":"low","promptContract":"vibe-gate-v1","outputContract":"gate-envelope-v1"}}}}`
	if err := os.WriteFile(filepath.Join(root, "config", "llm-pipeline.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "share model") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadGPProfileRejectsContractLabelDrift(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	config := `{"profiles":{"test":{"translator":{"provider":"grok","model":"translator","reasoningEffort":"low","promptContract":"stale-translate-v0","outputContract":"source-translation-v1"},"sourceReviewer":{"provider":"codex","model":"review","reasoningEffort":"high","promptContract":"source-review-v1","outputContract":"gate-envelope-v1"},"corrector":{"provider":"codex","model":"corrector","reasoningEffort":"high","promptContract":"bounded-correct-v1","outputContract":"bounded-patch-v1"},"commentary":{"provider":"grok","model":"comment","reasoningEffort":"low","promptContract":"commentary-candidates-v1","outputContract":"enrichment-candidates-v1"},"vibeScorer":{"provider":"codex","model":"vibe","reasoningEffort":"high","promptContract":"vibe-gate-v1","outputContract":"gate-envelope-v1"}}}}`
	if err := os.WriteFile(filepath.Join(root, "config", "llm-pipeline.json"), []byte(config), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := LoadGPProfile(root, "test")
	if err == nil || !strings.Contains(err.Error(), "does not match executable contract") {
		t.Fatalf("error = %v", err)
	}
}
