package llm

import (
	"context"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// GrokProvider runs the official Grok Build CLI in single-turn headless mode.
// Authentication stays in ~/.grok and is managed by the CLI itself.
type GrokProvider struct {
	ModelName       string
	ReasoningEffort string
}

func NewGrok(model, reasoningEffort string) *GrokProvider {
	return &GrokProvider{ModelName: model, ReasoningEffort: reasoningEffort}
}

func (g *GrokProvider) Name() string   { return "grok-build-" + g.modelName() }
func (g *GrokProvider) Model() ModelID { return ModelID(g.modelName()) }

func (g *GrokProvider) Available() bool {
	_, err := runner.LookPath("grok")
	return err == nil
}

func (g *GrokProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	args := []string{
		"--no-auto-update",
		"--model", g.modelName(),
		"--reasoning-effort", g.reasoningEffort(),
		"--sandbox", "workspace",
		"--permission-mode", "bypassPermissions",
		"--tools", "read_file,grep,list_dir,search_replace",
		"--no-plan",
		"--no-subagents",
		"--no-memory",
		"--disable-web-search",
		"--output-format", "plain",
		"--verbatim",
		"--single", prompt,
	}
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "grok",
		Args:    args,
		WorkDir: opts.WorkDir,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(res.Stdout), "\n"), nil
}

func (g *GrokProvider) modelName() string {
	if g.ModelName == "" {
		return string(ModelGrok45)
	}
	return g.ModelName
}

func (g *GrokProvider) reasoningEffort() string {
	if g.ReasoningEffort == "" {
		return "low"
	}
	return g.ReasoningEffort
}
