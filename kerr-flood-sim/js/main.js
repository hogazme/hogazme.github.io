// Page entry: loads the manifest and data, builds the map(s), controls and charts, and renders frame by frame.
import { fetchJSON, fetchU8, loadManifest, cdtMs, fmtCdt, waterAt, bitAt, tokenKind, pointGroups, pointPersons,
  majorityState, trafficClass, round2, MIN_VEHICLES, markerAlpha, coordBounds, thinGrid, MARKER_ZOOM, closedCounts,
  closureMilestones, orderGroups, pointOrders, orderLabel } from "./data.js";
import { createMap, addStaticLayers, setFlood, deckLayers, roadGroups, groupFrame, geoBounds, hex2rgb,
  TRAFFIC, SPEED, SPEED_LABELS, CLOSED, CLOSED_W, CLOSED_MARK, MARK_PX, STUDY_LINE,
  cellSpeed } from "./map.js";
import { buildScenarioButtons, buildTimeline, drawStates, drawDeaths, drawGauge, showInspector, drawTicks, esc } from "./ui.js";

const EXPECTED_VERSION = 1;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const RECORD = params.get("record") === "1";
const phone = window.matchMedia("(max-width: 760px)");
const notices = new Map();
function notice(key, text) {
  if (text) notices.set(key, text); else notices.delete(key);
  const n = $("notice");
  n.textContent = Array.from(notices.values()).join(" · ");
  n.hidden = notices.size === 0;
}

// window.dashboard: read-only handle on the page state, for checks in the browser console.
const S = window.dashboard = { key: null, compare: "", f: 0, data: {}, totals: {}, maps: {}, selection: null,
  show: { flood: true, river: true, orders: true, study: true, roads: true, closed: true, occupancy: false, roadWater: false,
    homes: true } };
// Traffic-only runs (forced demand, no behavior or harm model) have no life loss.
const trafficOnly = (k) => !!(k && S.manifest.scenarios[k] && S.manifest.scenarios[k].traffic_only);

async function main() {
  if (RECORD) document.body.classList.add("record");
  const manifest = await loadManifest();
  S.manifest = manifest;
  $("caption").textContent = manifest.caption;
  if (manifest.version !== EXPECTED_VERSION) notice("version", `Data version ${manifest.version} differs from the page's ${EXPECTED_VERSION}: values may be misread`);
  S.frames = manifest.frames.cdt.map(cdtMs);
  S.order = manifest.states.order;
  S.stateRgb = S.order.map((s) => hex2rgb(manifest.states.colors[s]));
  S.deadIdx = S.order.indexOf("dead");
  if (RECORD) showTitleCard();

  S.ui = buildScenarioButtons(manifest, (k) => pickScenario(k));
  notice("load", "Loading data…");
  const sa = manifest.study_area;
  const [roads, river, homes, flood, gauge, closed, water, studyArea] = await Promise.all([
    fetchJSON("data/roads.geojson"), fetchJSON("data/river.geojson"),
    fetchJSON("data/homes.json"), fetchJSON("data/flood/bounds.json"), fetchJSON("data/gauge.json"),
    fetchU8(`data/${manifest.files.closed.file}`), fetchU8(`data/${manifest.files.water_roads.file}`),
    sa ? fetchJSON(`data/${sa.file}`).catch((e) => { notice("study", `Study area: ${e.message}`); return null; }) : null]);
  Object.assign(S, { roads, river, homes, flood, gauge, closed, studyArea });
  S.groups = roadGroups(roads);
  S.points = pointGroups(homes);
  // initial view: the study area (the road network extends up to about 2.5 km beyond it, built with a 3 km buffer, so
  // that exits are modelled; no home lies outside it)
  S.bounds = studyArea ? coordBounds(studyArea.features.map((f) => f.geometry.coordinates)) : geoBounds(roads);
  S.water = { u8: water, nCells: manifest.counts.cells, rowsMs: manifest.water_rows.cdt.map(cdtMs), step: manifest.water_rows.step_m,
    colors: flood.colors, colorStep: flood.depth_step_m };
  S.peopleByArea = new Map();
  homes.area.forEach((z, o) => S.peopleByArea.set(z, (S.peopleByArea.get(z) || 0) + homes.pop[o]));
  S.groupCells = S.groups.map((g) => g.cells);
  S.closedCount = closedCounts(S.groupCells, S.closed, manifest.files.closed.shape[1], S.frames.length);
  S.closureTicks = closureTicks();

  // Every scenario's totals (small) are read now for the all-scenario deaths chart; its binary files are only
  // checked (HEAD) here and fetched on first selection. Any failure greys the button out with the reason.
  await Promise.all(Object.entries(manifest.scenarios).map(async ([k, s]) => {
    try {
      S.totals[k] = await fetchJSON(`data/${k}_totals.json`);
      for (const fl of Object.values(s.files)) {
        const r = await fetch(`data/${fl.file}`, { method: "HEAD" });
        if (!r.ok) throw new Error(`data/${fl.file}: HTTP ${r.status}`);
      }
    } catch (e) { delete S.totals[k]; S.ui.disable(k, `Unavailable: ${e.message}`); }
  }));

  buildControls();
  await buildMaps();
  S.tl = buildTimeline(manifest, (f) => { S.f = f; schedule(); });
  await pickScenario(resolveScenario(params.get("scenario")), true);
  const cmp = params.get("compare");
  if (cmp && !phone.matches && S.ui.enabled(cmp)) {
    $("compare").value = cmp;
    await setCompare(cmp);
    S.maps.A.map.fitBounds(S.bounds, { padding: 24, duration: 0 });     // B follows through the sync
  }
  const f0 = Number(params.get("frame"));
  S.tl.set(Number.isFinite(f0) ? f0 : 0);
  window.addEventListener("resize", () => schedule());
  if (RECORD) startRecording();
}

