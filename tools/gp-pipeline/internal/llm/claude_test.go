package llm

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestClaudeWriterModelPreservesPinnedVersion locks the regression that made a
// pinned write get stamped with the floating alias's build instead of its own:
// Model() must keep the concrete pinned id, DisplayName must render it, and
// Name() must still collapse to the family label for logs.
//
// Model() identity is the load-bearing assertion here. The pin may differ
// from the floating alias, so both identities are checked independently.
func TestClaudeWriterModelPreservesPinnedVersion(t *testing.T) {
	w := NewClaudeOpusWriter()
	if got := w.Model(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("writer Model() = %q, want %q", got, ClaudeOpusPinned)
	}
	if got := DisplayName(w.Model()); got != "Opus 5.5" {
		t.Fatalf("writer DisplayName = %q, want %q", got, "Opus 5.5")
	}
	if got := w.Name(); got != string(ModelClaudeOpus) {
		t.Fatalf("writer Name() = %q, want %q", got, ModelClaudeOpus)
	}

	// The floating alias carries no version, so it resolves to the family
	// constant and DisplayName maps it to the current concrete Opus.
	a := NewClaudeOpus()
	if got := a.Model(); got != ModelClaudeOpus {
		t.Fatalf("alias Model() = %q, want %q", got, ModelClaudeOpus)
	}
	if got := DisplayName(a.Model()); got != "Opus 5" {
		t.Fatalf("alias DisplayName = %q, want %q", got, "Opus 5")
	}
}

// TestDisplayNameWholeNumberClaudeGeneration locks the Claude 5 naming shape:
// 5-generation ids carry no minor version, so "claude-opus-5" must render
// "Opus 5" (not the raw id) and still resolve to the Claude harness. The 4.x
// major-minor ids and the dated Haiku build must keep working unchanged.
func TestDisplayNameWholeNumberClaudeGeneration(t *testing.T) {
	cases := map[ModelID]string{
		"claude-opus-5":             "Opus 5",
		"claude-opus-5-5":           "Opus 5.5",
		"claude-opus-5-5[1m]":       "Opus 5.5",
		"claude-sonnet-5":           "Sonnet 5",
		"claude-opus-4-5":           "Opus 4.5",
		"claude-haiku-4-5-20251001": "Haiku 4.5",
		"anthropic/claude-opus-5":   "Opus 5",
		"claude-opus-5[1m]":         "Opus 5",
	}
	for id, want := range cases {
		if got := DisplayName(id); got != want {
			t.Errorf("DisplayName(%q) = %q, want %q", id, got, want)
		}
		if got := HarnessName(id); got != "Claude Code CLI" {
			t.Errorf("HarnessName(%q) = %q, want Claude Code CLI", id, got)
		}
	}
}

func TestPrimaryModelUsagePicksHighestOutput(t *testing.T) {
	single := map[string]modelUsageEntry{"claude-opus-4-5": {OutputTokens: 12}}
	if got := primaryModelUsage(single); got != "claude-opus-4-5" {
		t.Fatalf("single key primaryModelUsage = %q, want claude-opus-4-5", got)
	}
	multi := map[string]modelUsageEntry{
		"claude-haiku-4-5": {OutputTokens: 3},
		"claude-opus-4-5":  {OutputTokens: 99},
	}
	if got := primaryModelUsage(multi); got != "claude-opus-4-5" {
		t.Fatalf("multi key primaryModelUsage = %q, want claude-opus-4-5", got)
	}
	if got := primaryModelUsage(nil); got != "" {
		t.Fatalf("empty primaryModelUsage = %q, want empty", got)
	}
}

