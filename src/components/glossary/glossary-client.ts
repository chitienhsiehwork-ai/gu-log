// 詞彙表頁面的展開收起、複製連結、搜尋、分類篩選與字母索引（中英文頁共用）。
// 沒有 JS 時，詞條靠 CSS 的 :target 展開、字母索引靠 <details>；這裡只做加強
// （openspec: glossary-browsing）。

// 宣告成模組，頂層變數才不會跟 window 上的全域名稱（例如 window.toolbar）撞名。
export {};

const toolbar = document.getElementById('glossary-toolbar');
const list = document.getElementById('glossary-list');
const searchField = document.getElementById('glossary-search-field');
const searchInput = document.getElementById('glossary-search') as HTMLInputElement | null;
const pills = document.querySelectorAll<HTMLButtonElement>('.category-pill');
const activeFilter = document.getElementById('glossary-active-filter') as HTMLButtonElement | null;
const alphaJump = document.getElementById('glossary-alpha-jump') as HTMLDetailsElement | null;
const currentLetterEl = document.getElementById('glossary-current-letter');
const letterLinks = document.querySelectorAll<HTMLAnchorElement>('.alpha-key, .alpha-link');
const entries = [...document.querySelectorAll<HTMLElement>('.glossary-entry')];
const sections = [...document.querySelectorAll<HTMLElement>('.letter-section')];
const countNumber = document.querySelector('#glossary-count .count-number');
const emptyEl = document.getElementById('glossary-empty');
const statusEl = document.getElementById('glossary-status');
const copyButtonTemplate = document.getElementById(
  'glossary-copy-button'
) as HTMLTemplateElement | null;

function withTerm(template: string | undefined, entry: HTMLElement) {
  const term = entry.querySelector('.term-name')?.textContent?.trim() ?? entry.id;
  return (template ?? '').replace('{term}', term);
}

function toolbarBottom() {
  return toolbar?.getBoundingClientRect().bottom ?? 0;
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

// 捲到清單中段才改篩選條件時，清單變短會讓結果跑到畫面外；把清單開頭拉回控制列下面。
function keepListInView() {
  if (!list) return;
  const offset = list.getBoundingClientRect().top - toolbarBottom();
  if (offset < 0) window.scrollBy(0, offset);
}

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

  // 數量一直更新給輔助技術（連同藏起來的「個術語」整句唸）；畫面上只在有搜尋字時顯示數字。
  if (countNumber) countNumber.textContent = String(visible);
  searchField?.classList.toggle('has-query', Boolean(query));
  if (emptyEl) emptyEl.hidden = visible > 0;
  updateCurrentLetter();
}

function selectCategory(category: string) {
  activeCategory = category;
  let label = '';
  pills.forEach((pill) => {
    const pressed = pill.dataset.category === category;
    pill.setAttribute('aria-pressed', String(pressed));
    if (pressed) label = pill.dataset.label ?? '';
  });

  if (activeFilter) {
    activeFilter.hidden = category === 'all';
    const labelEl = activeFilter.querySelector('.active-filter-label');
    if (labelEl) labelEl.textContent = label;
    activeFilter.setAttribute(
      'aria-label',
      (activeFilter.dataset.labelTemplate ?? '').replace('{category}', label)
    );
  }
  filterItems();
}

searchInput?.addEventListener('input', () => {
  filterItems();
  keepListInView();
});
// 手機鍵盤的「搜尋」鍵只負責收起鍵盤。
searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchInput.blur();
});
pills.forEach((pill) => {
  pill.addEventListener('click', () => {
    selectCategory(pill.dataset.category ?? 'all');
    keepListInView();
  });
});
activeFilter?.addEventListener('click', () => {
  selectCategory('all');
  keepListInView();
  // 按鈕自己藏起來了，焦點交給搜尋框，鍵盤使用者才不會掉到頁首。
  searchInput?.focus({ preventScroll: true });
});

// ─── 展開與收起 ────────────────────────────────────────────────
// 有 JS 後每個詞條都帶 .is-open 或 .is-collapsed，展開狀態只看 class。
// .is-collapsed 蓋過 :target：只用 history.replaceState 拿掉錨點，有些瀏覽器不會更新 :target。
function setOpen(entry: HTMLElement, open: boolean) {
  entry.classList.toggle('is-open', open);
  entry.classList.toggle('is-collapsed', !open);
  entry.querySelector('.entry-toggle')?.setAttribute('aria-expanded', String(open));
}

// 一次只展開一條：清單才不會越捲越長。上方的詞條收起時，點的這條會跟著往上跑，
// 所以收起前後量一次位置，把它留在原本的地方（Safari 沒有 scroll anchoring）。
function openOnly(entry: HTMLElement, { keepInPlace }: { keepInPlace: boolean }) {
  const before = entry.getBoundingClientRect().top;
  for (const other of entries) {
    if (other !== entry && other.classList.contains('is-open')) setOpen(other, false);
  }
  setOpen(entry, true);
  if (!keepInPlace) return;

  const after = entry.getBoundingClientRect().top;
  // 收起時點的是定義摘要，名稱可能還壓在控制列底下；這時把名稱拉出來。
  const target = Math.max(before, toolbarBottom());
  if (after !== target) window.scrollBy(0, after - target);
}

