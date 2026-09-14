// ============================================
// MAP INITIALIZATION
// ============================================
mapboxgl.accessToken = 'pk.eyJ1Ijoic2FyaW0yNDAiLCJhIjoiY2xxbnZhbGNtMWNtZzJrcDl2amk5bndjbiJ9.K-VQe8qVvIij9URoQR0WaA';

// Basemap styles
const basemapStyles = {
    satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
    streets: 'mapbox://styles/mapbox/streets-v12',
    dark: 'mapbox://styles/mapbox/dark-v11',
    light: 'mapbox://styles/mapbox/light-v11',
    outdoors: 'mapbox://styles/mapbox/outdoors-v12',
    terrain: 'mapbox://styles/mapbox/satellite-v9'
};

// Initialize the map with globe projection
const map = new mapboxgl.Map({
    container: 'map',
    style: basemapStyles.satellite,
    center: [69.3451, 30.3753],
    zoom: 5.5,
    bearing: 0,
    pitch: 0,
    antialias: true,
    projection: 'globe'
});

// Add navigation controls
// (Compass/rotate + fullscreen are handled by the custom map-toolbar UI,
// so the built-in compass/fullscreen buttons are disabled to avoid duplicates.)
map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
map.addControl(new mapboxgl.ScaleControl(), 'bottom-right');

// Camera animation speed, controlled by the toolbar's Speed button (in milliseconds)
window.mapCameraDuration = 2000;

// ============================================
// GLOBE ROTATION SYSTEM
// ============================================

let isRotating = false;
let userInteracting = false;
let spinEnabled = false;
let currentRotationSpeed = 0.01;

function startRotation() {
    console.log('Starting rotation...');
    isRotating = true;
    spinEnabled = true;
    userInteracting = false;
    updateRotationButtonState(true);
    requestAnimationFrame(rotateGlobeAnimation);
    console.log('Rotation started!');
}

function stopRotation() {
    console.log('Stopping rotation...');
    isRotating = false;
    spinEnabled = false;
    updateRotationButtonState(false);
    console.log('Rotation stopped!');
}

function toggleRotation() {
    if (isRotating) {
        stopRotation();
    } else {
        startRotation();
    }
}

function rotateGlobeAnimation() {
    if (!isRotating) {
        return;
    }

    if (userInteracting) {
        requestAnimationFrame(rotateGlobeAnimation);
        return;
    }

    var center = map.getCenter();
    var newLng = center.lng + currentRotationSpeed;

    if (newLng > 180) {
        newLng -= 360;
    }

    map.setCenter([newLng, center.lat]);
    requestAnimationFrame(rotateGlobeAnimation);
}

function setRotationSpeed(speed) {
    currentRotationSpeed = speed;
    var speedDisplay = document.getElementById('speed-display');
    if (speedDisplay) {
        speedDisplay.textContent = Math.round(speed * 1000);
    }
}

function updateRotationButtonState(rotating) {
    var btn = document.getElementById('globe-rotate-btn');
    var btnText = document.getElementById('rotate-btn-text');
    var btnIcon = document.getElementById('rotate-btn-icon');

    if (!btn) return;

    if (rotating) {
        btn.classList.add('active');
        if (btnText) btnText.textContent = 'Stop Rotation';
        if (btnIcon) {
            btnIcon.innerHTML = '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>';
        }
    } else {
        btn.classList.remove('active');
        if (btnText) btnText.textContent = 'Rotate Globe';
        if (btnIcon) {
            btnIcon.innerHTML = '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 3c-4.97 0-9 4.03-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M3 9l0-6 6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
        }
    }
}

function createRotationControls() {
    var container = document.createElement('div');
    container.id = 'rotation-controls';
    container.innerHTML = '<button id="globe-rotate-btn" type="button"><svg id="rotate-btn-icon" width="22" height="22" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" fill="none"/><path d="M12 3c-4.97 0-9 4.03-9 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M3 9l0-6 6 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg><span id="rotate-btn-text">Rotate Globe</span></button><div id="speed-slider-container"><span class="speed-label">Speed:</span><input type="range" id="rotation-speed-slider" min="5" max="50" value="10"><span id="speed-display">10</span></div>';

    var mapContainer = document.getElementById('map');
    if (mapContainer) {
        mapContainer.appendChild(container);
    } else {
        document.body.appendChild(container);
    }

    var rotateBtn = document.getElementById('globe-rotate-btn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            toggleRotation();
        });
    }

    var speedSlider = document.getElementById('rotation-speed-slider');
    if (speedSlider) {
        speedSlider.addEventListener('input', function (e) {
            var speed = parseFloat(e.target.value) / 1000;
            setRotationSpeed(speed);
        });
    }
}

function setupInteractionHandlers() {
    map.on('mousedown', function () {
        if (spinEnabled) {
            userInteracting = true;
        }
    });

    document.addEventListener('mouseup', function () {
        if (spinEnabled) {
            setTimeout(function () {
                userInteracting = false;
            }, 500);
        }
    });

    map.on('touchstart', function () {
        if (spinEnabled) {
            userInteracting = true;
        }
    });

    document.addEventListener('touchend', function () {
        if (spinEnabled) {
            setTimeout(function () {
                userInteracting = false;
            }, 500);
        }
    });

    map.on('wheel', function () {
        if (spinEnabled) {
            userInteracting = true;
            setTimeout(function () {
                userInteracting = false;
            }, 1000);
        }
    });

    map.on('dragstart', function () {
        if (spinEnabled) {
            userInteracting = true;
        }
    });

    map.on('dragend', function () {
        if (spinEnabled) {
            setTimeout(function () {
                userInteracting = false;
            }, 500);
        }
    });
}

function addRotationStyles() {
    var styleElement = document.createElement('style');
    styleElement.id = 'rotation-control-styles';
    styleElement.textContent = '#rotation-controls{position:absolute;top: 210px;                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              right:10px;z-index:9999;display:flex;flex-direction:column;gap:8px;font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif}#globe-rotate-btn{display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 20px;background:#1e293b;border:2px solid #475569;border-radius:12px;color:#e2e8f0;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 15px rgba(0,0,0,0.4);min-width:170px}#globe-rotate-btn:hover{background:#334155;border-color:#60a5fa}#globe-rotate-btn.active{background:#166534;border-color:#4ade80}#globe-rotate-btn.active:hover{background:#991b1b;border-color:#f87171}#speed-slider-container{display:flex;align-items:center;gap:10px;padding:12px 16px;background:#1e293b;border:1px solid #475569;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3)}.speed-label{color:#94a3b8;font-size:12px;font-weight:600;text-transform:uppercase}#rotation-speed-slider{width:80px;height:6px;-webkit-appearance:none;appearance:none;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:3px;outline:none;cursor:pointer}#rotation-speed-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;background:#60a5fa;border-radius:50%;cursor:pointer;border:2px solid white}#rotation-speed-slider::-moz-range-thumb{width:18px;height:18px;background:#60a5fa;border-radius:50%;cursor:pointer;border:2px solid white}#speed-display{color:#60a5fa;font-size:14px;font-weight:700;min-width:24px;text-align:center}@media(max-width:768px){#rotation-controls{top:auto;bottom:100px;right:10px}#globe-rotate-btn{min-width:auto;width:50px;height:50px;padding:12px;border-radius:50%}#rotate-btn-text{display:none}}';
    document.head.appendChild(styleElement);
}

function initRotationSystem() {
    // The old floating "Rotate Globe" button + speed slider (addRotationStyles /
    // createRotationControls) has been retired in favor of the Rotate icon in
    // the map-toolbar, which drives the same toggleRotation()/isGlobeRotating().
    setupInteractionHandlers();
    console.log('Rotation system initialized!');
}

// ============================================
// ADVANCED HAZARD ANIMATION SYSTEM
// ============================================

class AdvancedHazardAnimationSystem {
    constructor() {
        this.activeAnimations = new Map();
        this.canvasAnimations = new Map();
        this.animationFrameIds = new Map();
        this.particleSystems = new Map();
        // Zoom level at which the flood animation's base CSS size (see
        // .flood-container etc. below) looks "normal" - below this it
        // shrinks, above it it grows, so the effect tracks a consistent
        // real-world footprint instead of a fixed screen-pixel size.
        this.floodReferenceZoom = 9;
        // Rain/ripples/lightning stay paused (via the .storm-inactive CSS
        // below) until the map is zoomed in at least this far, so a
        // zoomed-out overview doesn't run dozens of animations no one can
        // actually see the detail of.
        this.floodAnimationStartZoom = 8;
        this.addAdvancedAnimationStyles();

        // Keep flood animation footprints scaled with the map's zoom.
        map.on('zoom', () => this.updateFloodAnimationScale());
    }

    getFloodScaleForCurrentZoom() {
        const zoom = map.getZoom();
        const scale = Math.pow(2, zoom - this.floodReferenceZoom);
        return Math.min(3, Math.max(0.35, scale));
    }

    // Applies both the current zoom-based scale AND the running/paused
    // animation state to one marker's inner wrapper. Shared by marker
    // creation (addAnimationToMarker) and the zoom listener below so the
    // two never fall out of sync with each other.
    applyFloodWrapperState(wrapper) {
        if (!wrapper) return;
        wrapper.style.transform = `scale(${this.getFloodScaleForCurrentZoom()})`;
        wrapper.classList.toggle('storm-inactive', map.getZoom() < this.floodAnimationStartZoom);
    }

    updateFloodAnimationScale() {
        const markers = this.activeAnimations.get('floods');
        if (!markers || !markers.length) return;
        markers.forEach((marker) => {
            const el = marker.getElement();
            this.applyFloodWrapperState(el && el.querySelector('.flood-scale-wrapper'));
        });
    }

