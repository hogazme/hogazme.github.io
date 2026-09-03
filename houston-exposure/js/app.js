/* Houston exposure dashboard — map, layers, controls. The only file that
   touches Mapbox or the DOM. */
(function () {
  'use strict';

  var HOUSTON_CENTER = [-95.3698, 29.7604];
  var HOUSTON_ZOOM = 8.6;
  var MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';

  /* Fill opacity thins as you zoom in so streets, parks and water read
     through the colour; hairline strokes keep the polygons legible. The
     zoom curve must be the top-level expression (Mapbox only allows
     ['zoom'] there), so the per-feature isolate is folded into each stop. */
  function zoomOpacity(inner) {
    function at(base) { return inner === undefined ? base : ['*', base, inner]; }
    return ['interpolate', ['linear'], ['zoom'],
      8, at(0.82), 10.5, at(0.62), 13, at(0.42)];
  }

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
  var propsByIdx = null;      // idx -> feature properties, filled in addLayers
  var exprCache = Object.create(null);

  var COUNTY = {
    '48201': 'Harris', '48157': 'Fort Bend', '48339': 'Montgomery', '48039': 'Brazoria',
    '48167': 'Galveston', '48071': 'Chambers', '48291': 'Liberty', '48015': 'Austin',
    '48473': 'Waller'
  };

  var REACH_LABELS = [
    'Much tighter footprint than Houston', 'Tighter footprint', 'Slightly tighter footprint',
    'Typical footprint', 'Slightly wider footprint', 'Wider footprint', 'Much wider footprint than Houston'
  ];

  var REGIME_WARNING =
    'Absolute colours compare raw values across months, and the data provider’s coverage ' +
    'changes three times in this panel (frozen to 2022-11, broken in 2022-12, then ' +
    'regrown in 2023 and again in 2024). The whole map shifts colour at those boundaries ' +
    'for reasons that are not behavioural. See Methods & data.';

  var VIEW_NOTES = {
    exposure: 'Two axes at once: how much richer the crowds a block group travels into are ' +
      '(up) and how racially unlike them they are (right).',
    reach: 'One axis: the radius of the area a block group’s residents actually cover in a month ' +
      '(radius of gyration of the places they visit). Blue is tighter than Houston, red is wider.'
  };

  var MODE_NOTES = {
    relative: 'Each month is centred on its own Houston-wide mean, so colour reads “compared to the rest of Houston this month”.',
    absolute: 'Raw pooled ranks, no monthly centring.'
  };

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function isBadMonth(i) { return meta.flags.bad_months.indexOf(meta.months[i]) !== -1; }

  function means(channel) {
    if (state.mode === 'absolute') return null;
    return meta.monthly_mean_uint8[channel][state.monthIndex];
  }

  /* A value as the map currently shows it: relativised in relative mode. */
  function shown(plane, channel, monthIndex, idx) {
    var v = HX.data.valueAt(plane, monthIndex, idx);
    if (state.mode === 'absolute') return v;
    return HX.colour.relativise(v, meta.monthly_mean_uint8[channel][monthIndex]);
  }

  function cellOf(idx) {
    return HX.colour.cellIndex(
      shown(comp.c1, 'c1', state.monthIndex, idx),
      shown(comp.c3, 'c3', state.monthIndex, idx));
  }

  /* ── Paint ─────────────────────────────────────────────────────────── */

  /* One Mapbox expression per (month, view, mode); memoised so scrubbing back
     and forth costs nothing. */
  function fillExpression() {
    var key = state.view + '|' + state.mode + '|' + state.monthIndex;
    if (exprCache[key]) return exprCache[key];

    var expr;
    if (state.view === 'exposure') {
      var c1 = HX.data.monthSlice(comp.c1, state.monthIndex);
      var c3 = HX.data.monthSlice(comp.c3, state.monthIndex);
      var m = state.mode === 'absolute' ? null : { c1: means('c1'), c3: means('c3') };
      expr = HX.colour.matchExpression(
        HX.colour.bivariateCells(c1, c3, m), HX.colour.PALETTE);
    } else {
      var rg = HX.data.monthSlice(comp.rg, state.monthIndex);
      expr = HX.colour.matchExpression(
        HX.colour.reachSteps(rg, means('rg')), HX.colour.REACH_RAMP);
    }
    exprCache[key] = expr;
    return expr;
  }

  function repaint() {
    if (!map || !map.getLayer('cbg-fill')) return;
    map.setPaintProperty('cbg-fill', 'fill-color', fillExpression());
    $('month-label').textContent = meta.months[state.monthIndex];
    show($('month-flag'), isBadMonth(state.monthIndex));
    if (state.hoverCell !== null) setHoverCell(state.hoverCell);
  }

  /* Slot our layers under the basemap's water, roads and labels so the
     street network and place names draw crisply on top of the colour. */
  function firstBasemapDetailLayer() {
    var layers = map.getStyle().layers;
    for (var i = 0; i < layers.length; i++) {
      var l = layers[i];
      if (l.type === 'line' || l.type === 'symbol' || /water/.test(l.id)) return l.id;
    }
    return undefined;
  }

  function addLayers(geojson) {
    map.addSource('cbgs', { type: 'geojson', data: geojson, promoteId: 'cbg_geoid' });

    propsByIdx = new Array(HX.data.N_CBG);
    geojson.features.forEach(function (f) { propsByIdx[f.properties.idx] = f.properties; });

    var before = firstBasemapDetailLayer();

    map.addLayer({
      id: 'cbg-fill',
      type: 'fill',
      source: 'cbgs',
      paint: { 'fill-color': fillExpression(), 'fill-opacity': zoomOpacity() }
    }, before);

    /* Hairline stroke on every polygon. Not decoration: it separates the
       palest palette cell from the land colour regardless of fill. */
    map.addLayer({
      id: 'cbg-line',
      type: 'line',
      source: 'cbgs',
      paint: { 'line-color': 'rgba(15, 23, 42, 0.28)', 'line-width': 0.5 }
    }, before);

    /* The 168 CBGs whose ACS median income is 0 and whose income-gap features
       are Houston-median fills. Always visible, in every view. */
    map.addLayer({
      id: 'cbg-imputed',
      type: 'line',
      source: 'cbgs',
      filter: ['==', ['get', 'imputed_income'], 1],
      paint: {
        'line-color': 'rgba(180, 83, 9, 0.85)',
        'line-width': 1,
        'line-dasharray': [2, 2]
      }
    });

    map.addLayer({
      id: 'cbg-selected',
      type: 'line',
      source: 'cbgs',
      filter: ['==', ['get', 'idx'], -1],
      paint: { 'line-color': '#0f172a', 'line-width': 2.5 }
    });
  }

  /* ── Transport ─────────────────────────────────────────────────────── */

  var playTimer = null;

  function setMonth(i) {
    var n = HX.data.N_MONTH;
    state.monthIndex = ((i % n) + n) % n;
    $('month-slider').value = state.monthIndex;
    repaint();
    drawMeanStrip();
    if (state.selectedIdx !== null) renderDetail(state.selectedIdx);
  }

  function pause() {
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    var b = $('play');
    b.innerHTML = '&#9654;';
    b.setAttribute('aria-label', 'Play');
    b.setAttribute('aria-pressed', 'false');
  }

  function play() {
    if (playTimer) return pause();
    var b = $('play');
    b.innerHTML = '&#10073;&#10073;';
    b.setAttribute('aria-label', 'Pause');
    b.setAttribute('aria-pressed', 'true');
    playTimer = setInterval(function () {
      setMonth(state.monthIndex + 1);
    }, 111);                                   // ~9 fps -> 72 months in ~8 s
  }

  /* The strip under the slider is the Houston-wide monthly mean of the mapped
     channel: a scrub target, and the honest disclosure of the 2023/2024
     data-supply regimes, which show as level steps. The y-axis is autoscaled
     to the channel's own range (the means occupy a narrow slice of 0–255), so
     the mark is a line, not bars from a truncated baseline. */
  function drawMeanStrip() {
    var cv = $('mean-strip');
    var box = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(box.width)), H = Math.max(1, Math.round(box.height));
    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr; cv.height = H * dpr;
    }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var ch = state.view === 'reach' ? 'rg' : 'c1';
    var vals = meta.monthly_mean_uint8[ch];
    var n = vals.length;
    var top = 13, bottom = H - 4;            // leave room for the regime labels
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max(hi - lo, 1) * 0.1;
    lo -= pad; hi += pad;

    function xAt(i) { return (i + 0.5) / n * W; }
    function yAt(v) { return bottom - (v - lo) / (hi - lo) * (bottom - top); }

    // Regime boundaries: faint verticals with a year label.
    ctx.font = '500 9.5px Inter, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(148,163,184,0.6)';
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    meta.flags.regimes.forEach(function (r) {
      var i = meta.months.indexOf(r.from);
      if (i <= 0) return;
      var x = Math.round(xAt(i) - 0.5 / n * W) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      if (W >= 200 && r.from.slice(5) === '01') ctx.fillText(r.from.slice(0, 4), x + 3, 1);
    });
    if (W >= 200) ctx.fillText('2019', 1, 1);

    // Area + line.
    var pts = [];
    for (var i = 0; i < n; i++) pts.push([xAt(i), yAt(vals[i])]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], bottom);
    for (i = 0; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(pts[n - 1][0], bottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,163,184,0.10)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = 'rgba(148,163,184,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Bad months: amber tick.
    for (i = 0; i < n; i++) {
      if (!isBadMonth(i)) continue;
      ctx.fillStyle = '#fab219';
      ctx.fillRect(xAt(i) - 1, top - 4, 2, bottom - top + 4);
    }

    // Current month: vertical plus a dot on the line.
    var cx = xAt(state.monthIndex), cy = yAt(vals[state.monthIndex]);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(cx - 0.75, top - 4, 1.5, bottom - top + 4);
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
  }

  function bindTransport() {
    $('month-slider').addEventListener('input', function (e) {
      pause();
      setMonth(parseInt(e.target.value, 10));
    });
    $('play').addEventListener('click', play);
    $('strip-wrap').addEventListener('click', function (e) {
      pause();
      var r = e.currentTarget.getBoundingClientRect();
      setMonth(Math.floor((e.clientX - r.left) / r.width * HX.data.N_MONTH));
    });
    document.addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|BUTTON)$/.test(e.target.tagName) && e.key === ' ') return;
      if (e.key === 'ArrowLeft') { pause(); setMonth(state.monthIndex - 1); }
      else if (e.key === 'ArrowRight') { pause(); setMonth(state.monthIndex + 1); }
      else if (e.key === ' ') { e.preventDefault(); play(); }
    });
    window.addEventListener('resize', drawMeanStrip);
  }

  /* ── Legend, view, mode ────────────────────────────────────────────── */

  function setReading(text, placeholder) {
    var el = $('legend-reading');
    el.textContent = text;
    el.classList.toggle('placeholder', !!placeholder);
  }

  function resetReading() {
    setReading(state.view === 'exposure'
      ? 'Hover a cell to read it, or a block group on the map.'
      : 'Hover a block group on the map to read it.', true);
  }

  function buildLegend() {
    var el = $('legend');
    var wrap = $('legend-wrap');
    el.innerHTML = '';
    el.classList.toggle('reach', state.view === 'reach');

    if (state.view === 'reach') {
      $('legend-yaxis').style.display = 'none';
      $('legend-xaxis').firstElementChild.textContent = 'tighter footprint to wider footprint';
      wrap.style.gridTemplateColumns = '0 auto';
      HX.colour.REACH_RAMP.forEach(function (c, i) {
        var d = document.createElement('div');
        d.className = 'legend-cell';
        d.style.background = c;
        d.title = REACH_LABELS[i];
        d.addEventListener('mouseenter', function () { setReading(REACH_LABELS[i]); });
        d.addEventListener('mouseleave', resetReading);
        el.appendChild(d);
      });
      resetReading();
      return;
    }

    $('legend-yaxis').style.display = '';
    $('legend-xaxis').firstElementChild.textContent = 'racially unlike crowds';
    wrap.style.gridTemplateColumns = '';
    /* Draw high PC1 first so the legend reads bottom-up like a chart axis. */
    [2, 1, 0].forEach(function (row) {
      for (var col = 0; col < 3; col++) {
        let idx = row * 3 + col;
        var d = document.createElement('div');
        d.className = 'legend-cell';
        d.dataset.cell = idx;
        d.style.background = HX.colour.PALETTE[idx];
        d.setAttribute('aria-label', HX.colour.CELL_LABELS[idx]);
        d.addEventListener('mouseenter', function () {
          setHoverCell(idx);
          setReading(HX.colour.CELL_LABELS[idx]);
        });
        d.addEventListener('mouseleave', function () {
          setHoverCell(null);
          resetReading();
        });
        el.appendChild(d);
      }
    });
    resetReading();
  }

  function markLegendCell(cell) {
    var cells = $('legend').children;
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.toggle('active', cell !== null && +cells[i].dataset.cell === cell);
    }
  }

  /* Legend isolate: the secondary encoding that makes an individual cell
     resolvable even though adjacent cells are deliberately similar. */
  function setHoverCell(cell) {
    state.hoverCell = cell;
    if (!map.getLayer('cbg-fill')) return;
    if (cell === null) {
      map.setPaintProperty('cbg-fill', 'fill-opacity', zoomOpacity());
      return;
    }
    var c1 = HX.data.monthSlice(comp.c1, state.monthIndex);
    var c3 = HX.data.monthSlice(comp.c3, state.monthIndex);
    var m = state.mode === 'absolute' ? null : { c1: means('c1'), c3: means('c3') };
    var cells = HX.colour.bivariateCells(c1, c3, m);
    var flags = new Uint8Array(cells.length);
    for (var i = 0; i < cells.length; i++) flags[i] = cells[i] === cell ? 1 : 0;
    map.setPaintProperty('cbg-fill', 'fill-opacity',
      zoomOpacity(HX.colour.matchExpression(flags, [0.18, 1.15], 0.18)));
  }

  function setView(v) {
    state.view = v;
    state.hoverCell = null;
    map.setPaintProperty('cbg-fill', 'fill-opacity', zoomOpacity());
    buildLegend();
    repaint();
    drawMeanStrip();
    renderControls();
    if (state.selectedIdx !== null) renderDetail(state.selectedIdx);
  }

  function setMode(m) {
    state.mode = m;
    var w = $('mode-warning');
    w.textContent = REGIME_WARNING;
    show(w, m === 'absolute');
    repaint();
    renderControls();
    if (state.selectedIdx !== null) renderDetail(state.selectedIdx);
  }

  function radio(container, options, current, onPick) {
    container.innerHTML = '';
    options.forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'radio' + (o.value === current ? ' active' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', o.value === current ? 'true' : 'false');
      b.textContent = o.label;
      b.addEventListener('click', function () { onPick(o.value); });
      container.appendChild(b);
    });
  }

  function renderControls() {
    radio($('view-controls'), [
      { value: 'exposure', label: 'Who they meet' },
      { value: 'reach', label: 'How far they go' }
    ], state.view, setView);
    $('view-note').textContent = VIEW_NOTES[state.view];
    radio($('mode-controls'), [
      { value: 'relative', label: 'Relative' },
      { value: 'absolute', label: 'Absolute' }
    ], state.mode, setMode);
    $('mode-note').textContent = MODE_NOTES[state.mode];
  }

  /* ── Detail card and tooltip ───────────────────────────────────────── */

  function reading(plane, channel, idx) {
    var raw = HX.data.valueAt(plane, state.monthIndex, idx);
    return {
      pct: Math.round(raw / 255 * 100),
      rank: HX.data.rankInMonth(plane, state.monthIndex, idx)
    };
  }

  function radiusKm(idx, monthIndex) {
    var m = monthIndex === undefined ? state.monthIndex : monthIndex;
    return HX.data.valueAt(comp.rgkm, m, idx) / 2;
  }

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function placeName(geoid) {
    var g = String(geoid);
    var county = COUNTY[g.slice(0, 5)];
    return (county ? county + ' County' : 'Texas') + ' · tract ' +
      g.slice(5, 9) + '.' + g.slice(9, 11) + ' · block group ' + g.slice(11);
  }

  /* 72-month sparkline of the value as the map shows it (mode-consistent),
     with a faint midline at 128 and the current month marked. */
  function sparkline(plane, channel, idx, colour) {
    var W = 200, H = 30, n = HX.data.N_MONTH;
    var pts = [];
    for (var t = 0; t < n; t++) {
      pts.push((t / (n - 1) * W).toFixed(1) + ',' +
               (H - shown(plane, channel, t, idx) / 255 * H).toFixed(1));
    }
    var x = (state.monthIndex / (n - 1) * W).toFixed(1);
    var bad = meta.flags.bad_months.map(function (m) {
      var i = meta.months.indexOf(m);
      return '<line x1="' + (i / (n - 1) * W).toFixed(1) + '" y1="0" x2="' +
        (i / (n - 1) * W).toFixed(1) + '" y2="' + H + '" stroke="#fab219" stroke-width="1" opacity="0.6"/>';
    }).join('');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="0" y1="' + H / 2 + '" x2="' + W + '" y2="' + H / 2 + '" stroke="rgba(148,163,184,0.25)" stroke-width="1" stroke-dasharray="2 3"/>' +
      bad +
      '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + colour + '" stroke-width="1.3"/>' +
      '<line x1="' + x + '" y1="0" x2="' + x + '" y2="' + H + '" stroke="#f8fafc" stroke-width="1" opacity="0.7"/></svg>';
  }

  function renderDetail(idx) {
    var p = propsByIdx[idx];
    var cell = cellOf(idx);
    var e = reading(comp.c1, 'c1', idx);
    var r = reading(comp.rg, 'rg', idx);
    var d = reading(comp.c3, 'c3', idx);
    var money = p.median_household_income
      ? '$' + Math.round(p.median_household_income).toLocaleString() : 'not reported';

    var html =
      '<div class="detail-geoid">' + p.cbg_geoid + '</div>' +
      '<div class="detail-place">' + placeName(p.cbg_geoid) + '</div>' +
      '<div class="detail-cell"><span class="swatch" style="background:' +
        HX.colour.PALETTE[cell] + '"></span>' + HX.colour.CELL_LABELS[cell] + '</div>' +
      (p.imputed_income === 1
        ? '<p class="warning">This block group reports a median household income of 0 ' +
          'in the ACS, so its income-exposure features are Houston-median fills. ' +
          'Its colour is partly an artefact.</p>'
        : '') +
      '<div class="detail-row"><span>Exposure gap</span>' +
        '<b>' + ordinal(e.pct) + ' pct</b><small>rank ' + e.rank.toLocaleString() + ' of 2,891</small></div>' +
      sparkline(comp.c1, 'c1', idx, '#60a5fa') +
      '<div class="detail-row"><span>Racial dissimilarity</span>' +
        '<b>' + ordinal(d.pct) + ' pct</b><small>rank ' + d.rank.toLocaleString() + ' of 2,891</small></div>' +
      sparkline(comp.c3, 'c3', idx, '#e8833a') +
      '<div class="detail-row"><span>Activity radius</span>' +
        '<b>' + radiusKm(idx).toFixed(1) + ' km</b><small>' + ordinal(r.pct) + ' pct, rank ' + r.rank.toLocaleString() + '</small></div>' +
      sparkline(comp.rg, 'rg', idx, '#b5301f') +
      '<div class="detail-demo">' +
        'Population <b>' + (p.tot_pop || 0).toLocaleString() + '</b>, median income <b>' + money + '</b><br>' +
        'Bachelor’s <b>' + Math.round((p.bachelors_degree_pct || 0) * 100) + '%</b>, ' +
        'poverty <b>' + Math.round((p.poverty_rate || 0) * 100) + '%</b><br>' +
        'White <b>' + Math.round((p.white_pct || 0) * 100) + '%</b>, ' +
        'Black <b>' + Math.round((p.black_pct || 0) * 100) + '%</b>, ' +
        'Hispanic <b>' + Math.round((p.hispanic_pct || 0) * 100) + '%</b>, ' +
        'Asian <b>' + Math.round((p.asian_pct || 0) * 100) + '%</b>' +
      '</div>';

    $('detail-content').innerHTML = html;
    show($('detail-section'), true);
  }

  function clearSelection() {
    state.selectedIdx = null;
    show($('detail-section'), false);
    map.setFilter('cbg-selected', ['==', ['get', 'idx'], -1]);
  }

  function tooltipHtml(idx) {
    var p = propsByIdx[idx];
    var head;
    if (state.view === 'exposure') {
      var cell = cellOf(idx);
      head = '<div class="tt-cell"><span class="swatch" style="background:' +
        HX.colour.PALETTE[cell] + '"></span>' + HX.colour.CELL_LABELS[cell] + '</div>';
    } else {
      var step = HX.colour.reachSteps(
        new Uint8Array([HX.data.valueAt(comp.rg, state.monthIndex, idx)]), means('rg'))[0];
      head = '<div class="tt-cell"><span class="swatch" style="background:' +
        HX.colour.REACH_RAMP[step] + '"></span>' + REACH_LABELS[step] + '</div>';
    }
    var e = reading(comp.c1, 'c1', idx), r = reading(comp.rg, 'rg', idx), d = reading(comp.c3, 'c3', idx);
    return head +
      '<div class="tt-row"><span>Exposure gap</span><b>' + ordinal(e.pct) + ' pct</b></div>' +
      '<div class="tt-row"><span>Racial dissimilarity</span><b>' + ordinal(d.pct) + ' pct</b></div>' +
      '<div class="tt-row"><span>Activity radius</span><b>' + radiusKm(idx).toFixed(1) + ' km · ' + ordinal(r.pct) + ' pct</b></div>' +
      '<div class="tt-id">' + placeName(p.cbg_geoid) +
      (p.imputed_income === 1 ? ' · income imputed' : '') + '</div>';
  }

  function bindSelection() {
    var tip = $('tooltip');
    var container = $('map-container');

    map.on('mousemove', 'cbg-fill', function (ev) {
      map.getCanvas().style.cursor = 'pointer';
      var idx = ev.features[0].properties.idx;
      tip.innerHTML = tooltipHtml(idx);
      tip.style.display = 'block';
      var r = container.getBoundingClientRect();
      var x = r.left + ev.point.x + 16, y = r.top + ev.point.y + 16;
      if (x + tip.offsetWidth > window.innerWidth - 8) x = r.left + ev.point.x - tip.offsetWidth - 12;
      if (y + tip.offsetHeight > window.innerHeight - 8) y = r.top + ev.point.y - tip.offsetHeight - 12;
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      if (state.view === 'exposure') markLegendCell(cellOf(idx));
    });
    map.on('mouseleave', 'cbg-fill', function () {
      map.getCanvas().style.cursor = '';
      tip.style.display = 'none';
      markLegendCell(null);
    });
    map.on('click', 'cbg-fill', function (ev) {
      var idx = ev.features[0].properties.idx;
      state.selectedIdx = idx;
      map.setFilter('cbg-selected', ['==', ['get', 'idx'], idx]);
      renderDetail(idx);
    });
    $('detail-close').addEventListener('click', clearSelection);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('methods-panel').classList.contains('hidden')) closeMethods();
      else if (!$('intro').classList.contains('hidden')) dismissIntro();
      else clearSelection();
    });
  }

  /* ── Intro and methods ─────────────────────────────────────────────── */

  function buildIntro() {
    var el = $('intro-legend');
    [[6, 'Blue: much richer crowds, similar race'],
     [2, 'Orange: similar incomes, very different race'],
     [0, 'Pale grey: among people like itself'],
     [8, 'Dark plum: unlike on both']].forEach(function (pair) {
      var d = document.createElement('div');
      d.innerHTML = '<span class="swatch" style="background:' + HX.colour.PALETTE[pair[0]] +
        '"></span><span>' + pair[1] + '</span>';
      el.appendChild(d);
    });
    $('intro-dismiss').addEventListener('click', dismissIntro);
  }

  function dismissIntro() {
    show($('intro'), false);
  }

  var methodsBuilt = false;
  function openMethods() {
    if (!methodsBuilt) {
      $('methods-content').innerHTML = HX.methods.render(meta);
      methodsBuilt = true;
    }
    show($('methods-scrim'), true);
    show($('methods-panel'), true);
    $('methods-open').setAttribute('aria-expanded', 'true');
    $('methods-panel').focus();
  }

  function closeMethods() {
    show($('methods-scrim'), false);
    show($('methods-panel'), false);
    $('methods-open').setAttribute('aria-expanded', 'false');
    $('methods-open').focus();
  }

  function bindMethods() {
    $('methods-open').addEventListener('click', openMethods);
    $('methods-close').addEventListener('click', closeMethods);
    $('methods-scrim').addEventListener('click', closeMethods);
  }

  /* ── Boot ──────────────────────────────────────────────────────────── */

  /* Any load failure — CDN unreachable, a data fetch 404, a corrupt binary —
     would otherwise leave the loading overlay spinning forever. Replace its
     content with a readable message and keep the error in the console. */
  function showLoadError(err) {
    console.error(err);
    $('loading').innerHTML = '<p class="warning">Could not load the map: ' +
      (err && err.message ? err.message : String(err)) + '. Try reloading the page.</p>';
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
        /* style.load, not load: load waits on every tile source and stalls
           when one is unreachable, but addLayer only needs the style parsed. */
        new Promise(function (res) { map.once('style.load', res); })
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
      bindMethods();
      buildIntro();
      drawMeanStrip();
      show($('loading'), false);

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
    setView: setView, setMode: setMode, openMethods: openMethods, closeMethods: closeMethods,
    dismissIntro: dismissIntro, renderDetail: renderDetail, clearSelection: clearSelection
  };

  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
