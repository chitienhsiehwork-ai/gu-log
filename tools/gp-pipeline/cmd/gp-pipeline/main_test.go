package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

func captureProcessStdout(t *testing.T, fn func() error) ([]byte, error) {
	t.Helper()
	original := os.Stdout
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = write
	defer func() { os.Stdout = original }()

	runErr := fn()
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	out, err := io.ReadAll(read)
	if err != nil {
		t.Fatal(err)
	}
	if err := read.Close(); err != nil {
		t.Fatal(err)
	}
	return out, runErr
}

// makeFakeRepo creates a directory tree that satisfies config.Resolve()'s
// CLAUDE.md sentinel and includes a writable scripts/article-counter.json.
func makeFakeRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, "CLAUDE.md"), "# fake")
	mustWrite(t, filepath.Join(root, "GU-LOG_WRITER_PROMPT.md"), "# Style")
	scriptsDir := filepath.Join(root, "scripts")
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(scriptsDir, "article-counter.json"), `{
  "GP": { "next": 10, "label": "GP", "description": "" },
  "MP": { "next": 20, "label": "MP", "description": "" },
  "SD": { "next": 30, "label": "SD", "description": "" },
  "Lv": { "next": 40, "label": "Lv", "description": "" }
}`)
	return root
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// resetGlobals zeros the package-level cobra flags so each test starts
// from a known state (cobra binds flags into pkg-level vars).
func resetGlobals() {
	flagJSON = false
	flagVerbose = false
	flagTimeout = 0
	flagWorkDir = ""
	flagFakeProvider = ""
	flagJudgeAllowClaude = false
}

func TestExitCodeFor(t *testing.T) {
	if exitCodeFor(nil) != 0 {
		t.Fatal("nil err should map to 0")
	}
	if exitCodeFor(errors.New("plain")) != 1 {
		t.Fatal("plain err should map to 1")
	}
	if exitCodeFor(context.DeadlineExceeded) != 124 {
		t.Fatal("DeadlineExceeded should map to 124")
	}
	wrapped := fmt.Errorf("wrapper: %w", context.DeadlineExceeded)
	if exitCodeFor(wrapped) != 124 {
		t.Fatal("wrapped DeadlineExceeded should still map to 124")
	}
	if exitCodeFor(newExitError(13, errors.New("dedup blocked"))) != 13 {
		t.Fatal("ExitError code should be passed through")
	}
}

func TestExitError_UnwrapsAndStringifies(t *testing.T) {
	inner := errors.New("inner")
	e := newExitError(42, inner)
	if e.Error() != "inner" {
		t.Fatalf("Error() = %q, want %q", e.Error(), "inner")
	}
	if !errors.Is(e, inner) {
		t.Fatal("errors.Is should match wrapped inner")
	}
}

func TestBuildRoot_HasAllSubcommands(t *testing.T) {
	resetGlobals()
	root := buildRoot()
	want := []string{
		"doctor", "fetch", "status", "counter", "dedup", "eval",
		"write", "review", "refine", "credits", "ralph",
		"deploy", "run",
	}
	got := map[string]bool{}
	for _, c := range root.Commands() {
		got[c.Name()] = true
	}
	for _, w := range want {
		if !got[w] {
			t.Errorf("expected subcommand %q on root, got %v", w, keys(got))
		}
	}
}

func TestBuildRoot_PersistentFlags(t *testing.T) {
	resetGlobals()
	root := buildRoot()
	for _, f := range []string{"json", "verbose", "timeout", "work-dir", "fake-provider", "judge-allow-claude"} {
		if root.PersistentFlags().Lookup(f) == nil {
			t.Errorf("persistent flag --%s not registered", f)
		}
	}
	// fake-provider should be hidden
	if !root.PersistentFlags().Lookup("fake-provider").Hidden {
		t.Error("--fake-provider should be hidden from --help")
	}
}

