let markedLoaded = false;
let hlLoaded = false;

export async function initMarkdown() {
  // Load marked
  try {
    if (!window.marked) {
      await loadScript('https://cdn.jsdelivr.net/npm/marked@14/marked.min.js');
    }
    markedLoaded = true;
  } catch {
    console.warn('Failed to load marked');
  }

  // Load highlight.js (non-blocking — app works without it)
  try {
    if (!window.hljs) {
      await loadScript('https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css';
      document.head.appendChild(link);
    }
    hlLoaded = true;
  } catch {
    console.warn('Failed to load highlight.js');
  }

  if (window.marked) {
    try {
      window.marked.setOptions({ breaks: true });
    } catch {
      // Fallback for older/newer marked versions
    }

    // Disable GFM strikethrough — Claude uses ~ for "approximately" (e.g. ~500 kHz)
    // and the parser misinterprets paired tildes as strikethrough formatting.
    try {
      window.marked.use({
        extensions: [{
          name: 'del',
          level: 'inline',
          start(src) { return undefined; },
          tokenizer(src) { return undefined; },
        }],
      });
    } catch { /* older marked version — ignore */ }

    // Use marked-highlight extension pattern if available, otherwise
    // highlight code blocks after rendering via addCopyButtons
    if (hlLoaded && window.hljs) {
      const renderer = new window.marked.Renderer();
      renderer.code = function (text, lang) {
        // marked v14 passes an object { text, lang } as first arg
        if (typeof text === 'object') { lang = text.lang; text = text.text; }
        let highlighted = text;
        try {
          if (lang && window.hljs.getLanguage(lang)) {
            highlighted = window.hljs.highlight(text, { language: lang }).value;
          } else {
            highlighted = window.hljs.highlightAuto(text).value;
          }
        } catch { /* fallback to plain text */ }
        return `<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`;
      };
      try {
        window.marked.setOptions({ renderer });
      } catch {
        // If setOptions with renderer fails, use marked.use()
        try { window.marked.use({ renderer }); } catch { /* give up on highlighting */ }
      }
    }
  }
}

export function renderMarkdown(text) {
  if (!markedLoaded || !window.marked) return fallbackMarkdown(text);
  try {
    return window.marked.parse(text);
  } catch {
    return fallbackMarkdown(text);
  }
}

/** Minimal markdown renderer when marked CDN fails to load. */
function fallbackMarkdown(text) {
  let html = escapeHtml(text);
  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  return `<p>${html}</p>`;
}

export function addCopyButtons(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    if (pre.querySelector('.copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    btn.onclick = () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      navigator.clipboard.writeText(code).then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1500);
      });
    };
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

/** Resolve a file path to an absolute download URL path. */
function resolveDownloadPath(filePath, cwd) {
  if (filePath.startsWith('/')) return filePath;
  if (cwd) return cwd.replace(/\/$/, '') + '/' + filePath;
  return filePath; // can't resolve — try anyway
}

// Absolute path: /at-least/one-segment/file (allows spaces, parens, commas in names)
const ABS_PATH_RE = /^\/(?:[\w.@~+\- ,()]+\/)+[\w.@~+\- ,()]+$/;
// Relative path: at-least/one-segment/file.ext (must have extension to avoid false positives)
const REL_PATH_RE = /^(?:[\w.@~+\- ,()]+\/)+[\w.@~+\- ,()]+\.\w+$/;

/** Convert file paths in rendered HTML into clickable download links. */
export function linkifyFilePaths(container, cwd) {
  // 1) Inline <code> elements (not inside <pre>) containing a file path
  container.querySelectorAll('code').forEach(code => {
    if (code.closest('pre') || code.closest('a')) return;
    const text = code.textContent.trim();
    if (ABS_PATH_RE.test(text) || REL_PATH_RE.test(text)) {
      const resolved = resolveDownloadPath(text, cwd);
      const link = document.createElement('a');
      link.href = `/api/download?path=${encodeURIComponent(resolved)}`;
      link.download = text.split('/').pop();
      link.title = `Download ${text}`;
      link.className = 'file-path-link';
      code.parentNode.insertBefore(link, code);
      link.appendChild(code);
    }
  });

  // 2) Absolute file paths inside <pre><code> blocks (line-by-line)
  //    Only match absolute paths to avoid false positives in actual code.
  container.querySelectorAll('pre code').forEach(code => {
    const preWalker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const preTextNodes = [];
    while (preWalker.nextNode()) preTextNodes.push(preWalker.currentNode);

    for (const node of preTextNodes) {
      if (node.parentElement?.closest('a')) continue;
      const text = node.textContent;
      const prePathRe = /(\/(?:[\w.@~+\- ,()]+\/)+[\w.@~+\- ,()]+)/g;
      if (!prePathRe.test(text)) continue;
      prePathRe.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;
      while ((match = prePathRe.exec(text)) !== null) {
        let filePath = match[1].replace(/[\s,;:!?)]+$/, '');
        const matchStart = match.index;
        const matchEnd = matchStart + filePath.length;
        if (matchStart > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, matchStart)));
        }
        const link = document.createElement('a');
        link.href = `/api/download?path=${encodeURIComponent(filePath)}`;
        link.download = filePath.split('/').pop();
        link.title = `Download ${filePath}`;
        link.className = 'file-path-link pre-path';
        link.textContent = filePath;
        frag.appendChild(link);
        lastIdx = matchEnd;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      node.parentNode.replaceChild(frag, node);
    }
  });

  // 3) Bare file paths in text nodes (outside <a>, <pre>, <code>)
  // Match absolute paths (3+ segments) and relative paths with extension (2+ segments)
  const pathRe = /(\/(?:[\w.@~+\- ,()]+\/){2,}[\w.@~+\- ,()]+|(?:[\w.@~+\- ,()]+\/)+[\w.@~+\- ,()]+\.\w+)/g;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const node of textNodes) {
    if (node.parentElement?.closest('a, pre, code')) continue;
    const text = node.textContent;
    if (!pathRe.test(text)) continue;
    pathRe.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let match;
    while ((match = pathRe.exec(text)) !== null) {
      // Trim trailing spaces/punctuation that the greedy space-aware regex may capture
      let filePath = match[1].replace(/[\s,;:!?)]+$/, '');
      const matchStart = match.index;
      const matchEnd = matchStart + filePath.length;
      if (matchStart > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, matchStart)));
      }
      const resolved = resolveDownloadPath(filePath, cwd);
      const link = document.createElement('a');
      link.href = `/api/download?path=${encodeURIComponent(resolved)}`;
      link.download = filePath.split('/').pop();
      link.title = `Download ${filePath}`;
      link.className = 'file-path-link bare';
      link.textContent = filePath;
      frag.appendChild(link);
      lastIdx = matchEnd;
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)));
    }
    node.parentNode.replaceChild(frag, node);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
