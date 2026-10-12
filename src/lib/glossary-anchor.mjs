/**
 * Glossary 錨點的唯一規則（openspec: glossary-link-coverage〈Glossary 錨點 SHALL 由單一規則推導〉）。
 *
 * 詞彙表頁面的詞條 id、頁內 related 連結、check-glossary-links.mjs 與
 * apply-glossary-links.mjs 都從這裡取錨點；Librarian packet 讀 checker 的結果。
 * 不要在別處自己推錨點。
 */

/**
 * 由 canonical term 推出錨點：只留英數、空白與連字號，空白換成連字號。
 * 文章裡既有的 `/glossary#…` 連結都是照這條規則寫的。
 * @param {unknown} value
 * @returns {string}
 */
export function slugifyGlossaryTerm(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * 詞條的錨點：有設定 `linking.anchor` 就用它，否則由 canonical term 推導。
 * @param {{ term?: string, linking?: { anchor?: string } } | undefined} entry
 * @returns {string}
 */
export function glossaryAnchor(entry) {
  return entry?.linking?.anchor || slugifyGlossaryTerm(entry?.term ?? '');
}

/**
 * related 指向另一個詞條，錨點取那個詞條自己的（含 `linking.anchor`）。
 * @param {Array<{ term?: string, linking?: { anchor?: string } }>} entries
 * @param {string} term
 * @returns {string}
 */
export function relatedGlossaryAnchor(entries, term) {
  return glossaryAnchor(entries.find((entry) => entry?.term === term) ?? { term });
}

/**
 * 找出推不出錨點（例如純中文 term 又沒設 `linking.anchor`）或錨點重複的詞條。
 * @param {Array<{ term?: string, linking?: { anchor?: string } }>} entries
 * @returns {string[]} 每個問題一行，開頭是詞條名稱
 */
export function findGlossaryAnchorProblems(entries) {
  const problems = [];
  const owners = new Map();
  for (const entry of entries) {
    const anchor = glossaryAnchor(entry);
    if (!anchor) {
      problems.push(`${entry?.term}: 推不出錨點，需要設定 linking.anchor`);
      continue;
    }
    const owner = owners.get(anchor);
    if (owner === undefined) {
      owners.set(anchor, entry?.term);
    } else {
      problems.push(
        `${entry?.term}: 錨點 #${anchor} 跟 ${owner} 重複，需要設定不同的 linking.anchor`
      );
    }
  }
  return problems;
}
