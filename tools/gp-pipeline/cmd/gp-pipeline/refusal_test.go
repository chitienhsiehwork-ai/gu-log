package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// Lv is written by hand (CONTRIBUTING.md) and GP is a published MP that
// ShroomDog promotes with scripts/reclassify-post.mjs, so run, write, review,
// refine, and ralph refuse both at ingress, before any work dir, external
// program, model route, counter change, or file write (openspec
// gp-pipeline-publish-integrity). A missing fake-provider spec makes a model
// route fail with a different error, and trap programs on PATH record any
// external call. What only one series does is in lv_refusal_test.go and
// gp_refusal_test.go.

// refusedSeries is a series no writing command accepts.
type refusedSeries struct {
	prefix  string
	refused func(*testing.T, error) // the series' exit-1 refusal
	posts   map[string]string       // numbered posts of the series
	names   []string                // filenames that name the series without a ticketId
}

var refusedSeriesCases = []refusedSeries{
	{
		prefix:  "Lv",
		refused: requireLvRefusal,
		posts: map[string]string{
			"lv-18-20261011-example.mdx":             "---\ntitle: \"Lv\"\nticketId: Lv-18\nlang: zh-tw\n---\nbody\n",
			"levelup-20260701-core-dump-anatomy.mdx": "---\ntitle: \"Lv\"\nticketId: Lv-13\nlang: zh-tw\n---\nbody\n",
		},
		names: []string{"lv-40-20261012-example.mdx", "levelup-20260701-core-dump-anatomy.mdx", "en-lv-40-20261012-example.mdx"},
	},
	{
		prefix:  "GP",
		refused: requireGPRefusal,
		posts:   map[string]string{"gp-10-20261012-author-title.mdx": gpPostBody},
		names:   []string{"gp-10-20261012-example.mdx", "en-gp-10-20261012-example.mdx"},
	},
}

// draft is a pending draft of the series, with the ticketId quoted or not.
func (s refusedSeries) draft(quoted bool) string {
	ticket := s.prefix + "-PENDING"
	if quoted {
		ticket = `"` + ticket + `"`
	}
	return "---\ntitle: \"Draft\"\nticketId: " + ticket + "\n---\nbody\n"
}

// eachRefusedSeries runs fn as one subtest per refused series.
func eachRefusedSeries(t *testing.T, fn func(t *testing.T, s refusedSeries)) {
	for _, s := range refusedSeriesCases {
		t.Run(s.prefix, func(t *testing.T) { fn(t, s) })
	}
}

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

// dirNames lists the entry names in dir, sorted.
func dirNames(t *testing.T, dir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names
}

// postsRepo is a fake repo whose posts dir holds posts; it returns the root,
// the posts dir, and the counter file with its bytes.
func postsRepo(t *testing.T, posts map[string]string) (root, postsDir, counterFile string, counter []byte) {
	t.Helper()
	root = makeFakeRepo(t)
	postsDir = filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for filename, body := range posts {
		mustWrite(t, filepath.Join(postsDir, filename), body)
	}
	t.Setenv("GU_LOG_DIR", root)
	counterFile = filepath.Join(root, "scripts", "article-counter.json")
	counter, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	return root, postsDir, counterFile, counter
}

func TestRunRefusesLvAndGPBeforeWritingSteps(t *testing.T) {
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root, postsDir, counterFile, counterBefore := postsRepo(t, s.posts)
		trapLog := trapExternalPrograms(t)
		cases := map[string][]string{
			"URL":                   {"run", "https://x.com/author/status/1", "--prefix", s.prefix},
			"URL dry-run":           {"run", "https://x.com/author/status/1", "--prefix", s.prefix, "--dry-run"},
			"deploy without --file": {"run", "--prefix", s.prefix, "--from-step", "deploy"},
		}
		for filename := range s.posts {
			cases[filename+" from the start"] = []string{"run", "--file", filename}
			for _, step := range []string{"write", "refine", "ralph"} {
				cases[filename+" from "+step] = []string{"run", "--file", filename, "--from-step", step}
			}
		}
		for name, args := range cases {
			t.Run(name, func(t *testing.T) {
				workDir := filepath.Join(t.TempDir(), "never-created")
				err := executeCLI(t, append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json")}, args...)...)
				s.refused(t, err)
				requireNoExternalCalls(t, trapLog)
				requireAbsent(t, workDir)
				requireBytes(t, counterFile, counterBefore)
				for filename, body := range s.posts {
					requireBytes(t, filepath.Join(postsDir, filename), []byte(body))
				}
			})
		}
	})
}

