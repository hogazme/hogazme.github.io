// Controls and side charts: scenario buttons, timeline, states / deaths / gauge charts, inspector, timeline ticks.
import { cdtMs, fmtCdt } from "./data.js";

const NS = "http://www.w3.org/2000/svg";
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hhmm = (ms) => fmtCdt(ms).replace(/ CDT$/, "").split(" ").pop();
const num = (x, d = 0) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// The per-minute series starts one minute after the window start (20:01); frame f (5 min apart) is entry 5f-1,
// and frame 0 (20:00) uses the first recorded minute.
export const seriesIndex = (f) => Math.max(5 * f - 1, 0);
export const atFrame = (totals, key, f) => totals.series[key][seriesIndex(f)];

export function buildScenarioButtons(manifest, onPick) {
  const box = document.getElementById("scenarios");
  box.textContent = "";
  const buttons = {};
  const add = (key, label, color) => {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.key = key; b.setAttribute("aria-pressed", "false");
    b.innerHTML = `<i class="sw" style="background:${esc(color)}"></i>${esc(label)}`;
    b.addEventListener("click", () => { if (!b.disabled) onPick(key); });
    box.appendChild(b); buttons[key] = b;
    return b;
  };
  for (const [key, s] of Object.entries(manifest.scenarios)) add(key, s.label, s.color);
  for (const h of manifest.held || []) {
    const b = add(h.key, `${h.label} (held)`, h.color);
    b.disabled = true; b.title = h.reason;
  }
  return {
    buttons,
    setActive(key) { for (const [k, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", String(k === key)); },
    disable(key, reason) { const b = buttons[key]; if (b) { b.disabled = true; b.title = reason; b.classList.add("failed"); } },
    enabled(key) { return !!buttons[key] && !buttons[key].disabled; },
  };
}

// 1x = 4 frames per second; speed from #speed. onFrame(f) after every change; tl.onEnd() when play reaches the end.
export function buildTimeline(manifest, onFrame) {
  const slider = document.getElementById("slider"), btn = document.getElementById("play");
  const speed = document.getElementById("speed"), time = document.getElementById("time");
  const n = manifest.frames.cdt.length;
  slider.max = String(n - 1);
  let f = 0, timer = null;
  const tl = {
    get f() { return f; },
    get playing() { return timer !== null; },
    onEnd: null,
    set(x) {
      f = Math.min(Math.max(Math.round(x), 0), n - 1);
      slider.value = String(f);
      time.textContent = fmtCdt(cdtMs(manifest.frames.cdt[f]));
      onFrame(f);
    },
    play() {
      if (timer) return;
      if (f >= n - 1) tl.set(0);
      btn.textContent = "❚❚"; btn.setAttribute("aria-label", "Pause");
      const tick = () => {
        if (f >= n - 1) { tl.pause(); if (tl.onEnd) tl.onEnd(); return; }
        tl.set(f + 1);
        timer = setTimeout(tick, 250 / Number(speed.value || 1));
      };
      timer = setTimeout(tick, 250 / Number(speed.value || 1));
    },
    pause() {
      if (timer) clearTimeout(timer);
      timer = null;
      btn.textContent = "▶"; btn.setAttribute("aria-label", "Play");
    },
  };
  slider.addEventListener("input", () => tl.set(Number(slider.value)));
  btn.addEventListener("click", () => (timer ? tl.pause() : tl.play()));
  return tl;
}

// ---- small SVG helpers ----
function el(tag, attrs = {}, parent = null, text = null) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function frame(svg, margin) {
  const W = svg.clientWidth || 340, H = svg.clientHeight || 150;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  return { W, H, x0: margin.l, x1: W - margin.r, y0: margin.t, y1: H - margin.b };
}
// A y range [0, ymax] split into 3 to 5 round steps (1, 2, 2.5 or 5 x 10^k).
function niceScale(v) {
  const raw = Math.max(v, 1e-9) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= raw);
  const ticks = Math.max(1, Math.ceil(v / step - 1e-9));
  return { ymax: ticks * step, ticks };
}
// Time axis (frames window) with ticks every 3 h (6 h when narrow), and a y axis with round gridlines.
function axes(g, box, t0, t1, scale, yfmt) {
  const { ymax, ticks } = scale;
  const ax = el("g", { class: "ax" }, g);
  const xs = (ms) => box.x0 + (box.x1 - box.x0) * (ms - t0) / (t1 - t0);
  for (let k = 0; k <= ticks; k++) {
    const v = ymax * k / ticks, y = box.y1 - (box.y1 - box.y0) * k / ticks;
    el("line", { x1: box.x0, x2: box.x1, y1: y, y2: y }, ax);
    el("text", { x: box.x0 - 5, y: y + 4, "text-anchor": "end" }, ax, yfmt(v));
  }
  const every = (box.x1 - box.x0) < 280 ? 21600000 : 10800000;
  const first = Math.ceil(t0 / every) * every;
  for (let ms = first; ms <= t1; ms += every) {
    el("text", { x: xs(ms), y: box.y1 + 15, "text-anchor": "middle" }, ax, hhmm(ms));
  }
  return xs;
}
function cursor(svg, box, x) {
  let c = svg.querySelector(".cursor");
  if (!c) c = el("line", { class: "cursor" }, svg);
  c.setAttribute("x1", x); c.setAttribute("x2", x); c.setAttribute("y1", box.y0 - 2); c.setAttribute("y2", box.y1);
  svg.insertBefore(c, svg.querySelector(".lg"));          // under the legend (null: on top of everything)
}

// Stacked areas of the per-minute totals sampled at frame times; legend with the values at the cursor.
export const STATE_BANDS = [
  { keys: ["at_home"], label: "At home (incl. preparing)", color: "at_home" },
  { keys: ["sheltered_in_structure"], label: "Sheltered", color: "sheltered" },
  { keys: ["walking"], label: "Walking", color: "walking" },
  { keys: ["high_ground"], label: "High ground", color: "high_ground" },
  { keys: ["queued_persons", "on_road_persons"], label: "On the road", color: "left_by_car" },
  { keys: ["arrived_persons"], label: "Arrived by car", color: "left_by_car", fill: "url(#hatch-arrived)" },
  { keys: ["deaths"], label: "Expected life loss", color: "dead" },
];
// A traffic-only run (forced demand, no behavior or harm model): at home until the vehicles enter the queue, then
// queued, on the road, arrived; no life loss.
export const QUEUED_COLOR = "#8fa3b8";
export const TRAFFIC_BANDS = [
  { keys: ["at_home"], label: "At home (not yet departed)", color: "at_home" },
  { keys: ["queued_persons"], label: "Queued at origin", color: "queued", hex: QUEUED_COLOR },
  { keys: ["on_road_persons"], label: "On the road", color: "left_by_car" },
  { keys: ["arrived_persons"], label: "Arrived by car", color: "left_by_car", fill: "url(#hatch-arrived)" },
];
export function drawStates(svg, totals, f, colors, frames, trafficOnly = false) {
  const n = frames.length;
  const bands = trafficOnly ? TRAFFIC_BANDS : STATE_BANDS;
  const box = frame(svg, { l: 46, r: 20, t: 10, b: 24 + 16 * STATE_BANDS.length + 36 });
  const sig = `${box.W}x${box.H}`;
  if (svg._totals !== totals || svg._sig !== sig) {
    svg._totals = totals; svg._sig = sig;
    svg.textContent = "";
    // "Arrived by car": hatched in the on-the-road colour, so it is told apart from the grey "At home" band.
    const pat = el("pattern", { id: "hatch-arrived", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" },
      el("defs", {}, svg));
    el("rect", { width: 6, height: 6, fill: "#e4e7ea" }, pat);
    el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: colors.left_by_car, "stroke-width": 3 }, pat);
    const vals = bands.map((b) => Array.from({ length: n }, (_, i) => b.keys.reduce((a, k) => a + atFrame(totals, k, i), 0)));
    const pop = vals.reduce((a, v) => a + v[0], 0);
    const sc = niceScale(pop), ymax = sc.ymax;
    const xs = axes(svg, box, frames[0], frames[n - 1], sc, (v) => num(v));
    const ys = (v) => box.y1 - (box.y1 - box.y0) * v / ymax;
    const base = new Array(n).fill(0);
    const paint = (b) => b.fill || b.hex || colors[b.color];
    bands.forEach((b, j) => {
      const top = base.map((v, i) => v + vals[j][i]);
      let d = "";
      for (let i = 0; i < n; i++) d += `${i ? "L" : "M"}${xs(frames[i]).toFixed(1)},${ys(top[i]).toFixed(1)}`;
      for (let i = n - 1; i >= 0; i--) d += `L${xs(frames[i]).toFixed(1)},${ys(base[i]).toFixed(1)}`;
      el("path", { d: d + "Z", fill: paint(b), class: `band-${b.color}` }, svg);
      for (let i = 0; i < n; i++) base[i] = top[i];
    });
    const lg = el("g", { class: "lg" }, svg);
    svg._vals = bands.map((b, j) => {
      const x = 4, y = box.y1 + 36 + j * 16;
      el("rect", { x, y: y - 10, width: 12, height: 12, fill: paint(b), class: `band-${b.color}` }, lg);
      el("text", { x: x + 18, y }, lg, b.label);
      return el("text", { x: box.W - 8, y, "text-anchor": "end", class: "v" }, lg, "");
    });
    const ny = box.y1 + 36 + bands.length * 16 + 2;
    const fo = totals.forced;
    const notes = trafficOnly
      ? [`Traffic only: forced departure ×${fo ? fo.factor : "?"}, no behavior or harm model.`,
         "Expected life loss: not modelled.", "The 20:00 point shows the 20:01 value."]
      : ["At home includes people preparing to leave.", "The 20:00 point shows the 20:01 value."];
    notes.forEach((t, i) => el("text", { x: 4, y: ny + 15 * i, class: "note" }, lg, t));
    svg._vals.data = vals; svg._xs = xs; svg._box = box;
  }
  svg._vals.forEach((v, j) => { v.textContent = num(svg._vals.data[j][f]); });
  cursor(svg, svg._box, svg._xs(frames[f]));
}

// One line per loaded scenario, drawn up to frame f (faint after it), value labelled at the line end.
export function drawDeaths(svg, loaded, f, manifest, frames) {
  const keys = Object.keys(loaded).filter((k) => manifest.scenarios[k]);
  const n = frames.length;
  const W = svg.clientWidth || 340;
  const items = []; let lx = 4, ly = 14;
  for (const k of keys) {
    const w = 18 + 6.8 * manifest.scenarios[k].label.length + 12;
    if (lx > 4 && lx + w > W - 4) { lx = 4; ly += 16; }
    items.push({ k, x: lx, y: ly }); lx += w;
  }
  const box = frame(svg, { l: 46, r: 54, t: ly + 12, b: 22 });
  const sig = `${box.W}x${box.H}|${keys.join(",")}`;
  if (svg._sig !== sig) {
    svg._sig = sig; svg.textContent = "";
    const key = el("g", { class: "lg" }, svg);
    for (const it of items) {
      el("line", { x1: it.x, x2: it.x + 12, y1: it.y - 4, y2: it.y - 4, stroke: manifest.scenarios[it.k].color, "stroke-width": 3 }, key);
      el("text", { x: it.x + 18, y: it.y }, key, manifest.scenarios[it.k].label);
    }
    const sc = niceScale(Math.max(1, ...keys.map((k) => Math.max(...loaded[k].series.deaths)))), ymax = sc.ymax;
    const xs = axes(svg, box, frames[0], frames[n - 1], sc, (v) => num(v));
    const ys = (v) => box.y1 - (box.y1 - box.y0) * v / ymax;
    svg._lines = keys.map((k) => {
      const v = Array.from({ length: n }, (_, i) => atFrame(loaded[k], "deaths", i));
      const pts = v.map((y, i) => `${xs(frames[i]).toFixed(1)},${ys(y).toFixed(1)}`);
      const color = manifest.scenarios[k].color;
      el("polyline", { points: pts.join(" "), fill: "none", stroke: color, "stroke-width": 1.2, "stroke-opacity": 0.25 }, svg);
      const line = el("polyline", { fill: "none", stroke: color, "stroke-width": 2 }, svg);
      const label = el("text", { class: "endlabel", fill: color }, svg);
      return { k, v, pts, line, label };
    });
    svg._xs = xs; svg._ys = ys; svg._box = box;
  }
  // Labels pushed apart upwards from the lowest, 16 px minimum spacing.
  const placed = svg._lines.map((L) => ({ L, y: svg._ys(L.v[f]) })).sort((a, b) => b.y - a.y);
  if (placed.length) placed[0].y = Math.min(placed[0].y, svg._box.y1 - 5);     // keep the lowest label above the time axis
  for (let i = 1; i < placed.length; i++) if (placed[i - 1].y - placed[i].y < 16) placed[i].y = placed[i - 1].y - 16;
  for (const { L, y } of placed) {
    L.line.setAttribute("points", L.pts.slice(0, f + 1).join(" "));
    L.label.setAttribute("x", svg._xs(frames[f]) + 4);
    L.label.setAttribute("y", y + 4);
    L.label.textContent = L.v[f].toFixed(2);
  }
  cursor(svg, svg._box, svg._xs(frames[f]));
}

// Modelled rise at the Hunt gauge cell (line) and the USGS record (dots, ends 05:10).
export function drawGauge(svg, gauge, ms, frames) {
  // Key above the plot (wraps when narrow), so neither the data nor the cursor runs under it.
  const since = (t) => fmtCdt(cdtMs(t)).replace(/ CDT$/, "");     // each series states its own reference time
  const W = svg.clientWidth || 340, names = [`Model (Hunt cell): rise since ${since(gauge.model.t[0])}`,
                                             `USGS 08165500: rise since ${since(gauge.usgs.t[0])}`];
  const items = []; let kx = 4, ky = 14;
  for (const nm of names) {
    const w = 18 + 6.8 * nm.length + 12;
    if (kx > 4 && kx + w > W - 4) { kx = 4; ky += 16; }
    items.push({ nm, x: kx, y: ky }); kx += w;
  }
  const box = frame(svg, { l: 46, r: 20, t: ky + 12, b: 22 });
  const sig = `${box.W}x${box.H}`;
  if (svg._sig !== sig) {
    svg._sig = sig; svg.textContent = "";
    const mt = gauge.model.t.map(cdtMs), ut = gauge.usgs.t.map(cdtMs);
    const sc = niceScale(Math.max(...gauge.model.rise_m, ...gauge.usgs.rise_m)), ymax = sc.ymax;
    const xs = axes(svg, box, frames[0], frames[frames.length - 1], sc, (v) => `${num(v)} m`);
    const ys = (v) => box.y1 - (box.y1 - box.y0) * v / ymax;
    for (let i = 0; i < ut.length; i++) el("circle", { cx: xs(ut[i]), cy: ys(gauge.usgs.rise_m[i]), r: 1.8, class: "usgs" }, svg);
    el("polyline", { points: mt.map((t, i) => `${xs(t)},${ys(gauge.model.rise_m[i])}`).join(" "), class: "model" }, svg);
    const last = ut.length - 1;
    el("line", { x1: xs(ut[last]), x2: xs(ut[last]), y1: ys(gauge.usgs.rise_m[last]) + 4, y2: box.y1 - 12, class: "lead" }, svg);
    el("text", { x: xs(ut[last]) + 4, y: box.y1 - 4, class: "note" }, svg, `USGS record ends ${hhmm(ut[last])}`);
    const lg = el("g", { class: "lg" }, svg);
    el("line", { x1: items[0].x, x2: items[0].x + 12, y1: items[0].y - 4, y2: items[0].y - 4, class: "model" }, lg);
    el("text", { x: items[0].x + 18, y: items[0].y }, lg, items[0].nm);
    el("circle", { cx: items[1].x + 6, cy: items[1].y - 4, r: 2.5, class: "usgs" }, lg);
    el("text", { x: items[1].x + 18, y: items[1].y }, lg, items[1].nm);
    svg._xs = xs; svg._box = box;
  }
  cursor(svg, svg._box, svg._xs(ms));
}

// info: {title, rows: [[label, value]], table: {head: [], rows: [[]]}, note}
export function showInspector(elm, info) {
  if (!info) { elm.innerHTML = "<p>Click a road, zone or home.</p>"; return; }
  let h = `<h3>${esc(info.title)}</h3>`;
  if (info.rows && info.rows.length) h += `<dl>${info.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  if (info.table) {
    h += `<table><thead><tr>${info.table.head.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead><tbody>`;
    h += info.table.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("") + "</tbody></table>";
  }
  if (info.note) h += `<p class="note">${esc(info.note)}</p>`;
  elm.innerHTML = h;
}

// Ticks under the slider: this scenario's orders (top row), first road closure per zone (middle), real 2025
// alerts as reference (bottom, outlined). extra: [{ms, title}] closure ticks computed by the caller.
export function drawTicks(elm, manifest, orders, color, extra = [], alerts = false) {
  const t0 = cdtMs(manifest.frames.cdt[0]), t1 = cdtMs(manifest.frames.cdt[manifest.frames.cdt.length - 1]);
  const pos = (ms) => `calc(8px + (100% - 16px) * ${((ms - t0) / (t1 - t0)).toFixed(5)})`;
  elm.textContent = "";
  const add = (ms, cls, title, bg) => {
    if (ms < t0 || ms > t1) return;
    const s = document.createElement("span");
    s.className = cls; s.style.left = pos(ms); s.title = title;
    if (bg) s.style.background = bg;
    elm.appendChild(s);
  };
  const byTime = new Map();
  for (const o of orders || []) {
    const t = alerts ? o.t2_cdt : o.t3_cdt;
    if (!t) continue;
    const instr = alerts ? "T2" : (o.instr >= 0.5 ? "Leave" : "Higher Ground");
    const k = `${t}|${instr}`;
    byTime.set(k, (byTime.get(k) || 0) + 1);
  }
  for (const [k, cnt] of byTime) {
    const [t, instr] = k.split("|");
    add(cdtMs(t), "t-order", `Order ${alerts ? "" : "T3 "}${instr}: ${cnt} zone${cnt > 1 ? "s" : ""} at ${hhmm(cdtMs(t))}`, color);
  }
  for (const e of extra) add(e.ms, "t-close", e.title);
  const ra = manifest.real_alerts_cdt || {};
  if (ra.ffw) add(cdtMs(ra.ffw), "t-real", `Real 2025 Flash Flood Warning ${hhmm(cdtMs(ra.ffw))} (reference only)`);
  for (const t of ra.ffe || []) add(cdtMs(t), "t-real", `Real 2025 Flash Flood Emergency ${hhmm(cdtMs(t))} (reference only)`);
}
