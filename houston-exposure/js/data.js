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

  var N_CBG = 2888;             // 2,891 upstream minus tract 48167723900 (open water)
  var N_MONTH = 72;
  var PLANE = N_CBG * N_MONTH;          // 207936

  var N_PLANE = 5;

  /* components.bin is five contiguous uint8 planes: c1, c2, c3 (pooled
     percentile ranks of PC1-3), rg (pooled percentile rank of the activity
     radius of gyration) and rgkm (that radius in km x 2, for display).
     Within a plane: offset = monthIndex * N_CBG + cbgIdx. */
  function decodeComponents(arrayBuffer) {
    var all = new Uint8Array(arrayBuffer);
    if (all.length !== PLANE * N_PLANE) {
      throw new Error('components.bin must be ' + PLANE * N_PLANE +
                      ' bytes, got ' + all.length);
    }
    return {
      c1: all.subarray(0, PLANE),
      c2: all.subarray(PLANE, PLANE * 2),
      c3: all.subarray(PLANE * 2, PLANE * 3),
      rg: all.subarray(PLANE * 3, PLANE * 4),
      rgkm: all.subarray(PLANE * 4, PLANE * 5)
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
    N_PLANE: N_PLANE,
    decodeComponents: decodeComponents,
    monthSlice: monthSlice,
    valueAt: valueAt,
    rankInMonth: rankInMonth
  };
});
