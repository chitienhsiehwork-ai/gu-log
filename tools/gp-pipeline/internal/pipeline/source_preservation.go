package pipeline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/preservation"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/terminology"
)

const maxGPCorrectionAttempts = 3

var gpRequiredGates = []string{"source-reviewer", "vibe-scorer"}

func (s *State) sourceBytes() ([]byte, error) {
	path := s.SourcePath
	if path == "" {
		path = filepath.Join(s.WorkDir, "source-tweet.md")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read GP source %s: %w", path, err)
	}
	if len(data) == 0 {
		return nil, errors.New("GP source is empty")
	}
	s.SourcePath = path
	return data, nil
}

// SourceTranslate is the GP Step 2 replacement. Its output is a complete,
// source-aligned translation, never an editorial brief or angle-driven draft.
func (s *State) SourceTranslate(ctx context.Context) error {
	path := filepath.Join(s.WorkDir, "source-translation.mdx")
	if s.shouldSkipBelow(StepSourceTranslate) {
		s.Log.Info("Step 2: source-translate — SKIPPED (--from-step)")
		if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			return errors.New("source-translate recovery requires the original frozen source-translation.mdx in --work-dir; an enriched --file cannot reconstruct it")
		}
		return s.restoreSourceTranslationRun(path)
	}
	if s.Angle != "" {
		return errors.New("source-translate: --angle is forbidden for production GP")
	}
	s.Log.Info("Step 2: source-translate")
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	if s.TranslatedDate == "" {
		s.TranslatedDate = time.Now().Format("2006-01-02")
	}
	canonicalTerminology := s.CanonicalTerminology
	if canonicalTerminology == "" {
		canonicalTerminology, err = terminology.LoadCanonicalContext(s.Cfg.RepoRoot)
		if err != nil {
			return fmt.Errorf("source-translate terminology context: %w", err)
		}
	}
	prompt, err := prompts.Render("source-translate", prompts.SourceTranslateData{
		Version: preservation.ContractVersion, TicketID: s.PromptTicketID,
		OriginalDate: s.OriginalDate, TranslatedDate: s.TranslatedDate,
		SourceField: s.ResolveSourceField(), SourceURL: s.TweetURL,
		SourceSHA256: preservation.SHA256(source), Source: string(source),
		CanonicalTerminology: canonicalTerminology,
	})
	if err != nil {
		return fmt.Errorf("source-translate prompt: %w", err)
	}
	if s.TranslatorDispatcher == nil {
		return errors.New("source-translate dispatcher is nil")
	}
	result, err := s.TranslatorDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir, JSONSchema: preservation.SourceTranslationJSONSchema})
	if err != nil {
		s.RecordRoleFailure("translator", err)
		return NewStepError(14, fmt.Errorf("source-translate runner: %w", err))
	}
	var artifact preservation.SourceTranslationArtifact
	if err := preservation.DecodeStrict([]byte(result.Output), &artifact); err != nil {
		return fmt.Errorf("source-translate output: %w", err)
	}
	if artifact.Version != preservation.ContractVersion || artifact.SourceSHA256 != preservation.SHA256(source) || strings.TrimSpace(artifact.TranslationMDX) == "" {
		return errors.New("source-translate returned an invalid or stale artifact")
	}
	translation := []byte(artifact.TranslationMDX)
	if len(artifact.SlopCandidates) > 0 {
		if err := preservation.ValidateFindings(source, translation, artifact.SlopCandidates); err != nil {
			return fmt.Errorf("source-translate slop candidates: %w", err)
		}
		for _, finding := range artifact.SlopCandidates {
			if finding.Approved {
				return fmt.Errorf("source-translate cannot approve slop candidate %q", finding.ID)
			}
		}
	}
	canonicalTranslation, offsetMap := preservation.EscapeMDXImageAltBracesWithOffsets(translation)
	if !bytes.Equal(canonicalTranslation, translation) {
		if len(artifact.SlopCandidates) > 0 {
			canonicalCandidates := append([]preservation.Finding(nil), artifact.SlopCandidates...)
			for i := range canonicalCandidates {
				finding := &canonicalCandidates[i]
				finding.StartByte = offsetMap[finding.StartByte]
				finding.EndByte = offsetMap[finding.EndByte]
				finding.OldText = string(canonicalTranslation[finding.StartByte:finding.EndByte])
				finding.OldTextSHA256 = preservation.SHA256([]byte(finding.OldText))
				finding.TranslationSHA256 = preservation.SHA256(canonicalTranslation)
			}
			if err := preservation.ValidateFindings(source, canonicalTranslation, canonicalCandidates); err != nil {
				return fmt.Errorf("source-translate canonical findings: %w", err)
			}
			artifact.SlopCandidates = canonicalCandidates
		}
		translation = canonicalTranslation
		artifact.TranslationMDX = string(translation)
	}
	translationFile, err := frontmatter.Parse(translation)
	if err != nil {
		return fmt.Errorf("source-translate frontmatter: %w", err)
	}
	originalBodyStart := len(translation) - len(translationFile.Body())
	translationFile.RepairSingleQuotedScalars()
	if err := translationFile.ValidateYAML(); err != nil {
		return fmt.Errorf("source-translate frontmatter: %w", err)
	}
	// Runtime owns date metadata; canonicalize it after validating model output.
	translationFile.SetScalar("originalDate", frontmatter.QuoteScalar(s.OriginalDate))
	translationFile.SetScalar("translatedDate", frontmatter.QuoteScalar(s.TranslatedDate))
	translation = translationFile.Bytes()
	artifact.TranslationMDX = string(translation)
	if len(artifact.SlopCandidates) > 0 {
		canonicalCandidates := append([]preservation.Finding(nil), artifact.SlopCandidates...)
		bodyStartDelta := len(translation) - len(translationFile.Body()) - originalBodyStart
		translationHash := preservation.SHA256(translation)
		for i := range canonicalCandidates {
			canonicalCandidates[i].StartByte += bodyStartDelta
			canonicalCandidates[i].EndByte += bodyStartDelta
			canonicalCandidates[i].TranslationSHA256 = translationHash
		}
		if err := preservation.ValidateFindings(source, translation, canonicalCandidates); err != nil {
			return fmt.Errorf("source-translate canonical slop candidates: %w", err)
		}
		artifact.SlopCandidates = canonicalCandidates
	}
	if err := os.WriteFile(path, translation, 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(s.WorkDir, "source-translation.initial.mdx"), translation, 0o644); err != nil {
		return err
	}
	artifact.TranslationSHA256 = preservation.SHA256(translation)
	artifact.Provenance = provenanceFor("translator", result)
	artifactPath := filepath.Join(s.WorkDir, "source-translate.json")
	if err := preservation.WriteJSON(artifactPath, artifact); err != nil {
		return err
	}
	s.recordRoleRun("translator", result, artifactPath, "COMPLETED")
	s.WriteModel, s.WriteHarness = llm.DisplayName(result.ActualModel), llm.HarnessName(result.Model)
	s.Log.OK("Step 2: source-aligned translation written by %s", s.WriteModel)
	return nil
}

