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

  /* Row-major, low -> high PC1. The legend draws bottom-up; this array does not.
     Bilinear in OKLab between four corners, for a LIGHT basemap: the low-low
     corner is a pale warm grey that recedes into the land colour; blue = richer
     crowds; orange = racially unlike crowds; the high-high corner is a dark plum
     so "unlike on both" is the cell that pops. Validated against surface #efece4
     (corners + centre, all pairs): CVD worst 14.6, normal-vision worst 17.7. */
  var PALETTE = [
    '#dcd6cc', '#e2a780', '#e0731f',   // 0,1,2  low  PC1
    '#839fcf', '#8f798f', '#915150',   // 3,4,5  mid  PC1
    '#2b62c9', '#454790', '#4b2a5a'    // 6,7,8  high PC1
  ];

  var CELL_LABELS = [
    'Travels among people like itself',
    'Similar incomes, different races',
    'Similar incomes, very different races',
    'Somewhat richer crowds, similar races',
    'Middling on both',
    'Somewhat richer crowds, very different races',
    'Much richer crowds, similar races',
    'Much richer crowds, somewhat different races',
    'Richer and racially unlike crowds'
  ];

  /* Diverging blue <-> red with a light neutral midpoint, for the light
     basemap: tighter footprint than Houston in blue, wider in red. */
  var REACH_RAMP = [
    '#1d5fb8', '#6d9fd8', '#bcd3ea', '#cfcbc2',
    '#f0b89b', '#e07a55', '#b5301f'
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
     Mapbox accepts an ARRAY of labels per branch, so 2,888 features collapse
     to one branch per colour instead of 2,888 branches. Colours no feature
     uses are omitted entirely.
     `fallback` defaults to a transparent colour (the historical behaviour for
     `fill-color` call sites); callers building a non-colour expression (e.g.
     the numeric `fill-opacity` isolate) must pass an explicit fallback of the
     matching type, since Mapbox validates that every branch of an expression
     shares one output type. */
  function matchExpression(classes, colours, fallback) {
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
    expr.push(fallback === undefined ? 'rgba(0,0,0,0)' : fallback);
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
