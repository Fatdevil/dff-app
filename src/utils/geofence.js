// ============================================
// DFF! – Geofence Tracker
// Monitors user's GPS position and triggers
// callbacks when entering a geofenced zone
// ============================================

class GeofenceTracker {
  constructor() {
    this.watchId = null;
    this.fences = new Map(); // id -> { lat, lng, radius, callback, triggered }
    this.lastPosition = null;
    this.listeners = [];
    this.isTracking = false;
  }

  /**
   * Add a geofence to monitor
   * @param {string} id - Unique identifier
   * @param {number} lat - Target latitude
   * @param {number} lng - Target longitude
   * @param {number} radius - Radius in meters (default 200m)
   * @param {Function} callback - Called when user enters the zone
   */
  addFence(id, lat, lng, radius = 200, callback) {
    this.fences.set(id, { lat, lng, radius, callback, triggered: false });
    this.startTracking();
    console.log(`📍 Geofence added: ${id} (${lat.toFixed(4)}, ${lng.toFixed(4)}, ${radius}m)`);
    return id;
  }

  removeFence(id) {
    this.fences.delete(id);
    if (this.fences.size === 0) {
      this.stopTracking();
    }
  }

  startTracking() {
    if (this.isTracking || !navigator.geolocation) return;

    this.isTracking = true;
    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.lastPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp,
        };
        this.checkFences();
        this.notifyListeners();
      },
      (error) => {
        console.warn('📍 Geolocation error:', error.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 15000,
      }
    );
    console.log('📍 GPS tracking started');
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    console.log('📍 GPS tracking stopped');
  }

  checkFences() {
    if (!this.lastPosition) return;

    for (const [id, fence] of this.fences) {
      if (fence.triggered) continue;

      const distance = this.calculateDistance(
        this.lastPosition.lat, this.lastPosition.lng,
        fence.lat, fence.lng
      );

      if (distance <= fence.radius) {
        fence.triggered = true;
        console.log(`🔔 GEOFENCE TRIGGERED: ${id} (distance: ${Math.round(distance)}m)`);
        fence.callback({ id, distance, position: this.lastPosition });
      }
    }
  }

  /**
   * Haversine formula – distance between two GPS coordinates in meters
   */
  calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) ** 2 +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  onPositionUpdate(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notifyListeners() {
    this.listeners.forEach(l => l(this.lastPosition));
  }

  getActiveFences() {
    return Array.from(this.fences.entries()).map(([id, f]) => ({
      id, lat: f.lat, lng: f.lng, radius: f.radius, triggered: f.triggered,
    }));
  }

  static isSupported() {
    return 'geolocation' in navigator;
  }
}

export const geofenceTracker = new GeofenceTracker();
