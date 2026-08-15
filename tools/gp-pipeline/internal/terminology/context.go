package terminology

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type glossaryLinking struct {
	Enabled *bool `json:"enabled"`
}

type glossaryEntry struct {
	Term          string          `json:"term"`
	ForbiddenZhTw []string        `json:"forbiddenZhTw"`
	Linking       glossaryLinking `json:"linking"`
}

type canonicalEntry struct {
	Term          string   `json:"term"`
	ForbiddenZhTw []string `json:"forbiddenZhTw"`
}

// LoadCanonicalContext renders the glossary-owned portion of the translator
// prompt contract. No definitions, notes, or aliases cross this boundary.
func LoadCanonicalContext(repoRoot string) (string, error) {
	data, err := os.ReadFile(filepath.Join(repoRoot, "src", "data", "glossary.json"))
	if err != nil {
		return "", fmt.Errorf("read canonical terminology: %w", err)
	}
	var glossary []glossaryEntry
	if err := json.Unmarshal(data, &glossary); err != nil {
		return "", fmt.Errorf("parse canonical terminology: %w", err)
	}

	entries := make([]canonicalEntry, 0)
	for _, entry := range glossary {
		if entry.Term == "" || len(entry.ForbiddenZhTw) == 0 {
			continue
		}
		if entry.Linking.Enabled != nil && !*entry.Linking.Enabled {
			continue
		}
		entries = append(entries, canonicalEntry{
			Term: entry.Term, ForbiddenZhTw: append([]string(nil), entry.ForbiddenZhTw...),
		})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Term < entries[j].Term })
	encoded, err := json.Marshal(entries)
	if err != nil {
		return "", fmt.Errorf("encode canonical terminology: %w", err)
	}
	return string(encoded), nil
}
