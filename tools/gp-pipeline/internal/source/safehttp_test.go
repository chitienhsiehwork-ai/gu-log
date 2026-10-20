package source

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// testClient returns a safe client whose IP filter admits loopback so an
// httptest.Server can stand in for a public site. Everything else — redirect
// validation, hop limits, byte caps, DNS-bound dialing — is the production
// code path.
func testClient(t *testing.T) *safeHTTPClient {
	t.Helper()
	c := newSafeHTTPClient()
	c.allowIP = func(ip net.IP) bool { return ip.IsLoopback() || isPublicIP(ip) }
	return c
}

func TestSafeGet_FollowsValidatedRedirectAndReportsFinalURL(t *testing.T) {
	var target *httptest.Server
	target = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprint(w, "<html><body>final body</body></html>")
	}))
	defer target.Close()
	hopper := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/article", http.StatusFound)
	}))
	defer hopper.Close()

	res, err := testClient(t).get(context.Background(), hopper.URL, "test-agent")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if res.FinalURL != target.URL+"/article" {
		t.Fatalf("FinalURL = %q, want redirect target", res.FinalURL)
	}
	if !strings.Contains(string(res.Body), "final body") {
		t.Fatalf("body = %q", res.Body)
	}
}

func TestSafeGet_RejectsRedirectToCredentialURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://user:secret@example.com/")
		w.WriteHeader(http.StatusFound)
	}))
	defer srv.Close()

	_, err := testClient(t).get(context.Background(), srv.URL, "test-agent")
	if err == nil || !strings.Contains(err.Error(), "userinfo") {
		t.Fatalf("err = %v, want userinfo rejection", err)
	}
	if strings.Contains(err.Error(), "secret") {
		t.Fatalf("error leaked the credential: %v", err)
	}
}

func TestSafeGet_RejectsRedirectToNonHTTPScheme(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "file:///etc/passwd")
		w.WriteHeader(http.StatusFound)
	}))
	defer srv.Close()

	_, err := testClient(t).get(context.Background(), srv.URL, "test-agent")
	if err == nil || !strings.Contains(err.Error(), "redirect rejected") {
		t.Fatalf("err = %v, want redirect rejection", err)
	}
}

func TestSafeGet_RedirectToPrivateIPFailsAtDial(t *testing.T) {
	// The hop URL itself (private IP literal) must be rejected before any
	// connection. This uses the production allowIP, so loopback test servers
	// cannot be the redirect target; a literal is enough.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "http://192.168.1.10/admin")
		w.WriteHeader(http.StatusFound)
	}))
	defer srv.Close()

	_, err := testClient(t).get(context.Background(), srv.URL, "test-agent")
	if err == nil || !strings.Contains(err.Error(), "non-public IP") {
		t.Fatalf("err = %v, want non-public IP rejection", err)
	}
}

func TestSafeGet_BoundsRedirectHops(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL+r.URL.Path+"x", http.StatusFound)
	}))
	defer srv.Close()

	_, err := testClient(t).get(context.Background(), srv.URL, "test-agent")
	if err == nil || !strings.Contains(err.Error(), "redirects") {
		t.Fatalf("err = %v, want redirect-hop bound", err)
	}
}

func TestSafeGet_FailsInsteadOfTruncatingOversizedBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		chunk := strings.Repeat("a", 64*1024)
		for range 8 {
			fmt.Fprint(w, chunk)
		}
	}))
	defer srv.Close()

	c := testClient(t)
	c.maxBody = 128 * 1024
	_, err := c.get(context.Background(), srv.URL, "test-agent")
	if err == nil || !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("err = %v, want over-limit failure", err)
	}
}

func TestDialContext_BindsDNSCheckToConnection(t *testing.T) {
	// The resolver answers with a private IP: the dial must fail without any
	// connection attempt, proving the check is on the address actually used.
	c := newSafeHTTPClient()
	var dialed atomic.Int32
	c.lookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("10.0.0.5")}, nil
	}
	c.dialIP = func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialed.Add(1)
		return nil, fmt.Errorf("should not be reached")
	}
	_, err := c.dialContext(context.Background(), "tcp", "rebinding.example:443")
	if err == nil || !strings.Contains(err.Error(), "non-public") {
		t.Fatalf("err = %v, want non-public rejection", err)
	}
	if dialed.Load() != 0 {
		t.Fatal("a non-public resolved address was dialed")
	}
}

func TestDialContext_DialsOnlyValidatedPublicIP(t *testing.T) {
	// Mixed answers: the private IP must be skipped, the public one dialed
	// as a literal (no second resolution for the connection).
	c := newSafeHTTPClient()
	var got []string
	c.lookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("93.184.216.34")}, nil
	}
	c.dialIP = func(ctx context.Context, network, addr string) (net.Conn, error) {
		got = append(got, addr)
		return nil, fmt.Errorf("stop here")
	}
	_, err := c.dialContext(context.Background(), "tcp", "mixed.example:443")
	if err == nil {
		t.Fatal("expected the stub dial error")
	}
	if len(got) != 1 || got[0] != "93.184.216.34:443" {
		t.Fatalf("dialed %v, want only the validated public IP literal", got)
	}
}

func TestDialContext_RejectsNonCanonicalIPv4Literals(t *testing.T) {
	c := newSafeHTTPClient()
	c.lookupIP = func(ctx context.Context, host string) ([]net.IP, error) {
		t.Fatal("non-canonical literal must not reach the resolver")
		return nil, nil
	}
	for _, host := range []string{"2130706433", "0x7f000001", "0177.0.0.1", "127.1"} {
		if _, err := c.dialContext(context.Background(), "tcp", host+":80"); err == nil {
			t.Fatalf("literal %q was accepted", host)
		}
	}
}

func TestIsPublicIP(t *testing.T) {
	reject := []string{
		"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254",
		"0.0.0.0", "0.1.2.3", "100.64.0.1", "192.0.0.1", "192.0.2.5",
		"198.18.0.1", "198.51.100.7", "203.0.113.9", "240.0.0.1", "255.255.255.255",
		"::1", "::", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "2001:db8::1",
	}
	for _, s := range reject {
		if isPublicIP(net.ParseIP(s)) {
			t.Errorf("isPublicIP(%s) = true, want false", s)
		}
	}
	accept := []string{"8.8.8.8", "93.184.216.34", "2606:4700::6810:84e5"}
	for _, s := range accept {
		if !isPublicIP(net.ParseIP(s)) {
			t.Errorf("isPublicIP(%s) = false, want true", s)
		}
	}
}
