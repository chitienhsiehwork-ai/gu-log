package pipeline

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/frontmatter"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/llm"
	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/prompts"
)

// Translate is the automated en-sidecar step referenced by gu-log #546:
// the pipeline's root help used to claim `write` produces a zh-tw + en
// MDX pair, but no Go step ever produced the en file — it was a fully
// manual step a human/coordinating agent did by hand.
//
// Translate reuses the same writer routing as Write/Refine to translate a
// tribunal-passed zh-tw article (postsDir/s.ActiveFilename) into its en
// sidecar (postsDir/s.ActiveENFilename), matching CONTRIBUTING.md's
// zh-tw-first SOP: translation only happens AFTER the zh-tw article has passed
// the tribunal, never on an unstable draft.
//
// When s.RalphPassed is false, Translate is normally a no-op (logged, not
// an error) — Deploy keeps its existing best-effort semantics of shipping
// zh-tw only when the tribunal didn't pass. The recovery path
// `run --from-step translate --file ...` is the exception: --file asserts
// that the existing zh-tw post already passed the tribunal, matching the
// standalone translate command.
func (s *State) Translate(ctx context.Context) error {
	if s.shouldSkipBelow(StepTranslate) {
		s.Log.Info("Step 4.8: translate — SKIPPED (--from-step)")
		return nil
	}

	s.Log.Info("Step 4.8: translate")

	if s.FromStepInt == StepTranslate && s.ExistingFile == "" {
		return fmt.Errorf("translate: --from-step translate requires --file <tribunal-passed zh-tw post>")
	}
	if s.ExistingFile != "" {
		if err := s.prepareExistingPost(); err != nil {
			return fmt.Errorf("translate: %w", err)
		}
		if s.FromStepInt == StepTranslate {
			// Resuming exactly at translate is an explicit recovery assertion:
			// the supplied zh-tw file has already cleared the tribunal.
			s.RalphPassed = true
		}
	}

	if !s.RalphPassed {
		s.Log.Warn("  Tribunal did not pass — skipping en translation, deploying zh-tw only")
		return nil
	}
	if s.ActiveFilename == "" {
		return fmt.Errorf("translate: ActiveFilename is empty")
	}
	prefix, err := ValidateTranslationFilenames(s.ActiveFilename, s.ActiveENFilename)
	if err != nil {
		return err
	}
	if err := validateTranslationTicketIdentity(s.ActiveFilename, s.PromptTicketID, prefix); err != nil {
		return err
	}

	postsDir := s.Cfg.PostsDir
	sourcePath := filepath.Join(postsDir, s.ActiveFilename)
	source, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("translate: read %s: %w", sourcePath, err)
	}
	sourceFile, err := frontmatter.Parse(source)
	if err != nil {
		return fmt.Errorf("translate: parse source frontmatter: %w", err)
	}
	if raw, ok := sourceFile.GetScalar("translatedBy"); ok && raw != "" {
		return fmt.Errorf("translate: source translatedBy must be a mapping, got %q", raw)
	}
	sourceTranslatedBy, ok := sourceFile.GetBlock("translatedBy")
	if !ok {
		// An absent source block means absent nested history. Start from an
		// empty canonical mapping so generated provenance cannot invent one.
		sourceTranslatedBy = "translatedBy:"
	}

	disp := s.writerDispatcher()
	if disp == nil {
		return fmt.Errorf("translate: writer dispatcher is nil")
	}
	prompt, err := prompts.Render("translate", prompts.TranslateData{
		TicketID: s.PromptTicketID,
		Source:   string(source),
	})
	if err != nil {
		return fmt.Errorf("translate: render prompt: %w", err)
	}

	translatedPath := filepath.Join(s.WorkDir, "translated-en.mdx")
	// A caller may intentionally reuse --work-dir while recovering a run.
	// Remove the previous canonical output before dispatch so a provider that
	// returns stdout without writing a file cannot inherit stale prose and
	// receive this invocation's provenance stamp.
	if err := os.Remove(translatedPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("translate: clear stale %s before invocation: %w", translatedPath, err)
	}

	res, err := disp.Run(ctx, prompt, llm.RunOptions{WorkDir: s.WorkDir})
	if err != nil {
		return NewStepError(14, fmt.Errorf("translate: dispatcher failed: %w", err))
	}

	translated, statErr := os.ReadFile(translatedPath)
	if statErr != nil || len(translated) == 0 {
		if len(res.Output) == 0 {
			return fmt.Errorf("translate: translated-en.mdx missing or empty and dispatcher returned no stdout")
		}
		translated = []byte(res.Output)
	}

	s.TranslateModel = llm.DisplayName(res.ActualModel)
	s.TranslateHarness = llm.HarnessName(res.ActualModel)
	if s.TranslatedDate == "" {
		s.TranslatedDate = time.Now().Format("2006-01-02")
	}

	translatedFile, err := frontmatter.Parse(translated)
	if err != nil {
		return fmt.Errorf("translate: parse generated English frontmatter: %w", err)
	}
	if raw, ok := translatedFile.GetScalar("translatedBy"); ok && raw != "" {
		return fmt.Errorf("translate: generated translatedBy must be a mapping, got %q", raw)
	}
	// frontmatter.Parse is line-based, so a model-authored block that is not
	// valid YAML gets this far unnoticed and only fails later in
	// scripts/validate-posts.mjs — after the sidecar is already on disk.
	translatedFile.RepairSingleQuotedScalars()
	if err := translatedFile.ValidateYAML(); err != nil {
		return fmt.Errorf("translate: generated English frontmatter is not valid YAML: %w", err)
	}
	// The model is not authoritative for provenance. Restore the canonical
	// nested history from the zh-tw source, then stamp only this invocation's
	// direct translator fields and date.
	translatedFile.SetBlock("translatedBy", sourceTranslatedBy)
	translatedFile.SetScalar("translatedDate", frontmatter.QuoteScalar(s.TranslatedDate))
	translatedFile.SetNestedScalar("translatedBy", "model", frontmatter.QuoteScalar(s.TranslateModel))
	translatedFile.SetNestedScalar("translatedBy", "harness", frontmatter.QuoteScalar(s.TranslateHarness))
	translated = translatedFile.Bytes()
	translated, err = rewriteEnglishGlossaryTargets(translated)
	if err != nil {
		return fmt.Errorf("translate: normalize English glossary targets: %w", err)
	}

	if s.ActiveENFilename == "" {
		s.ActiveENFilename = "en-" + s.ActiveFilename
	}
	enPath := filepath.Join(postsDir, s.ActiveENFilename)
	if err := os.WriteFile(enPath, translated, 0o644); err != nil {
		return fmt.Errorf("translate: write %s: %w", enPath, err)
	}

	s.Log.OK("Step 4.8: %s written by %s", s.ActiveENFilename, s.TranslateModel)
	return nil
}

