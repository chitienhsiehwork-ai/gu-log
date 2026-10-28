package main

import (
	"strings"
	"testing"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/pipeline"
)

// TestSeriesHelpMatchesWhatEachCommandServes: the writing commands offer only
// the series the pipeline writes, while the commands Lv still uses keep
// offering Lv. GP is offered where it is served (counter next, dedup); counter
// bump and deploy name scripts/reclassify-post.mjs as the only way to a GP
// number instead.
func TestSeriesHelpMatchesWhatEachCommandServes(t *testing.T) {
	root := buildRoot()
	for _, tc := range []struct {
		path        []string
		flag        string
		wantLv      bool
		wantGP      bool
		wantGPRoute bool
	}{
		{path: []string{"write"}, flag: "prefix"},
		{path: []string{"run"}, flag: "prefix"},
		{path: []string{"counter", "bump"}, flag: "prefix", wantLv: true, wantGPRoute: true},
		{path: []string{"counter", "next"}, flag: "prefix", wantLv: true, wantGP: true},
		{path: []string{"dedup"}, flag: "series", wantLv: true, wantGP: true},
		{path: []string{"deploy"}, flag: "prefix", wantLv: true, wantGPRoute: true},
	} {
		t.Run(strings.Join(tc.path, " "), func(t *testing.T) {
			cmd, _, err := root.Find(tc.path)
			if err != nil {
				t.Fatal(err)
			}
			flag := cmd.Flags().Lookup(tc.flag)
			if flag == nil {
				t.Fatalf("no --%s flag", tc.flag)
			}
			for _, series := range pipeline.AuthorablePrefixes {
				if !strings.Contains(flag.Usage, series) {
					t.Errorf("--%s usage %q does not list %s", tc.flag, flag.Usage, series)
				}
			}
			if got := strings.Contains(flag.Usage, "Lv"); got != tc.wantLv {
				t.Errorf("--%s usage %q lists Lv = %v, want %v", tc.flag, flag.Usage, got, tc.wantLv)
			}
			usage := strings.ReplaceAll(flag.Usage, "GP numbers come only from "+pipeline.ReclassifyScript, "")
			if got := strings.Contains(usage, "GP"); got != tc.wantGP {
				t.Errorf("--%s usage %q lists GP = %v, want %v", tc.flag, flag.Usage, got, tc.wantGP)
			}
			if got := strings.Contains(flag.Usage, pipeline.ReclassifyScript); got != tc.wantGPRoute {
				t.Errorf("--%s usage %q names %s = %v, want %v", tc.flag, flag.Usage, pipeline.ReclassifyScript, got, tc.wantGPRoute)
			}
		})
	}
	for _, name := range []string{"write", "review", "refine"} {
		cmd, _, err := root.Find([]string{name})
		if err != nil {
			t.Fatal(err)
		}
		for _, series := range []string{"Lv", "GP"} {
			if strings.Contains(cmd.Long, series) {
				t.Errorf("%s --help still names %s among the series it writes", name, series)
			}
		}
	}
	for _, path := range [][]string{{"counter"}, {"deploy"}, {"run"}} {
		cmd, _, err := root.Find(path)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(cmd.Long, pipeline.ReclassifyScript) {
			t.Errorf("%v --help does not say GP comes only from %s", path, pipeline.ReclassifyScript)
		}
	}
}
