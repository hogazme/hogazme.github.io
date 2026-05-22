const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11';
const DATA_PATH = 'data/houston_pois.geojson';
const RAIL_LINES_PATH = 'data/rail_lines.geojson';
const RAIL_STATIONS_PATH = 'data/rail_stations.geojson';
const CRIME_PATH = 'data/crime_heatmap.geojson';
const NRG_STADIUM = [-95.4107074026428, 29.68489897056981];
const HOUSTON_CENTER = NRG_STADIUM;
const HOUSTON_ZOOM = 12;

const RAIL_COLORS = {
    'Red': '#f87171',
    'Green': '#4ade80',
    'Purple': '#c084fc',
    'Shared': '#94a3b8',
};

let map;
let geojsonData = null;
let hoveredFeatureId = null;
let popup = null;
let crimeLoaded = false;
let crimeData = null;
let activeCrimeCategories = new Set();

mapboxgl.accessToken = MAPBOX_TOKEN;

function init() {
    map = new mapboxgl.Map({
        container: 'map',
        style: MAP_STYLE,
        center: HOUSTON_CENTER,
        zoom: HOUSTON_ZOOM,
        attributionControl: false,
    });

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', loadData);
}

async function loadData() {
    showLoading(true);
    try {
        const [poiResp, railLinesResp, railStationsResp] = await Promise.all([
            fetch(DATA_PATH),
            fetch(RAIL_LINES_PATH),
            fetch(RAIL_STATIONS_PATH),
        ]);
        if (!poiResp.ok) throw new Error('Failed to load POI data');
        geojsonData = await poiResp.json();
        geojsonData.features.forEach((f, i) => { f.id = i; });

        const railLinesData = railLinesResp.ok ? await railLinesResp.json() : null;
        const railStationsData = railStationsResp.ok ? await railStationsResp.json() : null;

        if (railLinesData || railStationsData) {
            addRailLayers(railLinesData, railStationsData);
        }

        initFilters(geojsonData.features, handleFilterChange);
        addPOILayer();

        document.getElementById('crime-toggle').addEventListener('change', (e) => {
            toggleCrimeLayer(e.target.checked);
        });
    } catch (err) {
        console.error('Error loading data:', err);
    }
    showLoading(false);
}

function buildFilteredGeojson() {
    const filtered = getFilteredFeatures();
    return { type: 'FeatureCollection', features: filtered };
}

function addRailLayers(linesData, stationsData) {
    if (linesData) {
        map.addSource('rail-lines', { type: 'geojson', data: linesData });
        map.addLayer({
            id: 'rail-lines-layer',
            type: 'line',
            source: 'rail-lines',
            paint: {
                'line-color': ['match', ['get', 'line_color'],
                    'Red', RAIL_COLORS.Red,
                    'Green', RAIL_COLORS.Green,
                    'Purple', RAIL_COLORS.Purple,
                    RAIL_COLORS.Shared],
                'line-width': 4,
                'line-opacity': 0.6,
                'line-dasharray': [2, 2],
            },
        });
    }

    if (stationsData) {
        map.addSource('rail-stations', { type: 'geojson', data: stationsData });
        map.addLayer({
            id: 'rail-stations-layer',
            type: 'circle',
            source: 'rail-stations',
            paint: {
                'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 6],
                'circle-color': ['match', ['get', 'line_color'],
                    'Red', RAIL_COLORS.Red,
                    'Green', RAIL_COLORS.Green,
                    'Purple', RAIL_COLORS.Purple,
                    RAIL_COLORS.Shared],
                'circle-opacity': 0.75,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': 'rgba(255,255,255,0.4)',
            },
        });
    }
}

async function loadCrimeHeatmap() {
    if (crimeLoaded) return;
    try {
        const resp = await fetch(CRIME_PATH);
        if (!resp.ok) return;
        crimeData = await resp.json();
        crimeLoaded = true;

        const cats = {};
        crimeData.features.forEach(f => {
            const cat = f.properties.category || 'Other';
            cats[cat] = (cats[cat] || 0) + 1;
        });
        activeCrimeCategories = new Set(Object.keys(cats));
        buildCrimeCheckboxes(cats);

        map.addSource('crime', { type: 'geojson', data: crimeData });
        map.addLayer({
            id: 'crime-heat',
            type: 'heatmap',
            source: 'crime',
            paint: {
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 0.15, 14, 0.8],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 18],
                'heatmap-opacity': 0.5,
                'heatmap-color': [
                    'interpolate', ['linear'], ['heatmap-density'],
                    0,   'rgba(0,0,0,0)',
                    0.15, 'rgba(254,240,138,0)',
                    0.3, 'rgba(254,240,138,0.4)',
                    0.5, 'rgba(251,191,36,0.6)',
                    0.7, 'rgba(249,115,22,0.7)',
                    0.85, 'rgba(239,68,68,0.8)',
                    1.0, '#991b1b',
                ],
            },
        }, map.getLayer('rail-lines-layer') ? 'rail-lines-layer' : undefined);
    } catch (err) {
        console.error('Error loading crime data:', err);
    }
}

