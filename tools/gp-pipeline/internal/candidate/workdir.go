package candidate

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// WorkDir is a private, directory-handle-bound candidate workspace. Path is
// informational; all trusted reads and writes use Root so a concurrent rename
// cannot redirect them to a replacement directory.
type WorkDir struct {
	Path     string
	Root     *os.Root
	identity os.FileInfo
	repoReal string
}

// PrepareWorkDir treats requested as a parent and always creates a fresh 0700
// leaf outside the repository. Callers must close the returned Root.
func PrepareWorkDir(repoRoot, requested string) (*WorkDir, error) {
	repoReal, err := resolvedDirectory(repoRoot)
	if err != nil {
		return nil, fmt.Errorf("candidate: resolve repo root: %w", err)
	}

	parent := requested
	if parent == "" {
		parent = os.TempDir()
	}
	parentReal, err := resolvedDirectory(parent)
	if err != nil {
		return nil, fmt.Errorf("candidate: resolve --work-dir parent: %w", err)
	}
	if pathWithin(repoReal, parentReal) {
		return nil, fmt.Errorf("candidate: --work-dir parent must resolve outside repo: %s", parentReal)
	}

	parentRoot, err := os.OpenRoot(parentReal)
	if err != nil {
		return nil, fmt.Errorf("candidate: open --work-dir parent: %w", err)
	}
	defer parentRoot.Close()

	for attempt := 0; attempt < 32; attempt++ {
		suffix, err := randomHex(12)
		if err != nil {
			return nil, fmt.Errorf("candidate: generate workdir name: %w", err)
		}
		name := "gp-candidate-" + suffix
		if err := parentRoot.Mkdir(name, 0o700); err != nil {
			if os.IsExist(err) {
				continue
			}
			return nil, fmt.Errorf("candidate: create private workdir: %w", err)
		}
		root, err := parentRoot.OpenRoot(name)
		if err != nil {
			_ = parentRoot.Remove(name)
			return nil, fmt.Errorf("candidate: open private workdir: %w", err)
		}
		info, err := root.Stat(".")
		if err != nil {
			_ = root.Close()
			_ = parentRoot.Remove(name)
			return nil, fmt.Errorf("candidate: stat private workdir: %w", err)
		}
		if !info.IsDir() || info.Mode().Perm() != 0o700 {
			_ = root.Close()
			_ = parentRoot.Remove(name)
			return nil, fmt.Errorf("candidate: private workdir has unsafe mode %s", info.Mode())
		}
		work := &WorkDir{
			Path:     filepath.Join(parentReal, name),
			Root:     root,
			identity: info,
			repoReal: repoReal,
		}
		if err := work.Verify(); err != nil {
			_ = root.Close()
			_ = parentRoot.Remove(name)
			return nil, err
		}
		return work, nil
	}
	return nil, fmt.Errorf("candidate: could not allocate a unique private workdir")
}

func resolvedDirectory(path string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a directory", real)
	}
	return filepath.Clean(real), nil
}

// Verify proves that Path still names the same private directory held by Root.
func (work *WorkDir) Verify() error {
	if work == nil || work.Root == nil || work.identity == nil {
		return fmt.Errorf("candidate: workdir is unavailable")
	}
	lstat, err := os.Lstat(work.Path)
	if err != nil {
		return fmt.Errorf("candidate: workdir path changed: %w", err)
	}
	if lstat.Mode()&os.ModeSymlink != 0 || !lstat.IsDir() {
		return fmt.Errorf("candidate: workdir path changed identity")
	}
	resolved, err := filepath.EvalSymlinks(work.Path)
	if err != nil {
		return fmt.Errorf("candidate: resolve workdir path: %w", err)
	}
	if filepath.Clean(resolved) != filepath.Clean(work.Path) || pathWithin(work.repoReal, resolved) {
		return fmt.Errorf("candidate: workdir path changed containment")
	}
	pathInfo, err := os.Stat(work.Path)
	if err != nil {
		return fmt.Errorf("candidate: stat workdir path: %w", err)
	}
	rootInfo, err := work.Root.Stat(".")
	if err != nil {
		return fmt.Errorf("candidate: stat workdir handle: %w", err)
	}
	if !os.SameFile(work.identity, pathInfo) || !os.SameFile(work.identity, rootInfo) {
		return fmt.Errorf("candidate: workdir path changed identity")
	}
	return nil
}

func (work *WorkDir) Close() error {
	if work == nil || work.Root == nil {
		return nil
	}
	return work.Root.Close()
}

func randomHex(bytes int) (string, error) {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

func pathWithin(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative == "." ||
		(relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)))
}
