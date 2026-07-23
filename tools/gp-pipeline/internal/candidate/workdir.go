package candidate

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// PrepareWorkDir creates (or verifies) one writable directory whose resolved
// location is outside the repository. Unsafe requested paths fail in place:
// callers must not substitute a fallback directory merely to write a manifest.
func PrepareWorkDir(repoRoot, requested string) (string, error) {
	repoAbs, err := filepath.Abs(repoRoot)
	if err != nil {
		return "", fmt.Errorf("candidate: resolve repo root: %w", err)
	}
	repoReal, err := filepath.EvalSymlinks(repoAbs)
	if err != nil {
		return "", fmt.Errorf("candidate: resolve repo root symlinks: %w", err)
	}

	if requested == "" {
		workDir, err := os.MkdirTemp("", "gp-candidate-")
		if err != nil {
			return "", fmt.Errorf("candidate: create default workdir: %w", err)
		}
		real, resolveErr := filepath.EvalSymlinks(workDir)
		if resolveErr != nil || pathWithin(repoReal, real) {
			_ = os.Remove(workDir)
			if resolveErr != nil {
				return "", fmt.Errorf("candidate: resolve default workdir: %w", resolveErr)
			}
			return "", fmt.Errorf("candidate: default workdir resolves inside repo")
		}
		if err := verifyWritable(real); err != nil {
			_ = os.Remove(real)
			return "", err
		}
		return real, nil
	}

	requestedAbs, err := filepath.Abs(requested)
	if err != nil {
		return "", fmt.Errorf("candidate: resolve --work-dir: %w", err)
	}
	prospective, err := resolveProspectivePath(requestedAbs)
	if err != nil {
		return "", fmt.Errorf("candidate: resolve --work-dir symlinks: %w", err)
	}
	if pathWithin(repoReal, prospective) {
		return "", fmt.Errorf("candidate: --work-dir must resolve outside repo: %s", requestedAbs)
	}
	if info, statErr := os.Lstat(requestedAbs); statErr == nil && info.Mode()&os.ModeSymlink != 0 {
		if _, evalErr := filepath.EvalSymlinks(requestedAbs); evalErr != nil {
			return "", fmt.Errorf("candidate: dangling --work-dir symlink is not allowed: %w", evalErr)
		}
	}
	if err := os.MkdirAll(requestedAbs, 0o755); err != nil {
		return "", fmt.Errorf("candidate: create --work-dir: %w", err)
	}
	real, err := filepath.EvalSymlinks(requestedAbs)
	if err != nil {
		return "", fmt.Errorf("candidate: resolve created --work-dir: %w", err)
	}
	if pathWithin(repoReal, real) {
		return "", fmt.Errorf("candidate: --work-dir resolved inside repo after creation: %s", real)
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", fmt.Errorf("candidate: stat --work-dir: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("candidate: --work-dir is not a directory: %s", real)
	}
	if err := verifyWritable(real); err != nil {
		return "", err
	}
	return real, nil
}

func resolveProspectivePath(path string) (string, error) {
	current := filepath.Clean(path)
	var suffix []string
	for {
		if _, err := os.Lstat(current); err == nil {
			real, err := filepath.EvalSymlinks(current)
			if err != nil {
				return "", err
			}
			for i := len(suffix) - 1; i >= 0; i-- {
				real = filepath.Join(real, suffix[i])
			}
			return filepath.Clean(real), nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("no existing ancestor for %s", path)
		}
		suffix = append(suffix, filepath.Base(current))
		current = parent
	}
}

func pathWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative == "." ||
		(relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}

func verifyWritable(workDir string) error {
	probe, err := os.CreateTemp(workDir, ".candidate-write-probe-*")
	if err != nil {
		return fmt.Errorf("candidate: --work-dir is not writable: %w", err)
	}
	probePath := probe.Name()
	if err := probe.Close(); err != nil {
		_ = os.Remove(probePath)
		return fmt.Errorf("candidate: close write probe: %w", err)
	}
	if err := os.Remove(probePath); err != nil {
		return fmt.Errorf("candidate: remove write probe: %w", err)
	}
	return nil
}
