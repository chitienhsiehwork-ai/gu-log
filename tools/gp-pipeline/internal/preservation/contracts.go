// Package preservation implements the deterministic contracts that keep a GP
// translation bound to its source. LLMs may propose findings and local edits;
// this package is the authority that decides whether those edits are safe.
package preservation

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const ContractVersion = "gp-source-preservation/v1"

// These schemas are intentionally limited to the top-level wire shape. The
// deterministic validators below remain the authority for hashes, provenance,
// finding boundaries, enums, and cross-field invariants. Native structured
// output prevents provider narration or code fences from corrupting the JSON
// transport before those validators can run.
const SourceTranslationJSONSchema = `{"type":"object","properties":{"version":{"type":"string"},"source_sha256":{"type":"string"},"translation_mdx":{"type":"string"},"slop_candidates":{"type":"array","items":{"type":"object"}}},"required":["version","source_sha256","translation_mdx","slop_candidates"],"additionalProperties":false}`

const GateEnvelopeJSONSchema = `{"type":"object","properties":{"version":{"type":"string"},"gate":{"type":"string"},"source_sha256":{"type":"string"},"body_projection_sha256":{"type":"string"},"verdict":{"type":"string","enum":["PASS","FAIL"]},"findings":{"type":"array","items":{"type":"object"}}},"required":["version","gate","source_sha256","body_projection_sha256","verdict","findings"],"additionalProperties":false}`

const CommentaryArtifactJSONSchema = `{"type":"object","properties":{"version":{"type":"string"},"source_sha256":{"type":"string"},"translation_sha256":{"type":"string"},"candidates":{"type":"array","items":{"type":"object"}}},"required":["version","source_sha256","translation_sha256","candidates"],"additionalProperties":false}`

var allowedIssueTypes = map[string]bool{
	"fidelity": true, "voice": true, "person": true, "order": true,
	"completeness": true, "natural_zh_tw": true, "approved_slop": true,
}

// Provenance identifies the exact runner that produced an artifact.
type Provenance struct {
	Role        string    `json:"role"`
	Provider    string    `json:"provider"`
	Model       string    `json:"model"`
	Harness     string    `json:"harness"`
	CompletedAt time.Time `json:"completed_at"`
}

// Finding is both a source-grounded review item and a bounded patch request.
// Approved=false records evidence without authorising a mutation.
type Finding struct {
	ID                   string `json:"id"`
	IssueType            string `json:"issue_type"`
	SourceQuote          string `json:"source_quote"`
	SourceSHA256         string `json:"source_sha256"`
	TranslationSHA256    string `json:"translation_sha256"`
	StartByte            int    `json:"start_byte"`
	EndByte              int    `json:"end_byte"`
	OldText              string `json:"old_text"`
	OldTextSHA256        string `json:"old_text_sha256"`
	SuggestedReplacement string `json:"suggested_replacement"`
	Approved             bool   `json:"approved"`
}

// ReviewArtifact is the source reviewer's machine-readable output.
type ReviewArtifact struct {
	Version           string     `json:"version"`
	SourceSHA256      string     `json:"source_sha256"`
	TranslationSHA256 string     `json:"translation_sha256"`
	Verdict           string     `json:"verdict"`
	Findings          []Finding  `json:"findings"`
	Provenance        Provenance `json:"provenance"`
}

// PatchArtifact is the bounded corrector's only accepted output shape.
type PatchArtifact struct {
	Version           string     `json:"version"`
	SourceSHA256      string     `json:"source_sha256"`
	TranslationSHA256 string     `json:"translation_sha256"`
	Patches           []Finding  `json:"patches"`
	Provenance        Provenance `json:"provenance"`
}

// GateEnvelope is the durable, freshness-bound publish decision for one gate.
type GateEnvelope struct {
	Version              string     `json:"version"`
	Gate                 string     `json:"gate"`
	SourceSHA256         string     `json:"source_sha256"`
	BodyProjectionSHA256 string     `json:"body_projection_sha256"`
	Verdict              string     `json:"verdict"`
	Findings             []Finding  `json:"findings"`
	Provenance           Provenance `json:"provenance"`
}

