package preservation

import "bytes"

// EscapeMDXImageAltBraces makes literal JSON in complete Markdown image alt
// text safe for MDX. It leaves fenced code and inline code byte-for-byte
// unchanged.
func EscapeMDXImageAltBraces(document []byte) []byte {
	canonical, _ := EscapeMDXImageAltBracesWithOffsets(document)
	return canonical
}

// EscapeMDXImageAltBracesWithOffsets also returns a boundary map from each byte
// offset in document to its corresponding offset in canonical. This lets
// callers preserve already-validated exact-text anchors when escaping inserts
// bytes before braces.
func EscapeMDXImageAltBracesWithOffsets(document []byte) ([]byte, []int) {
	lines := bytes.SplitAfter(document, []byte("\n"))
	out := make([]byte, 0, len(document))
	offsets := make([]int, len(document)+1)
	oldBase := 0
	inFence := false
	var fenceByte byte
	var fenceWidth int
	inlineTicks := 0
	for _, line := range lines {
		var canonical []byte
		var lineOffsets []int
		if inlineTicks == 0 {
			if marker, width, ok := markdownFenceMarker(line); ok {
				canonical, lineOffsets = identityCanonicalLine(line)
				if !inFence {
					inFence, fenceByte, fenceWidth = true, marker, width
				} else if marker == fenceByte && width >= fenceWidth {
					inFence = false
				}
			} else if inFence {
				canonical, lineOffsets = identityCanonicalLine(line)
			} else {
				canonical, lineOffsets = escapeImageAltBracesLine(line, &inlineTicks)
			}
		} else {
			canonical, lineOffsets = escapeImageAltBracesLine(line, &inlineTicks)
		}

		newBase := len(out)
		for i, offset := range lineOffsets {
			offsets[oldBase+i] = newBase + offset
		}
		out = append(out, canonical...)
		oldBase += len(line)
	}
	return out, offsets
}

func markdownFenceMarker(line []byte) (byte, int, bool) {
	trimmed := bytes.TrimLeft(line, " \t")
	for len(trimmed) > 0 && trimmed[0] == '>' {
		trimmed = bytes.TrimLeft(trimmed[1:], " \t")
	}
	if len(trimmed) < 3 || (trimmed[0] != '`' && trimmed[0] != '~') {
		return 0, 0, false
	}
	marker := trimmed[0]
	width := 0
	for width < len(trimmed) && trimmed[width] == marker {
		width++
	}
	return marker, width, width >= 3
}

type canonicalLine struct {
	input      []byte
	output     []byte
	boundaries []int
	position   int
}

func newCanonicalLine(input []byte) *canonicalLine {
	return &canonicalLine{input: input, output: make([]byte, 0, len(input)), boundaries: make([]int, len(input)+1)}
}

func (c *canonicalLine) copyTo(end int) {
	for c.position < end {
		c.boundaries[c.position] = len(c.output)
		c.output = append(c.output, c.input[c.position])
		c.position++
	}
}

func (c *canonicalLine) insert(value byte) {
	c.output = append(c.output, value)
}

func (c *canonicalLine) finish() ([]byte, []int) {
	c.copyTo(len(c.input))
	c.boundaries[len(c.input)] = len(c.output)
	return c.output, c.boundaries
}

func identityCanonicalLine(line []byte) ([]byte, []int) {
	canonical := newCanonicalLine(line)
	return canonical.finish()
}

func escapeImageAltBracesLine(line []byte, inlineTicks *int) ([]byte, []int) {
	canonical := newCanonicalLine(line)
	for canonical.position < len(line) {
		i := canonical.position
		if line[i] == '\\' && i+1 < len(line) {
			canonical.copyTo(i + 2)
			continue
		}
		if line[i] == '`' {
			width := 1
			for i+width < len(line) && line[i+width] == '`' {
				width++
			}
			canonical.copyTo(i + width)
			if *inlineTicks == 0 {
				*inlineTicks = width
			} else if *inlineTicks == width {
				*inlineTicks = 0
			}
			continue
		}
		if *inlineTicks == 0 && i+1 < len(line) && line[i] == '!' && line[i+1] == '[' {
			if altEnd, ok := markdownImageAltEnd(line, i); ok {
				canonical.copyTo(i + 2)
				for canonical.position < altEnd {
					pos := canonical.position
					if line[pos] == '\\' && pos+1 < altEnd {
						canonical.copyTo(pos + 2)
						continue
					}
					if line[pos] == '{' || line[pos] == '}' {
						canonical.insert('\\')
					}
					canonical.copyTo(pos + 1)
				}
				canonical.copyTo(altEnd + 1)
				continue
			}
		}
		canonical.copyTo(i + 1)
	}
	return canonical.finish()
}

func markdownImageAltEnd(line []byte, start int) (int, bool) {
	bracketDepth := 1
	for i := start + 2; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) {
			i++
			continue
		}
		switch line[i] {
		case '[':
			bracketDepth++
		case ']':
			bracketDepth--
			if bracketDepth == 0 {
				if i+1 >= len(line) || line[i+1] != '(' || !hasMarkdownImageDestinationEnd(line, i+1) {
					return 0, false
				}
				return i, true
			}
		}
	}
	return 0, false
}

func hasMarkdownImageDestinationEnd(line []byte, start int) bool {
	parenDepth := 1
	for i := start + 1; i < len(line); i++ {
		if line[i] == '\\' && i+1 < len(line) {
			i++
			continue
		}
		switch line[i] {
		case '(':
			parenDepth++
		case ')':
			parenDepth--
			if parenDepth == 0 {
				return true
			}
		}
	}
	return false
}
