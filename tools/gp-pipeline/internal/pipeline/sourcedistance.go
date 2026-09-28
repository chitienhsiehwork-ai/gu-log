package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

// GP's anti-translation gate (openspec source-distance-stamp). Go only
// orchestrates: scripts/source-distance.mjs owns the body projection, sentence
// splitting, scoring and the stamp, so the pipeline, validate-posts and CI run
// one computation; the aligner only pairs sentences.

const (
	// MaxSourceDistanceRewrites caps the automatic rewrite rounds; a GP that
	// still fails after the last one stops with SourceDistanceExitCode.
	MaxSourceDistanceRewrites = 3
	// SourceDistanceExitCode is the exit code of a GP that did not pass: zero
	// alignments, or still failing after the last rewrite. `run` and `stamp`
	// share it.
	SourceDistanceExitCode = 19

	sourceDistanceEvidenceDir = "source-distance"
	rewriteDraftFile          = "rewrite-draft.mdx"
	// sourceDistanceField is the stamp's frontmatter key.
	sourceDistanceField = "sourceDistance"
)

// English verbatim check results, as the run report shows them.
const (
	EnglishCheckPass            = "PASS"
	EnglishCheckSkippedVerbatim = "SKIPPED_VERBATIM"
	// englishSkippedVerbatim is the zh-tw stamp's englishSkipped value.
	englishSkippedVerbatim = "verbatim"
)

// Source-distance verdicts, as scripts/source-distance.mjs reports them.
const (
	SourceDistancePass        = "PASS"
	SourceDistanceFail        = "FAIL"
	SourceDistanceZero        = "ZERO"
	sourceDistanceNeedsSecond = "NEEDS_SECOND"
	// SourceDistanceNotRequired marks a GP without an external source: there
	// is nothing to measure it against, and a stamp on it would be rejected.
	SourceDistanceNotRequired = "NOT_REQUIRED"
)

// SourceDistanceOutcome is what a run reports about the source-distance check.
type SourceDistanceOutcome struct {
	Verdict      string `json:"verdict"`
	Rewrites     int    `json:"rewrites"`
	AlignerCalls int    `json:"alignerCalls"`
	Aligner      string `json:"aligner,omitempty"`
	// Evidence is the work-dir directory holding every round's article,
	// segments, raw alignments and scores.
	Evidence string `json:"evidence,omitempty"`
}

// sourceDistanceSegments is the part of `source-distance.mjs segment` output
// the pipeline reads; the full JSON stays in the evidence directory.
type sourceDistanceSegments struct {
	Guide  []json.RawMessage `json:"guide"`
	Source []json.RawMessage `json:"source"`
	Prompt struct {
		Guide  string `json:"guide"`
		Source string `json:"source"`
	} `json:"prompt"`
}

type sourceDistanceScore struct {
	Verdict string `json:"verdict"`
	Report  string `json:"report"`
}

// PostFix is GP Step 4.2: the deterministic post-fixers (kaomoji, glossary
// links, related reading) edit final.mdx in the work dir, so the stamp that
// follows covers the body that ships and ralph never touches it again.
func (s *State) PostFix(ctx context.Context) error {
	if s.Prefix != "GP" {
		return nil
	}
	if s.shouldSkipBelow(StepPostFix) {
		s.Log.Info("Step 4.2: post-fixer — SKIPPED (--from-step)")
		return nil
	}
	s.Log.Info("Step 4.2: post-fixer")
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	if _, err := os.Stat(finalPath); err != nil {
		return fmt.Errorf("post-fixer: %w", err)
	}
	s.runPostFixers(ctx, finalPath)
	return nil
}

