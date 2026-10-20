// Traffic page entry (traffic.html): one origin's vehicles moving through the cell transmission model (CTM), with the
// roads coloured by the vehicles on them, the closures of wet runs, the expected route (B1's calculated shares) beside
// the CTM's cumulative flow, and 200 sample dots traced from the flows. Verification, not a policy result.
import { fetchJSON, fetchU8, cdtMs, fmtCdt, waterAt, bitAt, speedFactor, speedRatio, speedClass, round2, markerAlpha,
  coordBounds, thinGrid, tokenKind, MARKER_ZOOM } from "./data.js";
import { createMap, roadGroups, hex2rgb, ramp, TRAFFIC, SPEED, SPEED_LABELS, CLOSED, CLOSED_W, CLOSED_MARK, MARK_PX,
  closureIcon, INK, STUDY_LINE } from "./map.js";
import { esc, showInspector } from "./ui.js";
import * as TD from "./traffic_data.js";

const EXPECTED_VERSION = 1;
const BASE = "data/traffic";
const ORANGE = "#eb6834", GREEN = "#1baf7a", INK2 = "var(--ink2)", GRAY = "#898781";
const QUEUED = "#8fa3b8";
// Road water (optional layer): steps of the main page's blue flood-depth ramp (from its third step, so shallow water
// shows on the light background), one colour per 0.25 m.
const WATER = ["#9ec5f4", "#5598e7", "#2a78d6", "#184f95", "#0d366b"], WATER_STEP = 0.25;
// Vehicles on a cell relative to the run's largest value: the main page's sequential purple ramp from its second step,
// so even small amounts read against the light background (blue is kept for water).
const vehColor = (x) => ramp(TRAFFIC, 0.25 + 0.75 * Math.min(Math.max(x, 0), 1));
const TRAFFIC_W = 3.5;
const BASE_ROAD = [154, 152, 144, 110];
// Speeds of the timeline: model seconds per second of viewing.
const SPEEDS = [["15", "1×"], ["60", "4×"], ["240", "16×"]];
const NO_POSITION_NOTE = "no road cell at its node; its node is a safe place, so its vehicles arrive at once";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const phone = window.matchMedia("(max-width: 760px)");
const notices = new Map();
function notice(key, text) {
  if (text) notices.set(key, text); else notices.delete(key);
  const n = $("notice");
  n.textContent = Array.from(notices.values()).join(" · ");
  n.hidden = notices.size === 0;
}

// window.trafficPage: read-only handle on the page state, for checks in the browser console.
const S = window.trafficPage = { sel: { mode: "safety", id: "p50", load: "heavy", water: "dry" }, key: null, t: 0, f: 0,
  data: {}, selection: null, playing: false,
  show: { traffic: true, bySpeed: false, expected: true, cum: true, shortest: true, closed: true, water: false, dots: true,
    safe: true, study: true } };

async function main() {
  const m = await fetchJSON(`${BASE}/manifest.json`);
  S.manifest = m;
  $("caption").textContent = m.caption;
  if (m.version !== EXPECTED_VERSION) notice("version", `Data version ${m.version} differs from the page's ${EXPECTED_VERSION}: values may be misread`);
  notice("load", "Loading roads…");
  const [roads, nodes, studyArea] = await Promise.all([fetchJSON(`${BASE}/${m.roads.file}`), fetchJSON(`${BASE}/${m.nodes.file}`),
    fetchJSON(`${BASE}/${m.study_area.file}`).catch((e) => { notice("study", `Study area: ${e.message}`); return null; })]);
  Object.assign(S, { nodes, studyArea });
  // per cell: its line (oriented in the direction of travel), jam storage N, kc, wr and road group
  const nC = roads.features.length;
  S.nCells = nC;
  S.cellLine = new Array(nC); S.cellN = new Float64Array(nC); S.cellKc = new Float64Array(nC); S.cellWr = new Float64Array(nC);
  for (const f of roads.features) {
    const c = f.properties.c;
    S.cellLine[c] = f.geometry.coordinates; S.cellN[c] = f.properties.N; S.cellKc[c] = f.properties.kc; S.cellWr[c] = f.properties.wr;
  }
  S.groups = roadGroups(roads);
  S.cellGroup = new Int32Array(nC);
  S.groups.forEach((g, i) => g.cells.forEach((c) => (S.cellGroup[c] = i)));
  S.safePts = nodes.safe.filter((n) => nodes.points[n]).map((n) => ({ node: n, p: nodes.points[n] }));
  S.bounds = studyArea ? coordBounds(studyArea.features.map((f) => f.geometry.coordinates)) : null;
  S.t0 = { dry: cdtMs(m.t0_cdt.dry), wet: cdtMs(m.t0_cdt.wet) };

  const want = params.get("s") && m.scenarios.find((s) => s.key === params.get("s"));
  if (want) S.sel = want.mode === "od" ? { mode: "od", id: want.labels[0], load: "heavy", water: "dry" }
    : { mode: "safety", id: want.menu_id, load: want.load, water: want.water };
  buildControls();
  await buildMap();
  await pick(true);
  const t0 = Number(params.get("t"));
  if (Number.isFinite(t0) && t0 > 0) setTime(t0 * 60);
  window.addEventListener("resize", () => schedule(true));
}

