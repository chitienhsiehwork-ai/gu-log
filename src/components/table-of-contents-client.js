// @ts-check
/* global cancelAnimationFrame, document, getComputedStyle, history, HTMLElement, requestAnimationFrame, ResizeObserver, window */

/** @type {(() => void) | undefined} */
let cleanupScrollHighlight;
/** @type {(() => void) | undefined} */
let cleanupSmoothScroll;
/** @type {(() => void) | undefined} */
let cleanupMobileToggle;

function initTableOfContents() {
  cleanupScrollHighlight?.();
  cleanupScrollHighlight = undefined;
  cleanupSmoothScroll?.();
  cleanupSmoothScroll = undefined;

  const tocContainer = document.querySelector('.toc-container');
  if (!tocContainer) return;

  // Get all heading IDs from TOC links
  const tocLinks = Array.from(tocContainer.querySelectorAll('.toc-link'));
  /** @type {Map<string, Element[]>} */
  const linksByHeadingId = new Map();
  for (const link of tocLinks) {
    const headingId = link.getAttribute('data-heading-id');
    if (!headingId) continue;

    const matchingLinks = linksByHeadingId.get(headingId);
    if (matchingLinks) {
      matchingLinks.push(link);
    } else {
      linksByHeadingId.set(headingId, [link]);
    }
  }
  const headings = Array.from(linksByHeadingId.keys())
    .map((id) => document.getElementById(id))
    .filter((heading) => heading instanceof HTMLElement);

  if (headings.length === 0) return;

  cleanupScrollHighlight = setupScrollHighlight(tocContainer, headings, linksByHeadingId);
  cleanupSmoothScroll = setupSmoothScroll(tocContainer);
}

/**
 * @param {Element} tocContainer
 * @param {HTMLElement[]} headings
 * @param {Map<string, Element[]>} linksByHeadingId
 */
function setupScrollHighlight(tocContainer, headings, linksByHeadingId) {
  const desktopToc = /** @type {HTMLElement | null} */ (tocContainer.querySelector('.toc-desktop'));
  const postHeader = /** @type {HTMLElement | null} */ (document.querySelector('.post-header'));
  let animationFrameId = 0;
  /** @type {string | undefined} */
  let activeHeadingId;

  /** @param {boolean} visible */
  function setDesktopTocVisibility(visible) {
    if (!desktopToc) return;

    desktopToc.dataset.visible = visible.toString();
    desktopToc.setAttribute('aria-hidden', (!visible).toString());
    desktopToc.toggleAttribute('inert', !visible);
  }

  function updateViewportState() {
    if (desktopToc && postHeader) {
      const desktopTocStyle = getComputedStyle(desktopToc);
      const tocTop = Number.parseFloat(desktopTocStyle.top);
      const headerHasPassedToc = postHeader.getBoundingClientRect().bottom <= tocTop;
      setDesktopTocVisibility(desktopTocStyle.display !== 'none' && headerHasPassedToc);
    } else {
      setDesktopTocVisibility(false);
    }

    const scrollPos = window.scrollY + 100;

    let currentHeading = headings[0];
    for (const heading of headings) {
      const offsetTop = heading.getBoundingClientRect().top + window.scrollY;
      if (offsetTop <= scrollPos) {
        currentHeading = heading;
      } else {
        break;
      }
    }

    const nextActiveHeadingId = currentHeading?.id;
    if (nextActiveHeadingId && nextActiveHeadingId !== activeHeadingId) {
      if (activeHeadingId) {
        linksByHeadingId.get(activeHeadingId)?.forEach((link) => {
          link.classList.remove('active');
        });
      }
      linksByHeadingId.get(nextActiveHeadingId)?.forEach((link) => {
        link.classList.add('active');
      });
      activeHeadingId = nextActiveHeadingId;
    }

    animationFrameId = 0;
  }

  function scheduleViewportUpdate() {
    if (animationFrameId !== 0) return;
    animationFrameId = requestAnimationFrame(updateViewportState);
  }

  window.addEventListener('scroll', scheduleViewportUpdate, { passive: true });
  window.addEventListener('pageshow', scheduleViewportUpdate);
  window.addEventListener('hashchange', scheduleViewportUpdate);
  window.addEventListener('resize', scheduleViewportUpdate);

  const headerResizeObserver = new ResizeObserver(scheduleViewportUpdate);
  if (postHeader) {
    headerResizeObserver.observe(postHeader);
  }

  scheduleViewportUpdate();

  return () => {
    window.removeEventListener('scroll', scheduleViewportUpdate);
    window.removeEventListener('pageshow', scheduleViewportUpdate);
    window.removeEventListener('hashchange', scheduleViewportUpdate);
    window.removeEventListener('resize', scheduleViewportUpdate);
    headerResizeObserver.disconnect();
    if (animationFrameId !== 0) {
      cancelAnimationFrame(animationFrameId);
    }
    if (activeHeadingId) {
      linksByHeadingId.get(activeHeadingId)?.forEach((link) => {
        link.classList.remove('active');
      });
    }
  };
}

