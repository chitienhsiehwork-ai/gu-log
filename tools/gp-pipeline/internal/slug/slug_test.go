package slug

import "testing"

func TestSanitizeAndCanonicalContract(t *testing.T) {
	for input, want := range map[string]string{
		"Nick Baumann":  "nick-baumann",
		"@nickbaumann_": "nickbaumann",
		"don't pad":     "dont-pad",
		"中文":            "article",
	} {
		got := Sanitize(input)
		if got != want {
			t.Errorf("Sanitize(%q) = %q, want %q", input, got, want)
		}
		if !IsCanonical(got) {
			t.Errorf("Sanitize(%q) emitted non-canonical %q", input, got)
		}
	}

	for _, invalid := range []string{"", ".", "..", "/", "../escape", "a/b", `a\b`, "Upper", "under_score", "double--dash", "-leading", "trailing-"} {
		if IsCanonical(invalid) {
			t.Errorf("IsCanonical(%q) = true", invalid)
		}
	}
}
