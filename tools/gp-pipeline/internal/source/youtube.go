package source

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/chitienhsiehwork-ai/gu-log/tools/gp-pipeline/internal/runner"
)

const (
	YouTubeAvailabilityComplete     = "complete"
	YouTubeAvailabilityMetadataOnly = "metadata_only"
	YouTubeAvailabilityUnavailable  = "unavailable"
	YouTubeAvailabilityLive         = "live"
	YouTubeAvailabilityUpcoming     = "upcoming"

	YouTubeFailureDependencyMissing = "dependency_missing"
	YouTubeFailureMetadataFailed    = "metadata_failed"
	YouTubeFailureMetadataInvalid   = "metadata_invalid"
	YouTubeFailureVideoIDMismatch   = "video_id_mismatch"
	YouTubeFailureCaptionMissing    = "caption_unavailable"
	YouTubeFailureCaptionFailed     = "caption_download_failed"
	YouTubeFailureTranscriptShort   = "transcript_too_short"
	YouTubeFailureDurationLimit     = "duration_limit_exceeded"
	YouTubeFailureRawBytesLimit     = "raw_vtt_limit_exceeded"
	YouTubeFailureTokenLimit        = "token_limit_exceeded"
	YouTubeFailureLive              = "live"
	YouTubeFailureUpcoming          = "upcoming"
	YouTubeFailureTimeout           = "timeout"
	YouTubeFailureInterrupted       = "interrupted"
)

var youtubeVideoIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// PreferredCaptionLanguages is the deterministic language order used within
// each subtitle provenance tier. Manual captions always win over automatic
// captions; languages not listed here follow in lexical order.
var PreferredCaptionLanguages = []string{
	"en",
	"en-US",
	"en-GB",
	"zh-TW",
	"zh-Hant",
	"zh-Hans",
	"zh",
}

// CandidateLimits centralizes the staged source-safety limits. The gates run
// in field order: duration before subtitle download, raw bytes before VTT is
// loaded into memory, then bounded token estimation before downstream work.
type CandidateLimits struct {
	MaxDurationSeconds int   `json:"maxDurationSeconds"`
	MaxRawVTTBytes     int64 `json:"maxRawVttBytes"`
	MaxEstimatedTokens int   `json:"maxEstimatedTokens"`
	MinTranscriptWords int   `json:"minTranscriptWords"`
}

func DefaultCandidateLimits() CandidateLimits {
	return CandidateLimits{
		MaxDurationSeconds: 4 * 60 * 60,
		MaxRawVTTBytes:     10 * 1024 * 1024,
		MaxEstimatedTokens: 120_000,
		MinTranscriptWords: 200,
	}
}

type YouTubeURL struct {
	Raw          string
	CanonicalURL string
	VideoID      string
}

// IsYouTubeHostURL reports whether raw uses one of the allowlisted YouTube
// hosts. It deliberately says nothing about whether the path is a single
// video; callers use ParseYouTubeURL for that stricter decision.
func IsYouTubeHostURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	switch strings.ToLower(parsed.Hostname()) {
	case "youtube.com", "www.youtube.com", "youtu.be":
		return true
	default:
		return false
	}
}

func RequireYTDLP() error {
	if _, err := runner.LookPath("yt-dlp"); err != nil {
		return fmt.Errorf("%s: yt-dlp is required for YouTube source capture", YouTubeFailureDependencyMissing)
	}
	return nil
}

