package main

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// review and refine pick their series contract from the ticket: --ticket-id,
// or the draft's frontmatter ticketId when the flag is unset. Neither has a
// default series, so an MP draft is never reviewed against the GP checklist
// because a flag was left out.

func TestReviewRefineTicketIDHasNoDefault(t *testing.T) {
	resetGlobals()
	root := buildRoot()
	for _, name := range []string{"review", "refine"} {
		sub, _, err := root.Find([]string{name})
		if err != nil {
			t.Fatal(err)
		}
		if def := sub.Flags().Lookup("ticket-id").DefValue; def != "" {
			t.Errorf("%s --ticket-id defaults to %q, want no default series", name, def)
		}
	}
}

func TestDraftIngressTakesTicketFromDraft(t *testing.T) {
	for name, tc := range map[string]struct {
		frontmatterID, flag, wantTicket, wantPrefix string
	}{
		"MP draft, no flag":       {frontmatterID: `"MP-PENDING"`, wantTicket: "MP-PENDING", wantPrefix: "MP"},
		"SD draft, no flag":       {frontmatterID: "SD-12", wantTicket: "SD-12", wantPrefix: "SD"},
		"GP draft, no flag":       {frontmatterID: "'GP-PENDING'", wantTicket: "GP-PENDING", wantPrefix: "GP"},
		"explicit flag wins":      {frontmatterID: "GP-PENDING", flag: "MP-PENDING", wantTicket: "MP-PENDING", wantPrefix: "MP"},
		"no ticketId, given flag": {flag: "SD-PENDING", wantTicket: "SD-PENDING", wantPrefix: "SD"},
	} {
		t.Run(name, func(t *testing.T) {
			draft := filepath.Join(t.TempDir(), "draft-v1.mdx")
			body := "---\ntitle: \"Draft\"\n"
			if tc.frontmatterID != "" {
				body += "ticketId: " + tc.frontmatterID + "\n"
			}
			mustWrite(t, draft, body+"---\nbody\n")
			ticket, prefix, workDir, err := draftIngress("review", draft, "", tc.flag)
			if err != nil {
				t.Fatalf("draftIngress: %v", err)
			}
			if ticket != tc.wantTicket || prefix != tc.wantPrefix || workDir != filepath.Dir(draft) {
				t.Fatalf("draftIngress = (%q, %q, %q), want (%q, %q, %q)",
					ticket, prefix, workDir, tc.wantTicket, tc.wantPrefix, filepath.Dir(draft))
			}
		})
	}
}

// Without --ticket-id, a draft that names its series reaches the model route
// (a missing fake-provider spec fails there), whatever the series.
func TestReviewRefineWithoutFlagReachProviderRoute(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	missingFake := filepath.Join(root, "missing.json")
	for _, command := range []string{"review", "refine"} {
		for _, series := range pipeline.AuthorablePrefixes {
			t.Run(command+" "+series, func(t *testing.T) {
				draft := filepath.Join(t.TempDir(), "draft-v1.mdx")
				mustWrite(t, draft, fmt.Sprintf("---\ntitle: \"Draft\"\nticketId: %s-PENDING\n---\nbody\n", series))
				err := executeCLI(t, "--fake-provider", missingFake, command, "--draft", draft)
				if err == nil || !strings.Contains(err.Error(), "missing.json") {
					t.Fatalf("error = %v, want the %s draft to reach the provider route", err, series)
				}
			})
		}
	}
}

