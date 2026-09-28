package deploy

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

func TestRunRejectsRetiredPendingBeforeCounterBump(t *testing.T) {
	root := t.TempDir()
	postsDir := filepath.Join(root, "src", "content", "posts")
	scriptsDir := filepath.Join(root, "scripts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(scriptsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	counterPath := filepath.Join(scriptsDir, "article-counter.json")
	counterBody := `{
  "GP": {"next": 259, "label": "Gu-log Picks", "description": "test"},
  "MP": {"next": 315, "label": "Mogu Picks", "description": "test"},
  "SD": {"next": 32, "label": "ShroomDog Original", "description": "test"},
  "Lv": {"next": 18, "label": "Level-Up", "description": "test"}
}
`
	if err := os.WriteFile(counterPath, []byte(counterBody), 0o644); err != nil {
		t.Fatal(err)
	}
	pendingName := "gp-pending-20260716-test.mdx"
	pending := "---\nticketId: \"SP-PENDING\"\n---\nbody\n"
	if err := os.WriteFile(filepath.Join(postsDir, pendingName), []byte(pending), 0o644); err != nil {
		t.Fatal(err)
	}

	c := counter.New(counterPath, filepath.Join(root, "counter.lock"))
	_, err := Run(context.Background(), Options{
		Cfg:            &config.Config{RepoRoot: root, ScriptsDir: scriptsDir, PostsDir: postsDir, CounterFile: counterPath},
		Log:            logx.New(),
		Counter:        c,
		Prefix:         "GP",
		ActiveFilename: pendingName,
		DateStamp:      "20260716",
		AuthorSlug:     "test",
		TitleSlug:      "title",
		SkipBuild:      true,
		SkipPush:       true,
		SkipValidate:   true,
	})
	if err == nil || !strings.Contains(err.Error(), "expected GP-PENDING") {
		t.Fatalf("error = %v, want canonical pending diagnostic", err)
	}
	next, readErr := c.Next("GP")
	if readErr != nil {
		t.Fatal(readErr)
	}
	if next != 259 {
		t.Fatalf("counter advanced on rejected retired input: next = %d", next)
	}
}

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
// completely untouched — no counter bump, no rename, no commit. The pending
// file carries the canonical GP-PENDING ticket so the taxonomy gate in Run()
// passes and the tests exercise the mutation-guard behaviour they target.
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
  "GP": { "next": 252, "label": "Gu-log Picks", "description": "test" },
  "MP": { "next": 1, "label": "Mogu Picks", "description": "test" },
  "SD": { "next": 1, "label": "ShroomDog Original", "description": "test" },
  "Lv": { "next": 1, "label": "Level-Up", "description": "test" }
}
`
	if err := os.WriteFile(counterFile, []byte(seed), 0o644); err != nil {
		t.Fatal(err)
	}

	pendingName := "gp-pending-20260717-fakeauthor-faketitle.mdx"
	if err := os.WriteFile(filepath.Join(postsDir, pendingName), []byte("---\ntitle: \"Fake\"\nticketId: \"GP-PENDING\"\n---\nbody\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	initGitRepo(t, tmp)

	opts := Options{
		Cfg:            &config.Config{RepoRoot: tmp, PostsDir: postsDir, CounterFile: counterFile},
		Log:            logx.New(),
		Counter:        counter.New(counterFile, filepath.Join(tmp, ".counter.lock")),
		Prefix:         "GP",
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
	return parsed["GP"].Next
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

func TestRun_NonCanonicalSlugFailsBeforeCounterBump(t *testing.T) {
	for _, tc := range []struct {
		name     string
		override func(*Options)
	}{
		{name: "author traversal", override: func(o *Options) { o.AuthorSlug = "../escape" }},
		{name: "title path separator", override: func(o *Options) { o.TitleSlug = "nested/title" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts, counterFile, postsDir := newTestOptions(t, tc.override)
			before := readCounterNext(t, counterFile)
			entriesBefore, err := os.ReadDir(postsDir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "canonical lowercase ASCII slug") {
				t.Fatalf("Run error = %v, want canonical slug rejection", err)
			}
			if after := readCounterNext(t, counterFile); after != before {
				t.Fatalf("counter mutated on slug rejection: before=%d after=%d", before, after)
			}
			entriesAfter, err := os.ReadDir(postsDir)
			if err != nil {
				t.Fatal(err)
			}
			if len(entriesAfter) != len(entriesBefore) {
				t.Fatalf("posts dir mutated on slug rejection: before=%d after=%d", len(entriesBefore), len(entriesAfter))
			}
		})
	}
}

func TestRun_PathLikeActiveFilenameFailsBeforeCounterBump(t *testing.T) {
	for _, tc := range []struct {
		name     string
		override func(*Options)
	}{
		{name: "active traversal", override: func(o *Options) { o.ActiveFilename = "gp-pending-../../escape.mdx" }},
		{name: "English traversal", override: func(o *Options) { o.ActiveENFilename = "en-gp-pending-../escape.mdx" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			opts, counterFile, postsDir := newTestOptions(t, tc.override)
			before := readCounterNext(t, counterFile)
			entriesBefore, err := os.ReadDir(postsDir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := Run(context.Background(), opts); err == nil || !strings.Contains(err.Error(), "must be a basename") {
				t.Fatalf("Run error = %v, want basename rejection", err)
			}
			if after := readCounterNext(t, counterFile); after != before {
				t.Fatalf("counter mutated on basename rejection: before=%d after=%d", before, after)
			}
			entriesAfter, err := os.ReadDir(postsDir)
			if err != nil {
				t.Fatal(err)
			}
			if len(entriesAfter) != len(entriesBefore) {
				t.Fatalf("posts dir mutated on basename rejection: before=%d after=%d", len(entriesBefore), len(entriesAfter))
			}
		})
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
	opts, counterFile, postsDir := newTestOptions(t, func(o *Options) {
		o.SkipValidate = false
		o.SkipBuild = false
		o.SkipPush = false
	})
	repoRoot := opts.Cfg.RepoRoot
	opts.Cfg.ValidatePosts = filepath.Join(repoRoot, "scripts", "validate-posts.mjs")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	pendingPath := filepath.Join(postsDir, opts.ActiveFilename)
	finalPath := filepath.Join(postsDir, "gp-252-20260717-fakeauthor-faketitle.mdx")

	binDir := t.TempDir()
	callsFile := filepath.Join(t.TempDir(), "calls.log")
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Fatal(err)
	}
	fakeNode := "#!/bin/sh\nprintf 'validate\\n' >> \"$DEPLOY_TEST_CALLS\"\nprintf 'validator subprocess crashed before checking posts\\n'\nexit 7\n"
	fakePnpm := "#!/bin/sh\nprintf 'build\\n' >> \"$DEPLOY_TEST_CALLS\"\n"
	fakeGit := `#!/bin/sh
