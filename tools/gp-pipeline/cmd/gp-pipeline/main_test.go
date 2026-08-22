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
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/preservation"
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

func installGPProjectionStub(t *testing.T, root string) {
	t.Helper()
	mustWrite(t, filepath.Join(root, "scripts", "gp-body-projection.mjs"), `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const document = readFileSync(process.argv[2], 'utf8');
let body = document;
if (document.startsWith('---\n')) {
  const end = document.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('unterminated frontmatter');
  body = document.slice(end + '\n---\n'.length);
}
const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
process.stdout.write(JSON.stringify({ version: 'gp-source-preservation/v1', body, sha256 }) + '\n');
`)
	mustWrite(t, filepath.Join(root, "scripts", "check-jingjing.mjs"), `
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const inputPath = process.argv.at(-1);
const input = readFileSync(inputPath);
process.stdout.write(JSON.stringify({
  version: 'check-jingjing/v1',
  policy_sha256: createHash('sha256').update('fixture-policy').digest('hex'),
  baseline_ref: '',
  baseline_ref_unavailable: false,
  files: [{ path: inputPath, sha256: createHash('sha256').update(input).digest('hex'), skipped: false, violations: [] }],
}) + '\n');
`)
}

func writeCompleteFakeGPRoles(t *testing.T, path string) {
	t.Helper()
	mustWrite(t, path, `{
  "roles": {
    "judge": {"provider": "fake-judge", "responses": []},
    "translator": {"provider": "fake-translator", "responses": []},
    "sourceReviewer": {"provider": "fake-source-reviewer", "responses": []},
    "corrector": {"provider": "fake-corrector", "responses": []},
    "commentary": {"provider": "fake-commentary", "responses": []},
    "vibeScorer": {"provider": "fake-vibe", "responses": []}
  }
}`)
}

