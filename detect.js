// Lightweight φ-rectangle detection.
// Strategy: downscale → grayscale → Sobel edge magnitudes →
// project onto X and Y axes → find peak lines → pair into rectangles →
// score by closeness to φ aspect ratio.

const PHI = 1.6180339887;

class GoldenDetector {
  constructor(w = 120, h = 80) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.gray = new Float32Array(w * h);
    this.edge = new Float32Array(w * h);
    this.colSum = new Float32Array(w);
    this.rowSum = new Float32Array(h);
  }

  // returns up to N rectangles in NORMALIZED coords (0..1) with confidence
  detect(video, topN = 3) {
    const { w, h, ctx, gray, edge, colSum, rowSum } = this;
    if (!video.videoWidth) return [];

    // draw centered, cover-fit (matches the CSS object-fit:cover on the <video>)
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(w / vw, h / vh);
    const dw = vw * scale, dh = vh * scale;
    ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);

    const img = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < w * h; i++) {
      gray[i] = 0.299 * img[i * 4] + 0.587 * img[i * 4 + 1] + 0.114 * img[i * 4 + 2];
    }
    colSum.fill(0); rowSum.fill(0);
    let maxE = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
          + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
          + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        const m = Math.hypot(gx, gy);
        edge[i] = m;
        if (m > maxE) maxE = m;
      }
    }
    if (maxE < 1) return [];

    // accumulate strong gradients along orthogonal direction
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const e = edge[i];
        if (e < maxE * 0.35) continue;
        // Sobel direction: gx vs gy magnitude tells us which axis the edge crosses
        // (re-compute the components; cheap, single multiplication)
        const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1]
          + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
        const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1]
          + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
        if (Math.abs(gx) > Math.abs(gy)) colSum[x] += e;
        else rowSum[y] += e;
      }
    }

    const xPeaks = findPeaks(colSum, 5, Math.max(3, Math.round(w * 0.04)));
    const yPeaks = findPeaks(rowSum, 5, Math.max(3, Math.round(h * 0.04)));

    const cands = [];
    for (let xi = 0; xi < xPeaks.length; xi++) {
      for (let xj = xi + 1; xj < xPeaks.length; xj++) {
        for (let yi = 0; yi < yPeaks.length; yi++) {
          for (let yj = yi + 1; yj < yPeaks.length; yj++) {
            const rw = xPeaks[xj] - xPeaks[xi];
            const rh = yPeaks[yj] - yPeaks[yi];
            if (rw < w * 0.18 || rh < h * 0.18) continue;
            const ar = Math.max(rw / rh, rh / rw);
            const dPhi = Math.abs(ar - PHI);
            if (dPhi > 0.35) continue;
            const conf = Math.max(0, 1 - dPhi / 0.35);
            const area = (rw * rh) / (w * h);
            const score = conf * (0.4 + area);
            cands.push({
              x: xPeaks[xi] / w, y: yPeaks[yi] / h,
              w: rw / w, h: rh / h,
              ar, conf, score,
              orient: (rw > rh) ? 'h' : 'v',
            });
          }
        }
      }
    }
    cands.sort((a, b) => b.score - a.score);
    // suppress overlapping with the better one
    const out = [];
    for (const c of cands) {
      if (out.every(o => iou(c, o) < 0.35)) out.push(c);
      if (out.length >= topN) break;
    }
    return out;
  }
}

function findPeaks(arr, n, minSep) {
  const N = arr.length;
  let max = 0;
  for (let i = 0; i < N; i++) if (arr[i] > max) max = arr[i];
  if (max <= 0) return [];
  const thresh = max * 0.25;
  const peaks = [];
  for (let i = 1; i < N - 1; i++) {
    if (arr[i] >= thresh && arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1]) {
      peaks.push({ i, v: arr[i] });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const out = [];
  for (const p of peaks) {
    if (out.every(o => Math.abs(o - p.i) >= minSep)) {
      out.push(p.i);
      if (out.length >= n) break;
    }
  }
  return out.sort((a, b) => a - b);
}

function iou(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

// Temporal smoothing — fit detections frame-to-frame so labels don't jitter
class Tracker {
  constructor() { this.tracks = []; this.nextId = 1; this.t = 0; }
  update(dets) {
    this.t++;
    const used = new Set();
    for (const tr of this.tracks) {
      let best = -1, bestIoU = 0.2;
      for (let i = 0; i < dets.length; i++) {
        if (used.has(i)) continue;
        const io = iou(tr.box, dets[i]);
        if (io > bestIoU) { bestIoU = io; best = i; }
      }
      if (best >= 0) {
        const d = dets[best];
        // exponential smoothing
        const a = 0.35;
        tr.box.x = tr.box.x + a * (d.x - tr.box.x);
        tr.box.y = tr.box.y + a * (d.y - tr.box.y);
        tr.box.w = tr.box.w + a * (d.w - tr.box.w);
        tr.box.h = tr.box.h + a * (d.h - tr.box.h);
        tr.box.conf = d.conf;
        tr.box.ar = d.ar;
        tr.box.orient = d.orient;
        tr.lastSeen = this.t;
        tr.age++;
        used.add(best);
      }
    }
    for (let i = 0; i < dets.length; i++) {
      if (!used.has(i)) {
        this.tracks.push({ id: this.nextId++, box: { ...dets[i] }, lastSeen: this.t, age: 1 });
      }
    }
    this.tracks = this.tracks.filter(tr => this.t - tr.lastSeen < 6 && tr.age > 0);
    return this.tracks;
  }
}

window.GoldenDetector = GoldenDetector;
window.Tracker = Tracker;
window.PHI = PHI;
