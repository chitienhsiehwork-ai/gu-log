package preservation

import "fmt"

// ValidatePatchAuthorization prevents a corrector from widening a reviewer's
// boundary or inventing a new issue. Replacement text is the only field the
// corrector may change.
func ValidatePatchAuthorization(approved, patches []Finding) error {
	byID := make(map[string]Finding, len(approved))
	for _, finding := range approved {
		if !finding.Approved {
			continue
		}
		byID[finding.ID] = finding
	}
	for _, patch := range patches {
		finding, ok := byID[patch.ID]
		if !ok {
			return fmt.Errorf("patch %q has no approved finding", patch.ID)
		}
		if patch.IssueType != finding.IssueType || patch.SourceQuote != finding.SourceQuote ||
			patch.SourceSHA256 != finding.SourceSHA256 || patch.TranslationSHA256 != finding.TranslationSHA256 ||
			patch.StartByte != finding.StartByte || patch.EndByte != finding.EndByte ||
			patch.OldText != finding.OldText || patch.OldTextSHA256 != finding.OldTextSHA256 {
			return fmt.Errorf("patch %q widened or changed its approved finding boundary", patch.ID)
		}
	}
	return nil
}
