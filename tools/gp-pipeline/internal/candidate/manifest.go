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

func WriteManifestAtomic(work *WorkDir, manifest *Manifest) (string, error) {
	if manifest == nil {
		return "", fmt.Errorf("candidate manifest is nil")
	}
	if err := work.Verify(); err != nil {
		return "", err
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal candidate manifest: %w", err)
	}
	payload = append(payload, '\n')

	suffix, err := randomHex(12)
	if err != nil {
		return "", fmt.Errorf("generate candidate manifest temp name: %w", err)
	}
	tmpName := ".candidate-manifest-" + suffix + ".tmp"
	tmp, err := work.Root.OpenFile(tmpName, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", fmt.Errorf("create candidate manifest temp file: %w", err)
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = work.Root.Remove(tmpName)
		}
	}()
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

	if err := work.Verify(); err != nil {
		return "", err
	}
	if err := renameWithinRoot(work.Root, tmpName, ManifestFilename); err != nil {
		return "", fmt.Errorf("replace candidate manifest: %w", err)
	}
	cleanup = false
	if err := syncDirectory(work); err != nil {
		return "", err
	}
	if err := work.Verify(); err != nil {
		return "", err
	}
	return filepath.Join(work.Path, ManifestFilename), nil
}

func artifactFor(work *WorkDir, absolutePath string) (*Artifact, error) {
	if absolutePath == "" {
		return nil, nil
	}
	if err := work.Verify(); err != nil {
		return nil, err
	}
	relative, err := filepath.Rel(work.Path, absolutePath)
	if err != nil {
		return nil, fmt.Errorf("relativize artifact %s: %w", absolutePath, err)
	}
	if relative == ".." || filepath.IsAbs(relative) ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return nil, fmt.Errorf("artifact %s escapes candidate workdir", absolutePath)
	}
	relative = filepath.Clean(relative)
	info, err := work.Root.Lstat(relative)
	if err != nil {
		return nil, fmt.Errorf("lstat artifact %s: %w", absolutePath, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, fmt.Errorf("artifact %s is not a regular file", absolutePath)
	}
	file, err := work.Root.Open(relative)
	if err != nil {
		return nil, fmt.Errorf("open artifact %s: %w", absolutePath, err)
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("fstat artifact %s: %w", absolutePath, err)
	}
	if !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) {
		return nil, fmt.Errorf("artifact %s changed identity before hashing", absolutePath)
	}
	hash := sha256.New()
	bytes, err := io.Copy(hash, file)
	if err != nil {
		return nil, fmt.Errorf("hash artifact %s: %w", absolutePath, err)
	}
	finalInfo, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("fstat artifact %s after hashing: %w", absolutePath, err)
	}
	if !os.SameFile(openedInfo, finalInfo) || finalInfo.Size() != bytes {
		return nil, fmt.Errorf("artifact %s changed while hashing", absolutePath)
	}
	if err := work.Verify(); err != nil {
		return nil, err
	}
	return &Artifact{
		Path:   filepath.ToSlash(relative),
		SHA256: hex.EncodeToString(hash.Sum(nil)),
		Bytes:  bytes,
	}, nil
}

func syncDirectory(work *WorkDir) error {
	dir, err := work.Root.Open(".")
	if err != nil {
		return fmt.Errorf("open candidate workdir for fsync: %w", err)
	}
	defer dir.Close()
	if err := dir.Sync(); err != nil {
		return fmt.Errorf("fsync candidate workdir: %w", err)
	}
	return nil
}
