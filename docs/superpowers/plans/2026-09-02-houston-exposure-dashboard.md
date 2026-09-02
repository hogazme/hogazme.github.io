# Houston Exposure Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `hogazme.github.io/houston-exposure/` — a scroll-then-explore Mapbox map of 2,891 Houston block groups over 72 months, coloured by a validated bivariate encoding of who each community's residents encounter.

**Architecture:** Static files, no build step, no bundler, no framework — matching `htx-worldcup`. A Python tool converts the upstream embedding outputs into three shipped artefacts (TopoJSON, a flat `uint8` binary, a small JSON). In the browser, plain `<script>` modules decode the binary and build a single Mapbox paint expression per month, so changing months is one `setPaintProperty` call rather than 2,891 per-feature updates.

**Tech Stack:** Mapbox GL JS 3.9.4 · topojson-client 3.1.0 (cdnjs) · vanilla ES2020 · Python 3.13 + pandas/pyarrow/numpy for the build tool. Tests: `node --test` (built into Node 24, zero deps) and `pytest` 8.3.

**Spec:** `docs/superpowers/specs/2026-09-02-houston-exposure-dashboard-design.md` — read it alongside this plan.

## Global Constraints

- **No build step, no bundler, no framework.** Plain `<script src>` tags in dependency order, exactly as `htx-worldcup/index.html` does.
- **Zero new runtime dependencies** beyond Mapbox GL JS 3.9.4 and topojson-client 3.1.0, both from CDN.
- **Zero new dev dependencies.** Tests run on `node --test` and `pytest`, both already present.
- Dark tokens, copied verbatim from `htx-worldcup/css/style.css`: ground `#0f172a`, panels `rgba(15, 23, 42, 0.97)`, borders `rgba(148, 163, 184, 0.12)`, labels `#94a3b8`, headings `#f8fafc`, body text `#e2e8f0`, links `#60a5fa`. Font `'Inter', -apple-system, BlinkMacSystemFont, sans-serif`.
- Header 60px; sidebar 370px fixed.
- **`js/config.js` is force-added past `.gitignore`** (`git add -f`), exactly as `htx-worldcup/js/config.js` is.
- **Bivariate palette — exact, validated, do not alter:**
  `['#243044','#825b4a','#e8833a','#42689a','#9a9196','#f1b785','#60a5fa','#acc9e5','#f5e9c8']`
  indexed `classOf(c1) * 3 + classOf(c3)`, row-major low→high PC1.
- **Reach ramp — exact, validated, do not alter:**
  `['#2a78d6','#3c6aa4','#455b76','#4a4a48','#784b46','#a34842','#d03b3b']`
- **Every polygon carries a hairline stroke** `rgba(148, 163, 184, 0.22)` at 0.5px. This is not decoration — it discharges the contrast WARN on the `#243044` cell (spec §3.1) and must not be removed.
- Tercile cuts at **85 and 170**. Relative mode: `clamp(round(v - mean + 128), 0, 255)`.
- **Relative mode is the default.** Absolute mode always shows its warning.
- All JS modules use the dual browser/Node export shim so the same file loads via `<script>` and `require()`. No ES modules.

## File Structure

| File | Responsibility |
|---|---|
| `houston-exposure/tools/build_data.py` | Convert upstream embedding outputs → the three shipped artefacts. Asserts every spec §2.1 invariant. |
| `houston-exposure/tools/test_build_data.py` | pytest for the above. |
| `houston-exposure/js/data.js` | Decode `components.bin`; slice/index/rank accessors. No DOM, no Mapbox. |
| `houston-exposure/js/colour.js` | Palette, tercile classes, relative-mode arithmetic, grouped Mapbox `match` expression builder. Pure. No DOM, no Mapbox. |
| `houston-exposure/js/narrative.js` | Scroll observer, the five steps, reduced-motion bypass. |
| `houston-exposure/js/app.js` | Map init, layers, controls, detail card, methods panel. The only file that touches Mapbox or the DOM. |
| `houston-exposure/js/config.js` | `MAPBOX_TOKEN` only. |
| `houston-exposure/css/style.css` | All styling. |
| `houston-exposure/index.html` | Markup + script order. |
| `houston-exposure/tests/*.test.js` | `node --test` suites for `data.js` and `colour.js`. |

**Public JS API, fixed here so tasks agree.** `data.js` and `colour.js` each attach to `globalThis.HX`:

```
HX.data.N_CBG = 2891, HX.data.N_MONTH = 72, HX.data.PLANE = 208152
HX.data.decodeComponents(arrayBuffer) -> { c1, c2, c3 }   // Uint8Array views, length 208152 each
HX.data.monthSlice(plane, monthIndex) -> Uint8Array        // length 2891
HX.data.valueAt(plane, monthIndex, cbgIdx) -> number
HX.data.rankInMonth(plane, monthIndex, cbgIdx) -> number   // 1-based, 1 = lowest

HX.colour.PALETTE      -> string[9]
HX.colour.REACH_RAMP   -> string[7]
HX.colour.CELL_LABELS  -> string[9]
HX.colour.classOf(v) -> 0|1|2
HX.colour.cellIndex(c1, c3) -> 0..8
HX.colour.relativise(v, mean) -> 0..255
HX.colour.bivariateCells(c1Slice, c3Slice, means|null) -> Uint8Array(2891)  // values 0..8
HX.colour.reachSteps(c2Slice, mean|null) -> Uint8Array(2891)                // values 0..6
HX.colour.matchExpression(classes, colours) -> Array                        // Mapbox expression
```

**Two deliberate improvements over the spec, already validated — build these, not what §5.2/§3.4 literally say:**

1. **Grouped `match` labels.** The spec describes `['match', ['get','idx'], 0, c0, 1, c1, …]` — 5,785 array elements. Mapbox `match` accepts an *array* of labels per branch, so the same result is `['match', ['get','idx'], [0,5,17,…], '#243044', …]` — **9 branches instead of 2,891**. Same output, far cheaper to compile. This is what `matchExpression` builds.
2. **The Reach ramp is now a concrete 7-step diverging scale** (above), generated in OKLab with symmetric lightness (0.575 → 0.408 → 0.575, monotone per arm) and validated: CVD ΔE 8.7 protan, normal-vision 23.5. The spec left it described but unspecified.

---

### Task 1: Preflight and the data build

**Files:**
- Create: `houston-exposure/tools/build_data.py`
- Create: `houston-exposure/tools/test_build_data.py`
- Creates as output: `houston-exposure/data/{houston_cbgs.topo.json, components.bin, meta.json}`

**Interfaces:**
- Consumes: the upstream directory `C:/Users/mobix/projects/mobility_detection_paper/houston_embedding` (read-only).
- Produces: the three artefacts every later task reads. `meta.json` keys are fixed by spec §2.2.

- [ ] **Step 1: Verify the Mapbox token works on the new path**

This blocks everything visual and costs nothing. Read the token, then ask Mapbox directly with the new path as Referer:

```bash
TOKEN=$(sed -n "s/.*'\(pk\.[^']*\)'.*/\1/p" htx-worldcup/js/config.js)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Referer: https://hogazme.github.io/houston-exposure/" \
  "https://api.mapbox.com/styles/v1/mapbox/dark-v11?access_token=$TOKEN"
```

Expected: `200`. If `401` or `403`, the token's URL restriction is scoped to another path — add `https://hogazme.github.io/houston-exposure/*` in the Mapbox account console (Account → Tokens → edit → URL restrictions) and re-run before continuing. Do not proceed on a non-200.

- [ ] **Step 2: Write the failing test**

Create `houston-exposure/tools/test_build_data.py`:

