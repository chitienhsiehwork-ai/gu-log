// 詞彙表頁面的展開收起、複製連結、搜尋與分類篩選（中英文頁共用）。
// 沒有 JS 時，詞條靠 CSS 的 :target 展開；這裡只做加強（openspec: glossary-browsing）。

// 宣告成模組，頂層變數才不會跟 window 上的全域名稱（例如 window.toolbar）撞名。
export {};

const toolbar = document.getElementById('glossary-toolbar');
const list = document.getElementById('glossary-list');
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

// ─── 控制列高度 ────────────────────────────────────────────────
// 頁面的 scroll-padding-top 讀這個值，錨點目標才會停在控制列下面。
function syncToolbarHeight() {
  if (!toolbar) return;
  const height = Math.ceil(toolbar.getBoundingClientRect().height);
  document.documentElement.style.setProperty('--glossary-toolbar-height', `${height}px`);
}

syncToolbarHeight();
if (toolbar) new ResizeObserver(syncToolbarHeight).observe(toolbar);

// ─── 搜尋與分類篩選（只在頁內，不寫進網址）──────────────────────
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

function selectCategory(category: string) {
  activeCategory = category;
  pills.forEach((pill) =>
    pill.setAttribute('aria-pressed', String(pill.dataset.category === category))
  );
  filterItems();
}

searchInput?.addEventListener('input', filterItems);
pills.forEach((pill) => {
  pill.addEventListener('click', () => selectCategory(pill.dataset.category ?? 'all'));
});

// ─── 展開與收起 ────────────────────────────────────────────────
// 有 JS 後每個詞條都帶 .is-open 或 .is-collapsed，展開狀態只看 class。
// .is-collapsed 蓋過 :target：只用 history.replaceState 拿掉錨點，有些瀏覽器不會更新 :target。
function setOpen(entry: HTMLElement, open: boolean) {
  entry.classList.toggle('is-open', open);
  entry.classList.toggle('is-collapsed', !open);
  entry.querySelector('.entry-toggle')?.setAttribute('aria-expanded', String(open));
}

// 頁內錨點的目標：詞條或字母段落。
function targetForHash(hash: string) {
  if (!hash || hash === '#') return null;
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  return target && list?.contains(target) ? target : null;
}

// 目標被目前的篩選藏起來時先切回「全部」，詞條再展開。回傳目標原本是否被藏起來。
function revealTarget(target: HTMLElement) {
  const wasHidden =
    target.hidden || Boolean(target.closest<HTMLElement>('.letter-section')?.hidden);
  if (wasHidden) {
    if (searchInput) searchInput.value = '';
    selectCategory('all');
  }
  if (target.classList.contains('glossary-entry')) setOpen(target, true);
  return wasHidden;
}

// 從網址錨點進來的詞條，CSS 的 :target 已經讓它在第一次繪製就展開；這裡改用 .is-open 接手，
// 之後點別的錨點時它也不會收起來。不讀 :target，因為 script 執行時瀏覽器不一定已經設好它。
const initialTarget = targetForHash(location.hash);

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

// 頁首提到複製按鈕的那句，等按鈕真的加上才顯示。
if (copyButtonTemplate) {
  document.querySelector<HTMLElement>('.glossary-copy-hint')?.removeAttribute('hidden');
}

// 點到頁內錨點（相關詞條、Mogu 前綴、A–Z）時先處理目標，再讓瀏覽器照常捲過去。
// 連到目前錨點的連結不會觸發 hashchange，所以在 click 就處理。
document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!(link instanceof HTMLAnchorElement)) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  const target = targetForHash(url.hash);
  if (target) revealTarget(target);
});

// 上一頁、下一頁或手動改網址的錨點。目標原本被篩選藏起來時，瀏覽器捲不過去，要自己捲。
window.addEventListener('hashchange', () => {
  const target = targetForHash(location.hash);
  if (target && revealTarget(target)) target.scrollIntoView({ block: 'start' });
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