func (s *State) PreserveGP(ctx context.Context) error {
	translationPath := filepath.Join(s.WorkDir, "source-translation.mdx")
	if s.shouldSkipBelow(StepSourceGate) {
		s.Log.Info("Step 3: source-preservation gates — validating recovery manifest")
		if err := s.ValidateGPPublishManifest(ctx, translationPath); err != nil {
			return fmt.Errorf("GP recovery: %w", err)
		}
		return s.restoreOptionalCorrectorRun()
	}
	s.Log.Info("Step 3: source-preservation gates")
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	if err := s.restoreOptionalCorrectorRun(); err != nil {
		return fmt.Errorf("verify existing GP correction chain: %w", err)
	}
	attemptOffset, err := highestPreservationAttempt(s.WorkDir)
	if err != nil {
		return err
	}
	var finalGates []preservation.GateEnvelope
	var finalJingjing preservation.JingjingArtifact
	for attempt := 1; attempt <= maxGPCorrectionAttempts+1; attempt++ {
		artifactAttempt := attemptOffset + attempt
		jingjing, translation, err := preservation.CheckJingjing(ctx, s.Cfg.RepoRoot, translationPath)
		if err != nil {
			return err
		}
		if err := preservation.WriteJSON(filepath.Join(s.WorkDir, fmt.Sprintf("jingjing-gate-attempt-%d.json", artifactAttempt)), jingjing); err != nil {
			return err
		}
		jingjingFindings, err := preservation.JingjingFindings(source, translation, jingjing)
		if err != nil {
			return err
		}
		projection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, translationPath)
		if err != nil {
			return err
		}
		sourceGate, err := s.runSourceReviewer(ctx, source, translation, projection, artifactAttempt)
		if err != nil {
			return err
		}
		vibeGate, err := s.runVibeGate(ctx, source, translation, projection, artifactAttempt)
		if err != nil {
			return err
		}
		finalGates = []preservation.GateEnvelope{sourceGate, vibeGate}
		deterministic := preservation.DeterministicSourceFindings(source, translation)
		if err := preservation.WriteJSON(filepath.Join(s.WorkDir, fmt.Sprintf("deterministic-findings-attempt-%d.json", artifactAttempt)), deterministic); err != nil {
			return err
		}
		if sourceGate.Verdict == "PASS" && vibeGate.Verdict == "PASS" && len(deterministic) == 0 && len(jingjingFindings) == 0 {
			finalJingjing = jingjing
			break
		}
		if attempt > maxGPCorrectionAttempts {
			return errors.New("GP hard gates still FAIL after bounded correction attempts")
		}
		if err := validateApprovedFindings(sourceGate.Findings, vibeGate.Findings); err != nil {
			return err
		}
		findings := appendNonOverlappingFindings(jingjingFindings, sourceGate.Findings, vibeGate.Findings)
		if len(findings) == 0 {
			if len(deterministic) != 0 {
				return fmt.Errorf("GP deterministic hard gate FAIL without an actionable reviewer finding: %s", strings.Join(deterministic, "; "))
			}
			return errors.New("GP hard gate FAIL without actionable bounded findings")
		}
		if err := s.runCorrector(ctx, source, translation, findings, artifactAttempt); err != nil {
			return err
		}
	}
	if err := s.sealGPPublishManifest(ctx, source, translationPath, finalGates, finalJingjing); err != nil {
		return err
	}
	return s.restoreOptionalCorrectorRun()
}

