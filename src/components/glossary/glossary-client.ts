// 詞彙表頁面的展開收起、複製連結、搜尋與分類篩選（中英文頁共用）。
// 沒有 JS 時，詞條靠 CSS 的 :target 展開；這裡只做加強（openspec: glossary-browsing）。
const searchInput = document.getElementById('glossary-search') as HTMLInputElement | null;
const pills = document.querySelectorAll<HTMLButtonElement>('.category-pill');
const entries = [...document.querySelectorAll<HTMLElement>('.glossary-entry')];
const sections = document.querySelectorAll<HTMLElement>('.letter-section');
const countEl = document.getElementById('glossary-count');
const emptyEl = document.getElementById('glossary-empty');
const statusEl = document.getElementById('glossary-status');
const copyButtonTemplate = document.getElementById(
  'glossary-copy-button'
) as HTMLTemplateElement | null;
const countSuffix = countEl?.dataset.countSuffix ?? '';

function withTerm(template: string | undefined, entry: HTMLElement) {
  const term = entry.querySelector('.term-name')?.textContent?.trim() ?? entry.id;
  return (template ?? '').replace('{term}', term);
}

// ─── 展開與收起 ────────────────────────────────────────────────
// 有 JS 後每個詞條都帶 .is-open 或 .is-collapsed，展開狀態只看 class。
// .is-collapsed 蓋過 :target：只用 history.replaceState 拿掉錨點，有些瀏覽器不會更新 :target。
function setOpen(entry: HTMLElement, open: boolean) {
  entry.classList.toggle('is-open', open);
  entry.classList.toggle('is-collapsed', !open);
  entry.querySelector('.entry-toggle')?.setAttribute('aria-expanded', String(open));
}

function entryForHash(hash: string) {
  if (!hash || hash === '#') return null;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  return target?.classList.contains('glossary-entry') ? target : null;
}

// 從網址錨點進來的詞條，CSS 的 :target 已經讓它在第一次繪製就展開；這裡改用 .is-open 接手，
// 之後點別的錨點時它也不會收起來。不讀 :target，因為 script 執行時瀏覽器不一定已經設好它。
const initialTarget = entryForHash(location.hash);

for (const entry of entries) {
  const link = entry.querySelector<HTMLAnchorElement>('a.entry-toggle');
  if (!link) continue;

  // 沒有 JS 時的「指向自己錨點的連結」換成切換按鈕，才能同時展開多條並回報狀態。
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = link.className;
  toggle.setAttribute('aria-controls', `${entry.id}__details`);
  toggle.append(...link.childNodes);
  link.replaceWith(toggle);
  toggle.addEventListener('click', () => setOpen(entry, !entry.classList.contains('is-open')));

  const copyButton = copyButtonTemplate?.content.firstElementChild?.cloneNode(true);
  if (copyButton instanceof HTMLButtonElement) {
    copyButton.setAttribute('aria-label', withTerm(statusEl?.dataset.copyLink, entry));
    toggle.after(copyButton);
    setUpCopyButton(copyButton, entry);
  }

  setOpen(entry, entry === initialTarget);
}

// 點到頁內詞條的連結（相關詞條、Mogu 前綴）時先展開目標，再讓瀏覽器照常捲過去。
// 連到目前錨點的連結不會觸發 hashchange，所以在 click 就處理。
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  const target = entryForHash(url.hash);
  if (target) setOpen(target, true);
});

// 上一頁、下一頁或手動改網址的錨點。
window.addEventListener('hashchange', () => {
  const target = entryForHash(location.hash);
  if (target) setOpen(target, true);
});

// ─── 複製連結 ──────────────────────────────────────────────────
function setUpCopyButton(button: HTMLButtonElement, entry: HTMLElement) {
  let copyAttempt = 0;
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  button.addEventListener('click', async () => {
    const url = new URL(`#${entry.id}`, location.href);
    const attempt = ++copyAttempt;
    if (copiedTimeout) clearTimeout(copiedTimeout);
    button.classList.remove('copied');
    // 剪貼簿不能用時，網址列上的錨點仍然可以拿來分享。
    history.replaceState(null, '', url.hash);

    try {
      await navigator.clipboard.writeText(url.toString());
      if (attempt !== copyAttempt) return;
      button.classList.add('copied');
      if (statusEl) statusEl.textContent = withTerm(statusEl.dataset.copiedLink, entry);
      copiedTimeout = setTimeout(() => {
        button.classList.remove('copied');
        if (statusEl) statusEl.textContent = '';
      }, 1200);
    } catch {
      // 剪貼簿被拒或不能用：不顯示「已複製」。
    }
  });
}

// ─── 搜尋與分類篩選 ────────────────────────────────────────────
// 搜尋比對名稱、英文名、別名與定義全文（定義一直在 DOM 裡，只是收合時被截斷）。
const searchText = new Map(
  entries.map((entry) => [
    entry,
    `${entry.dataset.search ?? ''} ${entry.querySelector('.term-def')?.textContent ?? ''}`.toLowerCase(),
  ])
);

let activeCategory = 'all';

function filterItems() {
  const query = searchInput?.value.toLowerCase().trim() ?? '';
  let visible = 0;

  for (const entry of entries) {
    const show =
      (activeCategory === 'all' || entry.dataset.category === activeCategory) &&
      (!query || Boolean(searchText.get(entry)?.includes(query)));
    entry.hidden = !show;
    if (show) visible++;
  }

  sections.forEach((section) => {
    section.hidden = !section.querySelector('.glossary-entry:not([hidden])');
  });

  if (countEl) countEl.textContent = `${visible}${countSuffix}`;
  if (emptyEl) emptyEl.hidden = visible > 0;
}

searchInput?.addEventListener('input', filterItems);

pills.forEach((pill) => {
  pill.addEventListener('click', () => {
    activeCategory = pill.dataset.category ?? 'all';
    pills.forEach((p) => p.setAttribute('aria-pressed', String(p === pill)));
    filterItems();
  });
});