// ---- controls ----
function segmented(box, items, get, set) {
  box.textContent = "";
  for (const [v, label] of items) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.v = v; b.textContent = label;
    b.addEventListener("click", () => { if (!b.disabled) set(v); });
    box.appendChild(b);
  }
  const sync = () => box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === get())));
  sync();
  return sync;
}
function noPosition(node) { return S.manifest.nodes.no_position.includes(node); }
// The origin list: to safety, the 10 menu origins with their rule; single destination, one entry per OD run (the
// identical bridge and crossing pairs are one run with both labels).
function originItems(mode) {
  const m = S.manifest;
  if (mode === "od") {
    return m.scenarios.filter((s) => s.mode === "od").map((s) => {
      const rules = s.labels.map((l) => (m.menu.od.find((o) => o.id === l) || {}).rule).filter(Boolean);
      return { id: s.labels[0], node: s.origin, dest: s.dest, text: `${s.labels.join(" / ")}: node ${s.origin} → ${s.dest}`,
        title: rules.join("; ") };
    });
  }
  return m.menu.origins.map((o) => ({ id: o.id, node: o.node, text: `${o.id}: ${o.rule}${noPosition(o.node) ? " (no map position)" : ""}`,
    title: `node ${o.node}` }));
}
// Origin rings: one per node with a map position, with the ids of the entries at that node (in list order).
function originNodes(mode) {
  const byNode = new Map();
  for (const it of originItems(mode)) {
    if (!S.nodes.points[it.node]) continue;
    if (!byNode.has(it.node)) byNode.set(it.node, { node: it.node, ids: [] });
    byNode.get(it.node).ids.push(it.id);
  }
  return Array.from(byNode.values());
}
function fillOrigins() {
  const sel = $("trOrigin");
  sel.textContent = "";
  for (const it of originItems(S.sel.mode)) {
    const o = document.createElement("option");
    o.value = it.id; o.textContent = it.text; o.title = it.title;
    sel.appendChild(o);
  }
  if (!originItems(S.sel.mode).some((it) => it.id === S.sel.id)) S.sel.id = sel.options[0].value;
  sel.value = S.sel.id;
}
function buildControls() {
  S.sync = {};
  S.sync.mode = segmented($("trMode"), [["safety", "To safety"], ["od", "Single destination"]], () => S.sel.mode, (v) => {
    if (v === S.sel.mode) return;
    S.sel.mode = v; fillOrigins(); syncControls(); pick(true);
  });
  S.sync.load = segmented($("trLoad"), [["light", "Light"], ["heavy", "Heavy"]], () => S.sel.load, (v) => { S.sel.load = v; syncControls(); pick(); });
  S.sync.water = segmented($("trWater"), [["dry", "Dry"], ["wet", "July 2025 water"]], () => S.sel.water, (v) => { S.sel.water = v; syncControls(); pick(); });
  fillOrigins();
  $("trOrigin").addEventListener("change", (e) => { S.sel.id = e.target.value; pick(true); });
  syncControls();

  const token = (window.DASHBOARD_CONFIG || {}).mapboxToken;
  const kind = tokenKind(token);
  S.token = kind === "public" ? token : null;           // a secret token never goes further than this line
  if (kind === "secret") notice("token", "Secret tokens are refused: plain background");
  else if (kind === "none") notice("token", "No Mapbox token: plain background");
  const bm = $("basemap");
  const opts = S.token ? [["outdoors", "Mapbox outdoors"], ["satellite", "Mapbox satellite"], ["plain", "Plain"]] : [["plain", "Plain"]];
  for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; bm.appendChild(o); }
  bm.disabled = opts.length === 1;
  bm.addEventListener("change", () => rebuildMap());

  const sp = $("speed");
  for (const [v, t] of SPEEDS) { const o = document.createElement("option"); o.value = v; o.textContent = t; sp.appendChild(o); }
  sp.value = "60";
  sp.title = "1× = 15 s of model time per second";
  $("play").addEventListener("click", () => (S.playing ? pause() : play()));
  $("slider").addEventListener("input", (e) => { pause(); setTime(S.sc.frame_t[Number(e.target.value)]); });

  const panel = document.createElement("div");
  panel.className = "panel";
  $("layers").appendChild(panel);
  const items = [["traffic", "Vehicles on the roads now"], ["bySpeed", "Colour by speed (instead of vehicles)"],
    ["expected", "Expected route (calculated shares)"], ["cum", "CTM cumulative flow"], ["shortest", "Shortest path (single destination)"],
    ["dots", "Sample dots"], ["closed", "Closed roads (wet)"], ["water", "Water on roads (wet, hourly)"], ["safe", "Safe nodes"],
    ...(S.studyArea ? [["study", "Study area"]] : [])];
  for (const [k, t] of items) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" ${S.show[k] ? "checked" : ""}> ${esc(t)}`;
    l.querySelector("input").addEventListener("change", (e) => {
      S.show[k] = e.target.checked;
      if (k === "study") applyStudy();
      buildLegend(); schedule(true);
    });
    panel.appendChild(l);
  }
}
// "02:00 CDT on 4 July" from a CDT wall-clock time of the export ("2025-07-04T02:00").
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
function dayTime(iso) {
  const d = new Date(cdtMs(iso));
  const p = (x) => String(x).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} CDT on ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}
// The single-destination runs' load and roads, from their scenario entries ("50 vehicles on dry roads").
function odLoad() {
  const od = S.manifest.scenarios.filter((s) => s.mode === "od");
  const veh = Array.from(new Set(od.map((s) => fmtVeh(s.vehicles)))).join(" or ");
  const water = Array.from(new Set(od.map((s) => s.water))).join(" or ");
  return `${veh} vehicles on ${water} roads`;
}
function syncControls() {
  const od = S.sel.mode === "od";
  for (const id of ["trLoad", "trWater"]) $(id).querySelectorAll("button").forEach((b) => (b.disabled = od));
  $("trLoad").title = $("trWater").title = od ? `Single-destination runs: ${odLoad()}` : "";
  for (const f of Object.values(S.sync)) f();
}

// ---- map ----
async function makeMap() {
  const style = $("basemap").value || "plain";
  let mm;
  try {
    mm = await createMap($("mapA"), { token: style === "plain" ? null : S.token, style, bounds: S.bounds });
  } catch (e) {
    notice("mapbox", `Mapbox failed (${e.message}): plain background`);
    $("basemap").value = "plain";
    mm = await createMap($("mapA"), { token: null, style: "plain", bounds: S.bounds });
  }
  if (S.studyArea) {
    mm.map.addSource("study-area", { type: "geojson", data: S.studyArea });
    mm.map.addLayer({ id: "study-area", type: "line", source: "study-area", layout: { "line-join": "round" },
      paint: { "line-color": STUDY_LINE, "line-width": 2, "line-opacity": 0.45 } });
  }
  mm.map.on("click", (e) => onClick(e));
  mm.map.on("mousemove", (e) => {
    const hit = mm.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4, layerIds: PICK_LAYERS });
    mm.map.getCanvas().style.cursor = hit ? "pointer" : "";
  });
  mm.map.on("zoom", () => { const a = markerAlpha(mm.map.getZoom()); if (a > 0 || a !== mm.alpha) schedule(true); });
  return mm;
}
function applyStudy() {
  const map = S.mm && S.mm.map;
  if (map && map.getLayer("study-area")) map.setLayoutProperty("study-area", "visibility", S.show.study ? "visible" : "none");
}
async function buildMap() { S.mm = await makeMap(); applyStudy(); }
async function rebuildMap() {
  const cam = S.mm ? { center: S.mm.map.getCenter(), zoom: S.mm.map.getZoom() } : null;
  if (S.mm) S.mm.map.remove();
  notice("mapbox", null);
  S.mm = await makeMap();
  if (cam) S.mm.map.jumpTo(cam);
  applyStudy(); schedule(true);
}