func highestPreservationAttempt(workDir string) (int, error) {
	entries, err := os.ReadDir(workDir)
	if err != nil {
		return 0, err
	}
	highest := 0
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") && !strings.HasSuffix(name, ".mdx") {
			continue
		}
		stem := strings.TrimSuffix(strings.TrimSuffix(name, ".json"), ".mdx")
		marker := strings.LastIndex(stem, "-attempt-")
		if marker < 0 {
			continue
		}
		attempt, parseErr := strconv.Atoi(stem[marker+len("-attempt-"):])
		if parseErr != nil || attempt < 1 {
			return 0, fmt.Errorf("invalid preservation attempt artifact %s", name)
		}
		if attempt > highest {
			highest = attempt
		}
	}
	return highest, nil
}

func validateApprovedFindings(groups ...[]preservation.Finding) error {
	for _, group := range groups {
		for _, finding := range group {
			if !finding.Approved {
				return fmt.Errorf("GP finding %s requires manual correction", finding.ID)
			}
		}
	}
	return nil
}

// Deterministic Jingjing boundaries take precedence over overlapping LLM
// findings for one iteration. The semantic gates rerun after correction, so a
// broader issue is deferred rather than waived while duplicate patches cannot
// overlap or widen the canonical checker boundary.
func appendNonOverlappingFindings(primary []preservation.Finding, groups ...[]preservation.Finding) []preservation.Finding {
	out := append([]preservation.Finding(nil), primary...)
	for _, group := range groups {
		for _, candidate := range group {
			overlaps := false
			for _, accepted := range out {
				if candidate.StartByte < accepted.EndByte && candidate.EndByte > accepted.StartByte {
					overlaps = true
					break
				}
			}
			if !overlaps {
				out = append(out, candidate)
			}
		}
	}
	return out
}