// rewriteEnglishGlossaryTargets enforces the stable glossary language-routing
// contract after the model returns an English sidecar. The model is allowed to
// preserve Markdown structure from the zh-tw source, but reader-facing
// /glossary# links in English prose must point at /en/glossary#. Frontmatter,
// fenced code, inline code, raw MDX tags, external URLs, and already-canonical
// English targets remain byte-for-byte unchanged.
func rewriteEnglishGlossaryTargets(content []byte) ([]byte, error) {
	parsed, err := frontmatter.Parse(content)
	if err != nil {
		return nil, err
	}
	body := parsed.Body()
	rewritten := rewriteGlossaryTargetsInBody(body)
	if bytes.Equal(body, rewritten) {
		return content, nil
	}

	bodyStart := len(content) - len(body)
	out := make([]byte, 0, bodyStart+len(rewritten))
	out = append(out, content[:bodyStart]...)
	out = append(out, rewritten...)
	return out, nil
}

func rewriteGlossaryTargetsInBody(body []byte) []byte {
	lines := bytes.SplitAfter(body, []byte("\n"))
	var out bytes.Buffer
	out.Grow(len(body))

	var fenceChar byte
	var fenceWidth int
	var tag markdownTagState
	for _, line := range lines {
		char, width, isFence := markdownFence(line)
		if fenceChar != 0 {
			out.Write(line)
			if isFence && char == fenceChar && width >= fenceWidth {
				fenceChar = 0
				fenceWidth = 0
			}
			continue
		}
		if isFence {
			fenceChar = char
			fenceWidth = width
			out.Write(line)
			continue
		}
		out.Write(rewriteGlossaryTargetsInProseLine(line, &tag))
	}
	return out.Bytes()
}

func markdownFence(line []byte) (char byte, width int, ok bool) {
	i := 0
	for i < len(line) && i < 4 && line[i] == ' ' {
		i++
	}
	if i > 3 || i >= len(line) || (line[i] != '`' && line[i] != '~') {
		return 0, 0, false
	}
	char = line[i]
	for i+width < len(line) && line[i+width] == char {
		width++
	}
	return char, width, width >= 3
}

type markdownTagState struct {
	active bool
	quote  byte
}

