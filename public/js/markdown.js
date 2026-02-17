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
      await loadScript('https://cdn.jsdelivr.net/npm/highlight.js@11/highlight.min.js');
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/highlight.js@11/styles/github-dark.min.css';
      document.head.appendChild(link);
    }
    hlLoaded = true;
  } catch {
    console.warn('Failed to load highlight.js');
  }

  if (window.marked) {
    window.marked.setOptions({
      highlight: (code, lang) => {
        if (hlLoaded && window.hljs) {
          try {
            if (lang && window.hljs.getLanguage(lang)) {
              return window.hljs.highlight(code, { language: lang }).value;
            }
            return window.hljs.highlightAuto(code).value;
          } catch { /* fallback */ }
        }
        return code;
      },
      breaks: true,
    });
  }
}

export function renderMarkdown(text) {
  if (!markedLoaded || !window.marked) return escapeHtml(text);
  try {
    return window.marked.parse(text);
  } catch {
    return escapeHtml(text);
  }
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
