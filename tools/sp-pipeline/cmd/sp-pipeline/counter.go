package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/counter"
)

// counterReport is the JSON shape emitted by `gp-pipeline counter --json`.
type counterReport struct {
	OK        bool   `json:"ok"`
	Operation string `json:"operation"` // "next" | "bump" | "read"
	Prefix    string `json:"prefix,omitempty"`
	Value     int    `json:"value"`
	TicketID  string `json:"ticketId,omitempty"`
	Error     string `json:"error,omitempty"`
}

func newCounterCmd(state *rootState) *cobra.Command {
	root := &cobra.Command{
		Use:   "counter",
		Short: "Read / bump the ticket counter",
		Long: `counter reads from and safely mutates scripts/article-counter.json.

It replaces the "flock + jq + mv" dance in scripts/gp-pipeline.sh with a
Go-native atomic bump backed by syscall.Flock on /tmp/gu-log-counter.lock.

Two subcommands:

  gp-pipeline counter next --prefix GP
      Print the value that WILL be allocated next, without mutating the
      file. Useful for dry runs and dashboards.

  gp-pipeline counter bump --prefix GP
      Atomically advance the counter by 1 and print the value that WAS
      allocated (the ticketId the caller should use for their new post).
      This is the write-side primitive that the deploy step uses.`,
	}

	var prefix string

	nextCmd := &cobra.Command{
		Use:   "next",
		Short: "Print the next value without bumping",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCounterNext(state, prefix)
		},
	}
	nextCmd.Flags().StringVar(&prefix, "prefix", "GP", "ticket prefix (SP / CP / SD / Lv)")

	var bumpPrefix string
	bumpCmd := &cobra.Command{
		Use:   "bump",
		Short: "Atomically bump the counter and print the allocated value",
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runCounterBump(state, bumpPrefix)
		},
	}
	bumpCmd.Flags().StringVar(&bumpPrefix, "prefix", "GP", "ticket prefix (SP / CP / SD / Lv)")

	root.AddCommand(nextCmd, bumpCmd)
	return root
}

func runCounterNext(state *rootState, prefix string) error {
	c := counter.New(state.cfg.CounterFile, "")
	v, err := c.Next(prefix)
	if err != nil {
		emitCounterReport(state, counterReport{
			OK:        false,
			Operation: "next",
			Prefix:    prefix,
			Error:     err.Error(),
		})
		return err
	}
	emitCounterReport(state, counterReport{
		OK:        true,
		Operation: "next",
		Prefix:    prefix,
		Value:     v,
		TicketID:  fmt.Sprintf("%s-%d", prefix, v),
	})
	return nil
}

func runCounterBump(state *rootState, prefix string) error {
	c := counter.New(state.cfg.CounterFile, "")
	allocated, err := c.Bump(prefix)
	if err != nil {
		emitCounterReport(state, counterReport{
			OK:        false,
			Operation: "bump",
			Prefix:    prefix,
			Error:     err.Error(),
		})
		return err
	}
	state.log.OK("counter: allocated %s-%d (next is now %d)", prefix, allocated, allocated+1)
	emitCounterReport(state, counterReport{
		OK:        true,
		Operation: "bump",
		Prefix:    prefix,
		Value:     allocated,
		TicketID:  fmt.Sprintf("%s-%d", prefix, allocated),
	})
	return nil
}

func emitCounterReport(state *rootState, r counterReport) {
	if state.json {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(r)
		return
	}
	if r.OK {
		fmt.Println(r.TicketID)
	}
}