// PublishManifest aggregates every hard gate. It is revalidated immediately
// before deploy; a PASS string on its own is never sufficient.
type PublishManifest struct {
	Version              string         `json:"version"`
	ProfileSHA256        string         `json:"profile_sha256"`
	SourceSHA256         string         `json:"source_sha256"`
	BodyProjectionSHA256 string         `json:"body_projection_sha256"`
	Verdict              string         `json:"verdict"`
	Gates                []GateEnvelope `json:"gates"`
	CompletedAt          time.Time      `json:"completed_at"`
}

type SourceTranslationArtifact struct {
	Version           string     `json:"version"`
	SourceSHA256      string     `json:"source_sha256"`
	TranslationSHA256 string     `json:"translation_sha256,omitempty"`
	TranslationMDX    string     `json:"translation_mdx"`
	SlopCandidates    []Finding  `json:"slop_candidates"`
	Provenance        Provenance `json:"provenance,omitempty"`
}

type CommentaryCandidate struct {
	ID         string `json:"id"`
	AnchorText string `json:"anchor_text"`
	AfterByte  int    `json:"after_byte"`
	Commentary string `json:"commentary"`
}

type CommentaryArtifact struct {
	Version           string                `json:"version"`
	SourceSHA256      string                `json:"source_sha256"`
	TranslationSHA256 string                `json:"translation_sha256"`
	Candidates        []CommentaryCandidate `json:"candidates"`
	Provenance        Provenance            `json:"provenance,omitempty"`
}

func SHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// DecodeStrict rejects prose around JSON and unknown fields. This makes an LLM
// contract failure observable instead of silently accepting a partial verdict.
func DecodeStrict(data []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return fmt.Errorf("decode preservation artifact: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("decode preservation artifact: trailing JSON value")
		}
		return fmt.Errorf("decode preservation artifact trailing data: %w", err)
	}
	return nil
}

func ValidateProvenance(p Provenance, wantRole string) error {
	if p.Role != wantRole {
		return fmt.Errorf("provenance role %q, want %q", p.Role, wantRole)
	}
	if p.Provider == "" || p.Model == "" || p.Harness == "" || p.CompletedAt.IsZero() {
		return errors.New("provenance requires provider, model, harness, and completed_at")
	}
	return nil
}

// ValidateGate verifies schema, provenance and artifact freshness.
func ValidateGate(g GateEnvelope, gate, sourceHash, projectionHash string) error {
	if g.Version != ContractVersion {
		return fmt.Errorf("gate version %q, want %q", g.Version, ContractVersion)
	}
	if g.Gate != gate {
		return fmt.Errorf("gate name %q, want %q", g.Gate, gate)
	}
	if g.SourceSHA256 != sourceHash || g.BodyProjectionSHA256 != projectionHash {
		return errors.New("gate artifact hashes are stale")
	}
	if g.Verdict != "PASS" && g.Verdict != "FAIL" {
		return fmt.Errorf("invalid gate verdict %q", g.Verdict)
	}
	if err := ValidateVerdictFindings(g.Verdict, g.Findings); err != nil {
		return err
	}
	return ValidateProvenance(g.Provenance, gate)
}

// ValidateVerdictFindings prevents a malformed response from smuggling
// actionable findings through a PASS or producing an uncorrectable FAIL.
func ValidateVerdictFindings(verdict string, findings []Finding) error {
	switch verdict {
	case "PASS":
		if len(findings) != 0 {
			return errors.New("PASS verdict must not contain findings")
		}
	case "FAIL":
		if len(findings) == 0 {
			return errors.New("FAIL verdict requires at least one finding")
		}
	default:
		return fmt.Errorf("invalid gate verdict %q", verdict)
	}
	return nil
}

