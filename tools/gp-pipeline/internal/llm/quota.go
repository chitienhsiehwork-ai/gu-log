package llm

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	QuotaTierUnknown = "unknown"
	QuotaTierSession = "session"
	QuotaTierWeekly  = "weekly"
)

// QuotaPolicy controls how dispatcher quota handling waits or suspends.
type QuotaPolicy struct {
	MaxWait                  time.Duration
	WaitBuffer               time.Duration
	MaxWaits                 int
	AllowClaudeJudgeFallback bool
}

// QuotaAction is the decision made after a quota-classified provider failure.
type QuotaAction struct {
	Provider     string
	Tier         string
	ResetAt      time.Time
	WaitDuration time.Duration
	Wait         bool
	Reason       string
	Err          error
}

func DefaultQuotaPolicy() QuotaPolicy {
	return QuotaPolicy{
		MaxWait:    durationFromEnv("GP_QUOTA_MAX_WAIT", 6*time.Hour),
		WaitBuffer: durationFromEnv("GP_QUOTA_WAIT_BUFFER", 120*time.Second),
		MaxWaits:   intFromEnv("GP_QUOTA_MAX_WAITS", 3),
	}
}

func IsQuotaError(provider string, err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(provider + " " + err.Error())
	patterns := []string{
		"usage limit",
		"rate limit",
		"rate-limit",
		"too many requests",
		"quota exceeded",
		"quota exhausted",
		"resource exhausted",
		"try again later",
		"limit reached",
		"temporarily limited",
		"429",
	}
	for _, p := range patterns {
		if strings.Contains(text, p) {
			return true
		}
	}
	return false
}

func DecideQuotaAction(provider string, err error, policy QuotaPolicy, previousWaits int) QuotaAction {
	now := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), durationFromEnv("GP_CODEXBAR_TIMEOUT", 20*time.Second))
	defer cancel()
	usage, parseErr := QueryQuotaUsage(ctx, provider)
	action := QuotaAction{
		Provider: provider,
		Tier:     QuotaTierUnknown,
		Reason:   "codexbar unavailable or unparseable",
		Err:      err,
	}
	if parseErr == nil {
		action.Tier = usage.BlockingTier()
		action.ResetAt = usage.ResetAt(action.Tier, now)
		action.Reason = usage.Detail(action.Tier)
	}

	if action.Tier == QuotaTierSession && !action.ResetAt.IsZero() {
		wait := time.Until(action.ResetAt) + policy.WaitBuffer
		if wait < policy.WaitBuffer {
			wait = policy.WaitBuffer
		}
		if wait <= policy.MaxWait && previousWaits < policy.MaxWaits {
			action.Wait = true
			action.WaitDuration = wait
			return action
		}
	}
	return action
}

func (a QuotaAction) SuspendError() error {
	reset := "unknown"
	if !a.ResetAt.IsZero() {
		reset = a.ResetAt.Format(time.RFC3339)
	}
	return &QuotaSuspendError{
		Provider: a.Provider,
		Tier:     a.Tier,
		ResetAt:  reset,
		Reason:   a.Reason,
		Err:      a.Err,
	}
}

// QuotaSuspendError is returned when the safe action is to stop and let a
// later run resume from the work dir instead of sleeping for a long window.
type QuotaSuspendError struct {
	Provider string
	Tier     string
	ResetAt  string
	Reason   string
	Err      error
}

func (e *QuotaSuspendError) Error() string {
	return fmt.Sprintf("quota exhausted for %s (%s; reset=%s): %s. Resume with the same gp-pipeline command and --work-dir <this-work-dir> / --from-step <failed-step>", e.Provider, e.Tier, e.ResetAt, e.Reason)
}

func (e *QuotaSuspendError) Unwrap() error { return e.Err }

type QuotaUsage struct {
	Provider             string
	SessionPercentLeft   *int
	SessionResetDuration time.Duration
	WeeklyPercentLeft    *int
	WeeklyResetDuration  time.Duration
	Raw                  string
}

