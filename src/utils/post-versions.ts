/**
 * Read post version numbers and reader-facing revisions from pre-built manifests.
 *
 * `post-versions.json` is a git touch count for visible version badges.
 * `post-reader-revisions.json` is a content-derived hash used by Reader Tracker
 * to decide whether a previously read article is still current.
 */
import versionManifest from '../data/post-versions.json';
import readerRevisionManifest from '../data/post-reader-revisions.json';

const versions: Record<string, number> = versionManifest as Record<string, number>;
const readerRevisions: Record<string, string> = readerRevisionManifest as Record<string, string>;

function postKey(postId: string): string {
  return postId.replace(/\.mdx$/, '');
}

export function getPostVersion(postId: string): string {
  const count = versions[postKey(postId)];
  return count ? String(count) : '1';
}

export function getPostReaderRevision(postId: string): string | null {
  return readerRevisions[postKey(postId)] ?? null;
}