// ---- scenario data ----
const pending = {};
function ensureWet() {
  if (!S.wet) {
    const w = S.manifest.water;
    S.wet = Promise.all([fetchU8(`${BASE}/${w.closed_wet.file}`), fetchU8(`${BASE}/${w.water_roads.file}`)]).then(([closed, water]) => ({
      closed, rowBytes: w.closed_wet.shape[1], frames: w.closed_wet.shape[0], closedCache: new Map(),
      water: { u8: water, nCells: w.water_roads.shape[1], rowsMs: w.water_roads.cdt.map(cdtMs), step: w.water_roads.step_m } }))
      .catch((e) => { S.wet = null; throw e; });
  }
  return S.wet;
}
function ensureScenario(key) {
  if (S.data[key]) return Promise.resolve(S.data[key]);
  if (!pending[key]) {
    const entry = S.manifest.scenarios.find((s) => s.key === key);
    pending[key] = Promise.all([fetchJSON(`${BASE}/${entry.files.json.file}`), fetchU8(`${BASE}/${entry.files.frames.file}`),
      entry.water === "wet" ? ensureWet() : null])
      .then(([sc, u8]) => {
        const T = sc.cells.length, F = sc.frames;
        const u16 = TD.decodeU16(u8);
        if (u16.length !== F * T) throw new Error(`${entry.files.frames.file}: ${u16.length} values, expected ${F} x ${T}`);
        let mx = 0;
        for (let i = 0; i < u16.length; i++) if (u16[i] > mx) mx = u16[i];
        const share = (o) => Object.entries(o || {}).map(([c, s]) => ({ c: Number(c), s })).filter((d) => S.cellLine[d.c]);
        const d = { entry, sc, u16, T, maxN: mx * sc.scale, col: new Map(sc.cells.map((c, i) => [c, i])),
          expected: share(sc.expected_share), cum: share(sc.cum_share), frameCache: new Map(),
          minT: [0, ...sc.minute_t], minute: Object.fromEntries(Object.entries(sc.minute).map(([k, v]) => [k, [0, ...v]])) };
        S.data[key] = d;
        return d;
      })
      .catch((e) => { delete pending[key]; notice(`fail-${key}`, `${key}: ${e.message}`); return null; });
  }
  return pending[key];
}
async function pick(refit = false) {
  const key = TD.scenarioKey(S.manifest.scenarios, S.sel);
  if (!key) { notice("pick", "No run for this choice"); return; }
  notice("pick", null);
  notice("load", "Loading run…");
  const d = await ensureScenario(key);
  notice("load", null);
  if (!d || TD.scenarioKey(S.manifest.scenarios, S.sel) !== key) return;      // a later choice won
  const keepT = S.key && !refit ? S.t : 0;
  S.key = key; S.d = d; S.sc = d.sc; S.entry = d.entry; S.wetRun = d.sc.water === "wet";
  S.wetData = S.wetRun ? await S.wet : null;
  S.selection = S.selection && S.selection.kind === "road" ? S.selection : null;
  const sl = $("slider");
  sl.max = String(S.sc.frames - 1);
  buildSide();
  buildLegend();
  if (refit) fitRun();
  setTime(Math.min(keepT, S.sc.frame_t[S.sc.frames - 1]));
  writeUrl();                                   // a run change is written even during playback
}
// Room for the clock (top left) and, on a wide screen, the open legend (bottom left).
function fitPadding() {
  if (phone.matches) return { top: 80, bottom: 50, left: 30, right: 50 };
  const lg = $("legend"), open = lg.querySelector("details[open]");
  const w = open ? lg.offsetWidth + 24 : 40;
  const mapW = $("mapA").clientWidth;
  return { top: 80, bottom: 40, right: 60, left: Math.min(w, Math.max(40, mapW / 2)) };
}
// The view: the cells the run touches, its origin, destination and the safe nodes it reached; a run without road
// cells centres on its origin (or the study area when the origin has no position).
function fitRun() {
  const pts = [];
  for (const c of S.sc.cells) if (S.cellLine[c]) pts.push(...S.cellLine[c]);
  for (const n of [S.sc.origin, S.sc.dest, ...Object.keys(S.sc.arrived_node).map(Number)]) {
    const p = n !== null && S.nodes.points[n];
    if (p) pts.push(p);
  }
  const map = S.mm.map;
  if (pts.length >= 2) {
    const [[w, s], [e, n]] = coordBounds(pts);
    const pad = Math.max(e - w, n - s) < 0.004 ? 0.004 : 0;
    map.fitBounds([[w - pad, s - pad], [e + pad, n + pad]], { padding: fitPadding(), duration: 0, maxZoom: 16 });
  } else if (pts.length === 1) map.jumpTo({ center: pts[0], zoom: 14 });
  else if (S.bounds) map.fitBounds(S.bounds, { padding: 24, duration: 0 });
}

// ---- time ----
function setTime(t) {
  const sc = S.sc, tEnd = sc.frame_t[sc.frames - 1];
  S.t = Math.min(Math.max(t, 0), tEnd);
  const f = TD.frameAt(sc.frame_t, S.t);
  const changed = f !== S.f || S.fKey !== S.key;
  S.f = f; S.fKey = S.key;
  $("slider").value = String(f);
  if (!S.playing) writeUrl();
  schedule(changed);
}
// the address keeps the run and the time (rounded to the minute), so a view can be reopened or shared; it is
// written on a seek, a run change and a pause, not every model minute of playback (Safari throws after about 100
// replaceState calls in 30 s, reached at 16x)
function writeUrl() {
  if (!S.sc) return;
  const url = `?s=${encodeURIComponent(S.key)}&t=${Math.round(S.t / 60)}`;
  if (url === S.url) return;
  try { history.replaceState(null, "", url); S.url = url; } catch (e) { /* throttled: the next pause or seek retries */ }
}
let timer = null, last = 0;
function play() {
  if (S.playing || !S.sc) return;
  const tEnd = S.sc.frame_t[S.sc.frames - 1];
  if (S.t >= tEnd) setTime(0);
  S.playing = true;
  $("play").textContent = "❚❚"; $("play").setAttribute("aria-label", "Pause");
  last = performance.now();
  timer = setInterval(() => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.5);
    last = now;
    const t = S.t + dt * Number($("speed").value || 60);
    setTime(t);
    if (t >= S.sc.frame_t[S.sc.frames - 1]) pause();
  }, 40);
}
function pause() {
  if (timer) clearInterval(timer);
  timer = null; S.playing = false;
  $("play").textContent = "▶"; $("play").setAttribute("aria-label", "Play");
  writeUrl();
}

