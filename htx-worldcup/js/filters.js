const POI_COLOR = '#3b82f6';

const SUBCATEGORY_COLORS = {
    'Hotels (except Casino Hotels) and Motels': POI_COLOR,
    'Bed-and-Breakfast Inns':                   POI_COLOR,
    'Casino Hotels':                            POI_COLOR,
    'All Other Traveler Accommodation':         POI_COLOR,
    'Other Traveler Accommodation':             POI_COLOR,
};

const SUBCATEGORY_SHORT = {
    'Hotels (except Casino Hotels) and Motels': 'Hotels & Motels',
    'Bed-and-Breakfast Inns':                   'B&Bs',
    'Casino Hotels':                            'Casino Hotels',
    'All Other Traveler Accommodation':         'Other Accommodation',
    'Other Traveler Accommodation':             'Other Traveler',
};

const NAMED_CATEGORIES = new Set([
    'Hotels (except Casino Hotels) and Motels',
    'Bed-and-Breakfast Inns',
    'Casino Hotels',
]);

let allFeatures = [];
let searchQuery = '';
let onFilterChange = null;

function initFilters(features, filterCallback) {
    allFeatures = features;
    onFilterChange = filterCallback;
    updateStats();
    initSearch();
    initDetailClose();
}

function initSearch() {
    const input = document.getElementById('search-input');
    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            searchQuery = input.value.trim().toLowerCase();
            applyFilters();
        }, 200);
    });
}

function initDetailClose() {
    document.getElementById('detail-close').addEventListener('click', hideDetail);
}

function getFilteredFeatures() {
    return allFeatures.filter(f => {
        if (searchQuery) {
            const name = (f.properties.LOCATION_NAME || '').toLowerCase();
            if (!name.includes(searchQuery)) return false;
        }
        return true;
    });
}

function applyFilters() {
    updateStats();
    if (onFilterChange) onFilterChange();
}

function updateStats() {
    const filtered = getFilteredFeatures();
    const container = document.getElementById('stats-content');

    const grouped = { 'Hotels & Motels': 0, 'B&Bs': 0, 'Casino Hotels': 0, 'Other Accommodation': 0 };
    filtered.forEach(f => {
        const cat = f.properties.SUB_CATEGORY || 'Unknown';
        if (cat === 'Hotels (except Casino Hotels) and Motels') grouped['Hotels & Motels']++;
        else if (cat === 'Bed-and-Breakfast Inns') grouped['B&Bs']++;
        else if (cat === 'Casino Hotels') grouped['Casino Hotels']++;
        else grouped['Other Accommodation']++;
    });

    const maxCount = Math.max(...Object.values(grouped), 1);

    let totalVisits = 0;
    let dwellSum = 0;
    let dwellCount = 0;
    filtered.forEach(f => {
        totalVisits += (f.properties.total_visits || 0);
        if (f.properties.mean_dwell) {
            dwellSum += f.properties.mean_dwell;
            dwellCount++;
        }
    });
    const avgDwell = dwellCount > 0 ? Math.round(dwellSum / dwellCount) : 0;

    let html = `<div class="stat-total">#${filtered.length.toLocaleString()}</div>`;
    html += `<div class="stat-label">accommodation POIs shown</div>`;
    html += `<div class="stat-visits-row">`;
    html += `<span class="stat-visits-value">${totalVisits.toLocaleString()}</span> total recorded visits`;
    html += `</div>`;
    if (avgDwell > 0) {
        html += `<div class="stat-visits-row">`;
        html += `<span class="stat-visits-value">${avgDwell}</span> min avg dwell`;
        html += `</div>`;
    }

    Object.entries(grouped).forEach(([label, count]) => {
        if (count === 0) return;
        const pct = (count / maxCount) * 100;
        html += `
            <div class="stat-bar-row">
                <span class="stat-bar-label">${label}</span>
                <div class="stat-bar-track">
                    <div class="stat-bar-fill" style="width:${pct}%;background:${POI_COLOR}"></div>
                </div>
                <span class="stat-bar-count">${count.toLocaleString()}</span>
            </div>`;
    });

    html += `<div class="histogram-section">`;
    html += `<div class="histogram-title">Visit Distribution</div>`;
    html += `<canvas id="visits-histogram" width="260" height="120"></canvas>`;
    html += `</div>`;

    container.innerHTML = html;
    drawHistogram(filtered);
}

