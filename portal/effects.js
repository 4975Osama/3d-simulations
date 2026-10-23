/* ============================================================
   Disaster-simulation FX layer — ported from the user's original
   'mapinit.js' (AdvancedHazardAnimationSystem + hazardData) and
   adapted from Mapbox GL to MapLibre GL. Marker API is identical.
   Data: 10 hazard categories at real Pakistan sites (severity-tuned).
   ============================================================ */
let map, mapboxgl;   // resolved in initFX() — effects.js must not bind them at
// module top: app.js pauses on its top-level data await, so later module
// scripts can evaluate BEFORE window.map exists.

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

        // The rain itself falls in 3D from a storm cloud over the site
        // (storm3d.js, registered in addAnimationToMarker) instead of as flat
        // screen streaks; this marker keeps the ground effects.

        // Splashes
        for (let i = 0; i < 8; i++) {
            const splash = document.createElement('div');
            splash.className = 'splash';
            splash.style.left = `${15 + Math.random() * 70}%`;
            splash.style.animationDelay = `${Math.random() * 1}s`;
            scaleWrapper.appendChild(splash);
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
            // rain + lightning: a 3D storm cell above the site
            window.storm3d?.addCell({ id: markerId, lngLat: coordinates, severity });
        }

        const animationMarker = new window.mapboxgl.Marker({
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
            if (hazardType === 'floods') window.storm3d?.clearCells();
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
        window.storm3d?.clearCells();
    }
}

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


