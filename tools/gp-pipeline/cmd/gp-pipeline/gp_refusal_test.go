package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// GP is a published MP that ShroomDog promotes with scripts/reclassify-post.mjs
// (openspec gp-signature-picks), so gp-pipeline refuses to write or rewrite it
// the way it refuses Lv, and never allocates a GP number (openspec
// gp-pipeline-publish-integrity). The helpers are in lv_refusal_test.go.

const gpPostBody = "---\ntitle: \"GP\"\nticketId: GP-10\nlang: zh-tw\n---\nbody\n"

func requireGPRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "--prefix MP") ||
		!strings.Contains(err.Error(), pipeline.ReclassifyScript) {
		t.Fatalf("error = %v (exit %d), want the exit-1 GP refusal pointing to --prefix MP and %s",
			err, exitCodeFor(err), pipeline.ReclassifyScript)
	}
}

func requireGPAllocationRefusal(t *testing.T, err error) {
	t.Helper()
	if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "does not allocate GP numbers") ||
		!strings.Contains(err.Error(), pipeline.ReclassifyScript) {
		t.Fatalf("error = %v (exit %d), want the exit-1 GP allocation refusal pointing to %s",
			err, exitCodeFor(err), pipeline.ReclassifyScript)
	}
}

// gpRepo is a fake repo holding one numbered GP post; it returns the repo
// root, the posts dir, and the counter file.
func gpRepo(t *testing.T, filename string) (root, postsDir, counterFile string) {
	t.Helper()
	root = makeFakeRepo(t)
	postsDir = filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(postsDir, filename), gpPostBody)
	t.Setenv("GU_LOG_DIR", root)
	return root, postsDir, filepath.Join(root, "scripts", "article-counter.json")
}

func TestRunRefusesGPBeforeWritingSteps(t *testing.T) {
	const filename = "gp-10-20261012-author-title.mdx"
	root, postsDir, counterFile := gpRepo(t, filename)
	trapLog := trapExternalPrograms(t)
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}

	cases := map[string][]string{
		"URL":                   {"run", "https://x.com/author/status/1", "--prefix", "GP"},
		"URL dry-run":           {"run", "https://x.com/author/status/1", "--prefix", "GP", "--dry-run"},
		"deploy without --file": {"run", "--prefix", "GP", "--from-step", "deploy"},
		"from the start":        {"run", "--file", filename},
	}
	for _, step := range []string{"write", "refine", "ralph"} {
		cases["from "+step] = []string{"run", "--file", filename, "--from-step", step}
	}
	for name, args := range cases {
		t.Run(name, func(t *testing.T) {
			workDir := filepath.Join(t.TempDir(), "never-created")
			err := executeCLI(t, append([]string{"--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json")}, args...)...)
			requireGPRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireAbsent(t, workDir)
			requireBytes(t, counterFile, counterBefore)
			requireBytes(t, filepath.Join(postsDir, filename), []byte(gpPostBody))
		})
	}
}

// TestRunRefusesGPBeforeYTDLPPreflight: without yt-dlp, a GP YouTube run gets
// the GP refusal (exit 1), not the missing-dependency exit 10.
func TestRunRefusesGPBeforeYTDLPPreflight(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	t.Setenv("PATH", t.TempDir())
	workDir := filepath.Join(t.TempDir(), "never-created")
	err := executeCLI(t, "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
		"run", "https://youtube.com/watch?v=dQw4w9WgXcQ", "--prefix", "GP")
	requireGPRefusal(t, err)
	requireAbsent(t, workDir)
}