// TestRunRefusesLvAndGPBeforeYTDLPPreflight: without yt-dlp, a YouTube run of
// either series gets the refusal (exit 1), not the missing-dependency exit 10.
func TestRunRefusesLvAndGPBeforeYTDLPPreflight(t *testing.T) {
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root := makeFakeRepo(t)
		t.Setenv("GU_LOG_DIR", root)
		t.Setenv("PATH", t.TempDir())
		workDir := filepath.Join(t.TempDir(), "never-created")
		err := executeCLI(t, "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
			"run", "https://youtube.com/watch?v=dQw4w9WgXcQ", "--prefix", s.prefix)
		s.refused(t, err)
		requireAbsent(t, workDir)
	})
}

// TestRunRefusesLvAndGPDraftInResumedWorkDir: a run resumed after write reuses
// the work dir's draft-v1.mdx and final.mdx, so one of either series there is
// refused whichever series --prefix or --file names. No --dry-run: a deploy
// that got past the refusal would allocate a number and move files.
func TestRunRefusesLvAndGPDraftInResumedWorkDir(t *testing.T) {
	const sdFile = "sd-10-20261012-author-title.mdx"
	const sdPost = "---\ntitle: \"SD\"\nticketId: SD-10\nlang: zh-tw\n---\nbody\n"
	cases := []struct {
		name string
		file string // the work dir file holding the refused draft
		args []string
	}{
		{name: "MP from review, draft-v1.mdx", file: "draft-v1.mdx", args: []string{"--prefix", "MP", "--from-step", "review"}},
		{name: "SD from ralph, final.mdx", file: "final.mdx", args: []string{"--prefix", "SD", "--from-step", "ralph"}},
		{name: "SD --file from ralph, final.mdx", file: "final.mdx", args: []string{"--file", sdFile, "--from-step", "ralph"}},
		{name: "MP from deploy, final.mdx", file: "final.mdx", args: []string{"--prefix", "MP", "--from-step", "deploy"}},
	}
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root, postsDir, counterFile, counterBefore := postsRepo(t, map[string]string{sdFile: sdPost})
		trapLog := trapExternalPrograms(t)
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				draft := s.draft(false)
				workDir := t.TempDir()
				mustWrite(t, filepath.Join(workDir, tc.file), draft)
				err := executeCLI(t, append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"), "run"}, tc.args...)...)
				s.refused(t, err)
				requireNoExternalCalls(t, trapLog)
				requireBytes(t, filepath.Join(workDir, tc.file), []byte(draft))
				requireBytes(t, counterFile, counterBefore)
				if got := dirNames(t, workDir); !slices.Equal(got, []string{tc.file}) {
					t.Fatalf("work dir holds %v, want only %s", got, tc.file)
				}
				if got := dirNames(t, postsDir); !slices.Equal(got, []string{sdFile}) {
					t.Fatalf("posts dir holds %v, want only %s", got, sdFile)
				}
			})
		}
	})

	// Control: the same resume from an MP draft reaches its model route.
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	workDir := t.TempDir()
	mustWrite(t, filepath.Join(workDir, "draft-v1.mdx"), "---\ntitle: \"Draft\"\nticketId: MP-PENDING\n---\nbody\n")
	err := executeCLI(t, "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
		"run", "--dry-run", "--prefix", "MP", "--from-step", "review")
	if err == nil || !strings.Contains(err.Error(), "missing.json") {
		t.Fatalf("error = %v, want the MP resume to reach its model route", err)
	}
}

func TestWriteRefusesLvAndGP(t *testing.T) {
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root := makeFakeRepo(t)
		t.Setenv("GU_LOG_DIR", root)
		trapLog := trapExternalPrograms(t)
		source := filepath.Join(t.TempDir(), "source-tweet.md")
		mustWrite(t, source, "source")
		workDir := filepath.Join(t.TempDir(), "never-created")

		err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"),
			"write", "--prefix", s.prefix, "--source", source, "--work-dir", workDir)
		s.refused(t, err)
		requireNoExternalCalls(t, trapLog)
		requireAbsent(t, workDir)
	})
}