// SourceDistance is GP Step 4.4: pair, score and stamp final.mdx. A failing
// draft goes back to refine with a report of the flagged passages (no
// threshold, metric or rule), then through the post-fixers again, at most
// MaxSourceDistanceRewrites times. Zero alignments stop at once: rewriting
// cannot fix an aligner that paired nothing or a draft unrelated to its source.
func (s *State) SourceDistance(ctx context.Context) error {
	if s.Prefix != "GP" {
		return nil
	}
	if s.shouldSkipBelow(StepSourceDistance) {
		s.Log.Info("Step 4.4: source-distance — SKIPPED (--from-step)")
		return nil
	}
	s.Log.Info("Step 4.4: source-distance")
	finalPath := filepath.Join(s.WorkDir, "final.mdx")

	required, err := s.sourceDistanceRequired(ctx, finalPath)
	if err != nil {
		return err
	}
	if !required {
		s.Log.Info("  no external source to measure against; nothing to stamp")
		s.SourceDistanceResult = &SourceDistanceOutcome{Verdict: SourceDistanceNotRequired}
		return nil
	}
	capture, err := s.sourceDistanceCapture(ctx, finalPath)
	if err != nil {
		return err
	}
	// The gate never aligns with the model that wrote the draft; refuse
	// before any aligner call.
	pin, err := llm.AlignerPin(s.Cfg.RepoRoot)
	if err != nil {
		return NewStepError(14, fmt.Errorf("source-distance: %w", err))
	}
	if s.AlignerDispatcher == nil {
		return fmt.Errorf("source-distance: aligner dispatcher is nil")
	}

	evidence, err := newSourceDistanceEvidenceDir(s.WorkDir)
	if err != nil {
		return err
	}
	outcome := &SourceDistanceOutcome{Aligner: pin, Evidence: evidence}
	s.SourceDistanceResult = outcome
	for round := 0; ; round++ {
		roundDir := filepath.Join(s.WorkDir, evidence, "round-"+strconv.Itoa(round))
		result, err := s.scoreSourceDistanceRound(ctx, roundDir, finalPath, capture, outcome)
		if err != nil {
			return err
		}
		outcome.Rewrites = round
		switch result.Verdict {
		case SourceDistancePass:
			if err := s.stampSourceDistance(ctx, finalPath, filepath.Join(roundDir, "score.json"), outcome); err != nil {
				return err
			}
			outcome.Verdict = SourceDistancePass
			s.writeSourceDistanceOutcome(outcome)
			s.Log.OK("Step 4.4: source-distance PASS after %d rewrite(s), %d aligner call(s)", round, outcome.AlignerCalls)
			return nil
		case SourceDistanceZero:
			outcome.Verdict = SourceDistanceZero
			s.writeSourceDistanceOutcome(outcome)
			return NewStepError(SourceDistanceExitCode, fmt.Errorf("source-distance: no sentence of the article aligned to the source; rewriting cannot fix an unrelated article or a broken alignment (evidence: %s)", roundDir))
		case SourceDistanceFail:
			if round == MaxSourceDistanceRewrites {
				outcome.Verdict = SourceDistanceFail
				s.writeSourceDistanceOutcome(outcome)
				return NewStepError(SourceDistanceExitCode, fmt.Errorf("source-distance: the article still reads like a translation after %d rewrites; nothing was deployed (evidence: %s)", MaxSourceDistanceRewrites, filepath.Join(s.WorkDir, evidence)))
			}
			if err := s.rewriteForSourceDistance(ctx, round+1, result.Report); err != nil {
				return err
			}
		default:
			return NewStepError(14, fmt.Errorf("source-distance: unexpected verdict %q", result.Verdict))
		}
	}
}

