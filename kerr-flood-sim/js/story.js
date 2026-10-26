// The story page: one fixed map driven by the scroll. Each step (story_steps.js) sets the whole state, so any order
// of activation gives the same picture for the same step. Data load in two phases: the map and the no-warning run
// first, then the other strategies' home states and totals, then the forced-departure traffic test (roads and totals).
import { fetchJSON, fetchU8, loadManifest, cdtMs, fmtCdt, pointGroups, pointPersons, coordBounds, tokenKind,
  pointOrders, orderLabel, bitAt, waterAt, thinGrid, trafficClass } from "./data.js";
import { createMap, addStaticLayers, setFlood, deckLayers, roadGroups, groupFrame, hex2rgb, MARK_PX, SPEED, SPEED_LABELS,
  CLOSED, CLOSED_MARK } from "./map.js";
import { drawStates, drawDeaths, drawGauge, drawFinals, showInspector, esc } from "./ui.js";
import { STEPS, STRATEGIES, EXTRAS } from "./story_steps.js";
import { resolveStep, fillNumbers, missingStrategies, busyRoads, weightedBox } from "./story_data.js";

const $ = (id) => document.getElementById(id);
const phone = window.matchMedia("(max-width: 899px)");
const still = window.matchMedia("(prefers-reduced-motion: reduce)");
const S = window.story = { data: {}, tried: new Set(), busy: {}, active: null, f: 0, anim: null, notes: new Map() };
const hhmmDay = (ms) => fmtCdt(ms).replace(/ CDT$/, "");        // "Jul 4 03:20"

function note(key, text) {
  if (text) S.notes.set(key, text); else S.notes.delete(key);
  // while a step says its own strategy is not available, the general "Not available" list is not repeated
  const shown = Array.from(S.notes).filter(([k]) => !(k === "strat" && S.notes.has("missing"))).map(([, v]) => v);
  const n = $("mapnote");
  n.textContent = shown.join(" · ");
  n.hidden = shown.length === 0;
}

const EXPECTED_VERSION = 1;

