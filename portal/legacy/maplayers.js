// Create marker element with ICON IMAGE (FIXED POSITIONING)
function createMarkerElement(hazardInfo, severity) {
    // Determine icon size based on severity
    let iconSize = 35;
    switch(severity) {
        case 'Very High': 
            iconSize = 50; 
            break;
        case 'High': 
            iconSize = 42; 
            break;
        case 'Medium': 
            iconSize = 36; 
            break;
        case 'Low': 
            iconSize = 30; 
            break;
        default: 
            iconSize = 35;
    }
    
    // Create container div with fixed positioning
    const container = document.createElement('div');
    container.className = 'marker-container';
    container.style.cssText = `
        width: ${iconSize}px;
        height: ${iconSize}px;
        cursor: pointer;
        position: absolute;
        pointer-events: auto;
        transform: translate(-50%, -50%);
    `;
    
    // Create image element as marker
    const img = document.createElement('img');
    img.src = hazardInfo.icon;
    img.alt = hazardInfo.name;
    img.className = 'hazard-marker-icon';
    img.style.cssText = `
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
        pointer-events: none;
    `;
    
    container.appendChild(img);
    
    return container;
}

// Function to get severity color
function getSeverityColor(severity) {
    switch(severity.toLowerCase()) {
        case 'very high': return '#FF0000';
        case 'high': return '#FF4500';
        case 'medium': return '#FFA500';
        case 'low': return '#32CD32';
        default: return '#666666';
    }
}

// Add hazard markers to map
function addHazardMarkers(province, hazard) {
    // Get hazard data from the new structure
    const hazardInfo = window.hazardData[hazard];
    const provinceInfo = hazardInfo?.provinces[province];
    
    if (!hazardInfo || !provinceInfo) {
        console.warn(`No data found for hazard: ${hazard}, province: ${province}`);
        return;
    }
    
    provinceInfo.locations.forEach(location => {
        // Create marker element with hazard ICON
        const el = createMarkerElement(hazardInfo, location.severity);
        
        // Create popup content with a futuristic design
        const popupContent = `
    <div class="popup-container futuristic-popup">
        <div class="popup-header">
            <div class="header-content">
                <div class="header-icon">
                    <img src="${hazardInfo.icon}" alt="${hazardInfo.name}" style="width: 32px; height: 32px;">
                </div>
                <div class="header-text">
                    <h3 class="popup-title">${hazardInfo.name}</h3>
                    <div class="location-info">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${location.name}</span>
                    </div>
                </div>
                <div class="popup-controls">
                    <button class="popup-control-btn fullscreen-btn" onclick="togglePopupFullscreen(this)">
                        <i class="fas fa-expand"></i>
                    </button>
                </div>
            </div>
            <div class="severity-badge ${location.severity.toLowerCase().replace(' ', '-')}">
                ${location.severity}
            </div>
        </div>
        <div class="popup-video-container">
            <video width="100%" controls class="hazard-video" preload="metadata">
                <source src="${location.video}" type="video/mp4">
                Your browser does not support the video tag.
            </video>
            <div class="video-overlay" onclick="this.previousElementSibling.play(); this.style.display='none';">
                <div class="play-button">
                    <i class="fas fa-play"></i>
                </div>
            </div>
        </div>
        <div class="popup-footer">
            <div class="footer-info">
                <div class="info-item">
                    <i class="fas fa-calendar"></i>
                    <span>Updated: ${new Date().toLocaleDateString()}</span>
                </div>
                <div class="info-item">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Severity Level: ${location.severity}</span>
                </div>
            </div>
        </div>
    </div>
`;
        
        // Create popup with improved styling
        const popup = new mapboxgl.Popup({
            offset: 25,
            closeButton: true,
            closeOnClick: false,
            maxWidth: '350px',
            className: 'custom-popup'
        }).setHTML(popupContent);
        
        // Create marker with PROPER ANCHOR (center of icon)
        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'center'  // Icon stays centered on coordinate
        })
            .setLngLat(location.coordinates)
            .setPopup(popup)
            .addTo(window.mapInstance);
        
        // Store marker reference
        marker.hazardId = `${hazard}-${province}`;
        window.activeMarkers.push(marker);

        // Create and add label - STAYS WITH ICON
        const labelElement = document.createElement('div');
        labelElement.className = 'marker-label-wrapper';
        labelElement.innerHTML = `
            <div class="marker-label-text">
                ${location.name}
            </div>
        `;
        
        // Use SAME coordinates - positioned above icon using offset
        const label = new mapboxgl.Marker({
            element: labelElement,
            anchor: 'bottom',  // Bottom of label aligns to coordinate
            offset: [0, -35]   // Push label up above icon (adjust based on icon size)
        })
        .setLngLat(location.coordinates)  // SAME coordinate as icon
        .addTo(window.mapInstance);
        
        label.hazardId = `${hazard}-${province}`;
        window.activeLabels.push(label);
    });
}

