// Package candidate implements the deterministic YouTube preflight boundary.
// It intentionally imports no LLM, editorial, pipeline, counter, deploy, or
// git packages: acquisition + source completeness + identity dedup are the
// entire capability.
package candidate

import (
	"context"
	"errors"
	"fmt"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/dedup"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

type Options struct {
	RepoRoot    string
	WorkDir     string
	URL         string
	DedupScript string
	Limits      source.CandidateLimits
}

type Outcome struct {
	WorkDir      string
	Manifest     *Manifest
	ManifestPath string
	ExitCode     int
}

func Run(ctx context.Context, opts Options) (*Outcome, error) {
	if opts.RepoRoot == "" {
		return nil, fmt.Errorf("candidate: repo root is required")
	}
	workDir, err := PrepareWorkDir(opts.RepoRoot, opts.WorkDir)
	if err != nil {
		return nil, err
	}
	if opts.Limits == (source.CandidateLimits{}) {
		opts.Limits = source.DefaultCandidateLimits()
	}
	outcome := &Outcome{WorkDir: workDir, ExitCode: 1}
	manifest := baseManifest(opts.URL, opts.Limits)
	outcome.Manifest = manifest

	parsed, parseErr := source.ParseYouTubeURL(opts.URL)
	if parseErr != nil {
		manifest.Failure = &FailureManifest{
			Code:      "invalid_url",
			Message:   parseErr.Error(),
			Retryable: false,
		}
		path, writeErr := WriteManifestAtomic(workDir, manifest)
		outcome.ManifestPath = path
		return outcome, writeErr
	}
	manifest.CanonicalURL = stringPointer(parsed.CanonicalURL)
	manifest.VideoID = stringPointer(parsed.VideoID)
	manifest.Failure = &FailureManifest{
		Code:      "in_progress",
		Message:   "candidate acquisition has not completed",
		Retryable: true,
	}
	if _, err := WriteManifestAtomic(workDir, manifest); err != nil {
		return outcome, err
	}

	capture := source.CaptureYouTube(ctx, opts.URL, source.FetchOptions{WorkDir: workDir}, opts.Limits)
	if err := populateCaptureManifest(manifest, capture, workDir); err != nil {
		manifest.Failure = &FailureManifest{
			Code:      "artifact_failed",
			Message:   err.Error(),
			Retryable: true,
		}
		manifest.WriteEligible = false
		path, writeErr := WriteManifestAtomic(workDir, manifest)
		outcome.ManifestPath = path
		if writeErr != nil {
			return outcome, writeErr
		}
		return outcome, err
	}

	var dedupErr error
	if opts.DedupScript == "" {
		dedupErr = fmt.Errorf("candidate: dedup script path is required")
	} else {
		check, err := dedup.Check(ctx, dedup.Options{
			ScriptPath:   opts.DedupScript,
			URL:          parsed.CanonicalURL,
			Series:       "GP",
			IdentityOnly: true,
		})
		if err != nil {
			dedupErr = err
		} else {
			manifest.Dedup.Verdict = string(check.Verdict)
			manifest.Dedup.Matches = append([]string{}, check.Matches...)
			if check.Verdict == dedup.VerdictBlock {
				manifest.WriteEligible = false
			}
		}
	}

	if dedupErr != nil && (capture.Failure == nil || !capture.Failure.Technical) {
		manifest.Failure = &FailureManifest{
			Code:      "dedup_failed",
			Message:   dedupErr.Error(),
			Retryable: true,
		}
		manifest.WriteEligible = false
	}
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		manifest.Failure = &FailureManifest{
			Code:      source.YouTubeFailureTimeout,
			Message:   "YouTube candidate preflight timed out",
			Retryable: true,
		}
		manifest.WriteEligible = false
	case errors.Is(ctx.Err(), context.Canceled):
		manifest.Failure = &FailureManifest{
			Code:      source.YouTubeFailureInterrupted,
			Message:   "YouTube candidate preflight was interrupted",
			Retryable: true,
		}
		manifest.WriteEligible = false
	}
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		outcome.ExitCode = 124
	case errors.Is(ctx.Err(), context.Canceled):
		outcome.ExitCode = 10
	case capture.Failure != nil && capture.Failure.Technical:
		outcome.ExitCode = 10
	case dedupErr != nil:
		outcome.ExitCode = 1
	case manifest.Dedup.Verdict == string(dedup.VerdictBlock):
		outcome.ExitCode = 13
	default:
		outcome.ExitCode = 0
	}

	path, err := WriteManifestAtomic(workDir, manifest)
	outcome.ManifestPath = path
	if err != nil {
		return outcome, err
	}
	return outcome, nil
}

func baseManifest(rawURL string, limits source.CandidateLimits) *Manifest {
	return &Manifest{
		SchemaVersion:    ManifestSchemaVersion,
		RawInputURL:      rawURL,
		CanonicalURL:     nil,
		VideoID:          nil,
		SourceKind:       "youtube",
		Metadata:         source.YouTubeMetadata{},
		Availability:     source.YouTubeAvailabilityUnavailable,
		WriteEligible:    false,
		ApprovalRequired: true,
		Approved:         false,
		Caption:          nil,
		Limits: source.LimitEvidence{
			Limits:             limits,
			TriggeredLimitKeys: []string{},
		},
		Warnings:  []string{},
		Artifacts: Artifacts{},
		Dedup:     DedupManifest{Verdict: "NOT_RUN", Matches: []string{}},
		Failure:   nil,
	}
}

func populateCaptureManifest(manifest *Manifest, capture *source.YouTubeCapture, workDir string) error {
	if capture.URL.CanonicalURL != "" {
		manifest.CanonicalURL = stringPointer(capture.URL.CanonicalURL)
		manifest.VideoID = stringPointer(capture.URL.VideoID)
	}
	manifest.Metadata = capture.Metadata
	manifest.Availability = capture.Availability
	manifest.WriteEligible = capture.WriteEligible
	manifest.Warnings = append([]string{}, capture.Warnings...)
	manifest.Limits = capture.Limits
	manifest.Failure = nil
	if capture.Failure != nil {
		manifest.Failure = &FailureManifest{
			Code:      capture.Failure.Code,
			Message:   capture.Failure.Message,
			Retryable: capture.Failure.Retryable,
		}
	}
	if capture.Caption != nil {
		manifest.Caption = &CaptionManifest{
			Language:        capture.Caption.Language,
			Kind:            capture.Caption.Kind,
			RawBytes:        capture.Caption.RawBytes,
			EstimatedTokens: capture.Caption.EstimatedTokens,
			TranscriptWords: capture.Caption.TranscriptWords,
			Coverage:        capture.Caption.Coverage,
		}
	}
	var err error
	manifest.Artifacts.Source, err = artifactFor(workDir, capture.SourcePath)
	if err != nil {
		return err
	}
	if capture.Caption != nil {
		manifest.Artifacts.RawVTT, err = artifactFor(workDir, capture.Caption.RawVTTPath)
		if err != nil {
			return err
		}
		manifest.Artifacts.Transcript, err = artifactFor(workDir, capture.Caption.TranscriptPath)
		if err != nil {
			return err
		}
	}
	return nil
}

func stringPointer(value string) *string {
	copy := value
	return &copy
}
