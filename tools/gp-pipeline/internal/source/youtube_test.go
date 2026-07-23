package source

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseYouTubeURL(t *testing.T) {
	const id = "dQw4w9WgXcQ"
	for _, raw := range []string{
		"https://www.youtube.com/watch?v=" + id,
		"https://youtube.com/shorts/" + id,
		"https://youtu.be/" + id + "?t=10",
	} {
		t.Run(raw, func(t *testing.T) {
			got, err := ParseYouTubeURL(raw)
			if err != nil {
				t.Fatal(err)
			}
			if got.VideoID != id || got.CanonicalURL != "https://www.youtube.com/watch?v="+id {
				t.Fatalf("parsed = %#v", got)
			}
		})
	}
}

func TestParseYouTubeURLRejectsNonSingleVideoShapes(t *testing.T) {
	for _, raw := range []string{
		"https://youtube.com/playlist?list=PL123",
		"https://youtube.com/channel/UC123",
		"https://youtube.com/results?search_query=agents",
		"https://youtube.com/redirect?q=https://example.com",
		"https://youtube.com/live",
		"https://user@youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube.com.evil/watch?v=dQw4w9WgXcQ",
		"https://youtu.be/dQw4w9WgXcQ/extra",
		"https://youtube.com/watch?v=short",
	} {
		t.Run(raw, func(t *testing.T) {
			if _, err := ParseYouTubeURL(raw); err == nil {
				t.Fatalf("expected rejection for %s", raw)
			}
		})
	}
}

func TestYouTubeOwnedHostClassifierIsBroaderThanStrictAllowlist(t *testing.T) {
	for _, raw := range []string{
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://music.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
	} {
		if !IsYouTubeOwnedHostURL(raw) {
			t.Errorf("owned YouTube host was not classified: %s", raw)
		}
		if IsYouTubeHostURL(raw) {
			t.Errorf("unsupported host must not enter the strict allowlist: %s", raw)
		}
	}
	if IsYouTubeOwnedHostURL("https://youtube.com.evil/watch?v=dQw4w9WgXcQ") {
		t.Fatal("suffix-confusion host was classified as YouTube-owned")
	}
}

func TestFetchUnsupportedYouTubeOwnedHostsNeverInvokeCurlOrYTDLP(t *testing.T) {
	workDir := t.TempDir()
	binDir := t.TempDir()
	trapLog := filepath.Join(workDir, "trap.log")
	for _, name := range []string{"curl", "yt-dlp"} {
		writeExecutable(t, filepath.Join(binDir, name), `#!/bin/sh
printf '%s\n' "$0 $*" >> "$SOURCE_TRAP_LOG"
exit 99
`)
	}
	t.Setenv("SOURCE_TRAP_LOG", trapLog)
	t.Setenv("PATH", binDir)

	for _, raw := range []string{
		"https://m.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://music.youtube.com/watch?v=dQw4w9WgXcQ",
		"https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
	} {
		if _, err := Fetch(context.Background(), raw, FetchOptions{WorkDir: workDir}); err == nil ||
			!strings.Contains(err.Error(), "invalid YouTube URL") {
			t.Fatalf("Fetch(%s) error = %v", raw, err)
		}
	}
	if raw, err := os.ReadFile(trapLog); err == nil {
		t.Fatalf("unsupported owned host invoked an external fetcher:\n%s", raw)
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestFetchSuffixConfusionHostUsesGenericRoute(t *testing.T) {
	workDir := t.TempDir()
	binDir := t.TempDir()
	curlLog := filepath.Join(workDir, "curl.log")
	ytLog := filepath.Join(workDir, "yt.log")
	writeExecutable(t, filepath.Join(binDir, "curl"), `#!/bin/sh
printf '%s\n' "$*" > "$SUFFIX_CURL_LOG"
exit 7
`)
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), `#!/bin/sh
printf '%s\n' "$*" > "$SUFFIX_YT_LOG"
exit 99
`)
	t.Setenv("SUFFIX_CURL_LOG", curlLog)
	t.Setenv("SUFFIX_YT_LOG", ytLog)
	t.Setenv("PATH", binDir)

	_, err := Fetch(
		context.Background(),
		"https://youtube.com.evil/watch?v=dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
	)
	if err == nil || !strings.Contains(err.Error(), "fetchgeneric") {
		t.Fatalf("suffix-confusion host error = %v, want generic fetch error", err)
	}
	if _, err := os.Stat(curlLog); err != nil {
		t.Fatalf("generic curl route was not invoked: %v", err)
	}
	if _, err := os.Stat(ytLog); !os.IsNotExist(err) {
		t.Fatal("suffix-confusion host was sent to yt-dlp")
	}
}