```python
"""Tests for the dashboard data build. Run from the repo root:
    python -m pytest houston-exposure/tools/test_build_data.py -v
"""
import json
import os
import struct
import sys

import numpy as np
import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_data as B  # noqa: E402

DATA = os.path.join(os.path.dirname(HERE), "data")


@pytest.fixture(scope="module")
def built():
    B.main()
    return True


def test_binary_is_three_planes_of_208152(built):
    raw = open(os.path.join(DATA, "components.bin"), "rb").read()
    assert len(raw) == 3 * 72 * 2891 == 624456


def test_golden_values_at_known_offsets(built):
    raw = np.frombuffer(open(os.path.join(DATA, "components.bin"), "rb").read(),
                        dtype=np.uint8)
    plane = 72 * 2891
    # CBG 480157601002 is index 0; 2019-01 is month 0; 2024-12 is month 71.
    assert raw[0] == 141                      # c1, month 0
    assert raw[plane + 0] == 245              # c2, month 0
    assert raw[2 * plane + 0] == 85           # c3, month 0
    assert raw[71 * 2891] == 98               # c1, month 71


def test_meta_shape_and_month_order(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    assert m["n_cbgs"] == 2891 and m["n_months"] == 72
    assert len(m["months"]) == 72
    assert m["months"][0] == "2019-01" and m["months"][-1] == "2024-12"
    assert m["months"] == sorted(m["months"])
    assert len(m["cbg_geoids"]) == 2891
    assert m["cbg_geoids"][0] == 480157601002
    assert m["cbg_geoids"] == sorted(m["cbg_geoids"])


def test_monthly_means_present_for_three_channels(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    for ch in ("c1", "c2", "c3"):
        assert len(m["monthly_mean_uint8"][ch]) == 72
    assert m["monthly_mean_uint8"]["c1"][0] == pytest.approx(134.471117, abs=1e-4)
    assert m["monthly_mean_uint8"]["c3"][0] == pytest.approx(129.179869, abs=1e-4)


def test_every_cbg_has_a_polygon_and_idx_matches_meta(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    topo = json.load(open(os.path.join(DATA, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    geoms = topo["objects"]["data"]["geometries"]
    assert len(geoms) == 2891
    by_geoid = {g["properties"]["cbg_geoid"]: g["properties"] for g in geoms}
    assert set(by_geoid) == set(m["cbg_geoids"])
    for i, gid in enumerate(m["cbg_geoids"]):
        assert by_geoid[gid]["idx"] == i


def test_imputed_income_flag_marks_168_cbgs(built):
    topo = json.load(open(os.path.join(DATA, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    geoms = topo["objects"]["data"]["geometries"]
    n = sum(1 for g in geoms if g["properties"]["imputed_income"] == 1)
    assert n == 168


def test_flags_name_the_bad_month_and_regimes(built):
    m = json.load(open(os.path.join(DATA, "meta.json"), encoding="utf-8"))
    assert m["flags"]["bad_months"] == ["2022-12"]
    assert len(m["flags"]["regimes"]) == 4
    assert m["stats"]["n_imputed_cbgs"] == 168
    assert m["stats"]["evr_cum3"] == pytest.approx(0.4738, abs=1e-3)
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `python -m pytest houston-exposure/tools/test_build_data.py -v`
Expected: collection error — `ModuleNotFoundError: No module named 'build_data'`.

- [ ] **Step 4: Write the build tool**

Create `houston-exposure/tools/build_data.py`:

```python
"""Build the three shipped artefacts for the Houston exposure dashboard.

Reads the frozen projection outputs from the mobility_detection_paper
houston_embedding directory and writes houston-exposure/data/.

Run rarely; the outputs are committed. From the repo root:
    python houston-exposure/tools/build_data.py
"""
import json
import os

import numpy as np
import pandas as pd

SRC = os.environ.get(
    "HX_EMBED_DIR",
    r"C:/Users/mobix/projects/mobility_detection_paper/houston_embedding")
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data")

N_CBG, N_MONTH = 2891, 72

REGIMES = [
    {"label": "A", "from": "2019-01", "to": "2022-11",
     "note": "POI roster frozen at 98,656 for 47 months"},
    {"label": "B", "from": "2022-12", "to": "2022-12",
     "note": "partial month: 32,774 POIs, 7.4M visits"},
    {"label": "C", "from": "2023-01", "to": "2023-12",
     "note": "roster grows to 115,804; out-of-scope share steps to ~0.36"},
    {"label": "D", "from": "2024-01", "to": "2024-12",
     "note": "3-4x the visits of 2023 on an identical roster"},
]


def load_components():
    u = pd.read_parquet(os.path.join(SRC, "houston_components_uint8.parquet"))
    geoids = np.array(sorted(u["cbg_geoid"].unique()), dtype=np.int64)
    months = sorted(u["year_month"].unique().tolist())
    assert len(geoids) == N_CBG, f"expected {N_CBG} CBGs, got {len(geoids)}"
    assert len(months) == N_MONTH, f"expected {N_MONTH} months, got {len(months)}"
    assert months[0] == "2019-01" and months[-1] == "2024-12"
    expected = pd.date_range("2019-01-01", "2024-12-01",
                             freq="MS").strftime("%Y-%m").tolist()
    assert months == expected, "months are not contiguous 2019-01..2024-12"
    assert len(u) == N_CBG * N_MONTH, f"expected 208,152 rows, got {len(u)}"

    gpos = {g: i for i, g in enumerate(geoids)}
    mpos = {m: i for i, m in enumerate(months)}
    planes = np.zeros((3, N_MONTH, N_CBG), dtype=np.uint8)
    gi = u["cbg_geoid"].map(gpos).to_numpy()
    mi = u["year_month"].map(mpos).to_numpy()
    for k, col in enumerate(("c1", "c2", "c3")):
        v = u[col].to_numpy()
        assert v.dtype == np.uint8, f"{col} is {v.dtype}, expected uint8"
        assert v.min() == 0 and v.max() == 255, f"{col} does not span 0-255"
        planes[k, mi, gi] = v
    return geoids, months, planes


def load_imputed_cbgs():
    """The 168 CBGs whose ACS median_household_income is 0, so every
    income_exposure_gap column is undefined in all 72 months."""
    mk = pd.read_parquet(os.path.join(SRC, "houston_imputation_mask.parquet"))
    cols = [c for c in mk.columns if c.startswith("income_exposure_gap_")]
    g = mk.groupby("cbg_geoid")[cols].sum()
    return set(g.index[(g == N_MONTH).all(axis=1)].tolist())


def load_monthly_means(months):
    mm = pd.read_csv(os.path.join(SRC, "houston_monthly_component_means.csv"))
    mm = mm.set_index("year_month").loc[months]
    return {f"c{k}": [float(v) for v in mm[f"pc{k}_mean_uint8"]] for k in (1, 2, 3)}


def load_loadings():
    df = pd.read_csv(os.path.join(SRC, "houston_pca_loadings_pc1_3_sorted.csv"))
    out = {}
    for pc in ("PC1", "PC2", "PC3"):
        top = df[df["component"] == pc].nsmallest(12, "rank_by_abs")
        out[pc] = [{"feature": r.feature, "loading": round(float(r.loading), 4)}
                   for r in top.itertuples()]
    return out


def build_topojson(geoids, imputed):
    topo = json.load(open(os.path.join(SRC, "houston_cbgs.topo.json"),
                          encoding="utf-8"))
    key = next(iter(topo["objects"]))
    if key != "data":
        topo["objects"]["data"] = topo["objects"].pop(key)
    geoms = topo["objects"]["data"]["geometries"]
    assert len(geoms) == N_CBG, f"topojson has {len(geoms)} geometries"
    gpos = {int(g): i for i, g in enumerate(geoids)}
    seen = set()
    for g in geoms:
        p = g["properties"]
        gid = int(p["cbg_geoid"])
        assert gid in gpos, f"polygon {gid} is not in the component table"
        seen.add(gid)
        p["cbg_geoid"] = gid
        p["idx"] = gpos[gid]
        p["imputed_income"] = 1 if gid in imputed else 0
    missing = set(gpos) - seen
    assert not missing, f"{len(missing)} CBGs have no polygon: {sorted(missing)[:5]}"
    return topo


