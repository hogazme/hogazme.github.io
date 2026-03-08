/* ============================================================
   EV Charging Accessibility Dashboard — Main Application
   ============================================================ */

// MAPBOX_TOKEN is loaded from config.js (gitignored)
const MAP_STYLE = 'mapbox://styles/mapbox/streets-v12';
const DATA_PATH = 'data_optimized';
const DISTANCE_METRIC_PREFERRED = 'dist_accessibility';
const DISTANCE_METRIC_FALLBACK = 'dist_accessibility_008';

// Metro areas — extracted from filenames
const METROS = [
    'Albany--Schenectady, NY',
    'Atlanta, GA',
    'Austin, TX',
    'Baltimore, MD',
    'Boston, MA--NH',
    'Chicago, IL--IN',
    'Dallas--Fort Worth--Arlington, TX',
    'Denver--Aurora, CO',
    'Kansas City, MO--KS',
    'Los Angeles--Long Beach--Anaheim, CA',
    'Miami--Fort Lauderdale, FL',
    'New York--Jersey City--Newark, NY--NJ',
    'Philadelphia, PA--NJ--DE--MD',
    'Phoenix--Mesa--Scottsdale, AZ',
    'Sacramento, CA',
    'San Diego, CA',
    'San Francisco--Oakland, CA',
    'San Jose, CA',
    'Seattle--Tacoma, WA',
    'Washington--Arlington, DC--VA--MD'
];

// Diverging color ramp: red → white → green
const COLOR_LOW = '#d73027';     // red (0th percentile)
const COLOR_MID = '#ffffff';     // white (50th percentile)
const COLOR_HIGH = '#1a9850';    // green (100th percentile)
const HIGHLIGHT_COLOR = '#facc15';

const PCS_DATA_PATH = 'data/pcs_per_cbg';

// State
let leftMap, rightMap, compareControl;
let currentData = null;
let hoveredId = null;
let dataCache = {};
let pcsDataCache = {};
let currentPcsData = null;   // { [GEOID]: row } for current metro
let currentDistanceMetric = DISTANCE_METRIC_PREFERRED;
let pcsMarkers = [];          // active Mapbox markers for PCS stations

/* ============================================================
   Initialization
   ============================================================ */

mapboxgl.accessToken = MAPBOX_TOKEN;

function initMaps() {
    const mapOptions = {
        container: 'left-map',
        style: MAP_STYLE,
        center: [-73.78, 42.65],
        zoom: 10,
        attributionControl: false
    };

    leftMap = new mapboxgl.Map({ ...mapOptions, container: 'left-map' });
    rightMap = new mapboxgl.Map({ ...mapOptions, container: 'right-map' });

    leftMap.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-left');
    leftMap.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

    // Wait for both maps to load
    let loaded = 0;
    const onLoad = () => {
        loaded++;
        if (loaded === 2) {
            initCompare();
            populateSelector();
            loadMetro(METROS[0]);
        }
    };

    leftMap.on('load', onLoad);
    rightMap.on('load', onLoad);
}

function initCompare() {
    compareControl = new mapboxgl.Compare(leftMap, rightMap, '#comparison-container', {
        mousemove: true,
        orientation: 'vertical'
    });
}

/* ============================================================
   Metro Selector
   ============================================================ */

function populateSelector() {
    const select = document.getElementById('metro-select');
    METROS.forEach(metro => {
        const opt = document.createElement('option');
        opt.value = metro;
        opt.textContent = metro;
        select.appendChild(opt);
    });
    select.addEventListener('change', (e) => loadMetro(e.target.value));
}

/* ============================================================
   Data Loading
   ============================================================ */

