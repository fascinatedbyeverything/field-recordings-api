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

// ===== Location lookup for recordings missing coordinates =====
const GEO_LOOKUP = {
  // Continents/regions
  'africa': [0, 20], 'europe': [48, 10], 'asia': [35, 100], 'australia': [-25, 134],
  'north america': [40, -100], 'south america': [-15, -60], 'antarctica': [-80, 0],
  'arctic': [80, 0], 'caribbean': [18, -72], 'mediterranean': [38, 18],
  'southeast asia': [10, 106], 'central america': [14, -87], 'middle east': [30, 45],
  'scandinavia': [63, 15], 'pacific': [0, -160], 'atlantic': [30, -40],
  // Oceans/seas
  'pacific ocean': [0, -160], 'atlantic ocean': [30, -40], 'indian ocean': [-20, 75],
  'southern ocean': [-60, 0], 'coral sea': [-18, 155], 'bering sea': [57, -175],
  'gulf of mexico': [25, -90], 'north sea': [56, 3], 'baltic': [58, 20],
  'salish sea': [48.5, -123], 'monterey': [36.6, -121.9], 'monterey bay': [36.6, -121.9],
  // Countries
  'brazil': [-10, -55], 'usa': [39, -98], 'uk': [54, -2], 'england': [52, -1.5],
  'france': [46, 2], 'germany': [51, 10], 'india': [22, 78], 'china': [35, 105],
  'japan': [36, 138], 'mexico': [23, -102], 'canada': [56, -96], 'peru': [-10, -76],
  'colombia': [4, -74], 'ecuador': [-1, -78], 'costa rica': [10, -84],
  'kenya': [0, 37], 'tanzania': [-6, 35], 'south africa': [-30, 25],
  'madagascar': [-19, 47], 'new zealand': [-42, 174], 'indonesia': [-2, 118],
  'borneo': [1, 115], 'papua': [-5, 141], 'thailand': [15, 101],
  'vietnam': [16, 108], 'nepal': [28, 84], 'mongolia': [47, 103],
  'iceland': [65, -18], 'norway': [62, 10], 'sweden': [62, 15],
  'finland': [64, 26], 'spain': [40, -4], 'italy': [42, 12],
  'greece': [39, 22], 'turkey': [39, 35], 'russia': [60, 100],
  'argentina': [-34, -64], 'chile': [-33, -71], 'bolivia': [-17, -65],
  'venezuela': [7, -66], 'panama': [9, -80], 'guatemala': [15, -90],
  'cuba': [22, -80], 'hawaii': [20, -156], 'alaska': [64, -153],
  'congo': [-1, 22], 'cameroon': [6, 12], 'nigeria': [10, 8],
  'ethiopia': [9, 39], 'uganda': [1, 32], 'rwanda': [-2, 30],
  'botswana': [-22, 24], 'namibia': [-22, 17], 'mozambique': [-18, 35],
  'scotland': [56, -4], 'wales': [52, -3.5], 'ireland': [53, -8],
  // Cities
  'paris': [48.86, 2.35], 'london': [51.5, -0.12], 'tokyo': [35.68, 139.69],
  'new york': [40.71, -74.01], 'berlin': [52.52, 13.41], 'mumbai': [19.08, 72.88],
  'sydney': [-33.87, 151.21], 'rio': [-22.91, -43.17], 'cairo': [30.04, 31.24],
  'istanbul': [41.01, 28.98], 'beijing': [39.9, 116.4], 'bangkok': [13.76, 100.5],
  'nairobi': [-1.29, 36.82], 'buenos aires': [-34.6, -58.38], 'moscow': [55.76, 37.62],
  'rome': [41.9, 12.5], 'amsterdam': [52.37, 4.9], 'singapore': [1.35, 103.82],
  'hong kong': [22.3, 114.2], 'dubai': [25.2, 55.3], 'seoul': [37.57, 127],
  // Ecosystems/biomes
  'amazon': [-3, -60], 'amazon basin': [-3, -60], 'amazonia': [-3, -60],
  'rainforest': [-3, -60], 'sahara': [23, 10], 'serengeti': [-2.3, 34.8],
  'savanna': [-2, 34], 'tundra': [68, 80], 'taiga': [60, 90],
  'himalayas': [28, 85], 'andes': [-15, -72], 'alps': [47, 11],
  'great barrier reef': [-18, 147], 'galapagos': [-0.7, -90.4],
  'yellowstone': [44.6, -110.5], 'yosemite': [37.75, -119.6],
  'everglades': [25.3, -80.9], 'okavango': [-19.5, 22.5],
  'pantanal': [-17, -57], 'kruger': [-24, 31.5],
  'masai mara': [-1.5, 35], 'sumatra': [-0.6, 101.5],
  'appalachian': [37, -81], 'rocky mountains': [43, -110],
  'great plains': [41, -100], 'outback': [-25, 134],
  'patagonia': [-47, -70], 'siberia': [60, 100],
};

