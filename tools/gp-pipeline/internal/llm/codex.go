package llm

import (
	"context"
	"os"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// CodexProvider shells out to `codex exec --model <model> -c model_reasoning_effort="<effort>" --sandbox danger-full-access --skip-git-repo-check -o <tmp> -- <prompt>`.
// Codex does not read stdin, so the prompt is passed as the final positional
// argument. We read `--output-last-message` instead of stdout because Codex
// may print session banners or skill warnings around the actual answer.
type CodexProvider struct {
	// ModelName is the value passed to --model ("gpt-5.5", "gpt-5.4", …).
	ModelName string
	// ReasoningEffort is passed via -c model_reasoning_effort=<value>. Defaults to medium.
	ReasoningEffort string
}

// NewCodexGPT55Low returns a CodexProvider wired to GPT-5.5 low.
func NewCodexGPT55Low() *CodexProvider {
	return &CodexProvider{ModelName: "gpt-5.5", ReasoningEffort: "low"}
}

// NewCodexGPT55Medium returns a CodexProvider wired to GPT-5.5 medium.
func NewCodexGPT55Medium() *CodexProvider {
	return &CodexProvider{ModelName: configuredCodexModel("gpt-5.5"), ReasoningEffort: "medium"}
}

func configuredCodexModel(fallback string) string {
	if model := strings.TrimSpace(os.Getenv("GP_CODEX_MODEL")); model != "" {
		return model
	}
	return fallback
}

// NewCodexGPT55 returns a CodexProvider wired to GPT-5.5.
func NewCodexGPT55() *CodexProvider { return NewCodexGPT55Medium() }

// NewCodexGPT54 returns a CodexProvider wired to GPT-5.4.
func NewCodexGPT54() *CodexProvider { return &CodexProvider{ModelName: "gpt-5.4"} }

// NewCodexGPT53 returns a CodexProvider wired to GPT-5.3-Codex.
func NewCodexGPT53() *CodexProvider { return &CodexProvider{ModelName: "gpt-5.3-codex"} }

// Name implements Provider.
func (c *CodexProvider) Name() string { return "codex-" + c.modelName() }

// Model implements Provider.
func (c *CodexProvider) Model() ModelID {
	return ModelID(c.modelName())
}

// ActualModel returns the explicit Codex model passed to the CLI. Codex does
// not use a moving alias here: gpt-5.5 is the current full recommended model.
func (c *CodexProvider) ActualModel() ModelID { return c.Model() }

// Available implements Provider.
func (c *CodexProvider) Available() bool {
	_, err := runner.LookPath("codex")
	return err == nil
}

// Run implements Provider.
func (c *CodexProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	outFile, err := os.CreateTemp("", "gp-pipeline-codex-last-*.txt")
	if err != nil {
		return "", err
	}
	outPath := outFile.Name()
	_ = outFile.Close()
	defer os.Remove(outPath)

	args := []string{
		"exec",
		"--model", c.modelName(),
		"-c", "model_reasoning_effort=\"" + c.reasoningEffort() + "\"",
		"--sandbox", "danger-full-access",
		"--skip-git-repo-check",
		"-o", outPath,
		"--",
		prompt,
	}
	_, err = runner.RunWithOptions(ctx, runner.Options{
		Name:    "codex",
		Args:    args,
		WorkDir: opts.WorkDir,
	})
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(outPath)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(data), "\n"), nil
}

func (c *CodexProvider) modelName() string {
	if c.ModelName == "" {
		return "gpt-5.5"
	}
	return c.ModelName
}

func (c *CodexProvider) reasoningEffort() string {
	if c.ReasoningEffort == "" {
		return "medium"
	}
	return c.ReasoningEffort
}