// ParseYouTubeURL accepts one allowlisted, single-video watch/shorts/youtu.be
// URL and returns the stable watch-form identity. Redirect, collection,
// channel, search, userinfo, ports, and playlist-only shapes are rejected
// before yt-dlp can run.
func ParseYouTubeURL(raw string) (*YouTubeURL, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("invalid YouTube URL: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("invalid YouTube URL: only http(s) is supported")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("invalid YouTube URL: userinfo is not allowed")
	}
	if parsed.Port() != "" {
		return nil, fmt.Errorf("invalid YouTube URL: explicit ports are not allowed")
	}

	host := strings.ToLower(parsed.Hostname())
	var videoID string
	switch host {
	case "youtube.com", "www.youtube.com":
		cleanPath := strings.TrimSuffix(parsed.EscapedPath(), "/")
		switch {
		case cleanPath == "/watch":
			values := parsed.Query()["v"]
			if len(values) != 1 {
				return nil, fmt.Errorf("invalid YouTube URL: watch URL requires exactly one video id")
			}
			videoID = values[0]
		case strings.HasPrefix(cleanPath, "/shorts/"):
			parts := strings.Split(strings.TrimPrefix(cleanPath, "/shorts/"), "/")
			if len(parts) != 1 {
				return nil, fmt.Errorf("invalid YouTube URL: shorts URL must identify one video")
			}
			decoded, decodeErr := url.PathUnescape(parts[0])
			if decodeErr != nil {
				return nil, fmt.Errorf("invalid YouTube URL: malformed video id")
			}
			videoID = decoded
		default:
			return nil, fmt.Errorf("invalid YouTube URL: expected /watch?v=<id> or /shorts/<id>")
		}
	case "youtu.be":
		cleanPath := strings.Trim(parsed.EscapedPath(), "/")
		parts := strings.Split(cleanPath, "/")
		if cleanPath == "" || len(parts) != 1 {
			return nil, fmt.Errorf("invalid YouTube URL: youtu.be URL must identify one video")
		}
		decoded, decodeErr := url.PathUnescape(parts[0])
		if decodeErr != nil {
			return nil, fmt.Errorf("invalid YouTube URL: malformed video id")
		}
		videoID = decoded
	default:
		return nil, fmt.Errorf("invalid YouTube URL: host %q is not allowlisted", host)
	}
	if !youtubeVideoIDPattern.MatchString(videoID) {
		return nil, fmt.Errorf("invalid YouTube URL: video id must be 11 URL-safe characters")
	}
	return &YouTubeURL{
		Raw:          trimmed,
		CanonicalURL: "https://www.youtube.com/watch?v=" + videoID,
		VideoID:      videoID,
	}, nil
}

type YouTubeMetadata struct {
	Title           *string  `json:"title"`
	Channel         *string  `json:"channel"`
	UploadDate      *string  `json:"uploadDate"`
	DurationSeconds *float64 `json:"durationSeconds"`
}

type CaptionEvidence struct {
	Language        string          `json:"language"`
	Kind            string          `json:"kind"`
	RawVTTPath      string          `json:"-"`
	TranscriptPath  string          `json:"-"`
	RawBytes        int64           `json:"rawBytes"`
	EstimatedTokens int             `json:"estimatedTokens"`
	TranscriptWords int             `json:"transcriptWords"`
	Coverage        CaptionCoverage `json:"coverage"`
}

type CaptionCoverage struct {
	CueCount       int      `json:"cueCount"`
	CoveredSeconds float64  `json:"coveredSeconds"`
	Ratio          *float64 `json:"ratio"`
}

type LimitEvidence struct {
	Limits             CandidateLimits `json:"limits"`
	DurationSeconds    *float64        `json:"durationSeconds"`
	RawVTTBytes        *int64          `json:"rawVttBytes"`
	EstimatedTokens    *int            `json:"estimatedTokens"`
	TranscriptWords    *int            `json:"transcriptWords"`
	TriggeredLimitKeys []string        `json:"triggeredLimitKeys"`
}

type YouTubeFailure struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
	Technical bool   `json:"-"`
}

// YouTubeCapture is intentionally a partial result: metadata remains present
// when caption acquisition is unavailable, unsafe, or technically fails.
type YouTubeCapture struct {
	URL            YouTubeURL
	Metadata       YouTubeMetadata
	Availability   string
	WriteEligible  bool
	Caption        *CaptionEvidence
	SourcePath     string
	Warnings       []string
	Limits         LimitEvidence
	Failure        *YouTubeFailure
	MetadataLoaded bool
}