function inferLocation(rec) {
  if (rec.lat != null && rec.lng != null) return rec;
  const text = [rec.title, ...(rec.tags || []), rec.species || ''].join(' ').toLowerCase();
  // Try longest keys first for better matching (e.g. "pacific ocean" before "pacific")
  const keys = Object.keys(GEO_LOOKUP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (text.includes(key)) {
      // Add slight randomness so overlapping points don't stack
      const jitter = () => (Math.random() - 0.5) * 2;
      return { ...rec, lat: GEO_LOOKUP[key][0] + jitter(), lng: GEO_LOOKUP[key][1] + jitter(), inferred_geo: true };
    }
  }
  return rec;
}

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
const trackOverlay = $('#track-overlay');
const overlayTitle = $('#overlay-title');
const overlayDetails = $('#overlay-details');
const overlayClose = $('#overlay-close');
const overlaySimilar = $('#overlay-similar');

// ===== Ratings (localStorage) =====
function getRatings() {
  try { return JSON.parse(localStorage.getItem('fr-ratings') || '{}'); } catch { return {}; }
}
function setRating(id, stars) {
  const ratings = getRatings();
  ratings[id] = stars;
  localStorage.setItem('fr-ratings', JSON.stringify(ratings));
}
function getRating(id) {
  return getRatings()[id] || 0;
}

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

// Scene chips — one-click curated searches
$$('#scene-chips .scene-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const scene = JSON.parse(chip.dataset.scene);
    searchInput.value = scene.q || '';
    // Set min duration chip
    if (scene.min_duration) {
      minDuration = parseInt(scene.min_duration, 10);
      $$('#duration-chips .chip').forEach(c => {
        c.classList.toggle('active', c.dataset.duration === scene.min_duration);
      });
    }
    // Clear type chips and location
    $$('#type-chips .chip').forEach(c => c.classList.remove('active'));
    searchLat = null;
    searchLng = null;
    locationInput.value = '';
    doSearch();
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

// ===== Auto-geocode helper =====
async function tryGeocode(text) {
  // Skip if it looks like a species/sound query rather than a place
  const natureWords = ['bird', 'whale', 'rain', 'thunder', 'frog', 'insect', 'cricket',
    'cicada', 'owl', 'wolf', 'ocean', 'wave', 'wind', 'forest', 'jungle', 'dawn',
    'chorus', 'song', 'call', 'ambient', 'soundscape', 'nature'];
  const lower = text.toLowerCase();
  if (natureWords.some(w => lower.includes(w))) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (data.length === 0) return null;
    const place = data[0];
    // Only accept if it's clearly a place (city, state, country, etc.)
    const placeTypes = ['city', 'town', 'village', 'county', 'state', 'country',
      'administrative', 'suburb', 'neighbourhood', 'island', 'region'];
    const isPlace = placeTypes.some(t => (place.type || '').includes(t) || (place.class || '').includes(t));
    if (!isPlace && place.importance < 0.4) return null;
    return {
      lat: parseFloat(place.lat),
      lng: parseFloat(place.lon),
      name: place.display_name.split(',').slice(0, 2).join(',')
    };
  } catch {
    return null;
  }
}