/* resolve map + wire everything once the app has finished booting */
function initFX() {
// map / mapboxgl aliases for the ported class body above
  map = window.map; mapboxgl = window.mapboxgl;
/* ============================================================
   Portal integration: instantiates the ported system
   (runs inside initFX — after app boot)
 and wires it
   into the dashboard's "Disaster simulations" + "Boundaries" panels.
   ============================================================ */
const hazardFX = new AdvancedHazardAnimationSystem();
window.hazardFX = hazardFX;
window.hazardData = hazardData;

/* two-letter incident codes (render identically on every OS — no font
   dependencies the way emoji chips have; coloured by severity ring) */
const HAZ_ICONS = {
  'floods': 'FL', 'fire-emergencies': 'FF', 'snow-emergencies': 'SN',
  'landslide-mudslide': 'LS', 'drought': 'DR', 'heatwave': 'HW',
  'glof-emergencies': 'GF', 'coastal-emergencies': 'CS', 'earthquake': 'EQ', 'smog-fog': 'SM',
};
const SEV_COLOR = { 'very high': '#ff3b4e', high: '#ff6a00', medium: '#ffb020', low: '#35d07f' };
const SEV_SIZE = { 'very high': 50, high: 42, medium: 36, low: 30 };
const sim = { icons: [], placing: false, shown: [] };

/* icon + name label, structured like the original app's createMarkerElement()
   in legacy/maplayers.js: the container carries the severity-based size and
   the image fills it. Severity sizes match the original (50/42/36/30). On the
   fallback path only (image missing/slow) a coloured ring + two-letter code
   is drawn instead, matching the fallback contract used elsewhere here. */
function iconChip(hazard, severity, name) {
  const size = SEV_SIZE[(severity || 'medium').toLowerCase()] || 36;
  const c = SEV_COLOR[(severity || 'medium').toLowerCase()] || '#888';
  const el = document.createElement('div');
  el.className = 'haz-marker-wrap';
  el.style.cssText = `width:${size}px;height:${size}px;`;

  const iconUrl = window.HAZ_ICON_IMG && window.HAZ_ICON_IMG[hazard];
  if (iconUrl) {
    const img = document.createElement('img');
    img.src = iconUrl;
    img.alt = '';
    img.onerror = () => { img.remove(); el.insertBefore(textFallback(hazard, size, c), el.firstChild); };
    el.appendChild(img);
  } else {
    el.appendChild(textFallback(hazard, size, c));
  }
  if (name) {
    const label = document.createElement('div');
    label.className = 'haz-label';
    label.textContent = name;
    el.appendChild(label);
  }
  return el;
}
function textFallback(hazard, size, color) {
  const t = document.createElement('div');
  t.style.cssText = `width:${size}px;height:${size}px;border:2px solid ${color};background:#fff;
    border-radius:50%;display:grid;place-items:center;box-shadow:0 2px 10px rgba(0,0,0,.55), 0 0 14px ${color}55;
    font:700 ${Math.round(size * .36)}px/1 ui-sans-serif,system-ui;color:${color};`;
  t.textContent = HAZ_ICONS[hazard] || 'EV';
  return t;
}

function popupHTML(hazard, loc) {
  const c = SEV_COLOR[(loc.severity || 'medium').toLowerCase()] || '#888';
  const info = hazardData[hazard];
  const iconUrl = window.HAZ_ICON_IMG && window.HAZ_ICON_IMG[hazard];
  const headIcon = iconUrl
    ? `<img src="${iconUrl}" alt="" onerror="this.remove();this.parentElement.textContent='${HAZ_ICONS[hazard] || 'EV'}'" />`
    : (HAZ_ICONS[hazard] || 'EV');
  const feedIcon = iconUrl ? `<img src="${iconUrl}" alt="" onerror="this.remove()" />` : '';
  return `<div class="hazpopup">
    <div class="hazpopup-head">
      <div class="hazpopup-icon">${headIcon}</div>
      <div><div class="hazpopup-title">${info.name}</div><div class="hazpopup-sub">Hazard Alert</div></div>
    </div>
    <div class="hazpopup-grid">
      <div class="hazpopup-stat"><div class="hazpopup-lbl">Location</div><div class="hazpopup-val">${loc.name}</div></div>
      <div class="hazpopup-stat"><div class="hazpopup-lbl">Severity</div><div class="hazpopup-val" style="color:${c}">${loc.severity}</div></div>
    </div>
    <div class="hazpopup-feedhead"><span>Video Feed</span><button type="button" class="hazpopup-up" data-up>Upload</button><span class="hazpopup-live">LIVE</span></div>
    <div class="hazpopup-feed" style="background:linear-gradient(135deg, ${c}55, ${c}1a 65%, #0b1430)">
      ${feedIcon}
      <div class="hazpopup-feedcap">${loc.coordinates[0].toFixed(3)}°E · ${loc.coordinates[1].toFixed(3)}°N</div>
    </div>
  </div>`;
}



/* ---- the popup's video feed: each site can carry one uploaded video
   (stored by the portal server in Neon; videos.js does the upload). It shows
   as a still with a play button and streams only when clicked, to keep the
   storage's monthly traffic allowance for real viewing. */
const siteKey = (hazard, loc) => `${hazard}:${loc.coordinates[0].toFixed(4)},${loc.coordinates[1].toFixed(4)}`;
const escHTML = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function fillFeed(popup, hazard, loc) {
  const root = popup.getElement(), pv = window.portalVideos;
  if (!root || !pv) return;
  const feed = root.querySelector('.hazpopup-feed'), badge = root.querySelector('.hazpopup-live'), up = root.querySelector('[data-up]');
  const key = siteKey(hazard, loc);
  up.onclick = async () => {
    const title = `${hazardData[hazard].name} · ${loc.name}`;
    const video = await pv.uploadSiteVideo(key, title, loc.name);
    if (video && popup.isOpen()) fillFeed(popup, hazard, loc);
  };
  const v = (await pv.siteVideos())[key];
  if (!popup.isOpen() || feed.dataset.video === (v && v.id)) return;
  up.textContent = v ? 'Replace' : 'Upload';
  if (!v) return;                                     // no video yet: keep the illustration
  feed.dataset.video = v.id;
  badge.textContent = 'VIDEO';
  badge.classList.add('rec');
  const date = new Date(v.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const cap = `<div class="hazpopup-feedcap">${escHTML(v.title)} · ${date}</div>`;
  feed.innerHTML = (v.thumbnail ? `<img class="hazpopup-thumb" src="${escHTML(v.thumbnail)}" alt="" />` : '')
    + `<button type="button" class="hazpopup-play" title="Play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>` + cap;
  feed.querySelector('.hazpopup-play').onclick = () => { feed.innerHTML = pv.playerHTML(v); };
}

function dropHazard(hazard, loc, custom) {
  const el = iconChip(hazard, loc.severity, loc.name);
  // anchor 'center' pins the icon's centre to the coordinate so it stays put
  // through zoom; opacityWhenCovered:1 stops MapLibre fading markers it thinks
  // the 3D terrain mesh occludes (which washed out sites in valleys/on water)
  const marker = new window.mapboxgl.Marker({ element: el, anchor: 'center', opacityWhenCovered: '1' })
    .setLngLat(loc.coordinates).addTo(map);
  const popup = new window.mapboxgl.Popup({ offset: 18, closeButton: true, maxWidth: '260px' })
    .setHTML(popupHTML(hazard, loc));
  popup.on('open', () => fillFeed(popup, hazard, loc));
  marker.setPopup(popup);
  /* MapLibre's own marker→popup toggle starts with
       if (this._element.style.opacity === this._opacityWhenCovered) return this;
     i.e. it ignores clicks on any marker it considers occluded. Because we force
     opacityWhenCovered:'1' above (so terrain never fades these icons out), that
     test is always true and the built-in toggle never fires. Open the popup
     ourselves; stopPropagation keeps the same click from reaching the map, whose
     closeOnClick handler would otherwise shut it again immediately. */
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popup.isOpen()) popup.remove();
    else popup.setLngLat(loc.coordinates).addTo(map);
  });
  sim.icons.push(marker);
  hazardFX.addAnimationToMarker(loc.coordinates, hazard,
    (custom ? 'custom-' : 'pre-') + sim.icons.length, loc.severity);
}