type youtubeMetadataJSON struct {
	ID                *string                           `json:"id"`
	Title             *string                           `json:"title"`
	Channel           *string                           `json:"channel"`
	Uploader          *string                           `json:"uploader"`
	UploadDate        *string                           `json:"upload_date"`
	Duration          *float64                          `json:"duration"`
	LiveStatus        *string                           `json:"live_status"`
	IsLive            bool                              `json:"is_live"`
	Subtitles         map[string][]youtubeCaptionFormat `json:"subtitles"`
	AutomaticCaptions map[string][]youtubeCaptionFormat `json:"automatic_captions"`
}

type youtubeCaptionFormat struct {
	Ext string `json:"ext"`
}

type captionSelection struct {
	Language string
	Kind     string
}

func CaptureYouTube(ctx context.Context, rawURL string, opts FetchOptions, limits CandidateLimits) *YouTubeCapture {
	parsed, parseErr := ParseYouTubeURL(rawURL)
	if parseErr != nil {
		return &YouTubeCapture{
			Availability: YouTubeAvailabilityUnavailable,
			Limits: LimitEvidence{
				Limits:             limits,
				TriggeredLimitKeys: []string{},
			},
			Failure: &YouTubeFailure{
				Code:    "invalid_url",
				Message: parseErr.Error(),
			},
		}
	}
	result := &YouTubeCapture{
		URL:          *parsed,
		Availability: YouTubeAvailabilityUnavailable,
		Limits: LimitEvidence{
			Limits:             limits,
			TriggeredLimitKeys: []string{},
		},
	}
	if opts.WorkDir == "" {
		result.Failure = technicalFailure("workdir_unavailable", "YouTube WorkDir is required", false)
		return result
	}
	if err := os.MkdirAll(opts.WorkDir, 0o755); err != nil {
		result.Failure = technicalFailure("workdir_unavailable", fmt.Sprintf("create workdir: %v", err), false)
		return result
	}
	removeYouTubeArtifacts(opts.WorkDir)

	if err := RequireYTDLP(); err != nil {
		result.Failure = technicalFailure(
			YouTubeFailureDependencyMissing,
			err.Error(),
			true,
		)
		return result
	}

	metaRes, err := runner.Run(ctx, "yt-dlp",
		"-J",
		"--skip-download",
		"--no-playlist",
		parsed.CanonicalURL,
	)
	if err != nil {
		result.Failure = contextOrTechnicalFailure(ctx, YouTubeFailureMetadataFailed, "yt-dlp metadata: "+err.Error())
		return result
	}
	var rawMeta youtubeMetadataJSON
	if err := json.Unmarshal(metaRes.Stdout, &rawMeta); err != nil {
		result.Failure = technicalFailure(YouTubeFailureMetadataInvalid, "parse yt-dlp metadata: "+err.Error(), true)
		return result
	}
	result.MetadataLoaded = true
	result.Metadata = normalizeYouTubeMetadata(rawMeta)
	result.Limits.DurationSeconds = result.Metadata.DurationSeconds
	if observedID := nonEmptyString(rawMeta.ID); observedID != nil && *observedID != parsed.VideoID {
		result.Failure = technicalFailure(
			YouTubeFailureVideoIDMismatch,
			fmt.Sprintf("yt-dlp returned video id %q for requested id %q", *observedID, parsed.VideoID),
			false,
		)
		return result
	}

	if liveState := classifyLiveState(rawMeta); liveState != "" {
		result.Availability = liveState
		code := YouTubeFailureLive
		message := "video is currently live"
		if liveState == YouTubeAvailabilityUpcoming {
			code = YouTubeFailureUpcoming
			message = "video has not started yet"
		}
		result.Failure = &YouTubeFailure{Code: code, Message: message, Retryable: true}
		result.Warnings = append(result.Warnings, message)
		return result
	}
	if duration := result.Metadata.DurationSeconds; duration != nil &&
		limits.MaxDurationSeconds > 0 && *duration > float64(limits.MaxDurationSeconds) {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Limits.TriggeredLimitKeys = append(result.Limits.TriggeredLimitKeys, "maxDurationSeconds")
		result.Failure = &YouTubeFailure{
			Code:      YouTubeFailureDurationLimit,
			Message:   fmt.Sprintf("duration %.3f exceeds limit %d", *duration, limits.MaxDurationSeconds),
			Retryable: false,
		}
		result.Warnings = append(result.Warnings, result.Failure.Message)
		return result
	}

	selection := chooseCaption(rawMeta.Subtitles, rawMeta.AutomaticCaptions)
	if selection == nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = &YouTubeFailure{
			Code:      YouTubeFailureCaptionMissing,
			Message:   "no caption track is available",
			Retryable: false,
		}
		result.Warnings = append(result.Warnings, result.Failure.Message)
		return result
	}

	rawPath, downloadFailure := downloadCaption(ctx, parsed.CanonicalURL, opts.WorkDir, *selection)
	if downloadFailure != nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = downloadFailure
		result.Warnings = append(result.Warnings, downloadFailure.Message)
		return result
	}
	info, err := os.Stat(rawPath)
	if err != nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = technicalFailure(YouTubeFailureCaptionFailed, "stat downloaded caption: "+err.Error(), true)
		return result
	}
	rawBytes := info.Size()
	result.Limits.RawVTTBytes = &rawBytes
	if limits.MaxRawVTTBytes > 0 && rawBytes > limits.MaxRawVTTBytes {
		_ = os.Remove(rawPath)
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Limits.TriggeredLimitKeys = append(result.Limits.TriggeredLimitKeys, "maxRawVttBytes")
		result.Failure = &YouTubeFailure{
			Code:      YouTubeFailureRawBytesLimit,
			Message:   fmt.Sprintf("raw VTT bytes %d exceed limit %d", rawBytes, limits.MaxRawVTTBytes),
			Retryable: false,
		}
		result.Warnings = append(result.Warnings, result.Failure.Message)
		return result
	}

	rawVTT, err := os.ReadFile(rawPath)
	if err != nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = technicalFailure(YouTubeFailureCaptionFailed, "read downloaded caption: "+err.Error(), true)
		return result
	}
	transcript := timestampedTranscript(rawVTT)
	words := len(strings.Fields(plainTranscriptText(transcript)))
	estimatedTokens := estimateTokens(plainTranscriptText(transcript))
	result.Limits.TranscriptWords = &words
	result.Limits.EstimatedTokens = &estimatedTokens

	transcriptPath := filepath.Join(opts.WorkDir, "youtube-transcript.txt")
	if err := os.WriteFile(transcriptPath, []byte(transcript+"\n"), 0o644); err != nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = technicalFailure(YouTubeFailureCaptionFailed, "write timestamped transcript: "+err.Error(), true)
		return result
	}
	result.Caption = &CaptionEvidence{
		Language:        selection.Language,
		Kind:            selection.Kind,
		RawVTTPath:      rawPath,
		TranscriptPath:  transcriptPath,
		RawBytes:        rawBytes,
		EstimatedTokens: estimatedTokens,
		TranscriptWords: words,
		Coverage:        calculateCaptionCoverage(rawVTT, result.Metadata.DurationSeconds),
	}

	if limits.MaxEstimatedTokens > 0 && estimatedTokens > limits.MaxEstimatedTokens {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Limits.TriggeredLimitKeys = append(result.Limits.TriggeredLimitKeys, "maxEstimatedTokens")
		result.Failure = &YouTubeFailure{
			Code:      YouTubeFailureTokenLimit,
			Message:   fmt.Sprintf("estimated tokens %d exceed limit %d", estimatedTokens, limits.MaxEstimatedTokens),
			Retryable: false,
		}
		result.Warnings = append(result.Warnings, result.Failure.Message)
		return result
	}
	if limits.MinTranscriptWords > 0 && words < limits.MinTranscriptWords {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Limits.TriggeredLimitKeys = append(result.Limits.TriggeredLimitKeys, "minTranscriptWords")
		result.Failure = &YouTubeFailure{
			Code:      YouTubeFailureTranscriptShort,
			Message:   fmt.Sprintf("transcript words %d are below minimum %d", words, limits.MinTranscriptWords),
			Retryable: false,
		}
		result.Warnings = append(result.Warnings, result.Failure.Message)
		return result
	}

	sourcePath, err := writeYouTubeSourceCapture(opts.WorkDir, result, transcript)
	if err != nil {
		result.Availability = YouTubeAvailabilityMetadataOnly
		result.Failure = technicalFailure(YouTubeFailureCaptionFailed, "write source capture: "+err.Error(), true)
		return result
	}
	result.SourcePath = sourcePath
	result.Availability = YouTubeAvailabilityComplete
	result.WriteEligible = true
	return result
}

