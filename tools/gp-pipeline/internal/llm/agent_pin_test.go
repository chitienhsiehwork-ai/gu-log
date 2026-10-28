package llm

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var concreteClaudePin = regexp.MustCompile(`^claude-[A-Za-z0-9._-]+(\[[A-Za-z0-9]+\])?$`)

// agentModelPin reads the `model:` value of a .claude/agents/*.md frontmatter
// block. It accepts only a concrete Claude build id, never a floating alias.
func agentModelPin(repoRoot, relPath string) (string, error) {
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
