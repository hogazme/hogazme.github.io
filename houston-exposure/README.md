# Who Houston Meets — design notes

Route: `hogazme.github.io/houston-exposure/`. A map of 2,891 Houston census block groups
over 72 months (2019-01 … 2024-12), each coloured by *who its residents encounter* when
they go out. Static files only; no build step, no framework.

The design spec that preceded this build is at
`docs/superpowers/specs/2026-09-02-houston-exposure-dashboard-design.md`. This file records
what was actually shipped and why it differs from the spec where it does.

## The claim, and how the page makes it

**Where you live decides who you encounter.** Two of the three dominant axes of Houston's
movement profile are exposure axes: the socioeconomic gap between a community and the
crowds it travels into (PC1, 21% of variance) and the racial dissimilarity of those crowds
(PC3, 11%). Both are strongly spatially clustered in every month (Moran's I ≈ 0.44,
z ≈ 65–78). The map colours each block group by its cell in a 3 × 3 grid of PC1 × PC3.

The page has three layers of reading, for three depths of attention:

1. **The intro card** (first frame, ~20 seconds). Headline, four sentences, the four
   corner colours named in words. A stranger who reads only this and looks at the map
   behind it has the claim.
2. **The explorer** (minutes). A labelled bivariate legend with a live reading line,
   hover tooltips that state the cell and three percentiles, a click-to-open detail card
   with 72-month sparklines, view and mode controls, and the month transport.
3. **Methods & data** (for a reviewer). A slide-over with the taxonomy, the seven measure
   families, the three components with loadings, variance stated honestly, the
   data-supply regimes with the frozen POI counts, and every known artefact.

## Where the build departs from the spec

**No pinned scrollytelling.** The spec called for five scroll-driven steps over a pinned
map (fills fading in, a camera ease to the 610 loop, autoplay, then release). It was
replaced by the single intro card. Three reasons:

- The claim is a *spatial pattern*. A still frame with the whole metro in view shows it
  better than a camera move; every step in the plan was either a still or a camera move
  toward a still.
- Scroll-jacking a full-bleed map is the most fragile piece of front-end on the plan
  (IntersectionObserver thresholds, sticky positioning inside a flex column, touch
  scrolling on the map canvas, reduced-motion bypass). It was the one component that could
  make the page feel broken to a first-time visitor, on the one visit that matters.
- "Six years, it barely moves" is a better *invitation* than a *demonstration*: the intro
  says "press play and watch", and the play button is right there. Handing the climax to
  the visitor is more persuasive than autoplaying it at them.

The narrative copy survives, compressed: the five captions became the card's four
sentences plus the kicker.

**Legend has axes.** The spec's legend was a 3 × 3 grid with readings on hover. A
bivariate legend without axis labels is not readable, so both axes are labelled
("richer, better-educated crowds →" up, "racially unlike crowds →" right) and the hover
reading is a live text line under the grid rather than a native `title` tooltip. Hovering
a block group on the map also highlights its legend cell.

**Hover tooltip says something.** The plan's tooltip showed only the GEOID. It now shows
the cell reading with its swatch, the three percentiles, and county / tract / block group
parsed from the GEOID, plus an "income imputed" note where relevant.

**View labels are questions, not variables.** "Who they meet" / "How far they go" rather
than "Exposure" / "Reach". The sidebar carries a one-line note under each control saying
what it does.

**Sparklines are mode-consistent.** In relative mode the detail-card sparklines show
relativised values, matching the map, with a dashed midline at the Houston mean. In
absolute mode they show raw pooled ranks. 2022-12 is ticked in amber on every sparkline.

**Mean strip carries the regime boundaries.** Faint verticals at 2022-12, 2023-01 and
2024-01 with year labels, so the level steps in the Houston-wide mean are attributable
at a glance. The strip autoscales to the channel's own range and is drawn as a line, not
bars, because bars from a truncated baseline overstate ratios.

**Imputed-income block groups are outlined, not hatched.** A dashed amber outline on the
168 CBGs whose ACS median income is 0. A true hatch fill needs a raster pattern image and
a second fill layer; the outline reads clearly at every zoom and costs nothing.

**Mobile layout exists.** The spec's shell was fixed at 370 px + `overflow: hidden`. Below
820 px the map stacks above a scrolling sidebar, the intro becomes a full-height
scrollable sheet, and the transport compacts.

## Revisions after the first review (2026-09-03)

**Light basemap.** `streets-v12` instead of `dark-v11`, at the user's request ("think of how
Google Maps looks"). The block-group layers are inserted *below* the basemap's water,
roads and labels, so the street network and place names draw crisply over the colour.

