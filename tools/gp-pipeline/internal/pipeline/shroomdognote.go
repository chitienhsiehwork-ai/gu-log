package pipeline

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// containsShroomDogNote reports whether MDX uses or imports ShroomDogNote.
func containsShroomDogNote(data []byte) bool {
	return bytes.Contains(data, []byte("<ShroomDogNote")) ||
		bytes.Contains(data, []byte("import ShroomDogNote"))
}

// rejectShroomDogNote fails a write or refine of any series whose output
// contains a ShroomDogNote: it holds ShroomDog's own words, and automation
// never writes them (openspec gp-pipeline-publish-integrity). The output is
// moved aside as evidence so neither a later step nor a --from-step resume
// can pick it up as the draft.
func (s *State) rejectShroomDogNote(step, path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("%s: read %s: %w", step, filepath.Base(path), err)
	}
	if !containsShroomDogNote(data) {
		return nil
	}
	rejected := strings.TrimSuffix(path, ".mdx") + ".rejected-shroomdognote.mdx"
	if err := os.Rename(path, rejected); err != nil {
		return fmt.Errorf("%s: move aside the output that contains a ShroomDogNote: %w", step, err)
	}
	return NewStepError(14, fmt.Errorf("%s: the model wrote a ShroomDogNote; only ShroomDog adds one, so the output is rejected (kept as %s)", step, filepath.Base(rejected)))
}