func rewriteGlossaryTargetsInProseLine(line []byte, tag *markdownTagState) []byte {
	const zhTarget = "/glossary#"
	const enTarget = "/en/glossary#"

	var out bytes.Buffer
	out.Grow(len(line))
	for i := 0; i < len(line); {
		if tag.active {
			ch := line[i]
			out.WriteByte(ch)
			i++
			if tag.quote != 0 {
				if ch == tag.quote {
					tag.quote = 0
				}
				continue
			}
			if ch == '"' || ch == '\'' {
				tag.quote = ch
			} else if ch == '>' {
				tag.active = false
			}
			continue
		}
		if bytes.HasPrefix(line[i:], []byte("https://")) || bytes.HasPrefix(line[i:], []byte("http://")) {
			end := i
			for end < len(line) && line[end] != ' ' && line[end] != '\t' && line[end] != '\r' && line[end] != '\n' {
				end++
			}
			out.Write(line[i:end])
			i = end
			continue
		}
		if line[i] == '`' {
			width := 1
			for i+width < len(line) && line[i+width] == '`' {
				width++
			}
			end := findClosingBacktickRun(line, i+width, width)
			if end < 0 {
				out.Write(line[i:])
				break
			}
			out.Write(line[i:end])
			i = end
			continue
		}
		if line[i] == '<' && startsMarkdownTag(line, i) {
			tag.active = true
			out.WriteByte(line[i])
			i++
			continue
		}
		if bytes.HasPrefix(line[i:], []byte(zhTarget)) && isGlossaryTargetBoundary(line, i) {
			out.WriteString(enTarget)
			i += len(zhTarget)
			continue
		}
		out.WriteByte(line[i])
		i++
	}
	return out.Bytes()
}

func startsMarkdownTag(line []byte, i int) bool {
	if i+1 >= len(line) {
		return false
	}
	next := line[i+1]
	return next == '/' || next == '!' || next == '?' ||
		(next >= 'A' && next <= 'Z') || (next >= 'a' && next <= 'z')
}

func isGlossaryTargetBoundary(line []byte, i int) bool {
	if i == 0 {
		return true
	}
	switch line[i-1] {
	case ' ', '\t', '\r', '\n', '(', '[', '{', '"', '\'', '=', ':', '>':
		return true
	default:
		return false
	}
}

func findClosingBacktickRun(line []byte, start, width int) int {
	for i := start; i < len(line); {
		if line[i] != '`' {
			i++
			continue
		}
		run := 1
		for i+run < len(line) && line[i+run] == '`' {
			run++
		}
		if run == width {
			return i + run
		}
		i += run
	}
	return -1
}

// ValidateTranslationFilenames binds a zh-tw source filename and its optional
// English output to one GP/MP/SD/Lv series. New Lv files use lv-, while
// levelup- remains valid for the existing Lv corpus. Retired or unknown
// prefixes are delegated to counter.ValidatePrefix so every CLI ingress emits
// the same actionable taxonomy diagnostic instead of creating a legacy en-
// sidecar. An explicit --en-file must preserve the canonical pair basename.
func ValidateTranslationFilenames(filename, enFilename string) (string, error) {
	if filename == "" || filepath.Base(filename) != filename {
		return "", fmt.Errorf("translate: --file must be a basename in src/content/posts/, got %q", filename)
	}
	if !strings.HasSuffix(filename, ".mdx") || strings.HasPrefix(filename, "en-") {
		return "", fmt.Errorf("translate: --file must name a zh-tw .mdx post, got %q", filename)
	}

	seriesSlug, _, ok := strings.Cut(strings.TrimSuffix(filename, ".mdx"), "-")
	if !ok || seriesSlug == "" {
		return "", fmt.Errorf("translate: filename %q is missing a canonical series prefix", filename)
	}
	prefixBySlug := map[string]string{
		"gp":      "GP",
		"mp":      "MP",
		"sd":      "SD",
		"lv":      "Lv",
		"levelup": "Lv",
	}
	prefix, canonical := prefixBySlug[seriesSlug]
	if !canonical {
		candidate := strings.ToUpper(seriesSlug)
		if err := counter.ValidatePrefix(candidate); err != nil {
			return "", fmt.Errorf("translate: filename %q: %w", filename, err)
		}
		return "", fmt.Errorf("translate: filename %q does not use the canonical lowercase slug for %s", filename, candidate)
	}
	if err := counter.ValidatePrefix(prefix); err != nil {
		return "", fmt.Errorf("translate: filename %q: %w", filename, err)
	}

	if enFilename != "" {
		if filepath.Base(enFilename) != enFilename {
			return "", fmt.Errorf("translate: --en-file must be a basename in src/content/posts/, got %q", enFilename)
		}
		want := "en-" + filename
		if enFilename != want {
			return "", fmt.Errorf("translate: --en-file %q must equal %q", enFilename, want)
		}
	}
	return prefix, nil
}