// ---- road closures (timeline ticks): the first closed road and the 25, 50, 75 and 100% milestones of the peak count ----
function closureTicks() {
  const n = S.groups.length, c = S.closedCount, out = [];
  const f0 = c.findIndex((x) => x > 0);
  if (f0 >= 0) out.push({ ms: S.frames[f0], title: `First road closed: ${fmtCdt(S.frames[f0])}` });
  for (const m of closureMilestones(c)) out.push({ ms: S.frames[m.f],
    title: `${Math.round(100 * m.share)}% of the peak closure (${m.n.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} roads): ${fmtCdt(S.frames[m.f])}` });
  return out;
}

// ---- controls ----
function buildControls() {
  const m = S.manifest;
  const cmp = $("compare");
  for (const [k, s] of Object.entries(m.scenarios)) {
    const o = document.createElement("option"); o.value = k; o.textContent = s.label;
    o.disabled = !S.ui.enabled(k); cmp.appendChild(o);
  }
  cmp.addEventListener("change", () => setCompare(cmp.value));
  const syncPhone = () => { cmp.disabled = phone.matches; if (phone.matches && S.compare) { cmp.value = ""; setCompare(""); } };
  phone.addEventListener("change", syncPhone); syncPhone();

  const token = (window.DASHBOARD_CONFIG || {}).mapboxToken;
  const kind = tokenKind(token);
  S.token = kind === "public" ? token : null;           // a secret token never goes further than this line
  if (kind === "secret") notice("token", "Secret tokens are refused: plain background");
  else if (kind === "none") notice("token", "No Mapbox token: plain background");
  const bm = $("basemap");
  const opts = S.token ? [["outdoors", "Mapbox outdoors"], ["satellite", "Mapbox satellite"], ["plain", "Plain"]] : [["plain", "Plain"]];
  for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; bm.appendChild(o); }
  bm.disabled = opts.length === 1;
  bm.addEventListener("change", () => rebuildMaps());

  const layers = document.createElement("div");
  layers.className = "panel";
  $("layers").appendChild(layers);
  const items = [["flood", "Flood depth (hourly image)"], ["river", "Rivers"], ["orders", "Orders (ring around homes)"],
    ...(S.studyArea ? [["study", "Study area"]] : []), ["roads", "Road traffic"], ["closed", "Closed roads"],
    ["occupancy", "Road occupancy (instead of speed)"], ["roadWater", "Water depth on roads"], ["homes", "Homes"]];
  for (const [k, t] of items) {
    const l = document.createElement("label");
    l.innerHTML = `<input type="checkbox" ${S.show[k] ? "checked" : ""}> ${t}`;
    l.querySelector("input").addEventListener("change", (e) => {
      S.show[k] = e.target.checked; if (k === "occupancy") buildLegend(); applyVisibility(); schedule(); });
    layers.appendChild(l);
  }
  const key = document.createElement("div");
  key.id = "tickkey";
  key.innerHTML = `<span><i class="t-order"></i>orders</span><span><i class="t-close"></i>road closures (first; 25, 50, 75, 100% of peak)</span><span><i class="t-real"></i>real 2025 alerts (reference)</span>`;
  $("ticks").after(key);
  buildLegend();
}

