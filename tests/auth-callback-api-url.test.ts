import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function renderCallback(apiUrl: string) {
  vi.stubEnv('PUBLIC_API_URL', apiUrl);
  vi.resetModules();

  const [{ default: AuthCallback }, container] = await Promise.all([
    import('../src/pages/auth/callback.astro'),
    AstroContainer.create(),
  ]);

  return container.renderToString(AuthCallback);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('auth callback API URL', () => {
  it.each([
    ['HTTPS', 'https://api.example.test/', 'https://api.example.test/auth/github'],
    ['HTTP', 'http://localhost:8787/', 'http://localhost:8787/auth/github'],
  ])(
    'normalizes an %s API base before rendering the retry link',
    async (_label, apiUrl, loginUrl) => {
      const html = await renderCallback(apiUrl);

      expect(html).toContain(`href="${loginUrl}"`);
    }
  );

  it('fails closed instead of rendering a script-scheme retry link', async () => {
    await expect(renderCallback('javascript:alert(document.domain)//')).rejects.toThrow(
      'PUBLIC_API_URL must use http or https'
    );
  });
});