// FetchYouTube adapts the structured result to the existing canonical source
// interface. Any non-complete result stops the canonical run; technical
// failures map to fetch failure, while reviewable incompleteness maps to source
// validation failure. Neither path can fall back to generic HTML.
func FetchYouTube(ctx context.Context, urlStr string, opts FetchOptions) (*FetchResult, error) {
	capture := CaptureYouTube(ctx, urlStr, opts, DefaultCandidateLimits())
	if capture.Failure != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, context.DeadlineExceeded
		}
		if capture.Failure.Technical {
			return nil, fmt.Errorf("fetchyoutube: %s: %s", capture.Failure.Code, capture.Failure.Message)
		}
		return nil, &ValidationError{
			Reason: fmt.Sprintf("fetchyoutube: %s: %s", capture.Failure.Code, capture.Failure.Message),
		}
	}
	if !capture.WriteEligible || capture.SourcePath == "" {
		return nil, &ValidationError{Reason: "fetchyoutube: incomplete transcript"}
	}

	handle := ""
	if capture.Metadata.Channel != nil {
		handle = "@" + sanitizeYouTubeHandle(*capture.Metadata.Channel)
	}
	date := ""
	if capture.Metadata.UploadDate != nil {
		date = *capture.Metadata.UploadDate
	}
	info, err := os.Stat(capture.SourcePath)
	if err != nil {
		return nil, fmt.Errorf("fetchyoutube: stat source capture: %w", err)
	}
	return &FetchResult{
		Path:       capture.SourcePath,
		Handle:     handle,
		Date:       date,
		FetchedVia: "yt-dlp transcript",
		Bytes:      int(info.Size()),
		IsX:        false,
	}, nil
}

