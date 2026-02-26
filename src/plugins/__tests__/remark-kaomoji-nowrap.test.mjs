import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { protectKaomoji } from '../remark-kaomoji-nowrap.mjs';

const NBSP = '\u00A0';
const WJ = '\u2060';

describe('protectKaomoji', () => {
  // --- Should NOT modify ---

  it('should not modify plain text', () => {
    assert.equal(protectKaomoji('Hello world'), 'Hello world');
  });

  it('should not modify regular parenthesized text', () => {
    const input = 'This is (a normal sentence) here';
    assert.equal(protectKaomoji(input), input);
  });

  it('should not modify code-like parens', () => {
    const input = 'console.log(value)';
    assert.equal(protectKaomoji(input), input);
  });

  it('should not modify short parens like (1) or (a)', () => {
    const input = 'Step (1) is important';
    assert.equal(protectKaomoji(input), input);
  });

  // --- Should protect: no-space kaomoji with arm ---

  it('should join arm ／ to closing paren with WJ', () => {
    const input = '不瘋。(￣▽￣)／';
    const result = protectKaomoji(input);
    // ／ must not be separable from )
    assert.ok(result.includes(`)${WJ}／`), `expected WJ between ) and ／, got: ${JSON.stringify(result)}`);
  });

  it('should join arm ╯ to closing paren with WJ (table flip)', () => {
    const input = 'angry (╯°□°)╯';
    const result = protectKaomoji(input);
    assert.ok(result.includes(`)${WJ}╯`), `expected WJ between ) and ╯, got: ${JSON.stringify(result)}`);
  });

  // --- Should protect: space inside kaomoji ---

  it('should replace spaces inside kaomoji with NBSP', () => {
    const input = 'test ( ￣▽￣)';
    const result = protectKaomoji(input);
    assert.ok(result.includes(`(${NBSP}￣▽￣)`), `expected NBSP, got: ${JSON.stringify(result)}`);
  });

  // --- Should protect: bear face ---

  it('should keep bear face ʕ•ᴥ•ʔ intact', () => {
    const input = '請多指教 ʕ•ᴥ•ʔ';
    const result = protectKaomoji(input);
    assert.ok(result.includes('ʕ•ᴥ•ʔ'), 'bear face should be preserved');
  });

  // --- Should protect: kaomoji with katakana arm ---

  it('should join katakana arm ノ to closing paren with WJ', () => {
    const input = '(◍˃̶ᗜ˂̶◍)ノ"';
    const result = protectKaomoji(input);
    assert.ok(result.includes(`)${WJ}ノ`), `expected WJ before ノ, got: ${JSON.stringify(result)}`);
  });

  it('should join arabic arm ﻭ to closing paren with WJ', () => {
    const input = 'yay (๑˃ᴗ˂)ﻭ';
    const result = protectKaomoji(input);
    assert.ok(result.includes(`)${WJ}ﻭ`), `expected WJ before ﻭ, got: ${JSON.stringify(result)}`);
  });

  // --- Multiple kaomoji in one text ---

  it('should protect multiple kaomoji in one string', () => {
    const input = 'start (╯°□°)╯ middle (￣▽￣)／ end';
    const result = protectKaomoji(input);
    assert.ok(result.includes(`)${WJ}╯`), 'first kaomoji arm should be joined');
    assert.ok(result.includes(`)${WJ}／`), 'second kaomoji arm should be joined');
  });

  // --- Idempotency ---

  it('should be idempotent (running twice gives same result)', () => {
    const input = '不瘋。(￣▽￣)／';
    const once = protectKaomoji(input);
    const twice = protectKaomoji(once);
    assert.equal(once, twice);
  });
});
