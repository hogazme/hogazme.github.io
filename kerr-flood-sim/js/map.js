// Map layers: Mapbox GL (public token) or MapLibre (plain background) basemap, flood images, river and the study area
// (map style layers), and the deck.gl roads, road water and homes layers drawn through a MapboxOverlay.
import { tokenKind, waterAt, bitAt, frameView, cdtMs, speedFactor, speedRatio, trafficClass, pointPersons, argmax,
  pathMidpoint, markerAlpha } from "./data.js";

const MAPBOX_JS = "https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.js";
const MAPBOX_CSS = "https://api.mapbox.com/mapbox-gl-js/v3.0.1/mapbox-gl.css";
const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
const MAPBOX_STYLES = { outdoors: "mapbox://styles/mapbox/outdoors-v12", satellite: "mapbox://styles/mapbox/satellite-streets-v12" };

export const TRAFFIC = ["#ece7f6", "#c3b2e4", "#9a7fd0", "#6f4eb0", "#45297f"];       // occupancy ramp (layer option)
// Speed vs free flow (Google-style), by speedClass: >= 0.75, 0.50-0.75, 0.25-0.50, < 0.25.
export const SPEED = ["#1e9e5a", "#f2a33a", "#d7301f", "#7f0000"];
export const SPEED_LABELS = ["75% of free flow or faster", "50-75%", "25-50%", "under 25%"];
export const TRAFFIC_W = 3;
// Closed by water: solid Google-Maps-like red at 1.5 times the traffic width, with a road-closure marker (U+1F6A7) at
// the middle of each closed road from zoom 13 (user choice 2026-10-18). Its hue is close to the 25-50% traffic class.
export const CLOSED = "#e53935";
export const CLOSED_W = 1.5 * TRAFFIC_W;
export const CLOSED_MARK = "\u{1F6A7}";
export const MARK_PX = 20;
export const EMPTY_ROAD = [154, 152, 144, 90];
export const INK = "#0b0b0b";
// Study area (HEC-RAS 2D flow area): a dark line on a light halo, so it reads on light and satellite basemaps.
export const STUDY_LINE = "#24211e";
const NO_DEAD_RING = [255, 255, 255, 220];

export function hex2rgb(h) {
  const x = h.replace("#", "");
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
export function ramp(colors, t) {
  const c = colors.map(hex2rgb);
  const x = Math.min(Math.max(t, 0), 1) * (c.length - 1);
  const i = Math.min(Math.floor(x), c.length - 2);
  const w = x - i;
  return c[i].map((v, k) => Math.round((1 - w) * v + w * c[i + 1][k]));
}

const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src; s.async = true;
    s.onload = () => res();
    s.onerror = () => { loaded.delete(src); rej(new Error(`could not load ${src}`)); };
    document.head.appendChild(s);
  }));
  return loaded.get(src);
}
export function loadCss(href) {
  if (!loaded.has(href)) loaded.set(href, new Promise((res, rej) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    l.onload = () => res();
    l.onerror = () => { loaded.delete(href); rej(new Error(`could not load ${href}`)); };
    document.head.appendChild(l);
  }));
  return loaded.get(href);
}

// Bounds [[w, s], [e, n]] of a GeoJSON FeatureCollection of LineStrings.
export function geoBounds(fc) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const f of fc.features) for (const [x, y] of f.geometry.coordinates) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [[w, s], [e, n]];
}

