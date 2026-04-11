package llm

import (
	"context"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// ClaudeProvider shells out to `claude -p --model <model> --permission-mode
// bypassPermissions`, feeding prompt to stdin and reading the response from
// stdout. This matches how scripts/sp-pipeline.sh invokes Claude today.
type ClaudeProvider struct {
	// ModelFlag is the value passed to --model ("opus", "sonnet", "haiku").
	// Defaults to "opus".
	ModelFlag string
}

// NewClaudeOpus returns a ClaudeProvider wired to Claude Opus.
func NewClaudeOpus() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "opus"} }

// NewClaudeSonnet returns a ClaudeProvider wired to Claude Sonnet.
func NewClaudeSonnet() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "sonnet"} }

// NewClaudeHaiku returns a ClaudeProvider wired to Claude Haiku.
func NewClaudeHaiku() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "haiku"} }

// Name implements Provider.
func (c *ClaudeProvider) Name() string { return "claude-" + c.modelFlag() }

// Model implements Provider.
func (c *ClaudeProvider) Model() ModelID {
	switch c.modelFlag() {
	case "sonnet":
		return ModelClaudeSonnet
	case "haiku":
		return ModelClaudeHaiku
	default:
		return ModelClaudeOpus
	}
}

// Available implements Provider.
func (c *ClaudeProvider) Available() bool {
	_, err := runner.LookPath("claude")
	return err == nil
}

// Run implements Provider.
func (c *ClaudeProvider) Run(ctx context.Context, prompt string, opts RunOptions) (string, error) {
	args := []string{
		"-p",
		"--model", c.modelFlag(),
		"--permission-mode", "bypassPermissions",
	}
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "claude",
		Args:    args,
		Stdin:   []byte(prompt),
		WorkDir: opts.WorkDir,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimRight(string(res.Stdout), "\n"), nil
}

func (c *ClaudeProvider) modelFlag() string {
	if c.ModelFlag == "" {
		return "opus"
	}
	return c.ModelFlag
}