    addAdvancedAnimationStyles() {
        const styleElement = document.createElement('style');
        styleElement.id = 'advanced-hazard-animation-styles';
        styleElement.textContent = `
            /* ============================================ */
            /* BASE ANIMATION CONTAINER STYLES */
            /* ============================================ */
            
            .hazard-animation-container {
                position: absolute;
                pointer-events: none;
                z-index: 1;
            }

            .animation-canvas {
                position: absolute;
                top: 0;
                left: 0;
                pointer-events: none;
            }

            /* ============================================ */
            /* SNOW EMERGENCY - BLIZZARD EFFECT */
            /* ============================================ */
            
            .snow-container {
                width: 180px;
                height: 180px;
                border-radius: 50%;
                transform: translate(-50%, -50%);
                overflow: hidden;
            }

            .snow-layer {
                position: absolute;
                width: 100%;
                height: 100%;
                pointer-events: none;
            }

            .snowflake {
                position: absolute;
                color: white;
                text-shadow: 0 0 8px rgba(255,255,255,0.9), 0 0 15px rgba(200,230,255,0.6);
                animation: snowfallAdvanced linear infinite;
                opacity: 0;
                filter: blur(0.3px);
            }

            .snowflake.large {
                font-size: 14px;
                animation-duration: 3s;
            }

            .snowflake.medium {
                font-size: 10px;
                animation-duration: 4s;
            }

            .snowflake.small {
                font-size: 6px;
                animation-duration: 5s;
                filter: blur(0.8px);
            }

            @keyframes snowfallAdvanced {
                0% {
                    opacity: 0;
                    transform: translateY(-20px) translateX(0) rotate(0deg) scale(0.8);
                }
                5% {
                    opacity: 1;
                }
                50% {
                    transform: translateY(80px) translateX(20px) rotate(180deg) scale(1);
                }
                95% {
                    opacity: 0.8;
                }
                100% {
                    opacity: 0;
                    transform: translateY(180px) translateX(-10px) rotate(360deg) scale(0.6);
                }
            }

            .snow-wind {
                position: absolute;
                width: 100%;
                height: 100%;
                background: linear-gradient(
                    135deg,
                    transparent 0%,
                    rgba(255,255,255,0.03) 25%,
                    transparent 50%,
                    rgba(255,255,255,0.05) 75%,
                    transparent 100%
                );
                animation: windSweep 3s ease-in-out infinite;
            }

            @keyframes windSweep {
                0%, 100% { transform: translateX(-30px) skewX(-5deg); opacity: 0.3; }
                50% { transform: translateX(30px) skewX(5deg); opacity: 0.6; }
            }

            .frost-overlay {
                position: absolute;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                background: radial-gradient(
                    ellipse at center,
                    transparent 30%,
                    rgba(200, 230, 255, 0.1) 60%,
                    rgba(180, 220, 255, 0.2) 100%
                );
                animation: frostPulse 4s ease-in-out infinite;
            }

            @keyframes frostPulse {
                0%, 100% { opacity: 0.4; transform: scale(1); }
                50% { opacity: 0.7; transform: scale(1.05); }
            }

            .ice-crystal {
                position: absolute;
                width: 8px;
                height: 8px;
                background: radial-gradient(circle, rgba(255,255,255,0.9), transparent);
                clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
                animation: crystalSparkle 2s ease-in-out infinite;
            }

            @keyframes crystalSparkle {
                0%, 100% { opacity: 0.3; transform: scale(0.8) rotate(0deg); }
                50% { opacity: 1; transform: scale(1.2) rotate(30deg); }
            }

           /* ========== FIRE ANIMATION ========== */
.fire-container {
    width: 100px;
    height: 100px;
    transform: translate(-50%, -50%);
}

.fire-particle {
    position: absolute;
    border-radius: 50%;
    animation: fireRise linear infinite;
    opacity: 0;
    filter: blur(2px);
}

@keyframes fireRise {
    0% {
        opacity: 0;
        transform: translateY(50px) scale(1);
    }
    20% {
        opacity: 1;
    }
    80% {
        opacity: 0.8;
    }
    100% {
        opacity: 0;
        transform: translateY(-60px) scale(0.2);
    }
}

.fire-glow {
    position: absolute;
    width: 80px;
    height: 80px;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: radial-gradient(ellipse at center, 
        rgba(255, 100, 0, 0.6) 0%, 
        rgba(255, 50, 0, 0.3) 40%, 
        transparent 70%);
    animation: fireGlow 0.5s ease-in-out infinite alternate;
    border-radius: 50%;
}

@keyframes fireGlow {
    0% { 
        transform: translate(-50%, -50%) scale(0.9); 
        opacity: 0.7; 
    }
    100% { 
        transform: translate(-50%, -50%) scale(1.1); 
        opacity: 1; 
    }
}

            /* ============================================ */
            /* FLOOD - WATER SURGE EFFECT */
            /* ============================================ */
            
            .flood-container {
                width: 280px;
                height: 220px;
                transform: translate(-50%, -50%);
            }

            .flood-scale-wrapper {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                transform-origin: 50% 50%;
            }

            /* Hides the whole rain/lightning effect until the map is zoomed
               in far enough - toggled by applyFloodWrapperState() in
               AdvancedHazardAnimationSystem (point markers), keyed to its
               own zoom threshold. opacity:0 on the
               wrapper itself hides everything outright (pausing alone would
               just freeze each drop/ripple/bolt wherever it happened to be
               mid-animation, leaving visible stuck artifacts if you zoom in
               then back out); animation-play-state:paused on the children
               is kept alongside it purely to stop burning cycles while
               hidden.
             */
            .flood-scale-wrapper.storm-inactive {
                opacity: 0;
                pointer-events: none;
            }

            .flood-scale-wrapper.storm-inactive .ripple-ring,
            .flood-scale-wrapper.storm-inactive .rain-drop,
            .flood-scale-wrapper.storm-inactive .splash,
            .flood-scale-wrapper.storm-inactive .storm-sky-flash,
            .flood-scale-wrapper.storm-inactive .storm-bolt {
                animation-play-state: paused;
            }

            .ripple-ring {
                position: absolute;
                border: 3px solid rgba(30, 144, 255, 0.6);
                border-radius: 50%;
                animation: rippleExpand 2s ease-out infinite;
                opacity: 0;
            }

            @keyframes rippleExpand {
                0% {
                    width: 30px;
                    height: 15px;
                    opacity: 0.8;
                    border-width: 3px;
                }
                100% {
                    width: 250px;
                    height: 125px;
                    opacity: 0;
                    border-width: 1px;
                }
            }

            .rain-drop {
                position: absolute;
                width: 1px;
                background: linear-gradient(180deg,
                    transparent 0%,
                    rgba(100, 180, 255, 0.8) 50%,
                    rgba(150, 200, 255, 0.9) 100%
                );
                border-radius: 0 0 50% 50%;
                animation: rainFallAdvanced linear infinite;
                opacity: 0;
            }

            @keyframes rainFallAdvanced {
                0% {
                    opacity: 0;
                    transform: translateY(-30px) translateX(var(--windOffset));
                }
                10% {
                    opacity: 0.9;
                }
                90% {
                    opacity: 0.7;
                }
                100% {
                    opacity: 0;
                    transform: translateY(140px) translateX(calc(var(--windOffset) + 10px));
                }
            }

            .splash {
                position: absolute;
                bottom: 25%;
                width: 6px;
                height: 6px;
                background: rgba(150, 200, 255, 0.6);
                border-radius: 50%;
                animation: splashUp 0.8s ease-out infinite;
                opacity: 0;
            }

            @keyframes splashUp {
                0% {
                    opacity: 0;
                    transform: translateY(0) scale(1);
                }
                30% {
                    opacity: 0.8;
                    transform: translateY(-15px) scale(0.8);
                }
                100% {
                    opacity: 0;
                    transform: translateY(-5px) scale(0.3);
                }
            }

            /* NOTE: named storm-sky-flash/storm-bolt (not lightning-flash/
               lightning-bolt) deliberately - .lightning-flash already exists
               elsewhere below for the cyclone animation, and since CSS
               classes are global, reusing that name would have silently
               made these elements render with THAT unrelated animation
               instead of this one. */
            .storm-sky-flash {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: radial-gradient(ellipse at center,
                    rgba(255, 255, 255, 0.95) 0%,
                    rgba(210, 225, 255, 0.7) 45%,
                    transparent 78%
                );
                opacity: 0;
                animation-name: stormFlash;
                animation-timing-function: linear;
                animation-iteration-count: infinite;
            }

            .storm-bolt {
                position: absolute;
                top: 0;
                width: 34px;
                height: 110px;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 100'%3E%3Cpolygon points='22,0 6,55 18,55 10,100 34,42 20,42 30,0' fill='white'/%3E%3C/svg%3E");
                background-size: contain;
                background-repeat: no-repeat;
                filter: drop-shadow(0 0 10px rgba(200, 220, 255, 1)) drop-shadow(0 0 4px rgba(255, 255, 255, 1));
                opacity: 0;
                animation-name: stormFlash;
                animation-timing-function: linear;
                animation-iteration-count: infinite;
            }

            /* Shared by both .storm-sky-flash and .storm-bolt - a quick
               double-flicker near the end of each instance's own randomized
               duration/delay, so instances never stay in sync with each other. */
            @keyframes stormFlash {
                0%, 91%, 100% { opacity: 0; }
                92% { opacity: 1; }
                93% { opacity: 0.2; }
                94% { opacity: 0.95; }
                96% { opacity: 0; }
            }

            /* ============================================ */
            /* EARTHQUAKE - SEISMIC EFFECT */
            /* ============================================ */
            
            .earthquake-container {
                width: 160px;
                height: 160px;
                transform: translate(-50%, -50%);
            }

            .seismic-center {
                position: absolute;
                width: 20px;
                height: 20px;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                background: radial-gradient(circle,
                    rgba(139, 69, 19, 0.9) 0%,
                    rgba(100, 50, 20, 0.7) 50%,
                    transparent 100%
                );
                border-radius: 50%;
                animation: epicenterPulse 0.5s ease-in-out infinite;
            }

            @keyframes epicenterPulse {
                0%, 100% { transform: translate(-50%, -50%) scale(1); }
                50% { transform: translate(-50%, -50%) scale(1.3); }
            }

            .seismic-wave-advanced {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                border: 4px solid rgba(139, 69, 19, 0.8);
                border-radius: 50%;
                animation: seismicWaveAdvanced 1.5s ease-out infinite;
                opacity: 0;
                box-shadow: 0 0 10px rgba(139, 69, 19, 0.5);
            }

            @keyframes seismicWaveAdvanced {
                0% {
                    width: 10px;
                    height: 10px;
                    opacity: 1;
                    border-width: 4px;
                    box-shadow: 0 0 20px rgba(139, 69, 19, 0.8);
                }
                100% {
                    width: 180px;
                    height: 180px;
                    opacity: 0;
                    border-width: 1px;
                    box-shadow: 0 0 5px rgba(139, 69, 19, 0.2);
                }
            }

            .ground-crack {
                position: absolute;
                height: 4px;
                background: linear-gradient(90deg,
                    transparent 0%,
                    rgba(50, 30, 10, 0.9) 20%,
                    rgba(80, 50, 20, 1) 50%,
                    rgba(50, 30, 10, 0.9) 80%,
                    transparent 100%
                );
                animation: crackForm 2s ease-out infinite;
                box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            }

            @keyframes crackForm {
                0% { width: 0; opacity: 0; }
                30% { opacity: 1; }
                50% { width: 100%; opacity: 1; }
                100% { width: 100%; opacity: 0; }
            }

            .debris-particle {
                position: absolute;
                background: linear-gradient(135deg, #8B4513, #654321);
                border-radius: 2px;
                animation: debrisBounce ease-out infinite;
                opacity: 0;
                box-shadow: 1px 1px 2px rgba(0,0,0,0.4);
            }

            @keyframes debrisBounce {
                0% {
                    opacity: 0;
                    transform: translateY(0) translateX(0) rotate(0deg);
                }
                10% {
                    opacity: 1;
                }
                30% {
                    transform: translateY(-30px) translateX(var(--debrisDrift)) rotate(180deg);
                }
                60% {
                    transform: translateY(5px) translateX(calc(var(--debrisDrift) * 1.2)) rotate(270deg);
                }
                100% {
                    opacity: 0;
                    transform: translateY(0) translateX(calc(var(--debrisDrift) * 1.5)) rotate(360deg);
                }
            }

            .shake-container {
                animation: advancedShake 0.15s ease-in-out infinite;
            }

            @keyframes advancedShake {
                0%, 100% { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); }
                10% { transform: translate(-50%, -50%) translate(-2px, -1px) rotate(-0.5deg); }
                20% { transform: translate(-50%, -50%) translate(3px, 1px) rotate(0.5deg); }
                30% { transform: translate(-50%, -50%) translate(-1px, 2px) rotate(-0.3deg); }
                40% { transform: translate(-50%, -50%) translate(2px, -2px) rotate(0.3deg); }
                50% { transform: translate(-50%, -50%) translate(-2px, 1px) rotate(-0.5deg); }
                60% { transform: translate(-50%, -50%) translate(1px, -1px) rotate(0.2deg); }
                70% { transform: translate(-50%, -50%) translate(-1px, -2px) rotate(-0.2deg); }
                80% { transform: translate(-50%, -50%) translate(2px, 2px) rotate(0.4deg); }
                90% { transform: translate(-50%, -50%) translate(-2px, 0) rotate(-0.4deg); }
            }

            /* ============================================ */
            /* LANDSLIDE - DEBRIS FLOW EFFECT */
            /* ============================================ */
            
            .landslide-container {
                width: 160px;
                height: 200px;
                transform: translate(-50%, -50%);
            }

            .mountain-silhouette {
                position: absolute;
                bottom: 20%;
                left: 50%;
                transform: translateX(-50%);
                width: 0;
                height: 0;
                border-left: 60px solid transparent;
                border-right: 60px solid transparent;
                border-bottom: 80px solid rgba(101, 67, 33, 0.3);
                opacity: 0.5;
            }

            .rock-boulder {
                position: absolute;
                border-radius: 30% 70% 50% 50%;
                animation: boulderRoll linear infinite;
                opacity: 0;
                box-shadow: 
                    inset -3px -3px 6px rgba(0,0,0,0.4),
                    inset 2px 2px 4px rgba(255,255,255,0.1),
                    2px 3px 5px rgba(0,0,0,0.5);
            }

            @keyframes boulderRoll {
                0% {
                    opacity: 0;
                    transform: translateY(-40px) translateX(0) rotate(0deg) scale(1);
                }
                10% {
                    opacity: 1;
                }
                100% {
                    opacity: 0;
                    transform: translateY(180px) translateX(40px) rotate(720deg) scale(0.7);
                }
            }

            .mud-flow {
                position: absolute;
                bottom: 10%;
                left: 50%;
                transform: translateX(-50%);
                width: 100px;
                height: 40px;
                background: linear-gradient(180deg,
                    rgba(139, 90, 43, 0.6) 0%,
                    rgba(101, 67, 33, 0.8) 50%,
                    rgba(80, 50, 20, 0.9) 100%
                );
                border-radius: 50%;
                animation: mudSpread 3s ease-out infinite;
            }

            @keyframes mudSpread {
                0% { width: 40px; opacity: 0.3; }
                50% { width: 120px; opacity: 0.7; }
                100% { width: 40px; opacity: 0.3; }
            }

            .dust-plume {
                position: absolute;
                background: radial-gradient(ellipse at center,
                    rgba(160, 120, 80, 0.5) 0%,
                    rgba(140, 100, 60, 0.3) 40%,
                    transparent 70%
                );
                border-radius: 50%;
                animation: plumeRise 4s ease-out infinite;
                filter: blur(4px);
            }

            @keyframes plumeRise {
                0% {
                    transform: scale(0.3) translateY(20px);
                    opacity: 0;
                }
                30% {
                    opacity: 0.6;
                }
                100% {
                    transform: scale(2.5) translateY(-60px);
                    opacity: 0;
                }
            }

            .small-debris {
                position: absolute;
                background: linear-gradient(135deg, #8B7355, #6B5344);
                animation: smallDebrisFall linear infinite;
                opacity: 0;
            }

            @keyframes smallDebrisFall {
                0% {
                    opacity: 0;
                    transform: translateY(-20px) translateX(0) rotate(0deg);
                }
                15% {
                    opacity: 0.8;
                }
                100% {
                    opacity: 0;
                    transform: translateY(200px) translateX(30px) rotate(540deg);
                }
            }

            /* ============================================ */
            /* DROUGHT - HEAT AND CRACK EFFECT */
            /* ============================================ */
            
            .drought-container {
                width: 160px;
                height: 160px;
                transform: translate(-50%, -50%);
            }

            .dry-ground {
                position: absolute;
                width: 120px;
                height: 80px;
                left: 50%;
                bottom: 20%;
                transform: translateX(-50%);
                background: linear-gradient(180deg,
                    rgba(210, 180, 140, 0.4) 0%,
                    rgba(180, 140, 100, 0.6) 50%,
                    rgba(150, 110, 70, 0.5) 100%
                );
                border-radius: 50%;
            }

            .heat-wave-layer {
                position: absolute;
                width: 100%;
                height: 100%;
                background: linear-gradient(0deg,
                    transparent 0%,
                    rgba(255, 200, 100, 0.05) 20%,
                    transparent 40%,
                    rgba(255, 180, 80, 0.08) 60%,
                    transparent 80%,
                    rgba(255, 160, 60, 0.05) 100%
                );
                animation: heatWaveDistort 2s ease-in-out infinite;
            }

            @keyframes heatWaveDistort {
                0%, 100% {
                    transform: scaleY(1) translateY(0);
                    opacity: 0.5;
                }
                50% {
                    transform: scaleY(1.3) translateY(-10px);
                    opacity: 0.9;
                }
            }

            .drought-crack {
                position: absolute;
                height: 2px;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(80, 50, 20, 0.8),
                    rgba(60, 35, 10, 0.9),
                    rgba(80, 50, 20, 0.8),
                    transparent
                );
                animation: crackDry 4s ease-in-out infinite;
            }

            @keyframes crackDry {
                0%, 100% { opacity: 0.5; width: 80%; }
                50% { opacity: 0.9; width: 100%; }
            }

            .heat-shimmer-particle {
                position: absolute;
                width: 30px;
                height: 30px;
                background: radial-gradient(circle,
                    rgba(255, 200, 100, 0.3) 0%,
                    transparent 70%
                );
                animation: shimmerFloat 3s ease-in-out infinite;
                filter: blur(2px);
            }

            @keyframes shimmerFloat {
                0%, 100% {
                    transform: translateY(0) scale(1);
                    opacity: 0.3;
                }
                50% {
                    transform: translateY(-25px) scale(1.5);
                    opacity: 0.6;
                }
            }

            .wilted-plant {
                position: absolute;
                width: 4px;
                height: 20px;
                background: linear-gradient(180deg, #8B7355, #6B5344);
                border-radius: 2px;
                transform-origin: bottom center;
                animation: wiltAnimation 5s ease-in-out infinite;
            }

            @keyframes wiltAnimation {
                0%, 100% { transform: rotate(-10deg) scaleY(0.9); }
                50% { transform: rotate(10deg) scaleY(0.85); }
            }

            /* ============================================ */
            /* HEATWAVE - INTENSE HEAT EFFECT */
            /* ============================================ */
            
            .heatwave-container {
                width: 160px;
                height: 160px;
                transform: translate(-50%, -50%);
            }

            .sun-core {
                position: absolute;
                width: 50px;
                height: 50px;
                left: 50%;
                top: 15%;
                transform: translateX(-50%);
                background: radial-gradient(circle,
                    #FFFFFF 0%,
                    #FFFACD 20%,
                    #FFD700 40%,
                    #FFA500 60%,
                    #FF6B00 80%,
                    transparent 100%
                );
                border-radius: 50%;
                animation: sunPulseIntense 1.5s ease-in-out infinite;
                box-shadow: 
                    0 0 30px rgba(255, 200, 0, 0.6),
                    0 0 60px rgba(255, 150, 0, 0.4),
                    0 0 90px rgba(255, 100, 0, 0.2);
            }

            @keyframes sunPulseIntense {
                0%, 100% { 
                    transform: translateX(-50%) scale(1);
                    box-shadow: 
                        0 0 30px rgba(255, 200, 0, 0.6),
                        0 0 60px rgba(255, 150, 0, 0.4);
                }
                50% { 
                    transform: translateX(-50%) scale(1.15);
                    box-shadow: 
                        0 0 50px rgba(255, 200, 0, 0.8),
                        0 0 80px rgba(255, 150, 0, 0.6),
                        0 0 120px rgba(255, 100, 0, 0.3);
                }
            }

            .sun-ray {
                position: absolute;
                left: 50%;
                top: 25%;
                width: 4px;
                height: 40px;
                background: linear-gradient(180deg,
                    rgba(255, 200, 0, 0.8),
                    rgba(255, 150, 0, 0.5),
                    transparent
                );
                transform-origin: center top;
                animation: rayPulse 2s ease-in-out infinite;
                border-radius: 2px;
            }

            @keyframes rayPulse {
                0%, 100% { 
                    opacity: 0.6;
                    transform: translateX(-50%) scaleY(1);
                }
                50% { 
                    opacity: 1;
                    transform: translateX(-50%) scaleY(1.3);
                }
            }

            .heat-wave-band {
                position: absolute;
                width: 100%;
                height: 8px;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(255, 100, 0, 0.3),
                    rgba(255, 150, 0, 0.5),
                    rgba(255, 100, 0, 0.3),
                    transparent
                );
                animation: heatBandMove 1.5s ease-in-out infinite;
                filter: blur(2px);
            }

            @keyframes heatBandMove {
                0%, 100% { 
                    transform: translateY(0) scaleX(0.8);
                    opacity: 0.4;
                }
                50% { 
                    transform: translateY(-20px) scaleX(1.2);
                    opacity: 0.9;
                }
            }

            .thermometer-indicator {
                position: absolute;
                right: 10%;
                top: 50%;
                transform: translateY(-50%);
                width: 12px;
                height: 50px;
                background: linear-gradient(180deg,
                    #FF0000 0%,
                    #FF4500 30%,
                    #FF6347 50%,
                    #FF7F50 70%,
                    rgba(255,127,80,0.3) 100%
                );
                border-radius: 6px;
                animation: tempRise 2s ease-in-out infinite;
                box-shadow: 0 0 10px rgba(255, 50, 0, 0.5);
            }

            @keyframes tempRise {
                0%, 100% { height: 35px; }
                50% { height: 55px; }
            }

            /* ============================================ */
            /* GLOF - GLACIAL LAKE OUTBURST */
            /* ============================================ */
            
            .glof-container {
                width: 180px;
                height: 180px;
                transform: translate(-50%, -50%);
            }

            .glacier-mass {
                position: absolute;
                top: 10%;
                left: 50%;
                transform: translateX(-50%);
                width: 80px;
                height: 40px;
                background: linear-gradient(180deg,
                    rgba(220, 240, 255, 0.9) 0%,
                    rgba(180, 220, 250, 0.8) 30%,
                    rgba(150, 200, 240, 0.7) 60%,
                    rgba(100, 180, 230, 0.6) 100%
                );
                clip-path: polygon(10% 100%, 0% 50%, 15% 0%, 40% 20%, 60% 0%, 85% 10%, 100% 40%, 90% 100%);
                animation: glacierBreak 4s ease-in-out infinite;
            }

            @keyframes glacierBreak {
                0%, 90%, 100% { transform: translateX(-50%) scale(1); }
                95% { transform: translateX(-50%) scale(0.95) translateY(2px); }
            }

            .ice-calving {
                position: absolute;
                background: linear-gradient(135deg,
                    rgba(220, 240, 255, 0.9),
                    rgba(180, 220, 250, 0.8),
                    rgba(150, 200, 240, 0.7)
                );
                clip-path: polygon(20% 0%, 80% 0%, 100% 50%, 80% 100%, 20% 100%, 0% 50%);
                animation: iceCalve linear infinite;
                opacity: 0;
            }

            @keyframes iceCalve {
                0% {
                    opacity: 0;
                    transform: translateY(0) rotate(0deg);
                }
                10% {
                    opacity: 0.9;
                }
                100% {
                    opacity: 0;
                    transform: translateY(120px) rotate(180deg);
                }
            }

            .glacial-burst-wave {
                position: absolute;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                border: 5px solid rgba(65, 105, 225, 0.7);
                border-radius: 50%;
                animation: glacialBurst 2s ease-out infinite;
                box-shadow: 
                    0 0 15px rgba(65, 105, 225, 0.5),
                    inset 0 0 15px rgba(135, 206, 250, 0.3);
            }

            @keyframes glacialBurst {
                0% {
                    width: 20px;
                    height: 20px;
                    opacity: 1;
                    border-width: 5px;
                }
                100% {
                    width: 200px;
                    height: 100px;
                    opacity: 0;
                    border-width: 1px;
                }
            }

            .water-torrent {
                position: absolute;
                background: linear-gradient(180deg,
                    rgba(65, 105, 225, 0.7),
                    rgba(30, 144, 255, 0.8),
                    rgba(100, 180, 255, 0.6)
                );
                border-radius: 50% 50% 20% 20%;
                animation: torrentSurge 1.5s ease-out infinite;
                filter: blur(1px);
            }

            @keyframes torrentSurge {
                0% {
                    transform: translateY(0) scaleX(1) scaleY(0.3);
                    opacity: 0;
                }
                30% {
                    opacity: 0.9;
                    transform: translateY(10px) scaleX(1.2) scaleY(1);
                }
                100% {
                    transform: translateY(80px) scaleX(2) scaleY(0.5);
                    opacity: 0;
                }
            }

            .glacial-mist {
                position: absolute;
                background: radial-gradient(ellipse,
                    rgba(200, 230, 255, 0.4) 0%,
                    rgba(180, 220, 250, 0.2) 50%,
                    transparent 70%
                );
                border-radius: 50%;
                animation: mistFloat 5s ease-in-out infinite;
                filter: blur(5px);
            }

            @keyframes mistFloat {
                0%, 100% { transform: translateX(-10px) scale(1); opacity: 0.3; }
                50% { transform: translateX(10px) scale(1.2); opacity: 0.6; }
            }

            /* ============================================ */
            /* COASTAL/CYCLONE - STORM EFFECT */
            /* ============================================ */
            
            .coastal-container {
                width: 200px;
                height: 200px;
                transform: translate(-50%, -50%);
            }

            .cyclone-eye {
                position: absolute;
                width: 25px;
                height: 25px;
                left: 50%;
                top: 50%;
                transform: translate(-50%, -50%);
                background: radial-gradient(circle,
                    rgba(0, 30, 60, 0.9) 0%,
                    rgba(32, 100, 120, 0.6) 50%,
                    rgba(32, 178, 170, 0.4) 100%
                );
                border-radius: 50%;
                box-shadow: 0 0 20px rgba(32, 178, 170, 0.5);
                animation: eyePulse 2s ease-in-out infinite;
            }

            @keyframes eyePulse {
                0%, 100% { transform: translate(-50%, -50%) scale(1); }
                50% { transform: translate(-50%, -50%) scale(1.2); }
            }

            .spiral-band {
                position: absolute;
                left: 50%;
                top: 50%;
                border: 4px solid transparent;
                border-top-color: rgba(32, 178, 170, 0.7);
                border-right-color: rgba(32, 178, 170, 0.5);
                border-radius: 50%;
                animation: spiralRotate linear infinite;
                box-shadow: 0 0 10px rgba(32, 178, 170, 0.3);
            }

            @keyframes spiralRotate {
                from { transform: translate(-50%, -50%) rotate(0deg); }
                to { transform: translate(-50%, -50%) rotate(360deg); }
            }

            .cloud-mass {
                position: absolute;
                background: radial-gradient(ellipse,
                    rgba(150, 180, 200, 0.6) 0%,
                    rgba(100, 130, 160, 0.4) 50%,
                    transparent 70%
                );
                border-radius: 50%;
                animation: cloudSwirl linear infinite;
            }

            @keyframes cloudSwirl {
                from { transform: rotate(0deg) translateX(30px) rotate(0deg); }
                to { transform: rotate(360deg) translateX(30px) rotate(-360deg); }
            }

            .rain-band {
                position: absolute;
                width: 2px;
                height: 15px;
                background: linear-gradient(180deg,
                    transparent,
                    rgba(100, 180, 255, 0.7),
                    rgba(150, 200, 255, 0.9)
                );
                animation: cycloneRain linear infinite;
                opacity: 0;
            }

            @keyframes cycloneRain {
                0% {
                    opacity: 0;
                    transform: translateY(-20px) rotate(var(--rainAngle));
                }
                10% { opacity: 0.8; }
                100% {
                    opacity: 0;
                    transform: translateY(100px) rotate(var(--rainAngle));
                }
            }

            .lightning-flash {
                position: absolute;
                width: 3px;
                height: 40px;
                background: linear-gradient(180deg,
                    rgba(255, 255, 255, 0.9),
                    rgba(200, 220, 255, 0.7),
                    rgba(150, 180, 255, 0.5)
                );
                clip-path: polygon(0% 0%, 100% 0%, 60% 40%, 100% 40%, 40% 100%, 50% 50%, 0% 50%);
                animation: lightningStrike 4s ease-out infinite;
                opacity: 0;
                filter: blur(1px);
            }

            @keyframes lightningStrike {
                0%, 89%, 91%, 93%, 100% { opacity: 0; }
                90%, 92% { opacity: 1; }
            }

            .storm-surge {
                position: absolute;
                bottom: 5%;
                left: 50%;
                transform: translateX(-50%);
                width: 150px;
                height: 30px;
                background: linear-gradient(180deg,
                    rgba(32, 178, 170, 0.5),
                    rgba(0, 100, 150, 0.7)
                );
                border-radius: 50%;
                animation: surgePush 2s ease-in-out infinite;
            }

            @keyframes surgePush {
                0%, 100% { transform: translateX(-50%) scaleX(1); }
                50% { transform: translateX(-50%) scaleX(1.3); }
            }

            /* ============================================ */
            /* SMOG/FOG - ATMOSPHERIC EFFECT */
            /* ============================================ */
            
            .smog-container {
                width: 180px;
                height: 140px;
                transform: translate(-50%, -50%);
            }

            .smog-layer-dense {
                position: absolute;
                width: 100%;
                height: 100%;
                background: radial-gradient(ellipse at center,
                    rgba(128, 128, 128, 0.5) 0%,
                    rgba(100, 100, 100, 0.4) 30%,
                    rgba(80, 80, 80, 0.3) 60%,
                    transparent 80%
                );
                animation: smogDrift 6s ease-in-out infinite;
                filter: blur(3px);
            }

            @keyframes smogDrift {
                0%, 100% { 
                    transform: translateX(-15px) scale(1);
                    opacity: 0.5;
                }
                50% { 
                    transform: translateX(15px) scale(1.1);
                    opacity: 0.8;
                }
            }

            .pollution-particle {
                position: absolute;
                border-radius: 50%;
                animation: particleFloat ease-in-out infinite;
            }

            @keyframes particleFloat {
                0%, 100% {
                    transform: translateY(0) translateX(0) scale(1);
                    opacity: var(--particleOpacity);
                }
                25% {
                    transform: translateY(-10px) translateX(5px) scale(1.1);
                }
                50% {
                    transform: translateY(-5px) translateX(-5px) scale(0.9);
                    opacity: calc(var(--particleOpacity) * 1.3);
                }
                75% {
                    transform: translateY(-15px) translateX(3px) scale(1.05);
                }
            }

            .haze-band {
                position: absolute;
                width: 120%;
                left: -10%;
                height: 20px;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(112, 128, 144, 0.3),
                    rgba(128, 128, 128, 0.5),
                    rgba(112, 128, 144, 0.3),
                    transparent
                );
                animation: hazeDrift 8s ease-in-out infinite;
                filter: blur(4px);
            }

            @keyframes hazeDrift {
                0%, 100% { transform: translateX(-20px); opacity: 0.4; }
                50% { transform: translateX(20px); opacity: 0.7; }
            }

            .visibility-indicator {
                position: absolute;
                width: 100%;
                height: 100%;
                border-radius: 50%;
                border: 2px dashed rgba(112, 128, 144, 0.4);
                animation: visibilityPulse 3s ease-in-out infinite;
            }

            @keyframes visibilityPulse {
                0%, 100% { opacity: 0.3; transform: scale(0.9); }
                50% { opacity: 0.6; transform: scale(1.05); }
            }

            .smog-wisp {
                position: absolute;
                background: linear-gradient(90deg,
                    transparent,
                    rgba(100, 100, 100, 0.4),
                    transparent
                );
                height: 8px;
                border-radius: 4px;
                animation: wispMove linear infinite;
                filter: blur(2px);
            }

            @keyframes wispMove {
                0% { transform: translateX(-50px); opacity: 0; }
                20% { opacity: 0.5; }
                80% { opacity: 0.5; }
                100% { transform: translateX(50px); opacity: 0; }
            }

            .city-silhouette {
                position: absolute;
                bottom: 15%;
                left: 50%;
                transform: translateX(-50%);
                width: 100px;
                height: 30px;
                background: linear-gradient(180deg,
                    rgba(50, 50, 50, 0.5) 0%,
                    rgba(30, 30, 30, 0.7) 100%
                );
                clip-path: polygon(
                    0% 100%, 0% 70%, 10% 70%, 10% 50%, 20% 50%, 20% 60%, 
                    30% 60%, 30% 30%, 40% 30%, 40% 60%, 50% 60%, 50% 40%,
                    60% 40%, 60% 55%, 70% 55%, 70% 45%, 80% 45%, 80% 65%,
                    90% 65%, 90% 50%, 100% 50%, 100% 100%
                );
                animation: cityFade 4s ease-in-out infinite;
            }

            @keyframes cityFade {
                0%, 100% { opacity: 0.4; }
                50% { opacity: 0.7; }
            }
        `;
        document.head.appendChild(styleElement);
    }