// ---- rendering ----
let queued = false, full = false;
function schedule(frameChanged = false) {
  full = full || frameChanged;
  if (queued) return;
  queued = true;
  const run = () => { if (!queued) return; queued = false; const fc = full; full = false; render(fc); };
  requestAnimationFrame(run);
  setTimeout(run, 100);                     // rAF does not fire in a hidden tab; the page still updates
}
// Per frame: the vehicles on each touched cell and the closed road groups (wet).
function frameState(f) {
  const d = S.d;
  if (d.frameCache.has(f)) return d.frameCache.get(f);
  if (d.frameCache.size > 16) d.frameCache.delete(d.frameCache.keys().next().value);
  const n = TD.frameValues(d.u16, d.T, f, d.sc.scale);
  const ms = msAt(d.sc.frame_t[f]);
  const cells = [];
  for (let i = 0; i < d.T; i++) {
    if (!(n[i] > 0)) continue;
    const c = d.sc.cells[i];
    if (!S.cellLine[c]) continue;
    cells.push({ c, n: n[i], cls: speedClass(cellRatio(c, n[i], ms)) });
  }
  cells.sort((a, b) => a.n - b.n);          // larger amounts drawn on top
  const st = { n, cells, closed: S.wetRun ? closedGroups(closedFrame(d.sc.frame_t[f])) : [] };
  d.frameCache.set(f, st);
  return st;
}
const msAt = (t) => (S.wetRun ? S.t0.wet : S.t0.dry) + t * 1000;
const closedFrame = (t) => Math.min(Math.floor(t / 60 + 1e-9), S.wetData.frames - 1);
function closedGroups(cf) {
  const w = S.wetData;
  if (w.closedCache.has(cf)) return w.closedCache.get(cf);
  if (w.closedCache.size > 32) w.closedCache.delete(w.closedCache.keys().next().value);
  const out = [];
  S.groups.forEach((g, i) => { if (g.cells.some((c) => bitAt(w.closed, w.rowBytes, cf, c))) out.push(i); });
  w.closedCache.set(cf, out);
  return out;
}
function cellClosed(c, t) { return S.wetRun && bitAt(S.wetData.closed, S.wetData.rowBytes, closedFrame(t), c); }
function cellDepth(c, ms) { const w = S.wetData.water; return waterAt(w.u8, w.nCells, w.rowsMs, ms, c, w.step); }
// Speed relative to free flow of cell c holding n vehicles at time ms (water speed factor 1 on dry roads).
function cellRatio(c, n, ms) {
  const sf = S.wetRun ? speedFactor(cellDepth(c, ms), S.manifest.closure_m, S.manifest.ramp_start_m) : 1;
  return speedRatio(n / S.cellN[c], sf, S.cellKc[c], S.cellWr[c]);
}
function dotPositions() {
  const out = [], line = (c) => S.cellLine[c];
  let waiting = 0, road = 0, arrived = 0;
  S.sc.dots.list.forEach((dot, i) => {
    const st = TD.dotState(dot, S.t);
    if (st.kind === "waiting") waiting++; else if (st.kind === "arrived") arrived++; else road++;
    if (st.kind === "road" && line(dot.path[st.i])) out.push({ i, p: TD.dotPosition(dot, S.t, line) });
  });
  S.dotCounts = { waiting, road, arrived };
  return out;
}

