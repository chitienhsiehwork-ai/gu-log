/**
 * `sourceUrl` 是不是外部來源：gu-log 自己、示範用網域與 ShroomDog 自己的 ChatGPT 對話
 * 分享都不算。只用純 Node 相依，pre-commit 要能跑。
 */

const SITE_HOST = 'gu-log.vercel.app';
const EXAMPLE_HOSTS = ['example.com', 'example.org', 'example.net'];

export function isExternalSource(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return false;
  let url;
  try {
    url = new URL(sourceUrl.trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === SITE_HOST) return false;
  if (
    EXAMPLE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) ||
    host.endsWith('.example')
  ) {
    return false;
  }
  if (host === 'chatgpt.com' && url.pathname.startsWith('/share/')) return false;
  return true;
}
