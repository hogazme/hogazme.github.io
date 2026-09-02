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

  /* Any load failure — CDN unreachable, a data fetch 404, a corrupt binary —
     would otherwise leave the loading overlay spinning forever with no
     explanation. Replace its content with a readable message instead, and
     keep the original error in the console for debugging. */
  function showLoadError(err) {
    console.error(err);
    var el = document.getElementById('loading');
    el.innerHTML = '<p class="warning">Could not load the map: ' +
      (err && err.message ? err.message : String(err)) +
      '. Try reloading the page.</p>';
  }

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
    });
  }

  async function init() {
    try {
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
      bindTransport();
      drawMeanStrip();
      show(document.getElementById('loading'), false);

      HX.app.map = map;
      HX.app.meta = meta;
      HX.app.comp = comp;
    } catch (err) {
      showLoadError(err);
    }
  }

  window.HX = window.HX || {};
  window.HX.app = { state: state, repaint: repaint, setMonth: setMonth, play: play, pause: pause };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
