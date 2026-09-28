package pipeline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/logx"
)

// These tests run the real scripts/source-distance.mjs (segmentation, scoring
// and the stamp) against the synthetic capture in tests/fixtures; only the
// models are fakes. openspec: gp-pipeline-publish-integrity〈GP SHALL 以導讀
// 流程產出並在發布前蓋章〉 and source-distance-stamp〈沒過 SHALL 自動改寫最多
// 三輪，改寫看不到門檻〉.

const gpSourceURL = "https://keeper-notes.test/posts/logbook-on-call"

// gpArticle is a synthetic GP reading guide; body is its MDX body.
func gpArticle(body string) string {
	return `---
title: "燈塔日誌教會值班的一件事"
ticketId: "GP-PENDING"
originalDate: "2026-08-30"
translatedDate: "2026-09-28"
translatedBy:
  model: "Opus 5.5"
  harness: "Claude Code CLI"
source: "Mara Quill"
sourceUrl: "` + gpSourceURL + `"
lang: "zh-tw"
summary: "Mara Quill 把燈塔日誌搬進值班交接。"
tags: ["operations"]
---

` + body
}

const (
	gpDraftBody = `Mara Quill 把燈塔日誌搬進值班交接，這篇值得讀的是她怎麼處理沉默。

她說好的日誌一行就夠，下一班一分鐘內就能看完前一班。

Mogu 覺得最值得偷的是沒事也要寫一行，因為少了那一行本身就是告警。

原文後半段還有三個具體改動，值得自己去讀。
`
	gpRewrittenBody = `Mara Quill 用燈塔日誌講值班交接，重點其實是沉默也要留紀錄。

Mogu 的看法是：少了那一行本身就是告警，這比任何監控都便宜。

她後半段怎麼把規則落地，原文寫得很具體，值得自己去讀。
`
	gpENArticle = `---
title: "What a lighthouse logbook teaches on-call"
ticketId: "GP-PENDING"
lang: "en"
summary: "Mara Quill moves the lighthouse logbook into on-call handoffs."
tags: ["operations"]
---

A reading guide in English.
`
	// fixerLine is what the post-fixer stub appends, so a stamp computed
	// before the post-fixer would not match the shipped body.
	fixerLine = "這一句是 post-fixer 補上的結尾。"
)

// scriptedAligner is a fake aligner provider. Each call takes the next mode:
//
//	guide     only C1 pairs with S1 (a reading guide; passes)
//	translate every guide sentence pairs with the source sentence of the same
//	          index, in order (reads like a translation; fails)
//	zero      nothing pairs
//	invalid   drops the last guide sentence (the program rejects it)
//	error     the call fails
type scriptedAligner struct {
	mu      sync.Mutex
	modes   []string
	prompts []string
}

func (a *scriptedAligner) Name() string       { return "fake-source-aligner" }
func (a *scriptedAligner) Model() llm.ModelID { return "claude-sonnet-5" }
func (a *scriptedAligner) Available() bool    { return true }

var alignLine = regexp.MustCompile(`^([CS]\d+)\t`)

func (a *scriptedAligner) Run(_ context.Context, prompt string, opts llm.RunOptions) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.prompts = append(a.prompts, prompt)
	if opts.JSONSchema == "" {
		return "", errors.New("aligner called without structured output")
	}
	if len(a.modes) == 0 {
		return "", errors.New("scripted aligner: no mode left")
	}
	mode := a.modes[0]
	a.modes = a.modes[1:]
	if mode == "error" {
		return "", errors.New("scripted aligner: provider failed")
	}
	var guide, source []string
	for _, line := range strings.Split(prompt, "\n") {
		if m := alignLine.FindStringSubmatch(line); m != nil {
			if m[1][0] == 'C' {
				guide = append(guide, m[1])
			} else {
				source = append(source, m[1])
			}
		}
	}
	type pair struct {
		C string   `json:"c"`
		S []string `json:"s"`
	}
	pairs := []pair{}
	for i, c := range guide {
		p := pair{C: c, S: []string{}}
		switch mode {
		case "guide":
			if i == 0 {
				p.S = []string{source[0]}
			}
		case "translate":
			if i < len(source) {
				p.S = []string{source[i]}
			}
		case "invalid":
			if i == len(guide)-1 {
				continue
			}
		}
		pairs = append(pairs, p)
	}
	out, err := json.Marshal(map[string]any{"alignments": pairs})
	return string(out), err
}