// ValidateManifest is the final fail-closed deploy check.
func ValidateManifest(m PublishManifest, source, projection []byte, requiredGates []string, expectedProfileSHA256 string) error {
	if m.Version != ContractVersion {
		return fmt.Errorf("manifest version %q, want %q", m.Version, ContractVersion)
	}
	if m.Verdict != "PASS" {
		return fmt.Errorf("publish manifest verdict is %q", m.Verdict)
	}
	if m.CompletedAt.IsZero() {
		return errors.New("publish manifest missing completed_at")
	}
	if expectedProfileSHA256 == "" || m.ProfileSHA256 != expectedProfileSHA256 {
		return errors.New("publish manifest runtime profile is missing or stale")
	}
	sourceHash, projectionHash := SHA256(source), SHA256(projection)
	if m.SourceSHA256 != sourceHash || m.BodyProjectionSHA256 != projectionHash {
		return errors.New("publish manifest hashes are stale")
	}
	want := make(map[string]bool, len(requiredGates))
	for _, gate := range requiredGates {
		want[gate] = true
	}
	for _, gate := range m.Gates {
		if !want[gate.Gate] {
			return fmt.Errorf("unexpected publish gate %q", gate.Gate)
		}
		if err := ValidateGate(gate, gate.Gate, sourceHash, projectionHash); err != nil {
			return err
		}
		if gate.Verdict != "PASS" {
			return fmt.Errorf("publish gate %s is %s", gate.Gate, gate.Verdict)
		}
		delete(want, gate.Gate)
	}
	if len(want) != 0 {
		missing := make([]string, 0, len(want))
		for gate := range want {
			missing = append(missing, gate)
		}
		sort.Strings(missing)
		return fmt.Errorf("publish manifest missing gates: %s", strings.Join(missing, ", "))
	}
	return nil
}

// ApplyPatches validates every approved patch against the immutable input and
// applies them back-to-front. Therefore bytes outside the declared boundaries
// are mechanically unable to change.
func ApplyPatches(source, translation []byte, artifact PatchArtifact) ([]byte, error) {
	if artifact.Version != ContractVersion {
		return nil, fmt.Errorf("patch version %q, want %q", artifact.Version, ContractVersion)
	}
	if artifact.SourceSHA256 != SHA256(source) || artifact.TranslationSHA256 != SHA256(translation) {
		return nil, errors.New("patch artifact hashes are stale")
	}
	if err := ValidateProvenance(artifact.Provenance, "corrector"); err != nil {
		return nil, err
	}
	patches := append([]Finding(nil), artifact.Patches...)
	sort.Slice(patches, func(i, j int) bool { return patches[i].StartByte < patches[j].StartByte })
	previousEnd := -1
	for i := range patches {
		p := &patches[i]
		if !p.Approved {
			return nil, fmt.Errorf("patch %q was not approved", p.ID)
		}
		if err := validateFinding(source, translation, *p); err != nil {
			return nil, fmt.Errorf("patch %q: %w", p.ID, err)
		}
		if p.StartByte < previousEnd {
			return nil, fmt.Errorf("patch %q overlaps a previous patch", p.ID)
		}
		previousEnd = p.EndByte
	}
	out := append([]byte(nil), translation...)
	for i := len(patches) - 1; i >= 0; i-- {
		p := patches[i]
		out = append(out[:p.StartByte], append([]byte(p.SuggestedReplacement), out[p.EndByte:]...)...)
	}
	return out, nil
}

