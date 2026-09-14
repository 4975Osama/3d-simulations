let districtLayer = null;
let provincialLayer = null;

// Adds a geojson source only if it doesn't already exist. Mapbox GL fires
// BOTH 'style.load' and 'load' during initial map setup, and can fire
// 'style.load' again later - loadBoundaryData() can end up called more than
// once, sometimes concurrently (two in-flight fetches racing). Without this
// guard, addSource()/addLayer() throws on the second call, and since the
// whole function used to be one try/catch, that throw aborted everything
// after it - including sources added later in the function - even though the
// failure had nothing to do with them.
function ensureSource(id, config) {
    if (!window.mapInstance.getSource(id)) {
        window.mapInstance.addSource(id, config);
    }
}

function ensureLayer(config, beforeId) {
    if (!window.mapInstance.getLayer(config.id)) {
        window.mapInstance.addLayer(config, beforeId);
    }
}

// Prevents two overlapping loadBoundaryData() calls from both fetching the
// same (large) geojson files at once; later callers just await the first.
let boundaryDataLoadPromise = null;

// Load GeoJSON data
function loadBoundaryData() {
    if (boundaryDataLoadPromise) return boundaryDataLoadPromise;

    boundaryDataLoadPromise = (async () => {
        // District boundaries
        try {
            const districtResponse = await fetch('geojson/District.geojson');
            const district = await districtResponse.json();
            ensureSource('district-boundary', { type: 'geojson', data: district });
            ensureLayer({
                'id': 'district-boundary-layer',
                'type': 'line',
                'source': 'district-boundary',
                'layout': { 'visibility': 'none' },
                'paint': { 'line-color': '#000000', 'line-width': 1.5, 'line-opacity': 0.8 }
            }, 'poi-label'); // Place below labels for better visibility
        } catch (error) {
            console.error('Error loading district boundary data:', error);
        }

        // Provincial boundaries
        try {
            const provincialResponse = await fetch('geojson/Provincial.geojson');
            const provincial = await provincialResponse.json();
            ensureSource('provincial-boundary', { type: 'geojson', data: provincial });
            ensureLayer({
                'id': 'provincial-boundary-layer',
                'type': 'line',
                'source': 'provincial-boundary',
                'layout': { 'visibility': 'none' },
                'paint': { 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.8 }
            });
        } catch (error) {
            console.error('Error loading provincial boundary data:', error);
        }

        boundaryDataLoadPromise = null;
    })();

    return boundaryDataLoadPromise;
}

// Toggle boundary layers
function toggleBoundaryLayer(boundaryType) {
    const layerId = `${boundaryType}-boundary-layer`;

    // Check if layer exists
    if (!window.mapInstance.getLayer(layerId)) {
        console.error(`Layer ${layerId} not found`);
        return;
    }

    const visibility = window.mapInstance.getLayoutProperty(layerId, 'visibility');
    const nextVisibility = visibility === 'visible' ? 'none' : 'visible';

    // Toggle layer visibility
    window.mapInstance.setLayoutProperty(layerId, 'visibility', nextVisibility);

    // Toggle active state on button
    const button = document.querySelector(`[data-boundary="${boundaryType}"]`);
    if (button) {
        button.classList.toggle('active');
    }
}

// Initialize boundaries when map loads
document.addEventListener('DOMContentLoaded', () => {
    // Wait for map instance to be ready
    if (window.mapInstance) {
        // Load boundaries on initial map load
        window.mapInstance.on('load', () => {
            loadBoundaryData();
        });

        // Reload boundaries when map style changes
        window.mapInstance.on('style.load', () => {
            // Check if sources already exist to prevent duplicate loading
            if (!window.mapInstance.getSource('district-boundary')) {
                loadBoundaryData();
            }
        });
    } else {
        console.error('Map instance not found');
    }
});

// Export functions for use in other files
window.toggleBoundaryLayer = toggleBoundaryLayer;