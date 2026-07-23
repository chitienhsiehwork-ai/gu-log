package candidate

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/source"
)

const (
	ManifestSchemaVersion = 1
	ManifestFilename      = "candidate-manifest.json"
)

type Manifest struct {
	SchemaVersion    int                    `json:"schemaVersion"`
	RawInputURL      string                 `json:"rawInputUrl"`
	CanonicalURL     *string                `json:"canonicalUrl"`
	VideoID          *string                `json:"videoId"`
	SourceKind       string                 `json:"sourceKind"`
	Metadata         source.YouTubeMetadata `json:"metadata"`
	Availability     string                 `json:"availability"`
	WriteEligible    bool                   `json:"writeEligible"`
	ApprovalRequired bool                   `json:"approvalRequired"`
	Approved         bool                   `json:"approved"`
	Caption          *CaptionManifest       `json:"caption"`
	Limits           source.LimitEvidence   `json:"limits"`
	Warnings         []string               `json:"warnings"`
	Artifacts        Artifacts              `json:"artifacts"`
	Dedup            DedupManifest          `json:"dedup"`
	Failure          *FailureManifest       `json:"failure"`
}

type CaptionManifest struct {
	Language        string                 `json:"language"`
	Kind            string                 `json:"kind"`
	RawBytes        int64                  `json:"rawBytes"`
	EstimatedTokens int                    `json:"estimatedTokens"`
	TranscriptWords int                    `json:"transcriptWords"`
	Coverage        source.CaptionCoverage `json:"coverage"`
}

type Artifact struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Bytes  int64  `json:"bytes"`
}

type Artifacts struct {
	Source     *Artifact `json:"source"`
	RawVTT     *Artifact `json:"rawVtt"`
	Transcript *Artifact `json:"transcript"`
}

type DedupManifest struct {
	Verdict string   `json:"verdict"`
	Matches []string `json:"matches"`
}

type FailureManifest struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func WriteManifestAtomic(workDir string, manifest *Manifest) (string, error) {
	if manifest == nil {
		return "", fmt.Errorf("candidate manifest is nil")
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal candidate manifest: %w", err)
	}
	payload = append(payload, '\n')

	tmp, err := os.CreateTemp(workDir, ".candidate-manifest-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create candidate manifest temp file: %w", err)
	}
	tmpPath := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpPath)
		}
	}()
	if err := tmp.Chmod(0o644); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("chmod candidate manifest temp file: %w", err)
	}
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("write candidate manifest temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("fsync candidate manifest temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("close candidate manifest temp file: %w", err)
	}

	finalPath := filepath.Join(workDir, ManifestFilename)
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", fmt.Errorf("replace candidate manifest: %w", err)
	}
	cleanup = false
	if err := syncDirectory(workDir); err != nil {
		return "", err
	}
	return finalPath, nil
}

func artifactFor(workDir, absolutePath string) (*Artifact, error) {
	if absolutePath == "" {
		return nil, nil
	}
	relative, err := filepath.Rel(workDir, absolutePath)
	if err != nil {
		return nil, fmt.Errorf("relativize artifact %s: %w", absolutePath, err)
	}
	if relative == ".." || filepath.IsAbs(relative) ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("artifact %s escapes candidate workdir", absolutePath)
	}
	file, err := os.Open(absolutePath)
	if err != nil {
		return nil, fmt.Errorf("open artifact %s: %w", absolutePath, err)
	}
	defer file.Close()
	hash := sha256.New()
	bytes, err := io.Copy(hash, file)
	if err != nil {
		return nil, fmt.Errorf("hash artifact %s: %w", absolutePath, err)
	}
	return &Artifact{
		Path:   filepath.ToSlash(relative),
		SHA256: hex.EncodeToString(hash.Sum(nil)),
		Bytes:  bytes,
	}, nil
}

func syncDirectory(path string) error {
	dir, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open candidate workdir for fsync: %w", err)
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("fsync candidate workdir: %w", err)
	}
	return nil
}
