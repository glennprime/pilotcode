// Easter Egg: Northrop Grumman vs UFO aerial dogfight

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
    }, 2000);
  });
}

/* ── Phase 1: Saucer flees L→R, jet chases & fires ── */
function phase1(overlay, onDone) {
  const dur = 3500;

  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  saucerMover.style.animation = `ee-fly-right ${dur}ms linear forwards`;
  saucerMover.appendChild(makeSaucer());
  overlay.appendChild(saucerMover);

  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '16%';
  jetMover.style.animation = `ee-fly-right-trail ${dur}ms linear forwards`;
  jetMover.appendChild(makeJet('right'));
  overlay.appendChild(jetMover);

  // Projectiles
  const startTime = Date.now();
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (!overlay.isConnected) return;
      const p = document.createElement('div');
      p.className = 'ee-projectile';
      const progress = (Date.now() - startTime) / dur;
      const jetX = -500 + progress * (window.innerWidth + 600);
      p.style.top = `calc(16% + 20px)`;
      p.style.left = `${jetX + 100}px`;
      p.style.animation = 'ee-projectile-fly 0.5s linear forwards';
      overlay.appendChild(p);
      setTimeout(() => p.remove(), 500);
    }, 300 + i * 500);
  }

  setTimeout(() => {
    saucerMover.remove();
    jetMover.remove();
    onDone();
  }, dur);
}

/* ── Phase 2: Saucer chases jet R→L, laser, explosion, saucer hovers ── */
function phase2(overlay, onDone) {
  const dur = 3500;

  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '16%';
  jetMover.style.animation = `ee-fly-left-jet ${dur}ms ease-out forwards`;
  const jetEl = makeJet('left');
  jetMover.appendChild(jetEl);
  overlay.appendChild(jetMover);

  // Saucer: flies in from right, stops at center to hover victoriously
  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  saucerMover.style.animation = `ee-fly-left-stop ${dur}ms ease-out forwards`;
  const saucerEl = makeSaucer();
  saucerMover.appendChild(saucerEl);
  overlay.appendChild(saucerMover);

  // Store saucer ref on overlay so phase3 can target it
  overlay._saucerMover = saucerMover;
  overlay._saucerEl = saucerEl;

  const hitTime = dur * 0.35;
  setTimeout(() => {
    if (!overlay.isConnected) return;

    const jetCenterX = window.innerWidth * 0.40 + 50;
    const saucerFrac = hitTime / dur;
    // Saucer stops at 50vw, but at hitTime it's still approaching
    const saucerX = (window.innerWidth + 100) - saucerFrac * (window.innerWidth + 100 - window.innerWidth * 0.5);

    const laser = document.createElement('div');
    laser.className = 'ee-laser';
    laser.style.top = `calc(15% + 16px)`;
    laser.style.left = `${Math.min(jetCenterX, saucerX)}px`;
    laser.style.width = `${Math.abs(saucerX - jetCenterX)}px`;
    overlay.appendChild(laser);

    setTimeout(() => {
      laser.remove();
      const boom = document.createElement('div');
      boom.className = 'ee-explosion';
      boom.style.top = `calc(16% + 10px)`;
      boom.style.left = `${jetCenterX - 5}px`;
      overlay.appendChild(boom);
      jetEl.style.visibility = 'hidden';
      setTimeout(() => boom.remove(), 800);
    }, 300);
  }, hitTime);

  setTimeout(() => {
    jetMover.remove();
    // saucerMover stays — phase3 will clean it up
    onDone();
  }, dur + 800);
}