func (s *State) runSourceReviewer(ctx context.Context, source, translation []byte, projection preservation.Projection, attempt int) (preservation.GateEnvelope, error) {
	prompt, err := prompts.Render("source-review", prompts.PreservationGateData{Version: preservation.ContractVersion, Gate: "source-reviewer", SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), BodyProjectionSHA256: projection.SHA256, Source: string(source), Translation: projection.Body})
	if err != nil {
		return preservation.GateEnvelope{}, err
	}
	if s.SourceReviewerDispatcher == nil {
		return preservation.GateEnvelope{}, errors.New("source-reviewer dispatcher is nil")
	}
	result, err := s.SourceReviewerDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		s.RecordRoleFailure("source-reviewer", err)
		return preservation.GateEnvelope{}, fmt.Errorf("source-reviewer runner: %w", err)
	}
	rawPath := filepath.Join(s.WorkDir, fmt.Sprintf("source-review-raw-attempt-%d.json", attempt))
	if err := os.WriteFile(rawPath, []byte(result.Output), 0o644); err != nil {
		return preservation.GateEnvelope{}, err
	}
	var review preservation.ReviewArtifact
	if err := preservation.DecodeStrict([]byte(result.Output), &review); err != nil {
		return preservation.GateEnvelope{}, err
	}
	review.Findings, err = preservation.CanonicalizeFindingAnchors(translation, review.Findings)
	if err != nil {
		return preservation.GateEnvelope{}, err
	}
	if review.Version != preservation.ContractVersion || review.SourceSHA256 != preservation.SHA256(source) || review.TranslationSHA256 != preservation.SHA256(translation) || (review.Verdict != "PASS" && review.Verdict != "FAIL") {
		return preservation.GateEnvelope{}, errors.New("source-reviewer returned an invalid or stale verdict")
	}
	if err := preservation.ValidateVerdictFindings(review.Verdict, review.Findings); err != nil {
		return preservation.GateEnvelope{}, fmt.Errorf("source-reviewer verdict: %w", err)
	}
	if err := preservation.ValidateFindings(source, translation, review.Findings); err != nil {
		return preservation.GateEnvelope{}, err
	}
	gate := preservation.GateEnvelope{Version: preservation.ContractVersion, Gate: "source-reviewer", SourceSHA256: review.SourceSHA256, BodyProjectionSHA256: projection.SHA256, Verdict: review.Verdict, Findings: review.Findings, Provenance: provenanceFor("source-reviewer", result)}
	path := filepath.Join(s.WorkDir, fmt.Sprintf("source-review-attempt-%d.json", attempt))
	if err := preservation.WriteJSON(path, gate); err != nil {
		return gate, err
	}
	if err := preservation.WriteJSON(filepath.Join(s.WorkDir, "source-review.json"), gate); err != nil {
		return gate, err
	}
	s.recordRoleRun("source-reviewer", result, path, gate.Verdict)
	return gate, preservation.ValidateGate(gate, "source-reviewer", preservation.SHA256(source), projection.SHA256)
}

func (s *State) runVibeGate(ctx context.Context, source, translation []byte, projection preservation.Projection, attempt int) (preservation.GateEnvelope, error) {
	prompt, err := prompts.Render("vibe-gate", prompts.PreservationGateData{Version: preservation.ContractVersion, Gate: "vibe-scorer", SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), BodyProjectionSHA256: projection.SHA256, Source: string(source), Translation: projection.Body})
	if err != nil {
		return preservation.GateEnvelope{}, err
	}
	if s.VibeScorerDispatcher == nil {
		return preservation.GateEnvelope{}, errors.New("vibe-scorer dispatcher is nil")
	}
	result, err := s.VibeScorerDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir, JSONSchema: preservation.GateEnvelopeJSONSchema})
	if err != nil {
		s.RecordRoleFailure("vibe-scorer", err)
		return preservation.GateEnvelope{}, fmt.Errorf("vibe-scorer runner: %w", err)
	}
	rawPath := filepath.Join(s.WorkDir, fmt.Sprintf("vibe-gate-raw-attempt-%d.json", attempt))
	if err := os.WriteFile(rawPath, []byte(result.Output), 0o644); err != nil {
		return preservation.GateEnvelope{}, err
	}
	var gate preservation.GateEnvelope
	if err := preservation.DecodeStrict([]byte(result.Output), &gate); err != nil {
		return gate, err
	}
	gate.Findings, err = preservation.CanonicalizeFindingAnchors(translation, gate.Findings)
	if err != nil {
		return gate, err
	}
	gate.Provenance = provenanceFor("vibe-scorer", result)
	if err := preservation.ValidateFindings(source, translation, gate.Findings); err != nil {
		return gate, err
	}
	if err := preservation.ValidateGate(gate, "vibe-scorer", preservation.SHA256(source), projection.SHA256); err != nil {
		return gate, err
	}
	path := filepath.Join(s.WorkDir, fmt.Sprintf("vibe-gate-attempt-%d.json", attempt))
	if err := preservation.WriteJSON(path, gate); err != nil {
		return gate, err
	}
	if err := preservation.WriteJSON(filepath.Join(s.WorkDir, "vibe-gate.json"), gate); err != nil {
		return gate, err
	}
	s.recordRoleRun("vibe-scorer", result, path, gate.Verdict)
	return gate, nil
}