const PICK_LAYERS = ["dots", "origins", "traffic", "closedRoads", "closedMarks", "base"];
function layers(st) {
  const sc = S.sc, show = S.show, f = S.f, key = S.key, mm = S.mm;
  const od = sc.mode === "od";
  const ls = [];
  const PathStyle = deck.PathStyleExtension;
  const dashed = (arr) => (PathStyle ? { extensions: [new PathStyle({ dash: true })], getDashArray: arr, dashJustified: true } : {});
  ls.push(new deck.PathLayer({ id: "base", data: S.groups, pickable: true, getPath: (g) => g.path, widthUnits: "pixels",
    getColor: BASE_ROAD, getWidth: 1, capRounded: true, jointRounded: true }));
  if (S.wetRun && show.water) {
    const ms = msAt(sc.frame_t[f]);
    ls.push(new deck.PathLayer({ id: "roadWater", data: S.groups, getPath: (g) => g.path, widthUnits: "pixels", getWidth: 2.5,
      getColor: (g) => {
        const depth = cellDepth(g.cells[0], ms);
        if (depth < 0.01) return [0, 0, 0, 0];
        return [...hex2rgb(WATER[Math.min(Math.floor(depth / WATER_STEP), WATER.length - 1)]), 200];
      }, updateTriggers: { getColor: [key, f] } }));
  }
  if (sc.expected && show.expected) {
    ls.push(new deck.PathLayer({ id: "expected", data: S.d.expected, getPath: (d) => S.cellLine[d.c], widthUnits: "pixels",
      getWidth: (d) => TD.shareWidth(d.s), getColor: [...hex2rgb(ORANGE), 115], capRounded: true, jointRounded: true,
      updateTriggers: { getWidth: key } }));
  }
  if (show.traffic) {
    const max = S.d.maxN || 1;
    ls.push(new deck.PathLayer({ id: "traffic", data: st.cells, pickable: true, getPath: (d) => S.cellLine[d.c], widthUnits: "pixels",
      getWidth: TRAFFIC_W, capRounded: true, jointRounded: true,
      getColor: (d) => [...(show.bySpeed ? hex2rgb(SPEED[d.cls]) : vehColor(d.n / max)), 255],
      updateTriggers: { getColor: [key, f, show.bySpeed] } }));
  }
  // the cumulative flow (and the shortest path) above the vehicles, so the comparison with the expected band shows at every time
  if (show.cum) {
    ls.push(new deck.PathLayer({ id: "cum", data: S.d.cum.filter((d) => TD.shareWidth(d.s) > 0), getPath: (d) => S.cellLine[d.c],
      widthUnits: "pixels", getWidth: (d) => Math.max(1.5, 0.25 * TD.shareWidth(d.s)), getColor: [...hex2rgb(INK), 153],
      ...dashed([2, 1.5]), updateTriggers: { getWidth: key } }));
  }
  if (od && show.shortest && sc.path_cells) {
    const path = [];
    for (const c of sc.path_cells) if (S.cellLine[c]) path.push(...S.cellLine[c]);
    ls.push(new deck.PathLayer({ id: "shortest", data: [{ path }], getPath: (d) => d.path, widthUnits: "pixels", getWidth: 2,
      getColor: [...hex2rgb(INK), 230], ...dashed([5, 3]), updateTriggers: { getPath: key } }));
  }
  if (S.wetRun && show.closed) {
    ls.push(new deck.PathLayer({ id: "closedRoads", data: st.closed, pickable: true, getPath: (i) => S.groups[i].path,
      widthUnits: "pixels", getWidth: CLOSED_W, getColor: [...hex2rgb(CLOSED), 255], capRounded: true, jointRounded: true }));
  }
  if (show.safe) {
    ls.push(new deck.ScatterplotLayer({ id: "safe", data: S.safePts, getPosition: (d) => d.p, radiusUnits: "pixels", getRadius: 3,
      getFillColor: [...hex2rgb(GREEN), 230], stroked: true, lineWidthUnits: "pixels", getLineWidth: 1, getLineColor: [255, 255, 255, 220] }));
  }
  // safe nodes this run's vehicles reached (to safety: medium rings; single destination: the destination, large)
  const reached = (od ? [sc.dest] : Object.keys(sc.arrived_node).map(Number)).filter((n) => S.nodes.points[n]);
  ls.push(new deck.ScatterplotLayer({ id: "dest", data: reached, getPosition: (n) => S.nodes.points[n], radiusUnits: "pixels",
    getRadius: od ? 12 : 8, stroked: true, filled: false, lineWidthUnits: "pixels", getLineWidth: od ? 3 : 2,
    getLineColor: [...hex2rgb(GREEN), 255], updateTriggers: { getRadius: key, getLineWidth: key } }));
  // origins of the current mode, one ring per node (click to pick; a node with several runs, e.g. the near and far OD
  // pairs from node 2290, cycles through them); the current one larger
  const origins = originNodes(sc.mode === "od" ? "od" : "safety");
  const chosen = (o) => o.node === sc.origin;
  ls.push(new deck.ScatterplotLayer({ id: "origins", data: origins, pickable: true, getPosition: (o) => S.nodes.points[o.node],
    radiusUnits: "pixels", getRadius: (o) => (chosen(o) ? 12 : 7), stroked: true, filled: true,
    getFillColor: (o) => (chosen(o) ? [255, 255, 255, 120] : [255, 255, 255, 60]), lineWidthUnits: "pixels",
    getLineWidth: (o) => (chosen(o) ? 3.5 : 2), getLineColor: (o) => [...hex2rgb(ORANGE), chosen(o) ? 255 : 170],
    updateTriggers: { getRadius: [key, S.sel.id], getLineWidth: [key, S.sel.id], getFillColor: [key, S.sel.id], getLineColor: [key, S.sel.id] } }));
  if (S.wetRun && show.closed) {
    const zoom = mm.map.getZoom(), alpha = markerAlpha(zoom);
    mm.alpha = alpha;
    let marks = [];
    if (alpha > 0) {
      const tkey = `${closedFrame(sc.frame_t[f])}|${zoom.toFixed(2)}`;
      if (S.thinKey !== tkey) {
        const xy = st.closed.map((i) => { const p = mm.map.project(S.groups[i].mid); return [p.x, p.y]; });
        S.thin = thinGrid(xy, 2 * MARK_PX).map((j) => st.closed[j]);
        S.thinKey = tkey;
      }
      marks = S.thin;
    }
    const atlas = closureIcon();
    ls.push(new deck.IconLayer({ id: "closedMarks", data: marks, visible: marks.length > 0, pickable: true, opacity: alpha,
      iconAtlas: atlas.url, iconMapping: atlas.mapping, getIcon: () => "mark", getPosition: (i) => S.groups[i].mid,
      sizeUnits: "pixels", getSize: MARK_PX, billboard: true }));
  }
  // the dots last, above the closure markers; dots at one point (several dots held in a cell at the end of the run are
  // all drawn at its middle) carry their count
  const dots = dotPositions();
  if (show.dots) {
    ls.push(new deck.ScatterplotLayer({ id: "dots", data: dots, pickable: true, getPosition: (d) => d.p, radiusUnits: "pixels", getRadius: 4,
      getFillColor: [...hex2rgb(ORANGE), 255], stroked: true, lineWidthUnits: "pixels", getLineWidth: 1.2, getLineColor: [255, 255, 255, 255],
      updateTriggers: { getPosition: S.t } }));
    const piles = new Map();
    for (const d of dots) { const k = `${d.p[0].toFixed(6)},${d.p[1].toFixed(6)}`; piles.set(k, piles.has(k) ? { p: d.p, n: piles.get(k).n + 1 } : { p: d.p, n: 1 }); }
    const counts = Array.from(piles.values()).filter((x) => x.n > 1);
    ls.push(new deck.TextLayer({ id: "dotCounts", data: counts, getPosition: (x) => x.p, getText: (x) => `${x.n} dots`, getSize: 11,
      sizeUnits: "pixels", getPixelOffset: [7, -9], getTextAnchor: "start", getAlignmentBaseline: "bottom", getColor: [11, 11, 11, 255],
      background: true, getBackgroundColor: [255, 255, 255, 220], backgroundPadding: [3, 1], fontFamily: "system-ui, Arial, sans-serif",
      updateTriggers: { getText: S.t, getPosition: S.t } }));
  }
  return ls;
}
function render(frameChanged) {
  if (!S.sc || !S.mm) return;
  const st = frameState(S.f);
  S.mm.overlay.setProps({ layers: layers(st) });
  const sc = S.sc, f = S.f;
  const veh = (x) => fmtVeh(x);
  const mi = f;                               // minute series with a leading 0: entry f is frame f
  $("clock").innerHTML = `<b>${esc(TD.clockText(S.wetRun ? S.t0.wet : S.t0.dry, S.t, S.wetRun))}</b>`
    + `<small>queued at the origin ${veh(sc.queue[f])} · on the road ${veh(S.d.minute.on_net[mi])} · arrived ${veh(S.d.minute.arrived[mi])} vehicles</small>`;
  $("time").textContent = S.wetRun ? fmtCdt(msAt(S.t)).replace(" CDT", "") : `+${Math.floor(S.t / 60 + 1e-9)} min`;
  const dc = $("trDotCounts");
  if (dc && S.dotCounts) dc.textContent = `Now: ${S.dotCounts.waiting} dots not yet on the road (not departed or queued), ${S.dotCounts.road} on the road, ${S.dotCounts.arrived} arrived.`;
  drawCum($("trCum"));
  if (frameChanged || (S.selection && S.selection.kind === "dot")) refreshInspector();
}
function fmtVeh(x) {
  if (!(Math.abs(x) > 0)) return "0";
  const a = Math.abs(x);
  return a >= 100 ? String(+x.toFixed(1)) : a >= 1 ? String(+x.toFixed(2)) : a >= 0.01 ? x.toFixed(3) : x.toExponential(1);
}

