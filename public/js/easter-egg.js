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
  const gap = 450; // constant gap between UFO (leader) and jet (chaser)

  const ufo = createUFO();
  const jet = createJet('right');
  overlay.appendChild(ufo);
  overlay.appendChild(jet);

  ufo.style.top = '35%';
  jet.style.top = '38%';

  const projectiles = [];
  const shotTimes = [0.2, 0.35, 0.5, 0.65, 0.8];
  const shotsFired = new Set();

  // L→R: UFO leads, jet follows. Same speed. Constant gap.
  // Start far enough left that jet is offscreen. End far enough right that jet exits.
  const startX = -gap - 350; // jet starts here, UFO starts at startX + gap
  const endX = W + 350;      // jet ends here, UFO ends at endX + gap

  return anim(4500, (t) => {
    const jetX = lerp(startX, endX, t);
    const ufoX = jetX + gap;
    jet.style.left = jetX + 'px';
    ufo.style.left = ufoX + 'px';
    ufo.style.top = `calc(35% + ${Math.sin(t * 20) * 3}px)`;

    // fire shots from jet nose
    for (const st of shotTimes) {
      if (t >= st && !shotsFired.has(st)) {
        shotsFired.add(st);
        const jetRect = jet.getBoundingClientRect();
        if (jetRect.right < 0) continue;
        const p = document.createElement('div');
        p.className = 'ee-projectile';
        p.style.top = (jetRect.top + jetRect.height * 0.4) + 'px';
        p.style.left = jetRect.right + 'px';
        overlay.appendChild(p);
        projectiles.push({ el: p, startX: jetRect.right, startT: t });
      }
    }

    for (const proj of projectiles) {
      const age = t - proj.startT;
      proj.el.style.left = (proj.startX + age * W * 3) + 'px';
      if (age > 0.1) proj.el.style.opacity = '0';
    }
  }).then(() => {
    ufo.remove();
    jet.remove();
    projectiles.forEach(p => p.el.remove());
  });
}

// ────────────────────────────────────────────────
// Phase 2: R→L. Jet leads (fleeing), UFO follows (chasing).
// Same speed, same gap. UFO fires laser, jet explodes.
// ────────────────────────────────────────────────
function runPhase2(overlay) {
  const W = window.innerWidth;
  const gap = 450;

  const jet = createJet('left');
  const ufo = createUFO();
  overlay.appendChild(jet);
  overlay.appendChild(ufo);

  jet.style.top = '38%';
  ufo.style.top = '35%';

  let laserFired = false;
  let exploded = false;
  overlay._ufo = ufo;

  // R→L: Jet leads (further left), UFO follows behind (further right).
  // Start far enough right that UFO is offscreen. End far enough left that jet exits.
  const startX = W + gap + 100; // UFO starts here, jet starts at startX - gap
  const endX = -350;

  return anim(4500, (t) => {
    if (!exploded) {
      // Both fly at same speed, constant gap
      const ufoX = lerp(startX, endX, t);
      const jetX = ufoX - gap;
      ufo.style.left = ufoX + 'px';
      jet.style.left = jetX + 'px';
    }
    ufo.style.top = `calc(35% + ${Math.sin(t * 20) * 3}px)`;

    // Fire laser at t=0.4
    if (t >= 0.4 && !laserFired) {
      laserFired = true;
      const ufoRect = ufo.getBoundingClientRect();
      const jetRect = jet.getBoundingClientRect();
      const laser = document.createElement('div');
      laser.className = 'ee-laser';
      laser.style.top = (ufoRect.top + ufoRect.height / 2) + 'px';
      // laser from UFO left edge to jet right edge
      laser.style.left = (jetRect.left + jetRect.width * 0.5) + 'px';
      laser.style.width = (ufoRect.left - jetRect.left - jetRect.width * 0.5) + 'px';
      overlay.appendChild(laser);
      setTimeout(() => laser.remove(), 300);
    }

    // Explode jet at t=0.47
    if (t >= 0.47 && !exploded) {
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

    // After explosion, UFO decelerates to hover at center
    if (exploded) {
      const hoverTarget = W * 0.45;
      const currentX = parseFloat(ufo.style.left) || hoverTarget;
      ufo.style.left = lerp(currentX, hoverTarget, 0.03) + 'px';
    }
  }).then(() => {
    jet.remove();
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
  missile.className = 'ee-sprite';
  missile.style.width = '60px';
  missile.style.height = '180px';
  missile.style.left = (targetX - 30) + 'px';
  const missileImg = document.createElement('img');
  missileImg.src = '/img/missile.png';
  missileImg.style.width = '100%';
  missileImg.style.height = '100%';
  missileImg.style.objectFit = 'contain';
  missileImg.draggable = false;
  missile.appendChild(missileImg);
  overlay.appendChild(missile);

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
