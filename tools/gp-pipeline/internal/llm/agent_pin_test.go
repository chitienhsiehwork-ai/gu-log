package llm

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
)

var concreteClaudePin = regexp.MustCompile(`^claude-[A-Za-z0-9._-]+(\[[A-Za-z0-9]+\])?$`)

// agentModelPin reads the `model:` value of a .claude/agents/*.md frontmatter
// block. It accepts only a concrete Claude build id, never a floating alias.
func agentModelPin(repoRoot, relPath string) (string, error) {
	data, err := os.ReadFile(filepath.Join(repoRoot, relPath))
	if err != nil {
		return "", err
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return "", fmt.Errorf("%s: %w", relPath, err)
	}
	raw, _ := f.GetScalar("model")
	model := strings.Trim(raw, `"'`)
	if !concreteClaudePin.MatchString(model) {
		return "", fmt.Errorf("%s model %q is not a concrete Claude build id", relPath, model)
	}
	return model, nil
}
