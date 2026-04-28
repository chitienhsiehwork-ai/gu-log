// Package frontmatter provides text-level read and write of MDX frontmatter
// blocks. It exists because four separate steps of scripts/sp-pipeline.sh
// touch frontmatter by running `sed -i` against specific lines — an approach
// that works but is hard to test, hard to compose, and hard to read when
// things go wrong.
//
// The scope of this package is intentionally narrow: it can replace or
// append top-level scalar keys in the frontmatter block, and expose the
// body so callers can rewrite the whole file. It does NOT do full YAML
// round-tripping with preserved ordering — that is not what the pipeline
// actually needs. Nested-block mutation (for example writing scores into
// scores.ralph) stays in the existing Node helper scripts/frontmatter-scores.mjs,
// which remains the single source of truth for tribunal score write-back.
//
// Design note: the package stores the frontmatter as a slice of lines and
// walks/replaces them in place. The body is a byte slice that is stitched
// back on the way out with zero mutation. This keeps SetScalar operations
// O(frontmatter-length) and byte-preserving for everything outside the
// frontmatter block.
package frontmatter

import (
	"bytes"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// ErrNoFrontmatter is returned when Parse cannot find a --- delimited block.
var ErrNoFrontmatter = errors.New("frontmatter: no --- delimited block found at start of file")

// File is a parsed MDX file with frontmatter and body held separately. The
// zero value is not useful; always construct via Parse.
type File struct {
	// lines are the frontmatter lines BETWEEN the two --- delimiters.
	// Neither the opening nor closing --- is stored here.
	lines []string

	// bodySeparator is the bytes between the closing --- and the first
	// line of the body. Usually "\n", but we preserve exactly what the
	// input had so Bytes() is byte-stable for untouched files.
	bodySeparator []byte

	// body is everything after the closing ---.
	body []byte
}

// Parse splits a raw MDX file into frontmatter lines and body bytes.
//
// The frontmatter must start on the very first line (no leading blank lines
// before the opening ---). This matches the existing validator's behaviour
// and the Astro Content Collection requirement.
func Parse(content []byte) (*File, error) {
	// Find the opening "---" at the very start.
	if !bytes.HasPrefix(content, []byte("---\n")) && !bytes.HasPrefix(content, []byte("---\r\n")) {
		return nil, ErrNoFrontmatter
	}

	// Find the closing "---" on its own line after the opening.
	// We match "\n---\n" (or \r variant).
	closer := findClosingDelimiter(content)
	if closer < 0 {
		return nil, fmt.Errorf("frontmatter: opening --- found but closing --- missing")
	}

	openerLen := 4 // "---\n"
	if bytes.HasPrefix(content, []byte("---\r\n")) {
		openerLen = 5
	}

	// lines are the bytes between opener and the newline before the closing "---".
	fmBytes := content[openerLen:closer]
	lines := strings.Split(strings.TrimRight(string(fmBytes), "\n\r"), "\n")
	// Normalise trailing \r from Windows line endings.
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, "\r")
	}

	// Everything after the closing delimiter, including its trailing newline.
	afterCloser := closer
	// Step past the "\n---" and its trailing newline.
	// closer points at the "\n" BEFORE "---", so the closing "---" starts at closer+1.
	// We want bodyStart to be past "---\n" (or "---\r\n").
	rest := content[afterCloser+1:] // starts at "---..."
	bodyStart := afterCloser + 1
	if bytes.HasPrefix(rest, []byte("---\r\n")) {
		bodyStart += 5
	} else if bytes.HasPrefix(rest, []byte("---\n")) {
		bodyStart += 4
	} else if bytes.Equal(bytes.TrimRight(rest, "\r\n"), []byte("---")) {
		// File ends exactly on the closing delimiter with no body.
		bodyStart = len(content)
	}

	var bodySep []byte
	var body []byte
	if bodyStart < len(content) {
		body = content[bodyStart:]
	}
	// The "separator" between --- and body is always part of body in this
	// representation; we keep bodySep empty and rely on body preservation.
	_ = bodySep

	return &File{
		lines: lines,
		body:  body,
	}, nil
}

