import { describe, expect, it } from 'vitest';
import { buildPublicApiEndpoint, normalizePublicApiBaseUrl } from '../src/lib/public-api-url';

describe('normalizePublicApiBaseUrl', () => {
  it.each([
    ['https root', 'https://api.example.test/', 'https://api.example.test'],
    ['https path', 'https://api.example.test/v1///', 'https://api.example.test/v1'],
    ['localhost', 'http://localhost:8787/', 'http://localhost:8787'],
    ['localhost subdomain', 'http://api.localhost:8787/', 'http://api.localhost:8787'],
    ['IPv4 loopback', 'http://127.0.0.2:8787/', 'http://127.0.0.2:8787'],
    ['IPv6 loopback', 'http://[::1]:8787/', 'http://[::1]:8787'],
  ])('normalizes %s', (_label, rawBaseUrl, expected) => {
    expect(normalizePublicApiBaseUrl(rawBaseUrl)).toBe(expected);
  });
});

describe('buildPublicApiEndpoint', () => {
  it.each([
    ['https root', 'https://api.example.test/', 'https://api.example.test/auth/github'],
    ['https path', 'https://api.example.test/v1/', 'https://api.example.test/v1/auth/github'],
    ['localhost', 'http://localhost:8787/', 'http://localhost:8787/auth/github'],
    ['IPv4 loopback', 'http://127.0.0.2:8787/', 'http://127.0.0.2:8787/auth/github'],
    ['IPv6 loopback', 'http://[::1]:8787/', 'http://[::1]:8787/auth/github'],
  ])('builds an endpoint for %s', (_label, rawBaseUrl, expected) => {
    expect(buildPublicApiEndpoint(rawBaseUrl, '/auth/github')).toBe(expected);
  });

  it.each([
    ['invalid absolute URL', 'not a URL'],
    ['non-http scheme', 'javascript:alert(document.domain)//'],
    ['remote HTTP', 'http://api.example.test/'],
    ['127-prefixed remote hostname', 'http://127.evil.example/'],
    ['credentials', 'https://user:secret@api.example.test/'],
    ['query', 'https://api.example.test/?tenant=a'],
    ['empty query', 'https://api.example.test/?'],
    ['fragment', 'https://api.example.test/#frag'],
    ['empty fragment', 'https://api.example.test/#'],
  ])('rejects %s', (_label, rawBaseUrl) => {
    expect(() => normalizePublicApiBaseUrl(rawBaseUrl)).toThrow(/PUBLIC_API_URL/);
    expect(() => buildPublicApiEndpoint(rawBaseUrl, '/auth/github')).toThrow(/PUBLIC_API_URL/);
  });
});