// Roads with no or negligible traffic on the traffic card: a visible grey (the default EMPTY_ROAD is faint at this zoom).
const EMPTY_VISIBLE = [120, 118, 110, 170];
// The traffic card's key, from the map's own colours: the speed classes, no or negligible traffic, and closed roads
// only if a road is closed during the card's window (data: closed.bin).
function trafficLegend() {
  const ul = $("traffic-legend"), step = STEPS.find((s) => s.id === "traffic");
  if (!ul || !step) return;
  const r = resolveStep(step, S.frameCdt), row = S.manifest.files.closed.shape[1];
  const anyClosed = S.closed.subarray(r.f0 * row, (r.f1 + 1) * row).some((b) => b !== 0);
  const rgba = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${((c[3] ?? 255) / 255).toFixed(2)})`;
  const item = (color, text, cls = "") => `<li><i class="ln ${cls}" style="background:${esc(color)}"></i><span>${esc(text)}</span></li>`;
  ul.innerHTML = `<li class="title">Speed against free flow</li>` + SPEED.map((c, i) => item(c, SPEED_LABELS[i])).join("")
    + item(rgba(EMPTY_VISIBLE), "no or negligible traffic", "thin")
    + (anyClosed ? item(CLOSED, `closed by water (marked ${CLOSED_MARK})`, "closed") : "");
}

async function main() {
  observeSteps();                                // cards light up at once; steps are applied when the data is in
  const manifest = await loadManifest();
  S.manifest = manifest;
  $("caption").textContent = manifest.caption;
  S.frameCdt = manifest.frames.cdt;
  S.frames = S.frameCdt.map(cdtMs);
  S.order = manifest.states.order;
  S.stateRgb = S.order.map((s) => hex2rgb(manifest.states.colors[s]));
  S.deadIdx = S.order.indexOf("dead");
  for (const sw of document.querySelectorAll(".sw[data-color]")) {
    const sc = manifest.scenarios[sw.dataset.color];
    if (sc) sw.style.background = sc.color;
  }
  const sdoc = await fetchJSON("data/story.json").catch(() => null);
  const numbers = S.numbers = sdoc ? sdoc.numbers : {};
  const vers = [["manifest", manifest.version], ...(sdoc ? [["story.json", sdoc.version]] : [])].filter(([, v]) => v !== EXPECTED_VERSION);
  if (vers.length) note("version", `Data version ${vers.map(([n, v]) => `${n} ${v}`).join(", ")} differs from the page's ${EXPECTED_VERSION}: values may be misread`);
  const missing = fillNumbers(document, numbers);
  // a value of several words (a phrase, not a number) may wrap
  for (const e of document.querySelectorAll("[data-num]")) e.classList.toggle("phrase", e.textContent.trim().split(/\s+/).length > 2);
  if (missing.length) note("nums", `Some numbers could not be loaded (${missing.length})`);
  // phase 1: the map and the no-warning run
  const files = [["roads", () => fetchJSON("data/roads.geojson")], ["homes", () => fetchJSON("data/homes.json")],
    ["flood", () => fetchJSON("data/flood/bounds.json")], ["gauge", () => fetchJSON("data/gauge.json")],
    ["river", () => fetchJSON("data/river.geojson")],
    ["closed", () => fetchU8(`data/${manifest.files.closed.file}`)],
    ["water", () => fetchU8(`data/${manifest.files.water_roads.file}`)],
    ["studyArea", () => fetchJSON(`data/${manifest.study_area.file}`)]];
  let done = 0;
  note("load", `Loading map data… 0 of ${files.length + 1}`);
  const got = await Promise.all(files.map(([k, f]) => f().then((v) => { note("load", `Loading map data… ${++done} of ${files.length + 1}`); return [k, v]; })));
  Object.assign(S, Object.fromEntries(got));
  S.groups = roadGroups(S.roads);
  S.points = pointGroups(S.homes);
  S.bounds = coordBounds(S.studyArea.features.map((f) => f.geometry.coordinates));
  // the homes camera: the people-weighted 5-95% box (the raw extent of the homes is nearly the whole study area)
  S.homeBox = weightedBox(S.points.map((g) => [g.lon, g.lat, g.pop])) || S.bounds;
  trafficLegend();
  S.water = { u8: S.water, nCells: manifest.counts.cells, rowsMs: manifest.water_rows.cdt.map(cdtMs),
              step: manifest.water_rows.step_m, colors: S.flood.colors, colorStep: S.flood.depth_step_m };
  if (!(await loadScenario("none", { roads: true, homes: true }))) throw new Error("the no-warning run (none) could not be loaded");
  note("load", null);
  await buildMap();
  S.floodLoaded = preloadFlood();                 // in the background, next to phase 2
  S.ready = true;
  if (S.active) applyStep(S.active);
  // phase 2: the other strategies (home states and totals only), then the traffic test. A step waiting for one is
  // applied once its load ends (with its data, or saying it is not available); the result step is applied again when
  // all strategies are in (its chart shows every strategy). A running step is not restarted.
  const arrived = (k) => (d) => { if (S.active && S.waiting === S.active.id && S.active.scenario === k) applyStep(S.active); return d; };
  await Promise.all(STRATEGIES.filter((k) => k !== "none").map((k) => loadScenario(k, { roads: false, homes: true }).then(arrived(k))));
  S.phase2 = true;
  const miss = missingStrategies(new Set(Object.keys(S.data)));
  if (miss.length) note("strat", `Not available: ${miss.map(label).join(", ")}`);
  if (S.active && (S.waiting === S.active.id || S.active.id === "result")) applyStep(S.active);
  // then the traffic test (its roads are about 10 MB): roads and totals, no homes
  await Promise.all(EXTRAS.map((k) => loadScenario(k, { roads: true, homes: false }).then(arrived(k))));
}
const label = (k) => (S.manifest.scenarios[k] ? S.manifest.scenarios[k].label : k);

