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
  const gap = Math.max(W * 0.5, 200);

  const ufo = createUFO();
  const jet = createJet('right');
  overlay.appendChild(ufo);
  overlay.appendChild(jet);

  ufo.style.top = '35%';
  jet.style.top = '38%';

  const projectiles = [];
  const shotTimes = [0.2, 0.35, 0.5, 0.65, 0.8];
  const shotsFired = new Set();

  return anim(4000, (t) => {
    const ufoX = lerp(-80, W + 80, t);
    const jetX = ufoX - gap;
    ufo.style.left = ufoX + 'px';
    jet.style.left = jetX + 'px';

    // wobble the ufo
    ufo.style.top = `calc(35% + ${Math.sin(t * 20) * 3}px)`;

    // fire shots from jet nose
    for (const st of shotTimes) {
      if (t >= st && !shotsFired.has(st)) {
        shotsFired.add(st);
        const jetRect = jet.getBoundingClientRect();
        const p = document.createElement('div');
        p.className = 'ee-projectile';
        p.style.top = (jetRect.top + jetRect.height * 0.4) + 'px';
        p.style.left = jetRect.right + 'px';
        overlay.appendChild(p);
        projectiles.push({ el: p, startX: jetRect.right, startT: t });
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
// Phase 2: Both fly right→left, UFO overtakes jet, laser, explosion
// Jet keeps flying (planes don't stop!), UFO catches up
// ────────────────────────────────────────────────
function runPhase2(overlay) {
  const W = window.innerWidth;

  const jet = createJet('left');
  const ufo = createUFO();
  overlay.appendChild(jet);
  overlay.appendChild(ufo);

  jet.style.top = '38%';
  ufo.style.top = '35%';

  let laserFired = false;
  let exploded = false;

  // store for phase 3
  overlay._ufo = ufo;

  // Jet flies steady R→L across entire screen
  const jetStart = W + 100;
  const jetEnd = -350;

  // UFO starts further right (behind jet), flies faster to overtake
  const ufoStart = W + 300;
  const ufoEnd = -100;

  return anim(4500, (t) => {
    // Jet: constant speed R→L
    const jetX = lerp(jetStart, jetEnd, t);
    jet.style.left = jetX + 'px';

    // UFO: starts behind, accelerates to overtake
    // Ease-in-out so it starts slow, catches up, then cruises past
    const ufoEased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const ufoX = lerp(ufoStart, ufoEnd, ufoEased);
    ufo.style.left = ufoX + 'px';
    ufo.style.top = `calc(35% + ${Math.sin(t * 20) * 3}px)`;

    // Fire laser when UFO is close to jet (~45%)
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
      laser.style.width = Math.max(right - left, 20) + 'px';
      overlay.appendChild(laser);
      setTimeout(() => laser.remove(), 300);
    }

    // Explode jet at t=0.52 (right after laser)
    if (t >= 0.52 && !exploded) {
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

    // After explosion, UFO decelerates to hover at center for phase 3
    if (t > 0.7) {
      const hoverT = (t - 0.7) / 0.3; // 0→1 over last 30%
      const hoverX = lerp(ufoX, W * 0.45, hoverT * hoverT);
      ufo.style.left = hoverX + 'px';
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
  wrap.style.width = '80px';
  wrap.style.height = '48px';
  const img = document.createElement('img');
  img.src = '/img/ufo.png';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.filter = 'drop-shadow(0 0 8px rgba(0, 150, 255, 0.5))';
  img.draggable = false;
  wrap.appendChild(img);
  return wrap;
}

function createJet(direction) {
  const wrap = document.createElement('div');
  wrap.className = 'ee-sprite';
  wrap.style.width = '300px';
  wrap.style.height = '150px';
  const img = document.createElement('img');
  img.src = '/img/jet-right.png';
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = 'contain';
  img.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
  img.draggable = false;
  // Use dedicated left-facing image when available
  if (direction === 'left') {
    img.src = '/img/jet-left.png';
  }
  wrap.appendChild(img);
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
