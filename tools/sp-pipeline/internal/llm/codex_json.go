package llm

import (
	"bufio"
	"bytes"
	"encoding/json"
	"strings"
)

// SanitizeCodexJSON is the Go port of the Python heredoc at
// scripts/sp-pipeline.sh lines 893-906. Codex occasionally appends log
// lines after the valid JSON object; the sanitiser extracts the first line
// that starts with '{' AND parses as a complete JSON object, discarding
// everything else. If no such line is found, the input is returned
// unchanged so the caller can surface the original bytes in an error.
//
// The function always returns a non-nil []byte — either a pretty-printed
// single-line JSON object followed by '\n', or the original input.
// The second return value is true when sanitisation succeeded.
func SanitizeCodexJSON(raw []byte) ([]byte, bool) {
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	// Codex can emit long JSON-on-one-line payloads; bump the buffer so
	// bufio.Scanner does not bail with "token too long".
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var obj any
		if err := json.Unmarshal([]byte(line), &obj); err != nil {
			continue
		}
		// Re-marshal to guarantee canonical single-line JSON.
		clean, err := json.Marshal(obj)
		if err != nil {
			continue
		}
		return append(clean, '\n'), true
	}
	return raw, false
}