// A scenario's totals, and its home states and road occupancy (the traffic colours) as asked. S.tried: the scenarios
// whose load has ended, loaded or not (a step waiting for one that failed says "not available").
async function loadScenario(k, want) {
  const sc = S.manifest.scenarios[k];
  try {
    if (!sc) throw new Error("not in the manifest");
    const [totals, homes, roads] = await Promise.all([fetchJSON(`data/${k}_totals.json`),
      want.homes ? fetchU8(`data/${sc.files.homes.file}`) : Promise.resolve(null),
      want.roads ? fetchU8(`data/${sc.files.roads.file}`) : Promise.resolve(null)]);
    S.data[k] = { totals, homes, roads, orders: pointOrders(S.points, S.homes.area, totals.orders || []), gf: new Map() };
    return S.data[k];
  } catch (e) { console.warn(`${k}: ${e.message}`); return null; }
  finally { S.tried.add(k); }
}

async function buildMap() {
  const token = (window.DASHBOARD_CONFIG || {}).mapboxToken;
  const pub = tokenKind(token) === "public" ? token : null;
  let m;
  try { m = await createMap($("map"), { token: pub, style: pub ? "outdoors" : "plain", bounds: S.bounds }); }
  catch (e) {
    note("mapbox", `Mapbox failed (${e.message}): plain background`);
    m = await createMap($("map"), { token: null, style: "plain", bounds: S.bounds });
  }
  m.map.scrollZoom.disable();
  phoneGestures(m.map);
  addStaticLayers(m, { river: S.river, flood: S.flood, studyArea: S.studyArea });
  m.map.on("click", (e) => inspect(e));
  // the closure markers depend on the zoom and are thinned on the screen: redraw once a camera move ends
  m.map.on("moveend", () => render());
  S.m = m;
}

// On a phone the map is the page's backdrop: one finger scrolls the story (no drag or pinch on the map); the zoom
// buttons and tapping a road or a home still work.
function phoneGestures(map) {
  for (const h of [map.dragPan, map.touchZoomRotate]) phone.matches ? h.disable() : h.enable();
}

// ---- steps ----
// A step fires when its card crosses a line: mid-screen on a desktop; on a phone, in the part below the map.
let io = null;
function observeSteps() {
  const byId = Object.fromEntries(STEPS.map((s) => [s.id, s]));
  if (io) io.disconnect();
  io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      const step = byId[en.target.dataset.step];
      if (!step || (S.active && S.active.id === step.id)) continue;
      document.querySelectorAll(".step.active").forEach((x) => x.classList.remove("active"));
      en.target.classList.add("active");
      S.active = step;
      applyStep(step);
    }
  }, { rootMargin: phone.matches ? "-72% 0px -28% 0px" : "-50% 0px -50% 0px" });
  document.querySelectorAll(".step[data-step]").forEach((el) => io.observe(el));
}