// Remove hazard markers from map
function removeHazardMarkers(province, hazard) {
    const hazardId = `${hazard}-${province}`;
    
    // Remove markers with matching hazardId
    window.activeMarkers = window.activeMarkers.filter(marker => {
        if (marker.hazardId === hazardId) {
            marker.remove();
            return false;
        }
        return true;
    });

    // Remove labels with matching hazardId
    window.activeLabels = window.activeLabels.filter(label => {
        if (label.hazardId === hazardId) {
            label.remove();
            return false;
        }
        return true;
    });
}

// Clear all markers for a province (FIXED BUG)
function clearProvinceMarkers(province) {
    // Fixed: Use filter instead of forEach with splice
    window.activeMarkers = window.activeMarkers.filter(marker => {
        if (marker.hazardId && marker.hazardId.endsWith(`-${province}`)) {
            marker.remove();
            return false; // Remove from array
        }
        return true; // Keep in array
    });
    
    window.activeLabels = window.activeLabels.filter(label => {
        if (label.hazardId && label.hazardId.endsWith(`-${province}`)) {
            label.remove();
            return false;
        }
        return true;
    });
}

// Show video modal
function showVideoModal(hazardName, videoUrl) {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('modalVideo');
    const title = document.getElementById('modalHazardName');
    
    if (!modal || !video || !title) {
        console.warn('Video modal elements not found in DOM');
        return;
    }
    
    title.textContent = hazardName;
    video.src = videoUrl;
    modal.classList.add('show');
    
    // Play video after a short delay
    setTimeout(() => {
        video.play().catch(err => console.log('Video autoplay prevented:', err));
    }, 300);
}

// Hide video modal
function hideVideoModal() {
    const modal = document.getElementById('videoModal');
    const video = document.getElementById('modalVideo');
    
    if (!modal || !video) return;
    
    modal.classList.remove('show', 'fullscreen');
    video.pause();
    video.src = '';
}

// Toggle fullscreen mode
function toggleFullscreen() {
    const modal = document.getElementById('videoModal');
    if (modal) {
        modal.classList.toggle('fullscreen');
    }
}

// Add hazard layer visualization (polygon/area)
function addHazardLayer(province, hazard) {
    const hazardInfo = window.hazardData[hazard];
    const provinceInfo = hazardInfo?.provinces[province];
    const layerId = `${province}-${hazard}-layer`;
    
    if (!hazardInfo || !provinceInfo) {
        console.warn(`No data found for hazard layer: ${hazard}, province: ${province}`);
        return;
    }
    
    // Create GeoJSON for hazard area (simplified example)
    const hazardGeoJSON = {
        type: 'FeatureCollection',
        features: provinceInfo.locations.map(loc => ({
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [loc.coordinates[0] - 0.2, loc.coordinates[1] - 0.2],
                    [loc.coordinates[0] + 0.2, loc.coordinates[1] - 0.2],
                    [loc.coordinates[0] + 0.2, loc.coordinates[1] + 0.2],
                    [loc.coordinates[0] - 0.2, loc.coordinates[1] + 0.2],
                    [loc.coordinates[0] - 0.2, loc.coordinates[1] - 0.2]
                ]]
            },
            properties: {
                name: loc.name,
                hazard: hazard
            }
        }))
    };
    
    // Add source if it doesn't exist
    if (!window.mapInstance.getSource(layerId)) {
        window.mapInstance.addSource(layerId, {
            type: 'geojson',
            data: hazardGeoJSON
        });
        
        // Add fill layer
        window.mapInstance.addLayer({
            id: `${layerId}-fill`,
            type: 'fill',
            source: layerId,
            paint: {
                'fill-color': hazardInfo.color,
                'fill-opacity': 0.3
            }
        });
        
        // Add outline layer
        window.mapInstance.addLayer({
            id: `${layerId}-outline`,
            type: 'line',
            source: layerId,
            paint: {
                'line-color': hazardInfo.color,
                'line-width': 2,
                'line-dasharray': [2, 2]
            }
        });
    }
}

// Remove hazard layer
function removeHazardLayer(province, hazard) {
    const layerId = `${province}-${hazard}-layer`;
    
    if (window.mapInstance.getLayer(`${layerId}-fill`)) {
        window.mapInstance.removeLayer(`${layerId}-fill`);
    }
    if (window.mapInstance.getLayer(`${layerId}-outline`)) {
        window.mapInstance.removeLayer(`${layerId}-outline`);
    }
    if (window.mapInstance.getSource(layerId)) {
        window.mapInstance.removeSource(layerId);
    }
}

// Add this function to handle fullscreen toggle
window.togglePopupFullscreen = function(button) {
    const popup = button.closest('.futuristic-popup');
    if (!popup) return;
    
    popup.classList.toggle('fullscreen');
    
    // Toggle icon
    const icon = button.querySelector('i');
    if (icon) {
        if (popup.classList.contains('fullscreen')) {
            icon.classList.remove('fa-expand');
            icon.classList.add('fa-compress');
        } else {
            icon.classList.remove('fa-compress');
            icon.classList.add('fa-expand');
        }
    }
};