func TestCaptureYouTubePrefersManualCaptionAndPreservesTimestamps(t *testing.T) {
	workDir := t.TempDir()
	logPath := installFakeYTDLP(t, workDir)
	metadata := map[string]any{
		"title":       "Observed title",
		"channel":     "Observed channel",
		"upload_date": "20260722",
		"duration":    1200,
		"subtitles": map[string]any{
			"en": []map[string]string{{"ext": "vtt"}},
		},
		"automatic_captions": map[string]any{
			"en": []map[string]string{{"ext": "vtt"}},
		},
	}
	setFakeYTDLPFixture(t, workDir, metadata, longVTT(240))

	got := CaptureYouTube(
		context.Background(),
		"https://youtu.be/dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
		DefaultCandidateLimits(),
	)
	if got.Failure != nil {
		t.Fatalf("capture failure: %#v", got.Failure)
	}
	if !got.WriteEligible || got.Availability != YouTubeAvailabilityComplete {
		t.Fatalf("capture = %#v", got)
	}
	if got.Caption == nil || got.Caption.Kind != "manual" || got.Caption.Language != "en" {
		t.Fatalf("caption = %#v", got.Caption)
	}
	if got.Caption.Coverage.CueCount != 1 || got.Caption.Coverage.CoveredSeconds != 10 ||
		got.Caption.Coverage.Ratio == nil {
		t.Fatalf("caption coverage = %#v", got.Caption.Coverage)
	}
	transcript, err := os.ReadFile(got.Caption.TranscriptPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(transcript), "[00:00:00.000 --> 00:00:10.000]") {
		t.Fatalf("timestamp missing from transcript: %s", transcript)
	}
	logged, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logged), "--write-subs") ||
		strings.Contains(string(logged), "--write-auto-subs") {
		t.Fatalf("manual caption was not preferred:\n%s", logged)
	}
	if strings.Count(string(logged), "--no-playlist") != 2 {
		t.Fatalf("every yt-dlp invocation must use --no-playlist:\n%s", logged)
	}
}

func TestCaptureYouTubeUsesAutomaticWhenManualMissing(t *testing.T) {
	workDir := t.TempDir()
	installFakeYTDLP(t, workDir)
	metadata := map[string]any{
		"title":    "Automatic only",
		"duration": 600,
		"automatic_captions": map[string]any{
			"en": []map[string]string{{"ext": "vtt"}},
		},
	}
	setFakeYTDLPFixture(t, workDir, metadata, longVTT(240))

	got := CaptureYouTube(
		context.Background(),
		"https://youtube.com/watch?v=dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
		DefaultCandidateLimits(),
	)
	if got.Failure != nil || got.Caption == nil || got.Caption.Kind != "automatic" {
		t.Fatalf("capture = %#v caption=%#v", got.Failure, got.Caption)
	}
}

func TestChooseCaptionIsManualFirstThenLanguageStable(t *testing.T) {
	manual := map[string][]youtubeCaptionFormat{
		"zh-TW": {{Ext: "vtt"}},
		"en-GB": {{Ext: "vtt"}},
		"en":    {{Ext: "vtt"}},
	}
	automatic := map[string][]youtubeCaptionFormat{
		"en": {{Ext: "vtt"}},
	}
	got := chooseCaption(manual, automatic)
	if got == nil || got.Kind != "manual" || got.Language != "en" {
		t.Fatalf("selection = %#v", got)
	}

	delete(manual, "en")
	got = chooseCaption(manual, automatic)
	if got == nil || got.Kind != "manual" || got.Language != "en-GB" {
		t.Fatalf("selection = %#v", got)
	}
}