func (a *scriptedAligner) calls() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.prompts)
}

func realRepoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", "..", "..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func copyFile(t *testing.T, from, to string) {
	t.Helper()
	data, err := os.ReadFile(from)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(to, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// makeGPRunHarness extends the run harness for GP: the real source-distance
// CLI, a post-fixer stub that edits the body, the aligner pin SSOT, the
// synthetic capture already in the work dir, and fakes for the writer (eval
// ×2 first, then writer) and the aligner.
func makeGPRunHarness(t *testing.T, aligner *scriptedAligner, writer ...llm.FakeResponse) (*State, *llm.FakeProvider, string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	s, tmp := makeRunHarnessForPrefix(t, "GP")
	real := realRepoRoot(t)
	copyFile(t, filepath.Join(real, "scripts", "source-distance.mjs"), filepath.Join(tmp, "scripts", "source-distance.mjs"))
	copyFile(t, filepath.Join(real, "scripts", "lib", "source-distance.mjs"), filepath.Join(tmp, "scripts", "lib", "source-distance.mjs"))
	if err := os.Symlink(filepath.Join(real, "node_modules"), filepath.Join(tmp, "node_modules")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "scripts", "add-kaomoji.mjs"), []byte(`import fs from 'node:fs';
const file = process.argv[process.argv.length - 1];
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').trimEnd() + '\n\n`+fixerLine+`\n');
`), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, noop := range []string{"apply-glossary-links.mjs", "inject-related-posts.mjs"} {
		if err := os.WriteFile(filepath.Join(tmp, "scripts", noop), []byte("// no-op post-fixer stub\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	writeAlignerPin(t, tmp, "claude-sonnet-5")

	s.TweetURL = gpSourceURL
	copyFile(t, filepath.Join(real, "tests", "fixtures", "source-distance", "capture.txt"), filepath.Join(s.WorkDir, "source-tweet.md"))

	evalGO := `{"verdict":"GO","reason":"worth a reading guide","suggested_title":"燈塔日誌"}`
	fake := llm.NewFakeClaude().WithResponses(append([]llm.FakeResponse{
		{Output: evalGO, WriteFile: "eval-codex-primary.json"},
		{Output: evalGO, WriteFile: "eval-codex.json"},
	}, writer...)...)
	disp, err := llm.NewDispatcher(logx.New(), fake)
	if err != nil {
		t.Fatal(err)
	}
	s.Dispatcher = disp
	alignerDisp, err := llm.NewDispatcher(logx.New(), aligner)
	if err != nil {
		t.Fatal(err)
	}
	s.AlignerDispatcher = alignerDisp
	return s, fake, tmp
}

func writeAlignerPin(t *testing.T, repo, model string) {
	t.Helper()
	path := filepath.Join(repo, llm.AlignerAgentPath)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nname: source-aligner\nmodel: " + model + "\ntools: []\n---\nPairs sentences.\n"
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// gpWriter queues the draft, the review and the first refine.
func gpWriter(extra ...llm.FakeResponse) []llm.FakeResponse {
	return append([]llm.FakeResponse{
		{Output: gpArticle(gpDraftBody), WriteFile: "draft-v1.mdx"},
		{Output: "- nothing blocking\n", WriteFile: "review.md"},
		{Output: gpArticle(gpDraftBody), WriteFile: "final.mdx"},
	}, extra...)
}

func rewriteResponse() llm.FakeResponse {
	return llm.FakeResponse{Output: gpArticle(gpRewrittenBody), WriteFile: "final.mdx"}
}

func translateResponse() llm.FakeResponse {
	return llm.FakeResponse{Output: gpENArticle, WriteFile: "translated-en.mdx"}
}

// verifyStamp runs the real verifier on an article and returns its result.
func verifyStamp(t *testing.T, repo, file string) (ok bool, errs []string) {
	t.Helper()
	cmd := exec.Command("node", filepath.Join(repo, "scripts", "source-distance.mjs"), "verify", "--file", file, "--posts-dir", filepath.Join(repo, "src", "content", "posts"))
	cmd.Dir = repo
	out, _ := cmd.Output()
	var res struct {
		Results []struct {
			Required bool     `json:"required"`
			OK       bool     `json:"ok"`
			Errors   []string `json:"errors"`
		} `json:"results"`
	}
	if err := json.Unmarshal(out, &res); err != nil || len(res.Results) != 1 {
		t.Fatalf("verify %s: %v\n%s", file, err, out)
	}
	if !res.Results[0].Required {
		t.Fatalf("verify %s: the article does not require a stamp", file)
	}
	return res.Results[0].OK, res.Results[0].Errors
}

type stampFields struct {
	Verdict      string `json:"verdict"`
	Aligner      string `json:"aligner"`
	Rewrites     int    `json:"rewrites"`
	AlignerCalls int    `json:"alignerCalls"`
}

func readStamp(t *testing.T, repo, file string) *stampFields {
	t.Helper()
	cmd := exec.Command("node", "--input-type=module", "-e", `
import fs from 'node:fs';
import { parseFrontmatter } from './scripts/lib/source-distance.mjs';
const data = parseFrontmatter(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(JSON.stringify(data.sourceDistance ?? null));
`, file)
	cmd.Dir = repo
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("read stamp: %v\n%s", err, out)
	}
	var stamp *stampFields
	if err := json.Unmarshal(out, &stamp); err != nil {
		t.Fatalf("read stamp: %v\n%s", err, out)
	}
	return stamp
}

func writerPrompts(fake *llm.FakeProvider) []string {
	prompts := make([]string, 0, len(fake.Called))
	for _, call := range fake.Called {
		prompts = append(prompts, call.Prompt)
	}
	return prompts
}

func counterNext(t *testing.T, s *State) string {
	t.Helper()
	data, err := os.ReadFile(s.Cfg.CounterFile)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func assertStepCode(t *testing.T, err error, code int) {
	t.Helper()
	var se *StepError
	if !errors.As(err, &se) || se.Code != code {
		t.Fatalf("error = %v, want exit %d", err, code)
	}
}

// TestRun_GPReadingGuideFullFlow covers〈GP 導讀跑完整流程〉and〈章涵蓋
// post-fixer 之後的正文〉: the steps run in order, the stamp is computed after
// the post-fixer edited the body, and the deployed zh-tw file's recomputed
// fingerprint equals the stamp.
func TestRun_GPReadingGuideFullFlow(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter(translateResponse())...)
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if s.PromptTicketID != "GP-171" || !strings.HasPrefix(s.Filename, "gp-171-") {
		t.Fatalf("deployed %q as %q, want GP-171", s.Filename, s.PromptTicketID)
	}
	deployed := filepath.Join(s.Cfg.PostsDir, s.Filename)
	body, err := os.ReadFile(deployed)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(body), fixerLine) != 1 {
		t.Fatalf("the post-fixer edit must reach the deployed body exactly once (ralph must not rerun it):\n%s", body)
	}
	if ok, errs := verifyStamp(t, tmp, deployed); !ok {
		t.Fatalf("deployed GP fails stamp verification: %v", errs)
	}
	stamp := readStamp(t, tmp, deployed)
	if stamp == nil || stamp.Verdict != "PASS" || stamp.Aligner != "claude-sonnet-5" || stamp.Rewrites != 0 || stamp.AlignerCalls != 2 {
		t.Fatalf("stamp = %+v, want PASS by claude-sonnet-5 with 0 rewrites and 2 aligner calls", stamp)
	}
	if s.SourceDistanceResult == nil || s.SourceDistanceResult.Verdict != SourceDistancePass {
		t.Fatalf("run report outcome = %+v", s.SourceDistanceResult)
	}
	var summary strings.Builder
	PrintSummary(&summary, s)
	if !strings.Contains(summary.String(), "Source distance: PASS (rewrites 0, aligner calls 2") {
		t.Errorf("run summary lacks the source-distance outcome:\n%s", summary.String())
	}
	for _, step := range []string{"post-fixer", "source-distance"} {
		if _, ok := s.Timings[step]; !ok {
			t.Errorf("step %s did not run", step)
		}
	}
	// eval×2, write, review, refine, translate: no rewrite.
	if got := len(fake.Called); got != 6 {
		t.Fatalf("writer calls = %d, want 6", got)
	}
	prompts := writerPrompts(fake)
	if !strings.Contains(prompts[2], "reading guide") || !strings.Contains(prompts[2], testTerminologyContext) {
		t.Error("GP write prompt lacks the reading-guide contract or the terminology context")
	}
	for _, p := range aligner.prompts {
		if !strings.Contains(p, "GUIDE") || !strings.Contains(p, fixerLine) {
			t.Fatal("the aligner did not see the post-fixed body")
		}
	}
}

// TestRun_GPRewriteRoundThenPass covers〈改寫一輪後通過〉and〈改寫 prompt 不含門檻〉.
func TestRun_GPRewriteRoundThenPass(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"translate", "guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter(rewriteResponse(), translateResponse())...)
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	deployed := filepath.Join(s.Cfg.PostsDir, s.Filename)
	if ok, errs := verifyStamp(t, tmp, deployed); !ok {
		t.Fatalf("deployed GP fails stamp verification: %v", errs)
	}
	stamp := readStamp(t, tmp, deployed)
	if stamp.Rewrites != 1 || stamp.AlignerCalls != 3 {
		t.Fatalf("stamp = %+v, want 1 rewrite and 3 aligner calls", stamp)
	}
	body, _ := os.ReadFile(deployed)
	if !strings.Contains(string(body), "沉默也要留紀錄") {
		t.Fatal("the rewritten body did not ship")
	}

	rewrite := writerPrompts(fake)[5]
	if !strings.Contains(rewrite, "Flagged passages:") || !strings.Contains(rewrite, "rewrite-draft.mdx") {
		t.Fatalf("the rewrite did not go through refine with the flagged passages:\n%s", rewrite)
	}
	if !strings.Contains(rewrite, "她說好的日誌一行就夠") {
		t.Fatal("the rewrite prompt does not list a flagged sentence")
	}
	for _, leak := range []string{"%", "maxRun", "sourceRatio", "threshold", "minStep", "0.3", "30", "κ", "β", "PASS", "FAIL"} {
		if strings.Contains(rewrite, leak) {
			t.Errorf("the rewrite prompt leaks %q", leak)
		}
	}
	for _, name := range []string{"round-0/report.md", "round-0/alignment-1.json", "round-1/alignment-2.json", "round-1/score.json", "outcome.json"} {
		if _, err := os.Stat(filepath.Join(s.WorkDir, "source-distance", "attempt-1", name)); err != nil {
			t.Errorf("evidence %s missing: %v", name, err)
		}
	}
}

// TestRun_GPSecondAlignmentFails covers〈第二次配對沒過規則①〉in the pipeline:
// it is a failing round, and the rewrite that follows passes.
func TestRun_GPSecondAlignmentFails(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "translate", "guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter(rewriteResponse(), translateResponse())...)
	_, _ = SetupWorkDir(s)

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	stamp := readStamp(t, tmp, filepath.Join(s.Cfg.PostsDir, s.Filename))
	if stamp.Rewrites != 1 || stamp.AlignerCalls != 4 {
		t.Fatalf("stamp = %+v, want 1 rewrite and 4 aligner calls", stamp)
	}
	if len(fake.Called) != 7 {
		t.Fatalf("writer calls = %d, want 7 (one rewrite)", len(fake.Called))
	}
}

// TestRun_GPZeroAlignmentExits19WithoutRewrite covers〈零配對不改寫〉.
func TestRun_GPZeroAlignmentExits19WithoutRewrite(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"zero"}}
	s, fake, _ := makeGPRunHarness(t, aligner, gpWriter()...)
	_, _ = SetupWorkDir(s)
	before := counterNext(t, s)

	err := Run(context.Background(), s)
	assertStepCode(t, err, SourceDistanceExitCode)
	if len(fake.Called) != 5 {
		t.Fatalf("writer calls = %d, want 5: zero alignments must not reach refine again", len(fake.Called))
	}
	if aligner.calls() != 1 {
		t.Fatalf("aligner calls = %d, want 1", aligner.calls())
	}
	if s.SourceDistanceResult.Verdict != SourceDistanceZero {
		t.Fatalf("outcome = %+v", s.SourceDistanceResult)
	}
	if counterNext(t, s) != before || s.Filename != "" {
		t.Fatal("a zero-alignment GP was deployed or allocated a ticket")
	}
}

// TestRun_GPThreeRewritesStillFailing covers〈三輪改寫後仍沒過〉.
func TestRun_GPThreeRewritesStillFailing(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"translate", "translate", "translate", "translate"}}
	// Every rewrite still restates the source in order.
	stillTranslating := llm.FakeResponse{Output: gpArticle(gpDraftBody), WriteFile: "final.mdx"}
	s, fake, _ := makeGPRunHarness(t, aligner, gpWriter(stillTranslating, stillTranslating, stillTranslating)...)
	_, _ = SetupWorkDir(s)
	before := counterNext(t, s)

	err := Run(context.Background(), s)
	assertStepCode(t, err, SourceDistanceExitCode)
	if len(fake.Called) != 8 {
		t.Fatalf("writer calls = %d, want 8 (three rewrites, no translate)", len(fake.Called))
	}
	if counterNext(t, s) != before || s.Filename != "" {
		t.Fatal("a failing GP was deployed or allocated a ticket")
	}
	entries, _ := os.ReadDir(s.Cfg.PostsDir)
	if len(entries) != 0 {
		t.Fatalf("posts/ gained %d file(s) from a failing GP", len(entries))
	}
	for round := 0; round <= MaxSourceDistanceRewrites; round++ {
		for _, name := range []string{"final.mdx", "segments.json", "alignment-1.json", "score.json", "report.md"} {
			path := filepath.Join(s.WorkDir, "source-distance", "attempt-1", fmt.Sprintf("round-%d", round), name)
			if _, err := os.Stat(path); err != nil {
				t.Errorf("evidence missing: %v", err)
			}
		}
	}
	if o := s.SourceDistanceResult; o.Verdict != SourceDistanceFail || o.Rewrites != MaxSourceDistanceRewrites || o.AlignerCalls != 4 {
		t.Fatalf("outcome = %+v", o)
	}
}