async function loadMetro(metro) {
    showLoading(true);
    resetZipPanel();

    try {
        let geojson;
        if (dataCache[metro]) {
            geojson = dataCache[metro];
        } else {
            const filename = `cbg9_${metro}.geojson`;
            const response = await fetch(`${DATA_PATH}/${encodeURIComponent(filename)}`);
            if (!response.ok) throw new Error(`Failed to load ${filename}`);
            geojson = await response.json();
            dataCache[metro] = geojson;
        }

        currentData = geojson;
        currentDistanceMetric = getDistanceMetricForFeatures(geojson.features);

        // Load PCS-per-CBG data
        await loadPcsData(metro);

        // Compute percentile ranks (0–100) for each metric
        computePercentiles(geojson.features, currentDistanceMetric, 'dist_pctile');
        computePercentiles(geojson.features, 'visit_pct', 'visit_pctile');

        updateMapLayer(leftMap, 'dist-layer', 'dist-source', geojson, 'dist_pctile');
        updateMapLayer(rightMap, 'visit-layer', 'visit-source', geojson, 'visit_pctile');

        updateLegend('legend-left');

        setupHover(leftMap, 'dist-layer', 'dist-source', rightMap, 'visit-layer', 'visit-source');
        setupHover(rightMap, 'visit-layer', 'visit-source', leftMap, 'dist-layer', 'dist-source');

        fitToBounds(geojson);
    } catch (err) {
        console.error('Error loading metro:', err);
    }

    showLoading(false);
}

/* ============================================================
   Percentile Normalization
   ============================================================ */

function computePercentiles(features, srcProp, destProp) {
    // Collect valid values with their indices
    const entries = [];
    features.forEach((f, i) => {
        const v = f.properties[srcProp];
        if (v != null && !isNaN(v)) {
            entries.push({ idx: i, val: v });
        }
    });

    // Sort by value
    entries.sort((a, b) => a.val - b.val);

    // Assign percentile rank (0–100)
    const n = entries.length;
    entries.forEach((entry, rank) => {
        features[entry.idx].properties[destProp] = (rank / (n - 1)) * 100;
    });

    // Set null for features with missing values
    features.forEach(f => {
        if (f.properties[destProp] == null) {
            f.properties[destProp] = null;
        }
    });
}

function getDistanceMetricForFeatures(features) {
    if (features.some((f) => f.properties && f.properties[DISTANCE_METRIC_PREFERRED] != null)) {
        return DISTANCE_METRIC_PREFERRED;
    }
    return DISTANCE_METRIC_FALLBACK;
}

/* ============================================================
   Map Layer Management
   ============================================================ */

function buildFillColor(property) {
    // Continuous interpolation: red (0) → white (50) → green (100)
    return [
        'case',
        ['==', ['get', property], null],
        'rgba(0,0,0,0)',
        [
            'interpolate',
            ['linear'],
            ['get', property],
            0,  COLOR_LOW,
            50, COLOR_MID,
            100, COLOR_HIGH
        ]
    ];
}

function updateMapLayer(map, layerId, sourceId, geojson, property) {
    // Remove old layers and source if they exist
    if (map.getLayer(layerId + '-zip-highlight')) map.removeLayer(layerId + '-zip-highlight');
    if (map.getLayer(layerId + '-highlight')) map.removeLayer(layerId + '-highlight');
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(sourceId)) map.removeSource(sourceId);

    map.addSource(sourceId, {
        type: 'geojson',
        data: geojson,
        generateId: true
    });

    map.addLayer({
        id: layerId,
        type: 'fill',
        source: sourceId,
        paint: {
            'fill-color': buildFillColor(property),
            'fill-opacity': 0.8,
            'fill-outline-color': 'rgba(255,255,255,0.25)'
        }
    });

    // Highlight layer for hover
    map.addLayer({
        id: layerId + '-highlight',
        type: 'line',
        source: sourceId,
        paint: {
            'line-color': HIGHLIGHT_COLOR,
            'line-width': 2.5,
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'hover'], false],
                1,
                0
            ]
        }
    });

    // Zip lookup highlight layer (persistent, thicker)
    map.addLayer({
        id: layerId + '-zip-highlight',
        type: 'line',
        source: sourceId,
        paint: {
            'line-color': '#facc15',
            'line-width': 3.5,
            'line-opacity': [
                'case',
                ['boolean', ['feature-state', 'zipHighlight'], false],
                1,
                0
            ]
        }
    });
}

