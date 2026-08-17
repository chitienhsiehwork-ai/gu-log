package preservation

import "bytes"

// EscapeMDXImageAltBraces makes literal JSON in Markdown image alt text safe
// for MDX. It leaves fenced code and inline code byte-for-byte unchanged.
func EscapeMDXImageAltBraces(document []byte) []byte {
	lines := bytes.SplitAfter(document, []byte("\n"))
	out := make([]byte, 0, len(document))
	inFence := false
	var fenceByte byte
	var fenceWidth int
	for _, line := range lines {
		if marker, width, ok := markdownFenceMarker(line); ok {
			out = append(out, line...)
			if !inFence {
				inFence, fenceByte, fenceWidth = true, marker, width
			} else if marker == fenceByte && width >= fenceWidth {
				inFence = false
			}
			continue
		}
		if inFence {
			out = append(out, line...)
			continue
		}
		out = append(out, escapeImageAltBracesLine(line)...)
	}
	return out
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

func escapeImageAltBracesLine(line []byte) []byte {
	out := make([]byte, 0, len(line))
	inlineTicks := 0
	for i := 0; i < len(line); {
		if line[i] == '\\' && i+1 < len(line) {
			out = append(out, line[i], line[i+1])
			i += 2
			continue
		}
		if line[i] == '`' {
			width := 1
			for i+width < len(line) && line[i+width] == '`' {
				width++
			}
			out = append(out, line[i:i+width]...)
			if inlineTicks == 0 {
				inlineTicks = width
			} else if inlineTicks == width {
				inlineTicks = 0
			}
			i += width
			continue
		}
		if inlineTicks == 0 && i+1 < len(line) && line[i] == '!' && line[i+1] == '[' {
			out = append(out, '!', '[')
			i += 2
			for i < len(line) {
				if line[i] == '\\' && i+1 < len(line) {
					out = append(out, line[i], line[i+1])
					i += 2
					continue
				}
				if line[i] == '{' || line[i] == '}' {
					out = append(out, '\\')
				}
				out = append(out, line[i])
				if line[i] == ']' && i+1 < len(line) && line[i+1] == '(' {
					out = append(out, '(')
					i += 2
					break
				}
				i++
			}
			continue
		}
		out = append(out, line[i])
		i++
	}
	return out
}
