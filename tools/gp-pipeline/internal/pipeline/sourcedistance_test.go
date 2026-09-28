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

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/config"
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
	s, tmp := makeRunHarnessForPrefix(t, "GP")
	installSourceDistanceCLI(t, tmp, filepath.Join(tmp, "scripts"))
	installContentLintStubs(t, filepath.Join(tmp, "scripts"))
	real := realRepoRoot(t)
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

// installSourceDistanceCLI puts the real scripts/source-distance.mjs and its
// lib under scriptsDir, with the repo's node_modules linked at root.
func installSourceDistanceCLI(t *testing.T, root, scriptsDir string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	real := realRepoRoot(t)
	copyFile(t, filepath.Join(real, "scripts", "source-distance.mjs"), filepath.Join(scriptsDir, "source-distance.mjs"))
	copyFile(t, filepath.Join(real, "scripts", "lib", "source-distance.mjs"), filepath.Join(scriptsDir, "lib", "source-distance.mjs"))
	if err := os.Symlink(filepath.Join(real, "node_modules"), filepath.Join(root, "node_modules")); err != nil {
		t.Fatal(err)
	}
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
	cmd := exec.Command("node", filepath.Join(repo, "scripts", "source-distance.mjs"), "verify", "--file", file)
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
	Verdict        string `json:"verdict"`
	Aligner        string `json:"aligner"`
	Rewrites       int    `json:"rewrites"`
	AlignerCalls   int    `json:"alignerCalls"`
	EnglishSkipped string `json:"englishSkipped"`
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

// gpEnglish is a synthetic English version of the GP; body is its MDX body.
func gpEnglish(body string) string {
	return `---
title: "What a lighthouse logbook teaches on-call"
ticketId: "GP-PENDING"
sourceUrl: "` + gpSourceURL + `"
lang: "en"
summary: "Mara Quill moves the lighthouse logbook into on-call handoffs."
tags: ["operations"]
---

` + body
}

const (
	gpENOwnWords = "Mara Quill uses an old lighthouse habit to talk about on-call handoffs. Mogu's take: a missing line is itself the alarm, and cheaper than any monitor.\n"
	// gpENVerbatim carries two source sentences word for word, unquoted.
	gpENVerbatim = "Mara Quill opens with this: The lighthouse logbook was the first on-call runbook I ever trusted. Every keeper wrote the weather, the passing ships, and the state of the lamp before midnight. That is the whole idea.\n"
)

// TestRun_GPEnglishVerbatimCheck covers〈英文版逐字照搬原文〉,〈英文版沒過不重翻〉
// and clearing englishSkipped once a passing English version is added later.
func TestRun_GPEnglishVerbatimCheck(t *testing.T) {
	t.Run("pass", func(t *testing.T) {
		aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
		s, _, tmp := makeGPRunHarness(t, aligner, gpWriter(llm.FakeResponse{Output: gpEnglish(gpENOwnWords), WriteFile: "translated-en.mdx"})...)
		_, _ = SetupWorkDir(s)
		if err := Run(context.Background(), s); err != nil {
			t.Fatalf("Run: %v", err)
		}
		if s.EnglishCheck != EnglishCheckPass || s.ENFilename == "" {
			t.Fatalf("English check = %q, deployed en = %q", s.EnglishCheck, s.ENFilename)
		}
		if ok, errs := verifyStamp(t, tmp, filepath.Join(s.Cfg.PostsDir, s.ENFilename)); !ok {
			t.Fatalf("English version fails stamp verification: %v", errs)
		}
	})

	t.Run("verbatim then a passing retry", func(t *testing.T) {
		aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
		s, fake, tmp := makeGPRunHarness(t, aligner, gpWriter(llm.FakeResponse{Output: gpEnglish(gpENVerbatim), WriteFile: "translated-en.mdx"})...)
		_, _ = SetupWorkDir(s)
		if err := Run(context.Background(), s); err != nil {
			t.Fatalf("Run: %v", err)
		}
		if s.EnglishCheck != EnglishCheckSkippedVerbatim {
			t.Fatalf("English check = %q, want %s", s.EnglishCheck, EnglishCheckSkippedVerbatim)
		}
		if len(fake.Called) != 6 {
			t.Fatalf("writer calls = %d, want 6: a failing English version is not retranslated", len(fake.Called))
		}
		if s.ENFilename != "" {
			t.Fatalf("the verbatim English version was deployed as %s", s.ENFilename)
		}
		entries, _ := os.ReadDir(s.Cfg.PostsDir)
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), "en-") {
				t.Fatalf("posts/ still has %s", entry.Name())
			}
		}
		zh := filepath.Join(s.Cfg.PostsDir, s.Filename)
		if stamp := readStamp(t, tmp, zh); stamp.EnglishSkipped != "verbatim" {
			t.Fatalf("zh-tw stamp = %+v, want englishSkipped verbatim", stamp)
		}
		if ok, errs := verifyStamp(t, tmp, zh); !ok {
			t.Fatalf("marking englishSkipped broke the zh-tw stamp: %v", errs)
		}

		// A later run adds a passing English version and clears the mark.
		retry := NewState()
		retry.Cfg, retry.Log, retry.Counter = s.Cfg, s.Log, s.Counter
		retry.Prefix, retry.PromptTicketID = "GP", "GP-PENDING"
		retry.WorkDir = s.WorkDir
		retry.FromStepInt = StepTranslate
		retry.ExistingFile = s.Filename
		retry.SkipBuild, retry.SkipPush, retry.SkipValidate = true, true, true
		retryFake := llm.NewFakeClaude().WithResponses(llm.FakeResponse{Output: strings.ReplaceAll(gpEnglish(gpENOwnWords), "GP-PENDING", s.PromptTicketID), WriteFile: "translated-en.mdx"})
		disp, err := llm.NewDispatcher(logx.New(), retryFake)
		if err != nil {
			t.Fatal(err)
		}
		retry.Dispatcher = disp
		if err := Run(context.Background(), retry); err != nil {
			t.Fatalf("recovery Run: %v", err)
		}
		if retry.EnglishCheck != EnglishCheckPass {
			t.Fatalf("recovery English check = %q", retry.EnglishCheck)
		}
		if stamp := readStamp(t, tmp, zh); stamp.EnglishSkipped != "" {
			t.Fatalf("zh-tw stamp still marks englishSkipped after a passing English version: %+v", stamp)
		}
		if ok, errs := verifyStamp(t, tmp, zh); !ok {
			t.Fatalf("zh-tw stamp broke when the mark was cleared: %v", errs)
		}
		en := filepath.Join(s.Cfg.PostsDir, "en-"+s.Filename)
		if ok, errs := verifyStamp(t, tmp, en); !ok {
			t.Fatalf("recovered English version fails stamp verification: %v", errs)
		}
	})
}

