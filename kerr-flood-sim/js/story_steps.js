// The story's steps, in page order. Each sets the whole map state (spec section 6.2).
export const STRATEGIES = ["none", "gauge", "plan", "policy", "oracle"];
// Runs that are not strategies, loaded after them (phase 2): the forced-departure traffic test (roads and totals only).
export const EXTRAS = ["forced10"];
const D = (h) => (h >= 20 ? `2025-07-03T${h}:00` : `2025-07-04T${String(h).padStart(2, "0")}:00`);
const BASE = { study: true, homes: true };
// Cameras: "study" fits the study area; "homes" the people-weighted 5-95% box of the homes; "traffic" the
// vehicle-weighted 10-90% box of the busy roads of the step's run at its peak frame, centred on their weighted mean
// (both computed from the data); an object is a fixed {center, zoom}. Every fit leaves room for the cards (story.js). clock: false hides the clock.
// A stretch of the Guadalupe near Ingram with many closures by 05:00 (checked in the browser, Task 7).
const ZOOM_CLOSURES = { center: [-99.24, 30.07], zoom: 13.3 };
export const STEPS = [
  { id: "title", scenario: "none", at: D(20), layers: BASE, camera: "study", chart: null },
  { id: "question", scenario: "none", at: D(20), layers: BASE, camera: "homes", chart: null },
  { id: "water", scenario: "none", from: D(20), to: D(6), layers: { flood: true, river: true, study: true }, camera: "homes", chart: "gauge" },
  { id: "roads", scenario: "none", from: D(22), to: D(6), layers: { closed: true, roads: true, study: true }, camera: "study", chart: null },
  { id: "roads-zoom", scenario: "none", at: D(5), layers: { flood: true, closed: true, roads: true }, camera: ZOOM_CLOSURES, chart: null },
  { id: "traffic", scenario: "forced10", from: D(22), to: "2025-07-03T23:30", layers: { roads: true, closed: true, study: true }, camera: "traffic", chart: null },
  { id: "people", scenario: "none", from: D(22), to: D(12), layers: { ...BASE, flood: true }, camera: "homes", chart: "states" },
  { id: "harm", scenario: "none", from: D(22), to: D(15), layers: { ...BASE, flood: true }, camera: "homes", chart: "loss-none" },
  { id: "budget", scenario: "none", at: D(20), layers: BASE, camera: "homes", chart: null },
  { id: "s-plan", scenario: "plan", from: D(20), to: D(5), layers: { ...BASE, orders: true }, camera: "homes", chart: null },
  { id: "s-gauge", scenario: "gauge", from: D(20), to: D(5), layers: { ...BASE, orders: true }, camera: "homes", chart: null },
  { id: "s-policy", scenario: "policy", from: D(20), to: D(5), layers: { ...BASE, orders: true }, camera: "homes", chart: null },
  { id: "s-oracle", scenario: "oracle", from: D(20), to: D(5), layers: { ...BASE, orders: true }, camera: "homes", chart: null },
  { id: "result", scenario: "policy", from: D(20), to: D(15), layers: { ...BASE, orders: true, closed: true, flood: true }, camera: "study", chart: "result" },
  { id: "not", scenario: "none", at: D(20), layers: BASE, camera: "study", chart: null, clock: false },
  { id: "explore", scenario: "none", at: D(20), layers: BASE, camera: "study", chart: null, clock: false },
];