// ---- side panel ----
const CHECK_NAMES = {
  ref_vs_jax: ["JAX CTM vs numpy reference", "vehicles"], conservation: ["Conservation residual", "vehicles"],
  neg_n: ["Negative cell state", "vehicles"], neg_q: ["Negative queue", "vehicles"], over_N: ["Above jam storage", "vehicles"],
  closed_change: ["Change in a closed cell", "vehicles"], accounted: ["Vehicles not accounted for", "share of V"],
  b1_shares: ["Arrivals vs calculated shares (B1)", "share of V"], dots_cdf: ["Dots vs CTM arrival curve", "share"],
  dots_status: ["Dot status mismatches", "dots"],
};
const fmtVal = (v) => (v === 0 ? "0" : Math.abs(v) >= 1e-3 ? v.toFixed(4) : v.toExponential(1));
function buildSide() {
  const sc = S.sc, e = S.entry, m = S.manifest;
  const od = sc.mode === "od";
  const menu = od ? null : m.menu.origins.find((o) => o.id === e.menu_id);
  const noPos = e.no_position || noPosition(sc.origin);
  const wet = S.wetRun;
  const end = sc.frame_t[sc.frames - 1];
  const left = sc.vehicles - e.arrived;
  const st = sc.stuck;
  const rows = [
    ["Run", od ? `${sc.labels.join(" / ")} (single destination)` : `${e.menu_id}: ${menu ? menu.rule : ""}`],
    ["Origin", `node ${sc.origin}${noPos ? " (no map position)" : ""}${od ? ` → destination node ${sc.dest}` : ""}`],
    ["Vehicles", `${fmtVeh(sc.vehicles)} (${od ? "single-destination load" : `${sc.load} load`}), released evenly over the first ${m.depart_min} min`],
    ["Roads", wet ? `July 2025 road water, time-varying routing; departure ${dayTime(sc.t0_cdt)}, window ends ${dayTime(m.window_end_cdt.wet)}`
      : `dry, fixed routing (labelled as departing ${dayTime(sc.t0_cdt)}; the clock is irrelevant)`],
    ["Run end", `+${(end / 60).toFixed(1)} min after departure (${sc.steps} steps of ${sc.dt} s)`],
    ["Arrived", `${fmtVeh(e.arrived)} of ${fmtVeh(sc.vehicles)} vehicles (${(100 * e.arrived / sc.vehicles).toFixed(2)}%)`],
  ];
  if (left > 1e-6 * sc.vehicles) rows.push(["Left at the end", `${fmtVeh(left)}: queued at the origin ${fmtVeh(st.queued)}, held at dead ends ${fmtVeh(st.held_dead_end)}, in closed cells ${fmtVeh(st.closed_cells)}, elsewhere on the road ${fmtVeh(st.other)}`]);
  const notes = [];
  if (noPos) notes.push(`This origin has ${NO_POSITION_NOTE} (A14). It has no marker on the map.`);
  else if (sc.note) notes.push(`Note: ${sc.note}.`);
  if (sc.note && noPos && !/A14/.test(sc.note)) notes.push(`Note: ${sc.note}.`);
  $("trRun").innerHTML = `<dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`
    + notes.map((n) => `<p class="tr-note">${esc(n)}</p>`).join("");
  $("trCap1").textContent = wet ? "Vehicles over time (CTM)" : "Vehicles over time (CTM) against the free-flow reference";
  drawNodes();
  drawChecks();
  $("trCum")._sig = null;
}
function drawNodes() {
  const sc = S.sc, V = sc.vehicles, box = $("trNodes");
  const calc = sc.calc_node || null;
  const ids = new Set([...Object.keys(sc.arrived_node), ...Object.keys(calc || {})]);
  const rows = Array.from(ids, (n) => ({ n, ctm: sc.arrived_node[n] || 0, calc: calc ? (calc[n] || 0) : null }))
    .sort((a, b) => (calc ? b.calc - a.calc : 0) || b.ctm - a.ctm);
  const top = rows.slice(0, 8), rest = rows.slice(8);
  $("trCap2").textContent = calc ? "Arrivals per safe node at the end: CTM against calculated (B1)" : "Arrivals per safe node at the end (CTM)";
  const bar = (x, cls) => `<span class="tr-bar ${cls}" style="width:${(100 * Math.min(x / V, 1)).toFixed(2)}%"></span>`;
  let h = calc ? "" : `<p class="tr-note tr-wetnote">Time-varying routing: no calculated shares.</p>`;
  if (!rows.length) h += `<p class="tr-note">No vehicle arrived.</p>`;
  h += top.map((r) => `<div class="tr-row"><span class="tr-lab">node ${esc(r.n)}</span><span class="tr-bars">${bar(r.ctm, "tr-ctm")}`
    + `${calc ? bar(r.calc, "tr-calc") : ""}</span><span class="tr-val">${(100 * r.ctm / V).toFixed(2)}%${calc ? ` · ${(100 * r.calc / V).toFixed(2)}%` : ""}</span></div>`).join("");
  if (rest.length) {
    const s = rest.reduce((a, r) => a + r.ctm, 0);
    h += `<p class="tr-note">and ${rest.length} more nodes: ${(100 * s / V).toFixed(2)}% of the vehicles.</p>`;
  }
  h += `<p class="tr-key"><i class="tr-sw tr-ctm"></i>CTM${calc ? ` <i class="tr-sw tr-calc"></i>calculated` : ""} · share of the ${fmtVeh(V)} vehicles</p>`;
  box.innerHTML = h;
}
function drawChecks() {
  const ch = S.sc.checks;
  const rows = Object.entries(ch).map(([k, c]) => {
    const [name, unit] = CHECK_NAMES[k] || [k, ""];
    let rule = `≤ ${fmtVal(c.tol)}`;
    if (k === "dots_cdf") rule += ` (spec 0.05: ${c.pass_spec ? "pass" : "fail"})`;
    return `<tr><td>${esc(name)}</td><td>${esc(fmtVal(c.value))}</td><td>${esc(rule)}${unit ? ` <span class="tr-unit">${esc(unit)}</span>` : ""}</td>`
      + `<td class="${c.pass ? "tr-pass" : "tr-fail"}">${c.pass ? "pass" : "FAIL"}</td></tr>`;
  });
  // a run without the B1 check says why, in the table: wet runs (time-varying routing) and the A14 fallback origin
  // (no road cell at its node: nothing moves on roads, so no shares are compared)
  if (!ch.b1_shares) {
    const m = S.manifest, noPos = S.entry.no_position || noPosition(S.sc.origin);
    const why = S.wetRun ? m.wet_note.replace(/^wet: /, "") : noPos ? m.a14_note : "no calculated shares for this run";
    const at = rows.findIndex((r) => r.includes(">Dots vs CTM"));
    rows.splice(at < 0 ? rows.length : at, 0, `<tr><td>${esc(CHECK_NAMES.b1_shares[0])}</td><td>–</td><td colspan="2" class="tr-unit">not checked: ${esc(why)}</td></tr>`);
  }
  $("trChecks").innerHTML = `<table><thead><tr><th>Check</th><th>Value</th><th>Rule</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`
    + `<p class="tr-note">Dots check: largest distance between the dots' and the CTM's arrival curves, taken at every CTM step; rule 0.05 + 1/(2M), M = ${S.sc.dots.M} (post hoc, ctm-docs-rulings.md R13).</p>`;
}

