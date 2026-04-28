// Package prompts holds the LLM prompt templates that drive Phase 2b of
// the pipeline (eval, write, review, refine).
//
// Why templates and not inline Go strings: each prompt is 20-60 lines of
// prose with several interpolation points (ticket ID, dates, source text,
// style-guide contents). Inline Go constants plus fmt.Sprintf get hard to
// read very quickly at that length, and they lose syntax highlighting in
// editors. The .tmpl files in this directory are shipped inside the Go
// binary via //go:embed so the self-compiling wrapper has zero file-layout
// dependencies at runtime.
//
// Why text/template and not html/template: prompts are plain text, never
// rendered to HTML. html/template's auto-escaping would corrupt the
// "{{" and ">>" characters that appear in example code blocks.
package prompts

import (
	"bytes"
	"embed"
	"fmt"
	"text/template"
)

//go:embed *.tmpl
var files embed.FS

// Render executes the named template with data and returns the rendered
// prompt text. Name is the file name minus ".tmpl". Missing template
// variables are treated as errors (not silently rendered as "<no value>")
// so typos in caller data blow up at test time instead of shipping an
// empty placeholder into a real LLM call.
func Render(name string, data any) (string, error) {
	raw, err := files.ReadFile(name + ".tmpl")
	if err != nil {
		return "", fmt.Errorf("prompts: read %s.tmpl: %w", name, err)
	}
	tmpl, err := template.New(name).
		Option("missingkey=error").
		Parse(string(raw))
	if err != nil {
		return "", fmt.Errorf("prompts: parse %s.tmpl: %w", name, err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("prompts: execute %s.tmpl: %w", name, err)
	}
	return buf.String(), nil
}

// EvalData is the template data for eval-gemini.tmpl / eval-codex.tmpl.
// The bash pipeline passes TWEET_LINE_COUNT as a dynamic value, and
// embeds the source-tweet.md contents verbatim via $(cat …).
type EvalData struct {
	// LineCount is the number of lines in Source, matching bash's
	// wc -l < source-tweet.md.
	LineCount int
	// Source is the full contents of source-tweet.md.
	Source string
	// OutputFilename is the basename the LLM is instructed to write to
	// in the current directory. Either "eval-gemini.json" or
	// "eval-codex.json".
	OutputFilename string
}

// WriteData is the template data for write.tmpl.
type WriteData struct {
	TicketID       string // e.g. "SP-PENDING" or "SP-170"
	OriginalDate   string // YYYY-MM-DD
	TranslatedDate string // YYYY-MM-DD (today)
	AuthorHandle   string // without @ prefix (still surfaced for legacy fields)
	TweetURL       string // full canonical URL
	FirstTag       string // "shroom-picks" (SP/SD) | "clawd-picks" (CP)
	StyleGuide     string // full contents of WRITING_GUIDELINES.md
	Source         string // full contents of source-tweet.md
	// SourceField is the pre-rendered value for the `source:` frontmatter
	// line. For X URLs the caller passes "@handle on X"; for docs/blog URLs
	// the caller passes a curated label like "OpenAI Cookbook" or the
	// hostname. Computed via pipeline.State.ResolveSourceField.
	SourceField string
	// Angle is an optional narrative directive. When non-empty, the
	// template inserts an explicit instruction telling the LLM to pivot
	// the article structure around this angle instead of treating every
	// section of the source with equal weight. Empty = default behavior
	// (cover ALL ideas in the source).
	Angle string
}

// ReviewData is the template data for review.tmpl.
type ReviewData struct {
	TicketID string
}

// RefineData is the template data for refine.tmpl.
type RefineData struct {
	TicketID string
	// Angle is the same narrative directive passed to Write. It is repeated
	// in refine so the LLM does not "regress to the mean" when applying
	// review feedback — without this reminder, refine prompts that fix
	// review issues sometimes flatten an angle-pivoted article back to a
	// uniform "cover everything" structure.
	Angle string
}