// Verification runs (population x10, not a policy) are named apart from the light-traffic statement.
// A run checked against the CTM report quotes the export's check value (every CTM step), not traffic.max_vehicles
// (per-minute totals rounded to 4 decimals of persons).
function stressNote(m) {
  const v = Object.entries(m.traffic.max_vehicles).filter(([k]) => m.scenarios[k] && m.scenarios[k].verification);
  return v.map(([k, x]) => {
    const pk = m.checks && m.checks[k] && m.checks[k].peak_vs_ctm_report;
    const n = pk ? pk.export.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
      : Math.round(x.max_vehicles).toLocaleString("en-US");
    return `; the verification run ${esc(m.scenarios[k].label)} peaks at ${n} vehicles${pk ? " (as in the CTM verification report)" : ""}`;
  }).join("");
}

function buildLegend() {
  const m = S.manifest, fl = S.flood;
  const grad = (cols) => `linear-gradient(to right, ${cols.join(", ")})`;
  const states = m.states.order.map((s) => `<li><i class="dot" style="background:${esc(m.states.colors[s])}"></i>${esc(m.states.labels[s])}</li>`).join("");
  const maxDepth = (fl.colors.length - 1) * fl.depth_step_m;
  const open = $("legend").querySelector("details");
  const isOpen = open ? open.open : !phone.matches;
  const mv = Object.entries(m.traffic.max_vehicles).filter(([k]) => m.scenarios[k] && !m.scenarios[k].verification)
    .reduce((a, [k, v]) => (!a || v.max_vehicles > a.v.max_vehicles ? { k, v } : a), null);
  const light = mv ? `<p class="lg-note">Roads with under ${MIN_VEHICLES} expected vehicle are drawn as no or negligible traffic; full closure by water shows as closed roads; partial slowing appears only in the water layer. Traffic stayed light: at most ${Math.round(mv.v.max_vehicles)} vehicles were on the road network at once (${esc(m.scenarios[mv.k].label)}, ${esc(fmtCdt(cdtMs(mv.v.at_cdt)))}), against a jam storage of ${Math.round(m.traffic.jam_storage_veh).toLocaleString("en-US")} vehicles${stressNote(m)}.</p>` : "";
  const road = S.show.occupancy
    ? `<div class="lg-row"><b>Road occupancy</b> (vehicles / jam storage)
      <div class="bar" style="background:${grad(TRAFFIC)}"></div><div class="ends"><span>low</span><span>jammed</span></div></div>`
    : `<div class="lg-row"><b>Traffic speed vs free flow (Google-style)</b>
      <ul class="speeds">${SPEED.map((c, i) => `<li><i class="ln" style="background:${c}"></i>${SPEED_LABELS[i]}</li>`).join("")}</ul></div>`;
  const forced = [S.key, S.compare].filter((k, i, a) => trafficOnly(k) && a.indexOf(k) === i).map((k) =>
    `<p class="lg-note"><b>${esc(m.scenarios[k].label)}</b>: forced demand, no behavior or harm model. Homes are at home until their vehicles enter the queue (${esc(forcedWindow(k))}), then left by car; life loss is not modelled.</p>`).join("");
  $("legend").innerHTML = `<details ${isOpen ? "open" : ""}><summary>Legend</summary>
    ${road}${light}
    <div class="lg-row"><i class="ln" style="background:rgb(154,152,144)"></i>${S.show.occupancy ? "no vehicles" : "no or negligible traffic"}</div>
    <div class="lg-row"><i class="ln closed" style="background:${CLOSED};height:${CLOSED_W}px"></i><span class="mark" style="font-size:${MARK_PX - 6}px">${CLOSED_MARK}</span>Closed by water (≥ ${m.closure_m.toFixed(2)} m)<span class="lg-sub"> · markers on closed roads from zoom ${MARKER_ZOOM} (thinned where they would overlap)</span></div>
    <div class="lg-row"><b>Flood depth</b> (HEC-RAS water surface minus 1 m terrain, hourly; same steps for the "water on roads" layer)
      <div class="bar" style="background:${esc(grad(fl.colors))}"></div><div class="ends"><span>0 m</span><span>${maxDepth.toFixed(0)}+ m</span></div></div>
    ${S.studyArea ? `<div class="lg-row"><i class="sa" style="background:${STUDY_LINE}"></i>Study area (HEC-RAS flood model extent)</div>` : ""}
    <div class="lg-row"><i class="dot" style="background:transparent;border:2px solid ${esc(S.key ? m.scenarios[S.key].color : "#444")}"></i>Ring: an order has reached this home (colour = strategy; instruction in the inspector)</div>
    <div class="lg-row"><b>Homes</b> (one dot per NSI building): colour = most people's state; size = population; black ring = some expected life loss (wider = larger share); thin white outline = none
      <ul class="states">${states}</ul>${forced}</div></details>`;
}
// "22:00-22:30 CDT, Jul 3" from a traffic-only run's totals (forced.depart_cdt, forced.depart_min).
function forcedWindow(k) {
  const fo = S.totals[k] && S.totals[k].forced;
  if (!fo) return "the departure window";
  const t0 = cdtMs(fo.depart_cdt), t1 = t0 + fo.depart_min * 60000;
  const hm = (ms) => fmtCdt(ms).replace(/ CDT$/, "").split(" ").pop();
  return `${hm(t0)}-${hm(t1)} CDT, ${fmtCdt(t0).split(" ").slice(0, 2).join(" ")}`;
}