// Chart 1: cumulative departed, queued, on the road, arrived per minute; dry runs also the free-flow reference
// (each vehicle at its departure + E[free-flow time]).
const NS = "http://www.w3.org/2000/svg";
function el(tag, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function niceScale(v) {
  const raw = Math.max(v, 1e-9) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw);
  return { ymax: Math.max(1, Math.ceil(v / step - 1e-9)) * step, ticks: Math.max(1, Math.ceil(v / step - 1e-9)), step };
}
const SERIES = [["injected", "Departed (cumulative)", INK2, ""], ["queued", "Queued at the origin", QUEUED, ""],
  ["on_net", "On the road", "#6f4eb0", ""], ["arrived", "Arrived (cumulative)", GREEN, ""]];
function drawCum(svg) {
  const d = S.d, sc = S.sc;
  const W = svg.clientWidth || 340, H = svg.clientHeight || 220;
  const ref = sc.E_tt_s !== undefined && sc.E_tt_s !== null && !S.wetRun;
  const series = ref ? [...SERIES, ["ref", "Free-flow reference", GRAY, "4 3"]] : SERIES;
  const box = { x0: 46, x1: W - 12, y0: 8, y1: H - 26 - 16 * series.length };
  const sig = `${S.key}|${W}x${H}|${ref}`;
  if (svg._sig !== sig) {
    svg._sig = sig; svg.textContent = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const tm = d.minT, tEnd = tm[tm.length - 1];
    const vals = {};
    for (const [k] of SERIES) vals[k] = d.minute[k];
    if (ref) vals.ref = tm.map((t) => TD.interp(tm, d.minute.injected, t - sc.E_tt_s));
    const sc0 = niceScale(sc.vehicles);
    const xs = (t) => box.x0 + (box.x1 - box.x0) * t / (tEnd || 1);
    const ys = (v) => box.y1 - (box.y1 - box.y0) * v / sc0.ymax;
    const ax = el("g", { class: "ax" }, svg);
    for (let k = 0; k <= sc0.ticks; k++) {
      const v = sc0.ymax * k / sc0.ticks, y = ys(v);
      el("line", { x1: box.x0, x2: box.x1, y1: y, y2: y }, ax);
      el("text", { x: box.x0 - 5, y: y + 4, "text-anchor": "end" }, ax, fmtVeh(v));
    }
    const mins = tEnd / 60, stepM = niceScale(mins).step;
    for (let mm = 0; mm <= mins + 1e-9; mm += stepM) el("text", { x: xs(mm * 60), y: box.y1 + 15, "text-anchor": "middle" }, ax, `${+mm.toFixed(1)}`);
    for (const [k, , color, dash] of series) {
      el("polyline", { points: tm.map((t, i) => `${xs(t).toFixed(1)},${ys(vals[k][i]).toFixed(1)}`).join(" "), fill: "none",
        style: `stroke:${color}`, "stroke-width": k === "ref" ? 1.4 : 1.8, ...(dash ? { "stroke-dasharray": dash } : {}) }, svg);
    }
    const lg = el("g", { class: "lg" }, svg);
    el("text", { x: 4, y: box.y1 + 30, class: "note" }, lg, `minutes after departure; vehicles (y)`);
    svg._vals = series.map(([k, label, color, dash], j) => {
      const y = box.y1 + 46 + j * 16;
      el("line", { x1: 4, x2: 18, y1: y - 4, y2: y - 4, style: `stroke:${color}`, "stroke-width": 2.5, ...(dash ? { "stroke-dasharray": dash } : {}) }, lg);
      el("text", { x: 24, y }, lg, label);
      return { k, v: vals[k], t: el("text", { x: W - 8, y, "text-anchor": "end", class: "v" }, lg, "") };
    });
    svg._xs = xs; svg._box = box;
  }
  const i = Math.min(S.f, d.minT.length - 1);
  for (const r of svg._vals) r.t.textContent = fmtVeh(r.v[i]);
  let c = svg.querySelector(".cursor");
  if (!c) c = el("line", { class: "cursor" }, svg);
  const x = svg._xs(S.t);
  c.setAttribute("x1", x); c.setAttribute("x2", x); c.setAttribute("y1", svg._box.y0); c.setAttribute("y2", svg._box.y1);
}

// ---- legend ----
function buildLegend() {
  if (!S.sc) return;
  const sc = S.sc, show = S.show, wet = S.wetRun, od = sc.mode === "od";
  const open = $("legend").querySelector("details");
  const isOpen = open ? open.open : !phone.matches;
  const ln = (style) => `<i class="ln" style="${style}"></i>`;
  const stops = [0, 0.25, 0.5, 0.75, 1].map((x) => `rgb(${vehColor(x).join(",")})`);
  const road = S.d.T === 0 ? `<div class="lg-row"><b>No road cells in this run</b>: its vehicles never use a road</div>` : show.bySpeed
    ? `<div class="lg-row"><b>Speed vs free flow</b> (CTM, cells with vehicles)<ul class="speeds">${SPEED.map((c, i) => `<li>${ln(`background:${c}`)}${SPEED_LABELS[i]}</li>`).join("")}</ul></div>`
    : `<div class="lg-row"><b>Vehicles on a road cell now</b>, against the run's largest (${fmtVeh(S.d.maxN)})
       <div class="bar" style="background:linear-gradient(to right, ${stops.join(", ")})"></div><div class="ends"><span>few</span><span>${fmtVeh(S.d.maxN)}</span></div></div>`;
  const perMinute = S.d.T === 0 ? "" : `<p class="lg-note">Road colours change once per model minute (the minute frames; frame 0 is the empty start); the dots move continuously.</p>`;
  const expected = sc.expected
    ? `<div class="lg-row">${ln(`background:${ORANGE};opacity:.45;height:9px`)}Expected route: each road's calculated share of the origin's traffic (B1), width ∝ √share</div>`
    : `<div class="lg-row tr-wetnote">Time-varying routing: no calculated shares (no expected-route layer)</div>`;
  const cum = `<div class="lg-row">${ln(`background:repeating-linear-gradient(to right, var(--ink) 0 4px, transparent 4px 7px);height:3px`)}CTM cumulative flow over the run (share of the vehicles)${sc.expected ? "; drawn inside the expected band, they should coincide" : ""}</div>`;
  const shortest = od ? `<div class="lg-row">${ln(`background:repeating-linear-gradient(to right, var(--ink) 0 9px, transparent 9px 14px);height:2px`)}Shortest free-flow path</div>` : "";
  const closed = wet ? `<div class="lg-row">${ln(`background:${CLOSED};height:${CLOSED_W}px;border-radius:3px`)}<span class="mark" style="font-size:${MARK_PX - 6}px">${CLOSED_MARK}</span>Closed by water (≥ ${S.manifest.closure_m.toFixed(2)} m), every road of the network<span class="lg-sub"> · markers from zoom ${MARKER_ZOOM}, thinned where they would overlap</span></div>` : "";
  const water = wet && show.water ? `<div class="lg-row"><b>Water on roads</b> (hourly, linear between hours)<div class="bar" style="background:linear-gradient(to right, ${WATER.join(", ")})"></div><div class="ends"><span>0 m</span><span>${(WATER_STEP * (WATER.length - 1)).toFixed(0)}+ m</span></div></div>` : "";
  const dots = `<div class="lg-row"><i class="dot" style="background:${ORANGE};border-color:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></i><b>Sample dots</b>
     <p class="lg-note tr-dotslabel">${esc(TD.dotsLabel(sc))}</p><p class="lg-note">A dot moves along each cell linearly in time; a dot that does not leave its cell before the run ends is drawn at the cell's middle (several there: labelled with their count).</p><p class="lg-note" id="trDotCounts"></p></div>`;
  const marks = `<div class="lg-row"><i class="tr-ring" style="border-color:${ORANGE}"></i>Origin (click a ring to choose it; a ring with several runs cycles through them)</div>
    <div class="lg-row"><i class="dot" style="background:${GREEN}"></i>Safe node${od ? "" : ` · <i class="tr-ring tr-ring-s" style="border-color:${GREEN}"></i>reached in this run`}</div>
    ${od ? `<div class="lg-row"><i class="tr-ring" style="border-color:${GREEN};border-width:3px"></i>Destination</div>` : ""}
    <div class="lg-row">${ln(`background:rgb(154,152,144);height:1px`)}Road network</div>`;
  $("legend").innerHTML = `<details ${isOpen ? "open" : ""}><summary>Legend</summary>${road}${perMinute}${S.d.T === 0 ? "" : `${expected}${cum}${shortest}`}${closed}${water}${dots}${marks}</details>`;
}