// Without --ticket-id, a draft that names no canonical ticket is refused at
// ingress with exit 1 and the series to choose from, before any model call or
// file write.
func TestReviewRefineRefuseDraftWithoutTicket(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	for _, command := range []string{"review", "refine"} {
		for name, draftBody := range map[string]string{
			"no frontmatter":       "draft body\n",
			"no ticketId":          "---\ntitle: \"Draft\"\n---\nbody\n",
			"unqualified PENDING":  "---\ntitle: \"Draft\"\nticketId: PENDING\n---\nbody\n",
			"retired SP ticket":    "---\ntitle: \"Draft\"\nticketId: SP-PENDING\n---\nbody\n",
			"empty ticketId value": "---\ntitle: \"Draft\"\nticketId: \"\"\n---\nbody\n",
		} {
			t.Run(command+" "+name, func(t *testing.T) {
				workDir := t.TempDir()
				draft := filepath.Join(workDir, "draft-v1.mdx")
				mustWrite(t, draft, draftBody)
				err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"), command, "--draft", draft)
				if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "--ticket-id") {
					t.Fatalf("error = %v (exit %d), want the exit-1 --ticket-id refusal", err, exitCodeFor(err))
				}
				if want := fmt.Sprint(pipeline.AuthorablePrefixes); !strings.Contains(err.Error(), want) {
					t.Fatalf("error = %v, want it to list the series %s", err, want)
				}
				requireNoExternalCalls(t, trapLog)
				requireBytes(t, draft, []byte(draftBody))
				if names := dirNames(t, workDir); !slices.Equal(names, []string{"draft-v1.mdx"}) {
					t.Fatalf("work dir holds %v, want only the draft", names)
				}
			})
		}
	}
}

// The model reads the work dir's draft-v1.mdx, so when that is another file
// than --draft, its ticket is the one used, and both must name one series.
func TestDraftIngressReadsTheModelDraft(t *testing.T) {
	for name, tc := range map[string]struct {
		draftID, modelDraftID, wantTicket, wantPrefix string
	}{
		"model draft supplies the ticket": {draftID: "MP-PENDING", modelDraftID: "MP-12", wantTicket: "MP-12", wantPrefix: "MP"},
		"work dir without draft-v1.mdx":   {draftID: "SD-PENDING", wantTicket: "SD-PENDING", wantPrefix: "SD"},
	} {
		t.Run(name, func(t *testing.T) {
			draft := filepath.Join(t.TempDir(), "foo.mdx")
			mustWrite(t, draft, "---\nticketId: "+tc.draftID+"\n---\nbody\n")
			workDir := t.TempDir()
			if tc.modelDraftID != "" {
				mustWrite(t, filepath.Join(workDir, "draft-v1.mdx"), "---\nticketId: "+tc.modelDraftID+"\n---\nbody\n")
			}
			ticket, prefix, _, err := draftIngress("review", draft, workDir, "")
			if err != nil {
				t.Fatalf("draftIngress: %v", err)
			}
			if ticket != tc.wantTicket || prefix != tc.wantPrefix {
				t.Fatalf("draftIngress = (%q, %q), want (%q, %q)", ticket, prefix, tc.wantTicket, tc.wantPrefix)
			}
		})
	}
}

// Without --ticket-id, a --draft and a work dir draft-v1.mdx that do not name
// one series are refused at ingress with exit 1, before any model call or
// file write.
func TestReviewRefineRefuseDraftsOfDifferentSeries(t *testing.T) {
	root := makeFakeRepo(t)
	t.Setenv("GU_LOG_DIR", root)
	trapLog := trapExternalPrograms(t)
	for _, command := range []string{"review", "refine"} {
		for name, modelDraftBody := range map[string]string{
			"MP model draft":          "---\nticketId: MP-PENDING\n---\nbody\n",
			"model draft no ticketId": "---\ntitle: \"Draft\"\n---\nbody\n",
		} {
			t.Run(command+" "+name, func(t *testing.T) {
				draft := filepath.Join(t.TempDir(), "foo.mdx")
				mustWrite(t, draft, "---\nticketId: GP-PENDING\n---\nbody\n")
				workDir := t.TempDir()
				modelDraft := filepath.Join(workDir, "draft-v1.mdx")
				mustWrite(t, modelDraft, modelDraftBody)
				err := executeCLI(t, "--fake-provider", filepath.Join(root, "missing.json"),
					command, "--draft", draft, "--work-dir", workDir)
				if err == nil || exitCodeFor(err) != 1 || !strings.Contains(err.Error(), "--ticket-id") ||
					!strings.Contains(err.Error(), modelDraft) {
					t.Fatalf("error = %v (exit %d), want the exit-1 --ticket-id refusal naming %s", err, exitCodeFor(err), modelDraft)
				}
				requireNoExternalCalls(t, trapLog)
				requireBytes(t, modelDraft, []byte(modelDraftBody))
				if names := dirNames(t, workDir); !slices.Equal(names, []string{"draft-v1.mdx"}) {
					t.Fatalf("work dir holds %v, want only the draft", names)
				}
			})
		}
	}
}
