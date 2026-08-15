package llm

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

var RequiredGPRoles = []RuntimeRole{
	RuntimeTranslator, RuntimeSourceReviewer, RuntimeCorrector,
	RuntimeCommentary, RuntimeVibeScorer,
}

type GPRoleConfig struct {
	Provider        string `json:"provider"`
	Model           string `json:"model"`
	ReasoningEffort string `json:"reasoningEffort"`
	PromptContract  string `json:"promptContract"`
	OutputContract  string `json:"outputContract"`
}

type GPProfile map[RuntimeRole]GPRoleConfig

type gpRoleContract struct {
	Prompt string
	Output string
}

var executableGPRoleContracts = map[RuntimeRole]gpRoleContract{
	RuntimeTranslator:     {Prompt: "source-translate-v1", Output: "source-translation-v1"},
	RuntimeSourceReviewer: {Prompt: "source-review-v1", Output: "gate-envelope-v1"},
	RuntimeCorrector:      {Prompt: "bounded-correct-v1", Output: "bounded-patch-v1"},
	RuntimeCommentary:     {Prompt: "commentary-candidates-v1", Output: "enrichment-candidates-v1"},
	RuntimeVibeScorer:     {Prompt: "vibe-gate-v1", Output: "gate-envelope-v1"},
}

// LoadGPProfile validates the executable role contract before any GP text
// mutation starts. Only explicitly declared profiles are eligible to publish.
func LoadGPProfile(repoRoot, profileName string) (GPProfile, error) {
	if profileName == "" || profileName == "legacy" {
		return nil, fmt.Errorf("runtime profile %q does not declare the complete GP role contract", profileName)
	}
	data, err := os.ReadFile(filepath.Join(repoRoot, "config", "llm-pipeline.json"))
	if err != nil {
		return nil, fmt.Errorf("read GP profile: %w", err)
	}
	var raw struct {
		Profiles map[string]map[string]json.RawMessage `json:"profiles"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("parse GP profile: %w", err)
	}
	roles, ok := raw.Profiles[profileName]
	if !ok {
		return nil, fmt.Errorf("runtime profile %q is not configured", profileName)
	}
	profile := GPProfile{}
	seenModels := map[string]RuntimeRole{}
	seenPrompts := map[string]RuntimeRole{}
	for _, role := range RequiredGPRoles {
		payload, ok := roles[string(role)]
		if !ok {
			return nil, fmt.Errorf("GP profile %s missing role %s", profileName, role)
		}
		var cfg GPRoleConfig
		if err := json.Unmarshal(payload, &cfg); err != nil {
			return nil, fmt.Errorf("parse GP role %s: %w", role, err)
		}
		if (cfg.Provider != "codex" && cfg.Provider != "grok") || cfg.Model == "" || cfg.ReasoningEffort == "" || cfg.PromptContract == "" || cfg.OutputContract == "" {
			return nil, fmt.Errorf("GP role %s has an incomplete provider/model/prompt/output contract", role)
		}
		expected := executableGPRoleContracts[role]
		if cfg.PromptContract != expected.Prompt || cfg.OutputContract != expected.Output {
			return nil, fmt.Errorf("GP role %s config contract %q/%q does not match executable contract %q/%q", role, cfg.PromptContract, cfg.OutputContract, expected.Prompt, expected.Output)
		}
		if other, exists := seenPrompts[cfg.PromptContract]; exists {
			return nil, fmt.Errorf("GP roles %s and %s share prompt contract %q", other, role, cfg.PromptContract)
		}
		seenPrompts[cfg.PromptContract] = role
		if role == RuntimeTranslator || role == RuntimeCorrector || role == RuntimeVibeScorer {
			if other, exists := seenModels[cfg.Model]; exists {
				return nil, fmt.Errorf("GP text roles %s and %s share model %q", other, role, cfg.Model)
			}
			seenModels[cfg.Model] = role
		}
		profile[role] = cfg
	}
	return profile, nil
}