    // ========================================
    // SNOW ANIMATION - BLIZZARD
    // ========================================
    createSnowAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container snow-container';

        // Frost overlay
        const frost = document.createElement('div');
        frost.className = 'frost-overlay';
        container.appendChild(frost);

        // Wind effect
        const wind = document.createElement('div');
        wind.className = 'snow-wind';
        container.appendChild(wind);

        // Create multiple layers of snowflakes
        const particleCount = severity === 'Very High' ? 50 : severity === 'High' ? 40 : 30;
        const snowTypes = ['❄', '❅', '❆', '✻', '✼', '❉'];
        const sizes = ['large', 'medium', 'small'];

        for (let layer = 0; layer < 3; layer++) {
            const snowLayer = document.createElement('div');
            snowLayer.className = 'snow-layer';
            snowLayer.style.zIndex = layer;

            for (let i = 0; i < particleCount / 3; i++) {
                const snowflake = document.createElement('div');
                snowflake.className = `snowflake ${sizes[layer]}`;
                snowflake.innerHTML = snowTypes[Math.floor(Math.random() * snowTypes.length)];
                snowflake.style.left = `${Math.random() * 100}%`;
                snowflake.style.animationDelay = `${Math.random() * 5}s`;
                snowflake.style.opacity = 0.7 + Math.random() * 0.3;
                snowLayer.appendChild(snowflake);
            }
            container.appendChild(snowLayer);
        }