function applyVisibility() {
  for (const m of Object.values(S.maps)) {
    if (!m) continue;
    const vis = (id, on) => m.map.getLayer(id) && m.map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    vis("flood", S.show.flood); vis("river", S.show.river);
    for (const id of ["study-area-halo", "study-area"]) vis(id, S.show.study);
  }
}

// ---- maps ----
async function makeMap(container) {
  const style = $("basemap").value || "plain";
  let m;
  try {
    m = await createMap(container, { token: style === "plain" ? null : S.token, style, bounds: S.bounds });
  } catch (e) {
    notice("mapbox", `Mapbox failed (${e.message}): plain background`);
    $("basemap").value = "plain";
    m = await createMap(container, { token: null, style: "plain", bounds: S.bounds });
  }
  addStaticLayers(m, { river: S.river, flood: S.flood, studyArea: S.studyArea });
  m.map.on("click", (e) => onClick(m, e));
  m.map.on("mousemove", (e) => {
    const hit = m.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4, layerIds: PICK_LAYERS });
    m.map.getCanvas().style.cursor = hit ? "pointer" : "";
  });
  // closure markers fade in from zoom 13 and are thinned on the screen: redraw the overlay when the zoom changes while
  // they show or their opacity changes (thinning does not change on a pan)
  m.map.on("zoom", () => { const a = markerAlpha(m.map.getZoom()); if (a > 0 || a !== m.alpha) scheduleMaps(); });
  const label = document.createElement("div");
  label.className = "maplabel";
  container.appendChild(label);
  m.label = label;
  return m;
}
async function buildMaps() {
  S.maps.A = await makeMap($("mapA"));
  applyVisibility();
}
function linkMaps() {
  const { A, B } = S.maps;
  if (!A || !B) return;
  let busy = false;
  const follow = (src, dst) => () => {
    if (busy) return;
    busy = true;
    dst.map.jumpTo({ center: src.map.getCenter(), zoom: src.map.getZoom(), bearing: src.map.getBearing(), pitch: src.map.getPitch() });
    busy = false;
  };
  A.sync = follow(A, B); B.sync = follow(B, A);
  A.map.on("move", A.sync); B.map.on("move", B.sync);
  B.map.jumpTo({ center: A.map.getCenter(), zoom: A.map.getZoom() });
}
function unlinkMaps() {
  for (const m of [S.maps.A, S.maps.B]) if (m && m.sync) { m.map.off("move", m.sync); m.sync = null; }
}
function dropMap(m) {
  if (!m) return;
  if (m.label) m.label.remove();
  m.map.remove();
}
async function rebuildMaps() {
  const cam = S.maps.A ? { center: S.maps.A.map.getCenter(), zoom: S.maps.A.map.getZoom() } : null;
  unlinkMaps(); dropMap(S.maps.A); dropMap(S.maps.B); S.maps = {};
  notice("mapbox", null);
  S.maps.A = await makeMap($("mapA"));
  if (cam) S.maps.A.map.jumpTo(cam);
  if (S.compare) { S.maps.B = await makeMap($("mapB")); linkMaps(); }
  applyVisibility(); schedule();
}
async function setCompare(k) {
  unlinkMaps();
  if (S.maps.B) { dropMap(S.maps.B); S.maps.B = null; }
  S.compare = "";
  if (k && !(await ensureScenario(k))) { $("compare").value = ""; k = ""; }
  S.compare = k;
  $("mapB").hidden = !k;
  document.body.classList.toggle("comparing", !!k);
  S.maps.A.map.resize();
  if (k) { S.maps.B = await makeMap($("mapB")); linkMaps(); applyVisibility(); }
  buildLegend();
  schedule();
}

