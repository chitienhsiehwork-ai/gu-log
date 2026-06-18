package llm

import (
	"context"
	"encoding/json"
	"os"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// ClaudeProvider shells out to `claude -p --model <model>`. It is retained as
// a historical compatibility wrapper only; the maintained SP pipeline runtime
// and doctor probe chain do not include Claude by default because the Clawd VM
// should not assume Anthropic env/login exists.
//
//   - Non-root (VPS Clawd, dev laptops) → bypassPermissions: the broadest
//     setting and the one the bash pipeline historically used.
//   - Root (CCC sandboxes / Claude Code on the web) → acceptEdits: claude
//     refuses bypassPermissions and --dangerously-skip-permissions under
//     root for security reasons, but acceptEdits is allowed and auto-
//     approves file writes/edits. Without this the eval/write/review/
//     refine steps silently fail because the LLM's Write tool gets denied
//     and it returns a "please approve the permission" message instead of
//     the JSON/MDX the parser expects.
type ClaudeProvider struct {
	// ModelFlag is the value passed to --model. Opus intentionally uses the
	// "opus" alias so the Mac writer follows Anthropic's current Opus line.
	ModelFlag   string
	actualModel ModelID
}

// ClaudeOpusAlias follows Anthropic's current Opus model for paths that should
// track Anthropic's latest Opus automatically (fact-check fallback judge,
// doctor probe). Runtime JSON metadata is used to stamp the concrete resolved
// version.
//
// ClaudeOpusPinned is the writer / refine voice. The maintainer has pinned it
// to a specific Opus build (not the floating alias) because Opus writing-voice
// calibration is version-sensitive — a silent Anthropic bump can change the LHY
// persona. Keep this in sync with the PIN comments in
// .claude/agents/tribunal-writer.md and .claude/agents/vibe-opus-scorer.md.
const (
	ClaudeOpusAlias  = "opus"
	ClaudeOpusPinned = "claude-opus-4-5"
)

// NewClaudeOpus returns a ClaudeProvider wired to the floating Opus alias. Use
// this for paths that should track Anthropic's latest Opus (fact-check
// fallback judge, doctor probe) — NOT for the writer, which is pinned.
func NewClaudeOpus() *ClaudeProvider { return &ClaudeProvider{ModelFlag: ClaudeOpusAlias} }

// NewClaudeOpusWriter returns a ClaudeProvider pinned to ClaudeOpusPinned for
// the article write / refine path, so the writing voice does not drift when
// Anthropic moves the floating Opus alias.
func NewClaudeOpusWriter() *ClaudeProvider { return &ClaudeProvider{ModelFlag: ClaudeOpusPinned} }

// NewClaudeSonnet returns a ClaudeProvider wired to Claude Sonnet.
func NewClaudeSonnet() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "sonnet"} }

// NewClaudeHaiku returns a ClaudeProvider wired to Claude Haiku.
func NewClaudeHaiku() *ClaudeProvider { return &ClaudeProvider{ModelFlag: "haiku"} }

// Name implements Provider. It returns a stable family label (claude-opus /
// claude-sonnet / claude-haiku) derived from the resolved Model(), so a pinned
// flag like "claude-opus-4-5" still reports "claude-opus" rather than
// "claude-claude-opus-4-5".
func (c *ClaudeProvider) Name() string { return string(c.Model()) }

// Model implements Provider.
func (c *ClaudeProvider) Model() ModelID {
	flag := c.modelFlag()
	switch flag {
	case "sonnet":
		return ModelClaudeSonnet
	case "haiku":
		return ModelClaudeHaiku
	case ClaudeOpusAlias:
		return ModelClaudeOpus
	default:
		return ModelClaudeOpus
	}
}

// ActualModel returns the concrete model reported by Claude Code JSON output
// when available. Before the first run, or when older CLIs omit the field, it
// falls back to the configured selector.
func (c *ClaudeProvider) ActualModel() ModelID {
	if c.actualModel != "" {
		return c.actualModel
	}
	return c.Model()
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
		"--output-format", "json",
	}
	if os.Geteuid() != 0 {
		args = append(args, "--permission-mode", "bypassPermissions")
	} else {
		// Root (CCC): bypassPermissions is rejected, so fall back to
		// acceptEdits. acceptEdits only auto-approves *edits*, so any stage
		// that Reads a file would hit a permission prompt and hang forever on
		// the non-interactive stdin. Pre-approve the read/search/compute/write
		// tools a stage can use via --allowed-tools — the explicit, narrower
		// equivalent of the non-root bypassPermissions "never prompt" behavior.
		// Prompt goes on stdin (below), so this trailing variadic flag has no
		// positional to swallow.
		args = append(args,
			"--permission-mode", "acceptEdits",
			"--allowed-tools", "Read,Grep,Glob,Bash,Write,Edit,MultiEdit",
		)
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
	out := strings.TrimRight(string(res.Stdout), "\n")
	if parsed, ok := parseClaudeJSON(out); ok {
		if parsed.Model != "" {
			c.actualModel = ModelID(parsed.Model)
		}
		return strings.TrimRight(parsed.Result, "\n"), nil
	}
	return out, nil
}

func (c *ClaudeProvider) modelFlag() string {
	if c.ModelFlag == "" {
		return ClaudeOpusAlias
	}
	return c.ModelFlag
}

type claudeJSONOutput struct {
	Result string `json:"result"`
	Model  string `json:"model"`
}

func parseClaudeJSON(out string) (claudeJSONOutput, bool) {
	var parsed claudeJSONOutput
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		return parsed, false
	}
	return parsed, parsed.Result != "" || parsed.Model != ""
}