// TestRunRefusesGPDraftInResumedWorkDir: a run resumed after write reuses the
// work dir's draft-v1.mdx and final.mdx, so a GP one there is refused whichever
// series --prefix names.
func TestRunRefusesGPDraftInResumedWorkDir(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	for _, tc := range []struct {
		name, file, prefix, step string
	}{
		{name: "MP from review, GP draft-v1.mdx", file: "draft-v1.mdx", prefix: "MP", step: "review"},
		{name: "SD from ralph, GP final.mdx", file: "final.mdx", prefix: "SD", step: "ralph"},
		{name: "MP from deploy, GP final.mdx", file: "final.mdx", prefix: "MP", step: "deploy"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const gpDraft = "---\ntitle: \"Draft\"\nticketId: GP-PENDING\n---\nbody\n"
			workDir := t.TempDir()
			mustWrite(t, filepath.Join(workDir, tc.file), gpDraft)
			err := executeCLI(t, "--work-dir", workDir, "--fake-provider", filepath.Join(root, "missing.json"),
				"run", "--dry-run", "--prefix", tc.prefix, "--from-step", tc.step)
			requireGPRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, filepath.Join(workDir, tc.file), []byte(gpDraft))
			if got := dirNames(t, workDir); !slices.Equal(got, []string{tc.file}) {
				t.Fatalf("work dir holds %v, want only %s", got, tc.file)
			}
		})
	}
}

func TestWriteRefusesGP(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	source := filepath.Join(t.TempDir(), "source-tweet.md")
	mustWrite(t, source, "source")
	workDir := filepath.Join(t.TempDir(), "never-created")

	err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"),
		"write", "--prefix", "GP", "--source", source, "--work-dir", workDir)
	requireGPRefusal(t, err)
	requireNoExternalCalls(t, trapLog)
	requireAbsent(t, workDir)
}

// TestReviewAndRefineRefuseGPDrafts: --ticket-id or the draft's own ticketId
// naming GP is refused.
func TestReviewAndRefineRefuseGPDrafts(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	for _, command := range []string{"review", "refine"} {
		for name, tc := range map[string]struct {
			draft string
			args  []string
		}{
			"--ticket-id GP-PENDING":       {draft: "---\ntitle: \"Draft\"\n---\nbody\n", args: []string{"--ticket-id", "GP-PENDING"}},
			"GP draft without --ticket-id": {draft: "---\ntitle: \"Draft\"\nticketId: \"GP-PENDING\"\n---\nbody\n"},
			"GP draft, MP --ticket-id":     {draft: "---\ntitle: \"Draft\"\nticketId: GP-PENDING\n---\nbody\n", args: []string{"--ticket-id", "MP-PENDING"}},
		} {
			t.Run(command+" "+name, func(t *testing.T) {
				workDir := t.TempDir()
				draft := filepath.Join(workDir, "draft-v1.mdx")
				mustWrite(t, draft, tc.draft)
				err := executeCLI(t, append([]string{"--fake-provider", filepath.Join(root, "missing.json"), command, "--draft", draft}, tc.args...)...)
				requireGPRefusal(t, err)
				requireNoExternalCalls(t, trapLog)
				requireBytes(t, draft, []byte(tc.draft))
				if got := dirNames(t, workDir); !slices.Equal(got, []string{"draft-v1.mdx"}) {
					t.Fatalf("work dir holds %v, want only the draft", got)
				}
			})
		}
	}
}

// TestRalphRefusesGPPosts: a GP post, by filename (gp- and its en- sidecar) or
// by frontmatter ticketId, never reaches Tribunal or the post-fixers.
func TestRalphRefusesGPPosts(t *testing.T) {
	root := makeFakeRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "scripts", "tribunal.sh"), "exit 0\n")
	for _, fixer := range []string{"add-kaomoji.mjs", "apply-glossary-links.mjs", "inject-related-posts.mjs"} {
		mustWrite(t, filepath.Join(root, "scripts", fixer), "")
	}
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	const untagged = "---\ntitle: \"GP\"\nlang: zh-tw\n---\nbody\n"
	for filename, body := range map[string]string{
		"gp-10-20261012-example.mdx":           untagged,
		"en-gp-10-20261012-example.mdx":        untagged,
		"mp-pending-20261012-author-title.mdx": gpPostBody,
	} {
		t.Run(filename, func(t *testing.T) {
			path := filepath.Join(postsDir, filename)
			mustWrite(t, path, body)
			workDir := filepath.Join(t.TempDir(), "never-created")
			err := executeCLI(t, "ralph", "--file", filename, "--work-dir", workDir)
			requireGPRefusal(t, err)
			requireNoExternalCalls(t, trapLog)
			requireAbsent(t, workDir)
			requireBytes(t, path, []byte(body))
		})
	}
}