// 頁內錨點的目標：詞條或字母段落。
function targetForHash(hash: string) {
  if (!hash || hash === '#') return null;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // 格式壞掉的錨點（例如 #100%、#%E5）解碼會丟 URIError；改用原字串找，找不到就是沒有目標，
    // 不能讓它中斷後面建立按鈕的初始化。
  }
  const target = document.getElementById(id);
  return target && list?.contains(target) ? target : null;
}

// 目標被目前的篩選藏起來時先切回「全部」，詞條再展開（瀏覽器接著會捲過去）。
function revealTarget(target: HTMLElement) {
  const wasHidden =
    target.hidden || Boolean(target.closest<HTMLElement>('.letter-section')?.hidden);
  if (wasHidden) {
    if (searchInput) searchInput.value = '';
    selectCategory('all');
  }
  if (target.classList.contains('glossary-entry')) openOnly(target, { keepInPlace: false });
}

// 從網址錨點進來的詞條，CSS 的 :target 已經讓它在第一次繪製就展開；這裡改用 .is-open 接手，
// 之後點別的錨點時它也不會收起來。不讀 :target，因為 script 執行時瀏覽器不一定已經設好它。
const initialTarget = targetForHash(location.hash);

for (const entry of entries) {
  const link = entry.querySelector<HTMLAnchorElement>('a.entry-toggle');
  if (!link) continue;

  // 沒有 JS 時的「指向自己錨點的連結」換成切換按鈕，才能回報展開狀態。
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = link.className;
  toggle.setAttribute('aria-controls', `${entry.id}__details`);
  toggle.append(...link.childNodes);
  link.replaceWith(toggle);
  toggle.addEventListener('click', () => {
    if (entry.classList.contains('is-open')) setOpen(entry, false);
    else openOnly(entry, { keepInPlace: true });
  });

  const copyButton = copyButtonTemplate?.content.firstElementChild?.cloneNode(true);
  const actions = entry.querySelector('.entry-actions');
  if (copyButton instanceof HTMLButtonElement && actions) {
    actions.append(copyButton);
    setUpCopyButton(copyButton, entry);
  }

  setOpen(entry, entry === initialTarget);
}

// 點到頁內錨點（相關詞條、Mogu 前綴、字母索引）時先處理目標，再讓瀏覽器照常捲過去。
// 連到目前錨點的連結不會觸發 hashchange，所以在 click 就處理。
document.addEventListener('click', (event) => {
  const clicked = event.target instanceof Element ? event.target : null;
  // 點字母索引面板以外的地方就收起面板。
  if (alphaJump?.open && clicked && !alphaJump.contains(clicked)) alphaJump.open = false;

  const link = clicked?.closest('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;
  const url = new URL(link.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname) return;
  const target = targetForHash(url.hash);
  if (!target) return;
  if (alphaJump?.contains(link)) alphaJump.open = false;
  revealTarget(target);
});

// 上一頁、下一頁或手動改網址的錨點。目標原本被篩選藏起來，或收起別的詞條後被擠出畫面時，
// 瀏覽器不會再捲一次，要自己捲。
window.addEventListener('hashchange', () => {
  const target = targetForHash(location.hash);
  if (!target) return;
  revealTarget(target);
  const top = target.getBoundingClientRect().top;
  if (top < toolbarBottom() - 1 || top >= window.innerHeight) {
    target.scrollIntoView({ block: 'start' });
  }
});

// ─── 字母索引 ──────────────────────────────────────────────────
// 索引按鈕顯示目前捲到的字母；面板裡同一個字母標成目前位置。
function updateCurrentLetter() {
  // 跳到某個字母時，標題停在控制列下方約半行（scroll-padding-top 多留的空間），也要算進去。
  const line = toolbarBottom() + 16;
  let current: string | undefined;
  for (const section of sections) {
    if (section.hidden) continue;
    if (section.getBoundingClientRect().top > line) break;
    current = section.dataset.letter;
  }

  if (currentLetterEl) currentLetterEl.textContent = current ?? currentLetterEl.dataset.idle ?? '';
  letterLinks.forEach((link) => {
    if (link.dataset.letter === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

let letterFrame = 0;
window.addEventListener(
  'scroll',
  () => {
    if (letterFrame) return;
    letterFrame = requestAnimationFrame(() => {
      letterFrame = 0;
      updateCurrentLetter();
    });
  },
  { passive: true }
);
updateCurrentLetter();

alphaJump?.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !alphaJump.open) return;
  alphaJump.open = false;
  alphaJump.querySelector('summary')?.focus();
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
      }, 1500);
    } catch {
      // 剪貼簿被拒或不能用：不顯示「已複製」。
    }
  });
}
