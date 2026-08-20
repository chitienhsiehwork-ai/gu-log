import { describe, expect, it } from 'vitest';
import { buildPublicApiEndpoint } from '../src/lib/public-api-url';

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
    ['non-http scheme', 'javascript:alert(document.domain)//'],
    ['remote HTTP', 'http://api.example.test/'],
    ['127-prefixed remote hostname', 'http://127.evil.example/'],
    ['credentials', 'https://user:secret@api.example.test/'],
    ['query', 'https://api.example.test/?tenant=a'],
    ['fragment', 'https://api.example.test/#frag'],
  ])('rejects %s', (_label, rawBaseUrl) => {
    expect(() => buildPublicApiEndpoint(rawBaseUrl, '/auth/github')).toThrow(/PUBLIC_API_URL/);
  });
});
