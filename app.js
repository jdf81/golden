// Golden — main app
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

const MODE_LIST = [
  { id: 'minimal',      name: 'Minimal',      sub: 'Quiet. Just the best find.' },
  { id: 'photographer', name: 'Photographer', sub: 'φ-grid + ratio readout.' },
  { id: 'educational',  name: 'Educational',  sub: 'Labels & explanations.' },
  { id: 'playful',      name: 'Hunt',         sub: 'Score & collect spirals.' },
];

const state = {
  screen: 'splash',
  mode: 'minimal',
  stream: null,
  video: null,
  overlay: null,
  octx: null,
  detector: null,
  tracker: new Tracker(),
  tracks: [],
  lastDetect: 0,
  manualAnchors: [],
  hud: { ar: null, conf: 0, dphi: 0 },
  hunt: {
    collection: JSON.parse(localStorage.getItem('golden.collection') || '[]'),
    streak: parseInt(localStorage.getItem('golden.streak') || '0', 10),
    flashUntil: 0,
  },
};

// ──────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────
function boot() {
  renderSplash();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  // hide install hint when running as PWA
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone;
  if (isStandalone) $('.install-hint')?.classList.add('hidden');
}

// ──────────────────────────────────────────────────────────────
// Splash
// ──────────────────────────────────────────────────────────────
function renderSplash() {
  const app = $('#app');
  app.innerHTML = `
    <section id="splash" class="screen active">
      <div class="brand">
        <svg class="brand-mark" viewBox="0 0 220 140">
          <path d="" id="splashSpiral" fill="none" stroke="#d9b04a" stroke-width="3" stroke-linecap="round"/>
        </svg>
        <h1>Golden</h1>
        <p>Find φ everywhere.</p>
      </div>
      <div class="modes">
        ${MODE_LIST.map((m, i) => `
          <button class="mode-btn" data-mode="${m.id}">
            <div class="num">0${i + 1}</div>
            <div class="name">${m.name}</div>
            <div class="sub">${m.sub}</div>
          </button>
        `).join('')}
      </div>
      <div class="install-hint">
        On iPhone: tap <b>Share ↑</b> → <b>Add to Home Screen</b> to install.<br/>
        Camera requires HTTPS &amp; one tap to start.
      </div>
    </section>
    <section id="live" class="screen"></section>
  `;
  // populate splash spiral
  const path = goldenSplashPath();
  document.getElementById('splashSpiral').setAttribute('d', path);
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    enterLive();
  }));
}

function goldenSplashPath() {
  // a spiral fitting 220 wide × 140 tall (~PHI rect)
  let w = 220, h = 140, bx = 0, by = 0, bw = w, bh = h, dir = 0;
  let d = '', first = true;
  for (let i = 0; i < 8; i++) {
    const sq = Math.min(bw, bh);
    let sx, sy, ex, ey;
    if (dir === 0) { sx = bx; sy = by + sq; ex = bx + sq; ey = by; bx += sq; bw -= sq; }
    else if (dir === 1) { sx = bx; sy = by; ex = bx + sq; ey = by + sq; by += sq; bh -= sq; }
    else if (dir === 2) { sx = bx + bw; sy = by; ex = bx + bw - sq; ey = by + sq; bw -= sq; }
    else { sx = bx + bw; sy = by + bh; ex = bx; ey = by + bh - sq; bh -= sq; }
    if (first) { d += `M ${sx} ${sy} `; first = false; }
    d += `A ${sq} ${sq} 0 0 1 ${ex} ${ey} `;
    dir = (dir + 1) % 4;
    if (sq < 2) break;
  }
  return d;
}

// ──────────────────────────────────────────────────────────────
// Camera
// ──────────────────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    state.stream = stream;
    state.video.srcObject = stream;
    await state.video.play();
    return true;
  } catch (e) {
    showCameraError(e);
    return false;
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
}

function showCameraError(e) {
  const live = $('#live');
  live.innerHTML = `
    <div class="center-msg">
      <h2>Camera blocked</h2>
      <p>${e.name === 'NotAllowedError'
        ? 'Permission denied. Open iOS Settings → Safari → Camera → Allow, then reload.'
        : 'Camera is unavailable. Try a different browser or reload.'}</p>
      <button class="btn-primary" id="retry">Try again</button>
    </div>
  `;
  $('#retry').addEventListener('click', () => enterLive());
}