// scoreSourceDistanceRound segments the current final.mdx, runs the first
// alignment and, only when it clears every rule, the second one. Every input
// and output is kept in roundDir.
func (s *State) scoreSourceDistanceRound(ctx context.Context, roundDir, finalPath, capture string, outcome *SourceDistanceOutcome) (*sourceDistanceScore, error) {
	if err := os.MkdirAll(roundDir, 0o755); err != nil {
		return nil, fmt.Errorf("source-distance: %w", err)
	}
	article, err := os.ReadFile(finalPath)
	if err != nil {
		return nil, fmt.Errorf("source-distance: read final.mdx: %w", err)
	}
	if err := os.WriteFile(filepath.Join(roundDir, "final.mdx"), article, 0o644); err != nil {
		return nil, fmt.Errorf("source-distance: keep round article: %w", err)
	}

	segmentsPath := filepath.Join(roundDir, "segments.json")
	raw, err := s.sourceDistanceCLI(ctx, "segment", "--file", finalPath, "--source", capture)
	if err != nil {
		return nil, NewStepError(14, err)
	}
	if err := os.WriteFile(segmentsPath, raw, 0o644); err != nil {
		return nil, fmt.Errorf("source-distance: keep segments: %w", err)
	}
	var segments sourceDistanceSegments
	if err := json.Unmarshal(raw, &segments); err != nil {
		return nil, fmt.Errorf("source-distance: parse segments: %w", err)
	}
	prompt, err := prompts.Render("align", prompts.AlignData{
		SourceCount: len(segments.Source),
		Source:      segments.Prompt.Source,
		GuideCount:  len(segments.Guide),
		Guide:       segments.Prompt.Guide,
	})
	if err != nil {
		return nil, fmt.Errorf("source-distance: render aligner prompt: %w", err)
	}

	alignments := []string{}
	var result *sourceDistanceScore
	for attempt := 1; attempt <= 2; attempt++ {
		alignment := filepath.Join(roundDir, fmt.Sprintf("alignment-%d.json", attempt))
		if err := s.alignSourceDistance(ctx, prompt, alignment, outcome); err != nil {
			return nil, err
		}
		alignments = append(alignments, alignment)
		args := []string{"score", "--segments", segmentsPath}
		for _, a := range alignments {
			args = append(args, "--alignment", a)
		}
		out, err := s.sourceDistanceCLI(ctx, args...)
		if err != nil {
			// Exit 2 is an aligner output the program rejects (a sentence
			// missing or repeated, an unknown id): a failed alignment, never a
			// verdict, and never a rewrite round.
			return nil, NewStepError(14, fmt.Errorf("source-distance: aligner output rejected; resume with --from-step source-distance: %w", err))
		}
		if err := os.WriteFile(filepath.Join(roundDir, fmt.Sprintf("score-%d.json", attempt)), out, 0o644); err != nil {
			return nil, fmt.Errorf("source-distance: keep score: %w", err)
		}
		result = &sourceDistanceScore{}
		if err := json.Unmarshal(out, result); err != nil {
			return nil, fmt.Errorf("source-distance: parse score: %w", err)
		}
		if result.Verdict != sourceDistanceNeedsSecond {
			if err := os.WriteFile(filepath.Join(roundDir, "score.json"), out, 0o644); err != nil {
				return nil, fmt.Errorf("source-distance: keep score: %w", err)
			}
			break
		}
	}
	if result.Verdict == sourceDistanceNeedsSecond {
		return nil, fmt.Errorf("source-distance: the second alignment did not settle the verdict")
	}
	if result.Report != "" {
		if err := os.WriteFile(filepath.Join(roundDir, "report.md"), []byte(result.Report), 0o644); err != nil {
			return nil, fmt.Errorf("source-distance: keep report: %w", err)
		}
	}
	s.Log.Info("  round %s: %s", filepath.Base(roundDir), result.Verdict)
	return result, nil
}

// alignSourceDistance runs one aligner call and keeps its raw output. A failed
// call stops the run under the Claude error classification: it is neither a
// verdict nor a rewrite round, and the run resumes with --from-step
// source-distance.
func (s *State) alignSourceDistance(ctx context.Context, prompt, outPath string, outcome *SourceDistanceOutcome) error {
	cwd := filepath.Join(s.WorkDir, sourceDistanceEvidenceDir, "aligner-cwd")
	if err := os.MkdirAll(cwd, 0o755); err != nil {
		return fmt.Errorf("source-distance: %w", err)
	}
	res, err := s.AlignerDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: cwd, JSONSchema: llm.AlignmentJSONSchema})
	if err != nil {
		return NewStepError(14, fmt.Errorf("source-distance: aligner failed; resume with --from-step source-distance: %w", err))
	}
	outcome.AlignerCalls++
	if err := os.WriteFile(outPath, []byte(res.Output), 0o644); err != nil {
		return fmt.Errorf("source-distance: keep alignment: %w", err)
	}
	return nil
}

