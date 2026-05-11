// Mode-specific overlay drawing on the <canvas> overlay.

const PHI_ = 1.6180339887;

// Build the path for a golden spiral that fits inside w×h with proper orientation
function spiralPath(w, h, orient = 'h') {
  // For h-orientation: spiral inscribed in landscape φ-rectangle.
  // We'll start arc from the longer side's outermost corner.
  if (w / h < 1) [w, h] = [h, w]; // ensure landscape; we'll rotate in render
  let bx = 0, by = 0, bw = w, bh = h, dir = 0;
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

// Draw a golden spiral via Path2D
function drawSpiral(ctx, x, y, w, h, color, lineWidth = 2) {
  const landscape = w >= h;
  ctx.save();
  ctx.translate(x, y);
  if (!landscape) {
    // rotate -90 so spiral fits portrait box
    ctx.translate(w, 0);
    ctx.rotate(Math.PI / 2);
    [w, h] = [h, w];
  }
  const p = new Path2D(spiralPath(w, h));
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.stroke(p);
  ctx.restore();
}

// Subdivisions of a golden rectangle
function drawSubdivs(ctx, x, y, w, h, color, alpha = 0.45) {
  const landscape = w >= h;
  ctx.save();
  ctx.translate(x, y);
  if (!landscape) { ctx.translate(w, 0); ctx.rotate(Math.PI / 2); [w, h] = [h, w]; }
  let bx = 0, by = 0, bw = w, bh = h, dir = 0;
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const sq = Math.min(bw, bh);
    if (dir === 0) { ctx.moveTo(bx + sq, by); ctx.lineTo(bx + sq, by + bh); bx += sq; bw -= sq; }
    else if (dir === 1) { ctx.moveTo(bx, by + sq); ctx.lineTo(bx + bw, by + sq); by += sq; bh -= sq; }
    else if (dir === 2) { ctx.moveTo(bx + bw - sq, by); ctx.lineTo(bx + bw - sq, by + bh); bw -= sq; }
    else { ctx.moveTo(bx, by + bh - sq); ctx.lineTo(bx + bw, by + bh - sq); bh -= sq; }
    dir = (dir + 1) % 4;
    if (sq < 4) break;
  }
  ctx.stroke();
  ctx.restore();
}

function drawRect(ctx, x, y, w, h, color, lineWidth = 2, dash = []) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.setLineDash(dash);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

// Phi-grid lines covering the entire frame
function drawPhiGrid(ctx, W, H, color) {
  const a = 1, b = PHI_;
  const total = 2 * a + b;
  const x1 = (a / total) * W, x2 = ((a + b) / total) * W;
  const y1 = (a / total) * H, y2 = ((a + b) / total) * H;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.65;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x1, 0); ctx.lineTo(x1, H);
  ctx.moveTo(x2, 0); ctx.lineTo(x2, H);
  ctx.moveTo(0, y1); ctx.lineTo(W, y1);
  ctx.moveTo(0, y2); ctx.lineTo(W, y2);
  ctx.stroke();
  // power points
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].forEach(([px, py]) => {
    ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

// Label chip near a rect
function drawChip(ctx, text, x, y, color, bg) {
  ctx.save();
  ctx.font = '600 11px ui-monospace, "JetBrains Mono", monospace';
  const pad = 6;
  const w = ctx.measureText(text).width + pad * 2;
  const h = 18;
  ctx.fillStyle = bg;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y - h, w, h, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + pad, y - h / 2 + 1);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─────────────────────────────────────────────────────────────
// Per-mode draw fns. ctx is the overlay canvas; W/H is the canvas size.
// tracks: [{id, box:{x,y,w,h,conf,orient}, age, ...}] in normalized coords.
// state: shared mutable state (manual anchors, hunt collection, etc.)
// ─────────────────────────────────────────────────────────────

const MODES = {
  minimal({ ctx, W, H, tracks, accent }) {
    const best = tracks[0];
    if (!best || best.box.conf < 0.35) return;
    const b = best.box;
    const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
    drawRect(ctx, x, y, w, h, accent, 2);
    drawSubdivs(ctx, x, y, w, h, accent, 0.35);
    drawSpiral(ctx, x, y, w, h, accent, 2.5);
    drawChip(ctx, `φ · ${best.box.ar.toFixed(2)}`, x, y - 4, accent, 'rgba(0,0,0,0.55)');
  },

  photographer({ ctx, W, H, tracks, accent, hud }) {
    drawPhiGrid(ctx, W, H, accent);
    const best = tracks[0];
    if (best && best.box.conf > 0.3) {
      const b = best.box;
      const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
      drawRect(ctx, x, y, w, h, accent, 2);
      // corner ticks
      const t = 10;
      ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, y + t); ctx.lineTo(x, y); ctx.lineTo(x + t, y);
      ctx.moveTo(x + w - t, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + t);
      ctx.moveTo(x, y + h - t); ctx.lineTo(x, y + h); ctx.lineTo(x + t, y + h);
      ctx.moveTo(x + w - t, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - t);
      ctx.stroke();
      hud.ar = best.box.ar;
      hud.conf = best.box.conf;
      hud.dphi = Math.abs(best.box.ar - PHI_);
    } else {
      hud.ar = null;
    }
  },

  educational({ ctx, W, H, tracks, accent }) {
    tracks.slice(0, 3).forEach((tr, i) => {
      if (tr.box.conf < 0.3 || tr.age < 2) return;
      const b = tr.box;
      const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
      const isPrimary = i === 0;
      drawRect(ctx, x, y, w, h, accent, isPrimary ? 2.5 : 1.5,
        isPrimary ? [] : [4, 4]);
      if (isPrimary) drawSpiral(ctx, x, y, w, h, accent, 2.5);
      const label = isPrimary ? `φ-rectangle · ${Math.round(b.conf * 100)}%`
        : `φ candidate · ${b.ar.toFixed(2)}`;
      drawChip(ctx, label, x, y - 4, accent, 'rgba(0,0,0,0.65)');
    });
  },

  playful({ ctx, W, H, tracks, accent, hunt }) {
    tracks.forEach((tr) => {
      if (tr.box.conf < 0.4 || tr.age < 3) return;
      const b = tr.box;
      const x = b.x * W, y = b.y * H, w = b.w * W, h = b.h * H;
      drawRect(ctx, x, y, w, h, accent, 2);
      drawSpiral(ctx, x, y, w, h, accent, 2);
      // pulse anim
      const t = (Date.now() % 1200) / 1200;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 4 * t * 6, y - 4 * t * 6, w + 8 * t * 6, h + 8 * t * 6);
      ctx.restore();
    });
    // recent capture flash
    if (hunt.flashUntil && Date.now() < hunt.flashUntil) {
      const a = (hunt.flashUntil - Date.now()) / 400;
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.6, a)})`;
      ctx.fillRect(0, 0, W, H);
    }
  },
};

window.MODES = MODES;
window.drawSpiral = drawSpiral;
window.drawRect = drawRect;
window.drawSubdivs = drawSubdivs;
