package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// Lv is written by hand (CONTRIBUTING.md): run, write, review, refine, ralph,
// and credits refuse it at ingress, before any work dir, external program,
// model route, counter change, or file write (openspec
// gp-pipeline-publish-integrity). A missing fake-provider spec makes a model
// route fail with a different error, and trap programs on PATH record any
// external call.

// trapExternalPrograms puts a recording stand-in for every external program a
// command could reach first on PATH and returns the log they append to.
func trapExternalPrograms(t *testing.T) string {
	t.Helper()
	trapDir := t.TempDir()
	for _, name := range []string{"bash", "curl", "yt-dlp", "python3", "node", "codex", "claude", "git", "pnpm"} {
		writeExecutableFile(t, filepath.Join(trapDir, name), "#!/bin/sh\nprintf '%s\\n' \"$0 $*\" >> \"$GP_INGRESS_TRAP_LOG\"\nexit 99\n")
	}
	trapLog := filepath.Join(t.TempDir(), "trap.log")
	t.Setenv("GP_INGRESS_TRAP_LOG", trapLog)
	t.Setenv("PATH", trapDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	return trapLog
}

// executeCLI runs one gp-pipeline invocation from fresh package globals.
func executeCLI(t *testing.T, args ...string) error {
	t.Helper()
	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs(args)
	_, err := captureProcessStdout(t, func() error {
		return cmd.ExecuteContext(context.Background())
	})
	return err
}

func requireLvRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "CONTRIBUTING.md") {
		t.Fatalf("error = %v (exit %d), want the exit-1 Lv refusal pointing to CONTRIBUTING.md", err, exitCodeFor(err))
	}
}

func requireNoExternalCalls(t *testing.T, trapLog string) {
	t.Helper()
	if raw, err := os.ReadFile(trapLog); err == nil {
		t.Fatalf("external programs ran:\n%s", raw)
	}
}

func requireBytes(t *testing.T, path string, want []byte) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("%s changed: %q, %v", path, got, err)
	}
}

func requireAbsent(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("%s exists: %v", path, err)
	}
}

func TestRunRefusesLvBeforeWritingSteps(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	posts := map[string]string{
		"lv-18-20261011-example.mdx":             "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: zh-tw\n---\nbody\n",
		"levelup-20260701-core-dump-anatomy.mdx": "---\ntitle: \"Lv\"\nticketId: Lv-13\nlang: zh-tw\n---\nbody\n",
	}
	for filename, body := range posts {
		mustWrite(t, filepath.Join(postsDir, filename), body)
	}
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	counterFile := filepath.Join(root, "scripts", "article-counter.json")
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}

	type runCase struct {
		name string
		args []string
	}
	cases := []runCase{
		{name: "URL", args: []string{"run", "https://x.com/author/status/1", "--prefix", "Lv"}},
		{name: "URL dry-run", args: []string{"run", "https://x.com/author/status/1", "--prefix", "Lv", "--dry-run"}},
		{name: "deploy without --file", args: []string{"run", "--prefix", "Lv", "--from-step", "deploy"}},
	}
	for filename := range posts {
		cases = append(cases, runCase{name: filename + " from the start", args: []string{"run", "--file", filename}})
		for _, step := range []string{"write", "refine", "ralph"} {
			cases = append(cases, runCase{name: filename + " from " + step, args: []string{"run", "--file", filename, "--from-step", step}})
		}
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			workDir := filepath.Join(t.TempDir(), "never-created")
			err := executeCLI(t, append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json")}, tc.args...)...)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireAbsent(t, workDir)
			requireBytes(t, counterFile, counterBefore)
			for filename, body := range posts {
				requireBytes(t, filepath.Join(postsDir, filename), []byte(body))
			}
		})
	}
}

// TestRunRefusesLvBeforeYTDLPPreflight: without yt-dlp, an Lv YouTube run gets
// the Lv refusal (exit 1), not the missing-dependency exit 10.
func TestRunRefusesLvBeforeYTDLPPreflight(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	t.Setenv("PATH", t.TempDir())
	workDir := filepath.Join(t.TempDir(), "never-created")
	err := executeCLI(t, "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
		"run", "https://youtube.com/watch?v=dQw4w9WgXcQ", "--prefix", "Lv")
	requireLvRefusal(t, err)
	requireAbsent(t, workDir)
}