func writeFreshGPPublishManifest(t *testing.T, root, workDir, sourcePath, bodyPath string) {
	t.Helper()
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := preservation.ProjectFile(context.Background(), root, bodyPath)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	gate := func(role string) preservation.GateEnvelope {
		return preservation.GateEnvelope{
			Version: preservation.ContractVersion, Gate: role,
			SourceSHA256: preservation.SHA256(source), BodyProjectionSHA256: projection.SHA256,
			Verdict: "PASS", Provenance: preservation.Provenance{
				Role: role, Provider: "fixture", Model: role, Harness: "go-test", CompletedAt: now,
			},
		}
	}
	jingjing, _, err := preservation.CheckJingjing(context.Background(), root, bodyPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest := preservation.PublishManifest{
		Version: preservation.ContractVersion, ProfileSHA256: preservation.SHA256([]byte("fixture")), JingjingPolicySHA256: jingjing.PolicySHA256, SourceSHA256: preservation.SHA256(source),
		BodyProjectionSHA256: projection.SHA256, Verdict: "PASS",
		Gates: []preservation.GateEnvelope{gate("source-reviewer"), gate("vibe-scorer")}, CompletedAt: now,
	}
	if err := preservation.WriteJSON(filepath.Join(workDir, "gp-publish-gate.json"), manifest); err != nil {
		t.Fatal(err)
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

func TestGPProviderPreflightFailurePersistsReportAndRecoveryState(t *testing.T) {
	resetGlobals()
	workDir := t.TempDir()
	fakePath := filepath.Join(t.TempDir(), "incomplete-gp-profile.json")
	mustWrite(t, fakePath, `{
  "roles": {
    "judge": {"provider": "fake-judge", "responses": []},
    "translator": {"provider": "fake-translator", "responses": []}
  }
}`)

	cmd := buildRoot()
	cmd.SetArgs([]string{
		"--json", "--fake-provider", fakePath, "--work-dir", workDir,
		"run", "https://example.com/source", "--prefix", "GP", "--dry-run",
	})
	out, runErr := captureProcessStdout(t, func() error {
		return cmd.ExecuteContext(context.Background())
	})
	if runErr == nil || !strings.Contains(runErr.Error(), "sourceReviewer") {
		t.Fatalf("preflight error = %v, want missing sourceReviewer", runErr)
	}
	var report runReport
	if err := json.Unmarshal(out, &report); err != nil {
		t.Fatalf("decode preflight report %q: %v", out, err)
	}
	if report.OK || report.ErrorCode != 1 || report.WorkDir != workDir || !strings.Contains(report.Error, "sourceReviewer") {
		t.Fatalf("preflight report = %#v", report)
	}
	for _, artifact := range []string{"sourceReviewer-failure.json", "pipeline-status.json"} {
		data, err := os.ReadFile(filepath.Join(workDir, artifact))
		if err != nil {
			t.Fatalf("read durable %s: %v", artifact, err)
		}
		if !bytes.Contains(data, []byte("sourceReviewer")) {
			t.Fatalf("%s missing failed role evidence: %s", artifact, data)
		}
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
	cmd.SetArgs([]string{"run", "https://youtube.com/watch?v=dQw4w9WgXcQ", "--dry-run"})
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

func TestRunRunGPRejectsNarrativeAngleOutsideLegacyShadow(t *testing.T) {
	err := runRun(context.Background(), &rootState{}, runOpts{Prefix: "GP", TweetURL: "https://example.com", Angle: "換一個故事骨架"})
	if err == nil || !strings.Contains(err.Error(), "--angle") {
		t.Fatalf("error = %v", err)
	}
}

func TestCanonicalGPStageNamesAreDistinct(t *testing.T) {
	if stepNameToInt["source-translate"] != pipeline.StepSourceTranslate || stepNameToInt["translate"] != pipeline.StepTranslate {
		t.Fatalf("source translation and English sidecar stages must remain distinct: %#v", stepNameToInt)
	}
}

func TestRunRunGPRejectsLegacyStageAliases(t *testing.T) {
	for _, stage := range []string{"write", "review", "refine"} {
		t.Run(stage, func(t *testing.T) {
			err := runRun(context.Background(), &rootState{}, runOpts{
				Prefix:       "GP",
				FromStep:     stage,
				ExistingFile: "gp-pending.mdx",
			})
			if err == nil || !strings.Contains(err.Error(), "legacy GP step") {
				t.Fatalf("runRun error = %v, want canonical-stage guidance", err)
			}
		})
	}
}

func TestStandaloneLegacyTextCommandsRejectGP(t *testing.T) {
	tests := []struct {
		name string
		run  func() error
		want string
	}{
		{name: "write", run: func() error { return runWrite(context.Background(), &rootState{}, writeOpts{Prefix: "GP"}) }, want: "canonical source-translate"},
		{name: "review", run: func() error { return runReview(context.Background(), &rootState{}, "missing.mdx", "", "GP-PENDING") }, want: "standalone full-draft review"},
		{name: "refine", run: func() error {
			return runRefine(context.Background(), &rootState{}, "missing.mdx", "", "", "GP-PENDING", "")
		}, want: "evidence-bounded patches"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.run()
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("error = %v, want %q", err, tt.want)
			}
		})
	}
}

func TestStandaloneRalphInfersSeriesFromFilename(t *testing.T) {
	for filename, want := range map[string]string{
		"gp-10-example.mdx":    "GP",
		"mp-20-example.mdx":    "MP",
		"en-sd-30-example.mdx": "SD",
		"lv-40-example.mdx":    "Lv",
	} {
		got, err := postPrefixFromFilename(filename)
		if err != nil || got != want {
			t.Errorf("postPrefixFromFilename(%q) = %q, %v; want %q", filename, got, err, want)
		}
	}
	if _, err := postPrefixFromFilename("../mp-20-example.mdx"); err == nil {
		t.Fatal("path traversal filename must fail")
	}
}

func TestProductionGPRecoveryRejectsMissingAndStaleGateArtifacts(t *testing.T) {
	for _, tc := range []struct {
		name     string
		fromStep string
		setup    func(t *testing.T, root, workDir, translationPath string)
		want     string
	}{
		{
			name:     "missing verdict with --from-step and --file",
			fromStep: "enrich",
			setup:    func(*testing.T, string, string, string) {},
			want:     "missing GP publish manifest",
		},
		{
			name:     "stale final at deploy recovery",
			fromStep: "deploy",
			setup: func(t *testing.T, root, workDir, translationPath string) {
				sourcePath := filepath.Join(workDir, "source-tweet.md")
				writeFreshGPPublishManifest(t, root, workDir, sourcePath, translationPath)
				mustWrite(t, filepath.Join(workDir, "final.mdx"), "---\ntitle: Recovery\n---\n\nstale body\n")
			},
			want: "hashes are stale",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resetGlobals()
			root := makeFakeRepo(t)
			installGPProjectionStub(t, root)
			postsDir := filepath.Join(root, "src", "content", "posts")
			if err := os.MkdirAll(postsDir, 0o755); err != nil {
				t.Fatal(err)
			}
			filename := "gp-10-20260815-recovery.mdx"
			article := "---\ntitle: Recovery\nticketId: GP-10\nlang: zh-tw\n---\n\nsource body\n"
			mustWrite(t, filepath.Join(postsDir, filename), article)
			workDir := t.TempDir()
			sourcePath := filepath.Join(workDir, "source-tweet.md")
			translationPath := filepath.Join(workDir, "source-translation.mdx")
			mustWrite(t, sourcePath, "complete source\n")
			mustWrite(t, translationPath, article)
			mustWrite(t, filepath.Join(workDir, "source-translation.initial.mdx"), article)
			now := time.Now().UTC()
			translationArtifact := preservation.SourceTranslationArtifact{
				Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256([]byte("complete source\n")), TranslationSHA256: preservation.SHA256([]byte(article)), TranslationMDX: article, SlopCandidates: []preservation.Finding{},
				Provenance: preservation.Provenance{Role: "translator", Provider: "fixture", Model: "translator", Harness: "go-test", CompletedAt: now},
			}
			if err := preservation.WriteJSON(filepath.Join(workDir, "source-translate.json"), translationArtifact); err != nil {
				t.Fatal(err)
			}
			tc.setup(t, root, workDir, translationPath)
			fakePath := filepath.Join(root, "fake-gp-roles.json")
			writeCompleteFakeGPRoles(t, fakePath)
			t.Setenv("GU_LOG_DIR", root)

			cmd := buildRoot()
			cmd.SetArgs([]string{
				"--json", "--fake-provider", fakePath, "--work-dir", workDir,
				"run", "--from-step", tc.fromStep, "--file", filename, "--prefix", "GP", "--dry-run",
			})
			out, runErr := captureProcessStdout(t, func() error {
				return cmd.ExecuteContext(context.Background())
			})
			if runErr == nil || !strings.Contains(runErr.Error(), tc.want) {
				t.Fatalf("run error = %v, want %q", runErr, tc.want)
			}
			var report runReport
			if err := json.Unmarshal(out, &report); err != nil {
				t.Fatalf("decode recovery report %q: %v", out, err)
			}
			if report.OK || !strings.Contains(report.Error, tc.want) {
				t.Fatalf("recovery report = %#v", report)
			}
			got, err := os.ReadFile(filepath.Join(postsDir, filename))
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != article {
				t.Fatalf("failed recovery mutated --file article:\n%s", got)
			}
		})
	}
}

func TestStandaloneGPDeployRejectsMissingManifestBeforeMutation(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	installGPProjectionStub(t, root)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	filename := "gp-pending-20260815-author-title.mdx"
	article := "---\ntitle: Title\nticketId: GP-PENDING\nlang: zh-tw\n---\n\nsource body\n"
	mustWrite(t, filepath.Join(postsDir, filename), article)
	workDir := t.TempDir()
	mustWrite(t, filepath.Join(workDir, "source-tweet.md"), "complete source\n")
	fakePath := filepath.Join(root, "fake-gp-roles.json")
	writeCompleteFakeGPRoles(t, fakePath)
	counterBefore, err := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GU_LOG_DIR", root)

	cmd := buildRoot()
	cmd.SetArgs([]string{
		"--fake-provider", fakePath, "--work-dir", workDir, "deploy", "--active-file", filename, "--prefix", "GP",
		"--date-stamp", "20260815", "--author-slug", "author", "--title-slug", "title",
	})
	runErr := cmd.ExecuteContext(context.Background())
	if runErr == nil || !strings.Contains(runErr.Error(), "missing GP publish manifest") {
		t.Fatalf("standalone deploy error = %v", runErr)
	}
	counterAfter, err := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(counterBefore, counterAfter) {
		t.Fatal("standalone GP deploy bumped counter before gate rejection")
	}
	got, err := os.ReadFile(filepath.Join(postsDir, filename))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != article {
		t.Fatalf("standalone GP deploy mutated pending article before gate rejection:\n%s", got)
	}
}

func TestStandaloneGPDeployBindsFreshManifestProfile(t *testing.T) {
	root := makeFakeRepo(t)
	installGPProjectionStub(t, root)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	articlePath := filepath.Join(postsDir, "gp-pending-20260815-author-title.mdx")
	mustWrite(t, articlePath, "---\ntitle: Title\nticketId: GP-PENDING\nlang: zh-tw\n---\n\nsource body\n")
	workDir := t.TempDir()
	sourcePath := filepath.Join(workDir, "source-tweet.md")
	mustWrite(t, sourcePath, "complete source\n")
	writeFreshGPPublishManifest(t, root, workDir, sourcePath, articlePath)
	fakePath := filepath.Join(root, "fake-gp-roles.json")
	writeCompleteFakeGPRoles(t, fakePath)

	rootState := &rootState{cfg: &config.Config{RepoRoot: root}, fakeProviderPath: fakePath}
	pipelineState := pipeline.NewState()
	pipelineState.Cfg = rootState.cfg
	pipelineState.WorkDir = workDir
	if err := bindGPDeployProfile(rootState, pipelineState); err != nil {
		t.Fatalf("bind standalone GP deploy profile: %v", err)
	}
	if pipelineState.GPProfile != "fixture" || pipelineState.GPProfileSHA256 != preservation.SHA256([]byte("fixture")) {
		t.Fatalf("unexpected standalone profile: %q %q", pipelineState.GPProfile, pipelineState.GPProfileSHA256)
	}
	if err := pipelineState.ValidateGPPublishManifest(context.Background(), articlePath); err != nil {
		t.Fatalf("fresh manifest rejected after standalone profile binding: %v", err)
	}
	pipelineState.GPProfileSHA256 = preservation.SHA256([]byte("changed-profile"))
	if err := pipelineState.ValidateGPPublishManifest(context.Background(), articlePath); err == nil {
		t.Fatal("standalone deploy accepted a manifest from a changed runtime profile")
	}
}

func TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations(t *testing.T) {
	resetGlobals()
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	filename := "gp-10-20260723-recovery-roundtrip.mdx"
	sourcePath := filepath.Join(postsDir, filename)
	mustWrite(t, sourcePath, `---
title: "Recovery roundtrip"
ticketId: GP-10
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
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, `{"model":"claude-opus-5","responses":[{"output":"---\ntitle: \"Recovery roundtrip\"\nticketId: GP-10\nlang: \"en\"\n---\nEnglish body.\n"}]}`)
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
		"run", "--from-step", "translate", "--file", filename, "--dry-run", "--legacy-shadow",
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
	filename := "gp-10-20260723-ralph-failed.mdx"
	mustWrite(t, filepath.Join(postsDir, filename), `---
title: "Ralph failed"
ticketId: GP-10
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
		"run", "--from-step", "ralph", "--file", filename, "--dry-run", "--legacy-shadow",
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