func QueryQuotaUsage(ctx context.Context, provider string) (QuotaUsage, error) {
	cmd := exec.CommandContext(ctx, "codexbar", "usage")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return QuotaUsage{}, fmt.Errorf("codexbar usage: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return ParseQuotaUsage(provider, string(out))
}

func ParseQuotaUsage(provider, output string) (QuotaUsage, error) {
	block := extractProviderBlock(provider, output)
	if strings.TrimSpace(block) == "" {
		return QuotaUsage{}, fmt.Errorf("provider block %q not found", provider)
	}
	u := QuotaUsage{Provider: provider, Raw: block}
	currentSection := ""
	for _, line := range strings.Split(block, "\n") {
		trimmed := strings.TrimSpace(line)
		if isSessionQuotaHeader(trimmed) {
			currentSection = QuotaTierSession
			u.SessionPercentLeft = parsePercentLeft(line)
			continue
		}
		if isWeeklyQuotaHeader(trimmed) {
			currentSection = QuotaTierWeekly
			u.WeeklyPercentLeft = parsePercentLeft(line)
			continue
		}
		if isResetLine(trimmed) {
			reset := parseResetDuration(line)
			switch currentSection {
			case QuotaTierSession:
				u.SessionResetDuration = reset
			case QuotaTierWeekly:
				u.WeeklyResetDuration = reset
			}
		}
	}
	if u.SessionPercentLeft == nil && u.WeeklyPercentLeft == nil {
		return QuotaUsage{}, fmt.Errorf("no quota lines parsed for %q", provider)
	}
	return u, nil
}

func (u QuotaUsage) BlockingTier() string {
	if u.WeeklyPercentLeft != nil && *u.WeeklyPercentLeft <= 0 {
		return QuotaTierWeekly
	}
	if u.SessionPercentLeft != nil && *u.SessionPercentLeft <= 0 {
		return QuotaTierSession
	}
	if u.SessionPercentLeft != nil {
		return QuotaTierSession
	}
	if u.WeeklyPercentLeft != nil {
		return QuotaTierWeekly
	}
	return QuotaTierUnknown
}

func (u QuotaUsage) ResetAt(tier string, now time.Time) time.Time {
	switch tier {
	case QuotaTierSession:
		if u.SessionResetDuration > 0 {
			return now.Add(u.SessionResetDuration)
		}
	case QuotaTierWeekly:
		if u.WeeklyResetDuration > 0 {
			return now.Add(u.WeeklyResetDuration)
		}
	}
	return time.Time{}
}

func (u QuotaUsage) Detail(tier string) string {
	switch tier {
	case QuotaTierSession:
		return fmt.Sprintf("session quota left=%s reset_in=%s", percentString(u.SessionPercentLeft), u.SessionResetDuration)
	case QuotaTierWeekly:
		return fmt.Sprintf("weekly quota left=%s reset_in=%s", percentString(u.WeeklyPercentLeft), u.WeeklyResetDuration)
	default:
		return "quota tier could not be determined"
	}
}

func NotifyQuotaPause(action QuotaAction) {
	msg := fmt.Sprintf("%s quota exhausted (%s); %s", action.Provider, action.Tier, action.Reason)
	quotaLog(msg)
	desktopNotify("gp-pipeline", msg)
}

func NotifyQuotaResume(provider string, policy QuotaPolicy) {
	_ = policy
	msg := fmt.Sprintf("%s quota wait elapsed; retrying", provider)
	quotaLog(msg)
	desktopNotify("gp-pipeline", msg)
}

func quotaLog(msg string) {
	fmt.Fprintf(os.Stderr, "[%s] gp-pipeline quota: %s\n", time.Now().Format(time.RFC3339), msg)
}

func desktopNotify(title, msg string) {
	_ = exec.Command("osascript", "-e", fmt.Sprintf(`display notification %q with title %q`, msg, title)).Run()
}

func extractProviderBlock(provider, output string) string {
	needle := "codex"
	if strings.Contains(strings.ToLower(provider), "claude") {
		needle = "claude"
	}
	var b strings.Builder
	inBlock := false
	for _, line := range strings.Split(output, "\n") {
		lower := strings.ToLower(line)
		isHeader := strings.Contains(lower, "codex") || strings.Contains(lower, "claude")
		if strings.Contains(lower, needle) {
			inBlock = true
		} else if inBlock && isHeader {
			break
		}
		if inBlock {
			b.WriteString(line)
			b.WriteByte('\n')
		}
	}
	if b.Len() == 0 {
		return output
	}
	return b.String()
}

func parsePercentLeft(line string) *int {
	re := regexp.MustCompile(`(?i)(\d+)\s*%\s*left`)
	m := re.FindStringSubmatch(line)
	if len(m) != 2 {
		return nil
	}
	v, err := strconv.Atoi(m[1])
	if err != nil {
		return nil
	}
	return &v
}

func isSessionQuotaHeader(line string) bool {
	return regexp.MustCompile(`(?i)^session\b`).MatchString(line)
}

func isWeeklyQuotaHeader(line string) bool {
	return regexp.MustCompile(`(?i)^weekly\b`).MatchString(line)
}

func isResetLine(line string) bool {
	return regexp.MustCompile(`(?i)^resets?\s+in\b`).MatchString(line)
}

func parseResetDuration(line string) time.Duration {
	re := regexp.MustCompile(`(?i)resets?\s+in\s+([0-9dhms[:space:]]+)`)
	m := re.FindStringSubmatch(line)
	if len(m) != 2 {
		return 0
	}
	return parseLooseDuration(m[1])
}

func parseLooseDuration(s string) time.Duration {
	re := regexp.MustCompile(`(?i)(\d+)\s*([dhms])`)
	var total time.Duration
	for _, m := range re.FindAllStringSubmatch(s, -1) {
		v, _ := strconv.Atoi(m[1])
		switch strings.ToLower(m[2]) {
		case "d":
			total += time.Duration(v) * 24 * time.Hour
		case "h":
			total += time.Duration(v) * time.Hour
		case "m":
			total += time.Duration(v) * time.Minute
		case "s":
			total += time.Duration(v) * time.Second
		}
	}
	return total
}

func percentString(v *int) string {
	if v == nil {
		return "unknown"
	}
	return fmt.Sprintf("%d%%", *v)
}

func durationFromEnv(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	if d, err := time.ParseDuration(raw); err == nil {
		return d
	}
	return fallback
}

func intFromEnv(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}