function buildCrimeCheckboxes(cats) {
    const container = document.getElementById('crime-categories');
    container.innerHTML = '';
    const sorted = Object.entries(cats).sort((a, b) => {
        if (a[0] === 'Other') return 1;
        if (b[0] === 'Other') return -1;
        return b[1] - a[1];
    });

    sorted.forEach(([cat, count]) => {
        const item = document.createElement('label');
        item.className = 'crime-filter-item';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', () => {
            if (cb.checked) activeCrimeCategories.add(cat);
            else activeCrimeCategories.delete(cat);
            filterCrimeHeatmap();
        });

        const name = document.createElement('span');
        name.className = 'crime-filter-name';
        name.textContent = cat;

        const badge = document.createElement('span');
        badge.className = 'crime-filter-count';
        badge.textContent = count.toLocaleString();

        item.append(cb, name, badge);
        container.appendChild(item);
    });

    const histSection = document.createElement('div');
    histSection.className = 'crime-histogram-section';
    histSection.innerHTML = '<div class="crime-histogram-title">Time of Day</div>' +
        '<canvas id="crime-hour-histogram" width="260" height="120"></canvas>';
    container.appendChild(histSection);
    drawCrimeHourHistogram();
}

function filterCrimeHeatmap() {
    if (!crimeData || !crimeLoaded) return;
    const filtered = {
        type: 'FeatureCollection',
        features: crimeData.features.filter(f => activeCrimeCategories.has(f.properties.category || 'Other')),
    };
    const source = map.getSource('crime');
    if (source) source.setData(filtered);
    drawCrimeHourHistogram();
}

function drawCrimeHourHistogram() {
    const canvas = document.getElementById('crime-hour-histogram');
    if (!canvas || !crimeData) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const hours = new Array(24).fill(0);
    crimeData.features.forEach(f => {
        if (!activeCrimeCategories.has(f.properties.category || 'Other')) return;
        const hr = f.properties.hour || 0;
        hours[hr]++;
    });

    const maxBin = Math.max(...hours, 1);
    const padLeft = 32;
    const padRight = 8;
    const padTop = 4;
    const padBottom = 22;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;
    const barW = plotW / 24;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    const numTicks = 4;
    for (let i = 0; i <= numTicks; i++) {
        const y = padTop + plotH - (i / numTicks) * plotH;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);
        ctx.stroke();
        const label = Math.round((i / numTicks) * maxBin);
        ctx.fillText(label, padLeft - 4, y + 3);
    }

    hours.forEach((count, i) => {
        const barH = (count / maxBin) * plotH;
        const x = padLeft + i * barW;
        const y = padTop + plotH - barH;
        ctx.fillStyle = '#ef4444';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x + 1, y, barW - 2, barH);
        ctx.globalAlpha = 1;
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    for (let hr = 0; hr < 24; hr += 4) {
        const x = padLeft + hr * barW + barW / 2;
        const label = hr === 0 ? '12a' : hr < 12 ? hr + 'a' : hr === 12 ? '12p' : (hr - 12) + 'p';
        ctx.fillText(label, x, h - 4);
    }
}

function toggleCrimeLayer(visible) {
    const catContainer = document.getElementById('crime-categories');
    if (visible && !crimeLoaded) {
        loadCrimeHeatmap().then(() => catContainer.classList.remove('hidden'));
    } else if (crimeLoaded) {
        map.setLayoutProperty('crime-heat', 'visibility', visible ? 'visible' : 'none');
        catContainer.classList.toggle('hidden', !visible);
    }
}

