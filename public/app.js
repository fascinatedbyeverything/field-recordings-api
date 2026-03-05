// ===== Config =====
const API_BASE = window.location.hostname === 'localhost' ? 'https://field-recordings-api.ashtarchris.workers.dev' : '';

const TYPE_COLORS = {
  nature: '#22c55e',
  birds: '#16a34a',
  mammals: '#ea580c',
  amphibians: '#0d9488',
  insects: '#7c3aed',
  fish: '#06b6d4',
  ocean: '#0284c7',
  forest: '#15803d',
  river: '#0891b2',
  desert: '#d97706',
  weather: '#6b7280',
  urban: '#71717a',
  cultural: '#a16207',
  folk: '#b45309',
  language: '#9333ea',
};
const DEFAULT_COLOR = '#ef4444';

// ===== State =====
let map;
let searchLat = null;
let searchLng = null;
let searchRadius = 100;
let minDuration = 60; // default 1+ min for ambient recordings
let recordings = [];
let currentRecording = null;
let radiusCircle = null;   // GeoJSON source ID
let locationMarker = null;
let panelOpen = true;

// ===== DOM refs =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const panelEl = $('#panel');
const panelToggle = $('#panel-toggle');
const panelClose = $('#panel-close');
const searchInput = $('#search-input');
const locationInput = $('#location-input');
const geocodeBtn = $('#geocode-btn');
const radiusSlider = $('#radius-slider');
const radiusValue = $('#radius-value');
const locationHint = $('#location-hint');
const yearFrom = $('#year-from');
const yearTo = $('#year-to');
const searchBtn = $('#search-btn');
const resultsHeader = $('#results-header');
const resultsLoading = $('#results-loading');
const resultsError = $('#results-error');
const resultsList = $('#results-list');
const playerEl = $('#player');
const playerTitle = $('#player-title');
const playerProvider = $('#player-provider');
const playPauseBtn = $('#play-pause-btn');
const playIcon = $('#play-icon');
const pauseIcon = $('#pause-icon');
const playerProgress = $('#player-progress');
const playerCurrent = $('#player-current');
const playerDuration = $('#player-duration');
const audioEl = $('#audio');

// ===== Panel toggle =====
function togglePanel(open) {
  panelOpen = typeof open === 'boolean' ? open : !panelOpen;
  panelEl.classList.toggle('panel-closed', !panelOpen);
  panelEl.classList.toggle('panel-open', panelOpen);
  $('#map').classList.toggle('full-width', !panelOpen);
  panelToggle.classList.toggle('shifted', !panelOpen);
  setTimeout(() => map && map.resize(), 320);
}

panelToggle.addEventListener('click', () => togglePanel());
panelClose.addEventListener('click', () => togglePanel(false));

// ===== Chips =====
$$('#type-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('active'));
});

$$('#time-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => chip.classList.toggle('active'));
});

// Duration chips — single select (radio behavior)
$$('#duration-chips .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    $$('#duration-chips .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    minDuration = parseInt(chip.dataset.duration, 10);
  });
});

// ===== Radius slider =====
radiusSlider.addEventListener('input', () => {
  searchRadius = parseInt(radiusSlider.value, 10);
  radiusValue.textContent = searchRadius;
  if (searchLat !== null) drawRadiusCircle();
});

// ===== Geocode =====
async function geocode(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (data.length === 0) {
      locationHint.textContent = 'Place not found. Try another name.';
      return;
    }
    const place = data[0];
    searchLat = parseFloat(place.lat);
    searchLng = parseFloat(place.lon);
    locationHint.textContent = `${place.display_name.split(',').slice(0, 2).join(',')}`;
    map.flyTo({ center: [searchLng, searchLat], zoom: 7 });
    drawRadiusCircle();
    placeLocationMarker();
  } catch (e) {
    locationHint.textContent = 'Geocode failed: ' + e.message;
  }
}

geocodeBtn.addEventListener('click', () => {
  const q = locationInput.value.trim();
  if (q) geocode(q);
});

locationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = locationInput.value.trim();
    if (q) geocode(q);
  }
});

// ===== Radius circle =====
function createRadiusGeoJSON(lat, lng, radiusKm) {
  const points = 64;
  const coords = [];
  const earthRadiusKm = 6371;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dLat = (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.cos(angle);
    const dLng = (radiusKm / earthRadiusKm) * (180 / Math.PI) * Math.sin(angle) / Math.cos(lat * Math.PI / 180);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] } };
}

function drawRadiusCircle() {
  if (!searchLat) return;
  const geojson = createRadiusGeoJSON(searchLat, searchLng, searchRadius);
  const src = map.getSource('radius-circle');
  if (src) {
    src.setData(geojson);
  } else {
    map.addSource('radius-circle', { type: 'geojson', data: geojson });
    map.addLayer({
      id: 'radius-circle-fill',
      type: 'fill',
      source: 'radius-circle',
      paint: { 'fill-color': '#2563eb', 'fill-opacity': 0.1 }
    });
    map.addLayer({
      id: 'radius-circle-line',
      type: 'line',
      source: 'radius-circle',
      paint: { 'line-color': '#2563eb', 'line-width': 2, 'line-opacity': 0.5 }
    });
  }
}

// ===== Location marker =====
function placeLocationMarker() {
  if (locationMarker) locationMarker.remove();
  const el = document.createElement('div');
  el.style.width = '16px';
  el.style.height = '16px';
  el.style.borderRadius = '50%';
  el.style.background = '#2563eb';
  el.style.border = '3px solid white';
  el.style.boxShadow = '0 0 6px rgba(0,0,0,0.3)';
  locationMarker = new maplibregl.Marker({ element: el }).setLngLat([searchLng, searchLat]).addTo(map);
}

// ===== Map click → set location =====
function onMapClick(e) {
  searchLat = e.lngLat.lat;
  searchLng = e.lngLat.lng;
  locationInput.value = '';
  locationHint.textContent = `Pin: ${searchLat.toFixed(3)}, ${searchLng.toFixed(3)}`;
  drawRadiusCircle();
  placeLocationMarker();
}