// makeStampHarness sets up `gp-pipeline stamp` on one hand-written GP post:
// a repo with the real CLI and the aligner pin, the post in posts/, and the
// synthetic capture in a directory outside the repo.
func makeStampHarness(t *testing.T, aligner *scriptedAligner) (s *State, repo, post string) {
	t.Helper()
	repo = t.TempDir()
	scriptsDir := filepath.Join(repo, "scripts")
	installSourceDistanceCLI(t, repo, scriptsDir)
	writeAlignerPin(t, repo, "claude-sonnet-5")
	postsDir := filepath.Join(repo, "src", "content", "posts")
	post = filepath.Join(postsDir, "gp-172-20260928-keeper-logbook.mdx")
	if err := os.MkdirAll(postsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(post, []byte(strings.Replace(gpArticle(gpDraftBody), "GP-PENDING", "GP-172", 1)), 0o644); err != nil {
		t.Fatal(err)
	}
	capture := filepath.Join(t.TempDir(), "capture.txt")
	copyFile(t, filepath.Join(realRepoRoot(t), "tests", "fixtures", "source-distance", "capture.txt"), capture)

	s = NewState()
	s.Log = logx.New()
	s.Cfg = &config.Config{RepoRoot: repo, ScriptsDir: scriptsDir, PostsDir: postsDir}
	s.Prefix = "GP"
	s.WorkDir = t.TempDir()
	s.SourcePath = capture
	disp, err := llm.NewDispatcher(logx.New(), aligner)
	if err != nil {
		t.Fatal(err)
	}
	s.AlignerDispatcher = disp
	return s, repo, post
}

func bodyOf(t *testing.T, path string) string {
	t.Helper()
	parts := strings.SplitN(mustRead(t, path), "\n---\n", 2)
	if len(parts) != 2 {
		t.Fatalf("%s has no frontmatter", path)
	}
	return parts[1]
}

// TestStampPost covers source-distance-stamp〈手寫的 GP 通過〉and〈手寫的 GP 沒過〉.
func TestStampPost(t *testing.T) {
	t.Run("a passing zh-tw post gets only its stamp", func(t *testing.T) {
		aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
		s, repo, post := makeStampHarness(t, aligner)
		before := bodyOf(t, post)
		target, err := s.InspectStampTarget(context.Background(), post)
		if err != nil || !target.Required || target.Lang != "zh-tw" {
			t.Fatalf("target = %+v, %v", target, err)
		}
		outcome, err := s.StampPost(context.Background(), post, target)
		if err != nil || outcome.Verdict != SourceDistancePass || outcome.AlignerCalls != 2 {
			t.Fatalf("outcome = %+v, %v", outcome, err)
		}
		if bodyOf(t, post) != before {
			t.Fatal("stamp changed the body")
		}
		if ok, errs := verifyStamp(t, repo, post); !ok {
			t.Fatalf("stamped post fails verification: %v", errs)
		}
		if stamp := readStamp(t, repo, post); stamp.Rewrites != 0 || stamp.AlignerCalls != 2 {
			t.Fatalf("stamp = %+v", stamp)
		}
	})

	for _, tc := range []struct{ mode, verdict string }{{"translate", SourceDistanceFail}, {"zero", SourceDistanceZero}} {
		t.Run("a "+tc.mode+" zh-tw post stays unchanged", func(t *testing.T) {
			aligner := &scriptedAligner{modes: []string{tc.mode}}
			s, _, post := makeStampHarness(t, aligner)
			before := mustRead(t, post)
			outcome, err := s.StampPost(context.Background(), post, StampTarget{Lang: "zh-tw", Required: true})
			if err != nil || outcome.Verdict != tc.verdict {
				t.Fatalf("outcome = %+v, %v", outcome, err)
			}
			if tc.verdict == SourceDistanceFail && !strings.Contains(outcome.Report, "她說好的日誌一行就夠") {
				t.Fatalf("the outcome does not list the flagged passages:\n%s", outcome.Report)
			}
			if mustRead(t, post) != before {
				t.Fatal("a post that did not pass was changed")
			}
		})
	}

	t.Run("English versions: verbatim fails, own words pass and clear the zh-tw mark", func(t *testing.T) {
		aligner := &scriptedAligner{modes: []string{"guide", "guide"}}
		s, repo, zh := makeStampHarness(t, aligner)
		if _, err := s.StampPost(context.Background(), zh, StampTarget{Lang: "zh-tw", Required: true}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.sourceDistanceCLI(context.Background(), "stamp", "--file", zh, "--english-skipped"); err != nil {
			t.Fatal(err)
		}
		en := filepath.Join(filepath.Dir(zh), "en-"+filepath.Base(zh))
		writeEN := func(body string) {
			if err := os.WriteFile(en, []byte(strings.Replace(gpEnglish(body), "GP-PENDING", "GP-172", 1)), 0o644); err != nil {
				t.Fatal(err)
			}
		}

		writeEN(gpENVerbatim)
		before := mustRead(t, en)
		target, err := s.InspectStampTarget(context.Background(), en)
		if err != nil || target.Lang != "en" || !target.Required {
			t.Fatalf("target = %+v, %v", target, err)
		}
		outcome, err := s.StampPost(context.Background(), en, target)
		if err != nil || outcome.Verdict != SourceDistanceFail || len(outcome.Fails) == 0 {
			t.Fatalf("outcome = %+v, %v", outcome, err)
		}
		if mustRead(t, en) != before {
			t.Fatal("a failing English version was changed")
		}
		if readStamp(t, repo, zh).EnglishSkipped != "verbatim" {
			t.Fatal("a failing English version cleared the zh-tw mark")
		}

		writeEN(gpENOwnWords)
		outcome, err = s.StampPost(context.Background(), en, target)
		if err != nil || outcome.Verdict != SourceDistancePass || !outcome.EnglishSkippedCleared {
			t.Fatalf("outcome = %+v, %v", outcome, err)
		}
		if ok, errs := verifyStamp(t, repo, en); !ok {
			t.Fatalf("stamped English version fails verification: %v", errs)
		}
		if stamp := readStamp(t, repo, zh); stamp.EnglishSkipped != "" {
			t.Fatalf("zh-tw stamp still marks englishSkipped: %+v", stamp)
		}
		if ok, errs := verifyStamp(t, repo, zh); !ok {
			t.Fatalf("clearing the mark broke the zh-tw stamp: %v", errs)
		}
	})
}