func normalizeYouTubeMetadata(raw youtubeMetadataJSON) YouTubeMetadata {
	return YouTubeMetadata{
		Title:           nonEmptyString(raw.Title),
		Channel:         firstObservedString(raw.Channel, raw.Uploader),
		UploadDate:      normalizeUploadDate(raw.UploadDate),
		DurationSeconds: positiveFloat(raw.Duration),
	}
}

func nonEmptyString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func firstObservedString(values ...*string) *string {
	for _, value := range values {
		if observed := nonEmptyString(value); observed != nil {
			return observed
		}
	}
	return nil
}

func positiveFloat(value *float64) *float64 {
	if value == nil || *value <= 0 {
		return nil
	}
	copy := *value
	return &copy
}

func normalizeUploadDate(value *string) *string {
	observed := nonEmptyString(value)
	if observed == nil {
		return nil
	}
	if len(*observed) == 8 {
		formatted := (*observed)[:4] + "-" + (*observed)[4:6] + "-" + (*observed)[6:8]
		return &formatted
	}
	return observed
}

func classifyLiveState(raw youtubeMetadataJSON) string {
	if raw.IsLive {
		return YouTubeAvailabilityLive
	}
	if raw.LiveStatus == nil {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(*raw.LiveStatus)) {
	case "is_live":
		return YouTubeAvailabilityLive
	case "is_upcoming":
		return YouTubeAvailabilityUpcoming
	default:
		return ""
	}
}

func chooseCaption(manual, automatic map[string][]youtubeCaptionFormat) *captionSelection {
	if language := chooseCaptionLanguage(manual); language != "" {
		return &captionSelection{Language: language, Kind: "manual"}
	}
	if language := chooseCaptionLanguage(automatic); language != "" {
		return &captionSelection{Language: language, Kind: "automatic"}
	}
	return nil
}

