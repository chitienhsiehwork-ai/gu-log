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
// order. Lv and GP are not among them: Lv is written by hand from a design doc
// and a pinned writer (CONTRIBUTING.md, LvWorkflowSection), and GP is a
// published MP that ShroomDog promotes with ReclassifyScript. Every command
// that writes or rewrites an article refuses both at ingress, and they only use
// the non-writing steps (openspec gp-pipeline-publish-integrity). The writing
// commands build their help text and their missing --prefix errors from this
// list.
var AuthorablePrefixes = []string{"MP", "SD"}

// LvWorkflowSection is the CONTRIBUTING.md section the Lv refusal points to.
const LvWorkflowSection = "新增入門教學（Lv）"

// ReclassifyScript is the only allocator of GP numbers: it promotes a
// published MP to GP (openspec gp-signature-picks).
const ReclassifyScript = "scripts/reclassify-post.mjs"

// IsAuthorable reports whether gp-pipeline writes the series prefix.
func IsAuthorable(prefix string) bool {
	return slices.Contains(AuthorablePrefixes, prefix)
}

// postSeries returns the series a post names: its filename series (lv-,
// levelup-, gp-, mp-, sd-, and their en- sidecars) and its frontmatter
// ticketId, either one counting. A basename without a series (final.mdx,
// draft-v1.mdx) or content without a canonical ticketId names none.
func postSeries(filename string, content []byte) []string {
	var named []string
	if series, err := SeriesFromFilename(filename); err == nil {
		named = append(named, series)
	}
	if prefix, err := counter.PrefixOfTicketID(frontmatterTicketID(content)); err == nil {
		named = append(named, prefix)
	}
	return named
}

// frontmatterTicketID returns the decoded frontmatter ticketId of a post, or
// "" when it has no frontmatter or no readable ticketId scalar. The value is
// not validated.
func frontmatterTicketID(content []byte) string {
	f, err := frontmatter.Parse(content)
	if err != nil {
		return ""
	}
	raw, ok := f.GetScalar("ticketId")
	if !ok {
		return ""
	}
	ticketID, err := decodeYAMLScalar(raw)
	if err != nil {
		return ""
	}
	return ticketID
}

// PostTicketID reads the frontmatter ticketId of the post at path (see
// frontmatterTicketID); "" means the post names none.
func PostTicketID(path string) (string, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return frontmatterTicketID(content), nil
}

// refuseSeriesFiles returns AuthoringError(command, series) for the first of
// paths naming one of the refused series (see postSeries); refused is in
// priority order. A missing file is judged by its name alone, since the step
// that needs it reports it missing; a read error is returned wrapped for
// command.
func refuseSeriesFiles(command string, refused []string, paths []string) error {
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("%s: %w", command, err)
		}
		named := postSeries(filepath.Base(path), content)
		for _, series := range refused {
			if slices.Contains(named, series) {
				return AuthoringError(command, series)
			}
		}
	}
	return nil
}

// RefuseUnauthorableFiles refuses run, review, refine, and ralph on an Lv or
// GP post (see refuseSeriesFiles).
func RefuseUnauthorableFiles(command string, paths ...string) error {
	return refuseSeriesFiles(command, []string{"Lv", "GP"}, paths)
}

// RefuseLvFiles refuses the pipeline credit stamp on an Lv post. A GP post
// keeps it: it was written by the pipeline as an MP before its promotion.
func RefuseLvFiles(command string, paths ...string) error {
	return refuseSeriesFiles(command, []string{"Lv"}, paths)
}

// AuthoringError is the single ingress refusal of every command that would
// write or rewrite a post of a series the pipeline does not write (or credit
// an Lv post); it names the way that series is written instead. It is a plain
// error, so the CLI exits 1.
func AuthoringError(command, series string) error {
	switch series {
	case "Lv":
		return fmt.Errorf("%s: gp-pipeline does not write, rewrite, or credit Lv posts; "+
			"write Lv by hand following %q in CONTRIBUTING.md (design doc and pinned writer, Tribunal via scripts/tribunal.sh); "+
			"Lv can still use counter, fetch, eval, dedup, translate --file, standalone deploy, "+
			"and run --file <Lv post> --from-step translate|deploy", command, LvWorkflowSection)
	case "GP":
		return fmt.Errorf("%s: gp-pipeline does not write or rewrite GP posts; "+
			"write the article with --prefix MP, and once it is published ShroomDog may promote it to GP with %s; "+
			"GP can still use dedup, translate --file, credits, "+
			"and run --file <numbered GP post> --from-step translate|deploy", command, ReclassifyScript)
	default:
		return fmt.Errorf("%s: gp-pipeline does not write %s posts; it writes %v", command, series, AuthorablePrefixes)
	}
}

// GPAllocationError refuses to allocate a GP number: GP numbers come only
// from ReclassifyScript. It is a plain error, so the CLI exits 1.
func GPAllocationError(command string) error {
	return fmt.Errorf("%s: gp-pipeline does not allocate GP numbers; a GP number comes only from %s, "+
		"when ShroomDog promotes a published MP", command, ReclassifyScript)
}