/* ============================================================
   Hover & Tooltip
   ============================================================ */

function setupHover(map, layerId, sourceId, otherMap, otherLayerId, otherSourceId) {
    // Remove old listeners by using named handler approach — we just re-add fresh layers each time
    map.on('mousemove', layerId, (e) => {
        if (!e.features.length) return;
        const feature = e.features[0];
        const id = feature.id;

        // Clear previous hover
        if (hoveredId !== null) {
            map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false });
            otherMap.setFeatureState({ source: otherSourceId, id: hoveredId }, { hover: false });
        }

        hoveredId = id;
        map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: true });
        otherMap.setFeatureState({ source: otherSourceId, id: hoveredId }, { hover: true });

        map.getCanvas().style.cursor = 'pointer';
        showTooltip(e, feature.properties);
    });

    map.on('mouseleave', layerId, () => {
        if (hoveredId !== null) {
            map.setFeatureState({ source: sourceId, id: hoveredId }, { hover: false });
            otherMap.setFeatureState({ source: otherSourceId, id: hoveredId }, { hover: false });
            hoveredId = null;
        }
        map.getCanvas().style.cursor = '';
        hideTooltip();
    });

    map.on('click', layerId, (e) => {
        if (!e.features.length) return;
        const feature = e.features[0];
        showZipPanelForFeature(feature.properties, feature.id);
    });
}

function showTooltip(e, props) {
    const tooltip = document.getElementById('tooltip');
    const distVal = props[currentDistanceMetric];
    const distRaw = distVal != null ? Number(distVal).toFixed(2) : 'N/A';
    const distPct = props.dist_pctile != null ? props.dist_pctile.toFixed(0) : 'N/A';
    const visitRaw = props.visit_pct != null ? (props.visit_pct * 100).toFixed(1) + '%' : 'N/A';
    const visitPct = props.visit_pctile != null ? props.visit_pctile.toFixed(0) : 'N/A';
    const pop = props.tot_pop != null ? Number(props.tot_pop).toLocaleString() : 'N/A';

    tooltip.innerHTML = `
        <div class="tooltip-title">Block Group: ${props.GEOID || 'Unknown'}</div>
        <div class="tooltip-row"><span class="tooltip-key">Distance Acc.</span><span class="tooltip-value">${distRaw} (P${distPct})</span></div>
        <div class="tooltip-row"><span class="tooltip-key">Visit Acc.</span><span class="tooltip-value">${visitRaw} (P${visitPct})</span></div>
        <div class="tooltip-row"><span class="tooltip-key">Population</span><span class="tooltip-value">${pop}</span></div>
    `;
    tooltip.style.display = 'block';

    const x = e.originalEvent.clientX;
    const y = e.originalEvent.clientY;
    const offsetX = 16;
    const offsetY = 16;

    // Keep tooltip on screen
    const rect = tooltip.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 8;
    const maxY = window.innerHeight - rect.height - 8;

    tooltip.style.left = Math.min(x + offsetX, maxX) + 'px';
    tooltip.style.top = Math.min(y + offsetY, maxY) + 'px';
}

function hideTooltip() {
    document.getElementById('tooltip').style.display = 'none';
}

/* ============================================================
   Legend
   ============================================================ */

function updateLegend(legendId) {
    const container = document.querySelector(`#${legendId} .legend-items`);
    container.innerHTML = `
        <div class="legend-gradient" style="background: linear-gradient(to right, ${COLOR_LOW}, ${COLOR_MID}, ${COLOR_HIGH});"></div>
        <div class="legend-labels">
            <span>0</span>
            <span>50</span>
            <span>100</span>
        </div>
    `;
}

/* ============================================================
   Utility
   ============================================================ */

function fitToBounds(geojson) {
    const bounds = new mapboxgl.LngLatBounds();
    geojson.features.forEach(f => {
        const addCoords = (coords) => {
            if (typeof coords[0] === 'number') {
                bounds.extend(coords);
            } else {
                coords.forEach(addCoords);
            }
        };
        if (f.geometry && f.geometry.coordinates) {
            addCoords(f.geometry.coordinates);
        }
    });

    leftMap.fitBounds(bounds, { padding: 60, duration: 1500 });
    rightMap.fitBounds(bounds, { padding: 60, duration: 1500 });
}

