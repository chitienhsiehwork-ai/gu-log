import { describe, expect, it, vi } from 'vitest';
import { main, parseChatGPTShareUrl } from '../scripts/fetch-chatgpt-share.mjs';

describe('fetch-chatgpt-share URL boundary', () => {
  it.each([
    [
      'https://chatgpt.com/share/abc-123',
      {
        sourceUrl: 'https://chatgpt.com/share/abc-123',
        shareId: 'abc-123',
      },
    ],
    [
      'https://chatgpt.com/share/abc-123/',
      {
        sourceUrl: 'https://chatgpt.com/share/abc-123/',
        shareId: 'abc-123',
      },
    ],
    [
      'https://chatgpt.com/share/abc-123?utm_source=share',
      {
        sourceUrl: 'https://chatgpt.com/share/abc-123?utm_source=share',
        shareId: 'abc-123',
      },
    ],
  ])('accepts canonical share URL %s', (url, expected) => {
    expect(parseChatGPTShareUrl(url)).toEqual(expected);
  });

  it.each([
    'data:text/html,%3Chtml%3Ered-proof%3C/html%3E',
    'http://chatgpt.com/share/abc-123',
    'https://127.0.0.1/share/abc-123',
    'https://chatgpt.com.evil.example/share/abc-123',
    'https://user@chatgpt.com/share/abc-123',
    'https://chatgpt.com:444/share/abc-123',
    'https://chatgpt.com/api/share/abc-123',
    'https://chatgpt.com/share/',
    'https://chatgpt.com/share',
    'not a URL',
  ])('rejects non-canonical input %s', (url) => {
    expect(() => parseChatGPTShareUrl(url)).toThrow(
      'Expected a canonical ChatGPT share URL: https://chatgpt.com/share/<id>'
    );
  });

  it('rejects arbitrary URLs before fetching or parsing a response', async () => {
    const fetchImpl = vi.fn();

    await expect(
      main(['data:text/html,%3Chtml%3Ered-proof%3C/html%3E'], fetchImpl)
    ).rejects.toThrow('Expected a canonical ChatGPT share URL: https://chatgpt.com/share/<id>');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