// TestReviewAndRefineRefuseLvAndGPDrafts: --ticket-id may disagree with the
// draft, and the model reads the work dir's draft-v1.mdx, which need not be
// --draft; any of them naming the series is refused.
func TestReviewAndRefineRefuseLvAndGPDrafts(t *testing.T) {
	const mpDraft = "---\ntitle: \"Draft\"\nticketId: MP-PENDING\n---\nbody\n"
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root := makeFakeRepo(t)
		t.Setenv("GU_LOG_DIR", root)
		trapLog := trapExternalPrograms(t)
		for _, command := range []string{"review", "refine"} {
			for name, tc := range map[string]struct {
				draft, read string // --draft, and the work dir's draft-v1.mdx when it differs
				args        []string
			}{
				"--ticket-id " + s.prefix + "-PENDING":   {draft: "---\ntitle: \"Draft\"\n---\nbody\n", args: []string{"--ticket-id", s.prefix + "-PENDING"}},
				s.prefix + " draft without --ticket-id":  {draft: s.draft(true)},
				"unquoted draft, MP --ticket-id":         {draft: s.draft(false), args: []string{"--ticket-id", "MP-PENDING"}},
				"MP --draft, draft-v1.mdx in --work-dir": {draft: mpDraft, read: s.draft(false)},
			} {
				t.Run(command+" "+name, func(t *testing.T) {
					workDir := t.TempDir()
					draft := filepath.Join(workDir, "draft-v1.mdx")
					args := tc.args
					if tc.read != "" {
						draft = filepath.Join(t.TempDir(), "draft-v1.mdx")
						mustWrite(t, filepath.Join(workDir, "draft-v1.mdx"), tc.read)
						args = append(args, "--work-dir", workDir)
					}
					mustWrite(t, draft, tc.draft)
					err := executeCLI(t, append([]string{"--fake-provider", filepath.Join(root, "missing.json"), command, "--draft", draft}, args...)...)
					s.refused(t, err)
					requireNoExternalCalls(t, trapLog)
					requireBytes(t, draft, []byte(tc.draft))
					if tc.read != "" {
						requireBytes(t, filepath.Join(workDir, "draft-v1.mdx"), []byte(tc.read))
					}
					if got := dirNames(t, workDir); !slices.Equal(got, []string{"draft-v1.mdx"}) {
						t.Fatalf("work dir holds %v, want only the draft", got)
					}
				})
			}
		}
	})
}

// TestRalphRefusesLvAndGPPosts: a post of either series, by filename (and its
// en- sidecar) or by frontmatter ticketId, never reaches Tribunal or the
// post-fixers.
func TestRalphRefusesLvAndGPPosts(t *testing.T) {
	eachRefusedSeries(t, func(t *testing.T, s refusedSeries) {
		root, postsDir, _, _ := postsRepo(t, nil)
		// Real scripts, so only the refusal keeps the trapped bash and node away.
		mustWrite(t, filepath.Join(root, "scripts", "tribunal.sh"), "exit 0\n")
		for _, fixer := range []string{"add-kaomoji.mjs", "apply-glossary-links.mjs", "inject-related-posts.mjs"} {
			mustWrite(t, filepath.Join(root, "scripts", fixer), "")
		}
		trapLog := trapExternalPrograms(t)
		posts := map[string]string{"mp-pending-20261012-author-title.mdx": s.draft(true)}
		for _, name := range s.names {
			posts[name] = "---\ntitle: \"Untagged\"\nlang: zh-tw\n---\nbody\n"
		}
		for filename, body := range posts {
			t.Run(filename, func(t *testing.T) {
				path := filepath.Join(postsDir, filename)
				mustWrite(t, path, body)
				workDir := filepath.Join(t.TempDir(), "never-created")
				err := executeCLI(t, "ralph", "--file", filename, "--work-dir", workDir)
				s.refused(t, err)
				requireNoExternalCalls(t, trapLog)
				requireAbsent(t, workDir)
				requireBytes(t, path, []byte(body))
			})
		}
	})
}
