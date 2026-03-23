/**
 * PilotCode Feature Guide
 * Shows on first launch. Accessible later via "Guide" button in sidebar.
 */

const GUIDE_SEEN_KEY = 'pilotcode_guide_seen';

const slides = [
  {
    icon: '🚀',
    title: 'Welcome to PilotCode',
    body: 'Control Claude Code from your phone, tablet, or any browser — anywhere, anytime. Everything runs on your computer through a secure Cloudflare Tunnel.',
  },
  {
    icon: '💬',
    title: 'Sessions',
    body: 'Each session is a separate Claude conversation tied to a project directory. Create multiple sessions for different projects and switch between them from the sidebar.',
  },
  {
    icon: '🔗',
    title: 'Connect to Existing Sessions',
    body: 'Started a Claude session in your terminal? Tap <strong>Connect</strong> in the sidebar to find it and continue the conversation here. PilotCode scans your existing Claude sessions so you can pick up where you left off.',
  },
  {
    icon: '🛡️',
    title: 'Permissions',
    body: 'When Claude wants to run a command, edit a file, or access the web, you\'ll see an Allow/Deny card — just like the terminal CLI. You\'re always in control.',
  },
  {
    icon: '📎',
    title: 'Uploads & Images',
    body: 'Tap the camera button to attach screenshots, photos, PDFs, or any file for Claude to analyze. Great for sharing error screenshots or design mockups.',
  },
  {
    icon: '📱',
    title: 'Multi-Device & PWA',
    body: 'Open PilotCode on multiple devices at once — messages sync in real time. Add it to your home screen in Safari for a full-screen native app experience.',
  },
  {
    icon: '🤖',
    title: 'Models',
    body: 'Choose per session: <strong>Opus</strong> for complex architecture work, <strong>Sonnet</strong> for fast everyday use, or <strong>Haiku</strong> for quick questions and simple edits.',
  },
];

let currentSlide = 0;

function createGuideOverlay() {
  // Remove existing if any
  const existing = document.getElementById('guide-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'guide-overlay';
  overlay.innerHTML = `
    <div class="guide-modal">
      <div class="guide-slide">
        <div class="guide-icon"></div>
        <h2 class="guide-title"></h2>
        <p class="guide-body"></p>
      </div>
      <div class="guide-dots"></div>
      <div class="guide-actions">
        <button class="guide-btn guide-skip">Skip</button>
        <button class="guide-btn guide-next btn-primary">Next</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Build dots
  const dotsContainer = overlay.querySelector('.guide-dots');
  slides.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'guide-dot' + (i === 0 ? ' active' : '');
    dot.onclick = () => goToSlide(i);
    dotsContainer.appendChild(dot);
  });

  // Buttons
  overlay.querySelector('.guide-skip').onclick = closeGuide;
  overlay.querySelector('.guide-next').onclick = () => {
    if (currentSlide < slides.length - 1) {
      goToSlide(currentSlide + 1);
    } else {
      closeGuide();
    }
  };

  // Swipe support for mobile
  let touchStartX = 0;
  const modal = overlay.querySelector('.guide-modal');
  modal.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  modal.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0 && currentSlide < slides.length - 1) {
        goToSlide(currentSlide + 1);
      } else if (diff < 0 && currentSlide > 0) {
        goToSlide(currentSlide - 1);
      }
    }
  }, { passive: true });

  currentSlide = 0;
  renderSlide();

  // Animate in
  requestAnimationFrame(() => overlay.classList.add('active'));
}

function renderSlide() {
  const slide = slides[currentSlide];
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;

  overlay.querySelector('.guide-icon').textContent = slide.icon;
  overlay.querySelector('.guide-title').textContent = slide.title;
  overlay.querySelector('.guide-body').innerHTML = slide.body;

  // Update dots
  overlay.querySelectorAll('.guide-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === currentSlide);
  });

  // Update button text
  const nextBtn = overlay.querySelector('.guide-next');
  const skipBtn = overlay.querySelector('.guide-skip');
  if (currentSlide === slides.length - 1) {
    nextBtn.textContent = 'Get Started';
    skipBtn.style.visibility = 'hidden';
  } else {
    nextBtn.textContent = 'Next';
    skipBtn.style.visibility = '';
  }
}

function goToSlide(index) {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;

  const slideEl = overlay.querySelector('.guide-slide');
  slideEl.classList.add('guide-slide-exit');

  setTimeout(() => {
    currentSlide = index;
    renderSlide();
    slideEl.classList.remove('guide-slide-exit');
    slideEl.classList.add('guide-slide-enter');
    setTimeout(() => slideEl.classList.remove('guide-slide-enter'), 200);
  }, 150);
}

function closeGuide() {
  const overlay = document.getElementById('guide-overlay');
  if (!overlay) return;

  localStorage.setItem(GUIDE_SEEN_KEY, 'true');
  overlay.classList.remove('active');
  setTimeout(() => overlay.remove(), 300);
}

export function showGuide() {
  createGuideOverlay();
}

export function showGuideIfFirstTime() {
  if (!localStorage.getItem(GUIDE_SEEN_KEY)) {
    createGuideOverlay();
  }
}