case "$1" in
  commit|push) printf 'git:%s\n' "$1" >> "$DEPLOY_TEST_CALLS" ;;
esac
exec "$DEPLOY_TEST_REAL_GIT" "$@"
`
	for name, contents := range map[string]string{"node": fakeNode, "pnpm": fakePnpm, "git": fakeGit} {
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
	counterAfter, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	if string(counterAfter) != string(counterBefore) {
		t.Fatal("validator failure mutated the article counter before publish")
	}
	if _, err := os.Stat(pendingPath); err != nil {
		t.Fatalf("validator failure moved the pending post: %v", err)
	}
	if _, err := os.Stat(finalPath); !os.IsNotExist(err) {
		t.Fatalf("validator failure created final post before allocation gate: err=%v", err)
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
	if got := res.Filename; got == "gp-252---.mdx" {
		t.Fatalf("produced malformed filename: %s", got)
	}
	if _, err := os.Stat(filepath.Join(postsDir, res.Filename)); err != nil {
		t.Errorf("final filename not on disk: %v", err)
	}
}

func TestRunExisting_ValidatesBuildsCommitsWithoutCounterMutation(t *testing.T) {
	opts, counterFile, postsDir := newTestOptions(t, nil)
	repoRoot := opts.Cfg.RepoRoot
	existing := "gp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "GP-251"
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
	fakePnpm := "#!/bin/sh\nprintf 'build:%s\\n' \"$*\" >> \"$DEPLOY_TEST_CALLS\"\n"
	if err := os.WriteFile(filepath.Join(binDir, "node"), []byte(fakeNode), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(binDir, "pnpm"), []byte(fakePnpm), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DEPLOY_TEST_CALLS", callsFile)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	res, err := RunExisting(context.Background(), opts)
	if err != nil {
		t.Fatalf("RunExisting: %v", err)
	}
	if res.Filename != existing || res.ENFilename != enFilename || res.PromptTicketID != "GP-251" {
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
	if got := runGitForDeployTest(t, repoRoot, "log", "-1", "--format=%s"); got != "Update GP-251: Fake" {
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
	existing := "gp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "GP-251"
	runGitForDeployTest(t, repoRoot, "add", "-A")
	runGitForDeployTest(t, repoRoot, "commit", "-q", "-m", "existing baseline")
	headBefore := runGitForDeployTest(t, repoRoot, "rev-parse", "HEAD")

	res, err := RunExisting(context.Background(), opts)
	if err != nil {
		t.Fatalf("RunExisting no-op: %v", err)
	}
	if res.Filename != existing || res.PromptTicketID != "GP-251" {
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
	existing := "gp-251-20260717-fakeauthor-faketitle.mdx"
	if err := os.Rename(filepath.Join(postsDir, opts.ActiveFilename), filepath.Join(postsDir, existing)); err != nil {
		t.Fatal(err)
	}
	opts.ActiveFilename = existing
	opts.TicketID = "GP-251"
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
		{"author slash", Options{DateStamp: "20260717", AuthorSlug: "/", TitleSlug: "t"}, true},
		{"author dot", Options{DateStamp: "20260717", AuthorSlug: ".", TitleSlug: "t"}, true},
		{"author dot-dot", Options{DateStamp: "20260717", AuthorSlug: "..", TitleSlug: "t"}, true},
		{"author traversal", Options{DateStamp: "20260717", AuthorSlug: "../escape", TitleSlug: "t"}, true},
		{"title slash", Options{DateStamp: "20260717", AuthorSlug: "a", TitleSlug: "nested/title"}, true},
		{"title backslash", Options{DateStamp: "20260717", AuthorSlug: "a", TitleSlug: `nested\title`}, true},
		{"uppercase", Options{DateStamp: "20260717", AuthorSlug: "Author", TitleSlug: "t"}, true},
		{"underscore", Options{DateStamp: "20260717", AuthorSlug: "a", TitleSlug: "not_canonical"}, true},
		{"repeated dash", Options{DateStamp: "20260717", AuthorSlug: "a", TitleSlug: "double--dash"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFilenameSlots(tc.opts)
			if (err != nil) != tc.wantErr {
				t.Errorf("ValidateFilenameSlots(%+v) error = %v, wantErr %v", tc.opts, err, tc.wantErr)
			}
		})
	}
}

func TestValidatePostBasenames(t *testing.T) {
	for _, tc := range []struct {
		name     string
		active   string
		activeEN string
		wantErr  bool
	}{
		{name: "zh only", active: "gp-pending-example.mdx"},
		{name: "paired", active: "gp-pending-example.mdx", activeEN: "en-gp-pending-example.mdx"},
		{name: "slash", active: "gp-pending/nested.mdx", wantErr: true},
		{name: "dot-dot", active: "..", wantErr: true},
		{name: "traversal", active: "gp-pending-../../escape.mdx", wantErr: true},
		{name: "backslash", active: `gp-pending-..\escape.mdx`, wantErr: true},
		{name: "English traversal", active: "gp-pending-example.mdx", activeEN: "en-gp-pending-../escape.mdx", wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidatePostBasenames(tc.active, tc.activeEN)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidatePostBasenames(%q, %q) error = %v, wantErr %v", tc.active, tc.activeEN, err, tc.wantErr)
			}
		})
	}
}