// rewriteForSourceDistance sends a failing final.mdx back through refine with
// the flagged passages, then reruns the post-fixers. Review does not run
// again; the Tribunal Fact Checker catches a claim the rewrite bent.
func (s *State) rewriteForSourceDistance(ctx context.Context, round int, report string) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	draftPath := filepath.Join(s.WorkDir, rewriteDraftFile)
	article, err := os.ReadFile(finalPath)
	if err != nil {
		return fmt.Errorf("source-distance: read final.mdx: %w", err)
	}
	if err := os.WriteFile(draftPath, article, 0o644); err != nil {
		return fmt.Errorf("source-distance: stage rewrite draft: %w", err)
	}
	// Refine falls back to stdout only when final.mdx is absent, so a writer
	// that returns without writing cannot pass the old article off as a rewrite.
	if err := os.Remove(finalPath); err != nil {
		return fmt.Errorf("source-distance: clear final.mdx before the rewrite: %w", err)
	}
	s.Log.Info("  rewrite %d/%d: sending the flagged passages back to refine", round, MaxSourceDistanceRewrites)
	if err := s.refine(ctx, prompts.RefineData{Draft: rewriteDraftFile, RewriteReport: report}); err != nil {
		// Keep the last scored article as final.mdx so --from-step
		// source-distance resumes from it instead of the unrefined draft.
		if _, statErr := os.Stat(finalPath); os.IsNotExist(statErr) {
			_ = os.WriteFile(finalPath, article, 0o644)
		}
		return err
	}
	s.runPostFixers(ctx, finalPath)
	return nil
}

func (s *State) stampSourceDistance(ctx context.Context, finalPath, scorePath string, outcome *SourceDistanceOutcome) error {
	_, err := s.sourceDistanceCLI(ctx, "stamp",
		"--file", finalPath,
		"--result", scorePath,
		"--aligner", outcome.Aligner,
		"--rewrites", strconv.Itoa(outcome.Rewrites),
		"--aligner-calls", strconv.Itoa(outcome.AlignerCalls),
	)
	if err != nil {
		return NewStepError(14, fmt.Errorf("source-distance: stamp: %w", err))
	}
	return nil
}

// checkEnglishVerbatim is the GP English check (openspec source-distance-stamp
// 〈英文版 SHALL 通過逐字 n-gram 檢查〉). A passing English version gets its own
// stamp and clears a zh-tw englishSkipped mark left by an earlier run. A
// failing one is removed and never retranslated: the zh-tw stamp records
// englishSkipped: verbatim, the run report says so, and zh-tw deploys alone.
func (s *State) checkEnglishVerbatim(ctx context.Context, zhPath, enPath string) error {
	required, err := s.sourceDistanceRequired(ctx, enPath)
	if err != nil {
		return err
	}
	if !required {
		s.Log.Info("  English version has no external source to check against")
		return nil
	}
	capture, err := s.sourceDistanceCapture(ctx, zhPath)
	if err != nil {
		return err
	}
	resultPath, result, err := s.englishNgram(ctx, enPath, capture)
	if err != nil {
		return err
	}

	switch result.Verdict {
	case SourceDistancePass:
		if _, err := s.sourceDistanceCLI(ctx, "stamp", "--file", enPath, "--result", resultPath); err != nil {
			return NewStepError(14, fmt.Errorf("english check: stamp the English version: %w", err))
		}
		if zhSkippedEnglish(zhPath) {
			if _, err := s.sourceDistanceCLI(ctx, "stamp", "--file", zhPath, "--clear-english-skipped"); err != nil {
				return NewStepError(14, fmt.Errorf("english check: clear englishSkipped: %w", err))
			}
		}
		s.EnglishCheck = EnglishCheckPass
		s.Log.OK("  English verbatim check PASS")
		return nil
	case SourceDistanceFail:
		if err := os.Remove(enPath); err != nil {
			return fmt.Errorf("english check: remove the failing English version: %w", err)
		}
		if _, err := s.sourceDistanceCLI(ctx, "stamp", "--file", zhPath, "--english-skipped", englishSkippedVerbatim); err != nil {
			return NewStepError(14, fmt.Errorf("english check: mark the zh-tw stamp englishSkipped: %w", err))
		}
		s.EnglishCheck = EnglishCheckSkippedVerbatim
		s.Log.Warn("  English version copies the source verbatim; it is removed without a retranslation and zh-tw deploys alone (evidence: %s)", resultPath)
		return nil
	default:
		return NewStepError(14, fmt.Errorf("english check: unexpected verdict %q", result.Verdict))
	}
}

