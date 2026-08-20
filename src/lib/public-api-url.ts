const LOOPBACK_IPV4_PREFIX = '127.';

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname.startsWith(LOOPBACK_IPV4_PREFIX)
  );
}

export function buildPublicApiEndpoint(rawBaseUrl: string, endpointPath: `/${string}`): string {
  const url = new URL(rawBaseUrl);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('PUBLIC_API_URL must use http or https');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new Error('PUBLIC_API_URL must not include credentials, query, or fragment');
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error('PUBLIC_API_URL must use https except for loopback development');
  }

  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${endpointPath}`;
  return url.href;
}