func chooseCaptionLanguage(tracks map[string][]youtubeCaptionFormat) string {
	available := make(map[string]bool)
	for language, formats := range tracks {
		for _, format := range formats {
			if format.Ext == "" || strings.EqualFold(format.Ext, "vtt") {
				available[language] = true
				break
			}
		}
	}
	for _, preferred := range PreferredCaptionLanguages {
		if available[preferred] {
			return preferred
		}
	}
	remaining := make([]string, 0, len(available))
	for language := range available {
		remaining = append(remaining, language)
	}
	sort.Strings(remaining)
	if len(remaining) == 0 {
		return ""
	}
	return remaining[0]
}

func downloadCaption(ctx context.Context, canonicalURL, workDir string, selection captionSelection) (string, *YouTubeFailure) {
	outputBase := filepath.Join(workDir, "youtube-caption-download")
	args := []string{
		"--skip-download",
		"--no-playlist",
		"--sub-langs", selection.Language,
		"--sub-format", "vtt",
		"-o", outputBase + ".%(ext)s",
	}
	if selection.Kind == "manual" {
		args = append(args, "--write-subs")
	} else {
		args = append(args, "--write-auto-subs")
	}
	args = append(args, canonicalURL)
	if _, err := runner.Run(ctx, "yt-dlp", args...); err != nil {
		return "", contextOrTechnicalFailure(ctx, YouTubeFailureCaptionFailed, "yt-dlp subtitles: "+err.Error())
	}
	matches, err := filepath.Glob(outputBase + "*.vtt")
	if err != nil {
		return "", technicalFailure(YouTubeFailureCaptionFailed, "find downloaded caption: "+err.Error(), true)
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		return "", technicalFailure(YouTubeFailureCaptionFailed, "yt-dlp produced no VTT file", true)
	}
	rawPath := filepath.Join(workDir, "youtube-caption.vtt")
	_ = os.Remove(rawPath)
	if err := os.Rename(matches[0], rawPath); err != nil {
		return "", technicalFailure(YouTubeFailureCaptionFailed, "normalize downloaded caption: "+err.Error(), true)
	}
	for _, extra := range matches[1:] {
		_ = os.Remove(extra)
	}
	return rawPath, nil
}

var (
	vttTimestampRe = regexp.MustCompile(`^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})`)
	vttTagRe       = regexp.MustCompile(`<[^>]+>`)
)

func timestampedTranscript(raw []byte) string {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")
	var cues []string
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		match := vttTimestampRe.FindStringSubmatch(line)
		if len(match) != 3 {
			continue
		}
		var textParts []string
		for i++; i < len(lines); i++ {
			textLine := strings.TrimSpace(lines[i])
			if textLine == "" {
				break
			}
			textLine = vttTagRe.ReplaceAllString(textLine, "")
			textLine = html.UnescapeString(textLine)
			textLine = strings.Join(strings.Fields(textLine), " ")
			if textLine != "" {
				textParts = append(textParts, textLine)
			}
		}
		text := strings.TrimSpace(strings.Join(textParts, " "))
		if text == "" {
			continue
		}
		cue := fmt.Sprintf("[%s --> %s] %s", match[1], match[2], text)
		if len(cues) == 0 || cues[len(cues)-1] != cue {
			cues = append(cues, cue)
		}
	}
	return strings.Join(cues, "\n")
}

func plainTranscriptText(transcript string) string {
	lines := strings.Split(transcript, "\n")
	for i, line := range lines {
		if end := strings.Index(line, "] "); end >= 0 {
			lines[i] = line[end+2:]
		}
	}
	return strings.Join(lines, "\n")
}