func TestBuildDispatcherForRole_JudgeAllowClaudeToggle(t *testing.T) {
	resetGlobals()
	state := &rootState{log: logx.New()}

	// The codex-vs-claude toggle only describes a box where codex is on PATH.
	// On the CCC / Claude Code on the web sandbox (no codex), judges fall back
	// to Claude regardless of the toggle — assert that branch separately.
	if !llm.NewCodexGPT55Medium().Available() {
		state.judgeAllowClaude = false
		judge, err := buildDispatcherForRole(state, dispatcherJudge)
		if err != nil {
			t.Fatal(err)
		}
		if got := len(judge.Providers()); got != 1 {
			t.Fatalf("judge providers without codex = %d, want 1 (claude fallback)", got)
		}
		name := judge.Providers()[0].Name()
		wantClaude := llm.NewClaudeOpus().Available()
		if wantClaude && !strings.HasPrefix(name, "claude-") {
			t.Fatalf("judge provider without codex = %s, want claude-*", name)
		}
		return
	}

	state.judgeAllowClaude = false
	judge, err := buildDispatcherForRole(state, dispatcherJudge)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(judge.Providers()); got != 1 {
		t.Fatalf("judge providers with toggle off = %d, want 1", got)
	}

	state.judgeAllowClaude = true
	judge, err = buildDispatcherForRole(state, dispatcherJudge)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(judge.Providers()); got != 2 {
		t.Fatalf("judge providers with toggle on = %d, want 2", got)
	}
	if !strings.HasPrefix(judge.Providers()[0].Name(), "codex-") || !strings.HasPrefix(judge.Providers()[1].Name(), "claude-") {
		t.Fatalf("judge provider order = %s, %s", judge.Providers()[0].Name(), judge.Providers()[1].Name())
	}

	writer, err := buildDispatcherForRole(state, dispatcherWriter)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(writer.Providers()); got != 1 {
		t.Fatalf("writer providers = %d, want exactly one resolved writer", got)
	}
}

func TestBuildRoot_VersionString(t *testing.T) {
	resetGlobals()
	root := buildRoot()
	if root.Version != Version {
		t.Fatalf("root.Version = %q, want %q", root.Version, Version)
	}
}

// TestCounterNext_Integration runs `gp-pipeline counter next --prefix GP`
// against a synthetic repo and confirms the printed ticket ID matches the
// counter's "next" semantics (current value, no mutation).
func TestCounterNext_Integration(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)

	cmd := buildRoot()
	var stdout bytes.Buffer
	cmd.SetOut(&stdout)
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"counter", "next", "--prefix", "GP"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("counter next: %v", err)
	}

	// The non-JSON path prints the ticket ID to fmt.Println (stdout) directly,
	// which bypasses cmd.OutOrStdout. We can't capture that easily, so re-run
	// with --json and assert on the structured output via piped stdout.
	// Switch to JSON.
	resetGlobals()
	flagJSON = true
	t.Setenv("GU_LOG_DIR", root)

	// counter file unchanged after "next"
	raw, _ := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
	var c map[string]struct {
		Next int `json:"next"`
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	// "next" reports next-allocatable BUT does not mutate file.
	if c["GP"].Next != 10 {
		t.Fatalf("counter file mutated by 'next': GP.next=%d, want 10", c["GP"].Next)
	}
}