// Moving the chart and the player out of the previous card changes that card's height; when that card is above the
// active one (scrolling forward), everything below would jump up, past the trigger line (on a phone the chart is
// several hundred pixels: the next card fired at once and "What this is not" was skipped). Keep the active card where
// it was on the screen.
function applyStep(step) {
  if (!S.ready) return;                          // applied again when the data is in (main)
  const card = document.querySelector(".step.active"), y0 = card ? card.getBoundingClientRect().top : 0;
  applyStepState(step);
  if (card) { const dy = card.getBoundingClientRect().top - y0; if (Math.abs(dy) >= 1) window.scrollBy(0, dy); }
}
function applyStepState(step) {
  const r = resolveStep(step, S.frameCdt);
  const k = r.scenario;
  // the step's own strategy must be in; for the result chart, the strategies still missing are left out (main notes them)
  stopAnim();
  if (!S.data[k]) {
    // nothing of the previous step keeps running under this card: no player, chart, clock, overlay or popup
    S.waiting = step.id; S.r = null;
    document.querySelectorAll(".player").forEach((p) => p.remove());
    placeChart(null);
    setClock(null); $("popup").hidden = true;
    S.m.overlay.setProps({ layers: [] });
    for (const id of ["flood", "river"]) S.m.map.setLayoutProperty(id, "visibility", "none");
    if (S.tried.has(k)) { note("wait", null); note("missing", `${label(k)}: not available`); }
    else { note("missing", null); note("wait", EXTRAS.includes(k) ? "Loading this run…" : "Loading this strategy…"); }
    return;
  }
  S.waiting = null;
  note("wait", null); note("missing", null);
  S.r = r; S.k = k; S.show = r.layers;
  S.m.map.setLayoutProperty("flood", "visibility", r.layers.flood ? "visible" : "none");
  S.m.map.setLayoutProperty("river", "visibility", r.layers.river ? "visible" : "none");
  for (const id of ["study-area-halo", "study-area"]) if (S.m.map.getLayer(id)) S.m.map.setLayoutProperty(id, "visibility", r.layers.study ? "visible" : "none");
  placeChart(r.chart);                           // first: the camera leaves room for the chart panel and the clock
  setClock(r.clock ? S.frames[r.play ? r.f0 : r.f1] : null);
  moveCamera(r.camera);
  $("popup").hidden = true;
  addPlayer(step, r);
  if (!r.play || still.matches) { setFrame(r.f1); return; }
  // a played step that shows the flood waits for the hourly images (requested one by one they arrive slower than the
  // playback switches them, and the water seemed not to change); a later step or a replay finds them in memory
  if (r.layers.flood && !S.floodDone) {
    setFrame(r.f0);
    note("wait", "Loading flood images…");
    S.floodLoaded.then(() => { if (S.r === r) { note("wait", null); animate(r.f0, r.f1, 8000); } });
    return;
  }
  animate(r.f0, r.f1, 8000);
}
// The hourly flood images, fetched once into memory as blob URLs; render() uses them (an image not in yet is
// requested as before). Resolves when every image is in or has failed.
function preloadFlood() {
  S.floodUrl = {};
  return Promise.all(S.flood.frames.map((fr) => fetch(`data/${fr.file}`)
    .then((res) => (res.ok ? res.blob() : null))
    .then((b) => { if (b) S.floodUrl[fr.file] = URL.createObjectURL(b); })
    .catch(() => {}))).then(() => { S.floodDone = true; });
}

// The part of the map the cards, the clock and the chart panel leave free, as padding in pixels: on a desktop the
// cards' column on the left (and the chart panel on the right when shown); on a phone the lower third, where the
// active card enters. The top is below the clock's real bottom.
function camPadding() {
  const st = $("stage"), W = st.clientWidth, H = st.clientHeight, sTop = st.getBoundingClientRect().top;
  const clock = $("clock"), top = clock.innerHTML ? Math.max(24, Math.round(clock.getBoundingClientRect().bottom - sTop) + 12) : 24;
  let p;
  if (phone.matches) p = { top, right: 16, bottom: Math.round(0.34 * H), left: 16 };
  else {
    const card = document.querySelector("#steps .card"), fig = $("chart");
    const left = card ? Math.round(card.getBoundingClientRect().right - st.getBoundingClientRect().left) + 24 : 24;
    const right = !fig.hidden && !fig.classList.contains("in-card") ? fig.offsetWidth + 40 : 64;
    p = { top, right, bottom: 40, left };
  }
  // keep at least 160 px of map each way
  const fit = (a, b, size) => { const over = a + b + 160 - size; return over > 0 ? [a - over * a / (a + b), b - over * b / (a + b)] : [a, b]; };
  [p.left, p.right] = fit(p.left, p.right, W);
  [p.top, p.bottom] = fit(p.top, p.bottom, H);
  return p;
}
// "study", "homes" or "traffic" fit those bounds into the free part; an object {center, zoom} puts its centre at the
// free part's centre (an offset, not the map's padding, which would persist and add to every later fit).
function moveCamera(cam) {
  const map = S.m.map, duration = still.matches ? 0 : 1400, p = camPadding();
  if (cam && typeof cam === "object") {
    map.flyTo({ ...cam, offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2], duration, essential: true });
    return;
  }
  // the busy roads of the step's run at its peak frame, computed once (the traffic card): their vehicle-weighted box
  if (cam === "traffic" && !S.busy[S.k] && S.data[S.k].roads)
    S.busy[S.k] = busyRoads(S.groups, S.data[S.k].roads, S.manifest.scenarios[S.k].files.roads.shape);
  const b = cam === "homes" ? S.homeBox : cam === "traffic" ? (S.busy[S.k] || {}).core : S.bounds;
  map.fitBounds(b || S.bounds, { padding: p, duration, maxZoom: cam === "traffic" ? 14 : 13, essential: true });
}