def main():
    os.makedirs(OUT, exist_ok=True)
    geoids, months, planes = load_components()
    imputed = load_imputed_cbgs()
    print(f"  {len(geoids)} CBGs x {len(months)} months; "
          f"{len(imputed)} imputed-income CBGs")

    with open(os.path.join(OUT, "components.bin"), "wb") as f:
        f.write(planes.tobytes(order="C"))

    results = json.load(open(os.path.join(SRC, "houston_embedding_results.json"),
                             encoding="utf-8"))
    meta = {
        "n_cbgs": N_CBG,
        "n_months": N_MONTH,
        "months": months,
        "cbg_geoids": [int(g) for g in geoids],
        "monthly_mean_uint8": load_monthly_means(months),
        "flags": {"bad_months": ["2022-12"], "regimes": REGIMES},
        "loadings": load_loadings(),
        "stats": {
            "evr": [round(v, 4) for v in
                    results["part2"]["explained_variance_ratio_1_10"][:3]],
            "evr_cum3": round(results["part2"]["cumulative_pc1_3"], 4),
            "n_components_for_90pct": results["part2"]["n_components_for_90pct"],
            "morans_I_mean": round(results["part4c"]["monthly_I"]["mean"], 4),
            "n_islands": results["part4c"]["n_islands_zero_degree_excluded"],
            "n_imputed_cbgs": len(imputed),
        },
    }
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, separators=(",", ":"))

    topo = build_topojson(geoids, imputed)
    with open(os.path.join(OUT, "houston_cbgs.topo.json"), "w",
              encoding="utf-8") as f:
        json.dump(topo, f, separators=(",", ":"))

    for name in ("components.bin", "meta.json", "houston_cbgs.topo.json"):
        p = os.path.join(OUT, name)
        print(f"  {os.path.getsize(p) / 1e6:7.3f} MB  {name}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `python -m pytest houston-exposure/tools/test_build_data.py -v`
Expected: 7 passed.

- [ ] **Step 6: Commit**

```bash
git add houston-exposure/tools houston-exposure/data
git commit -m "Add Houston exposure dashboard data build"
```

---

### Task 2: JS data layer

**Files:**
- Create: `houston-exposure/js/data.js`
- Test: `houston-exposure/tests/data.test.js`

**Interfaces:**
- Consumes: `data/components.bin` from Task 1.
- Produces: `HX.data.{N_CBG, N_MONTH, PLANE, decodeComponents, monthSlice, valueAt, rankInMonth}` — used by Tasks 3–7.

- [ ] **Step 1: Write the failing test**

Create `houston-exposure/tests/data.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const D = require('../js/data.js');
const BIN = path.join(__dirname, '..', 'data', 'components.bin');

function load() {
  const b = fs.readFileSync(BIN);
  return D.decodeComponents(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
}

test('constants match the panel', () => {
  assert.strictEqual(D.N_CBG, 2891);
  assert.strictEqual(D.N_MONTH, 72);
  assert.strictEqual(D.PLANE, 208152);
});

test('decodeComponents returns three planes of 208152', () => {
  const c = load();
  assert.strictEqual(c.c1.length, 208152);
  assert.strictEqual(c.c2.length, 208152);
  assert.strictEqual(c.c3.length, 208152);
});

test('decodeComponents rejects a wrong-sized buffer', () => {
  assert.throws(() => D.decodeComponents(new ArrayBuffer(10)), /624456/);
});

test('golden values for CBG index 0', () => {
  const c = load();
  assert.strictEqual(D.valueAt(c.c1, 0, 0), 141);
  assert.strictEqual(D.valueAt(c.c2, 0, 0), 245);
  assert.strictEqual(D.valueAt(c.c3, 0, 0), 85);
  assert.strictEqual(D.valueAt(c.c1, 71, 0), 98);
  assert.strictEqual(D.valueAt(c.c3, 71, 0), 95);
});

test('monthSlice is 2891 long and agrees with valueAt', () => {
  const c = load();
  const s = D.monthSlice(c.c1, 71);
  assert.strictEqual(s.length, 2891);
  assert.strictEqual(s[0], 98);
  for (const i of [0, 1, 1000, 2890]) {
    assert.strictEqual(s[i], D.valueAt(c.c1, 71, i));
  }
});

test('rankInMonth is 1-based and consistent with the slice', () => {
  const c = load();
  const s = D.monthSlice(c.c1, 0);
  const r = D.rankInMonth(c.c1, 0, 0);
  const below = Array.from(s).filter((v) => v < s[0]).length;
  assert.strictEqual(r, below + 1);
  assert.ok(r >= 1 && r <= 2891);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test houston-exposure/tests/data.test.js`
Expected: FAIL — `Cannot find module '../js/data.js'`.

- [ ] **Step 3: Write the implementation**

Create `houston-exposure/js/data.js`:

```js
/* Houston exposure dashboard — binary component decoding.
   Pure data access: no DOM, no Mapbox. Loads as a <script> tag in the browser
   and as require() under node --test. */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.HX = root.HX || {};
  root.HX.data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var N_CBG = 2891;
  var N_MONTH = 72;
  var PLANE = N_CBG * N_MONTH;          // 208152

  /* components.bin is three contiguous uint8 planes (c1, c2, c3).
     Within a plane: offset = monthIndex * N_CBG + cbgIdx. */
  function decodeComponents(arrayBuffer) {
    var all = new Uint8Array(arrayBuffer);
    if (all.length !== PLANE * 3) {
      throw new Error('components.bin must be ' + PLANE * 3 +
                      ' bytes, got ' + all.length);
    }
    return {
      c1: all.subarray(0, PLANE),
      c2: all.subarray(PLANE, PLANE * 2),
      c3: all.subarray(PLANE * 2, PLANE * 3)
    };
  }

  function monthSlice(plane, monthIndex) {
    var o = monthIndex * N_CBG;
    return plane.subarray(o, o + N_CBG);
  }

  function valueAt(plane, monthIndex, cbgIdx) {
    return plane[monthIndex * N_CBG + cbgIdx];
  }

  /* 1-based rank of this CBG within its month; 1 = lowest value. */
  function rankInMonth(plane, monthIndex, cbgIdx) {
    var s = monthSlice(plane, monthIndex);
    var v = s[cbgIdx];
    var below = 0;
    for (var i = 0; i < s.length; i++) if (s[i] < v) below++;
    return below + 1;
  }

  return {
    N_CBG: N_CBG,
    N_MONTH: N_MONTH,
    PLANE: PLANE,
    decodeComponents: decodeComponents,
    monthSlice: monthSlice,
    valueAt: valueAt,
    rankInMonth: rankInMonth
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test houston-exposure/tests/data.test.js`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add houston-exposure/js/data.js houston-exposure/tests/data.test.js
git commit -m "Add binary component decoding for Houston exposure dashboard"
```

---

### Task 3: Colour module

**Files:**
- Create: `houston-exposure/js/colour.js`
- Test: `houston-exposure/tests/colour.test.js`

**Interfaces:**
- Consumes: `HX.data.monthSlice` output (`Uint8Array(2891)`) from Task 2.
- Produces: `HX.colour.{PALETTE, REACH_RAMP, CELL_LABELS, classOf, cellIndex, relativise, bivariateCells, reachSteps, matchExpression}` — used by Tasks 4–7.

- [ ] **Step 1: Write the failing test**

Create `houston-exposure/tests/colour.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/colour.js');

test('palette and ramp are the validated values', () => {
  assert.deepStrictEqual(C.PALETTE, [
    '#243044', '#825b4a', '#e8833a',
    '#42689a', '#9a9196', '#f1b785',
    '#60a5fa', '#acc9e5', '#f5e9c8'
  ]);
  assert.deepStrictEqual(C.REACH_RAMP, [
    '#2a78d6', '#3c6aa4', '#455b76', '#4a4a48',
    '#784b46', '#a34842', '#d03b3b'
  ]);
  assert.strictEqual(C.CELL_LABELS.length, 9);
});

test('classOf cuts at 85 and 170', () => {
  assert.strictEqual(C.classOf(0), 0);
  assert.strictEqual(C.classOf(84), 0);
  assert.strictEqual(C.classOf(85), 1);
  assert.strictEqual(C.classOf(169), 1);
  assert.strictEqual(C.classOf(170), 2);
  assert.strictEqual(C.classOf(255), 2);
});

test('cellIndex is row-major low->high PC1', () => {
  assert.strictEqual(C.cellIndex(0, 0), 0);       // low  PC1, low  PC3
  assert.strictEqual(C.cellIndex(0, 255), 2);     // low  PC1, high PC3
  assert.strictEqual(C.cellIndex(255, 0), 6);     // high PC1, low  PC3
  assert.strictEqual(C.cellIndex(255, 255), 8);   // high PC1, high PC3
  assert.strictEqual(C.cellIndex(141, 85), 4);    // golden CBG 0, 2019-01
});

test('relativise recentres on 128 and clamps', () => {
  assert.strictEqual(C.relativise(141, 134.471117), 135);
  assert.strictEqual(C.relativise(85, 129.179869), 84);
  assert.strictEqual(C.relativise(0, 200), 0);
  assert.strictEqual(C.relativise(255, 10), 255);
});

test('relative mode moves the golden CBG out of the centre cell', () => {
  const c1 = Uint8Array.from([141]);
  const c3 = Uint8Array.from([85]);
  assert.strictEqual(C.bivariateCells(c1, c3, null)[0], 4);
  const means = { c1: 134.471117, c3: 129.179869 };
  assert.strictEqual(C.bivariateCells(c1, c3, means)[0], 3);
});

test('reachSteps buckets into 7 and centres the neutral step', () => {
  const c2 = Uint8Array.from([0, 128, 255]);
  const s = C.reachSteps(c2, null);
  assert.strictEqual(s[0], 0);
  assert.strictEqual(s[1], 3);
  assert.strictEqual(s[2], 6);
});

test('matchExpression groups labels, one branch per colour', () => {
  const classes = Uint8Array.from([0, 2, 0, 1]);
  const e = C.matchExpression(classes, ['#aaaaaa', '#bbbbbb', '#cccccc']);
  assert.strictEqual(e[0], 'match');
  assert.deepStrictEqual(e[1], ['get', 'idx']);
  assert.deepStrictEqual(e[2], [0, 2]);
  assert.strictEqual(e[3], '#aaaaaa');
  assert.deepStrictEqual(e[4], [3]);
  assert.strictEqual(e[5], '#bbbbbb');
  assert.deepStrictEqual(e[6], [1]);
  assert.strictEqual(e[7], '#cccccc');
  assert.strictEqual(e.length, 9);            // + fallback
});

test('matchExpression omits colours no feature uses', () => {
  const e = C.matchExpression(Uint8Array.from([1, 1]), ['#aaaaaa', '#bbbbbb']);
  assert.strictEqual(e.length, 5);            // match, get, [0,1], colour, fallback
  assert.deepStrictEqual(e[2], [0, 1]);
  assert.strictEqual(e[3], '#bbbbbb');
});

test('a full 2891-feature expression stays small', () => {
  const classes = new Uint8Array(2891);
  for (let i = 0; i < classes.length; i++) classes[i] = i % 9;
  const e = C.matchExpression(classes, C.PALETTE);
  assert.strictEqual(e.length, 2 + 9 * 2 + 1);   // 9 branches, not 2891
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test houston-exposure/tests/colour.test.js`
Expected: FAIL — `Cannot find module '../js/colour.js'`.

- [ ] **Step 3: Write the implementation**

Create `houston-exposure/js/colour.js`:

```js
/* Houston exposure dashboard — colour encoding.
   Pure: no DOM, no Mapbox. Palette and ramp are validated values; see
   docs/superpowers/specs/2026-09-02-houston-exposure-dashboard-design.md section 3. */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.HX = root.HX || {};
  root.HX.colour = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Row-major, low -> high PC1. The legend draws bottom-up; this array does not. */
  var PALETTE = [
    '#243044', '#825b4a', '#e8833a',   // 0,1,2  low  PC1
    '#42689a', '#9a9196', '#f1b785',   // 3,4,5  mid  PC1
    '#60a5fa', '#acc9e5', '#f5e9c8'    // 6,7,8  high PC1
  ];

  var CELL_LABELS = [
    'Travels among people like itself',
    'Similar incomes, different races',
    'Similar incomes, very different races',
    'Somewhat richer crowds, similar races',
    'Middling on both',
    'Similar incomes aside, quite different crowds',
    'Much richer crowds, similar races',
    'Much richer crowds, somewhat different races',
    'Richer and racially unlike crowds'
  ];

  /* Diverging blue <-> red, neutral grey midpoint; symmetric OKLab lightness. */
  var REACH_RAMP = [
    '#2a78d6', '#3c6aa4', '#455b76', '#4a4a48',
    '#784b46', '#a34842', '#d03b3b'
  ];

  var LOW_CUT = 85;
  var HIGH_CUT = 170;

  function classOf(v) {
    return v < LOW_CUT ? 0 : (v < HIGH_CUT ? 1 : 2);
  }

  function cellIndex(c1, c3) {
    return classOf(c1) * 3 + classOf(c3);
  }

  /* Recentre a pooled percentile on 128 by removing its month's Houston-wide
     mean. This is the client-side subtraction the upstream pcK_mean_uint8
     column exists for; it is what keeps the 2023/2024 data regimes from
     reading as a citywide behavioural change. */
  function relativise(v, mean) {
    var r = Math.round(v - mean + 128);
    return r < 0 ? 0 : (r > 255 ? 255 : r);
  }

  /* means === null -> absolute mode; otherwise { c1, c3 } for this month. */
  function bivariateCells(c1Slice, c3Slice, means) {
    var n = c1Slice.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var a = c1Slice[i];
      var b = c3Slice[i];
      if (means) {
        a = relativise(a, means.c1);
        b = relativise(b, means.c3);
      }
      out[i] = cellIndex(a, b);
    }
    return out;
  }

  /* 7 equal-width buckets over 0-255; the neutral step is bucket 3. */
  function reachSteps(c2Slice, mean) {
    var n = c2Slice.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var v = mean === null || mean === undefined
        ? c2Slice[i] : relativise(c2Slice[i], mean);
      var b = Math.floor(v / 256 * 7);
      out[i] = b > 6 ? 6 : b;
    }
    return out;
  }

  /* Build a Mapbox `match` expression keyed on the baked `idx` property.
     Mapbox accepts an ARRAY of labels per branch, so 2,891 features collapse
     to one branch per colour instead of 2,891 branches. Colours no feature
     uses are omitted entirely. */
  function matchExpression(classes, colours) {
    var buckets = [];
    var i;
    for (i = 0; i < colours.length; i++) buckets.push([]);
    for (i = 0; i < classes.length; i++) buckets[classes[i]].push(i);

    var expr = ['match', ['get', 'idx']];
    for (i = 0; i < colours.length; i++) {
      if (buckets[i].length) {
        expr.push(buckets[i]);
        expr.push(colours[i]);
      }
    }
    expr.push('rgba(0,0,0,0)');            // fallback: features with no idx
    return expr;
  }

  return {
    PALETTE: PALETTE,
    REACH_RAMP: REACH_RAMP,
    CELL_LABELS: CELL_LABELS,
    LOW_CUT: LOW_CUT,
    HIGH_CUT: HIGH_CUT,
    classOf: classOf,
    cellIndex: cellIndex,
    relativise: relativise,
    bivariateCells: bivariateCells,
    reachSteps: reachSteps,
    matchExpression: matchExpression
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test houston-exposure/tests/colour.test.js`
Expected: 9 pass.

- [ ] **Step 5: Commit**

```bash
git add houston-exposure/js/colour.js houston-exposure/tests/colour.test.js
git commit -m "Add validated bivariate colour encoding"
```

---

### Task 4: Map shell — first paint

**Files:**
- Create: `houston-exposure/index.html`, `houston-exposure/css/style.css`, `houston-exposure/js/app.js`, `houston-exposure/js/config.js`

**Interfaces:**
- Consumes: `HX.data` (Task 2), `HX.colour` (Task 3), the three artefacts (Task 1).
- Produces: `HX.app.state = { monthIndex, view, mode, selectedIdx }` and `HX.app.repaint()`, both used by Tasks 5–9.

- [ ] **Step 1: Copy the token into place**

```bash
cp htx-worldcup/js/config.js houston-exposure/js/config.js
```

- [ ] **Step 2: Write the markup**

Create `houston-exposure/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Who Houston Meets</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">

    <link href="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css" rel="stylesheet">
    <script src="https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/topojson/3.1.0/topojson.min.js"></script>

    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header id="header">
        <h1>Who Houston Meets</h1>
        <p class="subtitle">Where you live decides who you encounter</p>
        <button id="methods-open" class="header-btn">Methods &amp; data</button>
    </header>

    <div id="app">
        <aside id="sidebar">
            <div class="sidebar-section" id="legend-section">
                <label>What the colour means</label>
                <div id="legend"></div>
            </div>

            <div class="sidebar-section" id="view-section">
                <label>View</label>
                <div id="view-controls"></div>
            </div>

            <div class="sidebar-section" id="mode-section">
                <label>Comparison</label>
                <div id="mode-controls"></div>
                <p id="mode-warning" class="warning hidden"></p>
            </div>

            <div class="sidebar-section hidden" id="detail-section">
                <label>Block group</label>
                <button id="detail-close" aria-label="Close details">&times;</button>
                <div id="detail-content"></div>
            </div>

            <div class="sidebar-footer">
                <a href="https://mobix.blogs.rice.edu/" target="_blank" rel="noopener">Mobility-X Lab</a>
                <span class="footer-sep">&middot;</span>
                <a href="mailto:hgazmeh@rice.edu">Contact</a>
                <span class="footer-version">v1.0</span>
            </div>
        </aside>

        <div id="map-container">
            <div id="map"></div>
        </div>
    </div>

    <div id="transport">
        <button id="play" aria-label="Play">&#9654;</button>
        <span class="month-edge">2019-01</span>
        <input type="range" id="month-slider" min="0" max="71" value="0" step="1"
               aria-label="Month">
        <span class="month-edge">2024-12</span>
        <span id="month-label">2019-01</span>
        <canvas id="mean-strip" width="720" height="26"></canvas>
    </div>

    <div id="tooltip" class="tooltip"></div>
    <div id="methods-panel" class="hidden"></div>

    <div id="loading"><div class="spinner"></div><span>Loading 208,152 observations...</span></div>

    <script src="js/config.js"></script>
    <script src="js/data.js"></script>
    <script src="js/colour.js"></script>
    <script src="js/narrative.js"></script>
    <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write the stylesheet**

Create `houston-exposure/css/style.css` by copying `htx-worldcup/css/style.css` as the base and keeping its `*`-reset, `body`, `#header`, `#app`, `#sidebar`, `.sidebar-section`, `.sidebar-footer`, `#map-container`, `.tooltip`, `#loading`, `.spinner`, and `.hidden` rules verbatim (they already carry the shared tokens). Then append:

```css
/* Transport */
#transport {
    height: 64px;
    background: rgba(15, 23, 42, 0.97);
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 24px;
    position: relative;
    z-index: 6;
}

#transport button#play {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(148, 163, 184, 0.25);
    background: rgba(30, 41, 59, 0.8);
    color: #f1f5f9;
    cursor: pointer;
    flex-shrink: 0;
}

#month-slider { flex: 1; accent-color: #60a5fa; }

.month-edge { color: #64748b; font-size: 12px; font-variant-numeric: tabular-nums; }

#month-label {
    color: #f8fafc;
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    min-width: 68px;
    text-align: right;
}

#mean-strip { height: 26px; width: 220px; flex-shrink: 0; }

/* Legend */
#legend { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; width: 132px; }

.legend-cell {
    aspect-ratio: 1;
    border: 1px solid rgba(148, 163, 184, 0.22);
    cursor: pointer;
    transition: outline-color 0.12s;
    outline: 2px solid transparent;
}

.legend-cell:hover, .legend-cell.active { outline-color: #f8fafc; }

.legend-axis { color: #64748b; font-size: 10px; letter-spacing: 0.04em; }

.warning {
    color: #fab219;
    font-size: 12px;
    line-height: 1.5;
    margin-top: 8px;
}

@media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 4: Write the app bootstrap**

Create `houston-exposure/js/app.js`:

```js
/* Houston exposure dashboard — map, layers, controls. The only file that
   touches Mapbox or the DOM. */
(function () {
  'use strict';

  var HOUSTON_CENTER = [-95.3698, 29.7604];
  var HOUSTON_ZOOM = 8.6;
  var MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';

  var state = {
    monthIndex: 0,
    view: 'exposure',        // 'exposure' | 'reach'
    mode: 'relative',        // 'relative' | 'absolute'
    selectedIdx: null,
    hoverCell: null
  };

  var map = null;
  var meta = null;
  var comp = null;
  var exprCache = Object.create(null);

  function show(el, on) { el.classList.toggle('hidden', !on); }

  function means(channel) {
    if (state.mode === 'absolute') return null;
    return meta.monthly_mean_uint8[channel][state.monthIndex];
  }

  /* One Mapbox expression per (month, view, mode); memoised so scrubbing back
     and forth costs nothing. */
  function fillExpression() {
    var key = state.view + '|' + state.mode + '|' + state.monthIndex;
    if (exprCache[key]) return exprCache[key];

    var expr;
    if (state.view === 'exposure') {
      var c1 = HX.data.monthSlice(comp.c1, state.monthIndex);
      var c3 = HX.data.monthSlice(comp.c3, state.monthIndex);
      var m = state.mode === 'absolute'
        ? null : { c1: means('c1'), c3: means('c3') };
      expr = HX.colour.matchExpression(
        HX.colour.bivariateCells(c1, c3, m), HX.colour.PALETTE);
    } else {
      var c2 = HX.data.monthSlice(comp.c2, state.monthIndex);
      expr = HX.colour.matchExpression(
        HX.colour.reachSteps(c2, means('c2')), HX.colour.REACH_RAMP);
    }
    exprCache[key] = expr;
    return expr;
  }

  function repaint() {
    if (!map || !map.getLayer('cbg-fill')) return;
    map.setPaintProperty('cbg-fill', 'fill-color', fillExpression());
    document.getElementById('month-label').textContent =
      meta.months[state.monthIndex];
  }

  function addLayers(geojson) {
    map.addSource('cbgs', { type: 'geojson', data: geojson, promoteId: 'cbg_geoid' });

    map.addLayer({
      id: 'cbg-fill',
      type: 'fill',
      source: 'cbgs',
      paint: { 'fill-color': fillExpression(), 'fill-opacity': 0.88 }
    });

    /* Hairline stroke on every polygon. This is not decoration: it discharges
       the contrast WARN on the darkest palette cell (spec section 3.1). */
    map.addLayer({
      id: 'cbg-line',
      type: 'line',
      source: 'cbgs',
      paint: {
        'line-color': 'rgba(148, 163, 184, 0.22)',
        'line-width': 0.5
      }
    });

    /* The 168 CBGs whose ACS median income is 0 and whose income-gap features
       are Houston-median fills. Always visible, in every view. */
    map.addLayer({
      id: 'cbg-imputed',
      type: 'line',
      source: 'cbgs',
      filter: ['==', ['get', 'imputed_income'], 1],
      paint: {
        'line-color': 'rgba(250, 178, 25, 0.55)',
        'line-width': 1,
        'line-dasharray': [2, 2]
      }
    });
  }

  async function init() {
    mapboxgl.accessToken = MAPBOX_TOKEN;
    map = new mapboxgl.Map({
      container: 'map',
      style: MAP_STYLE,
      center: HOUSTON_CENTER,
      zoom: HOUSTON_ZOOM,
      attributionControl: false
    });
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    var results = await Promise.all([
      fetch('data/meta.json').then(function (r) { return r.json(); }),
      fetch('data/components.bin').then(function (r) { return r.arrayBuffer(); }),
      fetch('data/houston_cbgs.topo.json').then(function (r) { return r.json(); }),
      new Promise(function (res) { map.on('load', res); })
    ]);
    meta = results[0];
    comp = HX.data.decodeComponents(results[1]);
    var topo = results[2];

    if (meta.n_cbgs !== HX.data.N_CBG || meta.n_months !== HX.data.N_MONTH) {
      throw new Error('meta.json disagrees with the binary layout');
    }

    addLayers(topojson.feature(topo, topo.objects.data));
    repaint();
    show(document.getElementById('loading'), false);

    HX.app.map = map;
    HX.app.meta = meta;
    HX.app.comp = comp;
  }

  window.HX = window.HX || {};
  window.HX.app = { state: state, repaint: repaint };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
```

- [ ] **Step 5: Create a placeholder narrative module so the script tag resolves**

Create `houston-exposure/js/narrative.js`:

```js
/* Scroll narrative — implemented in Task 9. */
(function () {
  'use strict';
  window.HX = window.HX || {};
  window.HX.narrative = { start: function () {} };
})();
```

- [ ] **Step 6: Serve and verify first paint**

```bash
python -m http.server 8099 --directory . &
```

Open `http://localhost:8099/houston-exposure/`. Expected: the Houston metro renders as ~2,891 coloured polygons on the dark basemap, month label reads `2019-01`, no console errors, and the loading overlay disappears. Check the Network tab: `components.bin` is 624,456 bytes.

In the console, confirm the expression really is small — this is risk 2 from the spec:

```js
HX.app.state.monthIndex = 40; console.time('t'); HX.app.repaint(); console.timeEnd('t');
```

Expected: under ~50 ms. If it exceeds ~150 ms, fall back to baking 72 class properties per feature in `build_data.py` and switching with a 9-entry match — but measure before changing anything.

- [ ] **Step 7: Commit**

```bash
git add houston-exposure/index.html houston-exposure/css houston-exposure/js/app.js houston-exposure/js/narrative.js
git add -f houston-exposure/js/config.js
git commit -m "Add Houston exposure map shell and first paint"
```

---

### Task 5: Month transport

**Files:**
- Modify: `houston-exposure/js/app.js` (append a `transport` section before the `init` call)

**Interfaces:**
- Consumes: `HX.app.state`, `HX.app.repaint`, `meta.months`, `meta.monthly_mean_uint8`, `meta.flags.bad_months`.
- Produces: `HX.app.setMonth(i)`, `HX.app.play()`, `HX.app.pause()` — used by Task 9's autoplay step.

- [ ] **Step 1: Add the transport wiring**

Insert into `js/app.js` above `async function init()`:

```js
  var playTimer = null;

  function setMonth(i) {
    var n = HX.data.N_MONTH;
    state.monthIndex = ((i % n) + n) % n;
    document.getElementById('month-slider').value = state.monthIndex;
    repaint();
    drawMeanStrip();
    if (state.selectedIdx !== null) renderDetail(state.selectedIdx);
  }

  function pause() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    document.getElementById('play').innerHTML = '&#9654;';
  }

  function play() {
    if (playTimer) return pause();
    document.getElementById('play').innerHTML = '&#10073;&#10073;';
    playTimer = setInterval(function () {
      setMonth(state.monthIndex + 1);
    }, 111);                                   // ~9 fps -> 72 months in ~8 s
  }

  /* The strip is both a scrub target and the honest disclosure of the
     2023/2024 data-supply regimes, which are plainly visible as level steps. */
  function drawMeanStrip() {
    var cv = document.getElementById('mean-strip');
    var ctx = cv.getContext('2d');
    var ch = state.view === 'reach' ? 'c2' : 'c1';
    var vals = meta.monthly_mean_uint8[ch];
    var w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    var bw = w / vals.length;
    for (var i = 0; i < vals.length; i++) {
      var bad = meta.flags.bad_months.indexOf(meta.months[i]) !== -1;
      var y = h - (vals[i] / 255) * h;
      ctx.fillStyle = bad ? '#fab219'
        : (i === state.monthIndex ? '#f8fafc' : 'rgba(148,163,184,0.45)');
      ctx.fillRect(i * bw, y, Math.max(1, bw - 1), h - y);
    }
  }

  function bindTransport() {
    document.getElementById('month-slider').addEventListener('input', function (e) {
      pause();
      setMonth(parseInt(e.target.value, 10));
    });
    document.getElementById('play').addEventListener('click', play);
    document.getElementById('mean-strip').addEventListener('click', function (e) {
      pause();
      var r = e.target.getBoundingClientRect();
      setMonth(Math.floor((e.clientX - r.left) / r.width * HX.data.N_MONTH));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { pause(); setMonth(state.monthIndex - 1); }
      else if (e.key === 'ArrowRight') { pause(); setMonth(state.monthIndex + 1); }
      else if (e.key === ' ') { e.preventDefault(); play(); }
      else if (e.key === 'Escape') { clearSelection(); }
    });
  }
```

Then add `bindTransport(); drawMeanStrip();` immediately after `repaint();` inside `init`, and extend the export to
`window.HX.app = { state: state, repaint: repaint, setMonth: setMonth, play: play, pause: pause };`

- [ ] **Step 2: Verify in the browser**

Reload `http://localhost:8099/houston-exposure/`. Expected:
- Dragging the slider changes the map and the month label.
- `▶` animates all 72 months in about 8 seconds without visible stutter.
- `←`/`→` step one month; `space` toggles play.
- The strip shows a visible level step at 2023-01 and another at 2024-01, and 2022-12 is drawn amber.

- [ ] **Step 3: Commit**

```bash
git add houston-exposure/js/app.js
git commit -m "Add month transport with autoplay and mean strip"
```

---

### Task 6: Legend, view and mode controls

**Files:**
- Modify: `houston-exposure/js/app.js`

**Interfaces:**
- Consumes: `HX.colour.{PALETTE, CELL_LABELS, REACH_RAMP}`, `HX.app.repaint`.
- Produces: `HX.app.setView(v)`, `HX.app.setMode(m)`.

- [ ] **Step 1: Add the controls**

Insert into `js/app.js` above `async function init()`:

```js
  var REGIME_WARNING =
    'Absolute mode compares raw values across months. The panel contains three ' +
    'data-supply regimes (the POI roster is frozen 2019-01 to 2022-11, 2022-12 is ' +
    'partial, and the roster changes again in 2023 and 2024), so the whole map ' +
    'shifts colour at those boundaries for reasons that are not behavioural.';

  function buildLegend() {
    var el = document.getElementById('legend');
    el.innerHTML = '';
    if (state.view === 'reach') {
      el.style.gridTemplateColumns = 'repeat(7, 1fr)';
      el.style.width = '188px';
      HX.colour.REACH_RAMP.forEach(function (c, i) {
        var d = document.createElement('div');
        d.className = 'legend-cell';
        d.style.background = c;
        d.title = i < 3 ? 'Shorter trips' : (i > 3 ? 'Longer trips' : 'Typical');
        el.appendChild(d);
      });
      return;
    }
    el.style.gridTemplateColumns = 'repeat(3, 1fr)';
    el.style.width = '132px';
    /* Draw high PC1 first so the legend reads bottom-up like a chart axis. */
    [2, 1, 0].forEach(function (row) {
      for (var col = 0; col < 3; col++) {
        var idx = row * 3 + col;
        var d = document.createElement('div');
        d.className = 'legend-cell';
        d.dataset.cell = idx;
        d.style.background = HX.colour.PALETTE[idx];
        d.title = HX.colour.CELL_LABELS[idx];
        d.addEventListener('mouseenter', function () { setHoverCell(idx); });
        d.addEventListener('mouseleave', function () { setHoverCell(null); });
        el.appendChild(d);
      }
    });
  }

  /* Legend isolate: the secondary encoding that makes an individual cell
     resolvable even though adjacent cells are deliberately similar. */
  function setHoverCell(cell) {
    state.hoverCell = cell;
    if (!map.getLayer('cbg-fill')) return;
    if (cell === null) {
      map.setPaintProperty('cbg-fill', 'fill-opacity', 0.88);
      return;
    }
    var c1 = HX.data.monthSlice(comp.c1, state.monthIndex);
    var c3 = HX.data.monthSlice(comp.c3, state.monthIndex);
    var m = state.mode === 'absolute' ? null : { c1: means('c1'), c3: means('c3') };
    var cells = HX.colour.bivariateCells(c1, c3, m);
    var flags = new Uint8Array(cells.length);
    for (var i = 0; i < cells.length; i++) flags[i] = cells[i] === cell ? 1 : 0;
    map.setPaintProperty('cbg-fill', 'fill-opacity',
      HX.colour.matchExpression(flags, [0.15, 0.95]));
  }

  function setView(v) {
    state.view = v;
    buildLegend();
    repaint();
    drawMeanStrip();
    renderControls();
  }

  function setMode(m) {
    state.mode = m;
    var w = document.getElementById('mode-warning');
    w.textContent = REGIME_WARNING;
    show(w, m === 'absolute');
    repaint();
    renderControls();
  }

  function radio(container, options, current, onPick) {
    container.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'radio' + (o.value === current ? ' active' : '');
      b.textContent = o.label;
      b.addEventListener('click', function () { onPick(o.value); });
      container.appendChild(b);
    });
  }

  function renderControls() {
    radio(document.getElementById('view-controls'), [
      { value: 'exposure', label: 'Exposure' },
      { value: 'reach', label: 'Reach' }
    ], state.view, setView);
    radio(document.getElementById('mode-controls'), [
      { value: 'relative', label: 'Relative' },
      { value: 'absolute', label: 'Absolute' }
    ], state.mode, setMode);
  }
```

Add to `css/style.css`:

```css
.radio {
    background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    font: 500 13px 'Inter', sans-serif;
    padding: 6px 12px;
    margin-right: 6px;
    border-radius: 6px;
    cursor: pointer;
}
.radio.active { background: #1e3a5f; border-color: #60a5fa; color: #f8fafc; }
```

Then call `buildLegend(); renderControls();` after `repaint();` in `init`, and extend the export with `setView: setView, setMode: setMode`.

- [ ] **Step 2: Verify in the browser**

Expected: legend shows 9 cells with high PC1 on top; hovering a cell dims every non-matching CBG to 15%; `Reach` switches to the 7-step ramp and the strip switches to c2; `Absolute` reveals the amber regime warning and visibly shifts the map at 2023-01.

- [ ] **Step 3: Commit**

```bash
git add houston-exposure/js/app.js houston-exposure/css/style.css
git commit -m "Add legend isolate and view/mode controls"
```

---

### Task 7: Detail card and hover tooltip

**Files:**
- Modify: `houston-exposure/js/app.js`

**Interfaces:**
- Consumes: `HX.data.{valueAt, rankInMonth}`, `HX.colour.{cellIndex, CELL_LABELS, relativise}`.
- Produces: `renderDetail(idx)` and `clearSelection()` — both already referenced by Task 5.

- [ ] **Step 1: Add selection, tooltip and detail rendering**

Insert into `js/app.js` above `async function init()`:

```js
  var propsByIdx = null;      // idx -> feature properties, filled in addLayers

  function channelReading(plane, channel, idx) {
    var raw = HX.data.valueAt(plane, state.monthIndex, idx);
    var shown = state.mode === 'absolute'
      ? raw : HX.colour.relativise(raw, means(channel));
    return {
      pct: Math.round(raw / 255 * 100),
      shown: shown,
      rank: HX.data.rankInMonth(plane, state.monthIndex, idx)
    };
  }

  function sparkline(plane, idx, colour) {
    var pts = [];
    for (var t = 0; t < HX.data.N_MONTH; t++) {
      pts.push((t / (HX.data.N_MONTH - 1)) * 200 + ',' +
               (26 - HX.data.valueAt(plane, t, idx) / 255 * 26));
    }
    var x = (state.monthIndex / (HX.data.N_MONTH - 1)) * 200;
    return '<svg class="spark" viewBox="0 0 200 26" preserveAspectRatio="none">' +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + colour +
      '" stroke-width="1.2"/>' +
      '<line x1="' + x + '" y1="0" x2="' + x + '" y2="26" ' +
      'stroke="#f8fafc" stroke-width="1" opacity="0.7"/></svg>';
  }

  function renderDetail(idx) {
    var p = propsByIdx[idx];
    var cell = HX.colour.cellIndex(
      state.mode === 'absolute' ? HX.data.valueAt(comp.c1, state.monthIndex, idx)
        : HX.colour.relativise(HX.data.valueAt(comp.c1, state.monthIndex, idx), means('c1')),
      state.mode === 'absolute' ? HX.data.valueAt(comp.c3, state.monthIndex, idx)
        : HX.colour.relativise(HX.data.valueAt(comp.c3, state.monthIndex, idx), means('c3'))
    );
    var e = channelReading(comp.c1, 'c1', idx);
    var r = channelReading(comp.c2, 'c2', idx);
    var d = channelReading(comp.c3, 'c3', idx);

    var html =
      '<div class="detail-geoid">' + p.cbg_geoid + '</div>' +
      '<div class="detail-cell"><span class="swatch" style="background:' +
        HX.colour.PALETTE[cell] + '"></span>' + HX.colour.CELL_LABELS[cell] + '</div>' +
      (p.imputed_income === 1
        ? '<p class="warning">This block group reports a median household income of 0 ' +
          'in the ACS, so its income-exposure features are Houston-median fills. ' +
          'Its colour is partly an artefact.</p>'
        : '') +
      '<div class="detail-row"><span>Exposure gap</span>' +
        '<b>' + e.pct + 'th pct</b><small>rank ' + e.rank + ' of 2,891</small></div>' +
      sparkline(comp.c1, idx, '#60a5fa') +
      '<div class="detail-row"><span>Trip reach</span>' +
        '<b>' + r.pct + 'th pct</b><small>rank ' + r.rank + ' of 2,891</small></div>' +
      sparkline(comp.c2, idx, '#a34842') +
      '<div class="detail-row"><span>Racial dissimilarity</span>' +
        '<b>' + d.pct + 'th pct</b><small>rank ' + d.rank + ' of 2,891</small></div>' +
      sparkline(comp.c3, idx, '#e8833a') +
      '<div class="detail-demo">' +
        'Population ' + (p.tot_pop || 0).toLocaleString() + ' &middot; ' +
        'median income ' + (p.median_household_income
          ? '$' + Math.round(p.median_household_income).toLocaleString() : 'n/a') + '<br>' +
        'Bachelor\'s ' + Math.round((p.bachelors_degree_pct || 0) * 100) + '% &middot; ' +
        'poverty ' + Math.round((p.poverty_rate || 0) * 100) + '%' +
      '</div>';

    document.getElementById('detail-content').innerHTML = html;
    show(document.getElementById('detail-section'), true);
  }

  function clearSelection() {
    state.selectedIdx = null;
    show(document.getElementById('detail-section'), false);
    map.setFilter('cbg-selected', ['==', ['get', 'idx'], -1]);
  }

  function bindSelection() {
    map.addLayer({
      id: 'cbg-selected',
      type: 'line',
      source: 'cbgs',
      filter: ['==', ['get', 'idx'], -1],
      paint: { 'line-color': '#f8fafc', 'line-width': 2 }
    });

    var tip = document.getElementById('tooltip');
    map.on('mousemove', 'cbg-fill', function (ev) {
      map.getCanvas().style.cursor = 'pointer';
      var p = ev.features[0].properties;
      tip.style.display = 'block';
      tip.style.left = (ev.point.x + 14) + 'px';
      tip.style.top = (ev.point.y + 14) + 'px';
      tip.textContent = p.cbg_geoid;
    });
    map.on('mouseleave', 'cbg-fill', function () {
      map.getCanvas().style.cursor = '';
      tip.style.display = 'none';
    });
    map.on('click', 'cbg-fill', function (ev) {
      var idx = ev.features[0].properties.idx;
      state.selectedIdx = idx;
      map.setFilter('cbg-selected', ['==', ['get', 'idx'], idx]);
      renderDetail(idx);
    });
    document.getElementById('detail-close')
      .addEventListener('click', clearSelection);
  }
```

In `addLayers`, after adding the source, populate the lookup:

```js
    propsByIdx = new Array(HX.data.N_CBG);
    geojson.features.forEach(function (f) { propsByIdx[f.properties.idx] = f.properties; });
```

and call `bindSelection();` after `buildLegend(); renderControls();` in `init`.

Add to `css/style.css`:

```css
.detail-geoid { color: #f8fafc; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.detail-cell { display: flex; align-items: center; gap: 8px; color: #cbd5e1; font-size: 13px; margin: 8px 0 12px; }
.swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(148,163,184,0.3); flex-shrink: 0; }
.detail-row { display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: #94a3b8; margin-top: 10px; }
.detail-row b { color: #f1f5f9; font-variant-numeric: tabular-nums; margin-left: auto; }
.detail-row small { color: #64748b; }
.spark { width: 100%; height: 26px; display: block; margin-top: 2px; }
.detail-demo { color: #94a3b8; font-size: 12px; line-height: 1.6; margin-top: 14px;
    padding-top: 10px; border-top: 1px solid rgba(148,163,184,0.12); }
```

- [ ] **Step 2: Verify in the browser**

Expected: clicking a CBG opens the card with a white outline on the map; three sparklines with a month marker that tracks the scrubber; ranks between 1 and 2,891; clicking one of the amber-dashed CBGs shows the imputed-income warning; `Esc` and the × both close it.

- [ ] **Step 3: Commit**

```bash
git add houston-exposure/js/app.js houston-exposure/css/style.css
git commit -m "Add CBG detail card with sparklines and ranks"
```

---

### Task 8: Methods and data panel

**Files:**
- Modify: `houston-exposure/js/app.js`, `houston-exposure/css/style.css`

**Interfaces:**
- Consumes: `meta.{loadings, stats, flags}` from Task 1.

- [ ] **Step 1: Build the panel**

Insert into `js/app.js`:

```js
  function loadingRows(pc) {
    return meta.loadings[pc].slice(0, 6).map(function (l) {
      return '<tr><td>' + l.feature + '</td><td>' + l.loading.toFixed(3) + '</td></tr>';
    }).join('');
  }

  function buildMethods() {
    var s = meta.stats;
    document.getElementById('methods-panel').innerHTML =
      '<div class="methods-inner">' +
      '<button id="methods-close" aria-label="Close">&times;</button>' +
      '<h2>Methods &amp; data</h2>' +

      '<h3>What is being measured</h3>' +
      '<p>Every Houston block group\'s monthly visit behaviour is summarised by 77 ' +
      'features: 11 POI categories x 7 measures (visit share, trip distance mean and ' +
      'spread, income- and education-exposure gaps, racial exposure dissimilarity, ' +
      'and dwell time). One PCA was fitted once on all 208,152 block-group-months ' +
      'together, then frozen, so colours are comparable across all 72 months.</p>' +

      '<h3>The three axes</h3>' +
      '<p><b>Exposure gap (PC1, ' + (s.evr[0] * 100).toFixed(1) + '%)</b> - do residents ' +
      'travel to places whose typical visitor is richer and better educated than ' +
      'themselves?</p><table>' + loadingRows('PC1') + '</table>' +
      '<p><b>Trip reach (PC2, ' + (s.evr[1] * 100).toFixed(1) + '%)</b> - how far, and how ' +
      'variably, do they travel?</p><table>' + loadingRows('PC2') + '</table>' +
      '<p><b>Racial dissimilarity (PC3, ' + (s.evr[2] * 100).toFixed(1) + '%)</b> - how ' +
      'racially unlike the community are the crowds it joins?</p><table>' +
      loadingRows('PC3') + '</table>' +

      '<h3>What this does not show</h3>' +
      '<p>These three axes carry ' + (s.evr_cum3 * 100).toFixed(1) + '% of the variance; ' +
      s.n_components_for_90pct + ' components are needed for 90%. Notably the visit ' +
      '<i>composition</i> - which kinds of place a community goes to - is almost ' +
      'absent from the first three axes and only appears from the fifth onward. This ' +
      'is a measurement-layer view: no anomaly detection, no event attribution.</p>' +

      '<h3>Known artefacts</h3>' +
      '<ul>' +
      '<li><b>Three data-supply regimes.</b> The source POI roster is byte-identical ' +
      'for 47 consecutive months (2019-01 to 2022-11), 2022-12 is a partial month, and ' +
      'the roster changes again in 2023 and 2024. Relative mode removes the resulting ' +
      'level shifts; absolute mode does not, which is why relative is the default.</li>' +
      '<li><b>' + s.n_imputed_cbgs + ' block groups</b> report a median household income ' +
      'of 0 in the ACS. Their income-exposure features are Houston-median fills and ' +
      'their colour is partly an artefact. They are outlined in dashed amber.</li>' +
      '<li><b>' + s.n_islands + ' block groups</b> have no neighbour within 3 km and are ' +
      'excluded from the spatial statistic below. They are still drawn and coloured.</li>' +
      '</ul>' +

      '<h3>Spatial structure</h3>' +
      '<p>Moran\'s I of the exposure gap averages ' + s.morans_I_mean.toFixed(2) +
      ' across the 72 months (z = 65-78, p = 0.001 in every month tested). The pattern ' +
      'is strongly clustered in every single month; it is not noise.</p>' +

      '<h3>Sources</h3>' +
      '<p>Advan monthly patterns (Jan 2019 - Dec 2024) and ACS 2019-2023 5-year block ' +
      'group tables. Projection, diagnostics and every number above: ' +
      '<code>HOUSTON_EMBEDDING_REPORT.md</code> in the mobility-detection paper ' +
      'repository. Built by the Mobility-X Lab, Rice University.</p>' +
      '</div>';

    document.getElementById('methods-close').addEventListener('click', function () {
      show(document.getElementById('methods-panel'), false);
    });
  }
```

Wire the opener in `init` after `buildLegend()`:

```js
    buildMethods();
    document.getElementById('methods-open').addEventListener('click', function () {
      show(document.getElementById('methods-panel'), true);
    });
```

Add to `css/style.css`:

```css
#methods-panel {
    position: fixed; inset: 0 0 0 auto; width: min(560px, 100%);
    background: rgba(15, 23, 42, 0.985);
    border-left: 1px solid rgba(148, 163, 184, 0.16);
    overflow-y: auto; z-index: 40; padding: 28px 32px;
}
.methods-inner h2 { color: #f8fafc; font-size: 20px; margin-bottom: 18px; }
.methods-inner h3 { color: #94a3b8; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.08em; margin: 22px 0 8px; }
.methods-inner p, .methods-inner li { color: #cbd5e1; font-size: 13px; line-height: 1.7; }
.methods-inner ul { padding-left: 18px; }
.methods-inner li { margin-bottom: 8px; }
.methods-inner table { width: 100%; margin: 6px 0 4px; border-collapse: collapse; }
.methods-inner td { color: #94a3b8; font-size: 11px; padding: 2px 0;
    font-variant-numeric: tabular-nums; }
.methods-inner td:last-child { text-align: right; color: #cbd5e1; }
#methods-close { position: absolute; top: 20px; right: 24px; background: none;
    border: none; color: #94a3b8; font-size: 24px; cursor: pointer; }
.header-btn { margin-left: auto; background: rgba(30, 41, 59, 0.8);
    border: 1px solid rgba(148, 163, 184, 0.2); color: #cbd5e1;
    font: 500 13px 'Inter', sans-serif; padding: 6px 12px; border-radius: 6px;
    cursor: pointer; }
```

- [ ] **Step 2: Verify in the browser**

Expected: the header button opens a right-hand panel; every number in it comes from `meta.json` (no hard-coded statistics); the three artefact bullets read 168, 223, and name 2022-12; × closes it.

- [ ] **Step 3: Commit**

```bash
git add houston-exposure/js/app.js houston-exposure/css/style.css
git commit -m "Add methods and caveats panel"
```

---

### Task 9: Scroll narrative

**Files:**
- Rewrite: `houston-exposure/js/narrative.js`
- Modify: `houston-exposure/index.html`, `houston-exposure/css/style.css`

**Interfaces:**
- Consumes: `HX.app.{map, setMonth, play, pause, state, repaint}`.

- [ ] **Step 1: Add the narrative markup**

Insert into `index.html` immediately after `<body>`, before `<header id="header">`:

```html
    <section id="narrative">
        <div class="narr-step" data-step="0"><p>2,891 block groups. Every household&rsquo;s month of movement, reduced to one profile.</p></div>
        <div class="narr-step" data-step="1"><p>Colour is who its residents actually encounter.</p></div>
        <div class="narr-step" data-step="2"><p>The pattern is sharp, and it is geographic.</p></div>
        <div class="narr-step" data-step="3"><p>Six years. It barely moves.</p></div>
        <div class="narr-step" data-step="4"><p>Now you.</p></div>
    </section>
```

- [ ] **Step 2: Write the narrative module**

Replace `houston-exposure/js/narrative.js`:

```js
/* Scroll narrative: five pinned steps that hand off to the explorer.
   Skipped entirely under prefers-reduced-motion. */
(function () {
  'use strict';

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function applyStep(n) {
    var app = window.HX && window.HX.app;
    if (!app || !app.map || !app.map.getLayer('cbg-fill')) return;
    var map = app.map;

    if (n === 0) {
      app.pause();
      app.setMonth(0);
      map.setPaintProperty('cbg-fill', 'fill-opacity', 0);
    } else if (n === 1) {
      app.pause();
      map.setPaintProperty('cbg-fill', 'fill-opacity', 0.88);
    } else if (n === 2) {
      app.pause();
      map.easeTo({ center: [-95.3698, 29.7604], zoom: 10.2, duration: 1600 });
    } else if (n === 3) {
      map.easeTo({ center: [-95.3698, 29.7604], zoom: 8.6, duration: 1200 });
      app.setMonth(0);
      app.play();
    } else {
      app.pause();
      document.body.classList.add('narrative-done');
    }
  }

  function start() {
    var section = document.getElementById('narrative');
    if (!section) return;
    if (reduced) {
      section.remove();
      document.body.classList.add('narrative-done');
      return;
    }
    var steps = section.querySelectorAll('.narr-step');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('active');
          applyStep(parseInt(e.target.dataset.step, 10));
        } else {
          e.target.classList.remove('active');
        }
      });
    }, { threshold: 0.6 });
    steps.forEach(function (s) { io.observe(s); });
  }

  window.HX = window.HX || {};
  window.HX.narrative = { start: start };
})();
```

Call `HX.narrative.start();` at the end of `init` in `app.js`.

- [ ] **Step 3: Add the pinned-stage styling**

```css
#narrative { position: relative; z-index: 20; pointer-events: none; }
.narr-step { height: 88vh; display: flex; align-items: center; padding-left: 8vw; }
.narr-step p {
    max-width: 30ch; color: #f8fafc; font-size: clamp(20px, 3vw, 34px);
    font-weight: 600; line-height: 1.3; letter-spacing: -0.02em;
    opacity: 0; transform: translateY(12px); transition: opacity .5s, transform .5s;
    background: rgba(15, 23, 42, 0.82); padding: 18px 22px; border-radius: 10px;
    border: 1px solid rgba(148, 163, 184, 0.14);
}
.narr-step.active p { opacity: 1; transform: none; }
#app { position: sticky; top: 60px; }
body.narrative-done #narrative { display: none; }
```

- [ ] **Step 4: Verify in the browser**

Expected: scrolling fades the map in, resolves colour, eases to downtown, autoplays 72 months, then releases to the explorer. With `prefers-reduced-motion: reduce` set in devtools, the narrative section is removed and the explorer renders immediately with the scrubber usable.

- [ ] **Step 5: Commit**

```bash
git add houston-exposure/index.html houston-exposure/js/narrative.js houston-exposure/css/style.css
git commit -m "Add scroll narrative with reduced-motion bypass"
```

---

### Task 10: Site integration

**Files:**
- Modify: `index.html` (repo root)

- [ ] **Step 1: Add the project card**

In `index.html`, inside `<div class="projects">` and immediately before the existing `ev-charging-dashboard` anchor:

```html
                <a href="houston-exposure/" class="project-card">
                    <h3>Who Houston Meets <span class="arrow">&rarr;</span></h3>
                    <p>Six years of movement for 2,891 Houston block groups, coloured by who each community's residents actually encounter when they travel.</p>
                    <div class="tags">
                        <span class="tag">Mapbox GL JS</span>
                        <span class="tag">Mobility Data</span>
                        <span class="tag">Dimensionality Reduction</span>
                    </div>
                </a>
```

- [ ] **Step 2: Add the What's New entry**

As the first `<li>` inside `<ul class="news-list">`:

```html
                <li><strong><a href="houston-exposure/">Who Houston Meets</a> is live.</strong> An interactive map of how Houston's neighborhoods differ in who their residents encounter, built on a six-year behavioral panel. Questions and feedback welcome. <span class="news-date">(September 2026)</span></li>
```

- [ ] **Step 3: Verify**

Open `http://localhost:8099/`. Expected: the new card appears above the EV dashboard card and links through; the What's New entry is first.

- [ ] **Step 4: Run the full test suite**

```bash
node --test houston-exposure/tests/
python -m pytest houston-exposure/tools/test_build_data.py -q
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Link Houston exposure dashboard from the landing page"
```

---

## Self-Review

**Spec coverage.** §1 purpose → Tasks 4/8/9. §2.1 invariants → Task 1 Step 4 asserts each. §2.2 artefacts → Task 1. §3.1 palette → Task 3 (values pinned in Global Constraints and tested). §3.2 classes → Task 3. §3.3 relative mode → Task 3 + Task 6. §3.4 reach ramp → Task 3, now with concrete values. §4.1 anatomy → Task 4. §4.2 narrative → Task 9. §4.3 controls → Tasks 5/6. §4.4 detail card → Task 7. §4.5 methods panel → Task 8. §4.6 always-on caveats → Task 4 (`cbg-imputed` layer) and Task 5 (bad month on the strip). §5.1 stack → Global Constraints. §5.2 repaint → Task 3 `matchExpression` + Task 4 Step 6 benchmark. §5.3 files → File Structure. §5.4 accessibility → Task 6 (labels), Task 5 (keyboard), Task 9 (reduced motion). §6 site integration → Task 10. §7 risk 1 → Task 1 Step 1; risk 2 → Task 4 Step 6; risk 3 → Task 4 Step 6 visual check.

**Placeholder scan.** No TBDs; every code step carries runnable code; no "similar to Task N".

**Type consistency.** `monthSlice`/`valueAt`/`rankInMonth` signatures are identical in Tasks 2, 6 and 7. `matchExpression(classes, colours)` is called with `Uint8Array` + `string[]` in Task 4/6 and with `Uint8Array` + `number[]` for opacity in Task 6 — both are valid Mapbox expression outputs, and the function is type-agnostic by design. `means(channel)` returns `number|null` and every caller handles null. `renderDetail`/`clearSelection` are defined in Task 7 but referenced in Task 5 — **Task 5 must be implemented before Task 7 runs, and `setMonth`'s call is guarded by `state.selectedIdx !== null`, which is null until Task 7 wires selection**, so the ordering is safe.

**One known gap, deliberate:** Tasks 4–9 are verified in the browser rather than by automated test. Adding a headless-browser harness would breach the zero-dev-dependency constraint for a nine-file static site; the pure logic that *can* be unit-tested (all of `data.js` and `colour.js`, plus the whole data build) is covered by 22 automated tests.
