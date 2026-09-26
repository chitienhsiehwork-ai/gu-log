package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

// ClaudeProvider shells out to `claude -p --model <model>`. Mogu writes and
// rewrites gu-log articles only with the Claude model (owner decision
// 2026-09-26, openspec claude-prose-writing-runtime), so this is the only
// provider for article-writing steps; it is also an explicit judge fallback.
//
// Permission modes:
//
//   - Contained (runtime-profile routes such as the Tribunal VM) → never
//     bypassPermissions. Only the built-in tools listed in Tools exist for the
//     session (none when empty), read-only tools are pre-approved everywhere,
//     and edits are auto-accepted only inside the working directory, so a
//     prompt-injected source cannot run commands or write outside the step's
//     work dir.
//   - Non-root legacy callers (dev laptops) → bypassPermissions: the setting
//     the bash pipeline historically used.
//   - Root legacy callers (CCC sandboxes / Claude Code on the web) →
//     acceptEdits: claude refuses bypassPermissions and
//     --dangerously-skip-permissions under root, but acceptEdits is allowed and
//     auto-approves file writes/edits. Without this the write/refine steps
//     silently fail because the LLM's Write tool gets denied and it returns a
//     "please approve the permission" message instead of the MDX the parser
//     expects.
type ClaudeProvider struct {
	// ModelFlag is the value passed to --model. Article-writing steps use the
	// pinned Claude model; judge fallbacks use the floating "opus" alias.
	ModelFlag string
	// Contained selects the least-privilege invocation described above.
	Contained bool
	// Tools lists the built-in tools a Contained session may use. An empty
	// list disables every tool (JSON-only roles).
	Tools       []string
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
//
// The pin and the alias are independent on purpose: the pin holds this build
// when the alias moves on. TestClaudeWriterPinMatchesTribunalWriterFrontmatter
// fails when this constant and the tribunal-writer frontmatter disagree.
const (
	ClaudeOpusAlias  = "opus"
	ClaudeOpusPinned = "claude-opus-4-6"
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
// flag like "claude-opus-4-5" still reports "claude-opus" rather than the raw
// build id in dispatcher logs.
func (c *ClaudeProvider) Name() string { return string(claudeFamily(c.Model())) }

// Model implements Provider. It returns the *concrete* model identity: the
// runtime-reported build when known, otherwise the configured selector. A
// pinned flag like "claude-opus-4-5" is preserved verbatim so its version
// survives into DisplayName and the provenance stamp — collapsing it to the
// bare family constant here is exactly the bug that made pinned 4.5 writes get
// stamped "Opus 4.8" (the family → DisplayName fallback). Only the floating
// aliases ("opus"/"sonnet"/"haiku"), which carry no version, resolve to a
// family constant; the runtime JSON readback (modelUsage) then fills in the
// concrete build they actually ran.
func (c *ClaudeProvider) Model() ModelID {
	if c.actualModel != "" {
		return c.actualModel
	}
	flag := c.modelFlag()
	switch flag {
	case "sonnet":
		return ModelClaudeSonnet
	case "haiku":
		return ModelClaudeHaiku
	case ClaudeOpusAlias:
		return ModelClaudeOpus
	default:
		// Concrete pinned id (e.g. "claude-opus-4-5") — keep the version.
		return ModelID(flag)
	}
}

// claudeFamily normalizes any concrete Claude build id (claude-opus-4-5) or
// family constant down to the stable family label used for log/Name() display.
func claudeFamily(m ModelID) ModelID {
	s := string(m)
	switch {
	case strings.Contains(s, "sonnet"):
		return ModelClaudeSonnet
	case strings.Contains(s, "haiku"):
		return ModelClaudeHaiku
	case strings.Contains(s, "opus"):
		return ModelClaudeOpus
	default:
		return m
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
	if opts.JSONSchema != "" {
		args = append(args, "--json-schema", opts.JSONSchema)
	}
	// The permission flags end with variadic tool lists. The prompt goes on
	// stdin, so no trailing positional exists for them to swallow.
	args = append(args, c.permissionArgs()...)
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "claude",
		Args:    args,
		Stdin:   []byte(prompt),
		WorkDir: opts.WorkDir,
	})
	if err != nil {
		// With --output-format json the CLI reports model, login and usage-limit
		// failures on stdout rather than stderr. Carry that message so quota
		// classification and operators see the real cause.
		if res != nil {
			if parsed, ok := parseClaudeJSON(strings.TrimSpace(string(res.Stdout))); ok && parsed.Result != "" {
				return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(parsed.Result))
			}
		}
		return "", err
	}
	out := strings.TrimRight(string(res.Stdout), "\n")
	parsed, ok := parseClaudeJSON(out)
	if !ok {
		if opts.JSONSchema != "" {
			return "", errors.New("claude structured output: CLI did not return a JSON result")
		}
		return out, nil
	}
	// Prefer the top-level "model" field, but current Claude Code JSON omits it
	// and only reports the concrete build under modelUsage keys (e.g.
	// {"claude-opus-4-5": {...}}). Reading modelUsage is what lets a pinned
	// write report its real version instead of falling back to the generic
	// family → "Opus 4.8" stamp.
	if parsed.Model != "" {
		c.actualModel = ModelID(parsed.Model)
	} else if m := primaryModelUsage(parsed.ModelUsage); m != "" {
		c.actualModel = ModelID(m)
	}
	if parsed.IsError {
		return "", fmt.Errorf("claude reported an error: %s", strings.TrimSpace(parsed.Result))
	}
	if opts.JSONSchema != "" {
		structured := strings.TrimSpace(string(parsed.StructuredOutput))
		if structured == "" || structured == "null" {
			return "", errors.New("claude structured output: result has no structured_output")
		}
		return structured, nil
	}
	return strings.TrimRight(parsed.Result, "\n"), nil
}

