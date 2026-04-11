package llm

import (
	"context"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// CodexProvider shells out to `codex exec --model <model> --full-auto -- <prompt>`.
// Codex does not read stdin, so the prompt is passed as the final positional
// argument. This matches how scripts/sp-pipeline.sh invokes Codex today.
//
// Known gotcha (documented in the bash version): codex occasionally appends
// log lines after the final JSON object when its output mode is JSON. For
// plain-text outputs — which is what sp-pipeline currently uses — this is not
// an issue. When Phase 2 adds the eval step (which does want JSON), the
// caller will need to run the output through a tolerant JSON extractor.
type CodexProvider struct {
	// ModelName is the value passed to --model ("gpt-5.4", "gpt-5.3-codex", …).
	ModelName string
}

// NewCodexGPT54 returns a CodexProvider wired to GPT-5.4.
func NewCodexGPT54() *CodexProvider { return &CodexProvider{ModelName: "gpt-5.4"} }

// NewCodexGPT53 returns a CodexProvider wired to GPT-5.3-Codex.
func NewCodexGPT53() *CodexProvider { return &CodexProvider{ModelName: "gpt-5.3-codex"} }

// Name implements Provider.
func (c *CodexProvider) Name() string { return "codex-" + c.modelName() }

// Model implements Provider.
func (c *CodexProvider) Model() ModelID {
	switch c.modelName() {
	case "gpt-5.3-codex":
		return ModelGPT53Codex
	default:
		return ModelGPT54
	}
}

// Available implements Provider.
func (c *CodexProvider) Available() bool {
	_, err := runner.LookPath("codex")
	return err == nil
}

// Run implements Provider.
func (c *CodexProvider) Run(ctx context.Context, prompt string) (string, error) {
	args := []string{
		"exec",
		"--model", c.modelName(),
		"--full-auto",
		"--",
		prompt,
	}
	res, err := runner.Run(ctx, "codex", args...)
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(res.Stdout), "\n"), nil
}

func (c *CodexProvider) modelName() string {
	if c.ModelName == "" {
		return "gpt-5.4"
	}
	return c.ModelName
}
