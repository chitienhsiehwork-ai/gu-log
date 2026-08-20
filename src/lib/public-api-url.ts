const LOOPBACK_IPV4_PATTERN = /^127(?:\.\d{1,3}){3}$/;
export const PUBLIC_API_AUTH_PATH = '/auth/github' as const;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    LOOPBACK_IPV4_PATTERN.test(hostname)
  );
}

function parsePublicApiBaseUrl(rawBaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new Error('PUBLIC_API_URL must be a valid absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PUBLIC_API_URL must use http or https');
  }

  if (url.username || url.password || url.href.includes('?') || url.href.includes('#')) {
    throw new Error('PUBLIC_API_URL must not include credentials, query, or fragment');
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('PUBLIC_API_URL must use https except for loopback development');
  }

  return url;
}

export function normalizePublicApiBaseUrl(rawBaseUrl: string): string {
  const url = parsePublicApiBaseUrl(rawBaseUrl);
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href.replace(/\/$/, '');
}

export function buildPublicApiEndpoint(rawBaseUrl: string, endpointPath: `/${string}`): string {
  const url = parsePublicApiBaseUrl(rawBaseUrl);
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${endpointPath}`;
  return url.href;
}