func TestWriteRefusesLv(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	source := filepath.Join(t.TempDir(), "source-tweet.md")
	mustWrite(t, source, "source")
	workDir := filepath.Join(t.TempDir(), "never-created")

	err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"),
		"write", "--prefix", "Lv", "--source", source, "--work-dir", workDir)
	requireLvRefusal(t, err)
	requireNoExternalCalls(t, trapLog)
	requireAbsent(t, workDir)
}

// TestReviewAndRefineRefuseLvDrafts: --ticket-id defaults to GP-PENDING, so the
// draft's own ticketId is checked as well; either one naming Lv is refused.
func TestReviewAndRefineRefuseLvDrafts(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	for _, command := range []string{"review", "refine"} {
		for name, tc := range map[string]struct {
			draft string
			args  []string
		}{
			"--ticket-id Lv-PENDING":            {draft: "---\ntitle: \"Draft\"\n---\nbody\n", args: []string{"--ticket-id", "Lv-PENDING"}},
			"Lv draft without --ticket-id":      {draft: "---\ntitle: \"Draft\"\nticketId: \"Lv-PENDING\"\n---\nbody\n"},
			"unquoted Lv draft, GP --ticket-id": {draft: "---\ntitle: \"Draft\"\nticketId: Lv-PENDING\n---\nbody\n", args: []string{"--ticket-id", "GP-PENDING"}},
		} {
			t.Run(command+" "+name, func(t *testing.T) {
				workDir := t.TempDir()
				draft := filepath.Join(workDir, "draft-v1.mdx")
				mustWrite(t, draft, tc.draft)
				err := executeCLI(t, append([]string{"--fake-provider", filepath.Join(root, "missing.json"), command, "--draft", draft}, tc.args...)...)
				requireLvRefusal(t, err)
				requireNoExternalCalls(t, trapLog)
				requireBytes(t, draft, []byte(tc.draft))
				entries, err := os.ReadDir(workDir)
				if err != nil || len(entries) != 1 {
					t.Fatalf("work dir holds %d entries (%v), want only the draft", len(entries), err)
				}
			})
		}
		// The model reads the work dir's draft-v1.mdx, which need not be --draft.
		t.Run(command+" GP --draft, Lv draft-v1.mdx in --work-dir", func(t *testing.T) {
			const gpDraft = "---\ntitle: \"Draft\"\nticketId: GP-PENDING\n---\nbody\n"
			const lvDraft = "---\ntitle: \"Draft\"\nticketId: Lv-PENDING\n---\nbody\n"
			draft := filepath.Join(t.TempDir(), "draft-v1.mdx")
			mustWrite(t, draft, gpDraft)
			workDir := t.TempDir()
			read := filepath.Join(workDir, "draft-v1.mdx")
			mustWrite(t, read, lvDraft)
			err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"), command, "--draft", draft, "--work-dir", workDir)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, read, []byte(lvDraft))
			entries, err := os.ReadDir(workDir)
			if err != nil || len(entries) != 1 {
				t.Fatalf("work dir holds %d entries (%v), want only the Lv draft", len(entries), err)
			}
		})
	}
}