/* ── Phase 3: Lockheed Martin missile from below takes out the saucer ── */
function phase3(overlay, onDone) {
  const dur = 1500;

  // Saucer is hovering at ~50vw, 15% top from phase 2
  const saucerMover = overlay._saucerMover;
  const saucerEl = overlay._saucerEl;
  const saucerCenterX = window.innerWidth * 0.50 + 30;
  const saucerTopPx = window.innerHeight * 0.15 + 16;

  // Missile rises from bottom toward saucer
  const missile = document.createElement('div');
  missile.className = 'ee-missile';
  missile.style.left = `${saucerCenterX - 4}px`;
  missile.style.bottom = '-40px';
  missile.style.animation = `ee-missile-rise ${dur}ms ease-in forwards`;
  // Set the target top as a CSS variable so the keyframe can use it
  missile.style.setProperty('--target-top', `${saucerTopPx}px`);

  // Smoke trail
  const trail = document.createElement('div');
  trail.className = 'ee-missile-trail';
  missile.appendChild(trail);

  // Label
  const label = document.createElement('div');
  label.className = 'ee-missile-label';
  label.textContent = 'LOCKHEED MARTIN';
  missile.appendChild(label);

  overlay.appendChild(missile);

  // At impact
  setTimeout(() => {
    if (!overlay.isConnected) return;
    missile.remove();

    // Green-tinted explosion for the saucer
    const boom = document.createElement('div');
    boom.className = 'ee-explosion ee-explosion-green';
    boom.style.top = `${saucerTopPx - 5}px`;
    boom.style.left = `${saucerCenterX - 5}px`;
    overlay.appendChild(boom);

    if (saucerEl) saucerEl.style.visibility = 'hidden';

    // Flash "LOCKHEED MARTIN" text on screen
    const winText = document.createElement('div');
    winText.className = 'ee-win-text';
    winText.textContent = 'LOCKHEED MARTIN';
    overlay.appendChild(winText);

    setTimeout(() => {
      boom.remove();
      winText.remove();
      if (saucerMover) saucerMover.remove();
      onDone();
    }, 2000);
  }, dur);
}

/* ── Sprite builders ── */

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

// direction: 'right' (nose pointing right) or 'left' (nose pointing left)
function makeJet(direction) {
  const el = document.createElement('div');
  el.className = 'ee-jet';

  // SVG fighter jet — top-down view, nose pointing RIGHT
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 50');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '50');
  svg.style.overflow = 'visible';

  // Flip the entire SVG content if facing left
  if (direction === 'left') {
    const g = document.createElementNS(svgNS, 'g');
    g.setAttribute('transform', 'translate(120,0) scale(-1,1)');
    buildJetPaths(svgNS, g);
    svg.appendChild(g);
  } else {
    buildJetPaths(svgNS, svg);
  }

  el.appendChild(svg);

  // Label underneath — always reads left to right
  const label = document.createElement('div');
  label.className = 'ee-jet-label';
  label.textContent = 'NORTHROP GRUMMAN';
  el.appendChild(label);

  return el;
}

function buildJetPaths(ns, parent) {
  // Main fuselage
  const fuse = document.createElementNS(ns, 'polygon');
  fuse.setAttribute('points', '118,25 105,21 30,22 20,24 10,25 20,26 30,28 105,29');
  fuse.setAttribute('fill', '#3a3a44');

  // Swept wings
  const wings = document.createElementNS(ns, 'polygon');
  wings.setAttribute('points', '75,25 85,22 65,2 50,18 50,32 65,48 85,28');
  wings.setAttribute('fill', '#2e2e38');

  // Tail fins
  const tail = document.createElementNS(ns, 'polygon');
  tail.setAttribute('points', '30,24 18,10 10,20 10,30 18,40 30,26');
  tail.setAttribute('fill', '#2e2e38');

  // Canopy (cockpit window)
  const canopy = document.createElementNS(ns, 'ellipse');
  canopy.setAttribute('cx', '95');
  canopy.setAttribute('cy', '25');
  canopy.setAttribute('rx', '6');
  canopy.setAttribute('ry', '3');
  canopy.setAttribute('fill', '#556688');
  canopy.setAttribute('opacity', '0.7');

  // Engine glow
  const engine = document.createElementNS(ns, 'ellipse');
  engine.setAttribute('cx', '6');
  engine.setAttribute('cy', '25');
  engine.setAttribute('rx', '6');
  engine.setAttribute('ry', '4');
  engine.setAttribute('fill', '#ff6600');
  engine.setAttribute('opacity', '0.8');

  // Engine glow halo
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
