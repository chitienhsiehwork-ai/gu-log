/**
 * CORS Configuration Middleware
 *
 * Allows requests from:
 * - localhost (any port) — for local development
 * - gu-log.vercel.app — production deployment
 *
 * All other origins are rejected.
 */

import { cors } from 'hono/cors';

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  'https://gu-log.vercel.app',
];

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return origin;
    for (const allowed of ALLOWED_ORIGINS) {
      if (typeof allowed === 'string') {
        if (origin === allowed) return origin;
      } else {
        if (allowed.test(origin)) return origin;
      }
    }
    return '';
  },
  allowMethods: ['GET', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
});
