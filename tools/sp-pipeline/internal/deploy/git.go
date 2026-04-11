package deploy

import (
	"context"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

func gitAdd(ctx context.Context, repoRoot string, paths ...string) error {
	args := append([]string{"add"}, paths...)
	_, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "git",
		Args:    args,
		WorkDir: repoRoot,
	})
	return err
}

func gitCommit(ctx context.Context, repoRoot, message string) error {
	_, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "git",
		Args:    []string{"commit", "-m", message},
		WorkDir: repoRoot,
	})
	return err
}

func gitPush(ctx context.Context, repoRoot string) error {
	_, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "git",
		Args:    []string{"push"},
		WorkDir: repoRoot,
	})
	return err
}