// TestRalphAndCreditsRefuseLvPosts: an Lv post, by filename (lv-, levelup-,
// en- sidecars) or by frontmatter ticketId, never reaches Tribunal, the
// post-fixers, or the pipeline credit stamp.
func TestRalphAndCreditsRefuseLvPosts(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Real scripts, so only the refusal keeps the trapped bash and node away.
	mustWrite(t, filepath.Join(root, "scripts", "tribunal.sh"), "exit 0\n")
	for _, fixer := range []string{"add-kaomoji.mjs", "apply-glossary-links.mjs", "inject-related-posts.mjs"} {
		mustWrite(t, filepath.Join(root, "scripts", fixer), "")
	}
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	const lvPost = "---\ntitle: \"Lv\"\nticketId: \"Lv-PENDING\"\nlang: zh-tw\n---\nbody\n"
	const untaggedPost = "---\ntitle: \"Lv\"\nlang: zh-tw\n---\nbody\n"

	for filename, body := range map[string]string{
		"lv-40-20261012-example.mdx":             untaggedPost,
		"levelup-20260701-core-dump-anatomy.mdx": untaggedPost,
		"en-lv-40-20261012-example.mdx":          untaggedPost,
		"mp-pending-20261012-author-title.mdx":   lvPost,
	} {
		t.Run("ralph "+filename, func(t *testing.T) {
			path := filepath.Join(postsDir, filename)
			mustWrite(t, path, body)
			workDir := filepath.Join(t.TempDir(), "never-created")
			err := executeCLI(t, "ralph", "--file", filename, "--work-dir", workDir)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireAbsent(t, workDir)
			requireBytes(t, path, []byte(body))
		})
	}

	for filename, body := range map[string]string{
		"lv-40-20261012-example.mdx": untaggedPost,
		"final.mdx":                  lvPost,
	} {
		t.Run("credits "+filename, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), filename)
			mustWrite(t, path, body)
			err := executeCLI(t, "credits", "--file", path)
			requireLvRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, path, []byte(body))
		})
	}

	// A --file named final.mdx gets the stamp on the work dir's final.mdx.
	t.Run("credits GP final.mdx, Lv final.mdx in --work-dir", func(t *testing.T) {
		const gpPost = "---\ntitle: \"GP\"\nticketId: \"GP-PENDING\"\nlang: zh-tw\n---\nbody\n"
		file := filepath.Join(t.TempDir(), "final.mdx")
		mustWrite(t, file, gpPost)
		workDir := t.TempDir()
		stamped := filepath.Join(workDir, "final.mdx")
		mustWrite(t, stamped, lvPost)
		err := executeCLI(t, "credits", "--file", file, "--work-dir", workDir)
		requireLvRefusal(t, err)
		requireNoExternalCalls(t, trapLog)
		requireBytes(t, stamped, []byte(lvPost))
		requireBytes(t, file, []byte(gpPost))
	})
}