// ---- time ----
function stopAnim() { if (S.anim) cancelAnimationFrame(S.anim.id); S.anim = null; syncPlayer(); }
function animate(f0, f1, ms) {
  const t0 = performance.now();
  const tick = (now) => {
    const x = Math.min(Math.max((now - t0) / ms, 0), 1);   // a rAF timestamp can precede t0: never frame f0 - 1
    setFrame(Math.round(f0 + x * (f1 - f0)));
    if (x < 1) S.anim.id = requestAnimationFrame(tick); else { S.anim = null; syncPlayer(); }
  };
  S.anim = { id: requestAnimationFrame(tick) };
  syncPlayer();
}
function setFrame(f) { S.f = f; render(); syncPlayer(); }

// A play / pause button, a slider over the step's frames and the model time, in its card (played steps only).
function addPlayer(step, r) {
  document.querySelectorAll(".player").forEach((p) => p.remove());
  if (!r.play) return;
  const card = document.querySelector(`.step[data-step="${step.id}"] .card`);
  const p = document.createElement("div");
  p.className = "player";
  p.innerHTML = `<button type="button" aria-label="Play">▶</button><input type="range" min="${r.f0}" max="${r.f1}" value="${S.f}" aria-label="Model time"><output aria-hidden="true"></output>`;
  const [btn, sl] = p.children;
  btn.addEventListener("click", () => { if (S.anim) stopAnim(); else animate(S.f >= r.f1 ? r.f0 : S.f, r.f1, 8000 * (r.f1 - (S.f >= r.f1 ? r.f0 : S.f)) / Math.max(r.f1 - r.f0, 1)); });
  // read the value first: stopAnim re-syncs the slider to the current frame
  sl.addEventListener("input", () => { const v = Number(sl.value); stopAnim(); setFrame(v); });
  card.appendChild(p);
}
function syncPlayer() {
  const p = document.querySelector(".player");
  if (!p) return;
  p.children[0].textContent = S.anim ? "❚❚" : "▶";
  p.children[0].setAttribute("aria-label", S.anim ? "Pause" : "Play");
  p.children[1].value = String(S.f);
  const t = hhmmDay(S.frames[S.f]);
  p.children[1].setAttribute("aria-valuetext", t);
  p.children[2].textContent = t;
}

// ---- drawing ----
// Road state at frame f: closures are the same in every run; the traffic colours are run k's own (its road occupancy),
// or no warning's for a run whose roads are not loaded (its roads layer is then hidden, see render).
function gf(k, f) {
  const src = S.data[k] && S.data[k].roads ? k : "none", d = S.data[src];
  if (!d.gf.has(f)) {
    if (d.gf.size > 8) d.gf.delete(d.gf.keys().next().value);
    d.gf.set(f, groupFrame(S.groups, d.roads, S.manifest.scenarios[src].files.roads.shape, S.closed, S.manifest.files.closed.shape, f,
      { water: S.water, ms: S.frames[f], closure: S.manifest.closure_m, rampStart: S.manifest.ramp_start_m }));
  }
  return d.gf.get(f);
}
// closure markers at least 1.2 marker sizes apart on the screen (as in the explorer)
function thin(idx) {
  const xy = idx.map((i) => { const p = S.m.map.project(S.groups[i].mid); return [p.x, p.y]; });
  return thinGrid(xy, 1.2 * MARK_PX).map((j) => idx[j]);
}
function render() {
  if (!S.r || !S.m) return;
  const f = S.f, ms = S.frames[f], k = S.k, d = S.data[k], sc = S.manifest.scenarios[k];
  setFlood(S.m, S.flood, ms, (file) => (S.floodUrl && S.floodUrl[file]) || `data/${file}`);
  S.m.overlay.setProps({ layers: deckLayers({ key: k, f, ms, zoom: S.m.map.getZoom(), thin, groups: S.groups, gf: gf(k, f),
    homes: S.homes, points: S.points, homesU8: d.homes, nStates: S.order.length, deadIdx: S.deadIdx, stateColors: S.stateRgb,
    water: S.water, orders: d.orders, orderColor: hex2rgb(sc.color),
    show: { roads: S.show.roads && !!d.roads, closed: S.show.closed, homes: S.show.homes && !!d.homes, orders: S.show.orders },
    emptyRoad: EXTRAS.includes(k) ? EMPTY_VISIBLE : undefined }) });
  if (S.r.clock) setClock(ms);
  drawChart(f, ms);
}
// The clock over the map: model time and the run's label; empty (hidden) for null.
function setClock(ms) {
  const sc = S.k && S.manifest.scenarios[S.k];
  $("clock").innerHTML = ms == null || !sc ? ""
    : `<b>${esc(fmtCdt(ms))}</b><small><i class="sw" style="background:${esc(sc.color)}"></i>${esc(sc.label)}</small>`;
}