// ---- scenario data ----
const pending = {};
function ensureScenario(k) {
  if (S.data[k]) return Promise.resolve(S.data[k]);
  if (!pending[k]) {
    const s = S.manifest.scenarios[k];
    pending[k] = Promise.all([fetchU8(`data/${s.files.roads.file}`), fetchU8(`data/${s.files.homes.file}`)])
      .then(([roads, homes]) => {
        if (!S.totals[k]) throw new Error("totals missing");
        S.data[k] = { roads, homes, totals: S.totals[k], gf: new Map(),
          orders: pointOrders(S.points, S.homes.area, S.totals[k].orders, k === "alerts") };
        return S.data[k];
      })
      .catch((e) => { S.ui.disable(k, `Unavailable: ${e.message}`); notice(`fail-${k}`, `${s.label}: ${e.message}`); delete pending[k]; return null; });
  }
  return pending[k];
}
// The starting scenario, resolved once: the requested one if enabled, else policy if enabled, else the first enabled.
function resolveScenario(want) {
  const keys = Object.keys(S.manifest.scenarios);
  if (want && keys.includes(want) && S.ui.enabled(want)) return want;
  if (S.ui.enabled("policy")) return "policy";
  return keys.find((k) => S.ui.enabled(k));
}
const scaledPeople = (k) => { const s = S.manifest.scenarios[k].pop_scale || 1;
  return new Map(Array.from(S.peopleByArea, ([z, p]) => [z, p * s])); };
async function pickScenario(k, initial = false) {
  if (!k) return;
  const d = await ensureScenario(k);
  if (!d) {
    if (initial) { const alt = Object.keys(S.manifest.scenarios).find((x) => x !== k && S.ui.enabled(x)); if (alt) return pickScenario(alt, true); }
    return;
  }
  S.key = k;
  S.ui.setActive(k);
  const color = S.manifest.scenarios[k].color;
  document.documentElement.style.setProperty("--scenario", color);
  drawTicks($("ticks"), S.manifest, orderGroups(d.totals.orders, scaledPeople(k), k === "alerts"), color, S.closureTicks, k === "alerts");
  buildLegend();
  schedule();
}

