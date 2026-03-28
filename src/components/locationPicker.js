// ============================================
// DFF! – Location Picker (Map Overlay)
// Interactive map for selecting a location and
// radius for GPS-based alarms
// ============================================

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet default icon paths (Vite bundling issue)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const RADIUS_OPTIONS = [
  { label: '100m', value: 100 },
  { label: '200m', value: 200 },
  { label: '500m', value: 500 },
  { label: '1 km', value: 1000 },
  { label: '2 km', value: 2000 },
];

/**
 * Show a full-screen location picker overlay.
 * Returns a promise that resolves with { lat, lng, radius, address } or null if cancelled.
 */
export function showLocationPicker() {
  return new Promise((resolve) => {
    document.getElementById('location-picker-overlay')?.remove();

    let selectedLat = null;
    let selectedLng = null;
    let selectedRadius = 200;
    let marker = null;
    let circle = null;
    let map = null;
    let searchTimeout = null;

    const overlay = document.createElement('div');
    overlay.id = 'location-picker-overlay';
    overlay.className = 'location-overlay';
    overlay.innerHTML = `
      <div class="location-dialog">
        <div class="location-header">
          <span class="location-header-icon">📍</span>
          <span class="location-header-title">Välj plats för alarm</span>
          <button class="location-close" id="loc-close">✕</button>
        </div>

        <div class="location-search-row">
          <input type="text" class="location-search" id="loc-search" 
                 placeholder="🔍 Sök adress eller plats..." autocomplete="off" />
          <div class="location-search-results" id="loc-search-results"></div>
        </div>

        <div class="location-map-container" id="loc-map"></div>

        <div class="location-controls">
          <div class="location-radius-section">
            <label class="location-label">Radie</label>
            <div class="location-radius-chips" id="loc-radius-chips">
              ${RADIUS_OPTIONS.map(r => `
                <button class="location-radius-chip ${r.value === selectedRadius ? 'selected' : ''}" 
                        data-radius="${r.value}">${r.label}</button>
              `).join('')}
            </div>
          </div>

          <div class="location-info" id="loc-info">
            Tryck på kartan för att placera markör
          </div>
        </div>

        <div class="location-footer">
          <button class="location-cancel-btn" id="loc-cancel">Avbryt</button>
          <button class="location-confirm-btn" id="loc-confirm" disabled>
            📍 Ställ in plats-alarm
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Initialize map
    setTimeout(() => {
      map = L.map('loc-map', {
        zoomControl: false,
        attributionControl: false,
      }).setView([59.33, 18.07], 13); // Default: Stockholm

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'topright' }).addTo(map);

      // Try to get user's current location
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            map.setView([pos.coords.latitude, pos.coords.longitude], 15);
            // Show blue dot for user location
            L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
              radius: 8, fillColor: '#4285F4', fillOpacity: 1,
              color: '#fff', weight: 2,
            }).addTo(map).bindPopup('Du är här');
          },
          () => { /* Ignore error, use default view */ },
          { enableHighAccuracy: true, timeout: 5000 }
        );
      }

      // Click to place marker
      map.on('click', (e) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
      });
    }, 100);

    function placeMarker(lat, lng) {
      selectedLat = lat;
      selectedLng = lng;

      // Remove old marker/circle
      if (marker) map.removeLayer(marker);
      if (circle) map.removeLayer(circle);

      marker = L.marker([lat, lng], {
        draggable: true,
      }).addTo(map);

      circle = L.circle([lat, lng], {
        radius: selectedRadius,
        color: '#5856d6',
        fillColor: '#5856d6',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(map);

      marker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        selectedLat = pos.lat;
        selectedLng = pos.lng;
        circle.setLatLng(pos);
        reverseGeocode(pos.lat, pos.lng);
      });

      reverseGeocode(lat, lng);
      document.getElementById('loc-confirm').disabled = false;
    }

    function updateRadius(radius) {
      selectedRadius = radius;
      if (circle) circle.setRadius(radius);

      // Update chips
      document.querySelectorAll('.location-radius-chip').forEach(chip => {
        chip.classList.toggle('selected', parseInt(chip.dataset.radius) === radius);
      });
    }

    // Reverse geocode using Nominatim (free, no API key)
    async function reverseGeocode(lat, lng) {
      const info = document.getElementById('loc-info');
      info.textContent = '📍 Laddar adress...';
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=sv`
        );
        const data = await res.json();
        const addr = data.display_name?.split(',').slice(0, 3).join(',') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        info.innerHTML = `📍 <strong>${addr}</strong>`;
      } catch {
        info.textContent = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      }
    }

    // Search using Nominatim
    async function searchAddress(query) {
      const results = document.getElementById('loc-search-results');
      if (!query || query.length < 3) {
        results.innerHTML = '';
        results.style.display = 'none';
        return;
      }

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&accept-language=sv&countrycodes=se`
        );
        const data = await res.json();

        if (data.length === 0) {
          results.innerHTML = '<div class="loc-result-empty">Inga resultat</div>';
          results.style.display = 'block';
          return;
        }

        results.innerHTML = data.map(item => `
          <button class="loc-result-item" data-lat="${item.lat}" data-lng="${item.lon}">
            <span class="loc-result-icon">📍</span>
            <span class="loc-result-text">${item.display_name.split(',').slice(0, 3).join(',')}</span>
          </button>
        `).join('');
        results.style.display = 'block';

        results.querySelectorAll('.loc-result-item').forEach(item => {
          item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lng = parseFloat(item.dataset.lng);
            map.setView([lat, lng], 16);
            placeMarker(lat, lng);
            results.style.display = 'none';
            document.getElementById('loc-search').value = item.querySelector('.loc-result-text').textContent;
          });
        });
      } catch {
        results.innerHTML = '';
        results.style.display = 'none';
      }
    }

    // Event listeners
    document.getElementById('loc-search')?.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => searchAddress(e.target.value), 400);
    });

    document.querySelectorAll('.location-radius-chip').forEach(chip => {
      chip.addEventListener('click', () => updateRadius(parseInt(chip.dataset.radius)));
    });

    document.getElementById('loc-close')?.addEventListener('click', close);
    document.getElementById('loc-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    document.getElementById('loc-confirm')?.addEventListener('click', () => {
      if (selectedLat !== null && selectedLng !== null) {
        const info = document.getElementById('loc-info')?.textContent || '';
        resolve({
          lat: selectedLat,
          lng: selectedLng,
          radius: selectedRadius,
          address: info.replace('📍 ', '').trim(),
        });
        close();
      }
    });

    function close() {
      if (map) { map.remove(); map = null; }
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 200);
      resolve(null);
    }
  });
}