function placeChart(kind) {
  const fig = $("chart");
  fig.hidden = !kind;
  S.chart = kind;
  $("chartsvg2").style.display = kind === "result" ? "" : "none";
  const home = phone.matches ? document.querySelector(".step.active .card") : $("stage");
  if (home && fig.parentElement !== home) home.appendChild(fig);
  fig.classList.toggle("in-card", phone.matches);
  $("chartsvg")._sig = null; $("chartsvg")._totals = null;      // redraw from scratch for the new kind
}
function drawChart(f, ms) {
  const kind = S.chart, svg = $("chartsvg"), cap = $("chart").querySelector("figcaption"), m = S.manifest;
  if (!kind) return;
  if (kind === "gauge") { cap.textContent = "Hunt gauge: rise, each series from its own first value"; drawGauge(svg, S.gauge, ms, S.frames); }
  if (kind === "states") { cap.textContent = "People by state, no warning"; drawStates(svg, S.data.none.totals, f, m.states.colors, S.frames); }
  if (kind === "loss-none") {
    cap.textContent = "Expected life loss so far, no warning. The line is this page's own re-run of the model; it matches the values in the text to within 0.02.";
    drawDeaths(svg, { none: S.data.none.totals }, f, m, S.frames);
  }
  if (kind === "result") {
    const keys = STRATEGIES.filter((k) => S.data[k]);
    // the window's end, from the frames ("15:00 on July 4")
    const end = new Date(S.frames[S.frames.length - 1]), mon = ["January", "February", "March", "April", "May", "June", "July",
      "August", "September", "October", "November", "December"][end.getUTCMonth()];
    const hm = `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
    cap.textContent = `Expected life loss so far (lines) and at ${hm} on ${mon} ${end.getUTCDate()} (bars). The lines are this page's own re-run of the model; they match the values in the text to within 0.02.`;
    // no line end labels: the bars carry the values, as in the text
    drawDeaths(svg, Object.fromEntries(keys.map((k) => [k, S.data[k].totals])), f, m, S.frames, { endLabels: false });
    // the oracle's line dashed: its orange is close to the learned policy's (lines and legend key only)
    if (m.scenarios.oracle) for (const e of svg.querySelectorAll(`[stroke="${m.scenarios.oracle.color}"]`)) e.setAttribute("stroke-dasharray", "5 3");
    // the bars: the same numbers as the text (story.json); the CPU re-run's own value if story.json lacks one
    drawFinals($("chartsvg2"), keys.map((k) => {
      const n = (S.numbers || {})[`loss_${k}`], cpu = S.data[k].totals.final.total;
      return { label: m.scenarios[k].label.replace(/ \(.*\)$/, ""), color: m.scenarios[k].color,
               value: n ? n.value : cpu, text: n ? n.text : cpu.toFixed(2) };
    }));
  }
}