// ===== Search =====
async function doSearch() {
  const params = new URLSearchParams();

  // Build q from free text + type chips + location text + time of day
  const freeText = searchInput.value.trim();
  const activeTypes = Array.from($$('#type-chips .chip.active')).map(c => c.dataset.type);
  const activeTimes = Array.from($$('#time-chips .chip.active')).map(c => c.dataset.time);
  const locationText = locationInput.value.trim();

  // Combine into a search query
  const qParts = [];
  if (freeText) qParts.push(freeText);
  if (activeTypes.length) qParts.push(...activeTypes);
  if (activeTimes.length) qParts.push(...activeTimes);
  if (locationText && searchLat === null) qParts.push(locationText); // text-only search
  if (qParts.length) params.set('q', qParts.join(' '));

  // Types
  if (activeTypes.length) params.set('type', activeTypes.join(','));

  // Location (geocoded)
  if (searchLat !== null) {
    params.set('lat', searchLat.toFixed(5));
    params.set('lng', searchLng.toFixed(5));
    params.set('radius', searchRadius);
  }

  // Duration filter
  if (minDuration > 0) params.set('min_duration', minDuration);

  // Sort longest first for ambient listening
  params.set('sort', 'duration');

  // Per page
  params.set('per_page', '50');

  resultsLoading.classList.remove('hidden');
  resultsError.classList.add('hidden');
  resultsHeader.innerHTML = '';
  resultsList.innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/search?${params.toString()}`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();

    recordings = data.recordings || [];

    // Header
    let headerText = `<strong>${data.total ?? recordings.length}</strong> results from <strong>${data.providers_queried ?? '?'}</strong> providers`;
    if (data.providers_failed && data.providers_failed.length) {
      headerText += `<br><span class="failures">Failed: ${data.providers_failed.join(', ')}</span>`;
    }
    resultsHeader.innerHTML = headerText;

    // Render cards
    renderResults(recordings);

    // Render map markers
    renderMapMarkers(recordings);

  } catch (e) {
    resultsError.textContent = 'Search failed: ' + e.message;
    resultsError.classList.remove('hidden');
  } finally {
    resultsLoading.classList.add('hidden');
  }
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// ===== Render results =====
function formatDuration(sec) {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function renderResults(recs) {
  resultsList.innerHTML = '';
  if (!recs.length) {
    resultsList.innerHTML = '<p style="color:var(--text-secondary);padding:20px 0;text-align:center;">No recordings found.</p>';
    return;
  }
  recs.forEach((rec, idx) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.dataset.idx = idx;

    const tagPills = (rec.tags || []).slice(0, 6).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('');

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title">${esc(rec.title || 'Untitled')}</div>
        <div class="card-duration">${formatDuration(rec.duration_sec)}</div>
      </div>
      <div class="card-meta">
        <span class="provider-badge">${esc(rec.provider || '')}</span>
        ${rec.species ? `<span class="card-species">${esc(rec.species)}</span>` : ''}
      </div>
      ${tagPills ? `<div class="card-tags">${tagPills}</div>` : ''}
    `;

    card.addEventListener('click', () => {
      // Highlight card
      $$('.result-card.active').forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      // Fly to on map
      if (rec.lat != null && rec.lng != null) {
        map.flyTo({ center: [rec.lng, rec.lat], zoom: Math.max(map.getZoom(), 5) });
      }

      // Play
      playRecording(rec);
    });

    resultsList.appendChild(card);
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ===== Map markers =====
function getRecordingColor(rec) {
  // Determine type from tags or other fields
  const tags = (rec.tags || []).map(t => t.toLowerCase());
  for (const [type, color] of Object.entries(TYPE_COLORS)) {
    if (tags.includes(type)) return color;
  }
  // Try species field
  const sp = (rec.species || '').toLowerCase();
  if (sp.includes('bird') || sp.includes('aves')) return TYPE_COLORS.birds;
  if (sp.includes('mammal')) return TYPE_COLORS.mammals;
  if (sp.includes('frog') || sp.includes('amphi')) return TYPE_COLORS.amphibians;
  if (sp.includes('insect')) return TYPE_COLORS.insects;

  // Check provider for hints
  const p = (rec.provider || '').toLowerCase();
  if (p === 'xeno-canto') return TYPE_COLORS.birds;

  return DEFAULT_COLOR;
}

function renderMapMarkers(recs) {
  // Remove old source/layers
  if (map.getLayer('clusters')) map.removeLayer('clusters');
  if (map.getLayer('cluster-count')) map.removeLayer('cluster-count');
  if (map.getLayer('unclustered-point')) map.removeLayer('unclustered-point');
  if (map.getSource('recordings')) map.removeSource('recordings');

  const geoRecs = recs.filter(r => r.lat != null && r.lng != null);
  const features = geoRecs.map((r, i) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    properties: {
      idx: i,
      color: getRecordingColor(r),
      title: r.title || 'Untitled',
    }
  }));

  // Fit map to show all markers
  if (geoRecs.length > 0) {
    const lngs = geoRecs.map(r => r.lng);
    const lats = geoRecs.map(r => r.lat);
    const bounds = [
      [Math.min(...lngs) - 2, Math.min(...lats) - 2],
      [Math.max(...lngs) + 2, Math.max(...lats) + 2],
    ];
    map.fitBounds(bounds, { padding: 50, maxZoom: 8 });
  }

  map.addSource('recordings', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50
  });

  // Cluster circles
  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'recordings',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': [
        'step', ['get', 'point_count'],
        '#93c5fd', 10,
        '#60a5fa', 30,
        '#3b82f6', 100,
        '#2563eb'
      ],
      'circle-radius': [
        'step', ['get', 'point_count'],
        18, 10,
        24, 30,
        30, 100,
        36
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Cluster count labels
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'recordings',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-font': ['Open Sans Bold'],
      'text-size': 14
    },
    paint: {
      'text-color': '#ffffff'
    }
  });

  // Individual points
  map.addLayer({
    id: 'unclustered-point',
    type: 'circle',
    source: 'recordings',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': 8,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff'
    }
  });

  // Click cluster → zoom in
  map.on('click', 'clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    const clusterId = features[0].properties.cluster_id;
    map.getSource('recordings').getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom: zoom });
    });
  });

  // Click point → popup
  map.on('click', 'unclustered-point', (e) => {
    const feature = e.features[0];
    const idx = feature.properties.idx;
    const rec = recordings[idx];
    if (!rec) return;

    const coords = feature.geometry.coordinates.slice();
    const tagPills = (rec.tags || []).slice(0, 5).map(t => `<span class="tag-pill">${esc(t)}</span>`).join('');

    const html = `
      <div class="popup-title">${esc(rec.title || 'Untitled')}</div>
      <div class="popup-meta">
        <strong>${esc(rec.provider || '')}</strong>
        ${rec.species ? ` &middot; ${esc(rec.species)}` : ''}
        ${rec.duration_sec ? ` &middot; ${formatDuration(rec.duration_sec)}` : ''}
      </div>
      ${tagPills ? `<div class="popup-tags">${tagPills}</div>` : ''}
      <button class="popup-play-btn" data-idx="${idx}">&#9654; Play</button>
    `;

    const popup = new maplibregl.Popup({ offset: 15, maxWidth: '300px' })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);

    // Attach play handler after popup is on the DOM
    setTimeout(() => {
      const btn = document.querySelector(`.popup-play-btn[data-idx="${idx}"]`);
      if (btn) btn.addEventListener('click', () => {
        playRecording(rec);
        popup.remove();
      });
    }, 50);
  });

  // Cursor changes
  map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });
  map.on('mouseenter', 'unclustered-point', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'unclustered-point', () => { map.getCanvas().style.cursor = ''; });
}

