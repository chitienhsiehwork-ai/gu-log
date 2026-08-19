package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// GrokProvider runs the official Grok Build CLI in single-turn headless mode.
// Authentication stays in ~/.grok and is managed by the CLI itself.
type GrokProvider struct {
	RepoRoot        string
	ModelName       string
	ReasoningEffort string
}

func NewGrok(repoRoot, model, reasoningEffort string) *GrokProvider {
	return &GrokProvider{
		RepoRoot: repoRoot, ModelName: model, ReasoningEffort: reasoningEffort,
	}
}

func (g *GrokProvider) Name() string   { return "grok-build-" + g.modelName() }
func (g *GrokProvider) Model() ModelID { return ModelID(g.modelName()) }

func (g *GrokProvider) Available() bool {
	if g.RepoRoot == "" {
		return false
	}
	bridge := filepath.Join(g.RepoRoot, "scripts", "tribunal-grok-provider.sh")
	if info, err := os.Stat(bridge); err != nil || info.Mode()&0o111 == 0 {
		return false
	}
	for _, binary := range []string{"grok", "systemd-run", "timeout"} {
		if _, err := runner.LookPath(binary); err != nil {
			return false
		}
	}
	return true
}

func (g *GrokProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	workDir := opts.WorkDir
	if workDir == "" {
		var err error
		workDir, err = os.MkdirTemp("", "gp-grok-probe-")
		if err != nil {
			return "", err
		}
		defer os.RemoveAll(workDir)
	}
	bridge := filepath.Join(g.RepoRoot, "scripts", "tribunal-grok-provider.sh")
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name: bridge,
		Args: []string{
			workDir, g.modelName(), g.reasoningEffort(), "workspace",
		},
		Stdin:   []byte(prompt),
		WorkDir: workDir,
		Env: func() []string {
			if opts.JSONSchema == "" {
				return nil
			}
			return []string{"GP_GROK_JSON_SCHEMA_B64=" + base64.StdEncoding.EncodeToString([]byte(opts.JSONSchema))}
		}(),
	})
	if err != nil {
		return "", err
	}
	if opts.JSONSchema != "" {
		var envelope struct {
			StructuredOutput json.RawMessage `json:"structuredOutput"`
		}
		if err := json.Unmarshal(res.Stdout, &envelope); err != nil {
			return "", fmt.Errorf("grok structured-output envelope: %w", err)
		}
		if len(envelope.StructuredOutput) == 0 || string(envelope.StructuredOutput) == "null" {
			return "", fmt.Errorf("grok structured-output envelope missing structuredOutput")
		}
		return string(envelope.StructuredOutput), nil
	}
	return strings.TrimRight(string(res.Stdout), "\n"), nil
}

func (g *GrokProvider) modelName() string {
	if g.ModelName == "" {
		return string(ModelGrok46)
	}
	return g.ModelName
}

func (g *GrokProvider) reasoningEffort() string {
	if g.ReasoningEffort == "" {
		return "low"
	}
	return g.ReasoningEffort
}
