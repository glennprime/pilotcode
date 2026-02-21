// Easter Egg: Northrop Grumman vs UFO aerial dogfight

let eeTimer = null;
let eeInitTimer = null;

export function initEasterEgg() {
  eeInitTimer = setTimeout(runEasterEgg, 30_000);
  eeTimer = setInterval(runEasterEgg, 3_600_000);

  // Hidden trigger button in header
  const trigger = document.getElementById('ee-trigger');
  if (trigger) {
    trigger.addEventListener('click', () => {
      // Don't stack animations
      if (!document.getElementById('ee-overlay')) {
        runEasterEgg();
      }
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
        overlay.remove();
      });
    }, 2000);
  });
}

/* ── Phase 1: Saucer flees L→R, jet chases & fires ── */
function phase1(overlay, onDone) {
  const dur = 3500;

  // Saucer mover (outer = flight path, inner = wobble)
  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  saucerMover.style.animation = `ee-fly-right ${dur}ms linear forwards`;
  saucerMover.appendChild(makeSaucer());
  overlay.appendChild(saucerMover);

  // Jet mover (trailing behind)
  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '18%';
  jetMover.style.animation = `ee-fly-right-trail ${dur}ms linear forwards`;
  jetMover.appendChild(makeJet());
  overlay.appendChild(jetMover);

  // Fire projectiles ahead of the jet
  const startTime = Date.now();
  for (let i = 0; i < 5; i++) {
    setTimeout(() => {
      if (!overlay.isConnected) return;
      const p = document.createElement('div');
      p.className = 'ee-projectile';
      const progress = (Date.now() - startTime) / dur;
      const jetX = -220 + progress * (window.innerWidth + 320);
      p.style.top = `calc(18% + 16px)`;
      p.style.left = `${jetX + 80}px`;
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

/* ── Phase 2: Saucer chases jet R→L, laser, explosion ── */
function phase2(overlay, onDone) {
  const dur = 3500;

  // Jet fleeing R→L but slows and stops at ~40vw
  const jetMover = document.createElement('div');
  jetMover.className = 'ee-mover';
  jetMover.style.top = '18%';
  jetMover.style.animation = `ee-fly-left-jet ${dur}ms ease-out forwards`;
  const jetEl = makeJet(true); // flipped
  jetMover.appendChild(jetEl);
  overlay.appendChild(jetMover);

  // Saucer pursuing R→L
  const saucerMover = document.createElement('div');
  saucerMover.className = 'ee-mover';
  saucerMover.style.top = '15%';
  saucerMover.style.animation = `ee-fly-left ${dur}ms linear forwards`;
  saucerMover.appendChild(makeSaucer());
  overlay.appendChild(saucerMover);

  // Laser + explosion at ~35% of duration
  const hitTime = dur * 0.35;
  setTimeout(() => {
    if (!overlay.isConnected) return;

    // Jet is stopped at 40vw, saucer is somewhere to the right
    const jetCenterX = window.innerWidth * 0.40 + 40;
    // Saucer at hitTime: started at vw+100, going to -100, linear
    const saucerFrac = hitTime / dur;
    const saucerX = (window.innerWidth + 100) - saucerFrac * (window.innerWidth + 200);

    const laser = document.createElement('div');
    laser.className = 'ee-laser';
    laser.style.top = `calc(15% + 16px)`;
    const laserLeft = Math.min(jetCenterX, saucerX);
    const laserWidth = Math.abs(saucerX - jetCenterX);
    laser.style.left = `${laserLeft}px`;
    laser.style.width = `${laserWidth}px`;
    overlay.appendChild(laser);

    setTimeout(() => {
      laser.remove();

      // Explosion at jet position
      const boom = document.createElement('div');
      boom.className = 'ee-explosion';
      boom.style.top = `calc(18% + 8px)`;
      boom.style.left = `${jetCenterX - 5}px`;
      overlay.appendChild(boom);

      jetEl.style.visibility = 'hidden';
      setTimeout(() => boom.remove(), 800);
    }, 300);
  }, hitTime);

  setTimeout(() => {
    saucerMover.remove();
    jetMover.remove();
    onDone();
  }, dur + 800);
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

function makeJet(flip) {
  const el = document.createElement('div');
  el.className = 'ee-jet';
  if (flip) el.classList.add('ee-jet-flip');

  const body = document.createElement('div');
  body.className = 'ee-jet-body';

  const label = document.createElement('div');
  label.className = 'ee-jet-label';
  label.textContent = 'NORTHROP GRUMMAN';

  el.appendChild(body);
  el.appendChild(label);
  return el;
}
