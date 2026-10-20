// Pure helpers of the traffic page (traffic.html): frame decoding, positions along a cell's line, the sample dots'
// positions, the scenario lookup and the clock text. Every encoding is described in data/traffic/manifest.json.

// uint16-le frames [F, T] (<key>_n.bin). Accepts an ArrayBuffer or a Uint8Array view (fetchU8).
export function decodeU16(buf) {
  if (buf instanceof ArrayBuffer) return new Uint16Array(buf);
  return new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength >> 1);
}
// Vehicles on each of the T cells at frame f (value x scale).
export function frameValues(u16, T, f, scale) {
  const out = new Float64Array(T);
  for (let i = 0; i < T; i++) out[i] = u16[f * T + i] * scale;
  return out;
}
// Cumulative lengths along a polyline [[lon, lat], ...] in a local equirectangular frame (longitude x cos(latitude)).
export function cumLengths(path) {
  const out = [0];
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1], [x1, y1] = path[i];
    const k = Math.cos((y0 + y1) / 2 * Math.PI / 180);
    out.push(out[i - 1] + Math.hypot((x1 - x0) * k, y1 - y0));
  }
  return out;
}
// The point at a fraction (0..1, clamped) of a polyline's length; a zero-length line gives its first point.
export function pathPoint(path, frac) {
  const c = cumLengths(path), L = c[c.length - 1];
  if (L === 0) return path[0];
  const s = Math.min(Math.max(frac, 0), 1) * L;
  let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const f = (s - c[i - 1]) / ((c[i] - c[i - 1]) || 1);
  return [path[i - 1][0] + f * (path[i][0] - path[i - 1][0]), path[i - 1][1] + f * (path[i][1] - path[i - 1][1])];
}
// Position of a sample vehicle at t seconds after departure; null before release (at the origin) or after arrival.
// dot.t holds the entry time of each cell of dot.path and then, for an arrived dot, its arrival; within a cell the dot
// moves linearly in time along the cell's line (oriented in the direction of travel). A dot still in its last cell at
// the end of the run (no exit time) is drawn at the cell's middle.
export function dotPosition(dot, t, cellPath) {
  const ts = dot.t;
  if (!ts.length || t < ts[0]) return null;
  for (let i = 0; i < dot.path.length; i++) {
    const t0 = ts[i], t1 = i + 1 < ts.length ? ts[i + 1] : Infinity;
    if (t >= t0 && t < t1) {
      const frac = Number.isFinite(t1) ? (t - t0) / ((t1 - t0) || 1) : 0.5;
      return pathPoint(cellPath(dot.path[i]), frac);
    }
  }
  return null;
}
// Where a dot is at t: "waiting" (not yet released: in the origin queue), "road" (index of its current cell in
// dot.path), or "arrived". A dot that never left the queue (status queued, no times) is waiting throughout.
export function dotState(dot, t) {
  const ts = dot.t;
  if (!ts.length || t < ts[0]) return { kind: "waiting" };
  for (let i = 0; i < dot.path.length; i++) {
    const t1 = i + 1 < ts.length ? ts[i + 1] : Infinity;
    if (t < t1) return { kind: "road", i };
  }
  return { kind: "arrived" };
}
// Line width (px) for a share of the origin's traffic: area-like (square root), none below minShare.
export function shareWidth(share, maxPx = 14, minShare = 1e-3) {
  return share < minShare ? 0 : Math.max(1, maxPx * Math.sqrt(share));
}
// Index of the last frame at or before t (frame_t ascending, frame_t[0] = 0).
export function frameAt(frameT, t) {
  let lo = 0, hi = frameT.length - 1;
  if (t >= frameT[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frameT[mid] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
// Linear interpolation of a series ys at times xs (ascending), held constant outside.
export function interp(xs, ys, x) {
  if (!xs.length) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const i = frameAt(xs, x);
  const w = (x - xs[i]) / ((xs[i + 1] - xs[i]) || 1);
  return ys[i] + w * (ys[i + 1] - ys[i]);
}
// The scenario of a selection: to safety by menu id, load and water; single destination by OD id (an OD run may carry
// several labels, e.g. the identical bridge and crossing pairs).
export function scenarioKey(scenarios, { mode, id, load, water }) {
  const s = mode === "od"
    ? scenarios.find((x) => x.mode === "od" && x.labels.includes(id))
    : scenarios.find((x) => x.mode === "safety" && x.menu_id === id && x.load === load && x.water === water);
  return s ? s.key : null;
}
// Clock: wet runs on the CDT clock (wall-clock CDT carried as UTC fields, as data.js) plus minutes after departure;
// dry runs only the minutes after departure (their clock is irrelevant).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function clockText(t0Ms, t, wet) {
  const min = Math.floor(t / 60 + 1e-9);
  if (!wet) return `+${min} min after departure`;
  const d = new Date(t0Ms + Math.floor(t / 60 + 1e-9) * 60000);
  const p = (x) => String(x).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} CDT (+${min} min)`;
}
// The dots label with the scenario's vehicles per dot already filled in by the export (dots.label / dots_label).
export function dotsLabel(sc) {
  return sc.dots_label || (sc.dots && sc.dots.label) || "";
}