func calculateCaptionCoverage(raw []byte, durationSeconds *float64) CaptionCoverage {
	type interval struct {
		start float64
		end   float64
	}
	var intervals []interval
	for _, line := range strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n") {
		match := vttTimestampRe.FindStringSubmatch(strings.TrimSpace(line))
		if len(match) != 3 {
			continue
		}
		start, startErr := parseVTTSeconds(match[1])
		end, endErr := parseVTTSeconds(match[2])
		if startErr == nil && endErr == nil && end > start {
			intervals = append(intervals, interval{start: start, end: end})
		}
	}
	coverage := CaptionCoverage{CueCount: len(intervals)}
	if len(intervals) == 0 {
		return coverage
	}
	sort.Slice(intervals, func(i, j int) bool {
		return intervals[i].start < intervals[j].start
	})
	current := intervals[0]
	for _, next := range intervals[1:] {
		if next.start <= current.end {
			if next.end > current.end {
				current.end = next.end
			}
			continue
		}
		coverage.CoveredSeconds += current.end - current.start
		current = next
	}
	coverage.CoveredSeconds += current.end - current.start
	if durationSeconds != nil && *durationSeconds > 0 {
		ratio := coverage.CoveredSeconds / *durationSeconds
		if ratio > 1 {
			ratio = 1
		}
		coverage.Ratio = &ratio
	}
	return coverage
}

func parseVTTSeconds(value string) (float64, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 && len(parts) != 3 {
		return 0, fmt.Errorf("invalid VTT timestamp %q", value)
	}
	var hours float64
	if len(parts) == 3 {
		parsed, err := strconv.ParseFloat(parts[0], 64)
		if err != nil {
			return 0, err
		}
		hours = parsed
		parts = parts[1:]
	}
	minutes, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	seconds, err := strconv.ParseFloat(parts[1], 64)
	if err != nil {
		return 0, err
	}
	return hours*3600 + minutes*60 + seconds, nil
}

func estimateTokens(text string) int {
	runes := utf8.RuneCountInString(text)
	words := len(strings.Fields(text))
	byRunes := (runes + 3) / 4
	if words > byRunes {
		return words
	}
	return byRunes
}

func writeYouTubeSourceCapture(workDir string, capture *YouTubeCapture, transcript string) (string, error) {
	var lines []string
	lines = append(lines,
		"Source URL: "+capture.URL.CanonicalURL,
		"Fetched via: yt-dlp transcript",
	)
	if capture.Metadata.Title != nil {
		lines = append(lines, "Title: "+*capture.Metadata.Title)
	}
	if capture.Metadata.Channel != nil {
		lines = append(lines, "Channel: "+*capture.Metadata.Channel)
	}
	if capture.Metadata.UploadDate != nil {
		lines = append(lines, "Upload date: "+*capture.Metadata.UploadDate)
	}
	if capture.Metadata.DurationSeconds != nil {
		lines = append(lines, fmt.Sprintf("Duration seconds: %.3f", *capture.Metadata.DurationSeconds))
	}
	if capture.Caption != nil {
		lines = append(lines,
			"Caption language: "+capture.Caption.Language,
			"Caption kind: "+capture.Caption.Kind,
		)
	}
	lines = append(lines, "", "Timestamped transcript:", "", transcript, "")
	payload := []byte(strings.Join(lines, "\n"))
	if err := ValidateArticleCapture(payload); err != nil {
		return "", err
	}
	path := filepath.Join(workDir, "source-tweet.md")
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		return "", err
	}
	return path, nil
}

func sanitizeYouTubeHandle(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(value, "-")
	return strings.Trim(value, "-")
}

func technicalFailure(code, message string, retryable bool) *YouTubeFailure {
	return &YouTubeFailure{
		Code:      code,
		Message:   message,
		Retryable: retryable,
		Technical: true,
	}
}

func contextOrTechnicalFailure(ctx context.Context, fallbackCode, message string) *YouTubeFailure {
	switch {
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		return technicalFailure(YouTubeFailureTimeout, "YouTube capture timed out", true)
	case errors.Is(ctx.Err(), context.Canceled):
		return technicalFailure(YouTubeFailureInterrupted, "YouTube capture was interrupted", true)
	default:
		return technicalFailure(fallbackCode, message, true)
	}
}

func removeYouTubeArtifacts(workDir string) {
	for _, name := range []string{
		"youtube-caption.vtt",
		"youtube-transcript.txt",
		"source-tweet.md",
	} {
		_ = os.Remove(filepath.Join(workDir, name))
	}
	matches, _ := filepath.Glob(filepath.Join(workDir, "youtube-caption-download*"))
	for _, match := range matches {
		_ = os.Remove(match)
	}
}
