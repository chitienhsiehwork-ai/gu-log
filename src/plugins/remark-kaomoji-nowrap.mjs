/**
 * remark-kaomoji-nowrap
 *
 * Remark plugin that prevents kaomoji from being split by word-wrap.
 *
 * Strategy (Option 3 — content-layer fix):
 *   1. Replace ASCII spaces inside kaomoji with NBSP (\u00A0)
 *   2. Insert Word Joiner (\u2060) between closing bracket and arm characters
 *
 * This is invisible, zero-CSS, and works in any renderer (RSS, email, etc.)
 */

import { visit } from 'unist-util-visit';

const NBSP = '\u00A0';
const WJ = '\u2060';

// Characters that signal "this bracketed text is a kaomoji, not regular text"
// Includes common face parts: eyes, mouths, cheeks, decorative marks
const KAOMOJI_CHARS =
  /[°□▽￣ᴥᴗ◍๑˃˂ᗜ̶ಠ∀ω·•‿ᵕ╥﹏☆ᴗ⁰]/;

// Arm / trailing characters that follow the closing bracket
const ARM_CHARS = '[╯ﻭ／ノ┻━"ゞ☆♪♡]';
const ARM_RE = new RegExp(ARM_CHARS + '+');

// Match potential kaomoji:
//   Pattern A: ʕ ... ʔ  (bear-style)
//   Pattern B: ( ... )  or （ ... ）  followed by optional arm chars
const POTENTIAL_KAOMOJI = new RegExp(
  '(?:' +
    'ʕ[^\\n\\r]{1,15}ʔ' +                           // bear: ʕ•ᴥ•ʔ
    '|' +
    '[（(][^\\n\\r()（）]{1,25}[）)]' + ARM_CHARS + '*' +  // paren-based + arms
  ')',
  'g',
);

/**
 * Protect a single kaomoji match:
 *   - Replace internal ASCII spaces with NBSP
 *   - Insert WJ between closing bracket and arm characters
 */
function protect(match) {
  let result = match;

  // 1. Replace ASCII spaces with NBSP (idempotent: NBSP stays NBSP)
  result = result.replace(/ /g, NBSP);

  // 2. Insert WJ between closing bracket and arm
  //    e.g. )／  →  )⁠／      )╯  →  )⁠╯
  //    Only insert if WJ not already there (idempotent)
  result = result.replace(
    new RegExp('([）)ʔ])(?!' + WJ + ')(' + ARM_CHARS + ')', 'g'),
    `$1${WJ}$2`,
  );

  return result;
}

/**
 * Process a text string: find kaomoji and protect them.
 * Exported for unit testing.
 */
export function protectKaomoji(text) {
  return text.replace(POTENTIAL_KAOMOJI, (match) => {
    // Only transform if it actually looks like a kaomoji (contains face chars)
    if (!KAOMOJI_CHARS.test(match)) return match;
    return protect(match);
  });
}

/**
 * Remark plugin entry point.
 */
export default function remarkKaomojiNowrap() {
  return (tree) => {
    visit(tree, 'text', (node) => {
      node.value = protectKaomoji(node.value);
    });
  };
}