// ===== Audio Player =====
function playRecording(rec) {
  currentRecording = rec;
  const streamUrl = rec.stream_url ? `${API_BASE}${rec.stream_url}` : null;
  if (!streamUrl) return;

  playerEl.classList.remove('hidden');
  playerTitle.textContent = rec.title || 'Untitled';
  playerProvider.textContent = rec.provider || '';

  audioEl.src = streamUrl;
  audioEl.play().catch(() => {
    // autoplay might be blocked, user can click play
  });
  showPlayingState(true);
}

function showPlayingState(playing) {
  playIcon.classList.toggle('hidden', playing);
  pauseIcon.classList.toggle('hidden', !playing);
}

playPauseBtn.addEventListener('click', () => {
  if (!audioEl.src) return;
  if (audioEl.paused) {
    audioEl.play();
    showPlayingState(true);
  } else {
    audioEl.pause();
    showPlayingState(false);
  }
});

audioEl.addEventListener('play', () => showPlayingState(true));
audioEl.addEventListener('pause', () => showPlayingState(false));
audioEl.addEventListener('ended', () => showPlayingState(false));

audioEl.addEventListener('timeupdate', () => {
  if (!audioEl.duration) return;
  const pct = (audioEl.currentTime / audioEl.duration) * 100;
  playerProgress.value = pct;
  playerCurrent.textContent = formatDuration(audioEl.currentTime);
  playerDuration.textContent = formatDuration(audioEl.duration);
});

playerProgress.addEventListener('input', () => {
  if (!audioEl.duration) return;
  audioEl.currentTime = (playerProgress.value / 100) * audioEl.duration;
});

// ===== Init Map =====
function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://demotiles.maplibre.org/style.json',
    center: [0, 20],
    zoom: 2,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-left');

  map.on('load', () => {
    // Map click to set location pin (only when not clicking a feature)
    map.on('click', (e) => {
      // Check if click was on a recording feature
      const features = map.queryRenderedFeatures(e.point, { layers: ['clusters', 'unclustered-point'].filter(l => map.getLayer(l)) });
      if (features.length > 0) return;
      onMapClick(e);
    });
  });
}

// ===== Boot =====
initMap();