// ValidateTranslationTicketIdentity requires the ticket namespace and, when
// the canonical source filename encodes it, numeric identity in frontmatter to
// match exactly. Existing levelup-* files predate that filename contract and
// therefore validate the Lv namespace only.
func ValidateTranslationTicketIdentity(filename, ticketID string) error {
	prefix, err := ValidateTranslationFilenames(filename, "")
	if err != nil {
		return err
	}
	return validateTranslationTicketIdentity(filename, ticketID, prefix)
}

func validateTranslationTicketIdentity(filename, ticketID, prefix string) error {
	if err := counter.ValidateTicketIDForPrefix(ticketID, prefix); err != nil {
		return fmt.Errorf("translate: %w", err)
	}
	if strings.HasPrefix(filename, "levelup-") {
		if ticketID == "Lv-PENDING" {
			return fmt.Errorf("translate: existing levelup filename %q requires an allocated Lv ticketId, got %q", filename, ticketID)
		}
		return nil
	}

	stem := strings.TrimSuffix(filename, ".mdx")
	_, remainder, ok := strings.Cut(stem, "-")
	if !ok {
		return fmt.Errorf("translate: filename %q is missing a ticket slot", filename)
	}
	filenameTicket, _, ok := strings.Cut(remainder, "-")
	if !ok || filenameTicket == "" {
		return fmt.Errorf("translate: filename %q is missing a ticket slot", filename)
	}

	expectedTicketID := prefix + "-" + filenameTicket
	if filenameTicket == "pending" {
		var err error
		expectedTicketID, err = counter.PendingTicketID(prefix)
		if err != nil {
			return fmt.Errorf("translate: filename %q: %w", filename, err)
		}
	} else {
		for _, r := range filenameTicket {
			if r < '0' || r > '9' {
				return fmt.Errorf("translate: filename %q has invalid ticket slot %q", filename, filenameTicket)
			}
		}
	}
	if ticketID != expectedTicketID {
		return fmt.Errorf("translate: filename %q requires ticketId %q, got %q", filename, expectedTicketID, ticketID)
	}
	return nil
}

// prepareExistingPost hydrates the filenames and reader-facing identity used
// by translate/deploy recovery. It never rewrites the post.
func (s *State) prepareExistingPost() error {
	if s.ExistingFile == "" {
		return fmt.Errorf("existing file is empty")
	}
	if s.ActiveFilename == "" {
		s.ActiveFilename = s.ExistingFile
	}
	if s.ActiveENFilename == "" {
		s.ActiveENFilename = "en-" + s.ActiveFilename
	}
	prefix, err := ValidateTranslationFilenames(s.ActiveFilename, s.ActiveENFilename)
	if err != nil {
		return err
	}

	path := filepath.Join(s.Cfg.PostsDir, s.ActiveFilename)
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read existing post %s: %w", path, err)
	}
	f, err := frontmatter.Parse(data)
	if err != nil {
		return fmt.Errorf("parse existing post %s: %w", path, err)
	}
	rawTicketID, ok := f.GetScalar("ticketId")
	if !ok {
		return fmt.Errorf("existing post %s has no ticketId", path)
	}
	ticketID, err := decodeYAMLScalar(rawTicketID)
	if err != nil || ticketID == "" {
		return fmt.Errorf("existing post %s has invalid ticketId %q", path, rawTicketID)
	}
	if err := validateTranslationTicketIdentity(s.ActiveFilename, ticketID, prefix); err != nil {
		return fmt.Errorf("existing post %s: %w", path, err)
	}
	if override := s.TranslateTicketIDOverride; override != "" {
		if err := counter.ValidateTicketIDForPrefix(override, prefix); err != nil {
			return fmt.Errorf("translate --ticket-id: %w", err)
		}
		if override != ticketID {
			return fmt.Errorf("translate: --ticket-id %q does not match %s frontmatter ticketId %q", override, s.ActiveFilename, ticketID)
		}
	}
	s.PromptTicketID = ticketID
	if s.Title == "" {
		if raw, ok := f.GetScalar("title"); ok {
			if value, err := decodeYAMLScalar(raw); err == nil && value != "" {
				s.Title = value
			}
		}
	}
	if s.OriginalDate == "" {
		if raw, ok := f.GetScalar("originalDate"); ok {
			if value, err := decodeYAMLScalar(raw); err == nil && value != "" {
				s.OriginalDate = value
			}
		}
	}
	if s.TranslatedDate == "" {
		if raw, ok := f.GetScalar("translatedDate"); ok {
			if value, err := decodeYAMLScalar(raw); err == nil && value != "" {
				s.TranslatedDate = value
			}
		}
	}
	return nil
}