// TestPipelineAllocatesNoGPNumber: counter bump and a standalone deploy of a
// GP pending file are refused before the counter or the file changes; dry-run
// changes nothing about that. counter next still reads the GP counter.
func TestPipelineAllocatesNoGPNumber(t *testing.T) {
	const pending = "gp-pending-20261012-author-title.mdx"
	_, postsDir, counterFile := gpRepo(t, pending)
	trapLog := trapExternalPrograms(t)
	counterBefore, err := os.ReadFile(counterFile)
	if err != nil {
		t.Fatal(err)
	}
	deploy := []string{"deploy", "--active-file", pending, "--date-stamp", "20261012", "--author-slug", "author", "--title-slug", "title"}
	for name, args := range map[string][]string{
		"counter bump":   {"counter", "bump", "--prefix", "GP"},
		"deploy":         deploy,
		"deploy dry-run": append(slices.Clone(deploy), "--dry-run"),
	} {
		t.Run(name, func(t *testing.T) {
			requireGPAllocationRefusal(t, executeCLI(t, args...))
			requireNoExternalCalls(t, trapLog)
			requireBytes(t, counterFile, counterBefore)
			requireBytes(t, filepath.Join(postsDir, pending), []byte(gpPostBody))
		})
	}
	t.Run("counter next", func(t *testing.T) {
		if err := executeCLI(t, "counter", "next", "--prefix", "GP"); err != nil {
			t.Fatalf("counter next --prefix GP: %v", err)
		}
		requireBytes(t, counterFile, counterBefore)
	})
}

// TestGPKeepsNonWritingSteps: a numbered GP still gets dedup, its pipeline
// credits, and its deploy from the pipeline.
func TestGPKeepsNonWritingSteps(t *testing.T) {
	const filename = "gp-10-20261012-author-title.mdx"
	root, _, _ := gpRepo(t, filename)

	t.Run("dedup", func(t *testing.T) {
		argsLog := filepath.Join(t.TempDir(), "dedup-args")
		mustWrite(t, filepath.Join(root, "scripts", "dedup-gate.mjs"),
			"import { writeFileSync } from 'node:fs';\n"+
				"writeFileSync("+jsonString(t, argsLog)+", process.argv.slice(2).join(' '));\n"+
				"console.log('PASS');\n")
		if err := executeCLI(t, "dedup", "--series", "GP", "--url", "https://example.org/source"); err != nil {
			t.Fatalf("dedup --series GP: %v", err)
		}
		raw, err := os.ReadFile(argsLog)
		if err != nil || !strings.Contains(string(raw), "--series GP") {
			t.Fatalf("dedup gate args = %q, %v; want --series GP", raw, err)
		}
	})

	t.Run("credits", func(t *testing.T) {
		post := filepath.Join(t.TempDir(), filename)
		mustWrite(t, post, gpPostBody)
		if err := executeCLI(t, "credits", "--file", post); err != nil {
			t.Fatalf("credits --file %s: %v", filename, err)
		}
		got, err := os.ReadFile(post)
		if err != nil || !strings.Contains(string(got), "pipelineUrl") || !strings.HasSuffix(string(got), "---\nbody\n") {
			t.Fatalf("credits did not stamp only the frontmatter: %q, %v", got, err)
		}
	})

	t.Run("run --from-step deploy", func(t *testing.T) {
		emptyFake := filepath.Join(t.TempDir(), "fake.json")
		mustWrite(t, emptyFake, `{"responses":[]}`)
		workDir := t.TempDir()
		mustWrite(t, filepath.Join(workDir, "final.mdx"), gpPostBody)
		if err := executeCLI(t, "--json", "--work-dir", workDir, "--fake-provider", emptyFake,
			"run", "--file", filename, "--from-step", "deploy", "--dry-run"); err != nil {
			t.Fatalf("run --from-step deploy for a GP post: %v", err)
		}
	})
}

func jsonString(t *testing.T, s string) string {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
