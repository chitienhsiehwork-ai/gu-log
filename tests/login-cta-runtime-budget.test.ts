import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentUrl = new URL('../src/components/LoginCta.astro', import.meta.url);
const runtimeUrl = new URL('../src/components/login-cta-client.js', import.meta.url);

describe('LoginCta shared runtime budget', () => {
  it("ships its runtime through Vite's forced-external asset contract", () => {
    const component = readFileSync(componentUrl, 'utf8');

    expect(component).toContain(
      "import loginCtaRuntimeUrl from './login-cta-client.js?url&no-inline';"
    );
    expect(component).toContain(
      '<script is:inline type="module" src={loginCtaRuntimeUrl}></script>'
    );
    expect(component).toContain("buildPublicApiEndpoint(configuredApiUrl, '/auth/github')");
    expect(component).toContain('id="cta-login-btn"');
    expect(component).toContain('href={loginUrl}');
    expect(component).toContain('data-login-logged-out');
    expect(component).toContain('data-login-logged-in');
    expect(component).not.toContain("const RETURN_KEY = 'gu-log-return-url'");
    const runtime = readFileSync(runtimeUrl, 'utf8');
    expect(Buffer.byteLength(runtime)).toBeLessThanOrEqual(4096);
    expect(runtime).toContain(
      "'[data-article-action-area] > .login-cta-container[data-login-cta]'"
    );
    expect(runtime).toContain('container.querySelector(\'[data-login-action="login"]\')');
    expect(runtime).toContain("container.querySelector('[data-login-logged-out]')");
    expect(runtime).toContain("const RETURN_KEY = 'gu-log-return-url';");
    expect(runtime).not.toContain('dataset.apiUrl');
    expect(runtime).not.toContain("document.getElementById('cta-login-target')");
    expect(runtime).not.toContain('link.href');
    expect(runtime).not.toContain('loginTarget?.click()');
    expect(runtime).not.toContain("document.createElement('a')");
  });
});