        // Ice crystals
        for (let i = 0; i < 8; i++) {
            const crystal = document.createElement('div');
            crystal.className = 'ice-crystal';
            crystal.style.left = `${10 + Math.random() * 80}%`;
            crystal.style.top = `${10 + Math.random() * 80}%`;
            crystal.style.animationDelay = `${Math.random() * 2}s`;
            container.appendChild(crystal);
        }

        return container;
    }

    // ========================================
    // FIRE ANIMATION - INFERNO
    // ========================================
    // Create Fire Animation
    createFireAnimation() {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container fire-container';

        // Fire glow effect
        const glow = document.createElement('div');
        glow.className = 'fire-glow';
        container.appendChild(glow);

        // Fire particle colors
        const colors = ['#ff4500', '#ff6600', '#ff8c00', '#ffa500', '#ffcc00', '#ff3300'];

        // Create 25 fire particles
        for (let i = 0; i < 25; i++) {
            const particle = document.createElement('div');
            particle.className = 'fire-particle';

            // Random size between 5-20px
            const size = 5 + Math.random() * 15;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;

            // Position particles in the center area (30-70% from left)
            particle.style.left = `${30 + Math.random() * 40}%`;

            // Start from bottom 20%
            particle.style.bottom = '20%';

            // Random fire color gradient
            particle.style.background = `radial-gradient(circle, ${colors[Math.floor(Math.random() * colors.length)]}, transparent)`;

            // Random animation duration (0.8-1.8 seconds)
            particle.style.animationDuration = `${0.8 + Math.random() * 1}s`;

            // Random animation delay (0-1 second)
            particle.style.animationDelay = `${Math.random() * 1}s`;

            container.appendChild(particle);
        }

        return container;
    }

    // ========================================
    // FLOOD ANIMATION - WATER SURGE
    // ========================================
    createFloodAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container flood-container';

        // All the actual visuals live inside this inner wrapper, which is
        // the ONLY element we ever scale for zoom (see getFloodScaleForCurrentZoom /
        // updateFloodAnimationScale). Mapbox's Marker sets its own transform
        // directly on `container` for positioning and re-applies it on every
        // zoom/move, which would wipe out a scale set on `container` itself -
        // keeping scale on this separate child avoids that fight entirely.
        const scaleWrapper = document.createElement('div');
        scaleWrapper.className = 'flood-scale-wrapper';
        container.appendChild(scaleWrapper);

        // Ripple rings
        const rippleCount = severity === 'Very High' ? 5 : severity === 'High' ? 4 : 3;
        for (let i = 0; i < rippleCount; i++) {
            const ripple = document.createElement('div');
            ripple.className = 'ripple-ring';
            ripple.style.left = '50%';
            ripple.style.top = '60%';
            ripple.style.transform = 'translate(-50%, -50%)';
            ripple.style.animationDelay = `${i * 0.5}s`;
            scaleWrapper.appendChild(ripple);
        }

        // Rain drops
        const rainCount = severity === 'Very High' ? 110 : severity === 'High' ? 85 : 60;
        for (let i = 0; i < rainCount; i++) {
            const drop = document.createElement('div');
            drop.className = 'rain-drop';
            drop.style.left = `${Math.random() * 100}%`;
            drop.style.height = `${8 + Math.random() * 12}px`;
            drop.style.setProperty('--windOffset', `${-5 + Math.random() * 10}px`);
            drop.style.animationDuration = `${0.4 + Math.random() * 0.3}s`;
            drop.style.animationDelay = `${Math.random() * 1.5}s`;
            scaleWrapper.appendChild(drop);
        }

        // Splashes
        for (let i = 0; i < 8; i++) {
            const splash = document.createElement('div');
            splash.className = 'splash';
            splash.style.left = `${15 + Math.random() * 70}%`;
            splash.style.animationDelay = `${Math.random() * 1}s`;
            scaleWrapper.appendChild(splash);
        }

        // Thunderstorm - lightning flashes + bolt streaks. Each bolt shares
        // its flash's exact duration/delay so they fire together, and every
        // instance gets its own randomized timing so multiple markers don't
        // flash in sync with each other.
        const lightningCount = severity === 'Very High' ? 3 : severity === 'High' ? 2 : 1;
        for (let i = 0; i < lightningCount; i++) {
            const timing = {
                duration: `${4 + Math.random() * 5}s`,
                delay: `${Math.random() * 6}s`
            };

            const flash = document.createElement('div');
            flash.className = 'storm-sky-flash';
            flash.style.animationDuration = timing.duration;
            flash.style.animationDelay = timing.delay;
            scaleWrapper.appendChild(flash);

            const bolt = document.createElement('div');
            bolt.className = 'storm-bolt';
            bolt.style.left = `${20 + Math.random() * 60}%`;
            bolt.style.animationDuration = timing.duration;
            bolt.style.animationDelay = timing.delay;
            scaleWrapper.appendChild(bolt);
        }

        return container;
    }

    // ========================================
    // EARTHQUAKE ANIMATION - SEISMIC
    // ========================================
    createEarthquakeAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container earthquake-container shake-container';

        // Seismic center
        const center = document.createElement('div');
        center.className = 'seismic-center';
        container.appendChild(center);

        // Seismic waves
        const waveCount = severity === 'Very High' ? 6 : severity === 'High' ? 5 : 4;
        for (let i = 0; i < waveCount; i++) {
            const wave = document.createElement('div');
            wave.className = 'seismic-wave-advanced';
            wave.style.animationDelay = `${i * 0.3}s`;
            container.appendChild(wave);
        }

        // Ground cracks
        const crackCount = 6;
        for (let i = 0; i < crackCount; i++) {
            const crack = document.createElement('div');
            crack.className = 'ground-crack';
            crack.style.top = `${20 + i * 12}%`;
            crack.style.left = `${10 + Math.random() * 20}%`;
            crack.style.transform = `rotate(${-10 + Math.random() * 20}deg)`;
            crack.style.animationDelay = `${i * 0.3}s`;
            container.appendChild(crack);
        }

        // Debris particles
        const debrisCount = severity === 'Very High' ? 20 : severity === 'High' ? 15 : 10;
        for (let i = 0; i < debrisCount; i++) {
            const debris = document.createElement('div');
            debris.className = 'debris-particle';
            const size = 3 + Math.random() * 8;
            debris.style.width = `${size}px`;
            debris.style.height = `${size * 0.7}px`;
            debris.style.left = `${30 + Math.random() * 40}%`;
            debris.style.top = '50%';
            debris.style.setProperty('--debrisDrift', `${-20 + Math.random() * 40}px`);
            debris.style.animationDuration = `${1 + Math.random() * 1}s`;
            debris.style.animationDelay = `${Math.random() * 2}s`;
            container.appendChild(debris);
        }

        return container;
    }

    // ========================================
    // LANDSLIDE ANIMATION - DEBRIS FLOW
    // ========================================
    createLandslideAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container landslide-container';

        // Mountain silhouette
        const mountain = document.createElement('div');
        mountain.className = 'mountain-silhouette';
        container.appendChild(mountain);

        // Dust plumes
        for (let i = 0; i < 4; i++) {
            const dust = document.createElement('div');
            dust.className = 'dust-plume';
            dust.style.width = `${50 + Math.random() * 40}px`;
            dust.style.height = `${40 + Math.random() * 30}px`;
            dust.style.left = `${20 + Math.random() * 60}%`;
            dust.style.bottom = `${15 + i * 10}%`;
            dust.style.animationDelay = `${i * 1}s`;
            container.appendChild(dust);
        }

        // Mud flow
        const mudFlow = document.createElement('div');
        mudFlow.className = 'mud-flow';
        container.appendChild(mudFlow);

        // Rock boulders
        const boulderCount = severity === 'Very High' ? 12 : severity === 'High' ? 9 : 6;
        const rockColors = [
            'linear-gradient(135deg, #8B4513 0%, #654321 50%, #4a3728 100%)',
            'linear-gradient(135deg, #6B5344 0%, #5a4535 50%, #493829 100%)',
            'linear-gradient(135deg, #7B6354 0%, #6a5445 50%, #594536 100%)'
        ];

        for (let i = 0; i < boulderCount; i++) {
            const boulder = document.createElement('div');
            boulder.className = 'rock-boulder';
            const size = 8 + Math.random() * 18;
            boulder.style.width = `${size}px`;
            boulder.style.height = `${size * 0.8}px`;
            boulder.style.left = `${25 + Math.random() * 50}%`;
            boulder.style.top = '5%';
            boulder.style.background = rockColors[Math.floor(Math.random() * rockColors.length)];
            boulder.style.animationDuration = `${2 + Math.random() * 2}s`;
            boulder.style.animationDelay = `${Math.random() * 3}s`;
            container.appendChild(boulder);
        }

        // Small debris
        for (let i = 0; i < 25; i++) {
            const debris = document.createElement('div');
            debris.className = 'small-debris';
            const size = 2 + Math.random() * 5;
            debris.style.width = `${size}px`;
            debris.style.height = `${size}px`;
            debris.style.left = `${20 + Math.random() * 60}%`;
            debris.style.top = '10%';
            debris.style.borderRadius = `${Math.random() * 50}%`;
            debris.style.animationDuration = `${1.5 + Math.random() * 2}s`;
            debris.style.animationDelay = `${Math.random() * 3}s`;
            container.appendChild(debris);
        }

        return container;
    }

    // ========================================
    // DROUGHT ANIMATION - HEAT CRACK
    // ========================================
    createDroughtAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container drought-container';

        // Dry ground
        const ground = document.createElement('div');
        ground.className = 'dry-ground';
        container.appendChild(ground);

        // Heat wave layers
        for (let i = 0; i < 4; i++) {
            const heatLayer = document.createElement('div');
            heatLayer.className = 'heat-wave-layer';
            heatLayer.style.animationDelay = `${i * 0.5}s`;
            container.appendChild(heatLayer);
        }

        // Drought cracks
        const crackCount = severity === 'Very High' ? 8 : severity === 'High' ? 6 : 4;
        for (let i = 0; i < crackCount; i++) {
            const crack = document.createElement('div');
            crack.className = 'drought-crack';
            crack.style.left = `${5 + Math.random() * 30}%`;
            crack.style.top = `${40 + Math.random() * 40}%`;
            crack.style.transform = `rotate(${-30 + Math.random() * 60}deg)`;
            crack.style.animationDelay = `${Math.random() * 2}s`;
            container.appendChild(crack);
        }

        // Heat shimmer particles
        for (let i = 0; i < 10; i++) {
            const shimmer = document.createElement('div');
            shimmer.className = 'heat-shimmer-particle';
            shimmer.style.left = `${10 + Math.random() * 80}%`;
            shimmer.style.bottom = `${30 + Math.random() * 30}%`;
            shimmer.style.animationDelay = `${Math.random() * 3}s`;
            container.appendChild(shimmer);
        }

        // Wilted plants
        for (let i = 0; i < 5; i++) {
            const plant = document.createElement('div');
            plant.className = 'wilted-plant';
            plant.style.left = `${15 + i * 18}%`;
            plant.style.bottom = '25%';
            plant.style.animationDelay = `${i * 0.5}s`;
            container.appendChild(plant);
        }

        return container;
    }

    // ========================================
    // HEATWAVE ANIMATION - INTENSE HEAT
    // ========================================
    createHeatwaveAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container heatwave-container';

        // Sun core
        const sun = document.createElement('div');
        sun.className = 'sun-core';
        container.appendChild(sun);

        // Sun rays
        const rayCount = 12;
        for (let i = 0; i < rayCount; i++) {
            const ray = document.createElement('div');
            ray.className = 'sun-ray';
            ray.style.transform = `translateX(-50%) rotate(${i * (360 / rayCount)}deg)`;
            ray.style.animationDelay = `${i * 0.15}s`;
            container.appendChild(ray);
        }

        // Heat wave bands
        const bandCount = severity === 'Very High' ? 6 : severity === 'High' ? 5 : 4;
        for (let i = 0; i < bandCount; i++) {
            const band = document.createElement('div');
            band.className = 'heat-wave-band';
            band.style.top = `${45 + i * 10}%`;
            band.style.animationDelay = `${i * 0.25}s`;
            container.appendChild(band);
        }

        // Heat shimmer particles
        for (let i = 0; i < 12; i++) {
            const shimmer = document.createElement('div');
            shimmer.className = 'heat-shimmer-particle';
            shimmer.style.left = `${10 + Math.random() * 80}%`;
            shimmer.style.bottom = `${20 + Math.random() * 30}%`;
            shimmer.style.animationDelay = `${Math.random() * 2}s`;
            container.appendChild(shimmer);
        }

        // Thermometer indicator
        const thermo = document.createElement('div');
        thermo.className = 'thermometer-indicator';
        container.appendChild(thermo);

        return container;
    }

    // ========================================
    // GLOF ANIMATION - GLACIAL BURST
    // ========================================
    createGLOFAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container glof-container';

        // Glacier mass
        const glacier = document.createElement('div');
        glacier.className = 'glacier-mass';
        container.appendChild(glacier);

        // Glacial mist
        for (let i = 0; i < 3; i++) {
            const mist = document.createElement('div');
            mist.className = 'glacial-mist';
            mist.style.width = `${60 + Math.random() * 40}px`;
            mist.style.height = `${40 + Math.random() * 30}px`;
            mist.style.left = `${10 + Math.random() * 80}%`;
            mist.style.top = `${20 + i * 20}%`;
            mist.style.animationDelay = `${i * 1.5}s`;
            container.appendChild(mist);
        }

        // Glacial burst waves
        const burstCount = severity === 'Very High' ? 5 : severity === 'High' ? 4 : 3;
        for (let i = 0; i < burstCount; i++) {
            const burst = document.createElement('div');
            burst.className = 'glacial-burst-wave';
            burst.style.animationDelay = `${i * 0.5}s`;
            container.appendChild(burst);
        }

        // Ice calving
        const iceCount = severity === 'Very High' ? 8 : severity === 'High' ? 6 : 4;
        for (let i = 0; i < iceCount; i++) {
            const ice = document.createElement('div');
            ice.className = 'ice-calving';
            const size = 8 + Math.random() * 15;
            ice.style.width = `${size}px`;
            ice.style.height = `${size}px`;
            ice.style.left = `${30 + Math.random() * 40}%`;
            ice.style.top = '25%';
            ice.style.animationDuration = `${2 + Math.random() * 2}s`;
            ice.style.animationDelay = `${Math.random() * 3}s`;
            container.appendChild(ice);
        }

        // Water torrents
        for (let i = 0; i < 4; i++) {
            const torrent = document.createElement('div');
            torrent.className = 'water-torrent';
            torrent.style.width = `${20 + Math.random() * 25}px`;
            torrent.style.height = `${35 + Math.random() * 25}px`;
            torrent.style.left = `${25 + i * 15}%`;
            torrent.style.top = '45%';
            torrent.style.animationDelay = `${i * 0.4}s`;
            container.appendChild(torrent);
        }

        return container;
    }

    // ========================================
    // COASTAL/CYCLONE ANIMATION - STORM
    // ========================================
    createCoastalAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container coastal-container';

        // Cyclone eye
        const eye = document.createElement('div');
        eye.className = 'cyclone-eye';
        container.appendChild(eye);

        // Spiral bands
        const bandCount = 5;
        for (let i = 0; i < bandCount; i++) {
            const band = document.createElement('div');
            band.className = 'spiral-band';
            const size = 50 + i * 30;
            band.style.width = `${size}px`;
            band.style.height = `${size}px`;
            band.style.animationDuration = `${2 + i * 0.5}s`;
            band.style.borderWidth = `${4 - i * 0.5}px`;
            band.style.opacity = 0.8 - i * 0.1;
            if (i % 2 === 1) band.style.animationDirection = 'reverse';
            container.appendChild(band);
        }

        // Cloud masses
        for (let i = 0; i < 6; i++) {
            const cloud = document.createElement('div');
            cloud.className = 'cloud-mass';
            cloud.style.width = `${30 + Math.random() * 25}px`;
            cloud.style.height = `${20 + Math.random() * 15}px`;
            cloud.style.left = '50%';
            cloud.style.top = '50%';
            cloud.style.animationDuration = `${3 + Math.random() * 2}s`;
            cloud.style.animationDelay = `${i * 0.5}s`;
            container.appendChild(cloud);
        }

        // Rain bands
        const rainCount = severity === 'Very High' ? 30 : severity === 'High' ? 20 : 12;
        for (let i = 0; i < rainCount; i++) {
            const rain = document.createElement('div');
            rain.className = 'rain-band';
            rain.style.left = `${Math.random() * 100}%`;
            rain.style.top = `${Math.random() * 30}%`;
            rain.style.setProperty('--rainAngle', `${-30 + Math.random() * 60}deg`);
            rain.style.animationDuration = `${0.3 + Math.random() * 0.4}s`;
            rain.style.animationDelay = `${Math.random() * 2}s`;
            container.appendChild(rain);
        }

        // Lightning
        for (let i = 0; i < 3; i++) {
            const lightning = document.createElement('div');
            lightning.className = 'lightning-flash';
            lightning.style.left = `${20 + Math.random() * 60}%`;
            lightning.style.top = `${10 + Math.random() * 30}%`;
            lightning.style.transform = `rotate(${-15 + Math.random() * 30}deg)`;
            lightning.style.animationDelay = `${i * 1.3}s`;
            container.appendChild(lightning);
        }

        // Storm surge
        const surge = document.createElement('div');
        surge.className = 'storm-surge';
        container.appendChild(surge);

        return container;
    }

    // ========================================
    // SMOG/FOG ANIMATION - ATMOSPHERIC
    // ========================================
    createSmogAnimation(severity) {
        const container = document.createElement('div');
        container.className = 'hazard-animation-container smog-container';

        // City silhouette
        const city = document.createElement('div');
        city.className = 'city-silhouette';
        container.appendChild(city);

        // Visibility indicator
        const visibility = document.createElement('div');
        visibility.className = 'visibility-indicator';
        container.appendChild(visibility);

        // Dense smog layers
        const layerCount = severity === 'Very High' ? 5 : severity === 'High' ? 4 : 3;
        for (let i = 0; i < layerCount; i++) {
            const layer = document.createElement('div');
            layer.className = 'smog-layer-dense';
            layer.style.animationDelay = `${i * 1.5}s`;
            layer.style.opacity = 0.3 + i * 0.1;
            container.appendChild(layer);
        }

        // Haze bands
        for (let i = 0; i < 4; i++) {
            const haze = document.createElement('div');
            haze.className = 'haze-band';
            haze.style.top = `${20 + i * 20}%`;
            haze.style.animationDelay = `${i * 2}s`;
            container.appendChild(haze);
        }

        // Pollution particles
        const particleCount = severity === 'Very High' ? 25 : severity === 'High' ? 18 : 12;
        const particleColors = [
            'rgba(100, 100, 100, 0.5)',
            'rgba(120, 120, 120, 0.4)',
            'rgba(80, 80, 80, 0.6)',
            'rgba(140, 130, 110, 0.4)'
        ];

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'pollution-particle';
            const size = 10 + Math.random() * 25;
            particle.style.width = `${size}px`;
            particle.style.height = `${size}px`;
            particle.style.left = `${Math.random() * 90}%`;
            particle.style.top = `${Math.random() * 70}%`;
            particle.style.background = `radial-gradient(circle, ${particleColors[Math.floor(Math.random() * particleColors.length)]}, transparent)`;
            particle.style.setProperty('--particleOpacity', `${0.3 + Math.random() * 0.4}`);
            particle.style.animationDuration = `${4 + Math.random() * 4}s`;
            particle.style.animationDelay = `${Math.random() * 3}s`;
            container.appendChild(particle);
        }

        // Smog wisps
        for (let i = 0; i < 6; i++) {
            const wisp = document.createElement('div');
            wisp.className = 'smog-wisp';
            wisp.style.width = `${40 + Math.random() * 60}px`;
            wisp.style.top = `${15 + Math.random() * 60}%`;
            wisp.style.left = '0';
            wisp.style.animationDuration = `${6 + Math.random() * 4}s`;
            wisp.style.animationDelay = `${i * 1.5}s`;
            container.appendChild(wisp);
        }

        return container;
    }

    // ========================================
    // GET ANIMATION BY HAZARD TYPE
    // ========================================
    getAnimationForHazard(hazardType, severity = 'Medium') {
        switch (hazardType) {
            case 'snow-emergencies':
                return this.createSnowAnimation(severity);
            case 'fire-emergencies':
                return this.createFireAnimation(severity);
            case 'floods':
                return this.createFloodAnimation(severity);
            case 'earthquake':
                return this.createEarthquakeAnimation(severity);
            case 'landslide-mudslide':
                return this.createLandslideAnimation(severity);
            case 'drought':
                return this.createDroughtAnimation(severity);
            case 'heatwave':
                return this.createHeatwaveAnimation(severity);
            case 'glof-emergencies':
                return this.createGLOFAnimation(severity);
            case 'coastal-emergencies':
                return this.createCoastalAnimation(severity);
            case 'smog-fog':
                return this.createSmogAnimation(severity);
            default:
                return null;
        }
    }

    // ========================================
    // ADD ANIMATION TO MARKER
    // ========================================
    addAnimationToMarker(coordinates, hazardType, markerId, severity = 'Medium') {
        const animation = this.getAnimationForHazard(hazardType, severity);
        if (!animation) return null;

        animation.setAttribute('data-marker-id', markerId);
        animation.setAttribute('data-hazard-type', hazardType);

        if (hazardType === 'floods') {
            this.applyFloodWrapperState(animation.querySelector('.flood-scale-wrapper'));
        }

        const animationMarker = new mapboxgl.Marker({
            element: animation,
            anchor: 'center'
        })
            .setLngLat(coordinates)
            .addTo(map);

        if (!this.activeAnimations.has(hazardType)) {
            this.activeAnimations.set(hazardType, []);
        }
        this.activeAnimations.get(hazardType).push(animationMarker);

        return animationMarker;
    }

    // ========================================
    // REMOVE ANIMATIONS
    // ========================================
    removeAnimations(hazardType) {
        if (this.activeAnimations.has(hazardType)) {
            this.activeAnimations.get(hazardType).forEach(marker => {
                try {
                    marker.remove();
                } catch (e) {
                    console.warn('Error removing animation marker:', e);
                }
            });
            this.activeAnimations.delete(hazardType);
        }
    }

    // ========================================
    // CLEAR ALL ANIMATIONS
    // ========================================
    clearAll() {
        this.activeAnimations.forEach((markers, hazardType) => {
            markers.forEach(marker => {
                try {
                    marker.remove();
                } catch (e) {
                    console.warn('Error removing animation marker:', e);
                }
            });
        });
        this.activeAnimations.clear();
    }
}

