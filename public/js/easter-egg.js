// Easter Egg: Northrop Grumman vs UFO aerial dogfight
// All sprites are inline SVG. Movement via requestAnimationFrame with left/top px.

export function initEasterEgg() {
  setTimeout(runEasterEgg, 30000);
  setInterval(runEasterEgg, 3600000);

  const trigger = document.getElementById('ee-trigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      if (!document.getElementById('ee-overlay')) runEasterEgg();
    });
  }
}

function runEasterEgg() {
  if (document.getElementById('ee-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'ee-overlay';
  document.body.appendChild(overlay);

  runPhase1(overlay)
    .then(() => delay(1500))
    .then(() => runPhase2(overlay))
    .then(() => delay(1500))
    .then(() => runPhase3(overlay))
    .then(() => overlay.remove())
    .catch(() => overlay.remove());
}

// ────────────────────────────────────────────────
// Phase 1: UFO flees left→right, jet chases & shoots
// ────────────────────────────────────────────────
function runPhase1(overlay) {
  const W = window.innerWidth;
  const gap = Math.max(W * 0.4, 120);

  const ufo = createUFO();
  const jet = createJet('right');
  overlay.appendChild(ufo);
  overlay.appendChild(jet);

  ufo.style.top = '12%';
  jet.style.top = '15%';

  const projectiles = [];
  const shotTimes = [0.2, 0.35, 0.5, 0.65, 0.8];
  const shotsFired = new Set();

  return anim(4000, (t) => {
    const ufoX = lerp(-80, W + 80, t);
    const jetX = ufoX - gap;
    ufo.style.left = ufoX + 'px';
    jet.style.left = jetX + 'px';

    // wobble the ufo
    ufo.style.top = `calc(12% + ${Math.sin(t * 20) * 3}px)`;

    // fire shots
    for (const st of shotTimes) {
      if (t >= st && !shotsFired.has(st)) {
        shotsFired.add(st);
        const p = document.createElement('div');
        p.className = 'ee-projectile';
        p.style.top = jet.style.top;
        p.style.left = (jetX + 80) + 'px';
        overlay.appendChild(p);
        projectiles.push({ el: p, startX: jetX + 80, startT: t });
      }
    }

    // move projectiles forward fast
    for (const proj of projectiles) {
      const age = t - proj.startT;
      const px = proj.startX + age * W * 3;
      proj.el.style.left = px + 'px';
      if (age > 0.1) { proj.el.style.opacity = '0'; }
    }
  }).then(() => {
    ufo.remove();
    jet.remove();
    projectiles.forEach(p => p.el.remove());
  });
}

// ────────────────────────────────────────────────
// Phase 2: UFO chases jet right→left, fires laser, jet explodes
// ────────────────────────────────────────────────
function runPhase2(overlay) {
  const W = window.innerWidth;
  const gap = Math.max(W * 0.35, 100);

  const jet = createJet('left');
  const ufo = createUFO();
  overlay.appendChild(jet);
  overlay.appendChild(ufo);

  jet.style.top = '15%';
  ufo.style.top = '12%';

  let laserFired = false;
  let exploded = false;

  // jet stops at 30% from left
  const jetStop = W * 0.3;
  // ufo stops at center
  const ufoStop = W * 0.5;

  // store for phase 3
  overlay._ufo = ufo;

  return anim(3500, (t) => {
    // Jet decelerates and stops at 35% of animation
    const jetT = Math.min(t / 0.35, 1);
    const jetEased = 1 - Math.pow(1 - jetT, 3);
    const jetX = W + 80 + (jetStop - W - 80) * jetEased;
    jet.style.left = jetX + 'px';

    // UFO decelerates and stops at 60% of animation
    const ufoT = Math.min(t / 0.6, 1);
    const ufoEased = 1 - Math.pow(1 - ufoT, 3);
    const ufoX = W + 80 + gap + (ufoStop - W - 80 - gap) * ufoEased;
    ufo.style.left = ufoX + 'px';
    ufo.style.top = `calc(12% + ${Math.sin(t * 20) * 3}px)`;

    // Fire laser at t=0.45
    if (t >= 0.45 && !laserFired) {
      laserFired = true;
      const laser = document.createElement('div');
      laser.className = 'ee-laser';
      const ufoRect = ufo.getBoundingClientRect();
      const jetRect = jet.getBoundingClientRect();
      const y = ufoRect.top + ufoRect.height / 2;
      const left = Math.min(ufoRect.left, jetRect.left + jetRect.width / 2);
      const right = Math.max(ufoRect.left, jetRect.left + jetRect.width / 2);
      laser.style.top = y + 'px';
      laser.style.left = left + 'px';
      laser.style.width = (right - left) + 'px';
      overlay.appendChild(laser);
      setTimeout(() => laser.remove(), 300);
    }

    // Explode jet at t=0.55
    if (t >= 0.55 && !exploded) {
      exploded = true;
      const jetRect = jet.getBoundingClientRect();
      const boom = document.createElement('div');
      boom.className = 'ee-explosion';
      boom.style.top = (jetRect.top + jetRect.height / 2 - 5) + 'px';
      boom.style.left = (jetRect.left + jetRect.width / 2 - 5) + 'px';
      overlay.appendChild(boom);
      jet.style.visibility = 'hidden';
      setTimeout(() => boom.remove(), 800);
    }
  }).then(() => {
    jet.remove();
    // ufo stays for phase 3
  });
}

// ────────────────────────────────────────────────
// Phase 3: Lockheed Martin missile rises, kills UFO
// ────────────────────────────────────────────────
function runPhase3(overlay) {
  const ufo = overlay._ufo;
  if (!ufo) return Promise.resolve();

  const ufoRect = ufo.getBoundingClientRect();
  const targetX = ufoRect.left + ufoRect.width / 2;
  const targetY = ufoRect.top + ufoRect.height / 2;
  const H = window.innerHeight;

  const missile = document.createElement('div');
  missile.className = 'ee-missile ee-sprite';
  missile.style.left = (targetX - 4) + 'px';
  overlay.appendChild(missile);

  const label = document.createElement('div');
  label.className = 'ee-missile-label';
  label.textContent = 'LOCKHEED MARTIN';
  missile.appendChild(label);

  return anim(1200, (t) => {
    const eased = t * t; // ease-in
    const y = H + 40 + (targetY - H - 40) * eased;
    missile.style.top = y + 'px';
  }).then(() => {
    missile.remove();

    // green explosion
    const boom = document.createElement('div');
    boom.className = 'ee-explosion ee-explosion-green';
    boom.style.top = (targetY - 5) + 'px';
    boom.style.left = (targetX - 5) + 'px';
    overlay.appendChild(boom);
    ufo.style.visibility = 'hidden';

    const winText = document.createElement('div');
    winText.className = 'ee-win-text';
    winText.textContent = 'LOCKHEED MARTIN';
    overlay.appendChild(winText);

    return delay(2200).then(() => {
      boom.remove();
      winText.remove();
      ufo.remove();
    });
  });
}

// ────────────────────────────────────────────────
// SVG Sprite Builders
// ────────────────────────────────────────────────

function createUFO() {
  const wrap = document.createElement('div');
  wrap.className = 'ee-sprite';
  wrap.style.width = '64px';
  wrap.style.height = '40px';
  wrap.innerHTML = `<svg viewBox="0 0 100 65" width="64" height="40" style="overflow:visible">
    <defs>
      <filter id="ufo-glow">
        <feGaussianBlur stdDeviation="2.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <!-- dome -->
    <ellipse cx="50" cy="24" rx="16" ry="14" fill="#99ddcc" opacity="0.8"/>
    <ellipse cx="50" cy="24" rx="12" ry="10" fill="#bbffee" opacity="0.5"/>
    <!-- body disc -->
    <ellipse cx="50" cy="35" rx="44" ry="13" fill="#667788" filter="url(#ufo-glow)"/>
    <ellipse cx="50" cy="33" rx="38" ry="9" fill="#8899aa"/>
    <!-- rim lights -->
    <circle cx="18" cy="37" r="3" fill="#00ffcc" opacity="0.9">
      <animate attributeName="opacity" values="1;0.3;1" dur="0.6s" repeatCount="indefinite"/>
    </circle>
    <circle cx="38" cy="41" r="2.5" fill="#00ffcc" opacity="0.7">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="0.6s" repeatCount="indefinite"/>
    </circle>
    <circle cx="62" cy="41" r="2.5" fill="#00ffcc" opacity="0.7">
      <animate attributeName="opacity" values="0.8;0.2;0.8" dur="0.6s" repeatCount="indefinite"/>
    </circle>
    <circle cx="82" cy="37" r="3" fill="#00ffcc" opacity="0.9">
      <animate attributeName="opacity" values="0.3;1;0.3" dur="0.6s" repeatCount="indefinite"/>
    </circle>
    <!-- bottom beam hint -->
    <ellipse cx="50" cy="44" rx="18" ry="4" fill="#00ffaa" opacity="0.2"/>
  </svg>`;
  return wrap;
}

function createJet(direction) {
  const wrap = document.createElement('div');
  wrap.className = 'ee-sprite';
  wrap.style.width = '90px';
  wrap.style.height = '55px';

  const flip = direction === 'left' ? 'transform="translate(120,0) scale(-1,1)"' : '';
  wrap.innerHTML = `<svg viewBox="0 0 120 50" width="90" height="38" style="overflow:visible">
    <defs>
      <filter id="jet-shadow">
        <feDropShadow dx="1" dy="2" stdDeviation="2" flood-opacity="0.4"/>
      </filter>
    </defs>
    <g ${flip} filter="url(#jet-shadow)">
      <!-- swept wings -->
      <polygon points="75,25 85,22 62,2 48,19 48,31 62,48 85,28" fill="#2e2e38"/>
      <!-- tail fins -->
      <polygon points="28,24 16,8 8,20 8,30 16,42 28,26" fill="#2e2e38"/>
      <!-- fuselage -->
      <polygon points="116,25 104,21 28,22 18,24 8,25 18,26 28,28 104,29" fill="#3a3a44"/>
      <!-- canopy -->
      <ellipse cx="92" cy="25" rx="7" ry="3.5" fill="#446688" opacity="0.8"/>
      <!-- engine glow -->
      <ellipse cx="5" cy="25" rx="7" ry="5" fill="#ff6600" opacity="0.7"/>
      <ellipse cx="3" cy="25" rx="9" ry="6" fill="#ff8800" opacity="0.15"/>
    </g>
  </svg>
  <div class="ee-jet-label">NORTHROP GRUMMAN</div>`;
  return wrap;
}

// ────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function anim(ms, tick) {
  return new Promise(resolve => {
    const start = performance.now();
    (function frame(now) {
      const t = Math.min((now - start) / ms, 1);
      tick(t);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    })(performance.now());
  });
}
