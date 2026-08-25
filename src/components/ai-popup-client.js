/* global AbortController, document, window, localStorage, atob, clearTimeout, setTimeout, fetch, requestAnimationFrame */

(function () {
  'use strict';

  const JWT_KEY = 'gu-log-jwt';
  const RETURN_KEY = 'gu-log-return-url';

  const root = document.querySelector('main > #ai-popup-root');
  if (!root) return;

  const loginTarget = root.querySelector('#ai-popup-login-target');
  const filePath = root.getAttribute('data-file-path') || '';
  const postTitle = root.getAttribute('data-post-title') || '';
  const apiUrl = root.getAttribute('data-api-url') || '';
  const lang = root.getAttribute('data-lang') || 'zh-tw';

  // i18n
  const t =
    lang === 'en'
      ? {
          askAi: '🤖 Ask AI',
          edit: '✏️ Edit with AI',
          login: '🔐 Login with GitHub',
          loading: 'Thinking...',
          loadingEdit: 'Preparing edit...',
          loadingConfirm: 'Committing change...',
          close: '✕',
          confirm: '✅ Confirm',
          cancel: '❌ Cancel',
          committed: 'Committed!',
          askTitle: 'Ask about this selection',
          askHint: 'Add an optional question for extra context.',
          editTitle: 'Edit with AI',
          editHint: 'Review the proposed diff before committing.',
          editInputHint: 'Tell AI how you want this selection changed.',
          selectedLabel: 'Selected text',
          emptyDiff: 'No suggested changes returned.',
          missingEditId: 'Missing edit ID. Please retry the edit step.',
          error: 'Something went wrong. Please try again.',
          submit: 'Submit',
          cancelAsk: 'Cancel',
          submitEdit: 'Generate edit',
          cancelEdit: 'Cancel',
          scopeHint: 'Scope: selected paragraph',
          retry: 'Retry',
          relogin: 'Re-login',
          sessionExpired: 'Session expired',
          questionPlaceholder: "What's your question?",
          editPlaceholder: 'How should this be changed? e.g. fix typo, make it clearer',
          networkError: 'Cannot connect to API server. Please check your network.',
          unknownError: 'An unknown error occurred.',
          undoHint: 'You can revert this change from Git history.',
        }
      : {
          askAi: '🤖 Ask AI',
          edit: '✏️ Edit with AI',
          login: '🔐 Login with GitHub',
          loading: '思考中...',
          loadingEdit: '正在產生編輯建議...',
          loadingConfirm: '正在提交修改...',
          close: '✕',
          confirm: '✅ 確認',
          cancel: '❌ 取消',
          committed: '已提交！',
          askTitle: '問這段文字',
          askHint: '可以補一句問題，讓 AI 更知道你想問什麼。',
          editTitle: 'Edit with AI',
          editHint: '先看 diff，確認沒問題再提交。',
          editInputHint: '告訴 AI 你想怎麼改這段文字。',
          selectedLabel: '目前選取',
          emptyDiff: 'AI 沒有提出可套用的修改。',
          missingEditId: '找不到 edit ID，請重新產生一次編輯建議。',
          error: '發生錯誤，請再試一次。',
          submit: '送出',
          cancelAsk: '取消',
          submitEdit: '產生修改',
          cancelEdit: '取消',
          scopeHint: '修改範圍：選取的段落',
          retry: '重試',
          relogin: '重新登入',
          sessionExpired: '登入已過期',
          questionPlaceholder: '想問什麼？例如：source code 是怎麼處理的？',
          editPlaceholder: '想怎麼改？例如：修 typo、改順一點、語氣輕鬆一點',
          networkError: '無法連線到 API 伺服器，請確認網路連線',
          unknownError: '發生未知錯誤',
          undoHint: '可從 Git 歷史回退此修改。',
        };

  let popup = null;
  let selectedText = '';
  let currentState = 'idle'; // idle, buttons, ask-input, loading, ask-result, edit-input, edit-result, confirm-loading, committed, error
  let pendingEditId = null;
  let lastEditInstruction = '';
  let lastAskQuestion = '';
  let errorDismissTimer = null;
  let requestGeneration = 0;
  let selectionGeneration = 0;
  let activeRequestController = null;

  function abortActiveRequest() {
    if (!activeRequestController) return;

    const controller = activeRequestController;
    activeRequestController = null;
    controller.abort();
  }

  function beginRequestContext() {
    requestGeneration += 1;
    abortActiveRequest();
    const controller = new AbortController();
    activeRequestController = controller;
    return {
      controller: controller,
      generation: requestGeneration,
      signal: controller.signal,
      selectedText: selectedText,
    };
  }

  function isRequestContextCurrent(context) {
    return (
      context.generation === requestGeneration &&
      context.selectedText === selectedText &&
      Boolean(popup)
    );
  }

  function finishRequestContext(context) {
    if (activeRequestController === context.controller) {
      activeRequestController = null;
    }
  }

  function invalidateRequestContext() {
    requestGeneration += 1;
    abortActiveRequest();
  }

  function clampText(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1) + '…';
  }

  function getJwt() {
    try {
      return localStorage.getItem(JWT_KEY);
    } catch (_error) {
      return null;
    }
  }

  function decodeJwtPayload(token) {
    if (!token) return null;

    try {
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some((part) => !part)) return null;
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '==='.slice((normalized.length + 3) % 4);
      const parsed = JSON.parse(atob(padded));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      if ('exp' in parsed && (typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp))) {
        return null;
      }
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function hasUsableJwt() {
    const payload = decodeJwtPayload(getJwt());
    if (!payload) return false;
    return typeof payload.exp !== 'number' || payload.exp > Date.now() / 1000;
  }

  function clearErrorDismissTimer() {
    if (errorDismissTimer) {
      clearTimeout(errorDismissTimer);
      errorDismissTimer = null;
    }
  }

  function scheduleErrorDismiss() {
    clearErrorDismissTimer();
    errorDismissTimer = setTimeout(function () {
      if (currentState === 'error') {
        removePopup();
      }
    }, 10000);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderInlineMarkdown(text) {
    return escapeHtml(text || '')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, function (_match, label, url) {
        return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
      });
  }

  function renderMarkdown(response) {
    const fragment = document.createDocumentFragment();
    const lines = String(response || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n');
    let paragraphLines = [];
    let listEl = null;
    let listType = '';
    let i = 0;

    function flushParagraph() {
      if (!paragraphLines.length) return;
      const paragraph = document.createElement('p');
      paragraph.innerHTML = paragraphLines.map(renderInlineMarkdown).join('<br>');
      fragment.appendChild(paragraph);
      paragraphLines = [];
    }

    function flushList() {
      if (!listEl) return;
      fragment.appendChild(listEl);
      listEl = null;
      listType = '';
    }

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        flushList();
        i += 1;
        continue;
      }

      if (/^```/.test(trimmed)) {
        flushParagraph();
        flushList();

        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^```/.test(lines[i].trim())) {
          codeLines.push(lines[i]);
          i += 1;
        }

        const pre = document.createElement('pre');
        const code = document.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.appendChild(code);
        fragment.appendChild(pre);
        i += 1;
        continue;
      }

      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        flushParagraph();
        flushList();
        const level = Math.min(headingMatch[1].length, 6);
        const heading = document.createElement('h' + level);
        heading.innerHTML = renderInlineMarkdown(headingMatch[2]);
        fragment.appendChild(heading);
        i += 1;
        continue;
      }

      const blockquoteMatch = trimmed.match(/^>\s?(.*)$/);
      if (blockquoteMatch) {
        flushParagraph();
        flushList();
        const quote = document.createElement('blockquote');
        const quoteLines = [blockquoteMatch[1]];
        i += 1;
        while (i < lines.length) {
          const nextMatch = lines[i].trim().match(/^>\s?(.*)$/);
          if (!nextMatch) break;
          quoteLines.push(nextMatch[1]);
          i += 1;
        }
        quote.innerHTML = quoteLines.map(renderInlineMarkdown).join('<br>');
        fragment.appendChild(quote);
        continue;
      }

      const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
      const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (unorderedMatch || orderedMatch) {
        flushParagraph();
        const nextListType = unorderedMatch ? 'ul' : 'ol';
        if (!listEl || listType !== nextListType) {
          flushList();
          listEl = document.createElement(nextListType);
          listType = nextListType;
        }
        const item = document.createElement('li');
        item.innerHTML = renderInlineMarkdown((unorderedMatch || orderedMatch)[1]);
        listEl.appendChild(item);
        i += 1;
        continue;
      }

      flushList();
      paragraphLines.push(line);
      i += 1;
    }

    flushParagraph();
    flushList();
    return fragment;
  }

  const closeLabel = lang === 'en' ? 'Close' : '關閉';
  const dialogLabel = lang === 'en' ? 'AI Popup' : 'AI 助手';

  function createPopup() {
    invalidateRequestContext();
    if (popup) popup.remove();

    popup = document.createElement('div');
    popup.id = 'ai-popup';
    popup.className = 'ai-popup';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-modal', 'true');
    popup.setAttribute('aria-label', dialogLabel);
    document.body.appendChild(popup);

    // Focus trap: keep Tab/Shift-Tab within the popup
    popup.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      const focusable = popup.querySelectorAll(
        'button:not([disabled]),input,textarea,a[href],[tabindex="0"]'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    return popup;
  }

  function updateDialogLabel(title) {
    if (popup) popup.setAttribute('aria-label', title || dialogLabel);
  }

  function createPanel(title, hint, className) {
    const panel = document.createElement('div');
    panel.className = className || 'ai-popup-panel';

    const header = document.createElement('div');
    header.className = 'ai-popup-panel-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'ai-popup-title';
    titleEl.textContent = title;

    header.appendChild(titleEl);

    if (hint) {
      const hintEl = document.createElement('div');
      hintEl.className = 'ai-popup-subtitle';
      hintEl.textContent = hint;
      header.appendChild(hintEl);
    }

    panel.appendChild(header);
    return panel;
  }

  function createSelectionPreview() {
    const preview = document.createElement('div');
    preview.className = 'ai-popup-selection';

    const label = document.createElement('div');
    label.className = 'ai-popup-selection-label';
    label.textContent = t.selectedLabel;

    const text = document.createElement('div');
    text.className = 'ai-popup-selection-text';
    text.textContent = clampText(selectedText, 220);

    preview.appendChild(label);
    preview.appendChild(text);
    return preview;
  }

  function removePopup() {
    invalidateRequestContext();
    clearErrorDismissTimer();
    if (popup) {
      popup.remove();
      popup = null;
    }
    currentState = 'idle';
    pendingEditId = null;
    selectedText = '';
  }

  function isPanel() {
    return (
      currentState === 'ask-input' ||
      currentState === 'ask-result' ||
      currentState === 'edit-input' ||
      currentState === 'edit-result' ||
      currentState === 'error' ||
      currentState === 'committed'
    );
  }

  function positionPopup(rect) {
    if (!popup) return;

    const isMobile = window.innerWidth < 640;

    if (isMobile) {
      // Bottom sheet style
      popup.classList.add('ai-popup--mobile');
      popup.classList.remove('ai-popup--desktop');
      popup.classList.remove('ai-popup--sidebar');
    } else if (isPanel()) {
      // Sidebar mode: fixed to right side, doesn't block content
      popup.classList.remove('ai-popup--mobile');
      popup.classList.remove('ai-popup--desktop');
      popup.classList.add('ai-popup--sidebar');
      popup.style.top = '';
      popup.style.left = '';
    } else {
      // Float near selection (buttons only)
      popup.classList.remove('ai-popup--mobile');
      popup.classList.remove('ai-popup--sidebar');
      popup.classList.add('ai-popup--desktop');

      const popupRect = popup.getBoundingClientRect();
      let top = rect.top + window.scrollY - popupRect.height - 8;
      let left = rect.left + window.scrollX + rect.width / 2 - popupRect.width / 2;

      // Keep within viewport
      if (top < window.scrollY + 8) {
        top = rect.bottom + window.scrollY + 8;
      }
      left = Math.max(8, Math.min(left, window.innerWidth - popupRect.width - 8));

      popup.style.top = top + 'px';
      popup.style.left = left + 'px';
    }
  }

  function renderButtons() {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'buttons';
    updateDialogLabel(dialogLabel);

    if (!hasUsableJwt()) {
      popup.innerHTML =
        '<button class="ai-popup-btn ai-popup-btn--login" data-action="login">' +
        escapeHtml(t.login) +
        '</button>';
    } else {
      popup.innerHTML =
        '<button class="ai-popup-btn ai-popup-btn--ask" data-action="ask">' +
        escapeHtml(t.askAi) +
        '</button>' +
        '<button class="ai-popup-btn ai-popup-btn--edit" data-action="edit">' +
        escapeHtml(t.edit) +
        '</button>';
    }
  }

  function renderLoading(message, state = 'loading') {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = state;

    popup.innerHTML =
      '<div class="ai-popup-loading">' +
      '<div class="ai-popup-spinner"></div>' +
      '<span>' +
      escapeHtml(message || t.loading) +
      '</span>' +
      '</div>';
  }

  function renderAskInput() {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'ask-input';
    updateDialogLabel(t.askTitle);

    const content = createPanel(t.askTitle, t.askHint, 'ai-popup-ask-input-container');

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ai-popup-question-input';
    input.placeholder = t.questionPlaceholder;
    input.setAttribute('aria-label', t.questionPlaceholder);

    const actions = document.createElement('div');
    actions.className = 'ai-popup-actions';
    actions.innerHTML =
      '<button class="ai-popup-btn ai-popup-btn--primary" data-action="submit-ask">' +
      escapeHtml(t.submit) +
      '</button>' +
      '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="cancel-ask">' +
      escapeHtml(t.cancelAsk) +
      '</button>';

    content.appendChild(createSelectionPreview());
    content.appendChild(input);
    content.appendChild(actions);

    popup.innerHTML = '';
    popup.appendChild(content);

    // Focus the input
    input.focus();

    // Allow Enter key to submit
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmitAsk();
      }
    });

    positionPopup(getSelectionRect() || { top: 0, left: 0, bottom: 0, width: 0 });
  }

  function renderAskResult(response) {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'ask-result';
    updateDialogLabel(t.askTitle);

    const content = createPanel(t.askTitle, '', 'ai-popup-result');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai-popup-close';
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.textContent = t.close;
    closeBtn.setAttribute('aria-label', closeLabel);

    content.appendChild(createSelectionPreview());

    const body = document.createElement('div');
    body.className = 'ai-popup-result-body';
    body.appendChild(renderMarkdown(response));

    content.appendChild(closeBtn);
    content.appendChild(body);

    popup.innerHTML = '';
    popup.appendChild(content);

    // Re-position for larger content
    positionPopup(getSelectionRect() || { top: 0, left: 0, bottom: 0, width: 0 });
  }

  function renderEditInput(prefill) {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'edit-input';
    updateDialogLabel(t.editTitle);

    const content = createPanel(t.editTitle, t.editInputHint, 'ai-popup-ask-input-container');

    // Scope indicator
    const scope = document.createElement('div');
    scope.className = 'ai-popup-scope';
    scope.textContent = t.scopeHint;

    const input = document.createElement('textarea');
    input.className = 'ai-popup-edit-input';
    input.placeholder = t.editPlaceholder;
    input.setAttribute('aria-label', t.editPlaceholder);
    input.rows = 3;
    input.value = prefill || '';

    const actions = document.createElement('div');
    actions.className = 'ai-popup-actions';
    actions.innerHTML =
      '<button class="ai-popup-btn ai-popup-btn--primary" data-action="submit-edit">' +
      escapeHtml(t.submitEdit) +
      '</button>' +
      '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="cancel-edit">' +
      escapeHtml(t.cancelEdit) +
      '</button>';

    content.appendChild(scope);
    content.appendChild(createSelectionPreview());
    content.appendChild(input);
    content.appendChild(actions);

    popup.innerHTML = '';
    popup.appendChild(content);

    input.focus();

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmitEdit();
      }
    });

    positionPopup(getSelectionRect() || { top: 0, left: 0, bottom: 0, width: 0 });
  }

  function renderEditResult(diff, editId) {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'edit-result';
    pendingEditId = editId;
    updateDialogLabel(t.editTitle);

    const content = createPanel(t.editTitle, t.editHint, 'ai-popup-result');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ai-popup-close';
    closeBtn.setAttribute('data-action', 'close');
    closeBtn.textContent = t.close;
    closeBtn.setAttribute('aria-label', closeLabel);

    content.appendChild(createSelectionPreview());

    const diffEl = document.createElement('div');
    diffEl.className = 'ai-popup-diff';

    // Render diff lines
    const lines = (diff || t.emptyDiff).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineEl = document.createElement('div');
      lineEl.className = 'ai-popup-diff-line';
      if (line.indexOf('+') === 0 && line.indexOf('+++') !== 0) {
        lineEl.className += ' ai-popup-diff-add';
      } else if (line.indexOf('-') === 0 && line.indexOf('---') !== 0) {
        lineEl.className += ' ai-popup-diff-remove';
      }
      lineEl.textContent = line;
      diffEl.appendChild(lineEl);
    }

    const actions = document.createElement('div');
    actions.className = 'ai-popup-actions';
    const confirmAttrs = pendingEditId ? '' : ' disabled aria-disabled="true"';
    actions.innerHTML =
      '<button class="ai-popup-btn ai-popup-btn--primary ai-popup-btn--confirm" data-action="confirm"' +
      confirmAttrs +
      '>' +
      escapeHtml(t.confirm) +
      '</button>' +
      '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="retry">' +
      escapeHtml(t.retry) +
      '</button>' +
      '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="close">' +
      escapeHtml(t.cancel) +
      '</button>';

    content.appendChild(closeBtn);
    content.appendChild(diffEl);
    content.appendChild(actions);

    popup.innerHTML = '';
    popup.appendChild(content);

    positionPopup(getSelectionRect() || { top: 0, left: 0, bottom: 0, width: 0 });
  }

  function renderCommitted(commitHash) {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'committed';

    popup.innerHTML =
      '<div class="ai-popup-result">' +
      '<button class="ai-popup-close" data-action="close" aria-label="' +
      escapeHtml(closeLabel) +
      '">' +
      escapeHtml(t.close) +
      '</button>' +
      '<div class="ai-popup-panel-header">' +
      '<div class="ai-popup-title">' +
      escapeHtml(t.editTitle) +
      '</div>' +
      '</div>' +
      '<div class="ai-popup-committed">' +
      '<span class="ai-popup-committed-icon">✅</span> ' +
      escapeHtml(t.committed) +
      (commitHash ? ' <code>' + escapeHtml(commitHash.substring(0, 7)) + '</code>' : '') +
      '</div>' +
      '<div class="ai-popup-undo-hint">' +
      escapeHtml(t.undoHint) +
      '</div>' +
      '</div>';
  }

  function isTokenErrorMessage(msg) {
    const text = String(msg || '');
    // Only match user-session token errors, not backend Claude API auth failures
    if (/claude/i.test(text)) return false;
    return /token/i.test(text) && /(expired|invalid)/i.test(text);
  }

  function renderError(msg) {
    if (!popup) return;
    clearErrorDismissTimer();
    currentState = 'error';

    const isAuthError = isTokenErrorMessage(msg);
    const title = isAuthError ? t.sessionExpired : t.error;
    const actionsHtml = isAuthError
      ? '<button class="ai-popup-btn ai-popup-btn--primary ai-popup-btn--login" data-action="relogin">' +
        escapeHtml(t.relogin) +
        '</button>' +
        '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="retry">' +
        escapeHtml(t.retry) +
        '</button>'
      : '<button class="ai-popup-btn ai-popup-btn--primary" data-action="retry">' +
        escapeHtml(t.retry) +
        '</button>';

    popup.innerHTML =
      '<div class="ai-popup-result ai-popup-result--error' +
      (isAuthError ? ' ai-popup-result--auth-error' : '') +
      '">' +
      '<button class="ai-popup-close" data-action="close" aria-label="' +
      escapeHtml(closeLabel) +
      '">' +
      escapeHtml(t.close) +
      '</button>' +
      '<div class="ai-popup-panel-header">' +
      '<div class="ai-popup-title">' +
      escapeHtml(title) +
      '</div>' +
      '</div>' +
      '<div class="ai-popup-error-text">' +
      escapeHtml(msg || t.error) +
      '</div>' +
      '<div class="ai-popup-actions">' +
      actionsHtml +
      '<button class="ai-popup-btn ai-popup-btn--ghost" data-action="close">' +
      escapeHtml(t.cancel) +
      '</button>' +
      '</div>' +
      '</div>';

    scheduleErrorDismiss();
    positionPopup(getSelectionRect() || { top: 0, left: 0, bottom: 0, width: 0 });
  }

  function getSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  function isInsidePostContent(node) {
    let el = node.nodeType === 3 ? node.parentElement : node;
    while (el) {
      if (el.classList && el.classList.contains('post-content')) return true;
      el = el.parentElement;
    }
    return false;
  }

  function formatErrorDetail(detail) {
    if (Array.isArray(detail)) {
      const parts = [];
      for (let i = 0; i < detail.length; i++) {
        const item = detail[i];
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : '';
          const msg = item.msg || item.message || JSON.stringify(item);
          parts.push((loc ? loc + ': ' : '') + msg);
        } else {
          parts.push(String(item));
        }
      }
      return parts.join('; ');
    }

    if (detail && typeof detail === 'object') {
      return detail.msg || detail.message || JSON.stringify(detail);
    }

    return String(detail || '');
  }

  async function apiRequest(endpoint, body, signal) {
    const jwt = getJwt();
    const headers = { 'Content-Type': 'application/json' };
    if (jwt) headers['Authorization'] = 'Bearer ' + jwt;

    let res;
    try {
      const requestOptions = {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      };
      if (signal) requestOptions.signal = signal;
      res = await fetch(apiUrl + endpoint, requestOptions);
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      // Network error (TypeError: Failed to fetch)
      throw new Error(t.networkError);
    }

    if (!res.ok) {
      let errText = '';
      try {
        const errBody = await res.json();
        errText =
          formatErrorDetail(errBody.detail) || formatErrorDetail(errBody.error) || res.statusText;
      } catch (_error) {
        errText = res.statusText;
      }
      throw new Error(errText || t.unknownError);
    }

    return res.json();
  }

  async function handleAsk() {
    renderAskInput();
  }

  async function handleSubmitAsk() {
    if (currentState === 'loading') return;
    if (!hasUsableJwt()) {
      handleLogin();
      return;
    }

    const input = popup ? popup.querySelector('.ai-popup-question-input') : null;
    const question = input ? input.value.trim() : '';
    lastAskQuestion = question;
    const requestContext = beginRequestContext();

    renderLoading(t.loading);
    try {
      const body = {
        text: requestContext.selectedText,
        context: postTitle,
      };
      if (question) {
        body.question = question;
      }
      const data = await apiRequest('/ai/ask', body, requestContext.signal);
      if (!isRequestContextCurrent(requestContext)) return;
      renderAskResult(data.response || data.answer || JSON.stringify(data));
    } catch (err) {
      if (!isRequestContextCurrent(requestContext)) return;
      renderError(err.message);
    } finally {
      finishRequestContext(requestContext);
    }
  }

  async function handleEdit() {
    renderEditInput(lastEditInstruction);
  }

  async function handleSubmitEdit() {
    if (currentState === 'loading') return;
    if (!hasUsableJwt()) {
      handleLogin();
      return;
    }

    const input = popup ? popup.querySelector('.ai-popup-edit-input') : null;
    const instruction = input ? input.value.trim() : '';

    if (!instruction) {
      if (input) input.focus();
      return;
    }

    lastEditInstruction = instruction;
    const requestContext = beginRequestContext();
    renderLoading(t.loadingEdit);
    try {
      const data = await apiRequest(
        '/ai/edit',
        {
          selectedText: requestContext.selectedText,
          filePath: filePath,
          instruction: instruction,
        },
        requestContext.signal
      );
      if (!isRequestContextCurrent(requestContext)) return;
      renderEditResult(data.diff || '', data.editId || data.id || '');
    } catch (err) {
      if (!isRequestContextCurrent(requestContext)) return;
      renderError(err.message);
    } finally {
      finishRequestContext(requestContext);
    }
  }

  async function handleConfirm() {
    if (currentState === 'loading' || currentState === 'confirm-loading') return;
    if (!pendingEditId) {
      renderError(t.missingEditId);
      return;
    }

    selectionGeneration += 1;
    renderLoading(t.loadingConfirm, 'confirm-loading');
    try {
      const data = await apiRequest('/ai/edit/confirm', {
        editId: pendingEditId,
      });
      renderCommitted(data.commitHash || data.commit || '');
    } catch (err) {
      renderError(err.message);
    }
  }

  function handleLogin() {
    // Save current page URL so we can return after login
    try {
      localStorage.setItem(RETURN_KEY, window.location.href);
    } catch (_error) {
      // Ignore storage failures (private mode / quota), login can still continue.
    }
    if (!loginTarget) {
      renderError(t.unknownError);
      return;
    }
    loginTarget.click();
  }

  // Event delegation for popup buttons
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn || !popup || !popup.contains(btn)) return;

    const action = btn.getAttribute('data-action');
    e.stopPropagation();
    clearErrorDismissTimer();

    switch (action) {
      case 'ask':
        handleAsk();
        break;
      case 'submit-ask':
        handleSubmitAsk();
        break;
      case 'cancel-ask':
        removePopup();
        break;
      case 'edit':
        handleEdit();
        break;
      case 'submit-edit':
        handleSubmitEdit();
        break;
      case 'cancel-edit':
        removePopup();
        break;
      case 'confirm':
        handleConfirm();
        break;
      case 'retry':
        if (lastEditInstruction) {
          renderEditInput(lastEditInstruction);
        } else {
          renderAskInput();
          if (lastAskQuestion && popup) {
            const askInput = popup.querySelector('.ai-popup-question-input');
            if (askInput) askInput.value = lastAskQuestion;
          }
        }
        break;
      case 'login':
      case 'relogin':
        handleLogin();
        break;
      case 'close':
        removePopup();
        break;
    }
  });

  // Show popup on text selection in post-content
  function onSelectionEnd(event) {
    const target = event && event.target;
    if (popup && target && popup.contains(target)) return;
    if (currentState === 'confirm-loading') return;

    // Small delay to let selection finalize
    const generation = selectionGeneration;
    setTimeout(function () {
      if (generation !== selectionGeneration || currentState === 'confirm-loading') return;

      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : '';

      if (!text || text.length < 2) {
        // Don't remove if popup is showing results
        if (currentState === 'buttons') {
          removePopup();
        }
        return;
      }

      // Check if selection is inside .post-content
      if (!sel.anchorNode || !isInsidePostContent(sel.anchorNode)) {
        return;
      }

      const rect = getSelectionRect();
      if (!rect) return;

      const isSameSelection = text === selectedText;
      selectedText = text;

      if (popup && currentState !== 'idle' && currentState !== 'buttons' && isSameSelection) {
        positionPopup(rect);
        return;
      }

      createPopup();
      renderButtons();
      requestAnimationFrame(function () {
        positionPopup(rect);
      });
    }, 10);
  }

  function getEventPoint(e) {
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      return { x: e.clientX, y: e.clientY };
    }
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    if (e.changedTouches && e.changedTouches.length > 0) {
      return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    }
    return null;
  }

  function isPointInCurrentSelection(x, y) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

    const padding = 8;
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      const rects = range.getClientRects();
      for (let j = 0; j < rects.length; j++) {
        const rect = rects[j];
        if (
          x >= rect.left - padding &&
          x <= rect.right + padding &&
          y >= rect.top - padding &&
          y <= rect.bottom + padding
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function onPointerOutsideSelection(e) {
    const target = e.target;
    if (popup && target && popup.contains(target)) return;

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      if (currentState === 'buttons') {
        removePopup();
      }
      return;
    }

    const point = getEventPoint(e);
    if (!point) return;

    // Keep selection if user taps inside selected text.
    if (isPointInCurrentSelection(point.x, point.y)) return;

    // iOS Safari can race with native selection updates; defer one frame.
    requestAnimationFrame(function () {
      const currentSel = window.getSelection();
      if (currentSel && currentSel.rangeCount > 0) {
        currentSel.removeAllRanges();
      }

      if (currentState === 'buttons') {
        removePopup();
      }
    });
  }

  document.addEventListener('mouseup', onSelectionEnd);
  document.addEventListener('touchend', onSelectionEnd);

  // Tap outside selected text => clear selection (desktop + mobile/iOS)
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', onPointerOutsideSelection, { passive: true });
  } else {
    document.addEventListener('touchstart', onPointerOutsideSelection, { passive: true });
    document.addEventListener('mousedown', onPointerOutsideSelection, { passive: true });
  }

  // Close on Escape (block during loading to prevent silent server-side commits)
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popup) {
      if (currentState === 'loading' || currentState === 'confirm-loading') return;
      removePopup();
    }
  });
})();