function showHazard(hazard) {
  const info = hazardData[hazard];
  if (!info || sim.shown.includes(hazard)) return;
  sim.shown.push(hazard);
  info.locations.forEach((loc) => dropHazard(hazard, loc, false));
  refreshCount();
}
function clearAll() {
  sim.icons.forEach((m) => { try { m.remove(); } catch (_) { /* wg */ } });
  sim.icons = []; sim.shown = [];
  hazardFX.clearAll();
  refreshCount();
}
function refreshCount() {
  const el = document.getElementById('hazcount');
  if (el) el.textContent = sim.shown.length ? `${sim.shown.length} active · ${sim.icons.length} sites` : 'idle';
}

/* ------------------------------------------------ panel wiring */
{
  const sel = document.getElementById('hazsel');
  Object.keys(hazardData).forEach((k) => {
    const o = document.createElement('option');
    o.value = k; o.textContent = `[${HAZ_ICONS[k] || 'EV'}]  ${hazardData[k].name}`;
    sel.appendChild(o);
  });
  sel.value = 'floods';
  document.getElementById('haz-show').addEventListener('click', () => showHazard(sel.value));
  document.getElementById('haz-fly').addEventListener('click', () => {
    const i = hazardData[sel.value];
    map.flyTo({ center: i.center, zoom: i.zoom, pitch: Math.max(28, map.getPitch()), duration: 2200, essential: true });
  });
  document.getElementById('haz-place').addEventListener('click', (e) => {
    sim.placing = !sim.placing;
    e.target.classList.toggle('on', sim.placing);
    map.getCanvasContainer().style.cursor = sim.placing ? 'crosshair' : '';
  });
  document.getElementById('haz-clear').addEventListener('click', clearAll);
  map.on('click', (e) => {
    if (!sim.placing) return;
    sim.placing = false;
    document.getElementById('haz-place').classList.remove('on');
    map.getCanvasContainer().style.cursor = '';
    dropHazard(sel.value, { coordinates: [e.lngLat.lng, e.lngLat.lat], name: 'Custom point', severity: 'Very High' }, true);
    refreshCount();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sim.placing) {
      sim.placing = false;
      document.getElementById('haz-place').classList.remove('on');
      map.getCanvasContainer().style.cursor = '';
    }
  });
}