// ---- frame rendering ----
// Charts redraw their static parts by themselves when their size or data change.
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  const run = () => { if (!queued) return; queued = false; render(); };
  requestAnimationFrame(run);
  setTimeout(run, 100);                     // rAF does not fire in a hidden tab; the page still updates
}
// Only the map overlays (closure markers on zoom or pan); the side charts and inspector are left alone.
let mapsQueued = false;
function scheduleMaps() {
  if (mapsQueued) return;
  mapsQueued = true;
  const run = () => {
    if (!mapsQueued) return;
    mapsQueued = false;
    if (!S.key || !S.tl) return;
    const ms = S.frames[S.f];
    renderMap(S.maps.A, S.key, S.f, ms);
    if (S.compare) renderMap(S.maps.B, S.compare, S.f, ms);
  };
  requestAnimationFrame(run);
  setTimeout(run, 100);                     // as schedule(): rAF does not fire in a hidden tab
}
function gfFor(k, f) {
  const d = S.data[k];
  if (!d.gf.has(f)) {
    if (d.gf.size > 8) d.gf.delete(d.gf.keys().next().value);
    d.gf.set(f, groupFrame(S.groups, d.roads, S.manifest.scenarios[k].files.roads.shape, S.closed, S.manifest.files.closed.shape, f,
      { water: S.water, ms: S.frames[f], closure: S.manifest.closure_m, rampStart: S.manifest.ramp_start_m }));
  }
  return d.gf.get(f);
}
function renderMap(m, k, f, ms) {
  if (!m || !S.data[k]) return;
  const d = S.data[k], sc = S.manifest.scenarios[k];
  const fr = setFlood(m, S.flood, ms);
  const zoom = m.map.getZoom();
  m.alpha = markerAlpha(zoom);
  // closure markers at least 1.2 marker sizes apart on the screen (no overlaps)
  const thin = (idx) => {
    const xy = idx.map((i) => { const p = m.map.project(S.groups[i].mid); return [p.x, p.y]; });
    return thinGrid(xy, 1.2 * MARK_PX).map((j) => idx[j]);
  };
  m.overlay.setProps({ layers: deckLayers({ key: k, f, ms, zoom, thin, groups: S.groups, gf: gfFor(k, f), homes: S.homes,
    points: S.points, homesU8: d.homes, nStates: S.order.length, deadIdx: S.deadIdx, stateColors: S.stateRgb,
    water: S.water, show: S.show, orders: d.orders, orderColor: hex2rgb(sc.color) }) });
  m.label.innerHTML = `<i class="sw" style="background:${esc(sc.color)}"></i>${esc(sc.label)}`;
  return fr;
}
function render() {
  if (!S.key || !S.tl) return;
  const f = S.f, ms = S.frames[f];
  const fr = renderMap(S.maps.A, S.key, f, ms);
  if (S.compare) renderMap(S.maps.B, S.compare, f, ms);
  $("clock").innerHTML = `<b>${fmtCdt(ms)}</b><small>Flood image: ${fmtCdt(cdtMs(fr.cdt)).replace(" CDT", "")}</small>`;
  const loaded = {};
  // a verification run (population x10) joins the life-loss comparison only while it is shown: its scale would
  // flatten the policy scenarios' lines; a traffic-only run has no life loss and is never in it
  const shown = (k) => !trafficOnly(k) && (!S.manifest.scenarios[k].verification || k === S.key || k === S.compare);
  for (const k of Object.keys(S.manifest.scenarios)) if (S.totals[k] && shown(k)) loaded[k] = S.totals[k];
  drawStates($("states"), S.data[S.key].totals, f, S.manifest.states.colors, S.frames, trafficOnly(S.key));
  drawDeaths($("deaths"), loaded, f, S.manifest, S.frames);
  drawGauge($("gauge"), S.gauge, ms, S.frames);
  const caps = document.querySelectorAll("#side figure figcaption");
  caps[0].textContent = `People by state: ${S.manifest.scenarios[S.key].label}`;
  const none = [S.key, S.compare].filter((k, i, a) => trafficOnly(k) && a.indexOf(k) === i)
    .map((k) => `${S.manifest.scenarios[k].label}: not modelled (traffic only)`);
  caps[1].textContent = ["Expected life loss so far", ...none].join(" · ");
  refreshInspector();
  notice("load", null);                     // "Loading data…" stays up until the first frame is drawn
}