// ---- inspector ----
function onClick(e) {
  const hit = S.mm.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 5, layerIds: PICK_LAYERS });
  if (!hit) { S.selection = null; refreshInspector(); return; }
  const id = hit.layer.id;
  if (id === "origins") {
    const ids = hit.object.ids, at = ids.indexOf(S.sel.id);
    S.sel.id = at >= 0 ? ids[(at + 1) % ids.length] : ids[0];
    $("trOrigin").value = S.sel.id; S.selection = null;
    pick(true);
    return;
  }
  if (id === "dots") S.selection = { kind: "dot", i: hit.object.i };
  else if (id === "traffic") S.selection = { kind: "road", g: S.cellGroup[hit.object.c] };
  else if (id === "closedRoads" || id === "closedMarks") S.selection = { kind: "road", g: hit.object };
  else if (id === "base") S.selection = { kind: "road", g: hit.index };
  refreshInspector();
}
const minFmt = (t) => `+${(t / 60).toFixed(2)} min${S.wetRun ? ` (${fmtCdt(msAt(t))})` : ""}`;
function refreshInspector() {
  const sel = S.selection, elm = $("inspector");
  if (!sel || !S.sc) { elm.innerHTML = "<p>Click a road or a dot. Click an origin ring to choose that origin.</p>"; return; }
  const sc = S.sc, d = S.d, f = S.f, t = sc.frame_t[f], ms = msAt(t);
  if (sel.kind === "road") {
    const g = S.groups[sel.g];
    const n = frameState(f).n;
    const rows = g.cells.map((c) => {
      const col = d.col.get(c), veh = col === undefined ? 0 : n[col];
      const ex = sc.expected_share ? sc.expected_share[c] : undefined, cu = sc.cum_share[c];
      return [`cell ${c}`, cellClosed(c, t) ? "yes" : "no", `≈ ${fmtVeh(veh)} of ${S.cellN[c].toFixed(1)}`,
        `≈ ${round2(cellRatio(c, veh, ms)).toFixed(2)}`, cu === undefined ? "0" : `${(100 * cu).toFixed(2)}%`,
        sc.expected ? (ex === undefined ? "0" : `${(100 * ex).toFixed(2)}%`) : "n/a"];
    });
    showInspector(elm, { title: g.cells.length > 1 ? "Road (two-way: two cells)" : "Road cell",
      rows: [["Run", S.key], ["Frame", `${TD.clockText(S.wetRun ? S.t0.wet : S.t0.dry, t, S.wetRun)}`],
        ...(S.wetRun ? [["Water depth", `≈ ${cellDepth(g.cells[0], ms).toFixed(2)} m`]] : [])],
      table: { head: ["Cell", "Closed", "Vehicles now", "v/vf", "Cum. flow", "Expected"], rows },
      note: "Vehicles now: the minute frame (uint16, rounded). v/vf = min(sf, sf·kc/s, wr·(1−s)/s) with s = vehicles / jam storage "
        + "and sf the water speed factor (1 on dry roads). Cum. flow: vehicles that entered the cell over the whole run / V. "
        + (sc.expected ? "Expected: the cell's calculated share of the origin's traffic (B1)." : "Expected: none with time-varying routing.") });
  } else {
    const dot = sc.dots.list[sel.i], st = TD.dotState(dot, S.t);
    const passed = st.kind === "road" ? dot.path.slice(0, st.i + 1) : st.kind === "arrived" ? dot.path : [];
    const now = st.kind === "road" ? `on cell ${dot.path[st.i]} (${st.i + 1} of ${dot.path.length} cells traced)` : st.kind === "arrived" ? "arrived" : "in the origin queue";
    showInspector(elm, { title: `Sample dot ${sel.i + 1} of ${sc.dots.M}`,
      rows: [["Run", S.key], ["Stands for", `${fmtVeh(sc.dots.vehicles_per_dot)} vehicles`], ["Now", now],
        ["Released", dot.release === null ? "not released by the end of the run" : minFmt(dot.release)],
        ["Arrived", dot.arrive === null ? "not by the end of the run" : `${minFmt(dot.arrive)} at node ${dot.dest}`],
        ["Final status", dot.status.replace("_", " ")], ["Cells entered so far", passed.length ? `${passed.length}: ${passed.join(", ")}` : "none"]],
      note: "Traced from the model's flows (Newell's cumulative counts, first in first out within a cell); the model tracks amounts of traffic, not individual cars." });
  }
}

main().catch((e) => { console.error(e); notice("fatal", `Could not start: ${e.message}`); });