function showLoading(visible) {
    document.getElementById('loading').classList.toggle('visible', visible);
}

/* ============================================================
   Zip Code Lookup
   ============================================================ */

function initZipLookup() {
    const input = document.getElementById('zip-input');
    const btn = document.getElementById('zip-go');

    btn.addEventListener('click', () => doZipLookup(input.value.trim()));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doZipLookup(input.value.trim());
    });
}

async function doZipLookup(zip) {
    const results = document.getElementById('zip-results');
    const error = document.getElementById('zip-error');
    results.classList.add('hidden');
    error.classList.add('hidden');

    if (!/^\d{5}$/.test(zip)) {
        error.textContent = 'Please enter a valid 5-digit zip code.';
        error.classList.remove('hidden');
        return;
    }

    if (!currentData) {
        error.textContent = 'No metro data loaded yet.';
        error.classList.remove('hidden');
        return;
    }

    // Geocode the zip code
    let point;
    try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${zip}.json?types=postcode&country=US&access_token=${MAPBOX_TOKEN}`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (!data.features || data.features.length === 0) {
            error.textContent = 'Zip code not found.';
            error.classList.remove('hidden');
            return;
        }
        point = data.features[0].center; // [lng, lat]
    } catch (e) {
        error.textContent = 'Geocoding request failed.';
        error.classList.remove('hidden');
        return;
    }

    // Point-in-polygon lookup
    const found = findBlockGroup(point);
    if (!found) {
        error.textContent = 'This zip code is not within the current metro area.';
        error.classList.remove('hidden');
        return;
    }

    showZipPanelForFeature(found.feature.properties, found.id);

    // Fly to location
    const flyOpts = { center: point, zoom: 13, duration: 1500 };
    leftMap.flyTo(flyOpts);
    rightMap.flyTo(flyOpts);
}

function showZipPanelForFeature(props, featureId) {
    const results = document.getElementById('zip-results');
    const error = document.getElementById('zip-error');
    const distPct = Math.max(1, Math.min(99, Math.round(props.dist_pctile)));
    const visitPct = Math.max(1, Math.min(99, Math.round(props.visit_pctile)));

    error.classList.add('hidden');

    // Show results
    document.getElementById('zip-geoid').textContent = `Block Group: ${props.GEOID || 'Unknown'}`;

    // Descriptive sentences
    const distColor = percentileToColor(props.dist_pctile);
    const visitColor = percentileToColor(props.visit_pctile);

    document.getElementById('zip-desc-dist').innerHTML =
        `Residents here are closer to public charging stations than <span class="zip-pct-value" style="color:${distColor}">${distPct}%</span> of block groups in this metro.`;
    document.getElementById('zip-desc-visit').innerHTML =
        `Residents here encounter public chargers during daily routines more than <span class="zip-pct-value" style="color:${visitColor}">${visitPct}%</span> of block groups in this metro.`;

    // Position markers on colorbar
    const distMarker = document.getElementById('zip-marker-dist');
    const visitMarker = document.getElementById('zip-marker-visit');
    distMarker.style.left = distPct + '%';
    distMarker.querySelector('.zip-marker-arrow').style.color = distColor;
    distMarker.querySelector('.zip-marker-label').style.color = distColor;
    visitMarker.style.left = visitPct + '%';
    visitMarker.querySelector('.zip-marker-arrow').style.color = visitColor;
    visitMarker.querySelector('.zip-marker-label').style.color = visitColor;

    // Legend swatches
    document.getElementById('zip-swatch-dist').style.background = distColor;
    document.getElementById('zip-swatch-visit').style.background = visitColor;

    results.classList.remove('hidden');

    // Highlight the block group on both maps
    highlightZipFeature(featureId);

    // Show PCS station details
    updatePcsPanel(props.GEOID);
}

function findBlockGroup(point) {
    const [lng, lat] = point;
    for (let i = 0; i < currentData.features.length; i++) {
        const f = currentData.features[i];
        if (!f.geometry) continue;
        if (pointInFeature(lng, lat, f.geometry)) {
            return { feature: f, id: i };
        }
    }
    return null;
}

function pointInFeature(lng, lat, geometry) {
    const type = geometry.type;
    const coords = geometry.coordinates;
    if (type === 'Polygon') {
        return pointInPolygon(lng, lat, coords);
    } else if (type === 'MultiPolygon') {
        for (const poly of coords) {
            if (pointInPolygon(lng, lat, poly)) return true;
        }
    }
    return false;
}

function pointInPolygon(lng, lat, rings) {
    // Ray-casting on the outer ring
    const ring = rings[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

let zipHighlightId = null;

function highlightZipFeature(featureId) {
    // Clear previous zip highlight
    if (zipHighlightId !== null) {
        leftMap.setFeatureState({ source: 'dist-source', id: zipHighlightId }, { zipHighlight: false });
        rightMap.setFeatureState({ source: 'visit-source', id: zipHighlightId }, { zipHighlight: false });
    }
    zipHighlightId = featureId;
    leftMap.setFeatureState({ source: 'dist-source', id: featureId }, { zipHighlight: true });
    rightMap.setFeatureState({ source: 'visit-source', id: featureId }, { zipHighlight: true });
}

function percentileToColor(pct) {
    // Saturated version for markers/text on dark backgrounds
    // red (0) → warm yellow (50) → green (100) — avoids white mid-range
    let r, g, b;
    if (pct <= 50) {
        const t = pct / 50;
        r = 239;
        g = 68 + (180 - 68) * t;
        b = 68 - 30 * t;
    } else {
        const t = (pct - 50) / 50;
        r = 239 - (239 - 52) * t;
        g = 180 - (180 - 211) * t;
        b = 38 + (153 - 38) * t;
    }
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

/* ============================================================
   PCS Data Loading & Display
   ============================================================ */

async function loadPcsData(metro) {
    if (pcsDataCache[metro]) {
        currentPcsData = pcsDataCache[metro];
        return;
    }
    try {
        const filename = `pcs_per_cbg_${metro}.csv`;
        const resp = await fetch(`${PCS_DATA_PATH}/${encodeURIComponent(filename)}`);
        if (!resp.ok) { currentPcsData = null; return; }
        const text = await resp.text();
        currentPcsData = parsePcsCsv(text);
        pcsDataCache[metro] = currentPcsData;
    } catch (e) {
        console.warn('PCS data not available for', metro, e);
        currentPcsData = null;
    }
}

function parsePcsCsv(text) {
    const lines = text.split('\n');
    if (lines.length < 2) return {};
    const headers = parseCSVLine(lines[0]);
    const data = {};
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const vals = parseCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, j) => { row[h] = vals[j] || ''; });
        const geoid = String(row.GEOID).padStart(12, '0');
        data[geoid] = row;
    }
    return data;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { result.push(current); current = ''; }
            else { current += ch; }
        }
    }
    result.push(current);
    return result;
}

function updatePcsPanel(geoid) {
    const distInfo = document.getElementById('pcs-dist-info');
    const visitInfo = document.getElementById('pcs-visit-info');

    // Clear previous markers
    clearPcsMarkers();

    if (!currentPcsData) {
        distInfo.innerHTML = '<span class="pcs-no-data">No data available</span>';
        visitInfo.innerHTML = '<span class="pcs-no-data">No data available</span>';
        return;
    }

    const padded = String(geoid).padStart(12, '0');
    const row = currentPcsData[padded];
    if (!row) {
        distInfo.innerHTML = '<span class="pcs-no-data">No data for this block group</span>';
        visitInfo.innerHTML = '<span class="pcs-no-data">No data for this block group</span>';
        return;
    }

    // --- Closest PCS (distance) ---
    const distKm = parseFloat(row.closest_pcs_dist_km);
    const distMi = parseFloat(row.closest_pcs_dist_mi);
    const distLat = parseFloat(row.closest_pcs_lat);
    const distLon = parseFloat(row.closest_pcs_lon);

    if (!isNaN(distKm)) {
        distInfo.innerHTML = `
            <div class="pcs-stat">
                <span class="pcs-stat-label">Distance</span>
                <span class="pcs-stat-value">${distMi.toFixed(2)} mi (${distKm.toFixed(2)} km)</span>
            </div>
        `;
        addPcsMarker(distLon, distLat, 'D', 'pcs-marker-dist',
            `Closest PCS\n${distMi.toFixed(2)} mi away`);
    } else {
        distInfo.innerHTML = '<span class="pcs-no-data">No data available</span>';
    }

    // --- Most Visited PCS (visit) ---
    const visitPct = parseFloat(row.most_visited_pcs_visit_pct);
    const visitLat = parseFloat(row.most_visited_pcs_lat);
    const visitLon = parseFloat(row.most_visited_pcs_lon);
    const topPois = row.top_pois_at_most_visited_pcs;

    if (!isNaN(visitPct)) {
        let poisHtml = '';
        if (topPois && topPois.trim()) {
            const poiEntries = topPois.split('; ').slice(0, 3);
            const items = poiEntries.map(entry => {
                const parts = entry.split('|');
                const name = parts[0] || 'Unknown';
                const cat = parts[1] && parts[1] !== 'None' ? parts[1] : '';
                const truncName = name.length > 28 ? name.substring(0, 26) + '...' : name;
                return `<li><span class="poi-name">${truncName}</span>${cat ? ' <span style="opacity:0.6">(' + (cat.length > 20 ? cat.substring(0,18) + '...' : cat) + ')</span>' : ''}</li>`;
            });
            poisHtml = `
                <div class="pcs-nearby-title">Nearby places visited</div>
                <ul class="pcs-nearby-list">${items.join('')}</ul>
            `;
        }

        visitInfo.innerHTML = `
            <div class="pcs-stat">
                <span class="pcs-stat-label">Visit share</span>
                <span class="pcs-stat-value">${(visitPct * 100).toFixed(1)}%</span>
            </div>
            ${poisHtml}
        `;
        addPcsMarker(visitLon, visitLat, 'V', 'pcs-marker-visit',
            `Most visited PCS\n${(visitPct * 100).toFixed(1)}% of visits`);
    } else {
        visitInfo.innerHTML = '<span class="pcs-no-data">No visit data available</span>';
    }
}

function addPcsMarker(lng, lat, label, className, title) {
    if (isNaN(lng) || isNaN(lat)) return;
    const el = document.createElement('div');
    el.className = `pcs-marker ${className}`;
    el.textContent = label;
    el.title = title;

    const markerL = new mapboxgl.Marker({ element: el.cloneNode(true), anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(leftMap);
    const elR = el.cloneNode(true);
    const markerR = new mapboxgl.Marker({ element: elR, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(rightMap);
    pcsMarkers.push(markerL, markerR);
}

function clearPcsMarkers() {
    pcsMarkers.forEach(m => m.remove());
    pcsMarkers = [];
}

/* ============================================================
   Zip Panel Reset on Metro Change
   ============================================================ */

function resetZipPanel() {
    document.getElementById('zip-input').value = '';
    document.getElementById('zip-results').classList.add('hidden');
    document.getElementById('zip-error').classList.add('hidden');
    clearPcsMarkers();
    if (zipHighlightId !== null) {
        zipHighlightId = null;
    }
}

/* ============================================================
   Info Modal
   ============================================================ */

function initInfoModal() {
    const btn = document.getElementById('info-btn');
    const overlay = document.getElementById('info-overlay');
    const closeBtn = document.getElementById('info-close');

    btn.addEventListener('click', () => overlay.classList.remove('hidden'));
    closeBtn.addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.add('hidden');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
    });
}

/* ============================================================
   Start
   ============================================================ */

initMaps();
initZipLookup();
initInfoModal();