// Add CSS for icon markers (FIXED POSITIONING - LABELS INCLUDED)
const markerStyle = document.createElement('style');
markerStyle.textContent = `
    /* Marker Container - FIXED POSITIONING */
    .marker-container {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
    }
    
    .hazard-marker-icon {
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
    }
    
    /* Label Styles - STAYS WITH ICON */
    .marker-label-wrapper {
        pointer-events: none !important;
        z-index: 3 !important;
        position: absolute !important;
    }
    
    .marker-label-text {
        color: white;
        padding: 6px 12px;
        font-size: 14px;
        font-family: 'Segoe UI', Arial, sans-serif;
        white-space: nowrap;
        font-weight: 600;
        text-shadow: 
            2px 2px 4px rgba(0, 0, 0, 0.9),
            -1px -1px 3px rgba(0, 0, 0, 0.9);
        background: rgba(0, 0, 0, 0.7);
        border-radius: 6px;
        backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        display: inline-block;
    }
    
    /* Ensure markers stay at geographic coordinates */
    .mapboxgl-marker {
        z-index: 2;
        position: absolute !important;
    }
    
    .mapboxgl-marker:hover {
        z-index: 100;
    }
    
    /* Popup Styles */
    .mapboxgl-popup {
        z-index: 200;
    }
    
    .mapboxgl-popup-content {
        padding: 0;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
    }
    
    .mapboxgl-popup-close-button {
        font-size: 24px;
        padding: 8px;
        width: 36px;
        height: 36px;
        color: white;
        background: rgba(0, 0, 0, 0.3);
        border-radius: 50%;
        right: 8px;
        top: 8px;
    }
    
    .mapboxgl-popup-close-button:hover {
        background: rgba(0, 0, 0, 0.6);
    }
    
    /* Futuristic Popup Styles */
    .futuristic-popup {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        min-width: 300px;
    }
    
    .futuristic-popup.fullscreen {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90vw;
        max-width: 900px;
        min-width: 600px;
        z-index: 10000;
    }
    
    .popup-header {
        background: rgba(255, 255, 255, 0.15);
        padding: 16px;
        backdrop-filter: blur(10px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .header-content {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    
    .header-icon {
        background: rgba(255, 255, 255, 0.2);
        padding: 8px;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .header-icon img {
        width: 32px;
        height: 32px;
        filter: brightness(0) invert(1);
    }
    
    .header-text {
        flex: 1;
    }
    
    .popup-title {
        margin: 0;
        color: white;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.5px;
    }
    
    .location-info {
        display: flex;
        align-items: center;
        gap: 6px;
        color: rgba(255, 255, 255, 0.9);
        font-size: 13px;
        margin-top: 4px;
    }
    
    .popup-controls {
        display: flex;
        gap: 8px;
    }
    
    .popup-control-btn {
        background: rgba(255, 255, 255, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .popup-control-btn:hover {
        background: rgba(255, 255, 255, 0.4);
    }
    
    .severity-badge {
        display: inline-block;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    
    .severity-badge.very-high {
        background: linear-gradient(135deg, #ff0000, #cc0000);
        color: white;
    }
    
    .severity-badge.high {
        background: linear-gradient(135deg, #ff4500, #ff6347);
        color: white;
    }
    
    .severity-badge.medium {
        background: linear-gradient(135deg, #ffa500, #ffb347);
        color: white;
    }
    
    .severity-badge.low {
        background: linear-gradient(135deg, #32cd32, #90ee90);
        color: white;
    }
    
    .popup-video-container {
        position: relative;
        background: black;
        max-height: 400px;
        overflow: hidden;
    }
    
    .futuristic-popup.fullscreen .popup-video-container {
        max-height: 60vh;
    }
    
    .hazard-video {
        width: 100%;
        display: block;
        max-height: 400px;
    }
    
    .futuristic-popup.fullscreen .hazard-video {
        max-height: 60vh;
    }
    
    .video-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.3);
        cursor: pointer;
    }
    
    .video-overlay:hover {
        background: rgba(0, 0, 0, 0.5);
    }
    
    .play-button {
        width: 70px;
        height: 70px;
        background: rgba(255, 255, 255, 0.95);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: #667eea;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }
    
    .play-button i {
        margin-left: 4px;
    }
    
    .popup-footer {
        background: rgba(0, 0, 0, 0.4);
        padding: 14px 16px;
        color: white;
        backdrop-filter: blur(10px);
    }
    
    .footer-info {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    
    .info-item {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        color: rgba(255, 255, 255, 0.95);
    }
    
    .info-item i {
        width: 18px;
        text-align: center;
        color: rgba(255, 255, 255, 0.7);
    }
`;

document.head.appendChild(markerStyle);

// Export functions
window.addHazardMarkers = addHazardMarkers;
window.removeHazardMarkers = removeHazardMarkers;
window.clearProvinceMarkers = clearProvinceMarkers;
window.showVideoModal = showVideoModal;
window.hideVideoModal = hideVideoModal;
window.toggleFullscreen = toggleFullscreen;
window.addHazardLayer = addHazardLayer;
window.removeHazardLayer = removeHazardLayer;
window.getSeverityColor = getSeverityColor;