// ---- click: a small inspector for a home or a road ----
function inspect(e) {
  const hit = S.m.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4, layerIds: ["homes", "roads", "closedRoads", "closedMarks"] });
  const pop = $("popup");
  if (!hit) { pop.hidden = true; return; }
  const f = S.f, ms = S.frames[f], m = S.manifest, d = S.data[S.k];
  if (hit.layer.id === "homes") {
    const g = hit.object, nO = S.homes.pop.length;
    const ppl = pointPersons(d.homes, S.order.length, nO, f, g.rows, S.homes.pop);
    const od = d.orders[S.points.indexOf(g)];
    showInspector(pop, { title: "Home (one building)", rows: [["Time", fmtCdt(ms)], ["People", g.pop.toFixed(2)],
      ["Order", od ? `${orderLabel(od.instr)} at ${fmtCdt(od.ms)}${od.ms > ms ? " (not yet)" : ""}` : "none"],
      ...S.order.map((s, j) => [m.states.labels[s], `≈ ${ppl[j].toFixed(2)}`])], note: "Expected values (shares in 1/255 steps)." });
  } else {
    const gi = hit.layer.id === "roads" ? hit.index : hit.object, gr = S.groups[gi];
    const shut = gr.cells.some((c) => bitAt(S.closed, m.files.closed.shape[1], f, c));
    const depth = waterAt(S.water.u8, S.water.nCells, S.water.rowsMs, ms, gr.cells[0], S.water.step);
    // traffic rows when the step's run has its roads loaded (the map shows its traffic colours)
    const traffic = [];
    if (d.roads && S.show.roads) {
      const g = gf(S.k, f), c = trafficClass(g.veh[gi], g.ratio[gi]);
      traffic.push(["Vehicles", `≈ ${g.veh[gi].toFixed(1)}`],
        ["Speed vs free flow", g.shut[gi] ? "closed" : c < 0 ? "no or negligible traffic" : SPEED_LABELS[c]]);
    }
    showInspector(pop, { title: "Road", rows: [["Time", fmtCdt(ms)], ...traffic, ["Water depth", `≈ ${depth.toFixed(2)} m`],
      ["Closed", shut ? `yes (≥ ${m.closure_m.toFixed(2)} m)` : "no"]] });
  }
  const close = document.createElement("button");
  close.type = "button"; close.className = "x"; close.textContent = "×"; close.setAttribute("aria-label", "Close");
  close.addEventListener("click", () => (pop.hidden = true));
  pop.prepend(close);
  pop.hidden = false;
  // at the clicked point, kept inside the map; on a phone also above the active card, which scrolls over the map; on
  // a desktop right of the cards' column (a click in a gap between two cards would put it under the next one)
  const st = $("stage"), card = phone.matches ? document.querySelector(".step.active .card") : null;
  const cardTop = card ? card.getBoundingClientRect().top - st.getBoundingClientRect().top : Infinity;
  const bottom = Math.min(st.clientHeight, cardTop > 0 ? cardTop : st.clientHeight);
  const col = phone.matches ? null : document.querySelector("#steps .card");
  const minLeft = col ? Math.round(col.getBoundingClientRect().right - st.getBoundingClientRect().left) + 8 : 8;
  const maxLeft = st.clientWidth - pop.offsetWidth - 8;
  pop.style.left = `${Math.max(Math.min(minLeft, maxLeft), Math.min(e.point.x + 10, maxLeft))}px`;
  // and below the clock (fixed over the map's top right, outside the stage)
  const clock = $("clock"), minTop = clock.innerHTML ? Math.max(8, Math.round(clock.getBoundingClientRect().bottom - st.getBoundingClientRect().top) + 8) : 8;
  pop.style.top = `${Math.max(minTop, Math.min(e.point.y + 10, bottom - pop.offsetHeight - 8))}px`;
}

phone.addEventListener("change", () => { observeSteps(); if (S.m) phoneGestures(S.m.map); if (S.active && S.ready) applyStep(S.active); });
main().catch((e) => { console.error(e); note("load", null); note("fatal", `The map could not load (${e.message}); the text reads on its own.`); });