/** @param {Element} tocContainer */
function setupSmoothScroll(tocContainer) {
  const SCROLL_OFFSET = 80; // px offset from top to account for reading progress bar etc.
  const TOC_COLLAPSE_DURATION = 400; // ms — CSS transition is 300ms cubic-bezier + 100ms buffer
  /** @type {Array<() => void>} */
  const cleanups = [];
  /** @type {Set<number>} */
  const pendingScrollTimeouts = new Set();

  tocContainer.querySelectorAll('.toc-link').forEach((link) => {
    /** @param {Event} event */
    const handleClick = (event) => {
      event.preventDefault();
      if (!(event.currentTarget instanceof HTMLElement)) return;
      const href = event.currentTarget.getAttribute('href');
      if (!href) return;

      const targetId = href.replace('#', '');
      const target = document.getElementById(targetId);

      if (target) {
        // Close mobile TOC before measuring: collapsing it changes the target's page position.
        const mobileContainer = tocContainer.querySelector('.toc-mobile .toc-toggle-container');
        const isMobileOpen =
          window.innerWidth < 1280 && mobileContainer?.getAttribute('data-open') === 'true';

        if (isMobileOpen) {
          mobileContainer.setAttribute('data-open', 'false');
          mobileContainer
            .querySelector('.toc-toggle-header')
            ?.setAttribute('aria-expanded', 'false');

          const timeoutId = window.setTimeout(() => {
            pendingScrollTimeouts.delete(timeoutId);
            const targetTop = target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
            window.scrollTo({
              top: targetTop,
              behavior: /** @type {ScrollBehavior} */ ('instant'),
            });
          }, TOC_COLLAPSE_DURATION);
          pendingScrollTimeouts.add(timeoutId);
        } else {
          const targetTop = target.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
          window.scrollTo({ top: targetTop, behavior: 'smooth' });
        }

        history.pushState(null, '', href);
      }
    };

    link.addEventListener('click', handleClick);
    cleanups.push(() => link.removeEventListener('click', handleClick));
  });

  return () => {
    cleanups.forEach((cleanup) => cleanup());
    pendingScrollTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    pendingScrollTimeouts.clear();
  };
}

function setupMobileToggle() {
  cleanupMobileToggle?.();
  cleanupMobileToggle = undefined;

  const tocMobile = document.querySelector('.toc-container')?.querySelector('.toc-mobile');
  if (!tocMobile) return;

  const toggleHeader = tocMobile.querySelector('.toc-toggle-header');
  const container = tocMobile.querySelector('.toc-toggle-container');

  if (!toggleHeader || !container) return;

  const handleToggle = () => {
    const isOpen = container.getAttribute('data-open') === 'true';
    container.setAttribute('data-open', (!isOpen).toString());
    toggleHeader.setAttribute('aria-expanded', (!isOpen).toString());
  };

  toggleHeader.addEventListener('click', handleToggle);
  cleanupMobileToggle = () => toggleHeader.removeEventListener('click', handleToggle);
}

initTableOfContents();
setupMobileToggle();
document.addEventListener('astro:page-load', () => {
  initTableOfContents();
  setupMobileToggle();
});