// Create global animation system instance
const hazardAnimationSystem = new AdvancedHazardAnimationSystem();

// ============================================
// MAP LOAD EVENT
// ============================================
map.on('load', function () {
    console.log('Map loaded!');

    map.setFog({
        color: 'rgb(186, 210, 235)',
        'high-color': 'rgb(36, 92, 223)',
        'horizon-blend': 0.02,
        'space-color': 'rgb(11, 11, 25)',
        'star-intensity': 0.6
    });

    map.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
    });

    map.setTerrain({
        'source': 'mapbox-dem',
        'exaggeration': 1.5
    });

    map.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
            'sky-type': 'atmosphere',
            'sky-atmosphere-sun': [0.0, 90.0],
            'sky-atmosphere-sun-intensity': 15
        }
    });

    console.log('3D terrain loaded');

    initRotationSystem();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeEventListeners);
    } else {
        initializeEventListeners();
    }
});

// ============================================
// HAZARD DATA
// ============================================
const hazardData = {
    'landslide-mudslide': {
        name: 'Landslide - Mudslide',
        color: '#8B4513',
        icon: 'Data/Landslide_ic.png',
        center: [72.5, 35.0],
        zoom: 6,
        locations: [
            { coordinates: [73.35192566164676, 36.412547153885995], name: 'Ghizer Landslide Zone 1', severity: 'High', video: 'Landslide/Ghizer.mp4' },
            { coordinates: [73.17179702680035, 35.48018539827308], name: 'Kohistan Landslide', severity: 'Medium', video: 'Landslide/Landslide_3d.mp4' }
        ]
    },
    'floods': {
        name: 'Floods',
        color: '#1E90FF',
        icon: 'Data/flood_ic.png',
        center: [71.5, 32.5],
        zoom: 6,
        locations: [
            { coordinates: [73.52828175488725, 36.22470621200585], name: 'Raushan Flash Flood', severity: 'Medium', video: 'Flood/22 Aug-Ghizer Mudslide.mp4' },
            { coordinates: [74.04723661119495, 35.20294777434741], name: 'Babusar Flash Flood', severity: 'Low', video: 'Flood/Babusar_3d.mp4' },
            { coordinates: [74.87386700483721, 36.32191290242334], name: 'Hunza Luxury Flood', severity: 'Low', video: 'Flood/HunzaLuxus_FlashFlood.mp4' },
            { coordinates: [74.34295930167379, 31.52876771995469], name: 'Lahore Urban Flooding', severity: 'High', video: 'Flood/Lahore_street_urbanflooding.mp4' },
            { coordinates: [70.29773685319516, 30.03491112384712], name: 'RYK Urban Flooding', severity: 'Medium', video: 'Flood/Rahimyarkhan_urbanflood_3d.mp4' },
            { coordinates: [70.13514988016226, 30.24562706530494], name: 'DG Khan Hill Torrents', severity: 'Medium', video: 'Flood/HillTorents_DG_Khan.mp4' },
            { coordinates: [68.36713342459316, 25.39563386654867], name: 'Hyderabad Urban Flooding', severity: 'High', video: 'Flood/Hyderabad Urban_Flooding.mp4' },
            { coordinates: [67.01021813080419, 24.87624878418253], name: 'Layari Urban Flooding', severity: 'Medium', video: 'Flood/KHI_Lyari_urbanflooding.mp4' },
            { coordinates: [67.30032772978964, 24.894333270363216], name: 'Malir Urban Flooding', severity: 'Medium', video: 'Flood/Malir_Karachi_urbanflooding.mp4' },
            { coordinates: [72.45160735319908, 34.60823189820504], name: 'Buner Flash Flood', severity: 'High', video: 'Flood/Buner_3d.mp4' },
            { coordinates: [71.54538013038258, 34.7524823899444], name: 'Bajaur Flash Flood', severity: 'Medium', video: 'Flood/Bajaur_flood.mp4' },
            { coordinates: [72.33427771860659, 34.79320095059022], name: 'Swat Flash Flood', severity: 'High', video: 'Flood/Swat_Flood.mp4' },
            { coordinates: [73.06689197137348, 33.74300649164909], name: 'Saidpur Flash Flood', severity: 'High', video: 'Flood/Saidpur_islamabad.mp4' }
        ]
    },
    'drought': {
        name: 'Drought',
        color: '#D2691E',
        icon: 'Data/drought_ic.png',
        center: [68.0, 28.0],
        zoom: 6,
        locations: [
            { coordinates: [72.5, 30.5], name: 'Cholistan Desert Drought', severity: 'Very High', video: 'cholistan_drought.mp4' },
            { coordinates: [73.2, 29.8], name: 'Bahawalpur Water Crisis', severity: 'High', video: 'bahawalpur_crisis.mp4' },
            { coordinates: [67.5, 28.5], name: 'Kalat Drought Zone', severity: 'Very High', video: 'kalat_drought.mp4' },
            { coordinates: [65.0, 26.5], name: 'Makran Water Crisis', severity: 'High', video: 'makran_crisis.mp4' }
        ]
    },
    'heatwave': {
        name: 'Heatwave',
        color: '#FF4500',
        icon: 'Data/heatwave_ic.png',
        center: [69.0, 28.5],
        zoom: 6,
        locations: [
            { coordinates: [74.3, 31.5], name: 'Lahore Heatwave', severity: 'Very High', video: 'lahore_heatwave.mp4' },
            { coordinates: [67.0, 24.9], name: 'Karachi Heatwave', severity: 'Very High', video: 'karachi_heatwave.mp4' },
            { coordinates: [71.5, 34.0], name: 'Peshawar Heatwave', severity: 'High', video: 'peshawar_heatwave.mp4' }
        ]
    },
    'glof-emergencies': {
        name: 'GLOF Emergencies',
        color: '#4169E1',
        icon: 'Data/glof_ic.png',
        center: [73.5, 36.0],
        zoom: 7,
        locations: [
            { coordinates: [72.11880467489789, 36.147947458506087], name: 'Reshun GLOF', severity: 'High', video: 'GLOF/Reshun_Flood.mp4' },
            { coordinates: [72.28363389958969, 36.21408743926792], name: 'Booni GLOF', severity: 'High', video: 'GLOF/August 3, 2024_Booni GLOF.mp4' },
            { coordinates: [73.4052391031364, 36.64246296569065], name: 'Darkut GLOF', severity: 'Very High', video: 'GLOF/Darkut_GLOF.mp4' },
            { coordinates: [74.03376210532332, 36.54624108589972], name: 'Badswat GLOF', severity: 'High', video: 'GLOF/Badswat.mp4' }
        ]
    },
    'fire-emergencies': {
        name: 'Fire Emergencies',
        color: '#FF4500',
        icon: 'Data/fires_ic.png',
        center: [72.0, 33.5],
        zoom: 6,
        locations: [
            { coordinates: [69.95599222803293, 31.646982820270797], name: 'Sherani Forest Fire', severity: 'Very High', video: 'Forest Fire/Sherani_Fire.mp4' },
            { coordinates: [72.58809825036177, 34.880270827505186], name: 'Shangalla Forest Fire', severity: 'Medium', video: 'Forest Fire/Shangala_Fire.mp4' },
            { coordinates: [73.31067132781433, 34.53550439235305], name: 'Balakot Forest Fire', severity: 'High', video: 'Forest Fire/Balakot_Fire.mp4' },
            { coordinates: [72.99913085497427, 33.74084541275694], name: 'Margalla Hills Forest Fire', severity: 'High', video: 'Forest Fire/Margalla_Fire.mp4' }
        ]
    },
    'coastal-emergencies': {
        name: 'Coastal Emergencies',
        color: '#20B2AA',
        icon: 'Data/coastal_ic.png',
        center: [66.5, 25.0],
        zoom: 7,
        locations: [
            { coordinates: [65.64741850084113, 24.942904854738256], name: 'Cyclone Emergency', severity: 'Very High', video: 'Coastal Emergencies/cyclone.mp4' }
        ]
    },
    'earthquake': {
        name: 'Earthquake',
        color: '#8B4513',
        icon: 'Data/earthquake_ic.png',
        center: [73.0, 33.5],
        zoom: 6,
        locations: [
            { coordinates: [73.19654280792423, 33.4951625936039], name: 'Rawat Earthquake', severity: 'Very High', video: 'Earthquake/Rawat_earthquake.mp4' },
            { coordinates: [73.47670057251736, 34.408093032177256], name: 'Muzaffarabad Earthquake', severity: 'Very High', video: 'Earthquake/Earthquake_Muzaffarabd.mp4' }
        ]
    },
    'snow-emergencies': {
        name: 'Snow Emergencies',
        color: '#00BFFF',
        icon: 'Data/snow_emg.png',
        center: [73.5, 34.0],
        zoom: 7,
        locations: [
            { coordinates: [73.39428012569786, 33.903310955378565], name: 'Murree Snow Emergency', severity: 'Very High', video: 'Snow Emergencies/Murree_full.mp4' }
        ]
    },
    'smog-fog': {
        name: 'Smog/Fog',
        color: '#708090',
        icon: 'Data/smog_ic.png',
        center: [74.0, 31.5],
        zoom: 7,
        locations: [
            { coordinates: [74.3, 31.5], name: 'Lahore Smog', severity: 'Very High', video: 'smog_lahore.mp4' },
            { coordinates: [73.1, 31.4], name: 'Faisalabad Fog', severity: 'High', video: 'fog_faisalabad.mp4' }
        ]
    }
};