// ---- inspector ----
const PICK_LAYERS = ["homes", "closedMarks", "closedRoads", "roads"];
function onClick(m, e) {
  const k = m === S.maps.B ? S.compare : S.key;
  const hit = m.overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 4, layerIds: PICK_LAYERS });
  if (hit && hit.layer.id === "homes") S.selection = { kind: "home", o: hit.object, k };
  else if (hit && hit.layer.id === "roads") S.selection = { kind: "road", gi: hit.index, k };
  else if (hit && (hit.layer.id === "closedRoads" || hit.layer.id === "closedMarks")) S.selection = { kind: "road", gi: hit.object, k };
  else S.selection = null;
  refreshInspector();
}
const pct = (x) => `${(100 * x).toFixed(1)}%`;
function refreshInspector() {
  const sel = S.selection, elm = $("inspector");
  if (!sel || !S.data[sel.k]) { showInspector(elm, null); return; }
  const f = S.f, ms = S.frames[f], d = S.data[sel.k], m = S.manifest, label = m.scenarios[sel.k].label;
  const nO = S.homes.pop.length, nS = S.order.length, scale = m.scenarios[sel.k].pop_scale || 1;
  // a traffic-only run has two states (at home, left by car) and no life loss
  const tOnly = trafficOnly(sel.k);
  const stateRows = (vals, fmt) => S.order.map((s, j) => [s, j]).filter(([s]) => !tOnly || s === "at_home" || s === "left_by_car")
    .map(([s, j]) => [m.states.labels[s], fmt(vals[j])]).concat(tOnly ? [["Life loss", "not modelled (traffic only)"]] : []);
  const scaleNote = scale === 1 ? "" : tOnly
    ? ` Verification run, traffic only (forced departure, no behavior or harm model): population ×${scale}.`
    : ` Verification run: population ×${scale}.`;
  if (sel.kind === "road") {
    const gr = S.groups[sel.gi], rowBytes = m.files.closed.shape[1], nC = m.counts.cells;
    const sp = { water: S.water, ms, closure: m.closure_m, rampStart: m.ramp_start_m };
    const cs = gr.cells.map((c, i) => cellSpeed(gr, i, d.roads[f * nC + c], sp));
    const shut = gr.cells.some((c) => bitAt(S.closed, rowBytes, f, c));
    let j = 0;
    gr.cells.forEach((c, i) => { if (d.roads[f * nC + c] > d.roads[f * nC + gr.cells[j]]) j = i; });
    const veh = d.roads[f * nC + gr.cells[j]] / 255 * gr.N[j], tc = trafficClass(veh, cs[j].ratio);
    const shown = shut ? `closed by water (red line; ${CLOSED_MARK} from zoom ${MARKER_ZOOM})`
      : tc < 0 ? `no or negligible traffic (≈ ${veh.toFixed(2)} veh, under ${MIN_VEHICLES})`
      : `${SPEED_LABELS[tc]} (cell ${gr.cells[j]})`;
    showInspector(elm, { title: gr.cells.length > 1 ? "Road (two-way: two cells)" : "Road cell",
      rows: [["Scenario", label], ["Time", fmtCdt(ms)], ["Water depth", `≈ ${cs[0].depth.toFixed(2)} m (±0.01 m)`],
        ["Closure depth", `${m.closure_m.toFixed(2)} m`], ["Drawn as", shown]],
      table: { head: ["Cell", "Closed", "Occupancy", "s", "sf", "v/vf"], rows: gr.cells.map((c, i) => [
        `cell ${c}`, bitAt(S.closed, rowBytes, f, c) ? "yes" : "no",
        `≈ ${(d.roads[f * nC + c] / 255 * gr.N[i]).toFixed(1)} of ${gr.N[i].toFixed(1)} veh`,
        `≈ ${cs[i].s.toFixed(3)}`, `≈ ${cs[i].sf.toFixed(2)}`, `≈ ${round2(cs[i].ratio).toFixed(2)}`]) },
      note: "s = vehicles / jam storage (decoded in 1/255 steps); sf = water speed factor from the road depth, which is "
        + "interpolated linearly between hourly rows like the closed state but decoded in 2 cm steps (closed uses the exact depth); "
        + "v/vf = min(sf, sf·kc/s, wr·(1−s)/s), the CTM speed relative to free flow (kc, wr per cell in roads.geojson). "
        + "Exact totals are in the charts." });
  } else if (sel.kind === "home") {
    const g0 = sel.o, H = S.homes, o0 = g0.rows[0];
    const g = { ...g0, pop: g0.pop * scale }, Hpop = scale === 1 ? H.pop : H.pop.map((x) => x * scale);
    const ppl = pointPersons(d.homes, nS, nO, f, g.rows, Hpop);
    const segName = (o) => (H.segments && H.segment ? H.segments[H.segment[o]] : "").replace(/_/g, " ");
    const door = !H.door_lon ? [] : H.door_lon[o0] === null ? [["Doorstep road cell", "no road connection in the model (fallback cell)"]]
      : [["Doorstep road cell", `${H.door_lat[o0].toFixed(5)}, ${H.door_lon[o0].toFixed(5)}`]];
    const od = d.orders[S.points.indexOf(g0)];
    const orderRow = [["Order", od ? `${orderLabel(od.instr, sel.k === "alerts")} at ${fmtCdt(od.ms)}${od.ms > ms ? " (not yet)" : ""}` : "none in this run"]];
    showInspector(elm, { title: g.rows.length > 1 ? `Home (NSI building, ${g.rows.length} origins)` : "Home (NSI building)",
      rows: [["Scenario", label], ["Time", fmtCdt(ms)],
        ["Population", `${g.pop.toFixed(3)} persons`], ...orderRow,
        ["Building", `${g.lat.toFixed(5)}, ${g.lon.toFixed(5)}`], ...door,
        ...stateRows(ppl, (x) => `≈ ${x.toFixed(2)} (${pct(g.pop > 0 ? x / g.pop : 0)})`)],
      table: { head: ["Origin", "Group", "Persons", "Most people"], rows: g.rows.map((o) => [
        `origin ${o}`, segName(o), Hpop[o].toFixed(3), m.states.labels[S.order[majorityState(d.homes, nS, f, o, nO)]]]) },
      note: "Persons by state ≈ share × population summed over the building's origins (shares in 1/255 steps)." + scaleNote });
  }
}

// ---- record mode: the title card covers the data load; once the scenario that will play is known (S.key, after
// any fallback) the card names it for 3 s, then the timeline plays once ----
function showTitleCard() {
  const card = document.createElement("div");
  card.id = "titlecard";
  card.innerHTML = `<h2>July 4, 2025 flood, Kerr County</h2><p id="titlescenario">Loading…</p><p class="small">${esc(S.manifest.caption)}</p>`;
  document.body.appendChild(card);
}
function startRecording() {
  if (!S.key) { $("titlescenario").textContent = "No scenario data could be loaded."; return; }
  const sc = S.manifest.scenarios[S.key];
  $("titlescenario").innerHTML = `How the evacuation model sees it: <b style="color:${esc(sc.color)}">${esc(sc.label)}</b>`;
  setTimeout(() => { const c = $("titlecard"); if (c) c.remove(); S.tl.play(); }, 3000);
}

main().catch((e) => { console.error(e); notice("fatal", `Could not start: ${e.message}`); });