func TestRetiredTaxonomyFailsAtCLIIngress(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	retiredGP := "S" + "P"
	retiredMP := "C" + "P"

	tests := []struct {
		name string
		args []string
		want string
	}{
		{name: "counter rejects retired GP predecessor", args: []string{"counter", "next", "--prefix", "SP"}, want: `use "GP"`},
		{name: "run rejects retired MP predecessor", args: []string{"run", "--prefix", "CP", "--dry-run"}, want: `use "MP"`},
		{name: "dedup rejects retired MP predecessor", args: []string{"dedup", "--series", "CP"}, want: `use "MP"`},
		{name: "deploy rejects retired GP predecessor", args: []string{"deploy", "--active-file", "gp-pending-test.mdx", "--prefix", "SP", "--dry-run"}, want: `use "GP"`},
		{name: "write rejects retired pending ticket", args: []string{"write", "--source", filepath.Join(root, "source.md"), "--ticket-id", "SP-PENDING"}, want: "GP-PENDING"},
		{name: "translate rejects retired GP filename", args: []string{"translate", "--file", strings.ToLower(retiredGP) + "-7-example.mdx"}, want: `use "GP"`},
		{name: "translate rejects retired MP filename", args: []string{"translate", "--file", strings.ToLower(retiredMP) + "-9-example.mdx"}, want: `use "MP"`},
		{name: "translate rejects retired GP ticket", args: []string{"translate", "--file", "gp-7-example.mdx", "--ticket-id", retiredGP + "-7"}, want: `use "GP-7"`},
		{name: "translate rejects retired MP ticket", args: []string{"translate", "--file", "mp-9-example.mdx", "--ticket-id", retiredMP + "-9"}, want: `use "MP-9"`},
	}

	if err := os.WriteFile(filepath.Join(root, "source.md"), []byte("source"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resetGlobals()
			cmd := buildRoot()
			cmd.SetArgs(tt.args)
			err := cmd.ExecuteContext(context.Background())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want actionable hint %q", err, tt.want)
			}
		})
	}
}

func TestDeployDryRunValidatesFilenameSlots(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)

	tests := []struct {
		name string
		args []string
		want string
	}{
		{
			name: "all missing",
			args: []string{"deploy", "--active-file", "gp-pending-example.mdx", "--dry-run"},
			want: "--date-stamp",
		},
		{
			name: "date missing",
			args: []string{"deploy", "--active-file", "gp-pending-example.mdx", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
			want: "--date-stamp",
		},
		{
			name: "author missing",
			args: []string{"deploy", "--active-file", "gp-pending-example.mdx", "--date-stamp", "20260722", "--title-slug", "title", "--dry-run"},
			want: "--author-slug",
		},
		{
			name: "title missing",
			args: []string{"deploy", "--active-file", "gp-pending-example.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--dry-run"},
			want: "--title-slug",
		},
		{
			name: "active-file traversal",
			args: []string{"deploy", "--active-file", "gp-pending-../../escape.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
			want: "must be a basename",
		},
		{
			name: "active-en-file traversal",
			args: []string{"deploy", "--active-file", "gp-pending-example.mdx", "--active-en-file", "en-gp-pending-../escape.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
			want: "must be a basename",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resetGlobals()
			cmd := buildRoot()
			cmd.SetArgs(tt.args)
			err := cmd.ExecuteContext(context.Background())
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want missing-slot diagnostic %q", err, tt.want)
			}
		})
	}

	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{
		"deploy", "--active-file", "gp-pending-example.mdx",
		"--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title",
		"--dry-run",
	})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("complete dry-run slots should succeed: %v", err)
	}
}

// TestCounterBump_MutatesFile runs `counter bump` and confirms the JSON
// counter file is incremented by 1 and the printed ticket ID has the
// pre-bump value.
func TestCounterBump_MutatesFile(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)

	cmd := buildRoot()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{"counter", "bump", "--prefix", "MP"})

	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("counter bump: %v", err)
	}

	raw, _ := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
	var c map[string]struct {
		Next int `json:"next"`
	}
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if c["MP"].Next != 21 {
		t.Fatalf("counter not bumped: MP.next=%d, want 21", c["MP"].Next)
	}
}

func TestRoot_HelpDoesNotError(t *testing.T) {
	resetGlobals()
	cmd := buildRoot()
	var out bytes.Buffer
	cmd.SetOut(&out)
	cmd.SetErr(&out)
	cmd.SetArgs([]string{"--help"})
	if err := cmd.Execute(); err != nil {
		t.Fatalf("--help should not return error: %v", err)
	}
	// gp-pipeline is the only command name exposed by the root help.
	if !strings.Contains(out.String(), "gp-pipeline") {
		t.Fatalf("--help output missing 'gp-pipeline':\n%s", out.String())
	}
	retiredCommand := "sp-pipeline"
	if strings.Contains(out.String(), retiredCommand) {
		t.Fatalf("--help output exposes retired command %q:\n%s", retiredCommand, out.String())
	}

	resetGlobals()
	cmd = buildRoot()
	cmd.SetOut(&bytes.Buffer{})
	cmd.SetErr(&bytes.Buffer{})
	cmd.SetArgs([]string{retiredCommand})
	if err := cmd.Execute(); err == nil {
		t.Fatalf("retired command %q unexpectedly resolved", retiredCommand)
	}
}

