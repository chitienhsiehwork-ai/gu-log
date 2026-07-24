import { next, rewrite } from '@vercel/functions';

import {
  isCanonicalPostPath,
  negotiatePostRepresentation,
} from './src/lib/post-content-negotiation';

const REPRESENTATION_HEADERS = Object.freeze({ Vary: 'Accept' });

export const config = {
  matcher: ['/posts/:path*', '/en/posts/:path*'],
};

export default function middleware(request: Request): Response {
  const url = new URL(request.url);
  if (
    (request.method !== 'GET' && request.method !== 'HEAD') ||
    !isCanonicalPostPath(url.pathname)
  ) {
    return next();
  }

  if (negotiatePostRepresentation(request.headers.get('accept')) === 'markdown') {
    url.pathname = `${url.pathname}.md`;
    return rewrite(url, { headers: REPRESENTATION_HEADERS });
  }

  return next({ headers: REPRESENTATION_HEADERS });
}