// englishNgramResult is the part of `source-distance.mjs ngram` output the
// pipeline reads.
type englishNgramResult struct {
	Verdict string          `json:"verdict"`
	Fails   []string        `json:"fails"`
	Metrics json.RawMessage `json:"metrics"`
}

// englishNgram runs the verbatim n-gram check on an English version and keeps
// the result in the work dir's evidence directory.
func (s *State) englishNgram(ctx context.Context, enPath, capture string) (string, *englishNgramResult, error) {
	evidence := filepath.Join(s.WorkDir, sourceDistanceEvidenceDir)
	if err := os.MkdirAll(evidence, 0o755); err != nil {
		return "", nil, fmt.Errorf("english check: %w", err)
	}
	resultPath := filepath.Join(evidence, "en-check.json")
	out, err := s.sourceDistanceCLI(ctx, "ngram", "--file", enPath, "--source", capture)
	if err != nil {
		return "", nil, NewStepError(14, fmt.Errorf("english check: %w", err))
	}
	if err := os.WriteFile(resultPath, out, 0o644); err != nil {
		return "", nil, fmt.Errorf("english check: keep result: %w", err)
	}
	result := &englishNgramResult{}
	if err := json.Unmarshal(out, result); err != nil {
		return "", nil, fmt.Errorf("english check: parse result: %w", err)
	}
	return resultPath, result, nil
}

// StampOutcome is what `gp-pipeline stamp` reports about one post.
type StampOutcome struct {
	File         string `json:"file"`
	Lang         string `json:"lang"`
	Verdict      string `json:"verdict"`
	Aligner      string `json:"aligner,omitempty"`
	AlignerCalls int    `json:"alignerCalls,omitempty"`
	// Evidence is the work-dir directory with the segments, alignments and
	// scores; the capture stays in the work dir too, never in the repo.
	Evidence string `json:"evidence,omitempty"`
	// Report lists the flagged passages of a zh-tw post that did not pass.
	Report string `json:"report,omitempty"`
	// Fails and Metrics describe an English version that did not pass.
	Fails   []string        `json:"fails,omitempty"`
	Metrics json.RawMessage `json:"metrics,omitempty"`
	// EnglishSkippedCleared: a passing English version cleared the zh-tw
	// stamp's englishSkipped mark.
	EnglishSkippedCleared bool `json:"englishSkippedCleared,omitempty"`
}