function addPOILayer() {
    const data = buildFilteredGeojson();

    map.addSource('pois', {
        type: 'geojson',
        data: data,
    });

    // Individual POI circles — color by SUB_CATEGORY
    const colorExpr = buildColorExpression();

    map.addLayer({
        id: 'poi-points',
        type: 'circle',
        source: 'pois',
        paint: {
            'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                10, ['interpolate', ['linear'], ['get', 'total_visits'],
                     0, 2, 2000, 3, 10000, 5, 50000, 8],
                14, ['interpolate', ['linear'], ['get', 'total_visits'],
                     0, 4, 2000, 6, 10000, 9, 50000, 14],
                18, ['interpolate', ['linear'], ['get', 'total_visits'],
                     0, 6, 2000, 9, 10000, 14, 50000, 20],
            ],
            'circle-color': colorExpr,
            'circle-opacity': 0.85,
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
    });

    addStadiumMarker();
    setupInteractions();
}

function addStadiumMarker() {
    const el = document.createElement('div');
    el.className = 'stadium-marker';
    el.innerHTML = '<img src="wc2026.png" alt="FIFA World Cup 2026">' +
        '<span class="stadium-label">NRG Stadium</span>';

    new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(NRG_STADIUM)
        .addTo(map);
}

function buildColorExpression() {
    const pairs = [];
    for (const [cat, color] of Object.entries(SUBCATEGORY_COLORS)) {
        pairs.push(cat, color);
    }
    return ['match', ['get', 'SUB_CATEGORY'], ...pairs, '#94a3b8'];
}

function handleFilterChange() {
    const source = map.getSource('pois');
    if (source) {
        source.setData(buildFilteredGeojson());
    }
}

function setupInteractions() {
    // Hover on POI point — tooltip
    map.on('mousemove', 'poi-points', (e) => {
        if (!e.features.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features[0];
        showTooltip(e.originalEvent, f.properties);
    });

    map.on('mouseleave', 'poi-points', () => {
        map.getCanvas().style.cursor = '';
        hideTooltip();
    });

    // Click on POI point — detail card + fly to
    map.on('click', 'poi-points', (e) => {
        if (!e.features.length) return;
        const f = e.features[0];
        const coords = f.geometry.coordinates.slice();

        map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 14), duration: 800 });
        showDetail(f.properties);
    });

    // Hover on rail station — tooltip
    if (map.getLayer('rail-stations-layer')) {
        map.on('mousemove', 'rail-stations-layer', (e) => {
            if (!e.features.length) return;
            map.getCanvas().style.cursor = 'pointer';
            const props = e.features[0].properties;
            showRailTooltip(e.originalEvent, props);
        });

        map.on('mouseleave', 'rail-stations-layer', () => {
            map.getCanvas().style.cursor = '';
            hideTooltip();
        });
    }
}

function showTooltip(event, props) {
    const tooltip = document.getElementById('tooltip');
    const cat = props.SUB_CATEGORY || 'Unknown';
    const shortName = SUBCATEGORY_SHORT[cat] || cat;
    const visits = Number(props.total_visits) || 0;
    const meanDwell = parseFloat(props.mean_dwell);
    const dwell = meanDwell > 0 ? Math.round(meanDwell) + ' min avg dwell' : '';

    tooltip.innerHTML = `
        <div class="tooltip-name">${props.LOCATION_NAME || 'Unknown'}</div>
        <div class="tooltip-cat">${shortName}</div>
        <div class="tooltip-addr">${props.STREET_ADDRESS || ''}, ${props.CITY || ''}</div>
        ${visits > 0 ? `<div class="tooltip-visits">${visits.toLocaleString()} visits${dwell ? ' · ' + dwell : ''}</div>` : ''}
    `;
    tooltip.style.display = 'block';

    const x = event.clientX;
    const y = event.clientY;
    const rect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 12;
    const maxY = window.innerHeight - rect.height - 12;

    tooltip.style.left = Math.min(x + 14, maxX) + 'px';
    tooltip.style.top = Math.min(y + 14, maxY) + 'px';
}

function showRailTooltip(event, props) {
    const tooltip = document.getElementById('tooltip');
    const color = RAIL_COLORS[props.line_color] || RAIL_COLORS.Shared;
    tooltip.innerHTML = `
        <div class="tooltip-name">${props.name || 'Station'}</div>
        <div class="tooltip-cat" style="color:${color}">METRORail · ${props.corridor || props.line_color} Line</div>
    `;
    tooltip.style.display = 'block';

    const x = event.clientX;
    const y = event.clientY;
    const rect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 12;
    const maxY = window.innerHeight - rect.height - 12;
    tooltip.style.left = Math.min(x + 14, maxX) + 'px';
    tooltip.style.top = Math.min(y + 14, maxY) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

function showLoading(visible) {
    document.getElementById('loading').classList.toggle('visible', visible);
}

init();