func (s *State) runCorrector(ctx context.Context, source, translation []byte, findings []preservation.Finding, attempt int) error {
	findingsJSON, _ := json.Marshal(findings)
	prompt, err := prompts.Render("correct", prompts.CorrectData{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), Source: string(source), Translation: string(translation), ApprovedFindingsJSON: string(findingsJSON)})
	if err != nil {
		return err
	}
	if s.CorrectorDispatcher == nil {
		return errors.New("corrector dispatcher is nil")
	}
	result, err := s.CorrectorDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		s.RecordRoleFailure("corrector", err)
		return fmt.Errorf("corrector runner: %w", err)
	}
	var artifact preservation.PatchArtifact
	if err := preservation.DecodeStrict([]byte(result.Output), &artifact); err != nil {
		return err
	}
	artifact.Provenance = provenanceFor("corrector", result)
	if len(artifact.Patches) == 0 {
		return errors.New("corrector returned no bounded patches")
	}
	if err := preservation.ValidatePatchAuthorization(findings, artifact.Patches); err != nil {
		return err
	}
	corrected, err := preservation.ApplyPatches(source, translation, artifact)
	if err != nil {
		return err
	}
	artifact.ResultTranslationSHA256 = preservation.SHA256(corrected)
	if err := os.WriteFile(filepath.Join(s.WorkDir, fmt.Sprintf("corrector-input-attempt-%d.mdx", attempt)), translation, 0o644); err != nil {
		return err
	}
	path := filepath.Join(s.WorkDir, fmt.Sprintf("corrector-attempt-%d.json", attempt))
	if err := preservation.WriteJSON(path, artifact); err != nil {
		return err
	}
	if err := preservation.WriteJSON(filepath.Join(s.WorkDir, "corrector.json"), artifact); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(s.WorkDir, "source-translation.mdx"), corrected, 0o644); err != nil {
		return err
	}
	s.recordRoleRun("corrector", result, path, "APPLIED")
	return nil
}

func (s *State) sealGPPublishManifest(ctx context.Context, source []byte, translationPath string, gates []preservation.GateEnvelope, jingjing preservation.JingjingArtifact) error {
	projection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, translationPath)
	if err != nil {
		return err
	}
	if len(jingjing.Files) != 1 || len(jingjing.Files[0].Violations) != 0 {
		return errors.New("cannot seal GP publish manifest without a clean Jingjing gate")
	}
	manifest := preservation.PublishManifest{Version: preservation.ContractVersion, ProfileSHA256: s.GPProfileSHA256, JingjingPolicySHA256: jingjing.PolicySHA256, SourceSHA256: preservation.SHA256(source), BodyProjectionSHA256: projection.SHA256, Verdict: "PASS", Gates: gates, CompletedAt: time.Now().UTC()}
	manifestPath := filepath.Join(s.WorkDir, "gp-publish-gate.json")
	if err := preservation.WriteJSON(manifestPath, manifest); err != nil {
		return err
	}
	s.GateManifestPath = manifestPath
	return preservation.ValidateManifest(manifest, source, []byte(projection.Body), gpRequiredGates, s.GPProfileSHA256, jingjing.PolicySHA256)
}

