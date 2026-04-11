// Package deploy is the Go implementation of sp-pipeline.sh Step 5 —
// validate-posts → build → git add → git commit → git push.
//
// The Phase 3 port stays byte-compatible with bash: it calls `node
// scripts/validate-posts.mjs`, `npm run build` (not pnpm — see plan),
// and `git commit -m "Add ${TICKET}: ${TITLE}"`.
package deploy

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/config"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/logx"
	"github.com/chitienhsiehwork-ai/gu-log/tools/sp-pipeline/internal/runner"
)

// Options controls a deploy invocation. Use Strict=false to skip the git
// push (used by --dry-run and by tests that own a fake git repo).
type Options struct {
	Cfg     *config.Config
	Log     *logx.Logger
	Counter *counter.Counter

	// Prefix is the ticket prefix (SP / CP / SD / Lv).
	Prefix string
	// ActiveFilename is the pre-rename posts/ file.
	ActiveFilename string
	// ActiveENFilename is the en- companion pre-rename.
	ActiveENFilename string
	// DateStamp / AuthorSlug / TitleSlug rebuild the final filename.
	DateStamp  string
	AuthorSlug string
	TitleSlug  string
	// Title is used in the commit message.
	Title string

	// SkipBuild disables `npm run build` (test convenience).
	SkipBuild bool
	// SkipPush disables `git push` (test + --dry-run convenience).
	SkipPush bool
	// SkipValidate disables `node scripts/validate-posts.mjs` (tests only).
	SkipValidate bool
}

// Result captures the side effects of a deploy run so callers can populate
// the pipeline State with the final ticket ID + filenames.
type Result struct {
	SPNumber       int
	PromptTicketID string
	Filename       string
	ENFilename     string
}

// Run executes the deploy flow. See package doc for step order.
func Run(ctx context.Context, opts Options) (*Result, error) {
	if opts.Cfg == nil {
		return nil, fmt.Errorf("deploy: Cfg required")
	}
	if opts.Log == nil {
		return nil, fmt.Errorf("deploy: Log required")
	}
	if opts.Counter == nil {
		return nil, fmt.Errorf("deploy: Counter required")
	}
	if opts.ActiveFilename == "" {
		return nil, fmt.Errorf("deploy: ActiveFilename required")
	}

	postsDir := opts.Cfg.PostsDir

	// 1. Bump the counter → allocated integer + ticket id.
	allocated, err := opts.Counter.Bump(opts.Prefix)
	if err != nil {
		return nil, fmt.Errorf("deploy: counter bump: %w", err)
	}
	ticketID := fmt.Sprintf("%s-%d", opts.Prefix, allocated)
	opts.Log.Info("  Counter locked+bumped at commit time: %s (next will be %d)", ticketID, allocated+1)

	// 2. Build the final filenames and rename pending files.
	prefixLower := strings.ToLower(opts.Prefix)
	finalFilename := fmt.Sprintf("%s-%d-%s-%s-%s.mdx", prefixLower, allocated, opts.DateStamp, opts.AuthorSlug, opts.TitleSlug)
	finalEN := "en-" + finalFilename

	renameIfNeeded := func(active, final string) error {
		if active == "" || active == final {
			return nil
		}
		activePath := filepath.Join(postsDir, active)
		finalPath := filepath.Join(postsDir, final)
		if _, err := os.Stat(activePath); os.IsNotExist(err) {
			return nil
		}
		if _, err := os.Stat(finalPath); err == nil {
			return fmt.Errorf("deploy: final filename already exists: %s", finalPath)
		}
		return os.Rename(activePath, finalPath)
	}
	if err := renameIfNeeded(opts.ActiveFilename, finalFilename); err != nil {
		return nil, err
	}
	if err := renameIfNeeded(opts.ActiveENFilename, finalEN); err != nil {
		return nil, err
	}

	// 3. Replace any PENDING ticketId references in the final files.
	if err := replacePendingTicketID(filepath.Join(postsDir, finalFilename), ticketID); err != nil {
		return nil, err
	}
	if _, err := os.Stat(filepath.Join(postsDir, finalEN)); err == nil {
		if err := replacePendingTicketID(filepath.Join(postsDir, finalEN), ticketID); err != nil {
			return nil, err
		}
	}

	// 4. Validate (unless skipped).
	if !opts.SkipValidate {
		validateErr := runValidate(ctx, opts.Cfg.RepoRoot, opts.Cfg.ValidatePosts)
		if validateErr != nil {
			// If the failing output mentions our new files, die + rm.
			if strings.Contains(validateErr.Error(), finalFilename) || strings.Contains(validateErr.Error(), finalEN) {
				_ = os.Remove(filepath.Join(postsDir, finalFilename))
				_ = os.Remove(filepath.Join(postsDir, finalEN))
				return nil, fmt.Errorf("deploy: validate-posts rejected %s: %w", finalFilename, validateErr)
			}
			// Pre-existing failure not tied to our files — warn and continue.
			opts.Log.Warn("deploy: validate-posts reported issues not tied to %s; continuing", finalFilename)
		}
	}

	// 5. Build (unless skipped).
	if !opts.SkipBuild {
		if err := runNpmBuild(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: npm run build failed: %w", err)
		}
	}

	// 6. Git add / commit / push.
	addPaths := []string{
		"src/content/posts/" + finalFilename,
		"scripts/article-counter.json",
	}
	if _, err := os.Stat(filepath.Join(postsDir, finalEN)); err == nil {
		addPaths = append(addPaths, "src/content/posts/"+finalEN)
	}
	if err := gitAdd(ctx, opts.Cfg.RepoRoot, addPaths...); err != nil {
		return nil, fmt.Errorf("deploy: git add: %w", err)
	}
	commitMsg := fmt.Sprintf("Add %s: %s", ticketID, opts.Title)
	if err := gitCommit(ctx, opts.Cfg.RepoRoot, commitMsg); err != nil {
		return nil, fmt.Errorf("deploy: git commit: %w", err)
	}
	if !opts.SkipPush {
		if err := gitPush(ctx, opts.Cfg.RepoRoot); err != nil {
			return nil, fmt.Errorf("deploy: git push: %w", err)
		}
	}

	return &Result{
		SPNumber:       allocated,
		PromptTicketID: ticketID,
		Filename:       finalFilename,
		ENFilename:     finalEN,
	}, nil
}

// replacePendingTicketID opens a file, replaces the ticketId value in its
// frontmatter with ticketID, and writes the result. This is the Go port
// of the three-sed-call replace_pending_ticket_id function in bash.
func replacePendingTicketID(path, ticketID string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("replace pending: read %s: %w", path, err)
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return fmt.Errorf("replace pending: parse %s: %w", path, err)
	}
	f.SetScalar("ticketId", `"`+ticketID+`"`)
	return os.WriteFile(path, f.Bytes(), 0o644)
}

func runValidate(ctx context.Context, repoRoot, validatePostsJS string) error {
	res, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "node",
		Args:    []string{validatePostsJS},
		WorkDir: repoRoot,
	})
	if err == nil {
		return nil
	}
	// Include stdout in the error so the caller can check for specific
	// filenames in the validator output.
	return fmt.Errorf("%s\n%s", err, string(res.Stdout))
}

func runNpmBuild(ctx context.Context, repoRoot string) error {
	_, err := runner.RunWithOptions(ctx, runner.Options{
		Name:    "npm",
		Args:    []string{"run", "build"},
		WorkDir: repoRoot,
	})
	return err
}