func TestCaptureYouTubeReviewablePartialStates(t *testing.T) {
	tests := []struct {
		name        string
		metadata    map[string]any
		vtt         string
		mutateLimit func(*CandidateLimits)
		wantCode    string
		wantCaption bool
	}{
		{
			name: "no captions",
			metadata: map[string]any{
				"title": "Metadata only",
			},
			wantCode: YouTubeFailureCaptionMissing,
		},
		{
			name: "short transcript",
			metadata: map[string]any{
				"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt:         longVTT(10),
			wantCode:    YouTubeFailureTranscriptShort,
			wantCaption: true,
		},
		{
			name: "duration limit before caption download",
			metadata: map[string]any{
				"duration":  999,
				"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt: longVTT(240),
			mutateLimit: func(limits *CandidateLimits) {
				limits.MaxDurationSeconds = 100
			},
			wantCode: YouTubeFailureDurationLimit,
		},
		{
			name: "raw byte limit",
			metadata: map[string]any{
				"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt: longVTT(240),
			mutateLimit: func(limits *CandidateLimits) {
				limits.MaxRawVTTBytes = 10
			},
			wantCode: YouTubeFailureRawBytesLimit,
		},
		{
			name: "token limit",
			metadata: map[string]any{
				"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt: longVTT(240),
			mutateLimit: func(limits *CandidateLimits) {
				limits.MaxEstimatedTokens = 10
			},
			wantCode:    YouTubeFailureTokenLimit,
			wantCaption: true,
		},
		{
			name: "live",
			metadata: map[string]any{
				"live_status": "is_live",
				"subtitles":   map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt:      longVTT(240),
			wantCode: YouTubeFailureLive,
		},
		{
			name: "upcoming",
			metadata: map[string]any{
				"live_status": "is_upcoming",
				"subtitles":   map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			},
			vtt:      longVTT(240),
			wantCode: YouTubeFailureUpcoming,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			workDir := t.TempDir()
			installFakeYTDLP(t, workDir)
			setFakeYTDLPFixture(t, workDir, test.metadata, test.vtt)
			limits := DefaultCandidateLimits()
			if test.mutateLimit != nil {
				test.mutateLimit(&limits)
			}
			got := CaptureYouTube(
				context.Background(),
				"https://youtube.com/watch?v=dQw4w9WgXcQ",
				FetchOptions{WorkDir: workDir},
				limits,
			)
			if got.Failure == nil || got.Failure.Code != test.wantCode {
				t.Fatalf("failure = %#v, want %s", got.Failure, test.wantCode)
			}
			if got.Failure.Technical {
				t.Fatalf("%s should be reviewable, not technical", test.name)
			}
			if got.WriteEligible {
				t.Fatalf("%s unexpectedly write eligible", test.name)
			}
			if (got.Caption != nil) != test.wantCaption {
				t.Fatalf("caption presence = %t, want %t", got.Caption != nil, test.wantCaption)
			}
		})
	}
}

func TestCaptureYouTubeMissingMetadataStaysNull(t *testing.T) {
	workDir := t.TempDir()
	installFakeYTDLP(t, workDir)
	setFakeYTDLPFixture(t, workDir, map[string]any{
		"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
	}, longVTT(240))
	got := CaptureYouTube(
		context.Background(),
		"https://youtube.com/watch?v=dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
		DefaultCandidateLimits(),
	)
	if got.Metadata.Title != nil || got.Metadata.Channel != nil ||
		got.Metadata.UploadDate != nil || got.Metadata.DurationSeconds != nil {
		t.Fatalf("missing metadata was guessed: %#v", got.Metadata)
	}
	if got.Failure != nil || !got.WriteEligible {
		t.Fatalf("missing optional metadata should not invalidate a complete transcript: %#v", got.Failure)
	}
}

func TestCaptureYouTubeStableTechnicalFailures(t *testing.T) {
	tests := []struct {
		name         string
		metadataExit string
		captionExit  string
		wantCode     string
	}{
		{name: "metadata acquisition", metadataExit: "7", wantCode: YouTubeFailureMetadataFailed},
		{name: "caption acquisition", captionExit: "8", wantCode: YouTubeFailureCaptionFailed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			workDir := t.TempDir()
			installFakeYTDLP(t, workDir)
			setFakeYTDLPFixture(t, workDir, map[string]any{
				"subtitles": map[string]any{"en": []map[string]string{{"ext": "vtt"}}},
			}, longVTT(240))
			t.Setenv("FAKE_YTDLP_METADATA_EXIT", test.metadataExit)
			t.Setenv("FAKE_YTDLP_CAPTION_EXIT", test.captionExit)
			got := CaptureYouTube(
				context.Background(),
				"https://youtube.com/watch?v=dQw4w9WgXcQ",
				FetchOptions{WorkDir: workDir},
				DefaultCandidateLimits(),
			)
			if got.Failure == nil || got.Failure.Code != test.wantCode || !got.Failure.Technical {
				t.Fatalf("failure = %#v, want technical %s", got.Failure, test.wantCode)
			}
		})
	}
}

func TestCaptureYouTubeRejectsMetadataVideoIDMismatch(t *testing.T) {
	workDir := t.TempDir()
	installFakeYTDLP(t, workDir)
	setFakeYTDLPFixture(t, workDir, map[string]any{
		"id": "aaaaaaaaaaa",
	}, "")
	got := CaptureYouTube(
		context.Background(),
		"https://youtube.com/watch?v=dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
		DefaultCandidateLimits(),
	)
	if got.Failure == nil || got.Failure.Code != YouTubeFailureVideoIDMismatch ||
		!got.Failure.Technical || got.Failure.Retryable {
		t.Fatalf("failure = %#v", got.Failure)
	}
}

func TestFetchYouTubeMissingDependencyFailsClosedBeforeCurl(t *testing.T) {
	workDir := t.TempDir()
	binDir := t.TempDir()
	curlLog := filepath.Join(workDir, "curl-called")
	writeExecutable(t, filepath.Join(binDir, "curl"), `#!/bin/sh
touch "$FAKE_CURL_LOG"
exit 0
`)
	t.Setenv("FAKE_CURL_LOG", curlLog)
	t.Setenv("PATH", binDir)

	_, err := Fetch(
		context.Background(),
		"https://youtube.com/watch?v=dQw4w9WgXcQ",
		FetchOptions{WorkDir: workDir},
	)
	if err == nil || !strings.Contains(err.Error(), YouTubeFailureDependencyMissing) {
		t.Fatalf("error = %v", err)
	}
	if _, statErr := os.Stat(curlLog); !os.IsNotExist(statErr) {
		t.Fatalf("generic curl fallback was invoked")
	}
}

func installFakeYTDLP(t *testing.T, workDir string) string {
	t.Helper()
	binDir := t.TempDir()
	logPath := filepath.Join(workDir, "yt-dlp.log")
	script := `#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_YTDLP_LOG"
case " $* " in
  *" --no-playlist "*) ;;
  *) echo "missing --no-playlist" >&2; exit 91 ;;
esac
case " $* " in
  *" -J "*) cat "$FAKE_YTDLP_METADATA"; exit "${FAKE_YTDLP_METADATA_EXIT:-0}" ;;
esac
if [ "${FAKE_YTDLP_CAPTION_EXIT:-0}" != "0" ]; then
  exit "$FAKE_YTDLP_CAPTION_EXIT"
fi
cp "$FAKE_YTDLP_VTT" "$FAKE_YTDLP_OUTPUT"
`
	writeExecutable(t, filepath.Join(binDir, "yt-dlp"), script)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("FAKE_YTDLP_LOG", logPath)
	t.Setenv("FAKE_YTDLP_OUTPUT", filepath.Join(workDir, "youtube-caption-download.en.vtt"))
	return logPath
}

func setFakeYTDLPFixture(t *testing.T, workDir string, metadata map[string]any, vtt string) {
	t.Helper()
	metadataPath := filepath.Join(workDir, "metadata.json")
	raw, err := json.Marshal(metadata)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(metadataPath, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	vttPath := filepath.Join(workDir, "fixture.vtt")
	if err := os.WriteFile(vttPath, []byte(vtt), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAKE_YTDLP_METADATA", metadataPath)
	t.Setenv("FAKE_YTDLP_VTT", vttPath)
}

func longVTT(words int) string {
	return "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\n" +
		strings.TrimSpace(strings.Repeat("word ", words)) + "\n"
}