// ===== Search =====
async function doSearch() {
  const params = new URLSearchParams();

  const freeText = searchInput.value.trim();
  const activeTypes = Array.from($$('#type-chips .chip.active')).map(c => c.dataset.type);
  const activeTimes = Array.from($$('#time-chips .chip.active')).map(c => c.dataset.time);
  const locationText = locationInput.value.trim();

  // Build text query — always include the search text as a species/keyword query
  const qParts = [];
  if (freeText) qParts.push(freeText);
  if (activeTypes.length) qParts.push(...activeTypes);
  if (activeTimes.length) qParts.push(...activeTimes);
  if (locationText && searchLat === null) qParts.push(locationText);
  if (qParts.length) params.set('q', qParts.join(' '));

  // Types
  if (activeTypes.length) params.set('type', activeTypes.join(','));

  // Location
  if (searchLat !== null) {
    params.set('lat', searchLat.toFixed(5));
    params.set('lng', searchLng.toFixed(5));
    params.set('radius', searchRadius);
  }

  // Duration filter
  if (minDuration > 0) params.set('min_duration', minDuration);

  // Sort longest first for ambient listening
  params.set('sort', 'duration');

  // Per page — request more for geo searches since results come from many providers
  params.set('per_page', searchLat !== null ? '100' : '50');

  resultsLoading.classList.remove('hidden');
  resultsError.classList.add('hidden');
  resultsHeader.innerHTML = '';
  resultsList.innerHTML = '';

  try {
    const res = await fetch(`${API_BASE}/search?${params.toString()}`);
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const data = await res.json();

    recordings = (data.recordings || []).map(inferLocation);

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
  audioEl.play().catch(() => {});
  showPlayingState(true);
  showTrackOverlay(rec);
}

function showTrackOverlay(rec) {
  overlayTitle.textContent = rec.title || 'Untitled';
  const rating = getRating(rec.id);

  let html = '';
  if (rec.provider) html += `<div class="detail-row"><span class="detail-label">Provider</span> ${esc(rec.provider)}</div>`;
  if (rec.species) html += `<div class="detail-row"><span class="detail-label">Species</span> ${esc(rec.species)}</div>`;
  if (rec.duration_sec) html += `<div class="detail-row"><span class="detail-label">Duration</span> ${formatDuration(rec.duration_sec)}</div>`;
  if (rec.license) html += `<div class="detail-row"><span class="detail-label">License</span> ${esc(rec.license)}</div>`;
  if (rec.recorded_at) html += `<div class="detail-row"><span class="detail-label">Recorded</span> ${esc(rec.recorded_at.split('T')[0])}</div>`;
  if (rec.lat != null && rec.lng != null) {
    html += `<div class="detail-row"><span class="detail-label">Location</span> ${rec.lat.toFixed(2)}, ${rec.lng.toFixed(2)}${rec.inferred_geo ? ' (approx)' : ''}</div>`;
  }
  if (rec.tags && rec.tags.length) {
    html += `<div class="detail-row"><span class="detail-label">Tags</span><div class="tag-list">${rec.tags.map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div></div>`;
  }

  // Star rating
  html += `<div class="detail-row"><span class="detail-label">Rating</span><span id="star-rating">`;
  for (let i = 1; i <= 5; i++) {
    html += `<span class="star" data-star="${i}" style="cursor:pointer;font-size:1.4rem;color:${i <= rating ? '#f59e0b' : '#d1d5db'}">${i <= rating ? '★' : '☆'}</span>`;
  }
  html += `</span></div>`;

  overlayDetails.innerHTML = html;
  trackOverlay.classList.remove('hidden');

  // Wire star clicks
  trackOverlay.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.star, 10);
      setRating(rec.id, val);
      trackOverlay.querySelectorAll('.star').forEach((s, idx) => {
        s.textContent = idx < val ? '★' : '☆';
        s.style.color = idx < val ? '#f59e0b' : '#d1d5db';
      });
      // Update the result card if visible
      const card = document.querySelector(`.result-card[data-id="${rec.id}"] .card-rating`);
      if (card) card.textContent = '★'.repeat(val);
    });
  });
}

overlayClose.addEventListener('click', () => trackOverlay.classList.add('hidden'));

