'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────

const MARKDOWN_FILES = {
  'README.md':    'https://raw.githubusercontent.com/ImDuck42/GHDB/refs/heads/main/README.md',
  'CHANGELOG.md': 'https://raw.githubusercontent.com/ImDuck42/GHDB/refs/heads/main/CHANGELOG.md',
  'ToDo.md':      'https://raw.githubusercontent.com/ImDuck42/GHDB/refs/heads/main/ToDo.md',
};

const LANGUAGE_ALIASES = {
  js:         'javascript',
  bash:       'bash',
  json:       'json',
};

// ─── App state ────────────────────────────────────────────────────────────────

const appState = {
  activeFile:      'README.md',
  tableOfContents: [],
  contentSections: [],
  headingObserver: null,
  searchIsOpen:    false,
  searchCursorIdx: -1,
};

// Cached DOM element references
let dom = {};

// ─── String utilities ─────────────────────────────────────────────────────────

function escapeHtml(rawValue) {
  return String(rawValue ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(rawText) {
  return (rawText ?? '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'section';
}

function extractHeadingText(headingElement) {
  const clone = headingElement.cloneNode(true);
  clone.querySelectorAll('a').forEach(anchor => anchor.replaceWith(anchor.textContent));
  return clone.textContent.trim();
}

// ─── Toast notifications ──────────────────────────────────────────────────────

function showToast(message, iconClass = 'fa-check') {
  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.innerHTML = `
    <i class="fa-solid ${escapeHtml(iconClass)}" aria-hidden="true"></i>
    <span>${escapeHtml(message)}</span>
  `;
  dom.toastContainer.appendChild(toastEl);
  toastEl.addEventListener('animationend', event => {
    if (event.animationName === 'toastOut') toastEl.remove();
  });
}

// ─── Syntax highlighting ──────────────────────────────────────────────────────

function resolveLanguageAlias(rawLang) {
  const normalizedLang = (rawLang ?? '').toLowerCase().trim();
  return LANGUAGE_ALIASES[normalizedLang] ?? normalizedLang;
}

function highlightCodeBlock(sourceCode, rawLang) {
  const resolvedLang = resolveLanguageAlias(rawLang);

  if (resolvedLang && hljs.getLanguage(resolvedLang)) {
    try {
      return {
        highlightedHtml: hljs.highlight(sourceCode, { language: resolvedLang }).value,
        detectedLang:    resolvedLang,
      };
    } catch {}
  }

  try {
    const autoResult = hljs.highlightAuto(sourceCode, ['javascript', 'bash', 'json']);
    return {
      highlightedHtml: autoResult.value,
      detectedLang:    autoResult.language || 'text',
    };
  } catch {
    return {
      highlightedHtml: escapeHtml(sourceCode),
      detectedLang:    'text',
    };
  }
}

async function copyCodeToClipboard(copyButton) {
  const codeEl = copyButton.closest('pre')?.querySelector('code');
  try {
    await navigator.clipboard.writeText(codeEl?.textContent ?? '');
    const originalLabel = copyButton.innerHTML;
    copyButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
    showToast('Copied to clipboard');
    setTimeout(() => { copyButton.innerHTML = originalLabel; }, 2000);
  } catch {
    showToast('Failed to copy', 'fa-triangle-exclamation');
  }
}

function attachCopyButtons() {
  dom.contentArea.querySelectorAll('.md-body pre').forEach(preEl => {
    if (preEl.querySelector('.copy-btn')) return;
    const copyButton = document.createElement('button');
    copyButton.className = 'copy-btn';
    copyButton.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i> Copy';
    copyButton.setAttribute('aria-label', 'Copy code to clipboard');
    copyButton.addEventListener('click', () => copyCodeToClipboard(copyButton));
    preEl.appendChild(copyButton);
  });
}

// ─── Marked renderer ──────────────────────────────────────────────────────────

function initMarkdownParser() {
  marked.use({
    gfm: true,
    renderer: {
      code(sourceText, langHint) {
        const { highlightedHtml, detectedLang } = highlightCodeBlock(sourceText, langHint ?? '');
        const safeLang = escapeHtml(detectedLang);
        return `<pre><code class="hljs language-${safeLang}">${highlightedHtml}</code><span class="lang-label">${safeLang}</span></pre>`;
      },
    },
  });
}

// ─── Link interception ────────────────────────────────────────────────────────

function interceptContentLinks() {
  dom.contentArea.addEventListener('click', event => {
    const clickedAnchor = event.target.closest('a');
    if (!clickedAnchor) return;

    const href = clickedAnchor.getAttribute('href') ?? '';

    if (href.startsWith('#')) {
      event.preventDefault();
      const anchorId = href.slice(1);
      const targetEl =
        document.getElementById(anchorId) ??
        dom.contentArea.querySelector(`[id^="${CSS.escape(anchorId)}-"]`);
      targetEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (!clickedAnchor.target) {
      clickedAnchor.target = '_blank';
      clickedAnchor.rel = 'noopener noreferrer';
    }
  });
}

// ─── Table of contents ────────────────────────────────────────────────────────

function renderTableOfContents() {
  dom.tocHeadingCount.textContent = appState.tableOfContents.length;

  if (!appState.tableOfContents.length) {
    dom.tocList.innerHTML = `
      <li class="toc-empty">
        <i class="fa-regular fa-folder-open" aria-hidden="true"></i>
        <div>No headings found</div>
      </li>`;
    return;
  }

  dom.tocList.innerHTML = appState.tableOfContents
    .map(({ level, text, id }, entryIdx) => `
      <li class="toc-item" style="animation-delay:${entryIdx * 0.02}s">
        <a class="toc-link toc-h${level}" data-target="${escapeHtml(id)}" href="#">${escapeHtml(text)}</a>
      </li>`)
    .join('');
}

function handleTocLinkClick(event) {
  const tocLink = event.target.closest('.toc-link');
  if (!tocLink) return;
  event.preventDefault();
  scrollToHeading(tocLink.dataset.target);
  closeMobileSidebar();
}

function filterTocByQuery(event) {
  const searchQuery = event.target.value.toLowerCase();
  dom.tocList.querySelectorAll('.toc-item').forEach(tocItem => {
    const headingText = tocItem.querySelector('.toc-link')?.textContent.toLowerCase() ?? '';
    tocItem.style.display = headingText.includes(searchQuery) ? '' : 'none';
  });
}

function observeHeadingsForActiveToc() {
  appState.headingObserver?.disconnect();

  const allHeadings = dom.contentArea.querySelectorAll(
    '.md-body h1,.md-body h2,.md-body h3,.md-body h4,.md-body h5,.md-body h6'
  );
  if (!allHeadings.length) return;

  appState.headingObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      dom.tocList.querySelectorAll('.toc-link').forEach(link => link.classList.remove('active'));
      const activeLink = dom.tocList.querySelector(`.toc-link[data-target="${entry.target.id}"]`);
      if (activeLink) {
        activeLink.classList.add('active');
        activeLink.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, { root: dom.contentArea, rootMargin: '-8% 0px -78% 0px', threshold: 0 });

  allHeadings.forEach(heading => appState.headingObserver.observe(heading));
}

// ─── Content scanning ─────────────────────────────────────────────────────────

function scanRenderedContent() {
  const markdownBody = dom.contentArea.querySelector('.md-body');
  if (!markdownBody) return;

  let currentSection = { level: 0, text: 'Top', id: '', content: '' };
  const treeWalker = document.createTreeWalker(
    markdownBody,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );
  let insideHeading = false;
  let walkerNode;

  while ((walkerNode = treeWalker.nextNode())) {
    const isHeadingTag = walkerNode.nodeType === Node.ELEMENT_NODE
      && /^H[1-6]$/i.test(walkerNode.tagName);

    if (isHeadingTag) {
      if (currentSection.content.trim()) appState.contentSections.push({ ...currentSection });

      const headingLevel = +walkerNode.tagName[1];
      const headingText  = extractHeadingText(walkerNode);
      const headingId    = `${slugify(headingText)}-${appState.tableOfContents.length}`;

      walkerNode.id = headingId;
      appState.tableOfContents.push({ level: headingLevel, text: headingText, id: headingId });
      currentSection = { level: headingLevel, text: headingText, id: headingId, content: '' };
      insideHeading = true;

    } else if (walkerNode.nodeType === Node.TEXT_NODE) {
      insideHeading = false;
      currentSection.content += walkerNode.textContent + ' ';

    } else if (walkerNode.nodeType === Node.ELEMENT_NODE && !insideHeading && walkerNode.tagName === 'IMG') {
      currentSection.content += (walkerNode.alt || '') + ' ';
    }
  }

  if (currentSection.content.trim()) appState.contentSections.push({ ...currentSection });
}

// ─── Table wrapping ───────────────────────────────────────────────────────────

function wrapTablesForScrolling() {
  dom.contentArea.querySelectorAll('.md-body table').forEach(tableEl => {
    if (tableEl.parentElement.classList.contains('table-wrap')) return;
    const wrapperDiv = document.createElement('div');
    wrapperDiv.className = 'table-wrap';
    tableEl.replaceWith(wrapperDiv);
    wrapperDiv.appendChild(tableEl);
  });
}

// ─── Scroll & progress bar ────────────────────────────────────────────────────

function handleContentScroll() {
  const { scrollTop, scrollHeight, clientHeight } = dom.contentArea;
  const scrollFraction = scrollHeight > clientHeight
    ? scrollTop / (scrollHeight - clientHeight)
    : 0;
  dom.progressBar.style.transform = `scaleX(${scrollFraction})`;
  dom.backToTopButton.classList.toggle('visible', scrollTop > 400);
}

// ─── File loading ─────────────────────────────────────────────────────────────

async function loadMarkdownFile(fileName) {
  const fileUrl = MARKDOWN_FILES[fileName];
  if (!fileUrl) return;

  appState.tableOfContents = [];
  appState.contentSections = [];
  dom.tocFilterInput.value = '';
  dom.searchInput.value = '';
  dom.tocList.innerHTML = '';
  dom.tocHeadingCount.textContent = '0';
  dom.fileBadge.querySelector('span').textContent = fileName;

  dom.contentArea.innerHTML = `
    <div class="status">
      <div class="spinner" aria-hidden="true">
        <div></div><div></div><div></div><div></div>
      </div>
      <span>Loading ${escapeHtml(fileName)}…</span>
    </div>`;

  let markdownText;
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    markdownText = await response.text();
  } catch (fetchError) {
    dom.contentArea.innerHTML = `
      <div class="status error">
        <i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>
        <strong>Failed to load ${escapeHtml(fileName)}</strong>
        <span>${escapeHtml(fetchError.message)}</span>
      </div>`;
    return;
  }

  dom.contentArea.innerHTML = `<div class="md-body">${marked.parse(markdownText)}</div>`;
  scanRenderedContent();
  renderTableOfContents();
  wrapTablesForScrolling();
  attachCopyButtons();
  observeHeadingsForActiveToc();
  handleContentScroll();
}

// ─── Search palette ───────────────────────────────────────────────────────────

function openSearchPalette() {
  appState.searchIsOpen    = true;
  appState.searchCursorIdx = -1;
  dom.searchPalette.setAttribute('aria-hidden', 'false');
  dom.searchInput.value = '';
  dom.searchResultsList.innerHTML = '';
  requestAnimationFrame(() => dom.searchInput.focus());
}

function closeSearchPalette() {
  appState.searchIsOpen    = false;
  appState.searchCursorIdx = -1;
  dom.searchPalette.setAttribute('aria-hidden', 'true');
}

function runContentSearch(queryText) {
  const normalizedQuery = queryText.toLowerCase().trim();

  if (!normalizedQuery) {
    dom.searchResultsList.innerHTML = '<li class="no-results">Type to search content…</li>';
    return;
  }

  const matchingSections = appState.contentSections
    .filter(section => section.content.toLowerCase().includes(normalizedQuery))
    .map(section => {
      const lowerContent = section.content.toLowerCase();
      const matchStart   = lowerContent.indexOf(normalizedQuery);
      const snippetStart = Math.max(0, matchStart - 40);
      const snippetEnd   = Math.min(section.content.length, matchStart + normalizedQuery.length + 60);

      let snippetText = section.content.slice(snippetStart, snippetEnd).trim();
      if (snippetStart > 0) snippetText = '…' + snippetText;
      if (snippetEnd < section.content.length) snippetText += '…';

      const highlightedSnippet = escapeHtml(snippetText).replace(
        new RegExp(escapeHtml(normalizedQuery), 'gi'),
        match => `<strong style="color:var(--ctp-lavender)">${match}</strong>`
      );

      return { ...section, highlightedSnippet };
    })
    .slice(0, 50);

  if (!matchingSections.length) {
    dom.searchResultsList.innerHTML = '<li class="no-results">No matches found</li>';
    return;
  }

  dom.searchResultsList.innerHTML = matchingSections
    .map((result, resultIdx) => `
      <li data-index="${resultIdx}" data-target="${escapeHtml(result.id)}" role="option" aria-selected="false">
        <i class="fa-solid fa-paragraph" aria-hidden="true"></i>
        <div class="result-body">
          <span class="result-title">${escapeHtml(result.text)}</span>
          <span class="result-snippet">${result.highlightedSnippet}</span>
        </div>
        <span class="result-meta">H${result.level}</span>
      </li>`)
    .join('');
}

function navigateSearchResults(event) {
  const resultItems = [...dom.searchResultsList.querySelectorAll('li[data-target]')];

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    appState.searchCursorIdx = Math.min(appState.searchCursorIdx + 1, resultItems.length - 1);
    highlightSelectedResult(resultItems);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    appState.searchCursorIdx = Math.max(appState.searchCursorIdx - 1, 0);
    highlightSelectedResult(resultItems);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const selectedItem = resultItems[appState.searchCursorIdx];
    if (selectedItem) jumpToSearchResult(selectedItem.dataset.target);
  } else if (event.key === 'Escape') {
    closeSearchPalette();
  }
}

function highlightSelectedResult(resultItems) {
  resultItems.forEach((item, idx) => {
    const isSelected = idx === appState.searchCursorIdx;
    item.classList.toggle('selected', isSelected);
    item.setAttribute('aria-selected', String(isSelected));
  });
  resultItems[appState.searchCursorIdx]?.scrollIntoView({ block: 'nearest' });
}

function jumpToSearchResult(headingId) {
  scrollToHeading(headingId);
  closeSearchPalette();
}

function scrollToHeading(headingId) {
  document.getElementById(headingId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function handleTabClick(event) {
  const clickedTab = event.target.closest('.tab');
  if (!clickedTab || clickedTab.dataset.file === appState.activeFile) return;

  dom.tabBar.querySelectorAll('.tab').forEach(tab => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });

  clickedTab.classList.add('active');
  clickedTab.setAttribute('aria-selected', 'true');
  appState.activeFile = clickedTab.dataset.file;
  loadMarkdownFile(appState.activeFile);
}

// ─── Mobile sidebar ───────────────────────────────────────────────────────────

function toggleMobileSidebar() {
  const isNowOpen = dom.sidebar.classList.toggle('open');
  dom.sidebarOverlay?.classList.toggle('open', isNowOpen);
  dom.menuToggleButton.setAttribute('aria-expanded', String(isNowOpen));
}

function closeMobileSidebar() {
  dom.sidebar.classList.remove('open');
  dom.sidebarOverlay?.classList.remove('open');
  dom.menuToggleButton.setAttribute('aria-expanded', 'false');
}

// ─── Global keyboard shortcuts ────────────────────────────────────────────────

function handleGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault();
    openSearchPalette();
    return;
  }
  if (event.key === 'Escape') {
    if (appState.searchIsOpen) closeSearchPalette();
    else if (dom.sidebar.classList.contains('open')) closeMobileSidebar();
  }
}

// ─── Initialization ───────────────────────────────────────────────────────────

function initApp() {
  dom = {
    tabBar:            document.getElementById('tabs'),
    tocList:           document.getElementById('tocList'),
    tocFilterInput:    document.getElementById('tocFilter'),
    tocHeadingCount:   document.getElementById('tocCount'),
    contentArea:       document.getElementById('content'),
    fileBadge:         document.getElementById('fileBadge'),
    progressBar:       document.getElementById('progBar'),
    backToTopButton:   document.getElementById('topBtn'),
    searchPalette:     document.getElementById('cmdPalette'),
    searchInput:       document.getElementById('cmdInput'),
    searchResultsList: document.getElementById('cmdResults'),
    searchOpenButton:  document.getElementById('searchBtn'),
    menuToggleButton:  document.getElementById('menuBtn'),
    sidebar:           document.getElementById('sidebar'),
    toastContainer:    document.getElementById('toasts'),
  };

  const sidebarOverlay = document.createElement('div');
  sidebarOverlay.id = 'sidebarOverlay';
  sidebarOverlay.className = 'sidebar-overlay';
  sidebarOverlay.addEventListener('click', closeMobileSidebar);
  document.body.appendChild(sidebarOverlay);
  dom.sidebarOverlay = sidebarOverlay;

  initMarkdownParser();
  interceptContentLinks();

  dom.tabBar.addEventListener('click', handleTabClick);
  dom.tocFilterInput.addEventListener('input', filterTocByQuery);
  dom.tocList.addEventListener('click', handleTocLinkClick);
  dom.contentArea.addEventListener('scroll', handleContentScroll, { passive: true });
  dom.backToTopButton.addEventListener('click', () => {
    dom.contentArea.scrollTo({ top: 0, behavior: 'smooth' });
  });
  dom.searchOpenButton.addEventListener('click', openSearchPalette);
  dom.menuToggleButton.addEventListener('click', toggleMobileSidebar);
  dom.searchInput.addEventListener('input', event => {
    appState.searchCursorIdx = -1;
    runContentSearch(event.target.value);
  });
  dom.searchInput.addEventListener('keydown', navigateSearchResults);
  dom.searchResultsList.addEventListener('click', event => {
    const clickedResult = event.target.closest('li[data-target]');
    if (clickedResult) jumpToSearchResult(clickedResult.dataset.target);
  });
  dom.searchPalette.querySelector('.cmd-backdrop').addEventListener('click', closeSearchPalette);
  document.addEventListener('keydown', handleGlobalKeydown);

  loadMarkdownFile(appState.activeFile);
}

document.addEventListener('DOMContentLoaded', initApp);