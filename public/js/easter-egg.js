// Easter Egg: UFO wanders the screen randomly for 20s then flies away

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

  const ufo = createUFO();
  overlay.appendChild(ufo);

  const W = window.innerWidth;
  const H = window.innerHeight;
  const pad = 60; // keep UFO away from edges

  // Pick random waypoints the UFO will drift between
  function randX() { return pad + Math.random() * (W - pad * 2 - 80); }
  function randY() { return pad + Math.random() * (H - pad * 2 - 48); }

  // Start off-screen left
  let x = -100;
  let y = H * 0.3 + Math.random() * H * 0.3;
  ufo.style.left = x + 'px';
  ufo.style.top = y + 'px';

  // Generate waypoints: enter → wander → exit
  const waypoints = [];

  // First waypoint: fly onto the screen
  waypoints.push({ x: randX(), y: randY(), duration: 2000 });

  // 6-8 random waypoints for the wandering phase
  const numWaypoints = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numWaypoints; i++) {
    waypoints.push({ x: randX(), y: randY(), duration: 1800 + Math.random() * 1500 });
  }

  // Final waypoint: exit off-screen right
  waypoints.push({ x: W + 100, y: pad + Math.random() * (H * 0.4), duration: 2000 });

  // Animate through waypoints sequentially
  let chain = Promise.resolve();
  let wobblePhase = Math.random() * Math.PI * 2;

  for (const wp of waypoints) {
    chain = chain.then(() => {
      const startX = x;
      const startY = y;
      return anim(wp.duration, (t) => {
        // Smooth easing (ease-in-out)
        const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const cx = lerp(startX, wp.x, ease);
        const cy = lerp(startY, wp.y, ease);

        // Wobble: gentle sine oscillation
        const wobbleX = Math.sin(wobblePhase + t * 8) * 6;
        const wobbleY = Math.cos(wobblePhase + t * 6) * 4;

        ufo.style.left = (cx + wobbleX) + 'px';
        ufo.style.top = (cy + wobbleY) + 'px';

        // Slight tilt based on horizontal movement direction
        const dx = wp.x - startX;
        const tilt = Math.sign(dx) * Math.min(Math.abs(dx) / 300, 1) * 8;
        ufo.style.transform = `rotate(${tilt * (1 - t)}deg)`;
      }).then(() => {
        x = wp.x;
        y = wp.y;
        wobblePhase += Math.random() * 2;
      });
    });
  }

  chain.then(() => {
    ufo.remove();
    overlay.remove();
  }).catch(() => {
    overlay.remove();
  });
}

// ────────────────────────────────────────────────
// UFO Sprite
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

// ────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────

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
