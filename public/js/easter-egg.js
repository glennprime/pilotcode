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

  jet.style.top = '38%';
  ufo.style.top = '35%';

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
    ufo.style.top = `calc(35% + ${Math.sin(t * 20) * 3}px)`;

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
  wrap.style.width = '120px';
  wrap.style.height = '60px';
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
