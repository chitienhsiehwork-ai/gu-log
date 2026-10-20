package source

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// safehttp is the one HTTP client automatic source capture may use for
// arbitrary (user-supplied) hosts. The fixed-provider paths (fxtwitter /
// vxtwitter / X guest API / YouTube via yt-dlp) connect only to hosts that
// are constants in their adapters; this client exists for FetchGeneric,
// where the destination comes straight from a post's sourceUrl.
//
// Guarantees (tribunal-focal-source-evidence spec):
//   - public HTTP(S) destinations only: every connection resolves the host
//     itself and dials the validated public IP directly, so the DNS check is
//     bound to the actual connection (no check-then-re-resolve rebinding gap).
//   - every redirect hop is re-validated (scheme, userinfo, host) and hops
//     are bounded; TLS certificate/hostname verification stays on.
//   - the response is capped: a body over the limit fails the capture
//     instead of being silently truncated.
//
// The resolver and dialer are injectable so tests can simulate DNS answers
// and connections without the network.

const (
	// Aligned with MAX_BYTES in scripts/fetch-article.py: a transport cap above
	// the extractor's stdin cap would silently skip readability for 5–8 MiB
	// pages and hand them to the cruder cleanup fallback.
	safeHTTPMaxBodyBytes = 5 << 20
	safeHTTPMaxRedirects = 5
	safeHTTPTimeout      = 90 * time.Second
)

type safeHTTPClient struct {
	lookupIP func(ctx context.Context, host string) ([]net.IP, error)
	// dialIP connects to an already-validated literal "ip:port".
	dialIP  func(ctx context.Context, network, addr string) (net.Conn, error)
	allowIP func(net.IP) bool
	maxBody int64
	maxHops int
	timeout time.Duration
}

func newSafeHTTPClient() *safeHTTPClient {
	dialer := &net.Dialer{Timeout: 20 * time.Second}
	return &safeHTTPClient{
		lookupIP: func(ctx context.Context, host string) ([]net.IP, error) {
			addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			ips := make([]net.IP, 0, len(addrs))
			for _, a := range addrs {
				ips = append(ips, a.IP)
			}
			return ips, nil
		},
		dialIP:  dialer.DialContext,
		allowIP: isPublicIP,
		maxBody: safeHTTPMaxBodyBytes,
		maxHops: safeHTTPMaxRedirects,
		timeout: safeHTTPTimeout,
	}
}

// safeGetResult is what a bounded, validated capture returns.
type safeGetResult struct {
	// FinalURL is the URL the client actually read the body from, after
	// validated redirects. This is the trusted observed identity for
	// generic captures; HTML canonical tags must not replace it.
	FinalURL    string
	Body        []byte
	ContentType string
}

// validateHopURL rejects URL shapes that must never be fetched or followed:
// non-HTTP(S) schemes, credential-bearing userinfo, and empty or
// obviously-internal hostnames. Hostname IP checks happen at dial time;
// literal-IP hops are rejected here with the production filter.
func validateHopURL(u *url.URL) error {
	return validateHopURLAllow(u, isPublicIP)
}

func validateHopURLAllow(u *url.URL, allowIP func(net.IP) bool) error {
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http(s) URLs are supported, got %q", u.Scheme)
	}
	if u.User != nil {
		// Do not echo the URL: userinfo may hold a credential.
		return errors.New("credential-bearing URL (userinfo) is not allowed")
	}
	host := u.Hostname()
	if host == "" {
		return errors.New("URL has no host")
	}
	lower := strings.ToLower(strings.TrimSuffix(host, "."))
	if lower == "localhost" || lower == "localhost.localdomain" ||
		strings.HasSuffix(lower, ".localhost") {
		return errors.New("localhost is not allowed")
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		if !allowIP(ip) {
			return fmt.Errorf("non-public IP literal is not allowed")
		}
	} else if nonCanonicalIPv4Re.MatchString(host) {
		return fmt.Errorf("non-canonical IPv4 literal is not allowed")
	}
	return nil
}

