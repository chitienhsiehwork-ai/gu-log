package preservation

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

const JingjingContractVersion = "check-jingjing/v1"

// JingjingArtifact is the machine-readable envelope emitted by the canonical
// repository checker. The policy digest binds the result to the checker,
// glossary, and taxonomy inputs that define the accepted-English boundary.
type JingjingArtifact struct {
	Version                string         `json:"version"`
	PolicySHA256           string         `json:"policy_sha256"`
	BaselineRef            string         `json:"baseline_ref"`
	BaselineRefUnavailable bool           `json:"baseline_ref_unavailable"`
	Files                  []JingjingFile `json:"files"`
}

type JingjingFile struct {
	Path       string              `json:"path"`
	SHA256     string              `json:"sha256"`
	Skipped    bool                `json:"skipped"`
	Violations []JingjingViolation `json:"violations"`
}

type JingjingViolation struct {
	Word      string `json:"word"`
	Line      int    `json:"line"`
	StartByte int    `json:"start_byte"`
	EndByte   int    `json:"end_byte"`
	Context   string `json:"context"`
}

// CheckJingjing delegates policy ownership to scripts/check-jingjing.mjs and
// validates its hashes and UTF-8 byte boundaries before any finding can reach
// the bounded corrector.
func CheckJingjing(ctx context.Context, repoRoot, path string) (JingjingArtifact, []byte, error) {
	if filepath.Base(path) == path || !filepath.IsAbs(path) {
		return JingjingArtifact{}, nil, fmt.Errorf("Jingjing check requires an absolute file path: %s", path)
	}
	translation, err := os.ReadFile(path)
	if err != nil {
		return JingjingArtifact{}, nil, fmt.Errorf("read Jingjing input: %w", err)
	}
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "node",
		Args:    []string{filepath.Join(repoRoot, "scripts", "check-jingjing.mjs"), "--format=json", path},
		WorkDir: repoRoot,
	})
	if err != nil {
		return JingjingArtifact{}, nil, fmt.Errorf("run Jingjing checker: %w", err)
	}
	var artifact JingjingArtifact
	if err := DecodeStrict(res.Stdout, &artifact); err != nil {
		return JingjingArtifact{}, nil, fmt.Errorf("decode Jingjing artifact: %w", err)
	}
	if err := ValidateJingjingArtifact(artifact, translation); err != nil {
		return JingjingArtifact{}, nil, err
	}
	return artifact, translation, nil
}

func ValidateJingjingArtifact(artifact JingjingArtifact, translation []byte) error {
	if artifact.Version != JingjingContractVersion {
		return fmt.Errorf("Jingjing version %q, want %q", artifact.Version, JingjingContractVersion)
	}
	if len(artifact.PolicySHA256) != 64 {
		return errors.New("Jingjing artifact has invalid policy hash")
	}
	if _, err := hex.DecodeString(artifact.PolicySHA256); err != nil {
		return errors.New("Jingjing artifact has invalid policy hash")
	}
	if artifact.BaselineRef != "" || artifact.BaselineRefUnavailable {
		return errors.New("GP source-preservation requires an un-grandfathered Jingjing scan")
	}
	if len(artifact.Files) != 1 {
		return fmt.Errorf("Jingjing artifact has %d files, want 1", len(artifact.Files))
	}
	file := artifact.Files[0]
	if file.Skipped {
		return errors.New("Jingjing checker skipped GP translation")
	}
	if file.SHA256 != SHA256(translation) {
		return errors.New("Jingjing artifact file hash is stale")
	}
	violations := append([]JingjingViolation(nil), file.Violations...)
	sort.Slice(violations, func(i, j int) bool { return violations[i].StartByte < violations[j].StartByte })
	previousEnd := -1
	for _, violation := range violations {
		if violation.Word == "" || violation.Line < 1 || violation.Context == "" {
			return errors.New("Jingjing violation is missing word, line, or context")
		}
		if violation.StartByte < 0 || violation.EndByte <= violation.StartByte || violation.EndByte > len(translation) {
			return fmt.Errorf("Jingjing violation %q has invalid byte boundary", violation.Word)
		}
		if violation.StartByte < previousEnd {
			return fmt.Errorf("Jingjing violation %q overlaps a previous violation", violation.Word)
		}
		if !bytes.Equal(translation[violation.StartByte:violation.EndByte], []byte(violation.Word)) {
			return fmt.Errorf("Jingjing violation %q does not match its byte boundary", violation.Word)
		}
		if bytes.Count(translation[:violation.StartByte], []byte("\n"))+1 != violation.Line {
			return fmt.Errorf("Jingjing violation %q has a stale line number", violation.Word)
		}
		if inFrontmatter(translation, violation.StartByte, violation.EndByte) {
			return fmt.Errorf("Jingjing violation %q points into frontmatter", violation.Word)
		}
		previousEnd = violation.EndByte
	}
	return nil
}

// JingjingFindings turns deterministic violations into source-blind,
// byte-bounded authorizations. The corrector decides the shortest natural
// translation from sentence context; it cannot widen these exact boundaries.
func JingjingFindings(source, translation []byte, artifact JingjingArtifact) ([]Finding, error) {
	if err := ValidateJingjingArtifact(artifact, translation); err != nil {
		return nil, err
	}
	findings := make([]Finding, 0, len(artifact.Files[0].Violations))
	for _, violation := range artifact.Files[0].Violations {
		old := translation[violation.StartByte:violation.EndByte]
		identity := SHA256([]byte(fmt.Sprintf("%s:%d:%d", violation.Word, violation.StartByte, violation.EndByte)))
		findings = append(findings, Finding{
			ID:                   "jingjing-" + identity[:12],
			IssueType:            "natural_zh_tw",
			SourceQuote:          "",
			SourceSHA256:         SHA256(source),
			TranslationSHA256:    SHA256(translation),
			StartByte:            violation.StartByte,
			EndByte:              violation.EndByte,
			OldText:              violation.Word,
			OldTextSHA256:        SHA256(old),
			SuggestedReplacement: "自然中文",
			Approved:             true,
		})
	}
	if err := ValidateFindings(source, translation, findings); err != nil {
		return nil, err
	}
	return findings, nil
}
