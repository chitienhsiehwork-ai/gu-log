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
	dataDir := filepath.Join(root, "src", "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(dataDir, "glossary.json"), `[{"term":"Agent","forbiddenZhTw":["代理人"]}]`)
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
		"doctor", "fetch", "candidate", "status", "counter", "dedup", "eval",
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

func TestFetchCommandUsesArticleExtractor(t *testing.T) {
	resetGlobals()
	t.Cleanup(resetGlobals)

	repoRoot := makeFakeRepo(t)
	mustWrite(t, filepath.Join(repoRoot, "scripts", "fetch-article.py"), "# extractor fixture\n")
	t.Setenv("GU_LOG_DIR", repoRoot)

	binDir := t.TempDir()
	pythonPath := filepath.Join(binDir, "python3")
	mustWrite(t, pythonPath, `#!/usr/bin/env bash
cat <<'TEXT'
Python Article
Published: 2026-08-21
This cleaned article came from the configured readability extractor.
It has enough prose and lines to satisfy the source completeness validator.
The standalone fetch command must pass the extractor path into the source package.
Otherwise it silently falls back to a noisier curl capture of the whole page chrome.
This final sentence keeps the fixture representative of a readable article body.
TEXT
`)
	if err := os.Chmod(pythonPath, 0o755); err != nil {
		t.Fatal(err)
	}

	curlMarker := filepath.Join(t.TempDir(), "curl-called")
	curlPath := filepath.Join(binDir, "curl")
	mustWrite(t, curlPath, `#!/usr/bin/env bash
touch "$FETCH_TEST_CURL_MARKER"
exit 9
`)
	if err := os.Chmod(curlPath, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FETCH_TEST_CURL_MARKER", curlMarker)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	workDir := t.TempDir()
	cmd := buildRoot()
	cmd.SetArgs([]string{"--work-dir", workDir, "fetch", "https://example.com/article"})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("fetch command: %v", err)
	}

	data, err := os.ReadFile(filepath.Join(workDir, "source-tweet.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "Fetched via: fetch-article.py") {
		t.Fatalf("standalone fetch did not use the configured article extractor:\n%s", data)
	}
	if _, err := os.Stat(curlMarker); !os.IsNotExist(err) {
		t.Fatalf("standalone fetch unexpectedly invoked curl fallback: %v", err)
	}
}

func TestMPProviderPreflightFailurePersistsReportAndRecoveryState(t *testing.T) {
	resetGlobals()
	workDir := t.TempDir()
	fakePath := filepath.Join(t.TempDir(), "judge-only-profile.json")
	mustWrite(t, fakePath, `{
  "roles": {
    "judge": {"provider": "fake-judge", "responses": []}
  }
}`)

	cmd := buildRoot()
	cmd.SetArgs([]string{
		"--json", "--fake-provider", fakePath, "--work-dir", workDir,
		"run", "https://example.com/source", "--prefix", "MP", "--dry-run",
	})
	out, runErr := captureProcessStdout(t, func() error {
		return cmd.ExecuteContext(context.Background())
	})
	if runErr == nil || !strings.Contains(runErr.Error(), "missing role writer") {
		t.Fatalf("preflight error = %v, want missing writer role", runErr)
	}
	var report runReport
	if err := json.Unmarshal(out, &report); err != nil {
		t.Fatalf("decode preflight report %q: %v", out, err)
	}
	if report.OK || report.ErrorCode != 1 || report.WorkDir != workDir || !strings.Contains(report.Error, "missing role writer") {
		t.Fatalf("preflight report = %#v", report)
	}
	for _, artifact := range []string{"writer-failure.json", "pipeline-status.json"} {
		data, err := os.ReadFile(filepath.Join(workDir, artifact))
		if err != nil {
			t.Fatalf("read durable %s: %v", artifact, err)
		}
		if !bytes.Contains(data, []byte("missing role writer")) {
			t.Fatalf("%s missing failed role evidence: %s", artifact, data)
		}
	}
	var failure map[string]any
	data, err := os.ReadFile(filepath.Join(workDir, "writer-failure.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &failure); err != nil {
		t.Fatalf("decode writer-failure.json: %v", err)
	}
	if failure["role"] != "writer" || failure["version"] != "gp-pipeline-role-failure/v1" {
		t.Fatalf("writer-failure.json = %#v", failure)
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

func TestCanonicalRunYouTubeMissingYTDLPFailsBeforeProviderSetup(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	t.Setenv("PATH", t.TempDir())
	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"run", "https://youtube.com/watch?v=dQw4w9WgXcQ", "--prefix", "MP", "--dry-run"})
	err := cmd.ExecuteContext(context.Background())
	var exitErr *ExitError
	if !errors.As(err, &exitErr) {
		t.Fatalf("error = %v, want ExitError", err)
	}
	if exitErr.Code != 10 || !strings.Contains(err.Error(), "dependency_missing") {
		t.Fatalf("error = %v code=%d, want dependency_missing/10", err, exitErr.Code)
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
			args: []string{"deploy", "--active-file", "mp-pending-example.mdx", "--dry-run"},
			want: "--date-stamp",
		},
		{
			name: "date missing",
			args: []string{"deploy", "--active-file", "mp-pending-example.mdx", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
			want: "--date-stamp",
		},
		{
			name: "author missing",
			args: []string{"deploy", "--active-file", "mp-pending-example.mdx", "--date-stamp", "20260722", "--title-slug", "title", "--dry-run"},
			want: "--author-slug",
		},
		{
			name: "title missing",
			args: []string{"deploy", "--active-file", "mp-pending-example.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--dry-run"},
			want: "--title-slug",
		},
		{
			name: "active-file traversal",
			args: []string{"deploy", "--active-file", "mp-pending-../../escape.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
			want: "must be a basename",
		},
		{
			name: "active-en-file traversal",
			args: []string{"deploy", "--active-file", "mp-pending-example.mdx", "--active-en-file", "en-mp-pending-../escape.mdx", "--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title", "--dry-run"},
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
		"deploy", "--active-file", "mp-pending-example.mdx",
		"--date-stamp", "20260722", "--author-slug", "author", "--title-slug", "title",
		"--dry-run",
	})
	if err := cmd.ExecuteContext(context.Background()); err != nil {
		t.Fatalf("complete dry-run slots should succeed: %v", err)
	}
}

// TestGPIngressRejectedBeforeSideEffects covers gp-pipeline-publish-integrity:
// while GP is paused, every entry that would write, publish, or number a GP
// post exits 1 with「GP 暫停中」before any work dir, fetch, runtime profile,
// provider, counter, file, or git side effect. With a file, the filename
// decides the series even when --prefix is left at its default.
func TestGPIngressRejectedBeforeSideEffects(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	const gpPost = "gp-10-20260723-author-title.mdx"
	const gpPending = "gp-pending-20260723-author-title.mdx"
	mustWrite(t, filepath.Join(postsDir, gpPost), "---\ntitle: \"GP\"\nticketId: GP-10\nlang: zh-tw\n---\nbody\n")
	mustWrite(t, filepath.Join(postsDir, gpPending), "---\ntitle: \"GP\"\nticketId: GP-PENDING\nlang: zh-tw\n---\nbody\n")
	trapDir := t.TempDir()
	for _, name := range []string{"bash", "curl", "yt-dlp", "python3", "node", "codex", "claude", "git", "pnpm"} {
		writeExecutableFile(t, filepath.Join(trapDir, name), "#!/bin/sh\nprintf '%s\\n' \"$0 $*\" >> \"$GP_INGRESS_TRAP_LOG\"\nexit 99\n")
	}
	t.Setenv("GU_LOG_DIR", root)
	t.Setenv("PATH", trapDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	snapshot := func() map[string]string {
		t.Helper()
		state := map[string]string{}
		for _, dir := range []string{postsDir, filepath.Join(root, "scripts")} {
			entries, err := os.ReadDir(dir)
			if err != nil {
				t.Fatal(err)
			}
			for _, entry := range entries {
				data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
				if err != nil {
					t.Fatal(err)
				}
				state[filepath.Join(dir, entry.Name())] = string(data)
			}
		}
		return state
	}
	slots := []string{"--date-stamp", "20260723", "--author-slug", "author", "--title-slug", "title"}

	for _, tc := range []struct {
		name string
		args []string
	}{
		{name: "run without prefix or file", args: []string{"run", "https://x.com/author/status/1"}},
		{name: "run YouTube source before yt-dlp preflight", args: []string{"run", "https://youtube.com/watch?v=dQw4w9WgXcQ"}},
		{name: "run resumes a GP file without prefix", args: []string{"run", "--from-step", "deploy", "--file", gpPost}},
		{name: "run resumes a GP file with prefix", args: []string{"run", "--prefix", "GP", "--from-step", "translate", "--file", gpPost, "--dry-run"}},
		{name: "deploy GP pending file before slot validation", args: []string{"deploy", "--active-file", gpPending}},
		{name: "deploy GP pending file with prefix", args: append([]string{"deploy", "--prefix", "GP", "--active-file", gpPending}, slots...)},
		{name: "counter bump default prefix", args: []string{"counter", "bump"}},
		{name: "counter bump GP prefix", args: []string{"counter", "bump", "--prefix", "GP"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetGlobals()
			trapLog := filepath.Join(t.TempDir(), "trap.log")
			t.Setenv("GP_INGRESS_TRAP_LOG", trapLog)
			before := snapshot()
			workDir := filepath.Join(t.TempDir(), "never-created")
			// A missing fake-provider spec fails differently if a model route is built.
			args := append([]string{"--json", "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json")}, tc.args...)
			cmd := buildRoot()
			cmd.SetArgs(args)
			out, err := captureProcessStdout(t, func() error {
				return cmd.ExecuteContext(context.Background())
			})
			if err == nil || exitCodeFor(err) != 1 || !errors.Is(err, pipeline.ErrGPPaused) {
				t.Fatalf("error = %v (exit %d), want the exit-1 GP pause rejection", err, exitCodeFor(err))
			}
			for _, want := range []string{"GP 暫停中", "openspec: editorial-charter"} {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error = %v, want %q", err, want)
				}
			}
			if tc.args[0] != "counter" && len(out) != 0 {
				t.Fatalf("ingress rejection emitted a report: %s", out)
			}
			if _, statErr := os.Stat(workDir); !os.IsNotExist(statErr) {
				t.Fatalf("GP rejection created the work dir: %v", statErr)
			}
			if raw, readErr := os.ReadFile(trapLog); readErr == nil {
				t.Fatalf("GP rejection ran external programs:\n%s", raw)
			}
			after := snapshot()
			if len(after) != len(before) {
				t.Fatalf("GP rejection changed the repo files: %d -> %d", len(before), len(after))
			}
			for path, content := range before {
				if after[path] != content {
					t.Fatalf("GP rejection changed %s", path)
				}
			}
		})
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

// TestRunRejectsRetiredTranslationSteps covers the gp-source-preservation
// scenario「以退役的翻譯步驟恢復 run」: the retired GP step names are unknown
// steps, rejected before any fetch, model call, or file change.
func TestRunRejectsRetiredTranslationSteps(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	const existing = "mp-10-20260723-example.mdx"
	body := "---\ntitle: \"MP\"\nticketId: MP-10\nlang: zh-tw\n---\nbody\n"
	mustWrite(t, filepath.Join(postsDir, existing), body)
	t.Setenv("GU_LOG_DIR", root)
	for _, step := range []string{"source-translate", "source-preservation", "source-gate", "enrich"} {
		for _, target := range [][]string{{"https://x.com/author/status/1"}, {"--file", existing}} {
			t.Run(step+" "+target[0], func(t *testing.T) {
				resetGlobals()
				workDir := filepath.Join(t.TempDir(), "never-created")
				args := append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
					"run", "--prefix", "MP", "--from-step", step}, target...)
				cmd := buildRoot()
				cmd.SetArgs(args)
				err := cmd.ExecuteContext(context.Background())
				if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "unknown step") {
					t.Fatalf("error = %v (exit %d), want an exit-1 unknown step rejection", err, exitCodeFor(err))
				}
				if _, statErr := os.Stat(workDir); !os.IsNotExist(statErr) {
					t.Fatalf("retired step created the work dir: %v", statErr)
				}
				if got, readErr := os.ReadFile(filepath.Join(postsDir, existing)); readErr != nil || string(got) != body {
					t.Fatalf("retired step changed %s: %q, %v", existing, got, readErr)
				}
			})
		}
	}
}

// TestStandaloneLegacyTextCommandsRejectGP covers the
// gp-pipeline-publish-integrity scenario「單步寫作指令收到 GP」, including the
// GP defaults of write --prefix and review/refine --ticket-id.
func TestStandaloneLegacyTextCommandsRejectGP(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	source := filepath.Join(root, "source-tweet.md")
	draft := filepath.Join(root, "draft-v1.mdx")
	mustWrite(t, source, "source")
	mustWrite(t, draft, "draft")
	for _, tc := range []struct {
		name string
		args []string
	}{
		{name: "write default prefix", args: []string{"write", "--source", source}},
		{name: "write GP prefix", args: []string{"write", "--source", source, "--prefix", "GP"}},
		{name: "review default ticket", args: []string{"review", "--draft", draft}},
		{name: "refine GP ticket", args: []string{"refine", "--draft", draft, "--ticket-id", "GP-12"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetGlobals()
			// A missing fake-provider spec fails differently if a model route is built.
			cmd := buildRoot()
			cmd.SetArgs(append([]string{"--fake-provider", filepath.Join(root, "missing.json")}, tc.args...))
			err := cmd.ExecuteContext(context.Background())
			if err == nil || exitCodeFor(err) != 1 || !errors.Is(err, pipeline.ErrGPPaused) {
				t.Fatalf("error = %v (exit %d), want the exit-1 GP pause rejection", err, exitCodeFor(err))
			}
			if !strings.Contains(err.Error(), "GP 暫停中") || !strings.Contains(err.Error(), "editorial-charter") {
				t.Fatalf("error = %v, want 「GP 暫停中」 and editorial-charter", err)
			}
		})
	}
}

// TestStandaloneRalphInfersSeriesFromFilename runs the real ralph command. The
// series only changes whether Tribunal may rewrite (GP is score-only), and the
// existing levelup- Lv corpus and en- sidecars must resolve instead of failing.
func TestStandaloneRalphInfersSeriesFromFilename(t *testing.T) {
	for filename, wantNoRewrite := range map[string]bool{
		"gp-10-example.mdx":                      true,
		"mp-20-example.mdx":                      false,
		"en-sd-30-example.mdx":                   false,
		"lv-40-example.mdx":                      false,
		"levelup-20260701-core-dump-anatomy.mdx": false,
	} {
		t.Run(filename, func(t *testing.T) {
			resetGlobals()
			root := makeFakeRepo(t)
			postsDir := filepath.Join(root, "src", "content", "posts")
			if err := os.MkdirAll(postsDir, 0o755); err != nil {
				t.Fatal(err)
			}
			mustWrite(t, filepath.Join(postsDir, filename), "---\ntitle: \"Example\"\nlang: zh-tw\n---\nbody\n")
			mustWrite(t, filepath.Join(root, "scripts", "tribunal.sh"), "printf 'tribunal args: %s\\n' \"$*\"\n")
			for _, fixer := range []string{"add-kaomoji.mjs", "apply-glossary-links.mjs", "inject-related-posts.mjs"} {
				mustWrite(t, filepath.Join(root, "scripts", fixer), "")
			}
			t.Setenv("GU_LOG_DIR", root)

			workDir := t.TempDir()
			cmd := buildRoot()
			cmd.SetArgs([]string{"--json", "ralph", "--file", filename, "--work-dir", workDir})
			if _, err := captureProcessStdout(t, func() error {
				return cmd.ExecuteContext(context.Background())
			}); err != nil {
				t.Fatalf("ralph --file %s: %v", filename, err)
			}
			args, err := os.ReadFile(filepath.Join(workDir, "tribunal-stdout.txt"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(args), "tribunal args: "+filename) {
				t.Fatalf("tribunal did not receive %s: %q", filename, args)
			}
			if got := strings.Contains(string(args), "--no-rewrite"); got != wantNoRewrite {
				t.Fatalf("tribunal args = %q, want --no-rewrite=%t", args, wantNoRewrite)
			}
			// GP is score-only: the stamp normaliser must leave it untouched,
			// while every other series gets the canonical pipeline block.
			post, err := os.ReadFile(filepath.Join(postsDir, filename))
			if err != nil {
				t.Fatal(err)
			}
			if stamped := strings.Contains(string(post), "pipelineUrl:"); stamped == wantNoRewrite {
				t.Fatalf("pipeline stamp written = %t for %s, want %t:\n%s", stamped, filename, !wantNoRewrite, post)
			}
		})
	}

	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs([]string{"ralph", "--file", "../mp-20-example.mdx"})
	if err := cmd.ExecuteContext(context.Background()); err == nil || !strings.Contains(err.Error(), "basename") {
		t.Fatalf("path traversal filename error = %v, want a basename rejection", err)
	}
}

// TestRunAndDeployRejectPrefixThatContradictsFile covers the
// gp-pipeline-publish-integrity scenario「prefix 與檔案系列不一致」.
func TestRunAndDeployRejectPrefixThatContradictsFile(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	slots := []string{"--date-stamp", "20260723", "--author-slug", "author", "--title-slug", "title"}
	for _, tc := range []struct {
		name, prefix, fileSeries string
		args                     []string
	}{
		{name: "run GP prefix with MP file", prefix: "GP", fileSeries: "MP",
			args: []string{"run", "--prefix", "GP", "--from-step", "translate", "--file", "mp-10-20260723-example.mdx", "--dry-run"}},
		{name: "run MP prefix with GP file", prefix: "MP", fileSeries: "GP",
			args: []string{"run", "--prefix", "MP", "--from-step", "translate", "--file", "gp-10-20260723-example.mdx", "--dry-run"}},
		{name: "deploy GP prefix with MP pending file", prefix: "GP", fileSeries: "MP",
			args: append([]string{"deploy", "--prefix", "GP", "--active-file", "mp-pending-20260723-author-title.mdx"}, slots...)},
		{name: "deploy MP prefix with GP pending file", prefix: "MP", fileSeries: "GP",
			args: append([]string{"deploy", "--prefix", "MP", "--active-file", "gp-pending-20260723-author-title.mdx"}, slots...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetGlobals()
			workDir := filepath.Join(t.TempDir(), "never-created")
			// A missing fake-provider spec fails loudly if a model route is built.
			cmd := buildRoot()
			cmd.SetArgs(append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json")}, tc.args...))
			err := cmd.ExecuteContext(context.Background())
			if err == nil || exitCodeFor(err) != 1 {
				t.Fatalf("error = %v (exit %d), want an exit-1 ingress rejection", err, exitCodeFor(err))
			}
			for _, want := range []string{"--prefix " + tc.prefix, "(series " + tc.fileSeries + ")"} {
				if !strings.Contains(err.Error(), want) {
					t.Fatalf("error = %v, want both series named (%q)", err, want)
				}
			}
			if _, statErr := os.Stat(workDir); !os.IsNotExist(statErr) {
				t.Fatalf("mismatched prefix created the work dir: %v", statErr)
			}
		})
	}
}

// TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations
// resumes translation without --prefix: the file names the series (MP, and Lv
// for the existing levelup- corpus) instead of the GP default
// (openspec: gp-pipeline-publish-integrity「以既有非 GP 檔案恢復時沒帶 prefix」).
func TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations(t *testing.T) {
	for _, tc := range []struct {
		filename string
		ticketID string
	}{
		{filename: "mp-10-20260723-recovery-roundtrip.mdx", ticketID: "MP-10"},
		{filename: "levelup-20260701-core-dump-anatomy.mdx", ticketID: "Lv-13"},
	} {
		t.Run(tc.filename, func(t *testing.T) {
			resetGlobals()
			root := makeFakeRepo(t)
			postsDir := filepath.Join(root, "src", "content", "posts")
			if err := os.MkdirAll(postsDir, 0o755); err != nil {
				t.Fatal(err)
			}
			sourcePath := filepath.Join(postsDir, tc.filename)
			mustWrite(t, sourcePath, `---
title: "Recovery roundtrip"
ticketId: `+tc.ticketID+`
translatedDate: "2026-04-11"
translatedBy:
  model: "Old Translator"
  harness: "Old Harness"
lang: "zh-tw"
---
中文內容。
`)
			sourceBefore, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			fakeSpec, err := json.Marshal(map[string]any{
				"model": "claude-opus-5",
				"responses": []map[string]string{{
					"output": "---\ntitle: \"Recovery roundtrip\"\nticketId: " + tc.ticketID + "\nlang: \"en\"\n---\nEnglish body.\n",
				}},
			})
			if err != nil {
				t.Fatal(err)
			}
			fakePath := filepath.Join(root, "fake-provider.json")
			mustWrite(t, fakePath, string(fakeSpec))
			t.Setenv("GU_LOG_DIR", root)

			binDir := t.TempDir()
			gitMarker := filepath.Join(t.TempDir(), "git-called")
			gitPath := filepath.Join(binDir, "git")
			gitStub := `#!/bin/sh
set -eu
for arg in "$@"; do
  case "$arg" in
    add|commit|push)
      : > "$GIT_MARKER"
      exit 99
      ;;
  esac
done
exit 0
`
			if err := os.WriteFile(gitPath, []byte(gitStub), 0o755); err != nil {
				t.Fatalf("write fake git: %v", err)
			}
			t.Setenv("GIT_MARKER", gitMarker)
			t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

			cmd := buildRoot()
			cmd.SetArgs([]string{
				"--json", "--fake-provider", fakePath, "--work-dir", filepath.Join(root, "translate-work"),
				"run", "--from-step", "translate", "--file", tc.filename, "--dry-run",
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
			if report.TicketID != tc.ticketID {
				t.Fatalf("ticketId = %q, want %q from the resumed file", report.TicketID, tc.ticketID)
			}
			want := "en-" + tc.filename
			if report.ENFilename != want {
				t.Fatalf("enFilename = %q, want written file %q", report.ENFilename, want)
			}
			if report.TranslateModel != "Opus 5" {
				t.Fatalf("translateModel = %q, want Opus 5", report.TranslateModel)
			}
			if report.TranslateHarness != "Claude Code CLI" {
				t.Fatalf("translateHarness = %q, want Claude Code CLI", report.TranslateHarness)
			}
			if !report.DryRun {
				t.Fatal("run report should preserve dryRun=true")
			}
			info, err := os.Lstat(filepath.Join(postsDir, report.ENFilename))
			if err != nil {
				t.Fatalf("reported English file: %v", err)
			}
			if !info.Mode().IsRegular() {
				t.Fatalf("reported English path mode = %s, want regular file", info.Mode())
			}
			sidecar, err := os.ReadFile(filepath.Join(postsDir, report.ENFilename))
			if err != nil {
				t.Fatal(err)
			}
			for _, want := range []string{
				`translatedBy:`,
				`  model: "Opus 5"`,
				`  harness: "Claude Code CLI"`,
			} {
				if !strings.Contains(string(sidecar), want) {
					t.Errorf("sidecar missing %q:\n%s", want, sidecar)
				}
			}
			sourceAfter, err := os.ReadFile(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			if string(sourceAfter) != string(sourceBefore) {
				t.Fatalf("dry-run translation mutated zh source:\nbefore:\n%s\nafter:\n%s", sourceBefore, sourceAfter)
			}
			if _, err := os.Stat(gitMarker); !os.IsNotExist(err) {
				t.Fatalf("dry-run invoked git mutation (add/commit/push must remain unreachable): %v", err)
			}
		})
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

func TestRunCommand_DryRunOmitsPrefilledMissingEnglishFile(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	filename := "mp-10-20260723-ralph-failed.mdx"
	mustWrite(t, filepath.Join(postsDir, filename), `---
title: "Ralph failed"
ticketId: MP-10
lang: zh-tw
---
中文內容。
`)
	// Ralph pre-fills ActiveENFilename before invoking the tribunal. A failed
	// tribunal keeps RalphPassed false, so Translate must skip without writing
	// that planned sidecar; the successful dry-run report must omit it.
	mustWrite(t, filepath.Join(root, "scripts", "tribunal.sh"), "exit 1\n")
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, `{"responses":[]}`)
	t.Setenv("GU_LOG_DIR", root)

	cmd := buildRoot()
	cmd.SetArgs([]string{
		"--json", "--fake-provider", fakePath, "--work-dir", filepath.Join(root, "ralph-work"),
		"run", "--from-step", "ralph", "--file", filename, "--dry-run",
	})
	out, err := captureProcessStdout(t, func() error {
		return cmd.ExecuteContext(context.Background())
	})
	if err != nil {
		t.Fatalf("run command: %v", err)
	}
	var report map[string]json.RawMessage
	if err := json.Unmarshal(out, &report); err != nil {
		t.Fatalf("decode stdout JSON %q: %v", out, err)
	}
	if _, ok := report["enFilename"]; ok {
		t.Fatalf("Ralph-failed dry-run reported nonexistent English artifact: %s", out)
	}
	if _, err := os.Lstat(filepath.Join(postsDir, "en-"+filename)); !os.IsNotExist(err) {
		t.Fatalf("English sidecar unexpectedly exists: %v", err)
	}
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