// Enrich is the independent GP Step 4. It may add projection-isolated
// commentary/navigation only after source-preservation has sealed a fresh
// manifest. Recovery after this step validates the existing final artifact and
// never regenerates or silently drops enrichment.
func (s *State) Enrich(ctx context.Context) error {
	finalPath := filepath.Join(s.WorkDir, "final.mdx")
	if s.shouldSkipBelow(StepEnrich) {
		s.Log.Info("Step 4: enrich — validating recovered final artifact")
		if _, err := os.Stat(finalPath); err != nil {
			return fmt.Errorf("GP enrichment recovery requires final.mdx: %w", err)
		}
		if err := s.ValidateGPPublishManifest(ctx, finalPath); err != nil {
			return err
		}
		return s.restoreCommentaryRun()
	}

	s.Log.Info("Step 4: enrich")
	translationPath := filepath.Join(s.WorkDir, "source-translation.mdx")
	if err := s.ValidateGPPublishManifest(ctx, translationPath); err != nil {
		return fmt.Errorf("GP enrichment requires fresh source-preservation verdicts: %w", err)
	}
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	translation, err := os.ReadFile(translationPath)
	if err != nil {
		return err
	}
	before, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, translationPath)
	if err != nil {
		return err
	}
	if s.CommentaryDispatcher == nil {
		return errors.New("commentary dispatcher is nil")
	}
	prompt, err := prompts.Render("commentary", prompts.CommentaryData{Version: preservation.ContractVersion, SourceSHA256: preservation.SHA256(source), TranslationSHA256: preservation.SHA256(translation), Source: string(source), Translation: string(translation)})
	if err != nil {
		return err
	}
	result, err := s.CommentaryDispatcher.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir, JSONSchema: preservation.CommentaryArtifactJSONSchema})
	if err != nil {
		s.RecordRoleFailure("commentary", err)
		return fmt.Errorf("commentary runner: %w", err)
	}
	var artifact preservation.CommentaryArtifact
	if err := preservation.DecodeStrict([]byte(result.Output), &artifact); err != nil {
		return err
	}
	artifact.Provenance = provenanceFor("commentary", result)
	enriched, err := preservation.ApplyCommentaryCandidates(source, translation, artifact)
	if err != nil {
		return err
	}
	if len(artifact.Candidates) > 0 {
		enriched = ensureMoguNoteImport(enriched)
	}
	if err := os.WriteFile(finalPath, enriched, 0o644); err != nil {
		return err
	}
	// Glossary navigation wraps existing text only. Unlike the retired fixer
	// bundle, GP never runs kaomoji or related-reading prose mutation.
	if _, err := runner.RunWithOptions(ctx, runner.Options{Name: "node", Args: []string{filepath.Join(s.Cfg.ScriptsDir, "apply-glossary-links.mjs"), finalPath}, WorkDir: s.Cfg.RepoRoot}); err != nil {
		return fmt.Errorf("GP glossary enrichment: %w", err)
	}
	after, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, finalPath)
	if err != nil {
		return err
	}
	if before.Body != after.Body || before.SHA256 != after.SHA256 {
		return errors.New("GP enrichment changed canonical body projection")
	}
	commentaryPath := filepath.Join(s.WorkDir, "commentary-candidates.json")
	if err := preservation.WriteJSON(commentaryPath, artifact); err != nil {
		return err
	}
	s.recordRoleRun("commentary", result, commentaryPath, "APPLIED")
	return s.ValidateGPPublishManifest(ctx, finalPath)
}

