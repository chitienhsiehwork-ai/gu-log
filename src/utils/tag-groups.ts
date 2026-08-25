interface TaggablePost {
  data: {
    originalDate: string;
    translatedDate?: string;
    tags?: readonly string[];
  };
}

interface TagPostGroup<T> {
  tag: string;
  posts: T[];
}

export function groupPostsByTag<T extends TaggablePost>(posts: readonly T[]): TagPostGroup<T>[] {
  const groups = new Map<string, T[]>();

  posts.forEach((post) => {
    const uniqueTags = new Set(post.data.tags || []);

    uniqueTags.forEach((tag) => {
      const group = groups.get(tag) || [];
      group.push(post);
      groups.set(tag, group);
    });
  });

  return Array.from(groups, ([tag, groupedPosts]) => ({
    tag,
    posts: groupedPosts.sort((a, b) => {
      const dateA = a.data.translatedDate || a.data.originalDate;
      const dateB = b.data.translatedDate || b.data.originalDate;
      return dateB.localeCompare(dateA);
    }),
  }));
}
