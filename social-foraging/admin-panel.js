let adminParameters = {};
let stations = [];
let selectedStation = null;
let isSimulationRunning = false;

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
    await loadParameters();
    await loadStations();
    loadSimulationStatus();
    initSliders();
    initMapClick();
    initButtons();
    resizeMap();
    window.addEventListener('resize', resizeMap);
});

async function loadParameters() {
    try {
        const res = await fetch('/admin-parameters');
        adminParameters = await res.json();
    } catch {
        adminParameters = { stationCount: 5, playerBudget: 100, minChargeTime: 30, maxChargeTime: 90, minPrice: 10, maxPrice: 35 };
    }
    for (const key of ['stationCount', 'playerBudget', 'minChargeTime', 'maxChargeTime', 'minPrice', 'maxPrice']) {
        const input = $(key);
        if (input) {
            input.value = adminParameters[key];
            const valEl = $(key + 'Val');
            if (valEl) valEl.textContent = adminParameters[key];
        }
    }
}

function initSliders() {
    for (const key of ['stationCount', 'playerBudget', 'minChargeTime', 'maxChargeTime', 'minPrice', 'maxPrice']) {
        const input = $(key);
        if (input) {
            input.addEventListener('input', () => {
                const valEl = $(key + 'Val');
                if (valEl) valEl.textContent = input.value;
            });
        }
    }
}

async function updateParameters() {
    const params = {};
    for (const key of ['stationCount', 'playerBudget', 'minChargeTime', 'maxChargeTime', 'minPrice', 'maxPrice']) {
        params[key] = parseInt($(key).value);
    }
    if (params.minChargeTime > params.maxChargeTime || params.minPrice > params.maxPrice) {
        alert('Min values must be less than max values');
        return;
    }
    try {
        const res = await fetch('/admin-parameters', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params)
        });
        if (res.ok) alert('Parameters updated!');
        else alert('Error updating parameters');
    } catch { alert('Network error'); }
}

async function loadSimulationStatus() {
    try {
        const res = await fetch('/simulation-status');
        const data = await res.json();
        isSimulationRunning = data.isRunning;
        updateSimUI();
    } catch {}
}

function updateSimUI() {
    const btn = $('simButton');
    const status = $('simStatus');
    if (isSimulationRunning) {
        btn.textContent = 'End Simulation';
        btn.className = 'sim-btn stop';
        status.textContent = 'Simulation is running';
        status.style.color = '#4ade80';
    } else {
        btn.textContent = 'Start Simulation';
        btn.className = 'sim-btn start';
        status.textContent = 'Waiting to start';
        status.style.color = '#94a3b8';
    }
}

async function toggleSimulation() {
    const action = isSimulationRunning ? 'stop' : 'start';
    try {
        const res = await fetch('/simulation-control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (data.success) {
            isSimulationRunning = !isSimulationRunning;
            updateSimUI();
            alert(data.message);
        } else { alert('Error: ' + data.message); }
    } catch { alert('Network error'); }
}

async function loadStations() {
    try {
        const res = await fetch('/load-station-config');
        const data = await res.json();
        stations = data.stations || [];
        renderStationsOnMap();
        renderStationList();
    } catch {}
}

function renderStationsOnMap() {
    document.querySelectorAll('.admin-station').forEach(el => el.remove());
    const mapEl = $('adminMap');
    stations.forEach(s => {
        const el = document.createElement('div');
        el.className = 'admin-station' + (selectedStation && selectedStation.id === s.id ? ' selected' : '');
        el.style.cssText = `position:absolute;left:${s.left}px;top:${s.top}px;width:30px;height:30px;background:#f59e0b;border:2px solid #b45309;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10;font-size:14px;`;
        el.textContent = '⚡';
        el.addEventListener('click', (e) => { e.stopPropagation(); selectStation(s); });
        mapEl.appendChild(el);
    });
}