**Fills thin out as you zoom.** `fill-opacity` is a zoom curve (0.82 at z8 → 0.62 at
z10.5 → 0.42 at z13) so the map underneath reads through once you zoom in. The legend
isolate multiplies into each stop of that curve, because Mapbox only allows `['zoom']`
at the top level of an expression.

**Palette re-derived for a light surface.** The spec's palette was validated against the
dark ground and its "unlike on both" corner was cream, which vanishes on a light map. The
new grid keeps the hue semantics (blue = richer crowds, orange = racially unlike crowds,
the recessive corner = "like itself") but flips the lightness axis: pale warm grey
`#dcd6cc` for like-itself, dark plum `#4b2a5a` for unlike-on-both. Bilinear in OKLab from
four corners; validated on surface `#efece4`, corners + centre, all pairs: CVD ΔE 14.6,
normal-vision 17.7. The same two out-of-scope FAILs (lightness band, chroma floor) and the
same contrast WARN on the pale corner apply, discharged the same way (hairline strokes,
tooltip, detail card). The reach ramp became a light-midpoint blue↔red.

**"How far they go" now shows the radius of gyration, not PC2.** The panel gained an `rg`
family (per-category radius of gyration of visited places, km). The shipped value is the
visit-share-weighted mean across categories with a defined radius, i.e. the spatial extent
of where the community's visits actually went, independent of distance from home. It is
converted to pooled percentile ranks exactly like the components (plane 4 of
`components.bin`) and shipped alongside in half-kilometres (plane 5) so the tooltip and
detail card can state it in km. Houston median 13.4 km. PC2 remains in the binary and in
the methods panel as part of the projection, but nothing on the map uses it.

## Colour

The bivariate palette and the diverging reach ramp are the validated values from spec §3
and are not touched. The two documented validator deviations still hold and are still
deliberate: the low-low corner recedes toward the surface and adjacent cells sit at
ΔE ≈ 12.8, resolved by the legend isolate (hover a cell, everything else drops to 15%
opacity) and the hover tooltip.

**Relative mode is the default** because the panel contains three data-supply regimes
(POI roster frozen for 47 months, one broken month, then two step changes) that move the
whole-map mean of PC2 by 84 of 255 levels. Absolute mode is available and carries a
persistent warning naming the regimes. Both modes use the same tercile cuts (85 / 170);
only the input values shift.

## Files

```
index.html          shell, intro card, sidebar, transport, methods panel mount
css/style.css       all styling; tokens in :root; one breakpoint at 820 px
js/config.js        MAPBOX_TOKEN (force-added past .gitignore, like htx-worldcup)
js/data.js          components.bin decoding, month slices, ranks      (unit-tested)
js/colour.js        palette, tercile classes, relative offsets, match expressions (unit-tested)
js/methods.js       Methods & data panel: meta.json -> HTML
js/app.js           map, layers, controls, detail card, tooltip, intro, methods wiring
data/               components.bin (1,040,760 B, 5 planes), meta.json, houston_cbgs.topo.json
tools/build_data.py regenerates data/ from mobility_detection_paper/houston_embedding/
tests/              node --test tests/*.test.js
```

Payload ≈ 2.9 MB. A month change is one `setPaintProperty` with a memoised `match`
expression grouped by colour (≤ 9 branches), so 72-month autoplay at ~9 fps is a single
GPU repaint per frame.

## Verifying

Unit tests: `node --test tests/*.test.js` from this directory (18 tests).

Browser: the Mapbox token is URL-restricted to `hogazme.github.io`, so a local server
renders the block groups but no basemap tiles (403s in the console are expected), and
with no style loaded the layer-ordering heuristic has nothing to slot under — anything
that depends on the basemap has to be checked on the live site. Headless
verification over CDP is described in the project memory; the checks that matter are that
the loading overlay clears, four `cbg-*` layers exist, the legend isolate produces a
`match` expression on `fill-opacity`, and Escape closes methods → intro → selection in
that order.

## Known limits

- No per-block-group feature breakdown. The dashboard ships only PC1–3, not the 77
  features, so "which features drive *this* block group" is not answerable here.
- Visit composition (what kinds of places a community goes to) is not on the map; it does
  not appear in the projection until PC5.
- Place names are county / tract / block group parsed from the GEOID; there is no
  neighbourhood-name lookup.
- `HOUSTON_EMBEDDING_REPORT.md` lives in the sibling `mobility_detection_paper` repo and is
  not published; the methods panel transcribes what it needs rather than linking.