// token public -> Mapbox GL (style "outdoors" or "satellite"); anything else -> MapLibre with a plain background.
// A secret token is never handed to a library. `bounds` ([[w,s],[e,n]], from roads.geojson) sets the initial view.
export async function createMap(container, { token, style = "outdoors", bounds } = {}) {
  const usePublic = tokenKind(token) === "public" && style !== "plain";
  let lib, kind, mapStyle;
  if (usePublic) {
    await Promise.all([loadScript(MAPBOX_JS), loadCss(MAPBOX_CSS)]);
    lib = window.mapboxgl; kind = "mapbox";
    if (!lib) throw new Error("Mapbox GL did not initialise");
    lib.accessToken = token;
    mapStyle = MAPBOX_STYLES[style] || MAPBOX_STYLES.outdoors;
  } else {
    await Promise.all([loadScript(MAPLIBRE_JS), loadCss(MAPLIBRE_CSS)]);
    lib = window.maplibregl; kind = "maplibre";
    if (!lib) throw new Error("MapLibre GL did not initialise");
    mapStyle = { version: 8, sources: {},
      layers: [{ id: "background", type: "background", paint: { "background-color": "#f4f3ef" } }] };
  }
  const opts = { container, style: mapStyle, attributionControl: true, dragRotate: false, pitchWithRotate: false };
  if (bounds) { opts.bounds = bounds; opts.fitBoundsOptions = { padding: 24 }; }
  const map = new lib.Map(opts);
  map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
  await new Promise((res, rej) => {
    map.once("load", res);
    map.once("error", (e) => { if (!map.loaded()) rej(new Error(e && e.error ? e.error.message : "map failed to load")); });
  });
  // Interleaved: deck layers are drawn inside the map's layer stack, below the anchor layer (beforeId).
  const overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay);
  return { map, kind, overlay };
}

export const ANCHOR = "overlay-anchor";

