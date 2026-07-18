package deploy

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

func runGitForDeployTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-c", "core.hooksPath=/dev/null"}, args...)...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

// initGitRepo makes dir a minimal git repo with one commit, so gitAdd/
// gitCommit in Run() have something to work against. Mirrors
// internal/pipeline/phase3_test.go's initRepo helper (unexported there,
// duplicated here since it's package-private).
func initGitRepo(t *testing.T, dir string) {
	t.Helper()
	runGitForDeployTest(t, dir, "init", "-q", "-b", "main")
	runGitForDeployTest(t, dir, "config", "user.email", "test@example.com")
	runGitForDeployTest(t, dir, "config", "user.name", "Test")
	runGitForDeployTest(t, dir, "config", "commit.gpgSign", "false")
	runGitForDeployTest(t, dir, "config", "core.hooksPath", "/dev/null")
	seed := filepath.Join(dir, ".seed")
	if err := os.WriteFile(seed, []byte("seed"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForDeployTest(t, dir, "add", ".seed")
	runGitForDeployTest(t, dir, "commit", "-q", "-m", "seed")
}

// newTestOptions builds a minimal Options with a real (temp) counter file
// and posts dir, so we can assert that a validation failure leaves both
// completely untouched — no counter bump, no rename, no commit.
func newTestOptions(t *testing.T, override func(*Options)) (Options, string, string) {
	t.Helper()
	if testing.Short() {
		t.Skip("deploy tests create a git repo")
	}
	tmp := t.TempDir()
	// Deploy's git-add paths are hardcoded relative to RepoRoot
	// ("src/content/posts/...", "scripts/article-counter.json"), so the
	// temp repo must mirror the real layout.
	postsDir := filepath.Join(tmp, "src", "content", "posts")
	scriptsDir := filepath.Join(tmp, "scripts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	counterFile := filepath.Join(scriptsDir, "article-counter.json")
	seed := `{
  "SP": { "next": 252, "label": "ShroomDog Picks", "description": "test" },
  "CP": { "next": 1, "label": "Clawd Picks", "description": "test" },
  "SD": { "next": 1, "label": "ShroomDog Original", "description": "test" },
  "Lv": { "next": 1, "label": "Level-Up", "description": "test" }
}
`
	if err := os.WriteFile(counterFile, []byte(seed), 0o644); err != nil {
		t.Fatal(err)
	}

	pendingName := "sp-pending-20260717-fakeauthor-faketitle.mdx"
	if err := os.WriteFile(filepath.Join(postsDir, pendingName), []byte("---\ntitle: \"Fake\"\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	initGitRepo(t, tmp)

	opts := Options{
		Cfg:            &config.Config{RepoRoot: tmp, PostsDir: postsDir, CounterFile: counterFile},
		Log:            logx.New(),
		Counter:        counter.New(counterFile, filepath.Join(tmp, ".counter.lock")),
		Prefix:         "SP",
		ActiveFilename: pendingName,
		DateStamp:      "20260717",
		AuthorSlug:     "fakeauthor",
		TitleSlug:      "faketitle",
		Title:          "Fake",
		SkipBuild:      true,
		SkipPush:       true,
		SkipValidate:   true,
	}
	if override != nil {
		override(&opts)
	}
	return opts, counterFile, postsDir
}

func readCounterNext(t *testing.T, path string) int {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]struct {
		Next int `json:"next"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed["SP"].Next
}

func TestRun_MissingAllSlots_FailsBeforeAnyMutation(t *testing.T) {
	opts, counterFile, postsDir := newTestOptions(t, func(o *Options) {
		o.DateStamp = ""
		o.AuthorSlug = ""
		o.TitleSlug = ""
	})

	before := readCounterNext(t, counterFile)
	entriesBefore, _ := os.ReadDir(postsDir)

	_, err := Run(context.Background(), opts)
	if err == nil {
		t.Fatal("expected error for missing date-stamp/author-slug/title-slug, got nil")
	}

	after := readCounterNext(t, counterFile)
	if after != before {
		t.Errorf("counter mutated on validation failure: before=%d after=%d", before, after)
	}
	entriesAfter, _ := os.ReadDir(postsDir)
	if len(entriesAfter) != len(entriesBefore) {
		t.Errorf("posts dir mutated on validation failure: before=%d entries, after=%d", len(entriesBefore), len(entriesAfter))
	}
}

func TestRun_MissingOneSlot(t *testing.T) {
	cases := []struct {
		name     string
		override func(*Options)
	}{
		{"missing date-stamp", func(o *Options) { o.DateStamp = "" }},
		{"missing author-slug", func(o *Options) { o.AuthorSlug = "" }},
		{"missing title-slug", func(o *Options) { o.TitleSlug = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			opts, counterFile, _ := newTestOptions(t, tc.override)
			before := readCounterNext(t, counterFile)
			if _, err := Run(context.Background(), opts); err == nil {
				t.Fatalf("expected error for %s, got nil", tc.name)
			}
			if after := readCounterNext(t, counterFile); after != before {
				t.Errorf("counter mutated on validation failure (%s): before=%d after=%d", tc.name, before, after)
			}
		})
	}
}

func TestRun_MalformedDateStamp(t *testing.T) {
	opts, counterFile, _ := newTestOptions(t, func(o *Options) {
		o.DateStamp = "2026-07-17"
	})
	before := readCounterNext(t, counterFile)
	if _, err := Run(context.Background(), opts); err == nil {
		t.Fatal("expected error for non-YYYYMMDD date-stamp, got nil")
	}
	if after := readCounterNext(t, counterFile); after != before {
		t.Errorf("counter mutated on malformed date-stamp: before=%d after=%d", before, after)
	}
}

func TestRun_PreExistingStagedChangesFailBeforeMutationAndPreserveIndex(t *testing.T) {
	opts, counterFile, postsDir := newTestOptions(t, nil)
	repoRoot := opts.Cfg.RepoRoot
	operatorFile := filepath.Join(repoRoot, "operator-note.txt")
	if err := os.WriteFile(operatorFile, []byte("keep staged\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForDeployTest(t, repoRoot, "add", "operator-note.txt")
	stagedBefore := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-status")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}

	_, err = Run(context.Background(), opts)
	if err == nil {
		t.Fatal("expected fresh deploy to reject pre-existing staged changes")
	}
	if !strings.Contains(err.Error(), "pre-existing staged changes") || !strings.Contains(err.Error(), "operator-note.txt") {
		t.Fatalf("error = %q, want explicit staged-path refusal", err)
	}
	if stagedAfter := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-status"); stagedAfter != stagedBefore {
		t.Fatalf("operator staging changed: before=%q after=%q", stagedBefore, stagedAfter)
	}
	if headAfter := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD"); headAfter != headBefore {
		t.Fatalf("fresh deploy committed despite preflight refusal: before=%s after=%s", headBefore, headAfter)
	}
	counterAfter, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(counterAfter) != string(counterBefore) {
		t.Fatal("fresh deploy bumped the counter before staged-change refusal")
	}
	if _, err := os.Stat(filepath.Join(postsDir, opts.ActiveFilename)); err != nil {
		t.Fatalf("fresh deploy renamed the pending file before refusal: %v", err)
	}
}

func TestRun_ValidatorSystemicFailureStopsBeforeBuildCommitAndPush(t *testing.T) {
	opts, _, _ := newTestOptions(t, func(o *Options) {
		o.SkipValidate = false
		o.SkipBuild = false
		o.SkipPush = false
	})
	repoRoot := opts.Cfg.RepoRoot
	opts.Cfg.ValidatePosts = filepath.Join(repoRoot, "scripts", "validate-posts.mjs")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")

	binDir := t.TempDir()
	callsFile := filepath.Join(t.TempDir(), "calls.log")
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	fakeNode := "#!/bin/sh\nprintf 'validate\\n' >> \"$DEPLOY_TEST_CALLS\"\nprintf 'validator subprocess crashed before checking posts\\n'\nexit 7\n"
	fakeNPM := "#!/bin/sh\nprintf 'build\\n' >> \"$DEPLOY_TEST_CALLS\"\n"
	fakeGit := `#!/bin/sh
case "$1" in
  commit|push) printf 'git:%s\n' "$1" >> "$DEPLOY_TEST_CALLS" ;;
esac
exec "$DEPLOY_TEST_REAL_GIT" "$@"
`
	for name, contents := range map[string]string{"node": fakeNode, "npm": fakeNPM, "git": fakeGit} {
		if err := os.WriteFile(filepath.Join(binDir, name), []byte(contents), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("DEPLOY_TEST_CALLS", callsFile)
	t.Setenv("DEPLOY_TEST_REAL_GIT", realGit)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	_, err = Run(context.Background(), opts)
	if err == nil {
		t.Fatal("expected systemic validator failure to stop fresh deploy")
	}
	if !strings.Contains(err.Error(), "validate-posts") || !strings.Contains(err.Error(), "validator subprocess crashed") {
		t.Fatalf("error = %q, want validator failure and captured output", err)
	}
	calls, readErr := os.ReadFile(callsFile)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if got := strings.TrimSpace(string(calls)); got != "validate" {
		t.Fatalf("post-validator commands ran: %q; want validate only", got)
	}
	if headAfter := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD"); headAfter != headBefore {
		t.Fatalf("validator failure was committed: before=%s after=%s", headBefore, headAfter)
	}
	if staged := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-only"); staged != "" {
		t.Fatalf("validator failure left pipeline output staged: %q", staged)
	}
}

func TestRun_AllSlotsProvided_NoMalformedFilename(t *testing.T) {
	opts, _, postsDir := newTestOptions(t, nil)

	res, err := Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.Filename == "" {
		t.Fatal("expected a non-empty filename")
	}
	if !dateStampRe.MatchString(opts.DateStamp) {
		t.Fatalf("test setup bug: date-stamp %q should be valid", opts.DateStamp)
	}
	// Must not contain the "---" empty-slot signature from gu-log #546.
	if got := res.Filename; got == "sp-252---.mdx" {
		t.Fatalf("produced malformed filename: %s", got)
	}
	if _, err := os.Stat(filepath.Join(postsDir, res.Filename)); err != nil {
		t.Errorf("final filename not on disk: %v", err)
	}
}

func TestRunExisting_ValidatesBuildsCommitsWithoutCounterMutation(t *testing.T) {
	opts, counterFile, postsDir := newTestOptions(t, nil)
	repoRoot := opts.Cfg.RepoRoot
	existing := "sp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "SP-251"
	opts.SkipValidate = false
	opts.SkipBuild = false
	opts.Cfg.ValidatePosts = filepath.Join(repoRoot, "scripts", "validate-posts.mjs")

	// Recovery begins from a clean repository. The English sidecar is the
	// content created by the preceding translate step and must be published.
	runGitForDeployTest(t, repoRoot, "add", "-A")
	runGitForDeployTest(t, repoRoot, "commit", "-q", "-m", "existing baseline")
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	enFilename := "en-" + existing
	if err := os.WriteFile(filepath.Join(postsDir, enFilename), []byte("---\ntitle: \"Fake\"\n---\ntranslated\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	binDir := t.TempDir()
	callsFile := filepath.Join(t.TempDir(), "calls.log")
	fakeNode := "#!/bin/sh\nprintf 'validate:%s\\n' \"$1\" >> \"$DEPLOY_TEST_CALLS\"\n"
	fakeNPM := "#!/bin/sh\nprintf 'build:%s\\n' \"$*\" >> \"$DEPLOY_TEST_CALLS\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "node"), []byte(fakeNode), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "npm"), []byte(fakeNPM), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DEPLOY_TEST_CALLS", callsFile)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	res, err := RunExisting(context.Background(), opts)
	if err != nil {
		t.Fatalf("RunExisting: %v", err)
	}
	if res.Filename != existing || res.ENFilename != enFilename || res.PromptTicketID != "SP-251" {
		t.Fatalf("result = %+v", res)
	}
	calls, err := os.ReadFile(callsFile)
	if err != nil {
		t.Fatal(err)
	}
	wantCalls := "validate:" + opts.Cfg.ValidatePosts + "\nbuild:run build"
	if got := strings.TrimSpace(string(calls)); got != wantCalls {
		t.Fatalf("command order = %q, want %q", got, wantCalls)
	}
	if got := runGitForDeployTest(t, repoRoot, "log", "-1", "--format=%s"); got != "Update SP-251: Fake" {
		t.Fatalf("commit subject = %q", got)
	}
	if got := runGitForDeployTest(t, repoRoot, "status", "--porcelain"); got != "" {
		t.Fatalf("successful existing deploy left repo dirty:\n%s", got)
	}
	counterAfter, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(counterAfter) != string(counterBefore) {
		t.Fatal("existing deploy mutated the article counter")
	}
}

func TestRunExisting_NoContentChangesIsExplicitSuccess(t *testing.T) {
	opts, _, postsDir := newTestOptions(t, nil)
	repoRoot := opts.Cfg.RepoRoot
	existing := "sp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "SP-251"
	runGitForDeployTest(t, repoRoot, "add", "-A")
	runGitForDeployTest(t, repoRoot, "commit", "-q", "-m", "existing baseline")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")

	res, err := RunExisting(context.Background(), opts)
	if err != nil {
		t.Fatalf("RunExisting no-op: %v", err)
	}
	if res.Filename != existing || res.PromptTicketID != "SP-251" {
		t.Fatalf("result = %+v", res)
	}
	if headAfter := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD"); headAfter != headBefore {
		t.Fatalf("no-op deploy created a commit: before=%s after=%s", headBefore, headAfter)
	}
	if got := runGitForDeployTest(t, repoRoot, "status", "--porcelain"); got != "" {
		t.Fatalf("no-op existing deploy left repo dirty:\n%s", got)
	}
}

func TestRunExisting_PreExistingStagedChangesFailAndPreserveIndex(t *testing.T) {
	opts, _, postsDir := newTestOptions(t, nil)
	repoRoot := opts.Cfg.RepoRoot
	existing := "sp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "SP-251"
	runGitForDeployTest(t, repoRoot, "add", "-A")
	runGitForDeployTest(t, repoRoot, "commit", "-q", "-m", "existing baseline")

	enFilename := "en-" + existing
	if err := os.WriteFile(filepath.Join(postsDir, enFilename), []byte("---\ntitle: \"Fake\"\n---\ntranslated\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	operatorFile := filepath.Join(repoRoot, "operator-note.txt")
	if err := os.WriteFile(operatorFile, []byte("keep staged\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGitForDeployTest(t, repoRoot, "add", "operator-note.txt")
	stagedBefore := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-status")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")

	_, err := RunExisting(context.Background(), opts)
	if err == nil {
		t.Fatal("expected existing deploy to reject pre-existing staged changes")
	}
	if !strings.Contains(err.Error(), "pre-existing staged changes") || !strings.Contains(err.Error(), "operator-note.txt") {
		t.Fatalf("error = %q, want explicit staged-path refusal", err)
	}
	if stagedAfter := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-status"); stagedAfter != stagedBefore {
		t.Fatalf("operator staging changed: before=%q after=%q", stagedBefore, stagedAfter)
	}
	if got := runGitForDeployTest(t, repoRoot, "diff", "--cached", "--name-only", "--", "src/content/posts/"+enFilename); got != "" {
		t.Fatalf("existing deploy staged its sidecar before refusing: %q", got)
	}
	if headAfter := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD"); headAfter != headBefore {
		t.Fatalf("existing deploy committed despite preflight refusal: before=%s after=%s", headBefore, headAfter)
	}
	if _, err := os.Stat(filepath.Join(postsDir, enFilename)); err != nil {
		t.Fatalf("existing deploy removed the unstaged sidecar on refusal: %v", err)
	}
}

func TestValidateFilenameSlots(t *testing.T) {
	cases := []struct {
		name    string
		opts    Options
		wantErr bool
	}{
		{"all present", Options{DateStamp: "20260717", AuthorSlug: "a", TitleSlug: "t"}, false},
		{"all missing", Options{}, true},
		{"missing date-stamp", Options{AuthorSlug: "a", TitleSlug: "t"}, true},
		{"missing author-slug", Options{DateStamp: "20260717", TitleSlug: "t"}, true},
		{"missing title-slug", Options{DateStamp: "20260717", AuthorSlug: "a"}, true},
		{"malformed date-stamp (dashes)", Options{DateStamp: "2026-07-17", AuthorSlug: "a", TitleSlug: "t"}, true},
		{"malformed date-stamp (too short)", Options{DateStamp: "202607", AuthorSlug: "a", TitleSlug: "t"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFilenameSlots(tc.opts)
			if (err != nil) != tc.wantErr {
				t.Errorf("validateFilenameSlots(%+v) error = %v, wantErr %v", tc.opts, err, tc.wantErr)
			}
		})
	}
}