// TestLvKeepsNonWritingSteps: a hand-written Lv still gets its number, its
// English version, and its deploy from the pipeline. run --from-step translate
// is covered by TestRunCommand_FromStepTranslateDryRunReportsSidecarAndSkipsGitMutations.
func TestLvKeepsNonWritingSteps(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	const filename = "lv-18-20261011-example.mdx"
	const zhPost = "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: zh-tw\n---\n中文內容。\n"
	zhPath := filepath.Join(postsDir, filename)
	mustWrite(t, zhPath, zhPost)
	fakeSpec, err := json.Marshal(map[string]any{
		"model":     "claude-opus-5",
		"responses": []map[string]string{{"output": "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: \"en\"\n---\nEnglish body.\n"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	fakePath := filepath.Join(root, "fake-provider.json")
	mustWrite(t, fakePath, string(fakeSpec))
	t.Setenv("GU_LOG_DIR", root)

	t.Run("translate --file", func(t *testing.T) {
		if err := executeCLI(t, "--fake-provider", fakePath, "translate", "--file", filename, "--work-dir", t.TempDir()); err != nil {
			t.Fatalf("translate --file %s: %v", filename, err)
		}
		if _, err := os.Stat(filepath.Join(postsDir, "en-"+filename)); err != nil {
			t.Fatalf("English sidecar not written: %v", err)
		}
		requireBytes(t, zhPath, []byte(zhPost))
	})

	t.Run("counter bump", func(t *testing.T) {
		if err := executeCLI(t, "counter", "bump", "--prefix", "Lv"); err != nil {
			t.Fatalf("counter bump --prefix Lv: %v", err)
		}
		raw, err := os.ReadFile(filepath.Join(root, "scripts", "article-counter.json"))
		if err != nil {
			t.Fatal(err)
		}
		var counters map[string]struct {
			Next int `json:"next"`
		}
		if err := json.Unmarshal(raw, &counters); err != nil {
			t.Fatal(err)
		}
		if counters["Lv"].Next != 41 {
			t.Fatalf("Lv counter next = %d, want 41 after one bump", counters["Lv"].Next)
		}
	})

	t.Run("standalone deploy", func(t *testing.T) {
		if err := executeCLI(t, "deploy", "--active-file", "lv-pending-20261012-author-title.mdx",
			"--date-stamp", "20261012", "--author-slug", "author", "--title-slug", "title", "--dry-run"); err != nil {
			t.Fatalf("deploy dry-run of an Lv pending file: %v", err)
		}
	})

	t.Run("run --from-step deploy", func(t *testing.T) {
		emptyFake := filepath.Join(t.TempDir(), "fake.json")
		mustWrite(t, emptyFake, `{"responses":[]}`)
		if err := executeCLI(t, "--json", "--work-dir", t.TempDir(), "--fake-provider", emptyFake,
			"run", "--file", filename, "--from-step", "deploy", "--dry-run"); err != nil {
			t.Fatalf("run --from-step deploy for an Lv post: %v", err)
		}
	})
}

// TestSDRunPassesLvRefusal: SD keeps the writing pipeline. A run reaches its
// model route (the missing fake-provider spec) instead of the Lv refusal; the
// SD ralph cases live in TestStandaloneRalphInfersSeriesFromFilename.
func TestSDRunPassesLvRefusal(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	err := executeCLI(t, "--work-dir", filepath.Join(t.TempDir(), "work"), "--fake-provider", filepath.Join(root, "missing.json"),
		"run", "https://x.com/author/status/1", "--prefix", "SD")
	if err == nil || !strings.Contains(err.Error(), "missing.json") || strings.Contains(err.Error(), "CONTRIBUTING.md") {
		t.Fatalf("error = %v, want SD to reach its model route", err)
	}
}

// TestSeriesHelpMatchesWhatEachCommandServes: the writing commands offer only
// the series the pipeline writes, while the commands Lv still uses keep
// offering Lv.
func TestSeriesHelpMatchesWhatEachCommandServes(t *testing.T) {
	root := buildRoot()
	for _, tc := range []struct {
		path   []string
		flag   string
		wantLv bool
	}{
		{path: []string{"write"}, flag: "prefix"},
		{path: []string{"run"}, flag: "prefix"},
		{path: []string{"counter", "bump"}, flag: "prefix", wantLv: true},
		{path: []string{"counter", "next"}, flag: "prefix", wantLv: true},
		{path: []string{"dedup"}, flag: "series", wantLv: true},
		{path: []string{"deploy"}, flag: "prefix", wantLv: true},
	} {
		t.Run(strings.Join(tc.path, " "), func(t *testing.T) {
			cmd, _, err := root.Find(tc.path)
			if err != nil {
				t.Fatal(err)
			}
			flag := cmd.Flags().Lookup(tc.flag)
			if flag == nil {
				t.Fatalf("no --%s flag", tc.flag)
			}
			for _, series := range pipeline.AuthorablePrefixes {
				if !strings.Contains(flag.Usage, series) {
					t.Errorf("--%s usage %q does not list %s", tc.flag, flag.Usage, series)
				}
			}
			if got := strings.Contains(flag.Usage, "Lv"); got != tc.wantLv {
				t.Errorf("--%s usage %q lists Lv = %v, want %v", tc.flag, flag.Usage, got, tc.wantLv)
			}
		})
	}
	for _, name := range []string{"write", "review", "refine"} {
		cmd, _, err := root.Find([]string{name})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(cmd.Long, "Lv") {
			t.Errorf("%s --help still names Lv among the series it writes", name)
		}
	}
}

// TestLvRefusalNamesAnExistingSection keeps the refusal and the
// CONTRIBUTING.md heading it points at in step.
func TestLvRefusalNamesAnExistingSection(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "CONTRIBUTING.md"))
	if err != nil {
		t.Fatal(err)
	}
	heading := "### " + pipeline.LvWorkflowSection
	if !slices.Contains(strings.Split(string(raw), "\n"), heading) {
		t.Fatalf("CONTRIBUTING.md has no %q heading for the Lv refusal to point at", heading)
	}
}
