// @ts-check
/* global document, window, localStorage, atob, CustomEvent */

const JWT_KEY = 'gu-log-jwt';
const RETURN_KEY = 'gu-log-return-url';

/**
 * @typedef {object} JwtPayload
 * @property {string} [email]
 * @property {string} [login]
 * @property {string} [sub]
 * @property {number} [exp]
 */

function getJwt() {
  try {
    return localStorage.getItem(JWT_KEY);
  } catch (_error) {
    return null;
  }
}

/**
 * @param {string} token
 * @returns {JwtPayload | null}
 */
function parseJwt(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '==='.slice((normalized.length + 3) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const payload = /** @type {JwtPayload} */ (parsed);
    if ('exp' in payload && (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp))) {
      return null;
    }
    return payload;
  } catch (_error) {
    return null;
  }
}

/**
 * @param {JwtPayload | null} payload
 * @returns {string | null}
 */
function getIdentity(payload) {
  if (!payload || (typeof payload.exp === 'number' && payload.exp <= Date.now() / 1000)) {
    return null;
  }

  for (const claim of [payload.email, payload.login, payload.sub]) {
    if (typeof claim === 'string' && claim.trim()) return claim;
  }
  return null;
}

/**
 * @param {Element} container
 * @returns {(() => void) | null}
 */
function initializeContainer(container) {
  const loggedOut = /** @type {HTMLElement | null} */ (
    container.querySelector('[data-login-logged-out]')
  );
  const loggedIn = /** @type {HTMLElement | null} */ (
    container.querySelector('[data-login-logged-in]')
  );
  const emailNode = /** @type {HTMLElement | null} */ (
    container.querySelector('[data-login-email]')
  );
  const loginButton = /** @type {HTMLAnchorElement | null} */ (
    container.querySelector('[data-login-action="login"]')
  );
  const logoutButton = /** @type {HTMLButtonElement | null} */ (
    container.querySelector('[data-login-action="logout"]')
  );

  if (!loggedOut || !loggedIn || !emailNode || !loginButton || !logoutButton) return null;
  const nodes = { loggedOut, loggedIn, emailNode };

  function render() {
    const jwt = getJwt();
    const payload = jwt ? parseJwt(jwt) : null;
    const identity = getIdentity(payload);

    if (identity) {
      nodes.emailNode.textContent = identity;
      nodes.loggedOut.hidden = true;
      nodes.loggedIn.hidden = false;
    } else {
      nodes.emailNode.textContent = '';
      nodes.loggedOut.hidden = false;
      nodes.loggedIn.hidden = true;
    }

    /** @type {HTMLElement} */ (container).style.display = 'block';
    window.dispatchEvent(
      new CustomEvent('gu-log-auth-changed', { detail: { authenticated: Boolean(identity) } })
    );
  }

  loginButton.addEventListener('click', () => {
    try {
      localStorage.setItem(RETURN_KEY, window.location.href);
    } catch (_error) {
      // Navigation still works when storage is unavailable.
    }
  });

  logoutButton.addEventListener('click', () => {
    try {
      localStorage.removeItem(JWT_KEY);
    } catch (_error) {
      // Keep the authenticated UI when storage cannot persist the logout.
      return;
    }
    render();
    loginButton.focus();
  });

  render();
  return render;
}

const renderers = Array.from(
  document.querySelectorAll('[data-article-action-area] > .login-cta-container[data-login-cta]'),
  initializeContainer
).filter(Boolean);

// Re-run if localStorage changes (e.g. from another tab)
window.addEventListener('storage', (event) => {
  if (event.key === JWT_KEY) {
    for (const render of renderers) render?.();
  }
});
