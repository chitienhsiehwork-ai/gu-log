package llm

import (
	"context"
	"os"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// ClaudeProvider shells out to `claude -p --model <model>` with
// `--permission-mode bypassPermissions` appended when not running as root.
// Claude Code refuses the permission-bypass flags under root/sudo; CCC
// sandboxes run as root, so we drop the flag there. -p is one-shot and does
// not invoke tools, so the permission mode is a no-op for this call site.
type ClaudeProvider struct {
	// ModelFlag is the value passed to --model. For Opus we pin the exact
	// build ("claude-opus-4-6[1m]") rather than the "opus" alias — see the
	// PIN note below. Sonnet/Haiku may use aliases since only the Opus
	// writing voice is taste-locked.
	ModelFlag string
}

// Pinned model IDs. SP writer uses Opus 4.6 because the maintainer has
// explicitly rejected Opus 4.7's writing voice and vibe-scoring calibration;
// "opus" alias auto-upgrades to the latest and would silently break that.
// DO NOT change ClaudeOpusPinned to the "opus" alias without owner sign-off.
// Keep this in sync with .claude/agents/vibe-opus-scorer.md and
// .claude/agents/tribunal-writer.md frontmatter.
const (
	ClaudeOpusPinned = "claude-opus-4-6[1m]"
)

// NewClaudeOpus returns a ClaudeProvider wired to the pinned Claude Opus
// build (see ClaudeOpusPinned).
func NewClaudeOpus() *ClaudeProvider { return &ClaudeProvider{ModelFlag: ClaudeOpusPinned} }

// NewClaudeSonnet returns a ClaudeProvider wired to Claude Sonnet.
func NewClaudeSonnet() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "sonnet"} }

// NewClaudeHaiku returns a ClaudeProvider wired to Claude Haiku.
func NewClaudeHaiku() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "haiku"} }

// Name implements Provider.
func (c *ClaudeProvider) Name() string { return "claude-" + c.modelFlag() }

// Model implements Provider.
func (c *ClaudeProvider) Model() ModelID {
	flag := c.modelFlag()
	switch flag {
	case "sonnet":
		return ModelClaudeSonnet
	case "haiku":
		return ModelClaudeHaiku
	case ClaudeOpusPinned, "opus":
		return ModelClaudeOpus
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
	}
	if os.Geteuid() != 0 {
		args = append(args, "--permission-mode", "bypassPermissions")
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
		return ClaudeOpusPinned
	}
	return c.ModelFlag
}
