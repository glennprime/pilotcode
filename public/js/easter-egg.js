// Easter Egg: Northrop Grumman vs UFO aerial dogfight

let eeTimer = null;
let eeInitTimer = null;

export function initEasterEgg() {
  // First trigger 30s after load
  eeInitTimer = setTimeout(runEasterEgg, 30_000);
  // Then every hour
  eeTimer = setInterval(runEasterEgg, 3_600_000);
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

// Phase 1: Saucer flees left-to-right, jet chases and fires
function phase1(overlay, onDone) {
  const duration = 3000;

  // Saucer
  const saucer = makeSaucer();
  saucer.style.animation = `ee-fly-right-saucer ${duration}ms linear forwards, ee-wobble 0.4s ease-in-out infinite`;
  overlay.appendChild(saucer);

  // Jet (starts further left = trailing behind)
  const jet = makeJet();
  jet.style.animation = `ee-fly-right-jet ${duration}ms linear forwards`;
  overlay.appendChild(jet);

  // Fire projectiles from the jet
  const projectileCount = 5;
  for (let i = 0; i < projectileCount; i++) {
    setTimeout(() => {
      if (!overlay.isConnected) return;
      const p = document.createElement('div');
      p.className = 'ee-projectile';
      // Position near the jet's current estimated X
      const progress = (Date.now() - startTime) / duration;
      const jetX = -200 + progress * (window.innerWidth + 280);
      p.style.top = `calc(22% + 6px)`;
      p.style.left = `${jetX + 56}px`;
      p.style.animation = 'ee-projectile-fly 0.5s linear forwards';
      overlay.appendChild(p);
      setTimeout(() => p.remove(), 500);
    }, 400 + i * 450);
  }

  const startTime = Date.now();

  setTimeout(() => {
    saucer.remove();
    jet.remove();
    onDone();
  }, duration);
}

// Phase 2: Saucer chases jet right-to-left, fires laser, jet explodes
function phase2(overlay, onDone) {
  const duration = 3000;

  // Jet enters from right, slows and stops around 45vw
  const jet = makeJet();
  jet.style.animation = `ee-fly-left-jet ${duration}ms ease-out forwards`;
  overlay.appendChild(jet);

  // Saucer enters from right, chasing
  const saucer = makeSaucer();
  saucer.style.animation = `ee-fly-left-saucer ${duration}ms linear forwards, ee-wobble 0.4s ease-in-out infinite`;
  overlay.appendChild(saucer);

  // At ~40% through, fire laser and explode jet
  const hitTime = duration * 0.4;

  setTimeout(() => {
    if (!overlay.isConnected) return;

    // Laser beam
    const laser = document.createElement('div');
    laser.className = 'ee-laser';
    const jetStopX = window.innerWidth * 0.45 + 28; // center of jet
    const saucerProgress = 0.6; // saucer is at ~60% from right at hit time
    const saucerX = window.innerWidth + 80 - saucerProgress * (window.innerWidth + 160);
    laser.style.top = `calc(18% + 12px)`;
    laser.style.left = `${Math.min(jetStopX, saucerX)}px`;
    laser.style.width = `${Math.abs(saucerX - jetStopX)}px`;
    overlay.appendChild(laser);

    setTimeout(() => {
      laser.remove();

      // Explosion at jet position
      const explosion = document.createElement('div');
      explosion.className = 'ee-explosion';
      explosion.style.top = `calc(22% - 5px)`;
      explosion.style.left = `${jetStopX - 5}px`;
      overlay.appendChild(explosion);

      // Hide jet
      jet.style.visibility = 'hidden';

      setTimeout(() => explosion.remove(), 800);
    }, 300);
  }, hitTime);

  setTimeout(() => {
    saucer.remove();
    jet.remove();
    onDone();
  }, duration + 800);
}

function makeSaucer() {
  const wrapper = document.createElement('div');
  wrapper.className = 'ee-saucer';

  const dome = document.createElement('div');
  dome.className = 'ee-saucer-dome';

  const body = document.createElement('div');
  body.className = 'ee-saucer-body';

  wrapper.appendChild(dome);
  wrapper.appendChild(body);
  return wrapper;
}

function makeJet() {
  const wrapper = document.createElement('div');
  wrapper.className = 'ee-jet';

  const body = document.createElement('div');
  body.className = 'ee-jet-body';

  const label = document.createElement('div');
  label.className = 'ee-jet-label';
  label.textContent = 'NORTHROP GRUMMAN';

  wrapper.appendChild(body);
  wrapper.appendChild(label);
  return wrapper;
}