function drawHistogram(features) {
    const canvas = document.getElementById('visits-histogram');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const visits = features.map(f => f.properties.total_visits || 0).filter(v => v > 0);
    if (visits.length === 0) {
        ctx.fillStyle = '#475569';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No visit data', w / 2, h / 2);
        return;
    }

    const NUM_BINS = 20;
    const maxVisit = Math.max(...visits);
    const minVisit = Math.min(...visits);
    const logMin = Math.log10(Math.max(minVisit, 1));
    const logMax = Math.log10(maxVisit);
    const logRange = logMax - logMin;
    const binWidth = logRange / NUM_BINS;

    const bins = new Array(NUM_BINS).fill(0);
    const binEdges = [];
    for (let i = 0; i <= NUM_BINS; i++) {
        binEdges.push(Math.pow(10, logMin + i * binWidth));
    }
    visits.forEach(v => {
        const logV = Math.log10(Math.max(v, 1));
        const idx = Math.min(Math.floor((logV - logMin) / binWidth), NUM_BINS - 1);
        bins[idx]++;
    });
    const maxBin = Math.max(...bins);

    const padLeft = 32;
    const padRight = 8;
    const padTop = 4;
    const padBottom = 22;
    const plotW = w - padLeft - padRight;
    const plotH = h - padTop - padBottom;
    const barW = plotW / NUM_BINS;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    const numTicks = 4;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= numTicks; i++) {
        const y = padTop + plotH - (i / numTicks) * plotH;
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(w - padRight, y);
        ctx.stroke();
        const label = Math.round((i / numTicks) * maxBin);
        ctx.fillText(label, padLeft - 4, y + 3);
    }

    bins.forEach((count, i) => {
        const barH = maxBin > 0 ? (count / maxBin) * plotH : 0;
        const x = padLeft + i * barW;
        const y = padTop + plotH - barH;
        ctx.fillStyle = POI_COLOR;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x + 1, y, barW - 2, barH);
        ctx.globalAlpha = 1;
    });

    ctx.fillStyle = '#64748b';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    const tickValues = [];
    const minPow = Math.ceil(logMin);
    const maxPow = Math.floor(logMax);
    for (let p = minPow; p <= maxPow; p++) tickValues.push(Math.pow(10, p));
    const seen = new Set();
    tickValues.forEach(val => {
        const xPos = padLeft + ((Math.log10(val) - logMin) / logRange) * plotW;
        if (xPos < padLeft - 5 || xPos > w - padRight + 5) return;
        const label = val >= 1000 ? Math.round(val / 1000) + 'k' : Math.round(val);
        if (seen.has(label)) return;
        seen.add(label);
        ctx.fillText(label, xPos, h - 4);
    });
}

function showDetail(properties) {
    const section = document.getElementById('detail-section');
    const content = document.getElementById('detail-content');
    const cat = properties.SUB_CATEGORY || 'Unknown';
    const color = SUBCATEGORY_COLORS[cat] || '#94a3b8';
    const shortName = SUBCATEGORY_SHORT[cat] || cat;

    let brandText = '';
    if (properties.BRANDS) {
        try {
            const brands = JSON.parse(properties.BRANDS);
            brandText = brands.map(b => b.safegraph_brand_name).join(', ');
        } catch (e) {
            brandText = '';
        }
    }

    let hoursText = '';
    if (properties.OPEN_HOURS) {
        try {
            const hours = JSON.parse(properties.OPEN_HOURS);
            hoursText = Object.entries(hours)
                .map(([day, slots]) => {
                    const times = slots.map(s => s.join('–')).join(', ');
                    return `${day}: ${times}`;
                })
                .join('<br>');
        } catch (e) {
            hoursText = '';
        }
    }

    let html = `<div class="detail-name">${properties.LOCATION_NAME || 'Unknown'}</div>`;
    html += `<div class="detail-subcategory" style="background:${color}22;color:${color}">${shortName}</div>`;

    const rows = [];
    if (properties.STREET_ADDRESS) rows.push(['Address', properties.STREET_ADDRESS]);
    if (properties.CITY) rows.push(['City', `${properties.CITY}, ${properties.POSTAL_CODE || ''}`]);
    if (brandText) rows.push(['Brand', brandText]);
    const detailVisits = Number(properties.total_visits) || 0;
    const detailMeanDwell = parseFloat(properties.mean_dwell);
    const detailMedianDwell = parseFloat(properties.median_dwell);
    if (detailVisits > 0) {
        rows.push(['Visits', `${detailVisits.toLocaleString()} (Nov '25 – Feb '26)`]);
        if (detailMeanDwell > 0) rows.push(['Avg Dwell', `${Math.round(detailMeanDwell)} min`]);
        if (detailMedianDwell > 0) rows.push(['Med Dwell', `${Math.round(detailMedianDwell)} min`]);
    }
    if (properties.PHONE_NUMBER) rows.push(['Phone', properties.PHONE_NUMBER]);
    if (properties.WEBSITE) {
        const domain = (properties.DOMAINS || '').replace(/[\[\]"]/g, '');
        rows.push(['Website', `<a href="https://${domain}" target="_blank" rel="noopener">${domain}</a>`]);
    }

    rows.forEach(([key, val]) => {
        html += `<div class="detail-row"><span class="detail-key">${key}</span><span class="detail-value">${val}</span></div>`;
    });

    if (hoursText) {
        html += `<div class="detail-row"><span class="detail-key">Hours</span><span class="detail-value">${hoursText}</span></div>`;
    }

    content.innerHTML = html;
    section.classList.remove('hidden');
}

function hideDetail() {
    document.getElementById('detail-section').classList.add('hidden');
}

function getSubcategoryColor(subcategory) {
    return SUBCATEGORY_COLORS[subcategory] || '#94a3b8';
}
