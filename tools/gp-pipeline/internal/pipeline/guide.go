package pipeline

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/terminology"
)

// GP is a ShroomDog-picked reading guide written in Mogu's voice (openspec
// editorial-charter〈GP body MUST be a Mogu-written reading guide〉). These
// helpers hold the GP-only rules the write and refine steps share.

// gpTerminology returns the glossary's canonical-term context for GP write and
// refine prompts, and an empty string for every other series (MP's writer
// prompt is out of this change's scope).
func (s *State) gpTerminology() (string, error) {
	if s.Prefix != "GP" {
		return "", nil
	}
	if s.Cfg == nil {
		return "", fmt.Errorf("canonical terminology: pipeline config is nil")
	}
	return terminology.LoadCanonicalContext(s.Cfg.RepoRoot)
}

// containsShroomDogNote reports whether MDX uses or imports ShroomDogNote.
func containsShroomDogNote(data []byte) bool {
	return bytes.Contains(data, []byte("<ShroomDogNote")) ||
		bytes.Contains(data, []byte("import ShroomDogNote"))
}

// rejectShroomDogNote fails a GP write or refine whose output contains a
// ShroomDogNote: it holds ShroomDog's own words, and automation never writes
// them. The output is moved aside as evidence so neither a later step nor a
// --from-step resume can pick it up as the draft.
func (s *State) rejectShroomDogNote(step, path string) error {
	if s.Prefix != "GP" {
		return nil
	}
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