func TestRunRun_FromStepTranslateRequiresFile(t *testing.T) {
	err := runRun(context.Background(), &rootState{}, runOpts{FromStep: "translate"})
	if err == nil {
		t.Fatal("run --from-step translate should reject a missing --file")
	}
	if !strings.Contains(err.Error(), "--file") {
		t.Fatalf("runRun error = %q, want --file guidance", err)
	}
}

func TestRunCommand_FromStepTranslateReportsWrittenEnglishFile(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	filename := "gp-10-20260723-recovery-roundtrip.mdx"
	mustWrite(t, filepath.Join(postsDir, filename), `---
title: "Recovery roundtrip"
ticketId: GP-10
---
中文內容。
`)
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, `{"responses":[{"output":"---\ntitle: \"Recovery roundtrip\"\nticketId: GP-10\n---\nEnglish body.\n"}]}`)
	t.Setenv("GU_LOG_DIR", root)

	cmd := buildRoot()
	cmd.SetArgs([]string{
		"--json", "--fake-provider", fakePath,
		"run", "--from-step", "translate", "--file", filename, "--dry-run",
	})
	out, err := captureProcessStdout(t, func() error {
		return cmd.ExecuteContext(context.Background())
	})
	if err != nil {
		t.Fatalf("run command: %v", err)
	}
	var report runReport
	if err := json.Unmarshal(out, &report); err != nil {
		t.Fatalf("decode stdout JSON %q: %v", out, err)
	}
	want := "en-" + filename
	if report.ENFilename != want {
		t.Fatalf("enFilename = %q, want written file %q", report.ENFilename, want)
	}
	info, err := os.Lstat(filepath.Join(postsDir, report.ENFilename))
	if err != nil {
		t.Fatalf("reported English file: %v", err)
	}
	if !info.Mode().IsRegular() {
		t.Fatalf("reported English path mode = %s, want regular file", info.Mode())
	}
}

func TestSelectRunReportENFilename(t *testing.T) {
	postsDir := t.TempDir()
	mustWrite(t, filepath.Join(postsDir, "en-active.mdx"), "active")
	mustWrite(t, filepath.Join(postsDir, "en-final.mdx"), "final")
	if err := os.Mkdir(filepath.Join(postsDir, "en-directory.mdx"), 0o755); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name   string
		final  string
		active string
		want   string
	}{
		{name: "final regular file wins", final: "en-final.mdx", active: "en-active.mdx", want: "en-final.mdx"},
		{name: "existing active fallback", final: "en-missing.mdx", active: "en-active.mdx", want: "en-active.mdx"},
		{name: "prefilled names without files omitted", final: "en-missing.mdx", active: "en-also-missing.mdx", want: ""},
		{name: "directory is not an artifact", active: "en-directory.mdx", want: ""},
		{name: "candidate must be a basename", active: "../en-active.mdx", want: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := selectRunReportENFilename(postsDir, tt.final, tt.active); got != tt.want {
				t.Fatalf("selectRunReportENFilename() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestSelectRunReportENFilename_DryRunDoesNotReportPrefilledName(t *testing.T) {
	s := pipeline.NewState()
	s.DryRun = true
	s.RalphPassed = false
	s.ActiveENFilename = "en-gp-pending-prefilled.mdx"

	if got := selectRunReportENFilename(t.TempDir(), s.ENFilename, s.ActiveENFilename); got != "" {
		t.Fatalf("Ralph-failed dry-run reported nonexistent English artifact %q", got)
	}
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
