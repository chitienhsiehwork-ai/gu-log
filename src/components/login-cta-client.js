// @ts-check
/* global document, window, localStorage, atob */

const JWT_KEY = 'gu-log-jwt';
const RETURN_KEY = 'gu-log-return-url';

const container = /** @type {HTMLElement | null} */ (
  document.querySelector('.login-cta-container[data-login-cta]')
);
const loggedOut = /** @type {HTMLElement | null} */ (
  container?.querySelector('[data-login-logged-out]') ?? null
);
const loggedIn = /** @type {HTMLElement | null} */ (
  container?.querySelector('[data-login-logged-in]') ?? null
);
const emailNode = /** @type {HTMLElement | null} */ (
  container?.querySelector('[data-login-email]') ?? null
);
const loginButton = /** @type {HTMLAnchorElement | null} */ (
  container?.querySelector('#cta-login-btn') ?? null
);
const logoutButton = /** @type {HTMLButtonElement | null} */ (
  container?.querySelector('#cta-logout-btn') ?? null
);

/**
 * @typedef {object} JwtPayload
 * @property {string} [email]
 * @property {string} [login]
 * @property {string} [sub]
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
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return /** @type {JwtPayload} */ (JSON.parse(json));
  } catch (_error) {
    return null;
  }
}

loginButton?.addEventListener('click', () => {
  try {
    localStorage.setItem(RETURN_KEY, window.location.href);
  } catch (_error) {
    // Navigation still works when storage is unavailable.
  }
});

logoutButton?.addEventListener('click', () => {
  try {
    localStorage.removeItem(JWT_KEY);
  } catch (_error) {
    // Keep the authenticated UI when storage cannot persist the logout.
    return;
  }
  render();
});

function render() {
  if (!container || !loggedOut || !loggedIn || !emailNode) return;

  const jwt = getJwt();
  let email = null;
  if (jwt) {
    const payload = parseJwt(jwt);
    email = (payload && (payload.email || payload.login || payload.sub)) || '?';
  }

  if (email) {
    emailNode.textContent = email;
    loggedOut.hidden = true;
    loggedIn.hidden = false;
  } else {
    emailNode.textContent = '';
    loggedOut.hidden = false;
    loggedIn.hidden = true;
  }

  container.style.display = 'block';
}

// Run on load
render();

// Re-run if localStorage changes (e.g. from another tab)
window.addEventListener('storage', (event) => {
  if (event.key === JWT_KEY) render();
});
