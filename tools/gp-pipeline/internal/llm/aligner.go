package llm

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// AlignerAgentPath is the single SSOT of the source-distance aligner pin
// (openspec source-distance-stamp). gp-pipeline reads its `model:` line at run
// time and keeps no Go copy; scripts/tribunal-model-router.sh reads the same
// line for the VM profile.
const AlignerAgentPath = ".claude/agents/source-aligner.md"

// AlignmentJSONSchema constrains the aligner's structured output to
// {"alignments":[{"c":"C1","s":["S3"]}]}. Whether every guide sentence appears
// exactly once and every id exists is checked by scripts/source-distance.mjs.
const AlignmentJSONSchema = `{"type":"object","properties":{"alignments":{"type":"array","items":{"type":"object","properties":{"c":{"type":"string"},"s":{"type":"array","items":{"type":"string"}}},"required":["c","s"],"additionalProperties":false}}},"required":["alignments"],"additionalProperties":false}`

var (
	contextVariantSuffix = regexp.MustCompile(`\[[A-Za-z0-9]+\]$`)
	concreteClaudePin    = regexp.MustCompile(`^claude-[A-Za-z0-9._-]+(\[[A-Za-z0-9]+\])?$`)
)

// BaseModelID drops a context-variant suffix such as "[1m]", so two pins that
// differ only in context window compare equal.
func BaseModelID(model string) string {
	return contextVariantSuffix.ReplaceAllString(model, "")
}

// AgentModelPin reads the `model:` value of a .claude/agents/*.md frontmatter
// block. It accepts only a concrete Claude build id, never a floating alias.
func AgentModelPin(repoRoot, relPath string) (string, error) {
	path := filepath.Join(repoRoot, relPath)
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return "", fmt.Errorf("%s does not start with YAML frontmatter", relPath)
	}
	model := ""
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			if !concreteClaudePin.MatchString(model) {
				return "", fmt.Errorf("%s model %q is not a concrete Claude build id", relPath, model)
			}
			return model, nil
		}
		if value, ok := strings.CutPrefix(line, "model:"); ok {
			if model != "" {
				return "", fmt.Errorf("%s declares model twice", relPath)
			}
			model = strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return "", fmt.Errorf("%s frontmatter is not closed", relPath)
}

// AlignerPin returns the aligner pin and refuses one that equals the writer pin
// (context-variant suffixes ignored): the gate must never align with the model
// that wrote the draft. Callers check this before any aligner call.
func AlignerPin(repoRoot string) (string, error) {
	pin, err := AgentModelPin(repoRoot, AlignerAgentPath)
	if err != nil {
		return "", fmt.Errorf("source aligner pin: %w", err)
	}
	if BaseModelID(pin) == BaseModelID(ClaudeOpusPinned) {
		return "", fmt.Errorf("source aligner pin %q in %s must differ from the writer pin %q", pin, AlignerAgentPath, ClaudeOpusPinned)
	}
	return pin, nil
}

// AlignerProviders returns the aligner's provider: the VM runtime profile's
// Claude route when it is active, otherwise the same contained, tool-less
// Claude call built from the pin. Either way the call loads no host settings,
// permission rules or MCP servers and gets no tools, so an instruction hidden
// in the source text cannot act on anything.
func AlignerProviders(ctx context.Context, repoRoot string) ([]Provider, error) {
	providers, active, err := ProvidersForRuntime(ctx, repoRoot, RuntimeAligner)
	if err != nil {
		return nil, err
	}
	if active {
		return providers, nil
	}
	pin, err := AlignerPin(repoRoot)
	if err != nil {
		return nil, err
	}
	return []Provider{&ClaudeProvider{ModelFlag: pin, Contained: true, Tools: []string{}}}, nil
}

// AlignerQuotaPolicy stops on a Claude quota or temporary error instead of
// sleeping and retrying: the run resumes later with --from-step
// source-distance, and a failed call never counts as a rewrite round.
func AlignerQuotaPolicy() QuotaPolicy {
	policy := DefaultQuotaPolicy()
	policy.MaxWaits = 0
	return policy
}
