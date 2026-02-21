// Easter Egg: Northrop Grumman vs UFO aerial dogfight
// Uses requestAnimationFrame for precise viewport-aware animation

let eeTimer = null;
let eeInitTimer = null;

export function initEasterEgg() {
  eeInitTimer = setTimeout(runEasterEgg, 30_000);
  eeTimer = setInterval(runEasterEgg, 3_600_000);

  const trigger = document.getElementById('ee-trigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      if (!document.getElementById('ee-overlay')) runEasterEgg();
    });
  }
}

function runEasterEgg() {
  const overlay = document.createElement('div');
  overlay.id = 'ee-overlay';
  document.body.appendChild(overlay);

  phase1(overlay, () => {
    setTimeout(() => {
      phase2(overlay, () => {
        setTimeout(() => {
          phase3(overlay, () => overlay.remove());
        }, 1500);
      });
    }, 1500);
  });
}

// ── Helper: animate with rAF ──
// `tick(progress)` called each frame with 0→1 progress
// Returns a promise that resolves when done
function animate(durationMs, tick) {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / durationMs, 1);
      tick(progress);
      if (progress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// ── Viewport-aware measurements ──
function vw() { return window.innerWidth; }
function spriteGap() { return Math.max(vw() * 0.35, 100); } // gap between saucer & jet

/* ═══════════════════════════════════════════════════
   Phase 1: Saucer flees L→R, jet chases & fires
   ═══════════════════════════════════════════════════ */
async function phase1(overlay, onDone) {
  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  saucerMover.appendChild(makeSaucer());
  overlay.appendChild(saucerMover);

  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '18%';
  jetMover.appendChild(makeJet('right'));
  overlay.appendChild(jetMover);

  const w = vw();
  const gap = spriteGap();
  const spriteW = 100; // approximate sprite width
  // Total distance: from fully offscreen-left to fully offscreen-right
  const startX = -spriteW - 20;
  const endX = w + 40;
  const totalDist = endX - startX;

  // Projectile scheduling
  const projectileTimes = [0.25, 0.35, 0.45, 0.55, 0.65];
  const firedProjectiles = new Set();

  await animate(4000, (p) => {
    if (!overlay.isConnected) return;

    const saucerX = startX + p * totalDist;
    const jetX = saucerX - gap;

    saucerMover.style.transform = `translateX(${saucerX}px)`;
    jetMover.style.transform = `translateX(${jetX}px)`;

    // Fire projectiles at specific progress points
    for (const t of projectileTimes) {
      if (p >= t && !firedProjectiles.has(t)) {
        firedProjectiles.add(t);
        fireProjectile(overlay, jetMover);
      }
    }
  });

  saucerMover.remove();
  jetMover.remove();
  onDone();
}

function fireProjectile(overlay, jetMover) {
  if (!overlay.isConnected) return;
  const rect = jetMover.getBoundingClientRect();
  if (rect.right < 0 || rect.left > vw()) return;
  const p = document.createElement('div');
  p.className = 'ee-projectile';
  p.style.top = `${rect.top + rect.height * 0.4}px`;
  p.style.left = `${rect.right - 10}px`;
  overlay.appendChild(p);
  setTimeout(() => p.remove(), 350);
}

/* ═══════════════════════════════════════════════════
   Phase 2: Saucer chases jet R→L, laser, explosion
   Saucer hovers at center after kill
   ═══════════════════════════════════════════════════ */
async function phase2(overlay, onDone) {
  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '18%';
  const jetEl = makeJet('left');
  jetMover.appendChild(jetEl);
  overlay.appendChild(jetMover);

  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  const saucerEl = makeSaucer();
  saucerMover.appendChild(saucerEl);
  overlay.appendChild(saucerMover);

  overlay._saucerMover = saucerMover;
  overlay._saucerEl = saucerEl;

  const w = vw();
  const gap = spriteGap();
  const spriteW = 100;
  const startX = w + spriteW;
  // Jet stops at 35% from left
  const jetStopX = w * 0.35;
  // Saucer ends at center
  const saucerEndX = w * 0.45;

  let laserFired = false;
  let jetExploded = false;

  await animate(3500, (p) => {
    if (!overlay.isConnected) return;

    // Jet: flies in from right, decelerates and stops at jetStopX
    const jetEase = easeOutCubic(Math.min(p / 0.4, 1)); // stops by 40% of animation
    const jetX = startX + (jetStopX - startX) * jetEase;

    // Saucer: flies in from right, decelerates to hover at center
    const saucerEase = easeOutCubic(Math.min(p / 0.7, 1));
    const saucerX = (startX + gap) + (saucerEndX - (startX + gap)) * saucerEase;

    jetMover.style.transform = `translateX(${jetX}px)`;
    saucerMover.style.transform = `translateX(${saucerX}px)`;

    // Fire laser at 45%
    if (p >= 0.45 && !laserFired) {
      laserFired = true;
      fireLaser(overlay, saucerMover, jetMover);
    }

    // Explode jet at 55%
    if (p >= 0.55 && !jetExploded) {
      jetExploded = true;
      explodeAt(overlay, jetMover, 'ee-explosion');
      jetEl.style.visibility = 'hidden';
    }
  });

  jetMover.remove();
  // saucerMover stays for phase 3
  onDone();
}

function fireLaser(overlay, fromMover, toMover) {
  if (!overlay.isConnected) return;
  const fromRect = fromMover.getBoundingClientRect();
  const toRect = toMover.getBoundingClientRect();
  const fromX = fromRect.left + fromRect.width * 0.3;
  const toX = toRect.left + toRect.width * 0.5;
  const y = fromRect.top + fromRect.height * 0.5;

  const laser = document.createElement('div');
  laser.className = 'ee-laser';
  laser.style.top = `${y}px`;
  laser.style.left = `${Math.min(fromX, toX)}px`;
  laser.style.width = `${Math.abs(fromX - toX)}px`;
  overlay.appendChild(laser);
  setTimeout(() => laser.remove(), 350);
}

function explodeAt(overlay, targetMover, extraClass) {
  if (!overlay.isConnected) return;
  const rect = targetMover.getBoundingClientRect();
  const boom = document.createElement('div');
  boom.className = `ee-explosion ${extraClass || ''}`;
  boom.style.top = `${rect.top + rect.height / 2 - 5}px`;
  boom.style.left = `${rect.left + rect.width / 2 - 5}px`;
  overlay.appendChild(boom);
  setTimeout(() => boom.remove(), 1200);
}

/* ═══════════════════════════════════════════════════
   Phase 3: Lockheed Martin missile from below
   ═══════════════════════════════════════════════════ */
async function phase3(overlay, onDone) {
  const saucerMover = overlay._saucerMover;
  const saucerEl = overlay._saucerEl;

  if (!saucerMover || !overlay.isConnected) { onDone(); return; }

  const saucerRect = saucerMover.getBoundingClientRect();
  const targetX = saucerRect.left + saucerRect.width / 2;
  const targetY = saucerRect.top + saucerRect.height / 2;
  const screenH = window.innerHeight;

  const missile = document.createElement('div');
  missile.className = 'ee-missile';
  missile.style.left = `${targetX - 4}px`;
  overlay.appendChild(missile);

  const trail = document.createElement('div');
  trail.className = 'ee-missile-trail';
  missile.appendChild(trail);

  const label = document.createElement('div');
  label.className = 'ee-missile-label';
  label.textContent = 'LOCKHEED MARTIN';
  missile.appendChild(label);

  const startY = screenH + 40;
  const endY = targetY;

  await animate(1200, (p) => {
    if (!overlay.isConnected) return;
    const eased = easeInQuad(p);
    const y = startY + (endY - startY) * eased;
    missile.style.top = `${y}px`;
  });

  missile.remove();

  // Green explosion on saucer
  explodeAt(overlay, saucerMover, 'ee-explosion-green');
  if (saucerEl) saucerEl.style.visibility = 'hidden';

  // Victory text
  const winText = document.createElement('div');
  winText.className = 'ee-win-text';
  winText.textContent = 'LOCKHEED MARTIN';
  overlay.appendChild(winText);

  await new Promise(r => setTimeout(r, 2000));
  winText.remove();
  saucerMover.remove();
  onDone();
}

/* ── Easing functions ── */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInQuad(t) { return t * t; }

/* ═══════════════════════════════════════════════════
   Sprite builders
   ═══════════════════════════════════════════════════ */

function makeSaucer() {
  const el = document.createElement('div');
  el.className = 'ee-saucer';
  const dome = document.createElement('div');
  dome.className = 'ee-saucer-dome';
  const body = document.createElement('div');
  body.className = 'ee-saucer-body';
  el.appendChild(dome);
  el.appendChild(body);
  return el;
}

function makeJet(direction) {
  const el = document.createElement('div');
  el.className = 'ee-jet';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 50');
  svg.style.overflow = 'visible';

  if (direction === 'left') {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', 'translate(120,0) scale(-1,1)');
    buildJetPaths(svgNS, g);
    svg.appendChild(g);
  } else {
    buildJetPaths(svgNS, svg);
  }

  el.appendChild(svg);

  const label = document.createElement('div');
  label.className = 'ee-jet-label';
  label.textContent = 'NORTHROP GRUMMAN';
  el.appendChild(label);

  return el;
}

function buildJetPaths(ns, parent) {
  const fuse = document.createElementNS(ns, 'polygon');
  fuse.setAttribute('points', '118,25 105,21 30,22 20,24 10,25 20,26 30,28 105,29');
  fuse.setAttribute('fill', '#3a3a44');

  const wings = document.createElementNS(ns, 'polygon');
  wings.setAttribute('points', '75,25 85,22 65,2 50,18 50,32 65,48 85,28');
  wings.setAttribute('fill', '#2e2e38');

  const tail = document.createElementNS(ns, 'polygon');
  tail.setAttribute('points', '30,24 18,10 10,20 10,30 18,40 30,26');
  tail.setAttribute('fill', '#2e2e38');

  const canopy = document.createElementNS(ns, 'ellipse');
  canopy.setAttribute('cx', '95');
  canopy.setAttribute('cy', '25');
  canopy.setAttribute('rx', '6');
  canopy.setAttribute('ry', '3');
  canopy.setAttribute('fill', '#556688');
  canopy.setAttribute('opacity', '0.7');

  const engine = document.createElementNS(ns, 'ellipse');
  engine.setAttribute('cx', '6');
  engine.setAttribute('cy', '25');
  engine.setAttribute('rx', '6');
  engine.setAttribute('ry', '4');
  engine.setAttribute('fill', '#ff6600');
  engine.setAttribute('opacity', '0.8');

  const halo = document.createElementNS(ns, 'ellipse');
  halo.setAttribute('cx', '4');
  halo.setAttribute('cy', '25');
  halo.setAttribute('rx', '8');
  halo.setAttribute('ry', '5');
  halo.setAttribute('fill', 'none');
  halo.setAttribute('stroke', '#ff8800');
  halo.setAttribute('stroke-width', '1');
  halo.setAttribute('opacity', '0.4');

  parent.appendChild(wings);
  parent.appendChild(tail);
  parent.appendChild(fuse);
  parent.appendChild(canopy);
  parent.appendChild(engine);
  parent.appendChild(halo);
}
