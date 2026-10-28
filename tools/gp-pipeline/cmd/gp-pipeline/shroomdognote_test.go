package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

// TestWritingStepsRejectShroomDogNoteForEverySeries covers
// gp-pipeline-publish-integrity〈寫作步驟 SHALL 拒絕含 ShroomDogNote 的模型輸出〉
// through the CLI: an MP write and an SD refine whose model output carries a
// ShroomDogNote exit 14, and the output is only kept aside as evidence.
func TestWritingStepsRejectShroomDogNoteForEverySeries(t *testing.T) {
	const withNote = "---\ntitle: \"x\"\n---\nbody\n\nimport ShroomDogNote from '../../components/ShroomDogNote.astro'\n\n<ShroomDogNote>\n代寫的看法\n</ShroomDogNote>\n"
	for _, tc := range []struct {
		name, output string
		args         func(workDir string) []string
	}{
		{name: "write --prefix MP", output: "draft-v1.mdx", args: func(workDir string) []string {
			source := filepath.Join(workDir, "source-tweet.md")
			mustWrite(t, source, "source")
			return []string{"write", "--prefix", "MP", "--source", source, "--work-dir", workDir}
		}},
		{name: "refine an SD draft", output: "final.mdx", args: func(workDir string) []string {
			draft := filepath.Join(workDir, "draft-v1.mdx")
			mustWrite(t, draft, "---\ntitle: \"x\"\nticketId: SD-PENDING\n---\ndraft\n")
			return []string{"refine", "--draft", draft}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := makeFakeRepo(t)
			for _, rel := range []string{"CONTRIBUTING.md", "docs/shroomdog-editorial-feedback.md", "openspec/specs/editorial-charter/spec.md", "scripts/vibe-scoring-standard.md"} {
				if err := os.MkdirAll(filepath.Join(root, filepath.Dir(rel)), 0o755); err != nil {
					t.Fatal(err)
				}
				mustWrite(t, filepath.Join(root, rel), "# fixture\n")
			}
			postsDir := filepath.Join(root, "src", "content", "posts")
			if err := os.MkdirAll(postsDir, 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("GU_LOG_DIR", root)
			spec, err := json.Marshal(map[string]any{"responses": []map[string]string{{"output": withNote, "writeFile": tc.output}}})
			if err != nil {
				t.Fatal(err)
			}
			fake := filepath.Join(t.TempDir(), "fake.json")
			mustWrite(t, fake, string(spec))
			workDir := t.TempDir()

			err = executeCLI(t, append([]string{"--fake-provider", fake}, tc.args(workDir)...)...)
			if err == nil || exitCodeFor(err) != 14 {
				t.Fatalf("error = %v (exit %d), want the exit-14 ShroomDogNote rejection", err, exitCodeFor(err))
			}
			requireAbsent(t, filepath.Join(workDir, tc.output))
			rejected := filepath.Join(workDir, tc.output[:len(tc.output)-len(".mdx")]+".rejected-shroomdognote.mdx")
			requireBytes(t, rejected, []byte(withNote))
			if names := dirNames(t, postsDir); !slices.Equal(names, []string{}) {
				t.Fatalf("posts dir holds %v, want nothing", names)
			}
		})
	}
}
