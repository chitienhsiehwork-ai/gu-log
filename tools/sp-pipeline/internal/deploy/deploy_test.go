package deploy

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
)

// initGitRepo makes dir a minimal git repo with one commit, so gitAdd/
// gitCommit in Run() have something to work against. Mirrors
// internal/pipeline/phase3_test.go's initRepo helper (unexported there,
// duplicated here since it's package-private).
func initGitRepo(t *testing.T, dir string) {
	t.Helper()
	run := func(args ...string) {
		cmd := exec.Command("git", append([]string{"-c", "core.hooksPath=/dev/null"}, args...)...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_AUTHOR_NAME=Test", "GIT_AUTHOR_EMAIL=test@example.com",
			"GIT_COMMITTER_NAME=Test", "GIT_COMMITTER_EMAIL=test@example.com",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init", "-q", "-b", "main")
	run("config", "user.email", "test@example.com")
	run("config", "user.name", "Test")
	run("config", "commit.gpgSign", "false")
	seed := filepath.Join(dir, ".seed")
	if err := os.WriteFile(seed, []byte("seed"), 0o644); err != nil {
		t.Fatal(err)
	}
	run("add", ".seed")
	run("commit", "-q", "-m", "seed", "--no-verify", "--no-gpg-sign")
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
