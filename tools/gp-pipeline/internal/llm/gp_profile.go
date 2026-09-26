package llm

import (
	"crypto/sha256"
	"encoding/hex"
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

// GPProfileFingerprint binds durable publish evidence to the complete
// executable role profile. JSON map keys are emitted deterministically, so the
// same validated profile produces the same SHA-256 across processes.
func GPProfileFingerprint(profile GPProfile, promptContexts ...string) (string, error) {
	payload := any(profile)
	if len(promptContexts) > 0 {
		payload = struct {
			Profile        GPProfile `json:"profile"`
			PromptContexts []string  `json:"promptContexts"`
		}{Profile: profile, PromptContexts: promptContexts}
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("encode GP profile fingerprint: %w", err)
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

// gpProseRoles produce or rewrite GP body text, which Mogu writes only with the
// Claude model pin. The remaining GP roles are gates that judge that text and
// must stay on models independent of every writing role.
var gpProseRoles = map[RuntimeRole]bool{
	RuntimeTranslator: true, RuntimeCorrector: true, RuntimeCommentary: true,
}

type gpRoleContract struct {
	Prompt string
	Output string
}

var executableGPRoleContracts = map[RuntimeRole]gpRoleContract{
	RuntimeTranslator:     {Prompt: "source-translate-v2", Output: "source-translation-v1"},
	RuntimeSourceReviewer: {Prompt: "source-review-v2", Output: "gate-envelope-v1"},
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
		if gpProseRoles[role] {
			if cfg.Provider != "claude" {
				return nil, fmt.Errorf("GP role %s writes article text and must use provider claude (got %q)", role, cfg.Provider)
			}
			if cfg.Model != "" || cfg.ReasoningEffort != "" {
				return nil, fmt.Errorf("GP role %s must not declare model or reasoningEffort; it uses the Claude model pin", role)
			}
			// Bind the fingerprint to the pin actually executed, so a pin
			// change invalidates earlier publish manifests.
			cfg.Model = ClaudeOpusPinned
		} else if cfg.Provider != "codex" || cfg.Model == "" || cfg.ReasoningEffort == "" {
			return nil, fmt.Errorf("GP role %s has an incomplete provider/model/prompt/output contract", role)
		}
		if cfg.PromptContract == "" || cfg.OutputContract == "" {
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
		profile[role] = cfg
	}
	// Writing roles share the Claude pin; a gate that judges their text must
	// never run on that same model.
	for _, gate := range RequiredGPRoles {
		if gpProseRoles[gate] {
			continue
		}
		for _, writer := range RequiredGPRoles {
			if gpProseRoles[writer] && profile[gate].Model == profile[writer].Model {
				return nil, fmt.Errorf("GP gate role %s and article-writing role %s share model %q", gate, writer, profile[gate].Model)
			}
		}
	}
	return profile, nil
}