overlaySimilar.addEventListener('click', () => {
  if (!currentRecording) return;
  // Build a search from the current recording's tags and species
  const parts = [];
  if (currentRecording.species) parts.push(currentRecording.species);
  if (currentRecording.tags) parts.push(...currentRecording.tags.slice(0, 3));
  if (!parts.length && currentRecording.title) parts.push(currentRecording.title.split(/[—\-()]/)[0].trim());
  searchInput.value = parts.join(' ');
  trackOverlay.classList.add('hidden');
  doSearch();
});

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
    style: {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        'esri-satellite': {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: 'Tiles &copy; Esri',
          maxzoom: 22
        },
        'esri-labels': {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          maxzoom: 22
        }
      },
      layers: [
        { id: 'satellite', type: 'raster', source: 'esri-satellite', minzoom: 0, maxzoom: 22 },
        { id: 'labels', type: 'raster', source: 'esri-labels', minzoom: 3, maxzoom: 22 }
      ]
    },
    center: [0, 20],
    zoom: 2,
    maxZoom: 22,
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

// ===== Upload System =====
const uploadModal = $('#upload-modal');
const uploadForm = $('#upload-form');
const uploadOpen = $('#upload-open');
const uploadClose = $('#upload-close');
const uploadBackdrop = $('#upload-backdrop');
const uploadProgress = $('#upload-progress');
const uploadSubmit = $('#upload-submit');
const uploadGps = $('#upload-gps');
const uploadLatInput = $('#upload-lat');
const uploadLngInput = $('#upload-lng');
let uploadMap = null;
let uploadMarker = null;

uploadOpen.addEventListener('click', () => {
  uploadModal.classList.remove('hidden');
  // Init mini map for location picking
  if (!uploadMap) {
    setTimeout(() => {
      uploadMap = new maplibregl.Map({
        container: 'upload-map',
        style: {
          version: 8,
          sources: {
            'esri-sat': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256, maxzoom: 22
            }
          },
          layers: [{ id: 'sat', type: 'raster', source: 'esri-sat', maxzoom: 22 }]
        },
        center: [-98, 39],
        zoom: 3,
      });
      uploadMap.on('click', (e) => {
        uploadLatInput.value = e.lngLat.lat.toFixed(5);
        uploadLngInput.value = e.lngLat.lng.toFixed(5);
        if (uploadMarker) uploadMarker.remove();
        uploadMarker = new maplibregl.Marker().setLngLat(e.lngLat).addTo(uploadMap);
      });
    }, 100);
  } else {
    uploadMap.resize();
  }
});

uploadClose.addEventListener('click', () => uploadModal.classList.add('hidden'));
uploadBackdrop.addEventListener('click', () => uploadModal.classList.add('hidden'));

uploadGps.addEventListener('click', () => {
  if (!navigator.geolocation) return alert('GPS not available');
  navigator.geolocation.getCurrentPosition((pos) => {
    uploadLatInput.value = pos.coords.latitude.toFixed(5);
    uploadLngInput.value = pos.coords.longitude.toFixed(5);
    if (uploadMap) {
      const lngLat = [pos.coords.longitude, pos.coords.latitude];
      uploadMap.flyTo({ center: lngLat, zoom: 14 });
      if (uploadMarker) uploadMarker.remove();
      uploadMarker = new maplibregl.Marker().setLngLat(lngLat).addTo(uploadMap);
    }
  }, (err) => alert('GPS error: ' + err.message), { enableHighAccuracy: true });
});

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = $('#upload-file').files[0];
  if (!file) return;

  uploadProgress.classList.remove('hidden');
  uploadSubmit.disabled = true;

  const formData = new FormData();
  formData.append('audio', file);
  formData.append('title', $('#upload-title').value || file.name);
  formData.append('species', $('#upload-species').value);
  formData.append('tags', $('#upload-tags').value);
  formData.append('notes', $('#upload-notes').value);
  formData.append('recorded_at', $('#upload-date').value);
  if (uploadLatInput.value) formData.append('lat', uploadLatInput.value);
  if (uploadLngInput.value) formData.append('lng', uploadLngInput.value);

  try {
    const res = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
    const data = await res.json();
    if (data.ok) {
      uploadModal.classList.add('hidden');
      uploadForm.reset();
      alert('Upload successful! Your recording will appear in search results.');
    } else {
      alert('Upload failed: ' + (data.error || 'unknown'));
    }
  } catch (err) {
    alert('Upload failed: ' + err.message);
  } finally {
    uploadProgress.classList.add('hidden');
    uploadSubmit.disabled = false;
  }
});

// ===== Boot =====
initMap();