/* ============================================================
   Boundary overlays — same data contract as the user's
   boundaries.js ('geojson/Provincial.geojson' + 'geojson/District.geojson').
   Provincial ships with the portal (Natural Earth); drop the district
   file into portal/geojson/ to light up its toggle.
   ============================================================ */
const bdy = { pro: false, dis: false };

/* Each province gets its own translucent wash (matched to the portal's dashboard
   palette) with a warm outline, so the provincial overlay reads as a political
   map rather than a single flat tint. Keys are the 'name' values in
   geojson/Provincial.geojson; anything unlisted falls back to the layer colour. */
const PROV_FILL = ['match', ['get', 'name'],
  'Northern Areas', '#38bdf8',
  'K.P.', '#34d399',
  'F.A.T.A.', '#a3e635',
  'Punjab', '#facc15',
  'Baluchistan', '#a78bfa',
  'Sind', '#f472b6',
  'Azad Kashmir', '#22d3ee',
  'F.C.T.', '#fb923c',
  '#38bdf8'];

function bdyLayer(id, url, lineColor, label) {
  const isPro = id === 'prov';
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    return r.json();
  }).then((gj) => {
    if (!map.getSource(id + '-src')) {
      map.addSource(id + '-src', { type: 'geojson', data: gj });
      map.addLayer({ id: id + '-fill', type: 'fill', source: id + '-src',
        paint: { 'fill-color': isPro ? PROV_FILL : lineColor, 'fill-opacity': isPro ? 0.26 : 0.05 } });
      map.addLayer({ id: id + '-line', type: 'line', source: id + '-src',
        paint: isPro
          ? { 'line-color': '#fde047', 'line-width': 1.8, 'line-opacity': 0.95 }
          : { 'line-color': lineColor, 'line-width': 1.6, 'line-opacity': 0.9 } });
    }
    map.setLayoutProperty(id + '-fill', 'visibility', 'visible');
    map.setLayoutProperty(id + '-line', 'visibility', 'visible');
    document.getElementById('bdy-state').textContent = label + ' shown';
  }).catch((err) => {
    document.getElementById('bdy-state').textContent =
      'District data missing — drop District.geojson into portal/geojson/';
    console.warn('[boundaries]', err.message);
    const b = document.getElementById('bdy-dis'); b.classList.remove('on');
    bdy.dis = false;
  });
}

function toggleBdy(which) {
  const on = !bdy[which];
  bdy[which] = on;
  document.getElementById('bdy-' + which).classList.toggle('on', on);
  const id = which === 'pro' ? 'prov' : 'dist';
  if (on) {
    if (which === 'pro') bdyLayer(id, './geojson/Provincial.geojson', '#38b6ff', 'Provincial boundaries');
    else bdyLayer(id, './geojson/District.geojson', '#a78bfa', 'District boundaries');
  } else if (map.getLayer(id + '-line')) {
    ['-fill', '-line', '-lbl'].forEach((s) => {
      if (map.getLayer(id + s)) map.setLayoutProperty(id + s, 'visibility', 'none');
    });
  }
}
document.getElementById('bdy-pro').addEventListener('click', () => toggleBdy('pro'));
document.getElementById('bdy-dis').addEventListener('click', () => toggleBdy('dis'));

}

/* note: id-adorned elements alias onto window (window.map === the #map div,
   window.tour === the #tour button) until app.js assigns the real engine
   objects — so the readiness test must be type-based, not truthy-based */
const fxReady = () => (window.map instanceof window.mapboxgl.Map)
  && typeof window.tour?.start === 'function';
if (fxReady()) initFX();
else {
  const _t = setInterval(() => { if (fxReady()) { clearInterval(_t); initFX(); } }, 120);
}
