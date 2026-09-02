# Houston Exposure Dashboard — Design

**Status:** approved for planning · **Date:** 2026-09-02 · **Route:** `hogazme.github.io/houston-exposure/`

> **Built 2026-09-02.** Shipped with deliberate departures from §4.2 (no pinned scrollytelling; a
> one-frame intro card instead), §4.3 (legend carries axis labels and a live reading line) and
> §4.6 (imputed CBGs outlined, not hatched). The record of what shipped and why is
> `houston-exposure/README.md`.

A scroll-then-explore map of Houston's behavioural geography. 2,891 census block groups ×
72 months (2019-01 … 2024-12), each coloured by a two-axis summary of *who its residents
encounter* when they travel.

---

## 1. Purpose

**Lead claim: "Where you live decides who you encounter."**

Two of the three dominant axes of Houston's mobility profile are exposure axes — the
socioeconomic gap between a community and the crowds it travels into (PC1, 21.3% of
variance) and the racial dissimilarity of those crowds (PC3, 11.2%) — and both are
sharply spatially patterned (Moran's I ≈ 0.44 in every one of 72 months, z = 65–78).
Segregation is legible in movement, not only in residence.

**Audience, in priority order:**

1. **Site visitors** — recruiters, collaborators, curious readers arriving cold. Must land
   the claim in ~30 seconds without touching a control or reading a legend.
2. **Paper readers** — linkable from the mobility-detection paper / SI without
   embarrassment. Methods and caveats one click away, never deleted.

**Success criteria**

- A stranger who only scrolls understands the claim and remembers the map.
- A reviewer can reach the taxonomy, the component definitions, the variance accounting,
  and every known artefact within one click.
- Total payload under 3 MB; interaction at 60 fps including 72-month autoplay.
- Nothing on screen misrepresents the data — in particular the 2023/2024 data-supply
  regimes must not read as behavioural change.

**Non-goals.** No detection, no event attribution, no |Z| or residuals — this is the
measurement layer only. No metro other than Houston. No server; static files on GitHub
Pages.

---

## 2. Data contract

### 2.1 Upstream (already built, read-only)

Produced by `mobility_detection_paper/houston_embedding/build_embedding.py` and documented
in `HOUSTON_EMBEDDING_REPORT.md` in that directory. The dashboard consumes:

| Upstream file | Used for |
|---|---|
| `houston_components_uint8.parquet` | c1/c2/c3, uint8 pooled percentiles, 208,152 rows |
| `houston_monthly_component_means.csv` | `pcK_mean_uint8` — the relative-mode offsets |
| `houston_cbgs.topo.json` | 2,891 polygons, 1.74 MB, simplified |
| `houston_pca_loadings_pc1_3_sorted.csv` | top loadings for the methods panel |
| `houston_imputation_mask.parquet` | the 168 zero-ACS-income CBGs to flag |
| `houston_embedding_results.json` | variance, Moran's I, regime numbers for the methods panel |

**Invariants the build step must assert** (fail loudly, do not coerce):

- 208,152 rows = 2,891 CBGs × 72 months, months contiguous 2019-01 … 2024-12
- every `cbg_geoid` in the component table has a polygon in the TopoJSON, and vice versa
- c1/c2/c3 are `uint8`, full 0–255 range present

### 2.2 Shipped artefacts

Built by `houston-exposure/tools/build_data.py` (run rarely; committed output):

**`data/houston_cbgs.topo.json`** — 1.74 MB. Copied verbatim. Properties per feature:
`cbg_geoid`, `idx` (0-based row index into the binary, **added by the build step**),
`tot_pop`, `median_household_income`, `bachelors_degree_pct`, `poverty_rate`,
`white_pct`, `black_pct`, `asian_pct`, `hispanic_pct`, `imputed_income` (0/1).

**`data/components.bin`** — 624,456 bytes, no header. Three contiguous planes of
208,152 `uint8`:

```
plane 0  bytes [0,          208152)   c1  exposure gap        (PC1)
plane 1  bytes [208152,     416304)   c2  trip reach          (PC2)
plane 2  bytes [416304,     624456)   c3  racial dissimilarity(PC3)

within a plane:  offset = monthIndex * 2891 + cbgIdx
```

Month-major so that one month of one channel is a **contiguous 2,891-byte slice** — the
exact read pattern the repaint loop needs.

**`data/meta.json`** — small. Contains:

```jsonc
{
  "n_cbgs": 2891, "n_months": 72,
  "months": ["2019-01", …, "2024-12"],
  "cbg_geoids": [480157601002, …],          // index order of the binary
  "monthly_mean_uint8": { "c1": [72 floats], "c2": [...], "c3": [...] },
  "flags": { "bad_months": ["2022-12"],
             "regimes": [{"label":"A","from":"2019-01","to":"2022-11"}, …] },
  "loadings": { "PC1": [{feature, loading}, …12], "PC2": [...], "PC3": [...] },
  "stats": { "evr": [.2125,.1497,.1116], "evr_cum3": .4738,
             "morans_I_mean": .4371, "n_islands": 223, "n_imputed_cbgs": 168 }
}
```

---

## 3. Colour system

### 3.1 Bivariate palette (validated)

Derived by bilinear interpolation in OKLab between four chosen corners, then validated
with the `dataviz` skill's `validate_palette.js` against the **actual site surface
`#0f172a`** in dark mode, `--pairs all`.

```
                       racial dissimilarity (PC3)  →
                  low          mid          high
   high  PC1    #60a5fa      #acc9e5      #f5e9c8
   mid   PC1    #42689a      #9a9196      #f1b785
   low   PC1    #243044      #825b4a      #e8833a
```

**Semantics.** Lightness = how unlike the encountered crowds are overall; hue = which kind
of unlikeness. Dark slate = travels among people like itself on both dimensions. Blue =
economically unlike, racially similar. Orange = racially unlike, economically similar.
Cream = unlike on both.

**Validation result** (corners + centre, dark, surface `#0f172a`, all-pairs):

| Check | Result |
|---|---|
| CVD separation | **PASS** — worst ΔE 12.0 (protan) |
| Normal-vision floor | **PASS** — worst ΔE 15.1 |
| Lightness band / chroma floor | FAIL — **out of scope**, see below |
| Contrast vs surface | WARN — `#243044` at 1.34:1, relief required |

Three alternatives were generated and rejected on the transferable gates: blue×red→magenta
(CVD ΔE 3.3 protan), teal×magenta (3.7 deutan), blue×yellow→green (normal-vision 12.1).

**Two documented deviations, both deliberate — do not "fix" them:**

1. **Lightness-band and chroma-floor FAILs are out of the validator's scope.** Its own
   footer states "categorical palettes only". A bivariate scheme must have a low-low corner
   that recedes toward the surface and a near-neutral centre; those are the encoding, not
   defects.
2. **Adjacent cells sit at ΔE ≈ 12.8, below the categorical floor.** Also intentional —
   adjacent cells of an ordered 2-D scale *should* be similar; that similarity is the
   continuum. Resolved by secondary encoding (§4.3 legend isolate + hover tooltip).

**The contrast WARN is discharged, not dismissed** (the skill forbids dismissing it): every
polygon carries a visible hairline stroke `rgba(148,163,184,0.22)` at 0.5 px, so the
low-low cell is separated from the surface by geometry regardless of fill; and every CBG's
values are readable via hover tooltip and the detail card.

### 3.2 Class assignment

`c1` and `c3` are pooled percentile ranks, so terciles fall exactly at **85 and 170**, and
absolute-mode cells are equal-count by construction.

```
class(v)  = v < 85 ? 0 : v < 170 ? 1 : 2
cellIndex = class(c1) * 3 + class(c3)        // 0..8 into PALETTE below
```

The palette is stored **row-major from low PC1 to high PC1**, which is the inverse of how
the grid is drawn above (legends read bottom-up, arrays don't). Written out to remove any
chance of a flipped-row bug:

```js
const PALETTE = [
  '#243044', '#825b4a', '#e8833a',   // 0,1,2  low  PC1 × low, mid, high PC3
  '#42689a', '#9a9196', '#f1b785',   // 3,4,5  mid  PC1
  '#60a5fa', '#acc9e5', '#f5e9c8',   // 6,7,8  high PC1
];
```

### 3.3 Relative mode (default)

Per §7 of the embedding report, the panel contains three data-supply regimes and the
whole-map mean of c2 swings 83.5 of 255 levels across them. Absolute mode therefore shows
all of Houston changing colour at 2023-01 and 2024-01 for reasons that are not behavioural.

```
v_rel = clamp(round(v - monthly_mean_uint8[channel][month] + 128), 0, 255)
```

then the same tercile cuts. This is exactly the client-side subtraction the upstream
`pcK_mean_uint8` column was emitted for. **Relative is the default**; Absolute is
selectable and carries a persistent inline warning naming the regimes.

### 3.4 Reach view (PC2)

Single diverging ramp on the skill's blessed pair (blue ↔ red, neutral grey midpoint
`#383835`), 7 equal-width steps over 0–255. The neutral step is centred on **128 in
relative mode** (where §3.3 has already re-centred the month) and on **the pooled median,
128, in absolute mode** — i.e. the same breaks in both modes; only the input values shift.

---

## 4. Interface

### 4.1 Anatomy

Reuses `htx-worldcup`'s shell: 60 px header, 370 px left sidebar, dark tokens
(`#0f172a` ground, `rgba(15,23,42,0.97)` panels, `rgba(148,163,184,0.12)` borders,
`#94a3b8` labels, `#f8fafc` headings, Inter).

```
┌──────────────────────────────────────────────────────┐
│  Who Houston Meets              [ Methods & data ▸ ] │
├──────────┬───────────────────────────────────────────┤
│ LEGEND   │                                           │
│  3×3     │            MAPBOX  dark-v11               │
│ VIEW     │            2,891 CBG fills                │
│ MODE     │            hairline strokes               │
│ DETAIL   │                                           │
│ footer   │                                           │
├──────────┴───────────────────────────────────────────┤
│ ▶  2019-01 ├──────●────────────────┤ 2024-12         │
│    monthly-mean strip  ▁▂▃▂▁▂▃▅▇▇▇▅▂▁  ⚠2022-12      │
└──────────────────────────────────────────────────────┘
```

Sidebar footer matches htx-worldcup: Mobility-X Lab · contact · version.

### 4.2 Narrative (pinned stage, precedes the explorer)

Five scroll-driven steps over a pinned map, ~8 s if scrolled steadily. Each step sets map
state and shows a caption; no step requires interaction.

| # | Caption | Map state |
|---|---|---|
| 1 | "2,891 block groups. Every household's month of movement, reduced to one profile." | fills at 0 opacity, strokes only, 2019-01 |
| 2 | "Colour is who its residents actually encounter." | fills fade in; legend builds cell by cell |
| 3 | "The pattern is sharp, and it is geographic." | camera eases to the 610 loop; "Moran's I = 0.44" annotation |
| 4 | "Six years. It barely moves." | 72 months autoplay ~8 s; strip chart runs; map holds still |
| 5 | "Now you." | controls slide in; scroll releases the map |

Step 4 *is* the month scrubber autoplaying — the month control is the climax of the
narrative, not an afterthought below it.

**Reduced motion.** `prefers-reduced-motion: reduce` skips the pin entirely: the explorer
renders directly with the captions as static standfirst text.

### 4.3 Explorer controls

- **Legend** — 3×3 grid, each cell labelled on hover with its plain-language reading.
  Hovering a cell drops all non-matching CBGs to 15% opacity. This is the secondary
  encoding that makes individual cells resolvable (§3.1).
- **View** — `Exposure` (bivariate) / `Reach` (PC2 diverging). Radio, not a toggle.
- **Mode** — `Relative` (default) / `Absolute` + warning.
- **Transport** — range input over 72 months; `▶` play/pause (~9 fps, one full pass ≈ 8 s);
  `←`/`→` step; `space` play; `Esc` clears selection. The monthly-mean strip beneath is
  both a scrub target and the honest disclosure of the regime steps.

### 4.4 Detail card (on CBG click)

GEOID · its legend cell with the plain-language reading · three 72-month sparklines
(c1/c2/c3, current month marked) · each channel's value stated numerically as a percentile
and as a rank within Houston for the current month · ACS demographics from the baked
properties · **`imputed income` badge** where applicable.

**Explicitly not** a per-CBG feature breakdown. The dashboard ships only c1/c2/c3, not the
77 underlying features, so "which features drive *this* CBG" is not answerable from the
payload. The methods panel carries the components' global top loadings instead; anything
per-CBG would require shipping the panel and is out of scope.

### 4.5 Methods & data panel

Slide-over from the header. Contents: the 11-category taxonomy; PC1/PC2/PC3 with top
loadings and plain-language readings; variance stated honestly (47.4% for PC1–3, 25
components for 90%); the regime table with the frozen POI counts; the 168 imputed-income
CBGs; the 223 Moran islands; and direct links to `HOUSTON_EMBEDDING_REPORT.md` and the
data files.

### 4.6 Always-on caveats

- The 168 imputed-income CBGs carry a hatch overlay in every view.
- 2022-12 is flagged on the transport and its caption names it a partial-data month.

---

## 5. Technical architecture

### 5.1 Stack

Mapbox GL JS 3.9.4 (matching both existing dashboards), `topojson-client` from cdnjs
(~7 KB), no framework, no build step, no bundler. `js/config.js` holds `MAPBOX_TOKEN`,
force-added past `.gitignore` exactly as `htx-worldcup/js/config.js` is.

### 5.2 The repaint mechanism (the one real engineering decision)

Naively, a month change means recolouring 2,891 features. 2,891 `setFeatureState` calls at
9 fps will jank the autoplay. Instead:

- TopoJSON → GeoJSON once at load; source uses `promoteId: 'cbg_geoid'`; each feature
  carries a baked `idx`.
- **A month change is a single `map.setPaintProperty('cbg-fill', 'fill-color', expr)`**,
  where `expr` is a `['match', ['get','idx'], 0, colour0, 1, colour1, …]` built by reading
  the month's contiguous 2,891-byte slices from `components.bin`. One call; Mapbox
  recompiles once and repaints on the GPU.
- Expressions are memoised per (month, view, mode) so scrubbing back and forth is free.

**Fallback if the 2,891-entry expression proves slow to compile** (spike this first): bake
72 class properties (`m0`…`m71`, values 0–8) into the source and switch with a
`['match', ['get', 'm'+i], …]` of 9 entries. Costs ~250 KB gzipped in the geometry file.

### 5.3 Files

```
houston-exposure/
  index.html
  css/style.css
  js/
    config.js        MAPBOX_TOKEN (force-added)
    data.js          fetch + decode components.bin, meta.json; accessors
    colour.js        palette, tercile classes, relative-mode offsets, expression builder
    narrative.js     scroll observer, the five steps, reduced-motion bypass
    app.js           map init, layers, controls, detail card, methods panel
  data/
    houston_cbgs.topo.json    1.74 MB
    components.bin            610 KB
    meta.json                 ~50 KB
  tools/
    build_data.py    regenerates data/ from mobility_detection_paper/houston_embedding/
```

Payload ≈ **2.4 MB** (vs 36 MB for `htx-worldcup`).

### 5.4 Accessibility

Legend is never colour-alone — every cell carries a text reading, and the detail card
states values numerically. Keyboard operable throughout. `prefers-reduced-motion`
honoured. Focus states on all controls.

---

## 6. Site integration

- **Interactive Projects** card on `index.html`, matching the existing markup. Tags:
  `Mapbox GL JS` · `Mobility Data` · `Dimensionality Reduction`.
- **What's New** entry dated September 2026.

---

## 7. Risks, to retire in this order

1. **Mapbox token URL restriction.** If scoped to `hogazme.github.io/htx-worldcup/*` the
   new path 401s. Five minutes to check, and it blocks everything visual.
2. **`match` expression compile cost at 2,891 entries.** Spike before building the UI;
   §5.2 names the fallback.
3. **Whether the tercile cuts read.** Render 2019-06 and look at it before committing the
   palette; if the map muddies, the fix is quartile cuts (4×4) or shifted breaks, decided
   on evidence rather than taste.

---

## 8. Out of scope

Other metros · detection or event attribution · PC4–PC10 in the UI (shipped in the
upstream parquet, not the dashboard) · any server component · rebuilding the panel or
refitting the projection.