func validateFinding(source, translation []byte, p Finding) error {
	if p.ID == "" || !allowedIssueTypes[p.IssueType] {
		return fmt.Errorf("invalid id or issue_type %q", p.IssueType)
	}
	if p.SourceSHA256 != SHA256(source) || p.TranslationSHA256 != SHA256(translation) {
		return errors.New("finding hashes are stale")
	}
	if p.IssueType == "natural_zh_tw" {
		if p.SourceQuote != "" {
			return errors.New("natural_zh_tw finding must be source-blind")
		}
	} else if p.SourceQuote == "" || !bytes.Contains(source, []byte(p.SourceQuote)) {
		return errors.New("source_quote is absent from source")
	}
	if p.StartByte < 0 || p.EndByte <= p.StartByte || p.EndByte > len(translation) {
		return errors.New("invalid byte boundary")
	}
	if !utf8.Valid(translation[:p.StartByte]) || !utf8.Valid(translation[:p.EndByte]) {
		return errors.New("byte boundary splits a UTF-8 code point")
	}
	old := translation[p.StartByte:p.EndByte]
	if string(old) != p.OldText || SHA256(old) != p.OldTextSHA256 {
		return errors.New("offset, exact old text, or old-text hash mismatch")
	}
	if inFrontmatter(translation, p.StartByte, p.EndByte) {
		return errors.New("frontmatter edits are forbidden")
	}
	if bytes.Contains(old, []byte("\n\n")) {
		return errors.New("patch boundary crosses paragraphs")
	}
	bodyStart := bodyStartOffset(translation)
	if p.StartByte <= bodyStart && p.EndByte >= len(translation) {
		return errors.New("full-document replacement is forbidden")
	}
	if len(old) > 0 && len(old)*5 > len(translation)*4 {
		return errors.New("near-full-document replacement is forbidden")
	}
	return nil
}

func ValidateFindings(source, translation []byte, findings []Finding) error {
	for _, finding := range findings {
		if err := validateFinding(source, translation, finding); err != nil {
			return fmt.Errorf("finding %q: %w", finding.ID, err)
		}
	}
	return nil
}

// CanonicalizeFindingAnchors keeps byte arithmetic out of the LLM contract. A
// reviewer identifies a unique exact old_text; the runtime
// derives its UTF-8 byte boundaries and hash before the normal validator and
// bounded patch applicator see the finding. Ambiguous anchors remain a hard
// failure instead of being guessed.
func CanonicalizeFindingAnchors(translation []byte, findings []Finding) ([]Finding, error) {
	out := append([]Finding(nil), findings...)
	bodyStart := bodyStartOffset(translation)
	body := translation[bodyStart:]
	for i := range out {
		finding := &out[i]
		if finding.OldText == "" {
			return nil, fmt.Errorf("finding %q has empty exact-text anchor", finding.ID)
		}
		old := []byte(finding.OldText)
		relativeStart := bytes.Index(body, old)
		if relativeStart < 0 || bytes.Index(body[relativeStart+len(old):], old) >= 0 {
			return nil, fmt.Errorf("finding %q exact-text anchor must occur exactly once", finding.ID)
		}
		start := bodyStart + relativeStart
		end := start + len(old)
		finding.StartByte = start
		finding.EndByte = end
		finding.OldTextSHA256 = SHA256(old)
	}
	return out, nil
}

// ApplyCommentaryCandidates inserts only isolated MoguNote nodes at exact,
// paragraph-ending anchors. The projection check remains the final authority.
func ApplyCommentaryCandidates(source, translation []byte, artifact CommentaryArtifact) ([]byte, error) {
	if artifact.Version != ContractVersion || artifact.SourceSHA256 != SHA256(source) || artifact.TranslationSHA256 != SHA256(translation) {
		return nil, errors.New("commentary artifact is invalid or stale")
	}
	candidates := append([]CommentaryCandidate(nil), artifact.Candidates...)
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].AfterByte < candidates[j].AfterByte })
	previous := -1
	for _, candidate := range candidates {
		if candidate.ID == "" || candidate.AnchorText == "" || candidate.Commentary == "" {
			return nil, errors.New("commentary candidate requires id, anchor_text, and commentary")
		}
		if candidate.AfterByte <= previous || candidate.AfterByte < len([]byte(candidate.AnchorText)) || candidate.AfterByte > len(translation) {
			return nil, fmt.Errorf("commentary candidate %s has invalid or duplicate boundary", candidate.ID)
		}
		if !utf8.Valid(translation[:candidate.AfterByte]) {
			return nil, fmt.Errorf("commentary candidate %s splits a UTF-8 code point", candidate.ID)
		}
		start := candidate.AfterByte - len([]byte(candidate.AnchorText))
		if string(translation[start:candidate.AfterByte]) != candidate.AnchorText {
			return nil, fmt.Errorf("commentary candidate %s anchor mismatch", candidate.ID)
		}
		if candidate.AfterByte < len(translation) && !bytes.HasPrefix(translation[candidate.AfterByte:], []byte("\n\n")) {
			return nil, fmt.Errorf("commentary candidate %s is not at a paragraph boundary", candidate.ID)
		}
		if strings.Contains(candidate.Commentary, "</MoguNote>") || strings.Contains(candidate.Commentary, "<MoguNote") {
			return nil, fmt.Errorf("commentary candidate %s contains nested component markup", candidate.ID)
		}
		previous = candidate.AfterByte
	}
	out := append([]byte(nil), translation...)
	for i := len(candidates) - 1; i >= 0; i-- {
		candidate := candidates[i]
		note := []byte("\n\n<MoguNote>\n" + candidate.Commentary + "\n</MoguNote>")
		out = append(out[:candidate.AfterByte], append(note, out[candidate.AfterByte:]...)...)
	}
	return out, nil
}