// TestRun_GPAlignerFailureIsNotARound covers〈aligner 呼叫失敗〉and〈配對輸出不合格〉.
func TestRun_GPAlignerFailureIsNotARound(t *testing.T) {
	for _, mode := range []string{"error", "invalid"} {
		t.Run(mode, func(t *testing.T) {
			aligner := &scriptedAligner{modes: []string{mode}}
			s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter()...)
			_, _ = SetupWorkDir(s)

			err := Run(context.Background(), s)
			assertStepCode(t, err, 14)
			if len(fake.Called) != 5 {
				t.Fatalf("writer calls = %d, want 5: a failed alignment is not a rewrite round", len(fake.Called))
			}
			if stamp := readStamp(t, tmp, filepath.Join(s.WorkDir, "final.mdx")); stamp != nil {
				t.Fatalf("final.mdx was stamped after a failed alignment: %+v", stamp)
			}
			if s.SourceDistanceResult.Rewrites != 0 {
				t.Fatalf("outcome = %+v", s.SourceDistanceResult)
			}
		})
	}
}

// TestRun_GPAlignerPinEqualToWriterFailsBeforeAligning covers〈aligner 與寫手用
// 同一個 pin〉in the pipeline.
func TestRun_GPAlignerPinEqualToWriterFailsBeforeAligning(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	s, _, tmp := makeGPRunHarness(t, aligner, gpWriter()...)
	writeAlignerPin(t, tmp, llm.ClaudeOpusPinned+"[1m]")
	_, _ = SetupWorkDir(s)

	err := Run(context.Background(), s)
	assertStepCode(t, err, 14)
	if !strings.Contains(err.Error(), "must differ from the writer pin") {
		t.Fatalf("error = %v", err)
	}
	if aligner.calls() != 0 {
		t.Fatalf("the aligner ran %d time(s) with the writer's pin", aligner.calls())
	}
}

