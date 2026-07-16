package llm

import (
	"context"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// GeminiProvider shells out to the Gemini CLI. It is not in the maintained
// writer, judge, or doctor chains; the type remains for explicit experiments.
type GeminiProvider struct {
	// ModelName is passed as --model, defaults to "gemini-3.1-pro-preview".
	ModelName string
}

// NewGemini31Pro returns a GeminiProvider pointed at Gemini 3.1 Pro.
func NewGemini31Pro() *GeminiProvider {
	return &GeminiProvider{ModelName: "gemini-3.1-pro-preview"}
}

// Name implements Provider.
func (g *GeminiProvider) Name() string { return "gemini-" + g.modelName() }

// Model implements Provider.
func (g *GeminiProvider) Model() ModelID {
	return ModelGemini31Pro
}

// Available implements Provider. We look for `gemini` on PATH; the bash
// scripts sometimes call a runtime-local `gemini-safe-search.sh` wrapper, but
// that external wrapper is not a hard dependency of the Go binary itself.
func (g *GeminiProvider) Available() bool {
	_, err := runner.LookPath("gemini")
	return err == nil
}

// Run implements Provider.
func (g *GeminiProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	args := []string{
		"--model", g.modelName(),
		"--prompt", prompt,
	}
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "gemini",
		Args:    args,
		WorkDir: opts.WorkDir,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(res.Stdout), "\n"), nil
}

func (g *GeminiProvider) modelName() string {
	if g.ModelName == "" {
		return "gemini-3.1-pro-preview"
	}
	return g.ModelName
}