// TestClaudeRunReadsModelUsageWhenTopLevelModelMissing verifies the readback
// path: current Claude Code JSON omits the top-level "model" field and only
// reports the concrete build under modelUsage. Run() must recover it so the
// stamp matches what actually ran.
func TestClaudeRunReadsModelUsageWhenTopLevelModelMissing(t *testing.T) {
	binDir := t.TempDir()
	claudePath := filepath.Join(binDir, "claude")
	// Stub claude: echo JSON with NO top-level model, modelUsage keyed by the
	// --model value it was invoked with (mirrors real Claude Code output).
	script := `#!/usr/bin/env bash
set -euo pipefail
model=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--model" ]; then shift; model="$1"; fi
  shift
done
printf '{"result":"ok","modelUsage":{"%s":{"outputTokens":7}}}\n' "$model"
`
	if err := os.WriteFile(claudePath, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	w := NewClaudeOpusWriter()
	out, err := w.Run(context.Background(), "hi", RunOptions{WorkDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "ok" {
		t.Fatalf("Run output = %q, want ok", out)
	}
	if got := w.ActualModel(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("ActualModel after run = %q, want %q", got, ClaudeOpusPinned)
	}
	if got := DisplayName(w.ActualModel()); got != "Opus 5.5" {
		t.Fatalf("stamped DisplayName = %q, want Opus 5.5", got)
	}
}

// writeFakeClaude installs a claude stub that records argv (one per line) and
// stdin, then prints stdout and exits with rc. The capture paths are written
// into the stub: a contained call starts from a clean environment, so the stub
// cannot read them from the caller's.
func writeFakeClaude(t *testing.T, stdout string, rc int) (argsPath, stdinPath string) {
	t.Helper()
	binDir := t.TempDir()
	capture := t.TempDir()
	argsPath = filepath.Join(capture, "args")
	stdinPath = filepath.Join(capture, "stdin")
	script := "#!/usr/bin/env bash\n" +
		"printf '%s\\n' \"$@\" > " + strconv.Quote(argsPath) + "\n" +
		"cat > " + strconv.Quote(stdinPath) + "\n" +
		"cat <<'JSON'\n" + stdout + "\nJSON\n" +
		"exit " + strconv.Itoa(rc) + "\n"
	if err := os.WriteFile(filepath.Join(binDir, "claude"), []byte(script), 0o755); err != nil {
		t.Fatalf("write fake claude: %v", err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return argsPath, stdinPath
}

func readLines(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
}

func containsArg(args []string, want string) bool {
	for _, arg := range args {
		if arg == want {
			return true
		}
	}
	return false
}

// flagValue returns the argument following flag, and whether flag was present.
func flagValue(args []string, flag string) (string, bool) {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag {
			return args[i+1], true
		}
	}
	return "", false
}

// TestClaudeContainedWriterUsesLeastPrivilege locks the runtime-profile writer
// contract: file tools only, reads pre-approved, edits auto-accepted only in
// the work dir, no Bash and never bypassPermissions.
func TestClaudeContainedWriterUsesLeastPrivilege(t *testing.T) {
	argsPath, stdinPath := writeFakeClaude(t, `{"result":"drafted","modelUsage":{"`+ClaudeOpusPinned+`":{"outputTokens":3}}}`, 0)
	w := &ClaudeProvider{ModelFlag: ClaudeOpusPinned, Contained: true, Tools: []string{"Read", "Grep", "Glob", "Edit", "Write"}}
	out, err := w.Run(context.Background(), "write the draft", RunOptions{WorkDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "drafted" {
		t.Fatalf("output = %q, want drafted", out)
	}
	args := readLines(t, argsPath)
	for flag, want := range map[string]string{
		"--model":           ClaudeOpusPinned,
		"--permission-mode": "acceptEdits",
		"--tools":           "Read,Grep,Glob,Edit,Write",
		"--allowed-tools":   "Read,Grep,Glob",
		"--setting-sources": "",
	} {
		if got, ok := flagValue(args, flag); !ok || got != want {
			t.Fatalf("%s = %q (present=%v), want %q; args=%q", flag, got, ok, want, args)
		}
	}
	if !containsArg(args, "--strict-mcp-config") {
		t.Fatalf("contained args %q load host MCP servers", args)
	}
	joined := strings.Join(args, " ")
	for _, forbidden := range []string{"bypassPermissions", "--dangerously-skip-permissions", "Bash", "write the draft"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("contained args %q unexpectedly contain %q", joined, forbidden)
		}
	}
	if stdin := strings.Join(readLines(t, stdinPath), "\n"); stdin != "write the draft" {
		t.Fatalf("prompt stdin = %q, want the prompt", stdin)
	}
}

// TestClaudeContainedJSONRoleReturnsStructuredOutput covers the aligner's
// call shape: no tools at all, the schema on the CLI, and structured_output as
// the returned artifact instead of free text.
func TestClaudeContainedJSONRoleReturnsStructuredOutput(t *testing.T) {
	argsPath, _ := writeFakeClaude(t, `{"result":"prose that must be ignored","structured_output":{"alignments":[{"c":"C1","s":["S2"]}]},"modelUsage":{"claude-sonnet-5":{"outputTokens":3}}}`, 0)
	schema := `{"type":"object"}`
	p := &ClaudeProvider{ModelFlag: "claude-sonnet-5", Contained: true, Tools: []string{}}
	out, err := p.Run(context.Background(), "json only", RunOptions{WorkDir: t.TempDir(), JSONSchema: schema})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != `{"alignments":[{"c":"C1","s":["S2"]}]}` {
		t.Fatalf("structured output = %q", out)
	}
	args := readLines(t, argsPath)
	if got, ok := flagValue(args, "--json-schema"); !ok || got != schema {
		t.Fatalf("--json-schema = %q (present=%v), want %q", got, ok, schema)
	}
	if got, ok := flagValue(args, "--tools"); !ok || got != "" {
		t.Fatalf("--tools = %q (present=%v), want empty (no tools)", got, ok)
	}
	if _, ok := flagValue(args, "--allowed-tools"); ok {
		t.Fatalf("JSON role must not pre-approve tools: %q", args)
	}
	if got := p.ActualModel(); got != "claude-sonnet-5" {
		t.Fatalf("ActualModel = %q, want claude-sonnet-5", got)
	}
}

func TestClaudeStructuredOutputMissingFailsClosed(t *testing.T) {
	for name, stdout := range map[string]string{
		"no structured_output": `{"result":"{\"alignments\":[]}","modelUsage":{"claude-sonnet-5":{"outputTokens":3}}}`,
		"not JSON":             `plain text`,
	} {
		t.Run(name, func(t *testing.T) {
			writeFakeClaude(t, stdout, 0)
			p := &ClaudeProvider{ModelFlag: "claude-sonnet-5", Contained: true, Tools: []string{}}
			out, err := p.Run(context.Background(), "json only", RunOptions{WorkDir: t.TempDir(), JSONSchema: `{"type":"object"}`})
			if err == nil || !strings.Contains(err.Error(), "structured") {
				t.Fatalf("Run = (%q, %v), want a structured output error", out, err)
			}
		})
	}
}

func TestCodexRefusesStructuredOutput(t *testing.T) {
	p := &CodexProvider{ModelName: "gpt-5.5"}
	if _, err := p.Run(context.Background(), "json only", RunOptions{JSONSchema: `{"type":"object"}`}); err == nil {
		t.Fatal("Codex Run accepted a JSON schema it cannot enforce")
	}
}

// TestClaudeContainedToollessRoleGetsNoTools covers the fail-closed default for
// a contained role without tools: the session gets no tools, pre-approves
// nothing, and loads no host settings or MCP servers.
func TestClaudeContainedToollessRoleGetsNoTools(t *testing.T) {
	argsPath, _ := writeFakeClaude(t, `{"result":"ok","modelUsage":{"`+ClaudeOpusPinned+`":{"outputTokens":3}}}`, 0)
	p := &ClaudeProvider{ModelFlag: ClaudeOpusPinned, Contained: true, Tools: []string{}}
	out, err := p.Run(context.Background(), "no tools", RunOptions{WorkDir: t.TempDir()})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "ok" {
		t.Fatalf("output = %q, want the result text", out)
	}
	args := readLines(t, argsPath)
	if got, ok := flagValue(args, "--tools"); !ok || got != "" {
		t.Fatalf("--tools = %q (present=%v), want empty (no tools)", got, ok)
	}
	if _, ok := flagValue(args, "--allowed-tools"); ok {
		t.Fatalf("tool-less role must not pre-approve tools: %q", args)
	}
	if got, ok := flagValue(args, "--setting-sources"); !ok || got != "" || !containsArg(args, "--strict-mcp-config") {
		t.Fatalf("tool-less role args %q load host settings or MCP servers", args)
	}
	if got := p.ActualModel(); got != ModelID(ClaudeOpusPinned) {
		t.Fatalf("ActualModel = %q, want %q", got, ClaudeOpusPinned)
	}
}

// TestClaudeRunSurfacesCLIErrorResult keeps usage-limit text visible: with
// --output-format json the CLI reports it on stdout, not stderr.
func TestClaudeRunSurfacesCLIErrorResult(t *testing.T) {
	writeFakeClaude(t, `{"type":"result","is_error":true,"result":"You've hit your session limit · resets 5pm (UTC)"}`, 1)
	p := NewClaudeOpusWriter()
	_, err := p.Run(context.Background(), "hi", RunOptions{WorkDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "hit your session limit") {
		t.Fatalf("Run error = %v, want the CLI result message", err)
	}
	if !IsQuotaError(p.Name(), err) {
		t.Fatalf("IsQuotaError(%v) = false, want true", err)
	}
}

func TestClaudeRunRejectsErrorResultWithZeroExit(t *testing.T) {
	writeFakeClaude(t, `{"type":"result","is_error":true,"result":"There's an issue with the selected model"}`, 0)
	out, err := NewClaudeOpusWriter().Run(context.Background(), "hi", RunOptions{WorkDir: t.TempDir()})
	if err == nil || out != "" {
		t.Fatalf("Run = (%q, %v), want an error instead of error text as output", out, err)
	}
}

// TestClaudeRunRejectsErrorResultsCarryingOnlyErrors covers result objects the
// CLI flags is_error with an empty result and the cause only in errors[]: the
// provider must fail with that cause instead of returning the raw JSON (which
// write, translate and refine would otherwise save as the draft).
func TestClaudeRunRejectsErrorResultsCarryingOnlyErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		stdout string
		rc     int
	}{
		{"exit 0, error_during_execution", `{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["queryParams builder failed: boom"],"modelUsage":{}}`, 0},
		{"exit 0, success subtype with empty result", `{"type":"result","subtype":"success","is_error":true,"result":"","errors":["queryParams builder failed: boom"]}`, 0},
		{"exit 1, errors only", `{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["queryParams builder failed: boom"]}`, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writeFakeClaude(t, tc.stdout, tc.rc)
			for _, opts := range []RunOptions{
				{WorkDir: t.TempDir()},
				{WorkDir: t.TempDir(), JSONSchema: `{"type":"object"}`},
			} {
				p := &ClaudeProvider{ModelFlag: ClaudeOpusPinned, Contained: true, Tools: []string{}}
				out, err := p.Run(context.Background(), "hi", opts)
				if err == nil || out != "" {
					t.Fatalf("Run(schema=%t) = (%q, %v), want an error and no output", opts.JSONSchema != "", out, err)
				}
				if !strings.Contains(err.Error(), "queryParams builder failed: boom") {
					t.Fatalf("Run(schema=%t) error = %v, want the errors[] detail", opts.JSONSchema != "", err)
				}
			}
		})
	}
}

// TestClaudeContainedCallStartsFromCleanEnvironment keeps everything but the
// CLI's own needs out of runtime-profile Claude calls: API keys, a key handed
// over as a file descriptor, and anything else the host happens to export.
func TestClaudeContainedCallStartsFromCleanEnvironment(t *testing.T) {
	binDir := t.TempDir()
	envPath := filepath.Join(t.TempDir(), "env")
	script := "#!/bin/sh\n/usr/bin/env > \"" + envPath + "\"\ncat >/dev/null\nprintf '%s\\n' '{\"type\":\"result\",\"result\":\"ok\"}'\n"
	if err := os.WriteFile(filepath.Join(binDir, "claude"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	leaked := []string{"ANTHROPIC_API_KEY", "CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR", "GU_LOG_FIXTURE_UNRELATED"}
	for _, key := range leaked {
		t.Setenv(key, "fixture-secret")
	}
	t.Setenv("CLAUDE_CONFIG_DIR", "/fixture/claude-config")
	t.Setenv("TZ", "Asia/Taipei")
	p := &ClaudeProvider{ModelFlag: ClaudeOpusPinned, Contained: true, Tools: []string{}}
	if _, err := p.Run(context.Background(), "hi", RunOptions{WorkDir: t.TempDir()}); err != nil {
		t.Fatalf("Run: %v", err)
	}
	data, err := os.ReadFile(envPath)
	if err != nil {
		t.Fatal(err)
	}
	env := "\n" + string(data)
	for _, key := range leaked {
		if strings.Contains(env, "\n"+key+"=") {
			t.Fatalf("contained Claude call kept %s", key)
		}
	}
	for _, want := range []string{"HOME=" + os.Getenv("HOME"), "PATH=" + os.Getenv("PATH"), "CLAUDE_CONFIG_DIR=/fixture/claude-config", "TZ=Asia/Taipei"} {
		if !strings.Contains(env, "\n"+want+"\n") {
			t.Fatalf("contained Claude call lost %s", want)
		}
	}
}

// agentFrontmatterModel reads the `model:` value of a .claude/agents/<name>.md
// frontmatter block.
func agentFrontmatterModel(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(repoRootForRoutingTest(t), ".claude", "agents", name+".md")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s agent: %v", name, err)
	}
	lines := strings.Split(string(data), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		t.Fatalf("%s does not start with YAML frontmatter", path)
	}
	model := ""
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) == "---" {
			break
		}
		if value, ok := strings.CutPrefix(line, "model:"); ok {
			model = strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return model
}

// TestClaudeWriterPinMatchesTribunalWriterFrontmatter guards the two SSOTs of
// the Claude model pin. Runtime-profile routing reads the frontmatter through
// the shell router and refuses to dispatch when it disagrees with this
// constant, so a drift must fail here first.
func TestClaudeWriterPinMatchesTribunalWriterFrontmatter(t *testing.T) {
	if model := agentFrontmatterModel(t, "tribunal-writer"); model != ClaudeOpusPinned {
		t.Fatalf("tribunal-writer frontmatter model = %q, ClaudeOpusPinned = %q; update both pins together", model, ClaudeOpusPinned)
	}
}

// TestClaudeWriterPinMatchesVibeScorerFrontmatter locks the one-taste-loop
// rule: the owner moves the writer and the Vibe scorer to a new Opus
// generation together, so generating and grading share one taste.
func TestClaudeWriterPinMatchesVibeScorerFrontmatter(t *testing.T) {
	if model := agentFrontmatterModel(t, "vibe-opus-scorer"); model != ClaudeOpusPinned {
		t.Fatalf("vibe-opus-scorer frontmatter model = %q, ClaudeOpusPinned = %q; the writer and the Vibe scorer move together", model, ClaudeOpusPinned)
	}
}
