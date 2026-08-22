package preservation

import (
	"bytes"
	"strings"
	"testing"
)

func validJingjingArtifact(translation []byte, word string) JingjingArtifact {
	start := bytes.Index(translation, []byte(word))
	return JingjingArtifact{
		Version:      JingjingContractVersion,
		PolicySHA256: strings.Repeat("a", 64),
		Files: []JingjingFile{{
			Path:   "translation.mdx",
			SHA256: SHA256(translation),
			Violations: []JingjingViolation{{
				Word: word, Line: bytes.Count(translation[:start], []byte("\n")) + 1,
				StartByte: start, EndByte: start + len([]byte(word)), Context: "系統的 " + word,
			}},
		}},
	}
}

func TestValidateJingjingArtifactAndFindingsBindExactBytes(t *testing.T) {
	translation := []byte("---\nlang: zh-tw\n---\n\n系統的 traces 要逐筆檢查。\n")
	artifact := validJingjingArtifact(translation, "traces")
	if err := ValidateJingjingArtifact(artifact, translation); err != nil {
		t.Fatal(err)
	}
	findings, err := JingjingFindings([]byte("Inspect the traces."), translation, artifact)
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 1 || findings[0].IssueType != "natural_zh_tw" || findings[0].SourceQuote != "" || !findings[0].Approved {
		t.Fatalf("unexpected bounded findings: %#v", findings)
	}
	if findings[0].OldText != "traces" || findings[0].OldTextSHA256 != SHA256([]byte("traces")) {
		t.Fatalf("finding lost exact-text binding: %#v", findings[0])
	}
}

func TestValidateJingjingArtifactFailsClosed(t *testing.T) {
	translation := []byte("---\nlang: zh-tw\n---\n\n系統的 traces 要逐筆檢查。\n")
	valid := validJingjingArtifact(translation, "traces")
	tests := map[string]func(*JingjingArtifact){
		"stale file hash": func(a *JingjingArtifact) { a.Files[0].SHA256 = strings.Repeat("0", 64) },
		"stale boundary":  func(a *JingjingArtifact) { a.Files[0].Violations[0].StartByte++ },
		"stale line":      func(a *JingjingArtifact) { a.Files[0].Violations[0].Line++ },
		"invalid policy":  func(a *JingjingArtifact) { a.PolicySHA256 = "not-a-hash" },
		"baseline scan":   func(a *JingjingArtifact) { a.BaselineRef = "origin/main" },
		"skipped":         func(a *JingjingArtifact) { a.Files[0].Skipped = true },
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			artifact := valid
			artifact.Files = append([]JingjingFile(nil), valid.Files...)
			artifact.Files[0].Violations = append([]JingjingViolation(nil), valid.Files[0].Violations...)
			mutate(&artifact)
			if err := ValidateJingjingArtifact(artifact, translation); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
}