// isPublicIP reports whether ip is a plausible public unicast address.
// Everything scoped to a host, LAN, carrier NAT, documentation or future
// use is rejected.
func isPublicIP(ip net.IP) bool {
	ip = ip.To16()
	if ip == nil {
		return false
	}
	if v4 := ip.To4(); v4 != nil {
		switch {
		case v4[0] == 0: // 0.0.0.0/8 "this network"
			return false
		case v4[0] == 100 && v4[1]&0xc0 == 64: // 100.64.0.0/10 CGNAT
			return false
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 0: // 192.0.0.0/24 IETF
			return false
		case v4[0] == 192 && v4[1] == 0 && v4[2] == 2: // 192.0.2.0/24 TEST-NET-1
			return false
		case v4[0] == 198 && v4[1]&0xfe == 18: // 198.18.0.0/15 benchmarking
			return false
		case v4[0] == 198 && v4[1] == 51 && v4[2] == 100: // TEST-NET-2
			return false
		case v4[0] == 203 && v4[1] == 0 && v4[2] == 113: // TEST-NET-3
			return false
		case v4[0] >= 240: // 240.0.0.0/4 reserved + broadcast
			return false
		}
	} else {
		// IPv6 documentation prefix 2001:db8::/32.
		if ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x0d && ip[3] == 0xb8 {
			return false
		}
	}
	return !(ip.IsLoopback() ||
		ip.IsPrivate() ||
		ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() ||
		ip.IsUnspecified())
}

// dialContext resolves addr's host itself, filters the answers to public
// IPs, and dials a validated IP directly. The TLS layer above still sees the
// original hostname, so SNI and certificate verification are unchanged.
func (c *safeHTTPClient) dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, fmt.Errorf("safehttp: bad address: %w", err)
	}
	var candidates []net.IP
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		candidates = []net.IP{ip}
	} else {
		if nonCanonicalIPv4Re.MatchString(host) {
			return nil, fmt.Errorf("safehttp: non-canonical IPv4 literal is not allowed")
		}
		candidates, err = c.lookupIP(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("safehttp: resolving %s: %w", host, err)
		}
	}
	var lastErr error
	allowed := 0
	for _, ip := range candidates {
		if !c.allowIP(ip) {
			continue
		}
		allowed++
		conn, dialErr := c.dialIP(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if allowed == 0 {
		return nil, fmt.Errorf("safehttp: %s resolves only to non-public addresses", host)
	}
	return nil, fmt.Errorf("safehttp: connecting to %s: %w", host, lastErr)
}

// get fetches urlStr under the safe-transport rules and returns the body,
// final URL, and content type. There is no fallback client: a failure here
// is a source-capture failure.
func (c *safeHTTPClient) get(ctx context.Context, urlStr string, userAgent string) (*safeGetResult, error) {
	initial, err := url.Parse(urlStr)
	if err != nil {
		return nil, fmt.Errorf("safehttp: invalid URL: %w", err)
	}
	if err := validateHopURLAllow(initial, c.allowIP); err != nil {
		return nil, fmt.Errorf("safehttp: %w", err)
	}

	transport := &http.Transport{
		DialContext:       c.dialContext,
		ForceAttemptHTTP2: true,
		// Proxies re-resolve destinations outside this client's checks, so
		// ambient proxy configuration is intentionally not honored here.
		Proxy: nil,
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   c.timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= c.maxHops {
				return fmt.Errorf("safehttp: more than %d redirects", c.maxHops)
			}
			if err := validateHopURLAllow(req.URL, c.allowIP); err != nil {
				return fmt.Errorf("safehttp: redirect rejected: %w", err)
			}
			return nil
		},
	}
	defer transport.CloseIdleConnections()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, urlStr, nil)
	if err != nil {
		return nil, fmt.Errorf("safehttp: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		// url.Error embeds the full URL, which can carry userinfo from a
		// hostile redirect; keep only the inner cause in diagnostics.
		var uerr *url.Error
		if errors.As(err, &uerr) {
			return nil, fmt.Errorf("safehttp: %s: %w", uerr.Op, uerr.Err)
		}
		return nil, fmt.Errorf("safehttp: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("safehttp: HTTP %d from source", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, c.maxBody+1))
	if err != nil {
		return nil, fmt.Errorf("safehttp: reading body: %w", err)
	}
	if int64(len(body)) > c.maxBody {
		return nil, fmt.Errorf("safehttp: response exceeds %d bytes", c.maxBody)
	}

	finalURL := urlStr
	if resp.Request != nil && resp.Request.URL != nil {
		finalURL = resp.Request.URL.String()
	}
	return &safeGetResult{
		FinalURL:    finalURL,
		Body:        body,
		ContentType: resp.Header.Get("Content-Type"),
	}, nil
}
