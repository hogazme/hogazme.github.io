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
