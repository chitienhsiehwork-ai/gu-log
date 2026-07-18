package deploy

import (
	"context"
	"fmt"
	"strings"

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

func gitHasStagedChanges(ctx context.Context, repoRoot string, paths ...string) (bool, error) {
	args := append([]string{"diff", "--cached", "--quiet", "--exit-code", "--"}, paths...)
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "git",
		Args:    args,
		WorkDir: repoRoot,
	})
	if err == nil {
		return false, nil
	}
	if res != nil && res.ExitCode == 1 {
		return true, nil
	}
	return false, err
}

func gitStatusForPaths(ctx context.Context, repoRoot string, paths ...string) (string, error) {
	args := append([]string{"status", "--porcelain", "--untracked-files=all", "--"}, paths...)
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "git",
		Args:    args,
		WorkDir: repoRoot,
	})
	if err != nil {
		return "", fmt.Errorf("git status: %w", err)
	}
	return strings.TrimSpace(string(res.Stdout)), nil
}