func (s *State) ValidateGPPublishManifest(ctx context.Context, bodyPath string) error {
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	projection, err := preservation.ProjectFile(ctx, s.Cfg.RepoRoot, bodyPath)
	if err != nil {
		return err
	}
	path := s.GateManifestPath
	if path == "" {
		path = filepath.Join(s.WorkDir, "gp-publish-gate.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("missing GP publish manifest: %w", err)
	}
	var manifest preservation.PublishManifest
	if err := preservation.DecodeStrict(data, &manifest); err != nil {
		return err
	}
	jingjing, _, err := preservation.CheckJingjing(ctx, s.Cfg.RepoRoot, bodyPath)
	if err != nil {
		return err
	}
	if len(jingjing.Files) != 1 || len(jingjing.Files[0].Violations) != 0 {
		return errors.New("GP publish artifact fails the Jingjing hard gate")
	}
	if err := preservation.ValidateManifest(manifest, source, []byte(projection.Body), gpRequiredGates, s.GPProfileSHA256, jingjing.PolicySHA256); err != nil {
		return err
	}
	for _, gate := range manifest.Gates {
		s.recordRecoveredRole(gate.Gate, gate.Provenance, path, gate.Verdict)
	}
	s.GateManifestPath = path
	return nil
}

func (s *State) restoreSourceTranslationRun(translationPath string) error {
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	if _, err := os.Stat(translationPath); err != nil {
		return err
	}
	initial, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.initial.mdx"))
	if err != nil {
		return err
	}
	artifactPath := filepath.Join(s.WorkDir, "source-translate.json")
	data, err := os.ReadFile(artifactPath)
	if err != nil {
		return fmt.Errorf("source-translate recovery requires durable source-translate.json: %w", err)
	}
	var artifact preservation.SourceTranslationArtifact
	if err := preservation.DecodeStrict(data, &artifact); err != nil {
		return err
	}
	if artifact.Version != preservation.ContractVersion || artifact.SourceSHA256 != preservation.SHA256(source) || artifact.TranslationSHA256 != preservation.SHA256(initial) || artifact.TranslationMDX != string(initial) {
		return errors.New("source-translate recovery artifact is missing or stale")
	}
	if len(artifact.SlopCandidates) > 0 {
		if err := preservation.ValidateFindings(source, initial, artifact.SlopCandidates); err != nil {
			return fmt.Errorf("source-translate recovery slop candidates: %w", err)
		}
	}
	if err := preservation.ValidateProvenance(artifact.Provenance, "translator"); err != nil {
		return err
	}
	s.recordRecoveredRole("translator", artifact.Provenance, artifactPath, "COMPLETED")
	return nil
}

func (s *State) restoreCommentaryRun() error {
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	translation, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		return err
	}
	artifactPath := filepath.Join(s.WorkDir, "commentary-candidates.json")
	data, err := os.ReadFile(artifactPath)
	if err != nil {
		return fmt.Errorf("GP enrichment recovery requires durable commentary-candidates.json: %w", err)
	}
	var artifact preservation.CommentaryArtifact
	if err := preservation.DecodeStrict(data, &artifact); err != nil {
		return err
	}
	if artifact.Version != preservation.ContractVersion || artifact.SourceSHA256 != preservation.SHA256(source) || artifact.TranslationSHA256 != preservation.SHA256(translation) {
		return errors.New("commentary recovery artifact is missing or stale")
	}
	if err := preservation.ValidateProvenance(artifact.Provenance, "commentary"); err != nil {
		return err
	}
	s.recordRecoveredRole("commentary", artifact.Provenance, artifactPath, "APPLIED")
	return nil
}

