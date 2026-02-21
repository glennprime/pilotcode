// Easter Egg: UFO wanders the screen randomly for ~20s then flies away

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
  const pad = 60;

  function randX() { return pad + Math.random() * (W - pad * 2 - 80); }
  function randY() { return pad + Math.random() * (H - pad * 2 - 48); }

  // Build waypoints: enter → wander → exit
  const waypoints = [];
  waypoints.push({ x: -100, y: H * 0.3 + Math.random() * H * 0.3 }); // start off-screen
  waypoints.push({ x: randX(), y: randY() }); // enter
  const numStops = 6 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numStops; i++) {
    waypoints.push({ x: randX(), y: randY() });
  }
  waypoints.push({ x: W + 100, y: pad + Math.random() * (H * 0.4) }); // exit

  // Total duration: ~20s, split evenly across segments
  const totalDuration = 20000;
  const segCount = waypoints.length - 1;
  const segDuration = totalDuration / segCount;

  // Single continuous animation over the full duration
  const startTime = performance.now();

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / totalDuration, 1);

    // Which segment are we in?
    const segFloat = t * segCount;
    const segIndex = Math.min(Math.floor(segFloat), segCount - 1);
    const segT = segFloat - segIndex;

    // Smooth ease-in-out within segment
    const ease = segT < 0.5 ? 2 * segT * segT : 1 - Math.pow(-2 * segT + 2, 2) / 2;

    const from = waypoints[segIndex];
    const to = waypoints[segIndex + 1];
    const cx = lerp(from.x, to.x, ease);
    const cy = lerp(from.y, to.y, ease);

    // Continuous wobble based on total elapsed time (no discontinuities)
    const secs = elapsed / 1000;
    const wobbleX = Math.sin(secs * 2.5) * 6;
    const wobbleY = Math.cos(secs * 1.8) * 4;

    ufo.style.left = (cx + wobbleX) + 'px';
    ufo.style.top = (cy + wobbleY) + 'px';

    // Gentle tilt based on current horizontal velocity
    const tilt = (to.x - from.x) / W * 12 * Math.sin(ease * Math.PI);
    ufo.style.transform = `rotate(${tilt}deg)`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      ufo.remove();
      overlay.remove();
    }
  }

  requestAnimationFrame(frame);
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
