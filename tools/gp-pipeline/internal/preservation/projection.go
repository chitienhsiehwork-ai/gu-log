package preservation

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

type Projection struct {
	Version string `json:"version"`
	Body    string `json:"body"`
	SHA256  string `json:"sha256"`
}

// ProjectFile delegates MDX parsing to the repository's @mdx-js/mdx based
// projector and verifies its reported digest before returning it to Go gates.
func ProjectFile(ctx context.Context, repoRoot, path string) (Projection, error) {
	if filepath.Base(path) == path || !filepath.IsAbs(path) {
		return Projection{}, fmt.Errorf("projection requires an absolute file path: %s", path)
	}
	if info, err := os.Stat(path); err != nil || !info.Mode().IsRegular() {
		return Projection{}, fmt.Errorf("projection input is not a regular file: %s", path)
	}
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "node",
		Args:    []string{filepath.Join(repoRoot, "scripts", "gp-body-projection.mjs"), path},
		WorkDir: repoRoot,
	})
	if err != nil {
		return Projection{}, fmt.Errorf("project GP body: %w", err)
	}
	var projection Projection
	if err := DecodeStrict(res.Stdout, &projection); err != nil {
		return Projection{}, err
	}
	if projection.Version != ContractVersion || projection.SHA256 != SHA256([]byte(projection.Body)) {
		return Projection{}, fmt.Errorf("projection envelope is invalid or stale")
	}
	return projection, nil
}

func WriteJSON(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("write preservation artifact %s: %w", path, err)
	}
	return nil
}