func (s *State) restoreOptionalCorrectorRun() error {
	source, err := s.sourceBytes()
	if err != nil {
		return err
	}
	initial, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.initial.mdx"))
	if err != nil {
		return fmt.Errorf("corrector recovery requires initial translation: %w", err)
	}
	current, err := os.ReadFile(filepath.Join(s.WorkDir, "source-translation.mdx"))
	if err != nil {
		return err
	}
	paths, err := filepath.Glob(filepath.Join(s.WorkDir, "corrector-attempt-*.json"))
	if err != nil {
		return err
	}
	type correctionStep struct {
		attempt int
		path    string
	}
	steps := make([]correctionStep, 0, len(paths))
	for _, path := range paths {
		base := filepath.Base(path)
		raw := strings.TrimSuffix(strings.TrimPrefix(base, "corrector-attempt-"), ".json")
		attempt, parseErr := strconv.Atoi(raw)
		if parseErr != nil || attempt < 1 {
			return fmt.Errorf("invalid corrector attempt artifact %s", base)
		}
		steps = append(steps, correctionStep{attempt: attempt, path: path})
	}
	sort.Slice(steps, func(i, j int) bool { return steps[i].attempt < steps[j].attempt })
	if len(steps) == 0 {
		if bytes.Equal(current, initial) {
			return nil
		}
		return errors.New("corrected translation requires an append-only corrector attempt chain")
	}

	replayed := append([]byte(nil), initial...)
	var latest preservation.PatchArtifact
	for _, step := range steps {
		inputPath := filepath.Join(s.WorkDir, fmt.Sprintf("corrector-input-attempt-%d.mdx", step.attempt))
		input, readErr := os.ReadFile(inputPath)
		if readErr != nil {
			return fmt.Errorf("corrector recovery requires %s: %w", filepath.Base(inputPath), readErr)
		}
		if !bytes.Equal(input, replayed) {
			return fmt.Errorf("corrector attempt %d input does not continue the replay chain", step.attempt)
		}
		data, readErr := os.ReadFile(step.path)
		if readErr != nil {
			return readErr
		}
		var artifact preservation.PatchArtifact
		if err := preservation.DecodeStrict(data, &artifact); err != nil {
			return err
		}
		if artifact.Version != preservation.ContractVersion || artifact.SourceSHA256 != preservation.SHA256(source) || artifact.TranslationSHA256 != preservation.SHA256(input) {
			return fmt.Errorf("corrector attempt %d artifact is missing or stale", step.attempt)
		}
		if err := preservation.ValidateProvenance(artifact.Provenance, "corrector"); err != nil {
			return err
		}
		replayed, err = preservation.ApplyPatches(source, input, artifact)
		if err != nil {
			return fmt.Errorf("corrector attempt %d recovery replay: %w", step.attempt, err)
		}
		if artifact.ResultTranslationSHA256 != preservation.SHA256(replayed) {
			return fmt.Errorf("corrector attempt %d result hash is stale", step.attempt)
		}
		latest = artifact
	}
	if !bytes.Equal(replayed, current) {
		return errors.New("corrector attempt chain does not produce current translation")
	}
	latestPath := steps[len(steps)-1].path
	s.recordRecoveredRole("corrector", latest.Provenance, latestPath, "APPLIED")
	return nil
}

func provenanceFor(role string, result *llm.RunResult) preservation.Provenance {
	return preservation.Provenance{Role: role, Provider: result.ProviderName, Model: string(result.ActualModel), Harness: llm.HarnessName(result.Model), CompletedAt: time.Now().UTC()}
}

func (s *State) recordRoleRun(role string, result *llm.RunResult, artifactPath, verdict string) {
	data, _ := os.ReadFile(artifactPath)
	if s.RoleRuns == nil {
		s.RoleRuns = map[string]RoleRun{}
	}
	s.RoleRuns[role] = RoleRun{Role: role, Provider: result.ProviderName, Model: llm.DisplayName(result.ActualModel), Harness: llm.HarnessName(result.Model), ArtifactSHA256: preservation.SHA256(data), Verdict: verdict, CompletedAt: time.Now().UTC()}
}

func (s *State) recordRecoveredRole(role string, provenance preservation.Provenance, artifactPath, verdict string) {
	data, _ := os.ReadFile(artifactPath)
	if s.RoleRuns == nil {
		s.RoleRuns = map[string]RoleRun{}
	}
	s.RoleRuns[role] = RoleRun{Role: role, Provider: provenance.Provider, Model: provenance.Model, Harness: provenance.Harness, ArtifactSHA256: preservation.SHA256(data), Verdict: verdict, CompletedAt: provenance.CompletedAt}
}

func ensureMoguNoteImport(document []byte) []byte {
	if bytesContains(document, []byte("import MoguNote from")) {
		return document
	}
	marker := []byte("\n---\n")
	idx := strings.Index(string(document[4:]), string(marker))
	if !strings.HasPrefix(string(document), "---\n") || idx < 0 {
		return document
	}
	insert := 4 + idx + len(marker)
	line := []byte("\nimport MoguNote from '../../components/MoguNote.astro';\n")
	return append(document[:insert], append(line, document[insert:]...)...)
}

func bytesContains(haystack, needle []byte) bool {
	return strings.Contains(string(haystack), string(needle))
}

// RecordRoleFailure persists provider/profile failures before returning so a
// resumed run has durable evidence instead of only ephemeral stderr.
func (s *State) RecordRoleFailure(role string, runErr error) {
	if s == nil || s.WorkDir == "" || runErr == nil {
		return
	}
	_ = preservation.WriteJSON(filepath.Join(s.WorkDir, role+"-failure.json"), map[string]any{
		"version":      preservation.ContractVersion,
		"role":         role,
		"error":        runErr.Error(),
		"completed_at": time.Now().UTC(),
	})
}