// TestRun_GPResumeFromSourceDistance covers〈從 source-distance 恢復〉: the
// work-dir draft is paired and scored again, and write, review and refine do
// not run.
func TestRun_GPResumeFromSourceDistance(t *testing.T) {
	aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
	s, fake, tmp := makeGPRunHarness(t, aligner)
	fake.Reset()
	fake.WithResponses(translateResponse())
	s.FromStepInt = StepSourceDistance
	s.AuthorHandle = "keeper-notes.test"
	if err := os.WriteFile(filepath.Join(s.WorkDir, "final.mdx"), []byte(gpArticle(gpDraftBody)), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := Run(context.Background(), s); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(fake.Called) != 1 || !strings.Contains(fake.Called[0].Prompt, "translated-en.mdx") {
		t.Fatalf("writer calls = %d, want only the translation", len(fake.Called))
	}
	if aligner.calls() != 2 {
		t.Fatalf("aligner calls = %d, want 2", aligner.calls())
	}
	deployed := filepath.Join(s.Cfg.PostsDir, s.Filename)
	if ok, errs := verifyStamp(t, tmp, deployed); !ok {
		t.Fatalf("resumed GP fails stamp verification: %v", errs)
	}
	if strings.Contains(mustRead(t, deployed), fixerLine) {
		t.Fatal("resuming from source-distance reran the post-fixer")
	}
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
