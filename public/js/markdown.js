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
