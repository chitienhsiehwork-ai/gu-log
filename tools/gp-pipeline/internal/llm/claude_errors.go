package llm

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Claude CLI failure classes (openspec claude-prose-writing-runtime). Quota and
// transient failures recover by waiting; login and config failures need a
// person (log in, fix the plan or admin settings, or fix the model pin). The
// patterns follow the messages the installed Claude Code CLI prints, including
// its own list of usage-limit prefixes; testdata/claude-cli-errors.json keeps
// those messages as the regression samples, and scripts/tribunal-helpers.sh
// classifies the same samples the same way.
const (
	ClaudeFailureQuota     = "quota"
	ClaudeFailureLogin     = "login"
	ClaudeFailureConfig    = "config"
	ClaudeFailureTransient = "transient"
)

var (
	claudeConfigRe    = regexp.MustCompile(`(?i)your seat type doesn.t include|usage allocation has been disabled|group.s usage limit is set to|requires usage credits|this service is disabled for your org|your org(?:anization)? is out of usage|issue with the selected model|isn.t available for your account|model '[^']*' not found`)
	claudeLoginRe     = regexp.MustCompile(`(?i)not logged in|run /login|login expired|oauth token (?:has )?(?:expired|revoked)|invalid api key|invalid auth token|authentication required|authentication_error|session (?:has )?expired`)
	claudeQuotaRe     = regexp.MustCompile(`(?i)you.ve hit your |you.ve reached your |you.re out of (?:extra )?usage|usage limit reached|rate_limit_error|(?:^|[^0-9])429(?:[^0-9]|$)`)
	claudeTransientRe = regexp.MustCompile(`(?i)overloaded|(?:^|[^0-9])529(?:[^0-9]|$)|high load|temporarily limiting requests|timed out|connection to the api was lost|connection error|econnreset|etimedout|socket hang up|server-side issue|could not refresh your login|temporary network issue`)
	claudeResetRe     = regexp.MustCompile(`(?i)\bresets\s+(?:([a-z]{3})\s+(\d{1,2}),\s+(?:(\d{4}),\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?`)
)

// ClassifyClaudeFailure returns the ClaudeFailure* class of a Claude CLI failure
// message, or "" for any other failure. A message that asks for a person wins
// over one that only asks to wait.
func ClassifyClaudeFailure(text string) string {
	switch {
	case claudeConfigRe.MatchString(text):
		return ClaudeFailureConfig
	case claudeLoginRe.MatchString(text):
		return ClaudeFailureLogin
	case claudeQuotaRe.MatchString(text):
		return ClaudeFailureQuota
	case claudeTransientRe.MatchString(text):
		return ClaudeFailureTransient
	default:
		return ""
	}
}

// ClaudeResetTime parses the reset time a Claude usage-limit message reports,
// such as "resets 5pm (UTC)" or "resets Sep 29, 10:30am (Asia/Taipei)". The CLI
// prints a time of day for resets within a day and a date otherwise, so a
// time of day already well behind now means tomorrow. ok is false when the
// message carries no parseable reset.
func ClaudeResetTime(text string, now time.Time) (time.Time, bool) {
	m := claudeResetRe.FindStringSubmatch(text)
	if m == nil {
		return time.Time{}, false
	}
	loc := time.Local
	if name := strings.TrimSpace(m[7]); name != "" {
		var err error
		if loc, err = time.LoadLocation(name); err != nil {
			return time.Time{}, false
		}
	}
	hour, _ := strconv.Atoi(m[4])
	minute := 0
	if m[5] != "" {
		minute, _ = strconv.Atoi(m[5])
	}
	if hour < 1 || hour > 12 || minute > 59 {
		return time.Time{}, false
	}
	hour %= 12
	if strings.EqualFold(m[6], "pm") {
		hour += 12
	}
	local := now.In(loc)
	const skew = 30 * time.Minute
	if m[1] == "" {
		reset := time.Date(local.Year(), local.Month(), local.Day(), hour, minute, 0, 0, loc)
		if now.Sub(reset) > skew {
			reset = reset.AddDate(0, 0, 1)
		}
		return reset, true
	}
	month, ok := claudeMonths[strings.ToLower(m[1])]
	day, _ := strconv.Atoi(m[2])
	if !ok || day < 1 || day > 31 {
		return time.Time{}, false
	}
	year := local.Year()
	if m[3] != "" {
		year, _ = strconv.Atoi(m[3])
	}
	reset := time.Date(year, month, day, hour, minute, 0, 0, loc)
	if m[3] == "" && now.Sub(reset) > skew {
		reset = reset.AddDate(1, 0, 0)
	}
	return reset, true
}

var claudeMonths = map[string]time.Month{
	"jan": time.January, "feb": time.February, "mar": time.March,
	"apr": time.April, "may": time.May, "jun": time.June,
	"jul": time.July, "aug": time.August, "sep": time.September,
	"oct": time.October, "nov": time.November, "dec": time.December,
}

func isClaudeProviderName(name string) bool {
	return strings.HasPrefix(name, "claude") || strings.HasPrefix(name, "fake-claude")
}
