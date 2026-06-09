import notes from '../data/post-authorship-notes.json';

type Lang = 'zh-tw' | 'en';
type AuthorshipNotes = Record<string, Partial<Record<Lang, string>>>;

const authorshipNotes = notes as AuthorshipNotes;

function postKey(postId: string): string {
  return postId.replace(/\.mdx$/, '');
}

export function getPostAuthorshipNote(postId: string, lang: Lang): string | null {
  return authorshipNotes[postKey(postId)]?.[lang] ?? null;
}