// ──────────────────────────────────────────────────────────────
// Live screen
// ──────────────────────────────────────────────────────────────
async function enterLive() {
  $('#splash').classList.remove('active');
  const live = $('#live');
  live.classList.add('active');
  live.innerHTML = `
    <video id="cam" autoplay muted playsinline webkit-playsinline></video>
    <canvas id="overlay"></canvas>
    <div id="ui"></div>
    <div class="modebar" id="modebar">
      ${MODE_LIST.map(m => `<button data-mode="${m.id}" class="${m.id === state.mode ? 'on' : ''}">${m.name}</button>`).join('')}
    </div>
    <button class="back glass" id="back" aria-label="Back">←</button>
  `;
  state.video = $('#cam');
  state.overlay = $('#overlay');
  state.octx = state.overlay.getContext('2d');
  state.detector = state.detector || new GoldenDetector(120, 80);
  state.tracker = new Tracker();

  $('#back').addEventListener('click', () => {
    stopCamera();
    state.screen = 'splash';
    renderSplash();
  });
  $$('#modebar button').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    $$('#modebar button').forEach(x => x.classList.toggle('on', x.dataset.mode === state.mode));
    renderModeUI();
  }));

  const ok = await startCamera();
  if (!ok) return;
  resizeOverlay();
  window.addEventListener('resize', resizeOverlay);
  renderModeUI();
  startLoop();
}

function resizeOverlay() {
  if (!state.overlay) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = state.overlay.getBoundingClientRect();
  state.overlay.width = rect.width * dpr;
  state.overlay.height = rect.height * dpr;
  state.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ──────────────────────────────────────────────────────────────
// Render mode UI (HTML overlay on top of canvas)
// ──────────────────────────────────────────────────────────────
function renderModeUI() {
  const ui = $('#ui');
  ui.innerHTML = '';
  const shutterHTML = `<button class="shutter ${state.mode === 'playful' ? 'hunt-shutter' : ''}" id="shutter" aria-label="Capture"></button>`;

  if (state.mode === 'minimal') {
    ui.innerHTML = shutterHTML;
  } else if (state.mode === 'photographer') {
    ui.innerHTML = `
      <div class="hud-readout glass" id="hud">
        <h4>RATIO METER</h4>
        <div><span class="lbl">w/h ····</span> <span class="val" id="hud-ar">—</span></div>
        <div><span class="lbl">Δφ ·····</span> <span class="val" id="hud-dphi">—</span></div>
        <div><span class="lbl">conf ···</span> <span class="val" id="hud-conf">—</span></div>
      </div>
      <div class="hud-tools">
        <button class="hud-tool glass on" data-tool="grid">GRID</button>
        <button class="hud-tool glass" data-tool="lock">LOCK</button>
        <button class="hud-tool glass" data-tool="flip">FLIP</button>
      </div>
      ${shutterHTML}
    `;
    $$('.hud-tool').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.tool === 'flip') flipCamera();
      else b.classList.toggle('on');
    }));
  } else if (state.mode === 'educational') {
    ui.innerHTML = `
      <div class="edu-callout glass hidden" id="edu-callout">
        <div class="ck">GOLDEN RECTANGLE · <span id="edu-conf">—</span>%</div>
        <div class="ct">A rectangle whose long side is <span style="color:var(--accent-2)">1.618×</span> the short. Nature reuses this everywhere.</div>
      </div>
      <div class="edu-sheet glass" id="edu-sheet">
        <div class="edu-grip"></div>
        <div class="edu-title">What is φ?</div>
        <div class="edu-sub">3 ways it shows up around you</div>
        <div class="edu-cards">
          <div class="edu-card"><div class="k">φ-RECT</div><div class="v">Windows, screens, books</div></div>
          <div class="edu-card"><div class="k">SPIRAL</div><div class="v">Shells, ferns, galaxies</div></div>
          <div class="edu-card"><div class="k">FACE</div><div class="v">Eye / nose / mouth bands</div></div>
        </div>
        <div class="edu-body">
          <p>The golden ratio <span class="phi">φ ≈ 1.618</span> is the value where a line, split into two pieces, has the same ratio between the whole and the long piece as between the long and the short.</p>
          <p>Point your camera at a window, doorway, or a leaf. The overlay locks onto rectangles near this ratio and draws the spiral they imply.</p>
        </div>
      </div>
    `;
    const sheet = $('#edu-sheet');
    sheet.addEventListener('click', () => sheet.classList.toggle('expanded'));
  } else if (state.mode === 'playful') {
    const total = 50;
    const slots = Array.from({ length: 6 }).map((_, i) => {
      const item = state.hunt.collection[i];
      return item
        ? `<div class="hunt-slot"><img src="${item.img}" alt=""/></div>`
        : `<div class="hunt-slot empty"></div>`;
    }).join('');
    ui.innerHTML = `
      <div class="hunt-bar">
        <div class="hunt-chip glass">🏆 <span class="num">${state.hunt.collection.length}</span> / ${total}</div>
        <div class="hunt-chip glass">⚡ streak <span class="num">${state.hunt.streak}</span></div>
      </div>
      <div class="hunt-toast" id="toast">SPOTTED!</div>
      <div class="hunt-drawer glass">
        <h4>My collection <span>last ${Math.min(6, state.hunt.collection.length)}</span></h4>
        <div class="hunt-grid">${slots}</div>
      </div>
      ${shutterHTML}
    `;
  }
  const sh = $('#shutter');
  if (sh) sh.addEventListener('click', capture);
}