// permissionArgs returns the non-interactive permission contract for this
// invocation; see the ClaudeProvider doc comment for the three modes.
func (c *ClaudeProvider) permissionArgs() []string {
	if c.Contained {
		args := []string{
			"--permission-mode", "acceptEdits",
			"--tools", strings.Join(c.Tools, ","),
		}
		if reads := claudeReadOnlyTools(c.Tools); len(reads) > 0 {
			args = append(args, "--allowed-tools", strings.Join(reads, ","))
		}
		return args
	}
	if os.Geteuid() != 0 {
		return []string{"--permission-mode", "bypassPermissions"}
	}
	// Root (CCC): bypassPermissions is rejected, so fall back to acceptEdits.
	// acceptEdits only auto-approves *edits*, so any stage that Reads a file
	// would hit a permission prompt and hang forever on the non-interactive
	// stdin. Pre-approve the read/search/compute/write tools a stage can use via
	// --allowed-tools — the explicit, narrower equivalent of the non-root
	// bypassPermissions "never prompt" behavior.
	return []string{
		"--permission-mode", "acceptEdits",
		"--allowed-tools", "Read,Grep,Glob,Bash,Write,Edit,MultiEdit",
	}
}

// claudeReadOnlyTools keeps the tools that only read. Pre-approving them lets a
// contained writer consult repo reference docs outside its work dir, while
// edits stay limited to the working directory through acceptEdits.
func claudeReadOnlyTools(tools []string) []string {
	var reads []string
	for _, tool := range tools {
		switch tool {
		case "Read", "Grep", "Glob":
			reads = append(reads, tool)
		}
	}
	return reads
}

// primaryModelUsage picks the concrete model that did the work from a Claude
// Code JSON `modelUsage` map. Single-model runs (the common case) return their
// only key; multi-model sessions return the key with the most output tokens so
// the stamp reflects the model that actually produced the body.
func primaryModelUsage(usage map[string]modelUsageEntry) string {
	best := ""
	bestTokens := -1
	for id, u := range usage {
		if u.OutputTokens > bestTokens {
			best = id
			bestTokens = u.OutputTokens
		}
	}
	return best
}

func (c *ClaudeProvider) modelFlag() string {
	if c.ModelFlag == "" {
		return ClaudeOpusAlias
	}
	return c.ModelFlag
}

type claudeJSONOutput struct {
	Result           string                     `json:"result"`
	Model            string                     `json:"model"`
	ModelUsage       map[string]modelUsageEntry `json:"modelUsage"`
	IsError          bool                       `json:"is_error"`
	StructuredOutput json.RawMessage            `json:"structured_output"`
}

type modelUsageEntry struct {
	OutputTokens int `json:"outputTokens"`
}

func parseClaudeJSON(out string) (claudeJSONOutput, bool) {
	var parsed claudeJSONOutput
	if err := json.Unmarshal([]byte(out), &parsed); err != nil {
		return parsed, false
	}
	return parsed, parsed.Result != "" || parsed.Model != "" || len(parsed.ModelUsage) > 0
}
