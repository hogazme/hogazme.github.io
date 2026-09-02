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

    propsByIdx = new Array(HX.data.N_CBG);
    geojson.features.forEach(function (f) { propsByIdx[f.properties.idx] = f.properties; });

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
     2023/2024 data-supply regimes, which are plainly visible as level steps.
     Monthly means occupy a narrow slice of the 0-255 range, so the y-axis is
     autoscaled to the data (padded 8% each side) and redrawn per call, since
     switching between the exposure and reach views changes the channel. Once
     the axis no longer starts at zero, a bar mark would visually exaggerate
     small differences into large ratios; a line is the honest mark for a
     truncated axis. */
  function drawMeanStrip() {
    var cv = document.getElementById('mean-strip');
    var ctx = cv.getContext('2d');
    var ch = state.view === 'reach' ? 'c2' : 'c1';
    var vals = meta.monthly_mean_uint8[ch];
    var w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    var pad = Math.max(hi - lo, 1) * 0.08;
    lo -= pad; hi += pad;

    var bw = w / vals.length;
    function xAt(i) { return (i + 0.5) * bw; }
    function yAt(v) { return h - ((v - lo) / (hi - lo)) * h; }

    var pts = [];
    for (var i = 0; i < vals.length; i++) pts.push([xAt(i), yAt(vals[i])]);

    // Soft fill beneath the line.
    ctx.beginPath();
    ctx.moveTo(pts[0][0], h);
    for (i = 0; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[pts.length - 1][0], h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,163,184,0.10)';
    ctx.fill();

    // The trend line itself.
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = 'rgba(148,163,184,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bad-month ticks, full height.
    for (i = 0; i < vals.length; i++) {
      if (meta.flags.bad_months.indexOf(meta.months[i]) === -1) continue;
      ctx.fillStyle = '#fab219';
      ctx.fillRect(xAt(i) - 0.75, 0, 1.5, h);
    }

    // Current-month marker: vertical line plus a dot on the trend line.
    var cx = xAt(state.monthIndex), cy = yAt(vals[state.monthIndex]);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(cx - 0.75, 0, 1.5, h);
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
    ctx.fill();
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
        let idx = row * 3 + col;
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
      HX.colour.matchExpression(flags, [0.15, 0.95], 0.15));
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

  var propsByIdx = null;      // idx -> feature properties, filled in addLayers

  function channelReading(plane, channel, idx) {
    var raw = HX.data.valueAt(plane, state.monthIndex, idx);
    return {
      pct: Math.round(raw / 255 * 100),
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

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') clearSelection();
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
      buildLegend();
      renderControls();
      bindSelection();
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
  window.HX.app = {
    state: state, repaint: repaint, setMonth: setMonth, play: play, pause: pause,
    setView: setView, setMode: setMode
  };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