function renderStationList() {
    const list = $('stationList');
    list.innerHTML = '';
    stations.forEach(s => {
        const item = document.createElement('div');
        item.className = 'station-item';
        item.innerHTML = `
            <div class="info"><strong>${s.id}</strong> (${s.left}, ${s.top}) $${s.cost} | ${s.sockets} sockets | ${s.chargeTime}s</div>
            <div class="actions">
                <button class="btn btn-primary" onclick="selectStation(${JSON.stringify(s).replace(/"/g, '&quot;')})">Edit</button>
                <button class="btn btn-danger" onclick="deleteStationById('${s.id}')">Del</button>
            </div>
        `;
        list.appendChild(item);
    });
}

function selectStation(s) {
    selectedStation = s;
    $('stationX').value = s.left;
    $('stationY').value = s.top;
    $('stationCost').value = s.cost;
    $('stationSockets').value = s.sockets;
    $('stationChargeTime').value = s.chargeTime;
    renderStationsOnMap();
}

function clearSelection() {
    selectedStation = null;
    $('stationX').value = '';
    $('stationY').value = '';
    $('stationCost').value = '';
    $('stationSockets').value = '';
    $('stationChargeTime').value = '';
    renderStationsOnMap();
}

function getNextStationId() {
    const ids = stations.map(s => { const m = s.id.match(/station-(\d+)/); return m ? parseInt(m[1]) : -1; }).filter(id => id >= 0);
    return ids.length === 0 ? 0 : Math.max(...ids) + 1;
}

function addStation() {
    const x = parseInt($('stationX').value);
    const y = parseInt($('stationY').value);
    const cost = parseInt($('stationCost').value);
    const sockets = parseInt($('stationSockets').value);
    const chargeTime = parseInt($('stationChargeTime').value);
    if (!x && x !== 0 || !y && y !== 0 || !cost || !sockets || !chargeTime) { alert('Fill all fields'); return; }
    stations.push({ id: `station-${getNextStationId()}`, left: x, top: y, cost, sockets, chargeTime, activeChargers: 0 });
    renderStationsOnMap();
    renderStationList();
    clearSelection();
}

function updateStation() {
    if (!selectedStation) { alert('Select a station first'); return; }
    selectedStation.left = parseInt($('stationX').value);
    selectedStation.top = parseInt($('stationY').value);
    selectedStation.cost = parseInt($('stationCost').value);
    selectedStation.sockets = parseInt($('stationSockets').value);
    selectedStation.chargeTime = parseInt($('stationChargeTime').value);
    renderStationsOnMap();
    renderStationList();
    clearSelection();
}

function deleteStationById(id) {
    if (!confirm('Delete this station?')) return;
    stations = stations.filter(s => s.id !== id);
    if (selectedStation && selectedStation.id === id) clearSelection();
    renderStationsOnMap();
    renderStationList();
}

function clearAllStations() {
    if (!stations.length || !confirm('Delete ALL stations?')) return;
    stations = [];
    clearSelection();
    renderStationsOnMap();
    renderStationList();
}

async function applyToGame() {
    if (!stations.length) { alert('Add stations first'); return; }
    try {
        const res = await fetch('/save-station-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stations })
        });
        const data = await res.json();
        alert(data.success ? 'Applied to game!' : 'Error: ' + data.message);
    } catch { alert('Network error'); }
}

function initMapClick() {
    $('adminMap').addEventListener('click', (e) => {
        if (e.target.closest('.admin-station')) return;
        const rect = $('adminMap').getBoundingClientRect();
        const scaleX = 1000 / rect.width;
        const scaleY = 1000 / rect.height;
        $('stationX').value = Math.round((e.clientX - rect.left) * scaleX);
        $('stationY').value = Math.round((e.clientY - rect.top) * scaleY);
    });
}

function resizeMap() {
    const container = document.querySelector('.admin-map-container');
    if (!container) return;
    const w = container.clientWidth;
    const mapEl = $('adminMap');
    if (mapEl) mapEl.style.transform = `scale(${w / 1000})`;
}

function initButtons() {
    $('btnUpdateParams').addEventListener('click', updateParameters);
    $('simButton').addEventListener('click', toggleSimulation);
    $('btnAddStation').addEventListener('click', addStation);
    $('btnUpdateStation').addEventListener('click', updateStation);
    $('btnClearAll').addEventListener('click', clearAllStations);
    $('btnApply').addEventListener('click', applyToGame);
}