let usingFront = false;
async function flipCamera() {
  usingFront = !usingFront;
  stopCamera();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: usingFront ? 'user' : { ideal: 'environment' } },
      audio: false,
    });
    state.stream = stream;
    state.video.srcObject = stream;
    await state.video.play();
  } catch (e) { showCameraError(e); }
}

// ──────────────────────────────────────────────────────────────
// Capture (snapshot)
// ──────────────────────────────────────────────────────────────
function capture() {
  const v = state.video;
  if (!v || !v.videoWidth) return;
  // composite frame + overlay into a single image
  const w = v.videoWidth, h = v.videoHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d');
  cx.drawImage(v, 0, 0, w, h);
  // re-draw overlays at this resolution
  drawAll(cx, w, h);

  if (state.mode === 'playful') {
    // add a small thumbnail to collection
    const thumb = document.createElement('canvas');
    thumb.width = 200; thumb.height = 200;
    const tx = thumb.getContext('2d');
    const s = Math.min(w, h);
    tx.drawImage(c, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 200, 200);
    const dataUrl = thumb.toDataURL('image/jpeg', 0.7);
    state.hunt.collection.unshift({ img: dataUrl, t: Date.now() });
    if (state.hunt.collection.length > 30) state.hunt.collection.pop();
    state.hunt.streak += 1;
    localStorage.setItem('golden.collection', JSON.stringify(state.hunt.collection));
    localStorage.setItem('golden.streak', String(state.hunt.streak));
    state.hunt.flashUntil = Date.now() + 400;
    const toast = $('#toast');
    if (toast) {
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 900);
    }
    renderModeUI();
  } else {
    // download / share frame
    c.toBlob((blob) => {
      if (!blob) return;
      if (navigator.share && navigator.canShare?.({ files: [new File([blob], 'golden.jpg')] })) {
        navigator.share({ files: [new File([blob], 'golden.jpg', { type: 'image/jpeg' })],
          title: 'φ in the wild' }).catch(()=>{});
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `golden-${Date.now()}.jpg`;
        a.click();
      }
    }, 'image/jpeg', 0.92);
  }
}

// ──────────────────────────────────────────────────────────────
// Frame loop
// ──────────────────────────────────────────────────────────────
function startLoop() {
  const loop = () => {
    if (!state.video) return;
    const now = performance.now();
    if (now - state.lastDetect > 180) {
      const dets = state.detector.detect(state.video, 3);
      state.tracks = state.tracker.update(dets);
      state.lastDetect = now;
    }
    const rect = state.overlay.getBoundingClientRect();
    state.octx.clearRect(0, 0, rect.width, rect.height);
    drawAll(state.octx, rect.width, rect.height);
    updateHUD();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function drawAll(ctx, W, H) {
  const mode = state.mode;
  const accent = '#d9b04a';
  MODES[mode]?.({
    ctx, W, H,
    tracks: state.tracks.map(t => t),
    accent,
    hud: state.hud,
    hunt: state.hunt,
  });
}

function updateHUD() {
  if (state.mode === 'photographer') {
    const arEl = $('#hud-ar'), dpEl = $('#hud-dphi'), cnEl = $('#hud-conf');
    if (!arEl) return;
    if (state.hud.ar) {
      arEl.textContent = state.hud.ar.toFixed(3);
      dpEl.textContent = state.hud.dphi.toFixed(3);
      cnEl.textContent = Math.round(state.hud.conf * 100) + '%';
    } else {
      arEl.textContent = dpEl.textContent = cnEl.textContent = '—';
    }
  } else if (state.mode === 'educational') {
    const co = $('#edu-callout'), cf = $('#edu-conf');
    const best = state.tracks[0];
    if (co && cf) {
      if (best && best.box.conf > 0.4 && best.age > 3) {
        co.classList.remove('hidden');
        cf.textContent = Math.round(best.box.conf * 100);
      } else {
        co.classList.add('hidden');
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', boot);
