// Data loading and decoding for the dashboard. Pure functions; every encoding is described in data/manifest.json.
export async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}
export async function fetchU8(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
export const loadManifest = (base = "data") => fetchJSON(`${base}/manifest.json`);

export function frameView(u8, shape, f) {
  const row = shape.slice(1).reduce((a, b) => a * b, 1);
  return u8.subarray(f * row, (f + 1) * row);
}
export function bitAt(packed, rowBytes, f, c) {
  return ((packed[f * rowBytes + (c >> 3)] >> (c & 7)) & 1) === 1;
}
export function cdtMs(iso) {
  const [d, t] = iso.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return Date.UTC(y, mo - 1, da, h, mi);          // wall-clock CDT carried as UTC fields; never the browser's zone
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function fmtCdt(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} CDT`;
}
export function waterAt(waterU8, nCells, rowsMs, tMs, c, step = 0.02) {
  const T = rowsMs.length;
  const dt = rowsMs[1] - rowsMs[0];
  const x = Math.min(Math.max((tMs - rowsMs[0]) / dt, 0), T - 1);
  const i = Math.min(Math.floor(x), T - 2);
  const w = x - i;
  return ((1 - w) * waterU8[i * nCells + c] + w * waterU8[(i + 1) * nCells + c]) * step;
}
export function share(homesU8, nStates, nOrigins, f, o, s) {
  return homesU8[(f * nOrigins + o) * nStates + s] / 255;
}
export function majorityState(homesU8, nStates, f, o, nOrigins = null) {
  const base = nOrigins === null ? o * nStates : (f * nOrigins + o) * nStates;   // test passes a 1-frame array
  let best = 0;
  for (let s = 1; s < nStates; s++) if (homesU8[base + s] > homesU8[base + best]) best = s;
  return best;
}
export function tokenKind(t) {
  if (typeof t !== "string" || t.length === 0) return "none";
  if (t.startsWith("pk.")) return "public";
  if (t.startsWith("sk.")) return "secret";
  return "none";
}
// Water speed factor of the simulator (sim.hazard_fns.speed_factor): Pregnolato et al. 2017 speed ratio for depth
// in mm, times a smooth ramp to zero between rampStart and closure (m).
const PREG_A = 0.0009, PREG_B = -0.5529, PREG_C = 86.9448;
export function speedFactor(depth, closure = 0.30, rampStart = 0.25) {
  const wmm = Math.min(Math.max(depth, 0), closure) * 1000;
  const ratio = Math.min(Math.max((PREG_A * wmm * wmm + PREG_B * wmm + PREG_C) / PREG_C, 0), 1);
  const x = Math.min(Math.max((depth - rampStart) / (closure - rampStart), 0), 1);
  return ratio * (1 - x * x * (3 - 2 * x));
}
// Speed relative to free flow from the CTM sending and receiving flows (sim.ctm.step) at occupancy share s = n / N:
// v / vf = min(sf, sf * kc / s, wr * (1 - s) / s); an empty cell (s <= 0) moves at the water-limited free speed sf.
export function speedRatio(s, sf, kc, wr) {
  if (!(s > 0)) return sf;
  return Math.max(Math.min(sf, sf * kc / s, wr * (1 - s) / s), 0);
}
// Google-style classes: 0 >= 0.75, 1 0.50-0.75, 2 0.25-0.50, 3 < 0.25 of free-flow speed, applied to the ratio
// rounded to 2 decimals (the value the inspector shows), so a shown value and its class always agree.
export const SPEED_BREAKS = [0.75, 0.5, 0.25];
export const round2 = (x) => Math.round(x * 100) / 100;
export function speedClass(r) {
  const x = round2(r);
  for (let i = 0; i < SPEED_BREAKS.length; i++) if (x >= SPEED_BREAKS[i]) return i;
  return SPEED_BREAKS.length;
}
// Traffic colours mean traffic: a road is coloured by speed only with at least MIN_VEHICLES expected vehicles on its
// larger-occupancy cell; below that it is drawn as no or negligible traffic (-1).
export const MIN_VEHICLES = 1;
export function trafficClass(vehicles, ratio) {
  return vehicles >= MIN_VEHICLES ? speedClass(ratio) : -1;
}
// Homes drawn per distinct point (homes.pt; rows of one structure share it): [{pt, lon, lat, rows, pop}].
export function pointGroups(homes) {
  const pts = homes.pt || homes.pop.map((_, i) => i);
  const byPt = new Map();
  pts.forEach((p, o) => {
    if (!byPt.has(p)) byPt.set(p, { pt: p, lon: homes.lon[o], lat: homes.lat[o], rows: [], pop: 0 });
    const g = byPt.get(p);
    g.rows.push(o); g.pop += homes.pop[o];
  });
  return Array.from(byPt.values());
}
// Persons per state at one point and frame (share x population summed over its rows).
export function pointPersons(homesU8, nStates, nOrigins, f, rows, pop) {
  const out = new Array(nStates).fill(0);
  for (const o of rows) for (let s = 0; s < nStates; s++) out[s] += homesU8[(f * nOrigins + o) * nStates + s] / 255 * pop[o];
  return out;
}
// Population-weighted majority state (first state wins a tie, as majorityState).
export function argmax(v) {
  let best = 0;
  for (let i = 1; i < v.length; i++) if (v[i] > v[best]) best = i;
  return best;
}
// The point at half the length of a polyline [[lon, lat], ...]. Lengths in a local equirectangular frame (longitude
// scaled by the cosine of the mean latitude), so it is the middle on the ground; a zero-length path gives its first point.
export function pathMidpoint(path) {
  if (path.length < 2) return path[0].slice();
  const kx = Math.cos(path.reduce((a, p) => a + p[1], 0) / path.length * Math.PI / 180);
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot((path[i][0] - path[i - 1][0]) * kx, path[i][1] - path[i - 1][1]);
    seg.push(d); total += d;
  }
  if (!(total > 0)) return path[0].slice();
  let rest = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (rest <= seg[i] || i === seg.length - 1) {
      const t = seg[i] > 0 ? Math.min(rest / seg[i], 1) : 0, a = path[i], b = path[i + 1];
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
    rest -= seg[i];
  }
}
// Road-closure markers: hidden below zoom MARKER_ZOOM, faded in over the next MARKER_FADE zoom levels.
export const MARKER_ZOOM = 13, MARKER_FADE = 0.5;
export function markerAlpha(zoom) {
  return Math.min(Math.max((zoom - MARKER_ZOOM) / MARKER_FADE, 0), 1);
}
// Bounds [[w, s], [e, n]] of any nesting of [x, y] coordinate arrays (LineString to MultiPolygon).
export function coordBounds(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === "number") { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; }
    else for (const x of c) walk(x);
  };
  walk(coords);
  return [[w, s], [e, n]];
}
// Screen-space thinning: indices of the points [x, y] (pixels) kept, in order, each at least r from every point kept
// before it (a grid of r-cells, checked over the 3 x 3 neighbourhood). Depends only on the points' relative positions,
// so panning keeps the same points.
export function thinGrid(xy, r) {
  const grid = new Map(), keep = [];
  xy.forEach((p, i) => {
    const cx = Math.floor(p[0] / r), cy = Math.floor(p[1] / r);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const q of grid.get(`${cx + dx},${cy + dy}`) || []) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r * r) return;
    }
    const key = `${cx},${cy}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(p);
    keep.push(i);
  });
  return keep;
}