// findClosingDelimiter returns the index of the newline that precedes the
// closing "---\n" line, or -1 if none is found.
func findClosingDelimiter(content []byte) int {
	// We are looking for "\n---\n" or "\n---\r\n" or "\n---" at EOF.
	// Skip the opening --- line so we do not match it.
	start := bytes.IndexByte(content, '\n')
	if start < 0 {
		return -1
	}
	idx := start
	for {
		next := bytes.Index(content[idx+1:], []byte("\n---"))
		if next < 0 {
			return -1
		}
		abs := idx + 1 + next
		// Check what follows "\n---".
		tail := content[abs+4:]
		if len(tail) == 0 || bytes.HasPrefix(tail, []byte("\n")) || bytes.HasPrefix(tail, []byte("\r\n")) {
			return abs
		}
		idx = abs
	}
}

// Bytes reassembles the full file from the (possibly modified) frontmatter
// lines and the body. If no Set* methods have been called, the output is
// byte-identical to the Parse input (subject to line-ending normalisation).
func (f *File) Bytes() []byte {
	var buf bytes.Buffer
	buf.WriteString("---\n")
	for _, l := range f.lines {
		buf.WriteString(l)
		buf.WriteByte('\n')
	}
	buf.WriteString("---\n")
	buf.Write(f.body)
	return buf.Bytes()
}

// Body returns the raw body bytes (everything after the closing ---).
func (f *File) Body() []byte { return f.body }

// FrontmatterText returns the current frontmatter as a YAML string with no
// delimiters. Useful for external parsers (gray-matter, yaml.v3).
func (f *File) FrontmatterText() string {
	return strings.Join(f.lines, "\n")
}