export function addStaticLayers(m, { river, flood, studyArea }) {
  const { map } = m;
  map.addSource("flood", { type: "image", url: `data/${flood.frames[0].file}`, coordinates: flood.corners });
  map.addLayer({ id: "flood", type: "raster", source: "flood", paint: { "raster-opacity": 0.8, "raster-fade-duration": 0 } });
  map.addSource("river", { type: "geojson", data: river });
  map.addLayer({ id: "river", type: "line", source: "river", paint: { "line-color": "#7fa7c9", "line-width": 1 } });
  // Study area outline, no fill; below the deck layers (roads, homes), which are drawn just below the anchor layer.
  if (studyArea) {
    map.addSource("study-area", { type: "geojson", data: studyArea });
    map.addLayer({ id: "study-area-halo", type: "line", source: "study-area", layout: { "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": 0.75, "line-width": 7 } });
    map.addLayer({ id: "study-area", type: "line", source: "study-area", layout: { "line-join": "round" },
      paint: { "line-color": STUDY_LINE, "line-width": 3.5 } });
  }
  map.addSource(ANCHOR, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({ id: ANCHOR, type: "circle", source: ANCHOR });   // empty: deck layers are drawn just below it
  m.flood = flood; m.floodFile = flood.frames[0].file;
}

// The hourly flood image nearest ms (no interpolation). Returns that image's frame entry.
export function nearestFlood(flood, ms) {
  let best = flood.frames[0], bd = Infinity;
  for (const fr of flood.frames) { const d = Math.abs(cdtMs(fr.cdt) - ms); if (d < bd) { bd = d; best = fr; } }
  return best;
}
export function setFlood(m, flood, ms) {
  const fr = nearestFlood(flood, ms);
  if (fr.file !== m.floodFile) {
    m.map.getSource("flood").updateImage({ url: `data/${fr.file}`, coordinates: flood.corners });
    m.floodFile = fr.file;
  }
  return fr;
}

// One path per road group (twin cells of a two-way road share a line): the first feature's geometry, every cell, and
// the point at half the path's length (the closure marker's position, shared by twins).
export function roadGroups(roads) {
  const byG = new Map();
  for (const f of roads.features) {
    const g = f.properties.g;
    if (!byG.has(g)) byG.set(g, { g, path: f.geometry.coordinates, mid: pathMidpoint(f.geometry.coordinates), cells: [], N: [], kc: [], wr: [] });
    const d = byG.get(g);
    d.cells.push(f.properties.c); d.N.push(f.properties.N); d.kc.push(f.properties.kc); d.wr.push(f.properties.wr);
  }
  return Array.from(byG.values());
}

// Per group at frame f: larger occupancy (uint8) of its cells, its expected vehicles (u8 / 255 x N), closed if any
// cell is closed (exact bit), and the speed ratio v / vf of the larger-occupancy cell (its kc, wr and the water speed
// factor at time ms); closed: the indices of the closed groups. speed: {water, ms, closure, rampStart} or null.
export function groupFrame(groups, roadsU8, roadsShape, closed, closedShape, f, speed = null) {
  const occ = new Uint8Array(groups.length), shut = new Uint8Array(groups.length), ratio = new Float32Array(groups.length);
  const veh = new Float32Array(groups.length);
  const row = frameView(roadsU8, roadsShape, f);
  const rowBytes = closedShape[1];
  const closedList = [];
  for (let i = 0; i < groups.length; i++) {
    const gr = groups[i];
    let o = 0, s = 0, j = 0;
    gr.cells.forEach((c, k) => { if (row[c] > o) { o = row[c]; j = k; } if (bitAt(closed, rowBytes, f, c)) s = 1; });
    occ[i] = o; shut[i] = s; veh[i] = o / 255 * gr.N[j];
    if (s) closedList.push(i);
    if (speed) ratio[i] = cellSpeed(gr, j, o, speed).ratio;
  }
  return { occ, shut, ratio, veh, closed: closedList };
}
// Speed of cell k of a group with occupancy u8 at time speed.ms: {s, depth, sf, ratio}.
export function cellSpeed(gr, k, u8, speed) {
  const w = speed.water;
  const depth = waterAt(w.u8, w.nCells, w.rowsMs, speed.ms, gr.cells[k], w.step);
  const sf = speedFactor(depth, speed.closure, speed.rampStart);
  const s = u8 / 255;
  return { s, depth, sf, ratio: speedRatio(s, sf, gr.kc[k], gr.wr[k]) };
}

// The closure marker drawn once onto a canvas (colour emoji fonts; map text glyphs are monochrome) and used as the
// IconLayer's atlas.
let markAtlas = null;
export function closureIcon() {
  if (!markAtlas) {
    const px = 64, c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.font = `${Math.round(px * 0.8)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(CLOSED_MARK, px / 2, px / 2 + px * 0.04);
    markAtlas = { url: c.toDataURL("image/png"), mapping: { mark: { x: 0, y: 0, width: px, height: px, mask: false } } };
  }
  return markAtlas;
}

const CLOSED_RGB = hex2rgb(CLOSED);
const SPEED_RGB = SPEED.map(hex2rgb);
// state: {key, f, ms, zoom, groups, gf: groupFrame(...), homes, points: pointGroups(homes), homesU8, nStates, deadIdx,
//         stateColors (rgb by index), water: {u8, nCells, rowsMs, colors, step} | null,
//         show: {roads, closed, occupancy, roadWater, homes}, emptyRoad: rgba of no-traffic roads (default EMPTY_ROAD)}
export function deckLayers(state) {
  const { key, f, ms, zoom = 0, groups, gf, homes, points, homesU8, nStates, deadIdx, stateColors, show = {} } = state;
  const occMode = !!show.occupancy;
  const cls = (i) => trafficClass(gf.veh[i], gf.ratio[i]);
  const empty = state.emptyRoad || EMPTY_ROAD;                  // roads with no or negligible traffic (rgba)
  const layers = [];
  // Closed groups are drawn by the closed-roads layer; underneath, the traffic layer shows them as thin grey.
  layers.push(new deck.PathLayer({
    id: "roads", data: groups, visible: show.roads !== false, pickable: true, beforeId: ANCHOR,
    getPath: (d) => d.path, widthUnits: "pixels", capRounded: true, jointRounded: true,
    getColor: (d, { index }) => gf.shut[index] ? empty
      : occMode ? (gf.occ[index] === 0 ? empty : [...ramp(TRAFFIC, gf.occ[index] / 255), 255])
      : (cls(index) < 0 ? empty : [...SPEED_RGB[cls(index)], 255]),
    getWidth: (d, { index }) => gf.shut[index] ? 1
      : occMode ? (gf.occ[index] === 0 ? 1 : 1.5 + 2.5 * gf.occ[index] / 255) : (cls(index) < 0 ? 1 : TRAFFIC_W),
    updateTriggers: { getColor: [key, f, occMode, empty.join(",")], getWidth: [key, f, occMode] },
  }));
  const showClosed = show.closed !== false;
  layers.push(new deck.PathLayer({
    id: "closedRoads", data: gf.closed, visible: showClosed, pickable: true, beforeId: ANCHOR,
    getPath: (i) => groups[i].path, widthUnits: "pixels", capRounded: true, jointRounded: true,
    getColor: [...CLOSED_RGB, 255], getWidth: CLOSED_W,
  }));
  if (state.water && show.roadWater) {
    const w = state.water;
    layers.push(new deck.PathLayer({
      id: "roadWater", data: groups, pickable: false, widthUnits: "pixels", beforeId: ANCHOR,
      getPath: (d) => d.path,
      getColor: (d) => {
        const depth = waterAt(w.u8, w.nCells, w.rowsMs, ms, d.cells[0], w.step);
        if (depth < 0.01) return [0, 0, 0, 0];
        return [...hex2rgb(w.colors[Math.min(Math.floor(depth / w.colorStep), w.colors.length - 1)]), 255];
      },
      getWidth: 3,
      updateTriggers: { getColor: ms },
    }));
  }
  // One marker per closed group at its path's midpoint (twins share it), from zoom 13. Overlaps are suppressed by
  // state.thin (screen-space thinning by the caller): deck.gl 9.0.0 has CollisionFilterExtension, but in the
  // interleaved MapboxOverlay used here it drew no icons at all (checked in the browser).
  const alpha = markerAlpha(zoom);
  const atlas = closureIcon();
  const marks = !showClosed || alpha <= 0 ? [] : (state.thin ? state.thin(gf.closed) : gf.closed);
  layers.push(new deck.IconLayer({
    id: "closedMarks", data: marks, visible: marks.length > 0, pickable: true, beforeId: ANCHOR,
    opacity: alpha, iconAtlas: atlas.url, iconMapping: atlas.mapping, getIcon: () => "mark",
    getPosition: (i) => groups[i].mid, sizeUnits: "pixels", getSize: MARK_PX, billboard: true,
  }));
  if (show.orders && state.orders && points) {
    const ring = state.orderColor || [0, 0, 0];
    const due = points.filter((g, i) => state.orders[i] && state.orders[i].ms <= ms);
    layers.push(new deck.ScatterplotLayer({
      id: "orders", data: due, pickable: false, beforeId: ANCHOR, filled: false, stroked: true,
      getPosition: (g) => [g.lon, g.lat], radiusUnits: "pixels", getRadius: (g) => 2 + Math.sqrt(g.pop) + 3,
      lineWidthUnits: "pixels", getLineWidth: 2, getLineColor: [...ring, 230],
      updateTriggers: { getLineColor: ring.join(",") },
    }));
  }
  if (homesU8) {
    // One dot per NSI structure point (rows of one structure, e.g. resident and mobility-limited, share it):
    // size = summed population, colour = population-weighted majority state, ring = share dead at the point.
    const nO = homes.pop.length;
    const per = new Map();
    const at = (g) => { if (!per.has(g.pt)) per.set(g.pt, pointPersons(homesU8, nStates, nO, f, g.rows, homes.pop)); return per.get(g.pt); };
    layers.push(new deck.ScatterplotLayer({
      id: "homes", data: points, visible: show.homes !== false, pickable: true, beforeId: ANCHOR,
      getPosition: (g) => [g.lon, g.lat],
      radiusUnits: "pixels", getRadius: (g) => 2 + Math.sqrt(g.pop),
      getFillColor: (g) => stateColors[argmax(at(g))],
      // Ring: ink, 1.5 + 3.5 x share dead, only where anyone died; otherwise a thin light outline.
      stroked: true, lineWidthUnits: "pixels",
      getLineColor: (g) => g.rows.some((o) => homesU8[(f * nO + o) * nStates + deadIdx] > 0) ? [...hex2rgb(INK), 255] : NO_DEAD_RING,
      getLineWidth: (g) => {
        const d = g.pop > 0 ? at(g)[deadIdx] / g.pop : 0;
        return g.rows.some((o) => homesU8[(f * nO + o) * nStates + deadIdx] > 0) ? 1.5 + 3.5 * d : 1;
      },
      updateTriggers: { getFillColor: [key, f], getLineColor: [key, f], getLineWidth: [key, f] },
    }));
  }
  return layers;
}
