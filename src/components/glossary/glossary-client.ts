// 詞彙表頁面的搜尋、分類篩選與複製連結（中英文頁共用）。
const searchInput = document.getElementById('glossary-search') as HTMLInputElement | null;
const pills = document.querySelectorAll<HTMLButtonElement>('.category-pill');
const entries = document.querySelectorAll<HTMLElement>('.glossary-entry');
const sections = document.querySelectorAll<HTMLElement>('.letter-section');
const countEl = document.getElementById('glossary-count');
const emptyEl = document.getElementById('glossary-empty');
const countSuffix = countEl?.dataset.countSuffix ?? '';

let activeCategory = 'all';

function filterItems() {
  const query = searchInput?.value.toLowerCase().trim() ?? '';
  let visible = 0;

  entries.forEach((entry) => {
    const matchesCategory = activeCategory === 'all' || entry.dataset.category === activeCategory;
    const matchesSearch =
      !query ||
      entry.dataset.term?.includes(query) ||
      entry.dataset.en?.includes(query) ||
      entry.dataset.definition?.includes(query) ||
      entry.dataset.aliases?.includes(query);

    const show = matchesCategory && matchesSearch;
    entry.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  sections.forEach((section) => {
    const hasVisible = Array.from(section.querySelectorAll<HTMLElement>('.glossary-entry')).some(
      (e) => e.style.display !== 'none'
    );
    section.style.display = hasVisible ? '' : 'none';
  });

  if (countEl) countEl.textContent = `${visible}${countSuffix}`;
  if (emptyEl) emptyEl.style.display = visible === 0 ? '' : 'none';
}

searchInput?.addEventListener('input', filterItems);

pills.forEach((pill) => {
  pill.addEventListener('click', () => {
    activeCategory = pill.dataset.category ?? 'all';
    pills.forEach((p) => p.setAttribute('aria-pressed', 'false'));
    pill.setAttribute('aria-pressed', 'true');
    filterItems();
  });
});

document.querySelectorAll<HTMLAnchorElement>('.term-link').forEach((link) => {
  let copyAttempt = 0;
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  link.addEventListener('click', async (e) => {
    e.preventDefault();
    const url = new URL(link.href);
    const attempt = ++copyAttempt;
    if (copiedTimeout) clearTimeout(copiedTimeout);
    link.classList.remove('copied');
    history.replaceState(null, '', url.hash);

    try {
      await navigator.clipboard.writeText(url.toString());
      if (attempt !== copyAttempt) return;
      link.classList.add('copied');
      copiedTimeout = setTimeout(() => link.classList.remove('copied'), 1200);
    } catch {
      // The hash link remains usable when Clipboard access is denied or unavailable.
    }
  });
});
