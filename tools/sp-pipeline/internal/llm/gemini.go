package llm

import (
	"context"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// GeminiProvider shells out to the Gemini CLI. In sp-pipeline today this is
// used ONLY for the tribunal (AI judges) and the eval step's second opinion,
// never for article writing. The Go port preserves that policy: NewDefaults
// does not include Gemini in the writing chain, but constructing one
// directly for a tribunal-style invocation is fully supported.
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
// scripts sometimes call a `gemini-safe-search.sh` wrapper, but that lives
// outside the repo (in ~/clawd/scripts/) and is not a hard dependency of
// the Go binary itself.
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

// DefaultWritingChain returns the provider ordering used for article
// writing (write / review / refine steps). Claude Opus primary, Codex GPT-5.4
// fallback. Gemini is intentionally excluded — see package doc.
func DefaultWritingChain() []Provider {
	return []Provider{
		NewClaudeOpus(),
		NewCodexGPT54(),
	}
}

// DefaultProbeChain returns every provider the doctor subcommand should
// ping, including ones excluded from writing (Gemini). Order here is
// display order in the doctor report.
func DefaultProbeChain() []Provider {
	return []Provider{
		NewClaudeOpus(),
		NewCodexGPT54(),
		NewGemini31Pro(),
	}
}