// StampPost checks one existing GP post the way the pipeline does — two
// alignments and scoring for zh-tw, the verbatim check for English — and,
// when it passes, writes only its stamp (openspec source-distance-stamp〈手寫
// 或人工修改的 GP SHALL 能用 gp-pipeline stamp 蓋章〉). It never rewrites the
// body: a post that does not pass is left unchanged, and the outcome carries
// the flagged passages.
func (s *State) StampPost(ctx context.Context, file string, target StampTarget) (*StampOutcome, error) {
	capture, err := s.sourceDistanceCapture(ctx, file)
	if err != nil {
		return nil, err
	}
	if target.Lang == "en" {
		return s.stampEnglishPost(ctx, file, capture)
	}
	pin, err := llm.AlignerPin(s.Cfg.RepoRoot)
	if err != nil {
		return nil, NewStepError(14, fmt.Errorf("source-distance: %w", err))
	}
	if s.AlignerDispatcher == nil {
		return nil, fmt.Errorf("source-distance: aligner dispatcher is nil")
	}
	evidence, err := newSourceDistanceEvidenceDir(s.WorkDir)
	if err != nil {
		return nil, err
	}
	outcome := &SourceDistanceOutcome{Aligner: pin, Evidence: evidence}
	roundDir := filepath.Join(s.WorkDir, evidence, "round-0")
	result, err := s.scoreSourceDistanceRound(ctx, roundDir, file, capture, outcome)
	if err != nil {
		return nil, err
	}
	res := &StampOutcome{
		File:         file,
		Lang:         nonEmpty(target.Lang, "zh-tw"),
		Verdict:      result.Verdict,
		Aligner:      pin,
		AlignerCalls: outcome.AlignerCalls,
		Evidence:     filepath.Join(s.WorkDir, evidence),
		Report:       result.Report,
	}
	outcome.Verdict = result.Verdict
	if result.Verdict == SourceDistancePass {
		if err := s.stampSourceDistance(ctx, file, filepath.Join(roundDir, "score.json"), outcome); err != nil {
			return nil, err
		}
	}
	s.writeSourceDistanceOutcome(outcome)
	return res, nil
}

func (s *State) stampEnglishPost(ctx context.Context, file, capture string) (*StampOutcome, error) {
	resultPath, result, err := s.englishNgram(ctx, file, capture)
	if err != nil {
		return nil, err
	}
	res := &StampOutcome{
		File:     file,
		Lang:     "en",
		Verdict:  result.Verdict,
		Evidence: filepath.Dir(resultPath),
		Fails:    result.Fails,
		Metrics:  result.Metrics,
	}
	if result.Verdict != SourceDistancePass {
		return res, nil
	}
	if _, err := s.sourceDistanceCLI(ctx, "stamp", "--file", file, "--result", resultPath); err != nil {
		return nil, NewStepError(14, fmt.Errorf("english check: stamp: %w", err))
	}
	zh := filepath.Join(filepath.Dir(file), strings.TrimPrefix(filepath.Base(file), "en-"))
	if zh != file && zhSkippedEnglish(zh) {
		if _, err := s.sourceDistanceCLI(ctx, "stamp", "--file", zh, "--clear-english-skipped"); err != nil {
			return nil, NewStepError(14, fmt.Errorf("english check: clear englishSkipped on %s: %w", filepath.Base(zh), err))
		}
		res.EnglishSkippedCleared = true
	}
	return res, nil
}

// zhSkippedEnglish reports whether a zh-tw stamp carries englishSkipped.
func zhSkippedEnglish(path string) bool {
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return false
	}
	block, ok := f.GetBlock(sourceDistanceField)
	return ok && strings.Contains(block, "\n  englishSkipped:")
}

// StampTarget is what the source-distance CLI reports about one post.
type StampTarget struct {
	Lang     string `json:"lang"`
	GP       bool   `json:"gp"`
	External bool   `json:"external"`
	// Required: a GP post with an external source that is not taken down.
	Required bool `json:"required"`
}

// InspectStampTarget asks the Node side whether a post needs a stamp, so Go
// keeps no copy of that rule.
func (s *State) InspectStampTarget(ctx context.Context, file string) (StampTarget, error) {
	out, err := s.sourceDistanceCLIAllowing(ctx, []int{5}, "verify", "--file", file)
	if err != nil {
		return StampTarget{}, err
	}
	var verdict struct {
		Results []StampTarget `json:"results"`
	}
	if err := json.Unmarshal(out, &verdict); err != nil || len(verdict.Results) != 1 {
		return StampTarget{}, fmt.Errorf("source-distance: parse verify output: %v", err)
	}
	return verdict.Results[0], nil
}

func (s *State) sourceDistanceRequired(ctx context.Context, file string) (bool, error) {
	target, err := s.InspectStampTarget(ctx, file)
	if err != nil {
		return false, NewStepError(14, err)
	}
	return target.Required, nil
}

