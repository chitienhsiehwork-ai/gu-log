package pipeline

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
)

// AuthorablePrefixes are the series gp-pipeline writes itself, in display
// order. Lv is not one of them: it is written by hand from a design doc and a
// pinned writer (CONTRIBUTING.md, LvWorkflowSection), so every command that
// writes, rewrites, or credits an article refuses Lv at ingress, and Lv only
// uses the non-writing steps (openspec gp-pipeline-publish-integrity). The
// writing commands build their help text and their missing --prefix errors
// from this list.
var AuthorablePrefixes = []string{"GP", "MP", "SD"}

// LvWorkflowSection is the CONTRIBUTING.md section LvAuthoringError points to.
const LvWorkflowSection = "新增入門教學（Lv）"

// IsAuthorable reports whether gp-pipeline writes the series prefix.
func IsAuthorable(prefix string) bool {
	return slices.Contains(AuthorablePrefixes, prefix)
}

// isLvPost reports whether a post is Lv: its filename series (lv-, levelup-,
// and their en- sidecars) or its frontmatter ticketId names Lv, and either one
// is enough. A basename without a series (final.mdx, draft-v1.mdx) or content
// without a canonical ticketId is no evidence either way.
func isLvPost(filename string, content []byte) bool {
	if series, err := SeriesFromFilename(filename); err == nil && series == "Lv" {
		return true
	}
	f, err := frontmatter.Parse(content)
	if err != nil {
		return false
	}
	raw, ok := f.GetScalar("ticketId")
	if !ok {
		return false
	}
	ticketID, err := decodeYAMLScalar(raw)
	if err != nil {
		return false
	}
	prefix, err := counter.PrefixOfTicketID(ticketID)
	return err == nil && prefix == "Lv"
}

// IsLvFile reports whether the post at path is Lv (see isLvPost). A missing
// file is judged by its name alone; the step that needs it reports it missing.
func IsLvFile(path string) (bool, error) {
	content, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return false, err
	}
	return isLvPost(filepath.Base(path), content), nil
}

// LvAuthoringError is the single ingress refusal of every command that would
// write, rewrite, or credit an Lv post. It is a plain error, so the CLI exits 1.
func LvAuthoringError(command string) error {
	return fmt.Errorf("%s: gp-pipeline does not write, rewrite, or credit Lv posts; "+
		"write Lv by hand following %q in CONTRIBUTING.md (design doc and pinned writer, Tribunal via scripts/tribunal.sh); "+
		"Lv can still use counter, fetch, eval, dedup, translate --file, standalone deploy, "+
		"and run --file <Lv post> --from-step translate|deploy", command, LvWorkflowSection)
}