// topLevelKeyRe matches a top-level scalar key/value line at indent 0.
// We deliberately ignore lines that start with whitespace so we don't
// accidentally match nested keys like "  model: Opus 4.6".
var topLevelKeyRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$`)

// GetScalar returns the value of a top-level scalar key in the frontmatter,
// and a boolean indicating whether the key was found. Nested keys and
// multi-line values are not supported — use yaml.v3 directly if you need them.
func (f *File) GetScalar(key string) (string, bool) {
	for _, line := range f.lines {
		m := topLevelKeyRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		if m[1] != key {
			continue
		}
		return strings.TrimSpace(m[2]), true
	}
	return "", false
}

// SetScalar replaces an existing top-level scalar key, or appends one if
// the key is not present.
//
// The value is written verbatim — the caller is responsible for quoting
// (e.g. `"SP-170"` with quotes, or an unquoted identifier). This matches
// how the existing bash sed commands behave and keeps the contract simple.
func (f *File) SetScalar(key, value string) {
	for i, line := range f.lines {
		m := topLevelKeyRe.FindStringSubmatch(line)
		if m == nil || m[1] != key {
			continue
		}
		f.lines[i] = key + ": " + value
		return
	}
	// Not found — append before any trailing blank lines.
	insertAt := len(f.lines)
	for insertAt > 0 && strings.TrimSpace(f.lines[insertAt-1]) == "" {
		insertAt--
	}
	newLine := key + ": " + value
	f.lines = append(f.lines[:insertAt], append([]string{newLine}, f.lines[insertAt:]...)...)
}

// HasBlock reports whether the frontmatter contains a top-level block key
// (a line like "scores:" with nested content below it). It does not parse
// the block — it just checks for the "<key>:" line at indent 0 with no
// inline value.
func (f *File) HasBlock(key string) bool {
	want := key + ":"
	for _, line := range f.lines {
		if strings.TrimRight(line, " \t") == want {
			return true
		}
	}
	return false
}

// SetNestedScalar replaces the value of a scalar key nested one level deep,
// or appends a new key at the nested indent if absent.
//
// This is the Phase 3 addition for the credits / ralph frontmatter
// mutations, which target keys like `  model: "..."` and `  harness: "..."`
// (2-space-indented nested under `translatedBy:`). Rather than introduce
// a key-path syntax, SetNestedScalar takes the parent key plus the child
// name: SetNestedScalar("translatedBy", "model", `"Opus 4.6"`) will find
// the line `  model: "..."` that follows `translatedBy:` at indent 2 and
// replace the value portion.
//
// If the parent block is not found, or no child with that name exists
// inside it, SetNestedScalar appends a new `  <child>: <value>` line at
// the bottom of the parent block (before the next line at indent 0).
//
// The value is written verbatim — caller is responsible for quoting.
func (f *File) SetNestedScalar(parentKey, childKey, value string) {
	parentHeader := parentKey + ":"

	// Locate the parent block's start line (exact match on "parentKey:").
	parentIdx := -1
	for i, line := range f.lines {
		if strings.TrimRight(line, " \t") == parentHeader {
			parentIdx = i
			break
		}
	}

	// Walk the nested children inside the parent block, looking for
	// childKey. Stop when we hit a line that is NOT at indent 2+ (i.e. a
	// sibling top-level key or empty line that breaks the block).
	if parentIdx >= 0 {
		for i := parentIdx + 1; i < len(f.lines); i++ {
			ln := f.lines[i]
			if ln == "" {
				continue
			}
			// Any line not starting with at least two spaces is outside
			// the nested block.
			if !strings.HasPrefix(ln, "  ") {
				break
			}
			trimmed := strings.TrimLeft(ln, " \t")
			if strings.HasPrefix(trimmed, childKey+":") {
				// Direct child. Replace the line, preserving the
				// indent level (we compute indent from the original
				// rather than hard-coding two spaces).
				indent := ln[:len(ln)-len(trimmed)]
				f.lines[i] = indent + childKey + ": " + value
				return
			}
		}
		// Not found — append inside the parent block at indent 2.
		// Insert position: end of the nested block (first sibling or end).
		insertAt := len(f.lines)
		for i := parentIdx + 1; i < len(f.lines); i++ {
			ln := f.lines[i]
			if ln != "" && !strings.HasPrefix(ln, "  ") {
				insertAt = i
				break
			}
		}
		newLine := "  " + childKey + ": " + value
		f.lines = append(f.lines[:insertAt], append([]string{newLine}, f.lines[insertAt:]...)...)
		return
	}

	// Parent block missing entirely. Append both parent + child at the
	// top level.
	f.lines = append(f.lines, parentHeader, "  "+childKey+": "+value)
}

// SetNestedBlock replaces (or inserts) a nested block child of parentKey.
//
// Use this when the block being inserted is a child of another mapping —
// e.g. a `translatedBy.pipeline` array. childKey is the un-indented child
// name (e.g. "pipeline"); the helper computes the correct indent from the
// existing parent block layout.
//
// snippet is the full YAML rendered for the block including the child
// header line, pre-indented to match the nesting (caller must format).
//
// Behavior:
//   - parent + child both exist → replace the existing child block (start
//     line of child header, plus every subsequent more-indented line)
//   - parent exists, child missing → INSERT child block at the end of the
//     parent's nested block, BEFORE the next sibling top-level key (this
//     is the case credits.go hits on the first run of an article)
//   - parent missing → no-op (caller messed up; fail silent rather than
//     putting the block at the wrong place)
//
// This is the bug-fixed sibling of SetBlock for nested keys. SetBlock's
// "key not found, append at end of frontmatter" path produces broken
// YAML when the indentedKey was meant to be nested — the block lands
// dangling after `tags:` instead of inside `translatedBy`.
func (f *File) SetNestedBlock(parentKey, childKey, snippet string) {
	parentHeader := parentKey + ":"

	// Locate the parent block's start line.
	parentIdx := -1
	for i, line := range f.lines {
		if strings.TrimRight(line, " \t") == parentHeader {
			parentIdx = i
			break
		}
	}
	if parentIdx < 0 {
		return // parent missing; no-op
	}

	// Find the end of the parent block (first line whose indentation is
	// less-or-equal to the parent's, i.e. a sibling top-level key or end
	// of frontmatter). Empty lines count as continuation.
	parentEnd := len(f.lines)
	for i := parentIdx + 1; i < len(f.lines); i++ {
		ln := f.lines[i]
		if ln == "" {
			continue
		}
		if !strings.HasPrefix(ln, "  ") {
			parentEnd = i
			break
		}
	}

	// Search for an existing child header inside the parent block.
	// The child header is at indent 2 (under a top-level parent), so we
	// look for `  <childKey>:` exactly.
	childHeader := "  " + childKey + ":"
	childStart := -1
	for i := parentIdx + 1; i < parentEnd; i++ {
		if strings.TrimRight(f.lines[i], " \t") == childHeader {
			childStart = i
			break
		}
	}

	snippetLines := strings.Split(strings.TrimRight(snippet, "\n"), "\n")

	if childStart >= 0 {
		// Replace existing child block: header + every more-indented line.
		childEnd := childStart + 1
		for childEnd < parentEnd {
			ln := f.lines[childEnd]
			if ln == "" {
				childEnd++
				continue
			}
			lineIndent := leadingSpaces(ln)
			// More indented than the child header (>2 spaces) → still inside.
			if len(lineIndent) <= 2 {
				break
			}
			childEnd++
		}
		out := make([]string, 0, len(f.lines)-(childEnd-childStart)+len(snippetLines))
		out = append(out, f.lines[:childStart]...)
		out = append(out, snippetLines...)
		out = append(out, f.lines[childEnd:]...)
		f.lines = out
		return
	}

	// Child missing — insert at the end of the parent block, before the
	// next sibling top-level key (parentEnd).
	out := make([]string, 0, len(f.lines)+len(snippetLines))
	out = append(out, f.lines[:parentEnd]...)
	out = append(out, snippetLines...)
	out = append(out, f.lines[parentEnd:]...)
	f.lines = out
}

// SetBlock replaces (or appends) a nested block like:
//
//	pipeline:
//	  - role: "Written"
//	    model: "Opus 4.6"
//	    harness: "Claude Code CLI"
//
// inside its parent block. indentedKey is the KEY PATH of the block within
// the frontmatter, rendered as it should appear in the source — usually
// "  pipeline" (2-space indented, nested under translatedBy). yamlSnippet
// is the full replacement block INCLUDING the key header line, pre-indented
// to match indentedKey's indent level. SetBlock does not try to fix
// indentation for you.
//
// Strategy: find the line that starts with "<indentedKey>:", consume it
// plus every subsequent line whose indentation is GREATER than
// indentedKey's indent (i.e. the block's children), and replace the whole
// range with yamlSnippet split on newlines. If the key is not found, the
// snippet is appended at the end of the frontmatter.
//
// ⚠️ Use SetNestedBlock when the indentedKey is meant to live inside a
// parent block (e.g. translatedBy.pipeline). SetBlock's "not found = append
// at end of frontmatter" path produces broken YAML in that case.
func (f *File) SetBlock(indentedKey, yamlSnippet string) {
	snippet := strings.Split(strings.TrimRight(yamlSnippet, "\n"), "\n")

	indent := leadingSpaces(indentedKey)
	keyHeader := indentedKey + ":"

	start := -1
	for i, line := range f.lines {
		if strings.TrimRight(line, " \t") == keyHeader {
			start = i
			break
		}
	}
	if start < 0 {
		// Not found — append at the end of the frontmatter.
		f.lines = append(f.lines, snippet...)
		return
	}

	// Consume children: any line with strictly greater indentation than
	// the key header. An empty line counts as "still inside the block"
	// ONLY if the next non-empty line is also more deeply indented; for
	// simplicity we treat empty lines as continuation (bash sed does the
	// same via multi-line patterns).
	end := start + 1
	for end < len(f.lines) {
		ln := f.lines[end]
		if ln == "" {
			end++
			continue
		}
		lineIndent := leadingSpaces(ln)
		if len(lineIndent) <= len(indent) {
			break
		}
		end++
	}

	// Splice snippet over [start, end).
	out := make([]string, 0, len(f.lines)-(end-start)+len(snippet))
	out = append(out, f.lines[:start]...)
	out = append(out, snippet...)
	out = append(out, f.lines[end:]...)
	f.lines = out
}

// StripLinesMatching removes every frontmatter line whose content matches
// the predicate. Used by the ralph normaliser to drop old pipelineUrl
// lines before re-inserting the canonical one.
func (f *File) StripLinesMatching(pred func(line string) bool) {
	out := f.lines[:0]
	for _, line := range f.lines {
		if pred(line) {
			continue
		}
		out = append(out, line)
	}
	f.lines = out
}

// leadingSpaces returns the leading whitespace prefix of s.
func leadingSpaces(s string) string {
	i := 0
	for i < len(s) && (s[i] == ' ' || s[i] == '\t') {
		i++
	}
	return s[:i]
}
