package main

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// These tests cover openspec source-distance-stamp〈手寫或人工修改的 GP SHALL
// 能用 gp-pipeline stamp 蓋章〉 through the CLI, with the real
// scripts/source-distance.mjs and a canned aligner.

const stampSourceURL = "https://keeper-notes.test/posts/logbook-on-call"

const stampGPBody = `Mara Quill 把燈塔日誌搬進值班交接，這篇值得讀的是她怎麼處理沉默。

她說好的日誌一行就夠，下一班一分鐘內就能看完前一班。

Mogu 覺得最值得偷的是沒事也要寫一行，因為少了那一行本身就是告警。

原文後半段還有三個具體改動，值得自己去讀。
`

func stampPost(ticketID, sourceURL string) string {
	return `---
title: "燈塔日誌教會值班的一件事"
ticketId: "` + ticketID + `"
sourceUrl: "` + sourceURL + `"
lang: "zh-tw"
---

` + stampGPBody
}

// makeStampRepo is a fake repo with the real source-distance CLI, the aligner
// pin, and the synthetic capture in a directory outside the repo.
func makeStampRepo(t *testing.T) (root, capture string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	root = makeFakeRepo(t)
	real, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"scripts/source-distance.mjs", "scripts/lib/source-distance.mjs"} {
		data, err := os.ReadFile(filepath.Join(real, rel))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, rel)), 0o755); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, filepath.Join(root, rel), string(data))
	}
	if err := os.Symlink(filepath.Join(real, "node_modules"), filepath.Join(root, "node_modules")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".claude", "agents"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, ".claude", "agents", "source-aligner.md"), "---\nname: source-aligner\nmodel: claude-sonnet-5\ntools: []\n---\nPairs sentences.\n")
	if err := os.MkdirAll(filepath.Join(root, "src", "content", "posts"), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(real, "tests", "fixtures", "source-distance", "capture.txt"))
	if err != nil {
		t.Fatal(err)
	}
	capture = filepath.Join(t.TempDir(), "capture.txt")
	mustWrite(t, capture, string(data))
	t.Setenv("GU_LOG_DIR", root)
	return root, capture
}

// alignerFake writes a --fake-provider spec whose aligner answers are built
// from the real segmentation: "guide" pairs only C1 with S1, "translate"
// pairs every guide sentence with the source sentence of the same index.
func alignerFake(t *testing.T, root, post, capture string, modes ...string) string {
	t.Helper()
	cmd := exec.Command("node", filepath.Join(root, "scripts", "source-distance.mjs"), "segment", "--file", post, "--source", capture)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("segment: %v", err)
	}
	var segments struct {
		Guide  []struct{ ID string } `json:"guide"`
		Source []struct{ ID string } `json:"source"`
	}
	if err := json.Unmarshal(out, &segments); err != nil {
		t.Fatal(err)
	}
	type pair struct {
		C string   `json:"c"`
		S []string `json:"s"`
	}
	responses := []map[string]string{}
	for _, mode := range modes {
		pairs := []pair{}
		for i, g := range segments.Guide {
			p := pair{C: g.ID, S: []string{}}
			if (mode == "guide" && i == 0) || (mode == "translate" && i < len(segments.Source)) {
				p.S = []string{segments.Source[i].ID}
			}
			pairs = append(pairs, p)
		}
		answer, _ := json.Marshal(map[string]any{"alignments": pairs})
		responses = append(responses, map[string]string{"output": string(answer)})
	}
	spec, _ := json.Marshal(map[string]any{
		"responses": []any{},
		"roles":     map[string]any{"aligner": map[string]any{"provider": "fake-source-aligner", "model": "claude-sonnet-5", "responses": responses}},
	})
	path := filepath.Join(t.TempDir(), "fake.json")
	mustWrite(t, path, string(spec))
	return path
}

func runStampCmd(t *testing.T, args ...string) (string, error) {
	t.Helper()
	resetGlobals()
	cmd := buildRoot()
	cmd.SetArgs(append([]string{"--work-dir", t.TempDir()}, args...))
	out, err := captureProcessStdout(t, func() error { return cmd.ExecuteContext(context.Background()) })
	return string(out), err
}