func bodyStartOffset(doc []byte) int {
	if !bytes.HasPrefix(doc, []byte("---\n")) {
		return 0
	}
	if end := bytes.Index(doc[4:], []byte("\n---\n")); end >= 0 {
		return 4 + end + len("\n---\n")
	}
	return 0
}

func inFrontmatter(doc []byte, start, end int) bool {
	body := bodyStartOffset(doc)
	return body > 0 && (start < body || end <= body)
}

// DeterministicNaturalFindings supplies non-compensating calibration checks.
// LLM gates may add findings, but cannot waive these terms or a first-person
// voice-owner change.
func DeterministicNaturalFindings(source, translation []byte) []string {
	text := string(translation)
	var findings []string
	// Spec-owned GP-273 calibration phrases. Keep this exact corpus deliberately
	// tiny; the LLM gate discovers other problems without turning one article's
	// wording into a global style blacklist.
	for _, term := range []string{
		"銜尾蛇",
		"演算法動態",
	} {
		if strings.Contains(text, term) {
			findings = append(findings, "不自然用語："+term)
		}
	}
	sourceText := strings.ToLower(string(source))
	firstPersonSource := strings.Count(sourceText, " i ")+strings.Count(sourceText, " i'm")+strings.Count(sourceText, " i've")+strings.Count(sourceText, " my ") >= 3
	if firstPersonSource {
		thirdPersonFraming := []string{"寫這篇文章的人", "原作者認為", "作者認為", "他認為"}
		for _, marker := range thirdPersonFraming {
			if strings.Contains(text, marker) {
				findings = append(findings, "第一人稱 voice owner 被改成第三人稱："+marker)
				break
			}
		}
		if strings.Count(text, "我") < 3 {
			findings = append(findings, "第一人稱 source 缺少可辨識的第一人稱翻譯")
		}
	}
	return findings
}

// DeterministicSourceFindings adds structural calibration signals which an LLM
// score cannot compensate for. The semantic source reviewer remains
// responsible for complete fidelity and order review.
func DeterministicSourceFindings(source, translation []byte) []string {
	findings := DeterministicNaturalFindings(source, translation)
	sourceText, translatedText := string(source), string(translation)
	sourceHeadings := countMarkdownHeadings(sourceText)
	translatedHeadings := countMarkdownHeadings(translatedText)
	if translatedHeadings > sourceHeadings {
		findings = append(findings, "unsupported packaging：翻譯新增 source 沒有的文章分節")
	}
	if !strings.Contains(strings.ToLower(sourceText), "conclusion") && strings.Contains(translatedText, "## 結語") {
		findings = append(findings, "重複結語：翻譯新增 source 沒有的結語段")
	}
	return findings
}

func countMarkdownHeadings(text string) int {
	count := 0
	for _, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(line, "# ") || strings.HasPrefix(line, "## ") || strings.HasPrefix(line, "### ") {
			count++
		}
	}
	return count
}