// ============================================
// MARKERS AND LABELS
// ============================================
const activeMarkers = [];
const activeLabels = [];
const activeAnimationMarkers = [];
const visibleHazards = new Map();

function createMarker(location, hazardType, hazardInfo) {
    var iconSize = 35;
    switch (location.severity) {
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

    var img = document.createElement('img');
    img.src = hazardInfo.icon;
    img.alt = hazardInfo.name;
    img.className = 'hazard-marker-icon';
    img.style.cssText = 'width:' + iconSize + 'px;height:' + iconSize + 'px;cursor:pointer;display:block;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6));object-fit:contain;';

    // Simple popup content - NO ANIMATIONS
    var popupContent = '<div style="width:450px;font-family:Segoe UI,sans-serif;background:#0f172a;border:1px solid #334155;border-radius:12px;overflow:hidden;">' +
        '<div style="padding:20px;background:' + hazardInfo.color + '20;border-bottom:1px solid ' + hazardInfo.color + '40;">' +
        '<div style="display:flex;align-items:center;gap:12px;">' +
        '<img src="' + hazardInfo.icon + '" alt="' + hazardInfo.name + '" style="width:40px;height:40px;">' +
        '<div>' +
        '<h3 style="margin:0;color:#f8fafc;font-size:20px;font-weight:700;">' + hazardInfo.name + '</h3>' +
        '<p style="margin:4px 0 0 0;color:#94a3b8;font-size:12px;">Hazard Alert</p>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div style="padding:20px;">' +
        '<div style="display:flex;gap:12px;margin-bottom:20px;">' +
        '<div style="flex:1;padding:15px;background:#1e293b;border-radius:8px;">' +
        '<p style="margin:0 0 8px 0;color:#64748b;font-size:11px;text-transform:uppercase;">Location</p>' +
        '<p style="margin:0;color:#e2e8f0;font-size:14px;font-weight:600;">' + location.name + '</p>' +
        '</div>' +
        '<div style="flex:1;padding:15px;background:#1e293b;border-radius:8px;">' +
        '<p style="margin:0 0 8px 0;color:#64748b;font-size:11px;text-transform:uppercase;">Severity</p>' +
        '<p style="margin:0;color:' + getSeverityColor(location.severity) + ';font-size:14px;font-weight:700;">' + (location.severity || 'Unknown') + '</p>' +
        '</div>' +
        '</div>' +
        '<div style="background:#1e293b;border-radius:8px;padding:15px;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
        '<p style="margin:0;color:#e2e8f0;font-size:13px;font-weight:600;">Video Feed</p>' +
        '<span style="color:#ef4444;font-size:11px;font-weight:600;">● LIVE</span>' +
        '</div>' +
        '<video width="100%" height="250" controls style="display:block;background:#000;border-radius:6px;">' +
        '<source src="' + location.video + '" type="video/mp4">' +
        '<p style="color:#94a3b8;padding:20px;text-align:center;">Video not supported</p>' +
        '</video>' +
        '</div>' +
        '</div>' +
        '</div>';

    var popup = new mapboxgl.Popup({
        offset: 25,
        maxWidth: '480px',
        closeButton: true,
        closeOnClick: false
    }).setHTML(popupContent);

    var marker = new mapboxgl.Marker({
        element: img,
        anchor: 'center'
    })
        .setLngLat(location.coordinates)
        .setPopup(popup)
        .addTo(map);

    return marker;
}

function createLabel(location, hazardInfo) {
    const labelDiv = document.createElement('div');
    labelDiv.className = 'marker-label';
    labelDiv.innerHTML = location.name;
    labelDiv.style.cssText = `
        color: white;
        padding: 10px 8px;
        font-size: 22px;
        font-family: Arial, sans-serif;
        white-space: nowrap;
        pointer-events: none;
        font-weight: 500;
        line-height: 1.2;
        text-shadow: 
            2px 2px 4px rgba(0, 0, 0, 0.7),
            -2px -2px 4px rgba(0, 0, 0, 0.7),
            2px -2px 4px rgba(0, 0, 0, 0.7),
            -2px 2px 4px rgba(0, 0, 0, 0.7);
        background: none;
        border: none;
        box-shadow: none;
    `;
    const labelCoords = [location.coordinates[0], location.coordinates[1] + 0.008];
    const labelMarker = new mapboxgl.Marker({
        element: labelDiv,
        anchor: 'top'
    })
        .setLngLat(labelCoords)
        .addTo(map);

    return labelMarker;
}

function getSeverityColor(severity) {
    switch (severity) {
        case 'Very High': return '#dc2626';
        case 'High': return '#ea580c';
        case 'Medium': return '#d97706';
        case 'Low': return '#16a34a';
        default: return '#6b7280';
    }
}

// ============================================
// HAZARD CONTROL FUNCTIONS
// ============================================

function handleHazardClick(hazardType) {
    console.log('Hazard clicked:', hazardType);

    if (spinEnabled) {
        userInteracting = true;
    }

    if (visibleHazards.has(hazardType)) {
        hideHazard(hazardType);
        visibleHazards.delete(hazardType);

        var buttonElement = document.querySelector('.hazard-section[data-hazard="' + hazardType + '"]');
        if (buttonElement) {
            buttonElement.classList.remove('active');
        }
    } else {
        showHazard(hazardType);
        visibleHazards.set(hazardType, true);

        var buttonElement = document.querySelector('.hazard-section[data-hazard="' + hazardType + '"]');
        if (buttonElement) {
            buttonElement.classList.add('active');
        }

        var hazardInfo = hazardData[hazardType];
        if (hazardInfo) {
            map.flyTo({
                center: hazardInfo.center,
                zoom: hazardInfo.zoom,
                duration: window.mapCameraDuration
            });
        }
    }

    if (spinEnabled) {
        setTimeout(function () {
            userInteracting = false;
        }, 3000);
    }
}

function showHazard(hazardType) {
    var hazardInfo = hazardData[hazardType];

    if (!hazardInfo || !hazardInfo.locations) return;

    hazardInfo.locations.forEach(function (location, index) {
        // Create marker
        var marker = createMarker(location, hazardType, hazardInfo);
        marker._hazardType = hazardType;
        activeMarkers.push(marker);

        // Create label
        var label = createLabel(location, hazardInfo);
        label._hazardType = hazardType;
        activeLabels.push(label);

        // Create animation for this location
        var markerId = hazardType + '-' + index;
        var animMarker = hazardAnimationSystem.addAnimationToMarker(
            location.coordinates,
            hazardType,
            markerId
        );
        if (animMarker) {
            animMarker._hazardType = hazardType;
            activeAnimationMarkers.push(animMarker);
        }
    });
}

function hideHazard(hazardType) {
    // Remove markers
    for (var i = activeMarkers.length - 1; i >= 0; i--) {
        if (activeMarkers[i]._hazardType === hazardType) {
            activeMarkers[i].remove();
            activeMarkers.splice(i, 1);
        }
    }

    // Remove labels
    for (var i = activeLabels.length - 1; i >= 0; i--) {
        if (activeLabels[i]._hazardType === hazardType) {
            activeLabels[i].remove();
            activeLabels.splice(i, 1);
        }
    }

    // Remove animations
    for (var i = activeAnimationMarkers.length - 1; i >= 0; i--) {
        if (activeAnimationMarkers[i]._hazardType === hazardType) {
            activeAnimationMarkers[i].remove();
            activeAnimationMarkers.splice(i, 1);
        }
    }
    hazardAnimationSystem.removeAnimations(hazardType);
}

function clearAllMarkers() {
    activeMarkers.forEach(function (marker) {
        try {
            marker.remove();
        } catch (e) {
            console.warn('Error removing marker:', e);
        }
    });

    activeLabels.forEach(function (label) {
        try {
            label.remove();
        } catch (e) {
            console.warn('Error removing label:', e);
        }
    });

    activeAnimationMarkers.forEach(function (animMarker) {
        try {
            animMarker.remove();
        } catch (e) {
            console.warn('Error removing animation marker:', e);
        }
    });

    activeMarkers.length = 0;
    activeLabels.length = 0;
    activeAnimationMarkers.length = 0;
    visibleHazards.clear();
    hazardAnimationSystem.clearAll();

    document.querySelectorAll('.hazard-section').forEach(function (section) {
        section.classList.remove('active');
    });
}

function resetView() {
    if (spinEnabled) {
        userInteracting = true;
    }

    map.flyTo({
        center: [69.3451, 30.3753],
        zoom: 5.5,
        duration: window.mapCameraDuration
    });

    if (spinEnabled) {
        setTimeout(function () {
            userInteracting = false;
        }, 2500);
    }
}

function initializeEventListeners() {
    document.querySelectorAll('.hazard-section').forEach(function (section) {
        var hazardHeader = section.querySelector('.hazard-header');
        var hazardType = section.getAttribute('data-hazard');

        var specialSections = ['simex-emergencies', 'hazard-calendars', 'general-videos', 'boundaries'];

        if (hazardHeader && hazardType && specialSections.indexOf(hazardType) === -1) {
            hazardHeader.addEventListener('click', function (e) {
                e.stopPropagation();
                handleHazardClick(hazardType);
            });
        }
    });

    console.log('Hazard event listeners initialized');
}


// ============================================
// GENERAL CSS STYLES
// ============================================
const generalStyles = document.createElement('style');
generalStyles.textContent = `
    .hazard-marker-icon {
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        pointer-events: auto !important;
        -webkit-user-drag: none;
        user-drag: none;
        image-rendering: -webkit-optimize-contrast;
        image-rendering: crisp-edges;
        position: relative;
        z-index: 10;
    }
    
    .marker-label {
        user-select: none;
        pointer-events: none;
        z-index: 5;
    }
    
    .mapboxgl-popup-content {
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        padding: 0;
        background: transparent;
    }
    
    .mapboxgl-popup-close-button {
        font-size: 24px;
        padding: 8px;
        width: 36px;
        height: 36px;
        color: #94a3b8;
        transition: all 0.2s;
        z-index: 10;
    }
    
    .mapboxgl-popup-close-button:hover {
        color: #f8fafc;
        background: rgba(239, 68, 68, 0.3);
        border-radius: 50%;
    }

    .hazard-section.active .hazard-header {
        box-shadow: 0 0 20px rgba(0, 255, 255, 0.4);
        border-left: 4px solid #00ffff;
    }

    .hazard-section.active .chevron-icon {
        transform: rotate(180deg);
        color: #00ffff;
    }

    .mapboxgl-marker {
        z-index: 2 !important;
    }
    
    /* Ensure animation containers are behind icons */
    .hazard-animation-container {
        z-index: 1 !important;
    }
    
    @keyframes livePulse {
        0%, 100% { 
            opacity: 1;
            transform: scale(1);
        }
        50% { 
            opacity: 0.5;
            transform: scale(1.3);
        }
    }
`;
document.head.appendChild(generalStyles);

// ============================================
// EXPORT FOR EXTERNAL USE
// ============================================
window.mapInstance = map;
window.hazardData = hazardData;
window.activeMarkers = activeMarkers;
window.activeLabels = activeLabels;
window.activeAnimationMarkers = activeAnimationMarkers;
window.basemapStyles = basemapStyles;
window.clearAllMarkers = clearAllMarkers;
window.resetView = resetView;
window.handleHazardClick = handleHazardClick;
window.startRotation = startRotation;
window.stopRotation = stopRotation;
window.toggleRotation = toggleRotation;
window.setRotationSpeed = setRotationSpeed;
window.isGlobeRotating = function () { return isRotating; };
window.hazardAnimationSystem = hazardAnimationSystem;

// Exposed for the AI assistant's guided hazard tour (shows one location at
// a time with its popup instead of dumping every marker at once).
window.showHazard = showHazard;
window.hideHazard = hideHazard;
window.visibleHazards = visibleHazards;