func TestStampCommand(t *testing.T) {
	root, capture := makeStampRepo(t)
	post := filepath.Join(root, "src", "content", "posts", "gp-172-20260928-keeper-logbook.mdx")
	mustWrite(t, post, stampPost("GP-172", stampSourceURL))
	original, _ := os.ReadFile(post)

	// 〈手寫的 GP 沒過〉: exit 19, the flagged passages, the file unchanged.
	fake := alignerFake(t, root, post, capture, "translate")
	out, err := runStampCmd(t, "--fake-provider", fake, "stamp", "--file", "gp-172-20260928-keeper-logbook.mdx", "--source", capture)
	if exitCodeFor(err) != 19 {
		t.Fatalf("exit = %d (%v), want 19", exitCodeFor(err), err)
	}
	if !strings.Contains(out, "Flagged passages") || !strings.Contains(out, "她說好的日誌一行就夠") {
		t.Fatalf("stdout lacks the flagged passages:\n%s", out)
	}
	if now, _ := os.ReadFile(post); string(now) != string(original) {
		t.Fatal("a post that did not pass was changed")
	}

	// 〈手寫的 GP 通過〉: only the stamp is added.
	fake = alignerFake(t, root, post, capture, "guide", "guide")
	if out, err := runStampCmd(t, "--fake-provider", fake, "stamp", "--file", post, "--source", capture); err != nil {
		t.Fatalf("stamp: %v\n%s", err, out)
	}
	stamped, _ := os.ReadFile(post)
	if !strings.Contains(string(stamped), "\nsourceDistance:\n") {
		t.Fatalf("no stamp was written:\n%s", stamped)
	}
	if withoutStamp(string(stamped)) != string(original) {
		t.Fatalf("stamp changed something besides the stamp:\n%s", stamped)
	}
}

// withoutStamp drops the top-level sourceDistance block.
func withoutStamp(content string) string {
	var kept []string
	skipping := false
	for _, line := range strings.SplitAfter(content, "\n") {
		switch {
		case strings.HasPrefix(line, "sourceDistance:"):
			skipping = true
			continue
		case skipping && strings.HasPrefix(line, "  "):
			continue
		}
		skipping = false
		kept = append(kept, line)
	}
	return strings.Join(kept, "")
}

// TestStampRefusesPostsThatTakeNoStamp covers〈對不需要章的文章蓋章〉: exit 1 at
// ingress, before any fetch or model call (the fake provider spec does not
// even exist).
func TestStampRefusesPostsThatTakeNoStamp(t *testing.T) {
	root, capture := makeStampRepo(t)
	postsDir := filepath.Join(root, "src", "content", "posts")
	mp := filepath.Join(postsDir, "mp-20-20260928-keeper-logbook.mdx")
	mustWrite(t, mp, strings.Replace(stampPost("MP-20", stampSourceURL), "GP-", "MP-", 1))
	gp1 := filepath.Join(postsDir, "gp-1-20260128-demo.mdx")
	mustWrite(t, gp1, stampPost("GP-1", "https://example.com/original-article"))
	missing := filepath.Join(root, "missing.json")

	for _, post := range []string{mp, gp1} {
		before, _ := os.ReadFile(post)
		_, err := runStampCmd(t, "--fake-provider", missing, "stamp", "--file", post, "--source", capture)
		if exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "takes no source-distance stamp") {
			t.Fatalf("%s: error = %v (exit %d), want the exit-1 ingress refusal", filepath.Base(post), err, exitCodeFor(err))
		}
		if after, _ := os.ReadFile(post); string(after) != string(before) {
			t.Fatalf("%s changed", filepath.Base(post))
		}
	}

	// A capture inside the repo is refused too: source text stays outside it.
	gp := filepath.Join(postsDir, "gp-173-20260928-keeper-logbook.mdx")
	mustWrite(t, gp, stampPost("GP-173", stampSourceURL))
	inRepo := filepath.Join(root, "capture.txt")
	data, _ := os.ReadFile(capture)
	mustWrite(t, inRepo, string(data))
	_, err := runStampCmd(t, "--fake-provider", missing, "stamp", "--file", gp, "--source", inRepo)
	if exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "inside the repo") {
		t.Fatalf("error = %v (exit %d), want the in-repo capture refusal", err, exitCodeFor(err))
	}
}