// sourceDistanceCapture returns the source capture to measure against: the
// run's own fetch, a capture already in the work dir, or a fresh fetch of the
// article's sourceUrl into the work dir (never into the repo).
func (s *State) sourceDistanceCapture(ctx context.Context, finalPath string) (string, error) {
	for _, candidate := range []string{s.SourcePath, filepath.Join(s.WorkDir, "source-tweet.md")} {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && info.Size() > 0 {
			return candidate, nil
		}
	}
	sourceURL, err := frontmatterSourceURL(finalPath)
	if err != nil {
		return "", fmt.Errorf("source-distance: %w", err)
	}
	s.Log.Info("  no source capture in the work dir; fetching %s", sourceURL)
	res, err := source.Fetch(ctx, sourceURL, source.FetchOptions{
		WorkDir:             s.WorkDir,
		FetchXArticleScript: s.Cfg.FetchXArticle,
		FetchArticleScript:  s.Cfg.FetchArticle,
	})
	if err != nil {
		return "", NewStepError(10, fmt.Errorf("source-distance: fetch source: %w", err))
	}
	s.SourcePath = res.Path
	return res.Path, nil
}

func frontmatterSourceURL(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return "", err
	}
	raw, ok := f.GetScalar("sourceUrl")
	if !ok {
		return "", fmt.Errorf("%s has no sourceUrl", filepath.Base(path))
	}
	value, err := decodeYAMLScalar(raw)
	if err != nil || value == "" {
		return "", fmt.Errorf("%s has an unreadable sourceUrl %q", filepath.Base(path), raw)
	}
	return value, nil
}

func (s *State) sourceDistanceCLI(ctx context.Context, args ...string) ([]byte, error) {
	return s.sourceDistanceCLIAllowing(ctx, nil, args...)
}

// sourceDistanceCLIAllowing runs scripts/source-distance.mjs and returns its
// JSON stdout. Exit codes listed in allowed still carry a JSON result.
func (s *State) sourceDistanceCLIAllowing(ctx context.Context, allowed []int, args ...string) ([]byte, error) {
	script := filepath.Join(s.Cfg.ScriptsDir, "source-distance.mjs")
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "node",
		Args:    append([]string{script}, args...),
		WorkDir: s.Cfg.RepoRoot,
	})
	if err != nil {
		if res != nil {
			for _, code := range allowed {
				if res.ExitCode == code {
					return res.Stdout, nil
				}
			}
		}
		return nil, fmt.Errorf("source-distance.mjs %s: %w", args[0], err)
	}
	return res.Stdout, nil
}

// newSourceDistanceEvidenceDir picks a fresh attempt directory, so a resumed
// run keeps the evidence of the attempts before it.
func newSourceDistanceEvidenceDir(workDir string) (string, error) {
	for n := 1; ; n++ {
		rel := filepath.Join(sourceDistanceEvidenceDir, "attempt-"+strconv.Itoa(n))
		path := filepath.Join(workDir, rel)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if err := os.MkdirAll(path, 0o755); err != nil {
				return "", fmt.Errorf("source-distance: %w", err)
			}
			return rel, nil
		} else if err != nil {
			return "", fmt.Errorf("source-distance: %w", err)
		}
	}
}

func (s *State) writeSourceDistanceOutcome(outcome *SourceDistanceOutcome) {
	path := filepath.Join(s.WorkDir, outcome.Evidence, "outcome.json")
	if err := writeJSON(path, outcome); err != nil && s.Log != nil {
		s.Log.Warn("source-distance: %v", err)
	}
}

// sourceDistanceSummary is the one-line run summary of the check.
func sourceDistanceSummary(o *SourceDistanceOutcome) string {
	if o == nil {
		return "not run"
	}
	if o.Evidence == "" {
		return o.Verdict
	}
	return fmt.Sprintf("%s (rewrites %d, aligner calls %d, evidence %s)", o.Verdict, o.Rewrites, o.AlignerCalls, o.Evidence)
}
