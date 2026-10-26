// Pure helpers of the story page (tested in test.html).
import { STRATEGIES } from "./story_steps.js";

const LAYERS = ["flood", "river", "study", "roads", "closed", "homes", "orders"];

export function frameIndex(frameCdt, t) {
  const i = frameCdt.indexOf(t);
  if (i < 0) throw new Error(`time ${t} is not a frame (5-minute grid, ${frameCdt[0]} to ${frameCdt[frameCdt.length - 1]})`);
  return i;
}
// The full state a step sets: frames, scenario, every layer on or off, camera, chart.
export function resolveStep(step, frameCdt) {
  const play = !step.at;
  const f0 = frameIndex(frameCdt, play ? step.from : step.at), f1 = play ? frameIndex(frameCdt, step.to) : f0;
  const layers = Object.fromEntries(LAYERS.map((k) => [k, !!(step.layers || {})[k]]));
  return { id: step.id, f0, f1, play, scenario: step.scenario, layers, camera: step.camera, chart: step.chart ?? null,
           clock: step.clock !== false };
}
// Fill every [data-num] element from story.json's numbers; returns the keys that were missing (left as "–").
export function fillNumbers(root, numbers) {
  const missing = [];
  for (const e of root.querySelectorAll("[data-num]")) {
    const n = numbers && numbers[e.dataset.num];
    if (n && typeof n.text === "string") e.textContent = n.text;
    else { e.textContent = "–"; missing.push(e.dataset.num); }
  }
  return missing;
}
// The scenarios whose files a step needs.
export function loadPlan(step) {
  return step.chart === "result" ? STRATEGIES.slice() : [step.scenario];
}
export function missingStrategies(available) {
  return STRATEGIES.filter((k) => !available.has(k));
}
// The busy roads of a run (the traffic card's camera): the frame with the most vehicles on the network (sum over cells
// of u8 / 255 x N), and at that frame the bounds of the road groups whose larger-occupancy cell (the first such cell,
// as in map.js groupFrame) holds at least minVeh vehicles. groups: roadGroups(roads.geojson); roadsU8 [frames x cells].
export function busyRoads(groups, roadsU8, shape, minVeh = 1) {
  const [nF, nC] = shape;
  const N = new Float64Array(nC);
  for (const g of groups) g.cells.forEach((c, k) => { N[c] = g.N[k]; });
  let f = 0, vehicles = -1;
  for (let t = 0; t < nF; t++) {
    let s = 0;
    for (let c = 0, o = t * nC; c < nC; c++) if (roadsU8[o + c]) s += roadsU8[o + c] * N[c];
    if (s / 255 > vehicles) { vehicles = s / 255; f = t; }
  }
  let w = Infinity, so = Infinity, e = -Infinity, n = -Infinity, count = 0;
  const mids = [];
  for (const g of groups) {
    let u = 0, j = 0;
    g.cells.forEach((c, k) => { if (roadsU8[f * nC + c] > u) { u = roadsU8[f * nC + c]; j = k; } });
    const veh = u / 255 * g.N[j];
    if (veh < minVeh) continue;
    count++;
    mids.push([g.mid[0], g.mid[1], veh]);
    for (const [x, y] of g.path) { if (x < w) w = x; if (x > e) e = x; if (y < so) so = y; if (y > n) n = y; }
  }
  // core (the camera): the vehicle-weighted 10-90% box of those groups' midpoints, centred on their vehicle-weighted
  // mean. Outlying groups do not stretch it, and the heaviest cluster (here at the end of the corridor) is not left at
  // its edge; a 5-95% box still held a small far cluster and was nearly the full extent.
  return { f, vehicles, count, bounds: count ? [[w, so], [e, n]] : null, core: centredBox(mids, 0.1, 0.9),
           cluster: densestCluster(mids) };
}
// The densest cluster of weighted points [lon, lat, weight] (the traffic card's camera): the point with the most
// weight within r1 km (equirectangular distances at the points' mean latitude), then every point within r2 km of it.
// Returns {box: [[w, s], [e, n]] of those points, share: their share of the total weight}; null if no weight.
export function densestCluster(pts, r1 = 1, r2 = 1.5) {
  const tot = pts.reduce((a, p) => a + p[2], 0);
  if (!(tot > 0)) return null;
  const lat = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const kx = 111.32 * Math.cos(lat * Math.PI / 180), ky = 110.57;
  const dist = (a, b) => Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * ky);
  let best = null, bs = -1;
  for (const p of pts) {
    let s = 0;
    for (const q of pts) if (dist(p, q) <= r1) s += q[2];
    if (s > bs) { bs = s; best = p; }
  }
  const sel = pts.filter((q) => dist(best, q) <= r2);
  const xs = sel.map((q) => q[0]), ys = sel.map((q) => q[1]);
  return { box: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
           share: sel.reduce((a, q) => a + q[2], 0) / tot };
}
// weightedBox(pts, lo, hi) widened to be symmetric about the weighted mean of the points [x, y, weight].
export function centredBox(pts, lo, hi) {
  const b = weightedBox(pts, lo, hi);
  if (!b) return null;
  const tot = pts.reduce((a, p) => a + p[2], 0);
  const c = [0, 1].map((i) => pts.reduce((a, p) => a + p[i] * p[2], 0) / tot);
  const h = [0, 1].map((i) => Math.max(c[i] - b[0][i], b[1][i] - c[i]));
  return [[c[0] - h[0], c[1] - h[1]], [c[0] + h[0], c[1] + h[1]]];
}
// The weighted lo-hi quantile box of points [x, y, weight]: on each axis, the first value (in sorted order) at which
// the cumulative weight reaches lo, and the first at which it reaches hi, of the total. null if no weight.
export function weightedBox(pts, lo = 0.05, hi = 0.95) {
  const tot = pts.reduce((a, p) => a + p[2], 0);
  if (!(tot > 0)) return null;
  const q = (i, p) => {
    const s = pts.filter((x) => x[2] > 0).sort((a, b) => a[i] - b[i]);
    let acc = 0;
    for (const x of s) { acc += x[2]; if (acc >= p * tot - 1e-9 * tot) return x[i]; }
    return s[s.length - 1][i];
  };
  return [[q(0, lo), q(1, lo)], [q(0, hi), q(1, hi)]];
}
