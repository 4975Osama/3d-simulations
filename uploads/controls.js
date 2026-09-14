// ============================================
// CONTROLS.JS - UNIFIED VIDEO PANEL SYSTEM
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('%c🗺️ 3D Simulations Map', 'font-size: 20px; color: #00ffff; font-weight: bold;');
    
    // Initialize all systems
    initializeControls();
    initializeIconNav();
    initializeMapToolbar();
    initializeVideoPanelSystem();
    initializeKeyboardShortcuts();
    initializeAddVideoFeature();
    
    console.log('%c✓ All systems initialized', 'font-size: 14px; color: #4CAF50;');
});

// ============================================
// GLOBAL STATE TRACKING
// ============================================

let activePanel = null;
let activeModal = null;
let activeHazardSection = null;

// ============================================
// MAIN CONTROLS INITIALIZATION
// ============================================

function initializeControls() {
    // Handle hazard section dropdowns
    const hazardSections = document.querySelectorAll('.hazard-section');
    hazardSections.forEach(section => {
        const header = section.querySelector('.hazard-header');
        if (header) {
            header.addEventListener('click', (e) => {
                // Don't toggle if clicking on a trigger button
                if (header.id === 'simexTrigger' || 
                    header.id === 'hazardCalendarsTrigger' || 
                    header.id === 'generalVideosTrigger') {
                    return;
                }
                
                // Close other sections first
                hazardSections.forEach(otherSection => {
                    if (otherSection !== section && otherSection.classList.contains('active')) {
                        otherSection.classList.remove('active');
                    }
                });
                
                // Toggle current section
                section.classList.toggle('active');
                
                // Track active section
                activeHazardSection = section.classList.contains('active') ? section : null;
            });
        }
    });

    // Handle province/boundary item clicks
    const provinceItems = document.querySelectorAll('.province-item');
    provinceItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            
            const boundary = item.getAttribute('data-boundary');
            
            if (boundary) {
                // Toggle boundary layer
                toggleBoundaryLayer(boundary);
                item.classList.toggle('active');
            }
        });
    });

    // Tech-EW toggle
    const techEWHeader = document.getElementById('techEWHeader');
    const techEWSection = document.getElementById('techEWSection');
    if (techEWHeader && techEWSection) {
        techEWHeader.addEventListener('click', () => {
            techEWSection.classList.toggle('active');
        });
    }

    // Initialize basemap selector
    initializeBasemapSelector();

    // Mobile menu toggle
    initializeMobileMenu();

    // Close panels when clicking outside
    initializeOutsideClickHandler();
}

// ============================================
// ICON NAVIGATION (Tech-EW / Boundaries pill buttons)
// ============================================

function initializeIconNav() {
    const overlayMenu = document.getElementById('overlayMenu');
    const navButtons = document.querySelectorAll('.icon-nav-btn');
    if (!overlayMenu || !navButtons.length) return;

    const sectionForButton = {
        navTechEW: document.getElementById('techEWSection'),
        navBoundaries: document.getElementById('boundariesSection')
    };

    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const wasActive = button.classList.contains('active');

            // Reset every button and hide every section
            navButtons.forEach(btn => btn.classList.remove('active'));
            Object.values(sectionForButton).forEach(section => {
                if (section) {
                    section.classList.add('nav-hidden');
                    section.classList.remove('active');
                }
            });

            if (wasActive) {
                // Clicking the already-open button closes the menu bar
                overlayMenu.classList.remove('panel-open');
                return;
            }

            // Open the menu bar showing only this button's section
            button.classList.add('active');
            overlayMenu.classList.add('panel-open');

            const section = sectionForButton[button.id];
            if (section) {
                section.classList.remove('nav-hidden');
                section.classList.add('active');
            }
        });
    });
}

// ============================================
// MAP CONTROL TOOLBAR (2D/3D, layers, rotate, speed, reset, fullscreen)
// ============================================

function initializeMapToolbar() {
    const toolbar = document.getElementById('mapToolbar');
    if (!toolbar) return;

    // --- 2D / 3D view toggle ---
    const view2DBtn = document.getElementById('view2DBtn');
    const view3DBtn = document.getElementById('view3DBtn');

    function setView(is3D) {
        if (!window.mapInstance) return;
        window.mapInstance.easeTo({
            pitch: is3D ? 60 : 0,
            duration: window.mapCameraDuration || 2000
        });
        if (view2DBtn) view2DBtn.classList.toggle('active', !is3D);
        if (view3DBtn) view3DBtn.classList.toggle('active', is3D);
    }

    if (view2DBtn) view2DBtn.addEventListener('click', () => setView(false));
    if (view3DBtn) view3DBtn.addEventListener('click', () => setView(true));

    // --- Layers: opens the Tech-EW hazard list in the icon-nav panel ---
    const layersBtn = document.getElementById('toolbarLayersBtn');
    const navTechEW = document.getElementById('navTechEW');
    if (layersBtn && navTechEW) {
        layersBtn.addEventListener('click', () => {
            navTechEW.click();
            layersBtn.classList.toggle('active', navTechEW.classList.contains('active'));
        });
    }

    // --- Rotate: toggles the existing globe auto-rotation system ---
    const rotateBtn = document.getElementById('toolbarRotateBtn');
    if (rotateBtn) {
        rotateBtn.addEventListener('click', () => {
            if (typeof window.toggleRotation === 'function') {
                window.toggleRotation();
            }
            const spinning = typeof window.isGlobeRotating === 'function' && window.isGlobeRotating();
            rotateBtn.classList.toggle('active', spinning);
        });
    }

    // --- Speed: cycles the camera flyTo/easeTo animation duration ---
    const speedBtn = document.getElementById('toolbarSpeedBtn');
    const speedBadge = document.getElementById('speedBadge');
    const speedPresets = [
        { label: '0.5x', duration: 3500 },
        { label: '1x', duration: 2000 },
        { label: '2x', duration: 900 }
    ];
    let speedIndex = 1; // starts at 1x, matching window.mapCameraDuration's default

    if (speedBtn) {
        speedBtn.addEventListener('click', () => {
            speedIndex = (speedIndex + 1) % speedPresets.length;
            const preset = speedPresets[speedIndex];
            window.mapCameraDuration = preset.duration;
            if (speedBadge) speedBadge.textContent = preset.label;
        });
    }

    // --- Reset view: back to the default Pakistan overview ---
    const resetViewBtn = document.getElementById('toolbarResetViewBtn');
    if (resetViewBtn) {
        resetViewBtn.addEventListener('click', () => {
            if (typeof window.resetView === 'function') {
                window.resetView();
            }
        });
    }

    // --- Fullscreen ---
    const fullscreenBtn = document.getElementById('toolbarFullscreenBtn');
    if (fullscreenBtn) {
        const fullscreenIcon = fullscreenBtn.querySelector('i');

        fullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen?.().catch(() => {});
            } else {
                document.exitFullscreen?.().catch(() => {});
            }
        });

        document.addEventListener('fullscreenchange', () => {
            const isFullscreen = !!document.fullscreenElement;
            fullscreenBtn.classList.toggle('active', isFullscreen);
            if (fullscreenIcon) {
                fullscreenIcon.classList.toggle('fa-expand', !isFullscreen);
                fullscreenIcon.classList.toggle('fa-compress', isFullscreen);
            }
        });
    }
}

// ============================================
// OUTSIDE CLICK HANDLER
// ============================================

function initializeOutsideClickHandler() {
    document.addEventListener('click', (e) => {
        // Check if click is outside all panels and their triggers
        const isClickInsidePanel = e.target.closest('.video-panel');
        const isClickOnTrigger = e.target.closest('#simexTrigger') || 
                                  e.target.closest('#hazardCalendarsTrigger') || 
                                  e.target.closest('#generalVideosTrigger');
        const isClickInsideModal = e.target.closest('.video-modal .modal-content');
        const isClickInsideMenu = e.target.closest('.overlay-menu') || 
                                   e.target.closest('#menuToggle');
        const isClickInsideBasemap = e.target.closest('.map-toolbar');

        // Don't close if clicking inside these elements
        if (isClickInsidePanel || isClickOnTrigger || isClickInsideModal || 
            isClickInsideMenu || isClickInsideBasemap) {
            return;
        }

        // Close panels if clicking outside (optional - uncomment if needed)
        // closeAllPanels();
    });
}

// ============================================
// BASEMAP SELECTOR
// ============================================

function initializeBasemapSelector() {
    const basemapToggle = document.getElementById('toolbarBasemapBtn');
    const basemapOptions = document.getElementById('basemapOptions');
    const basemapButtons = document.querySelectorAll('.basemap-option');

    if (basemapToggle && basemapOptions) {
        basemapToggle.addEventListener('click', (e) => {
            e.stopPropagation();

            // Close all panels when opening basemap
            closeAllPanels();

            basemapOptions.classList.toggle('show');
            basemapToggle.classList.toggle('active', basemapOptions.classList.contains('show'));
        });

        basemapButtons.forEach(button => {
            button.addEventListener('click', () => {
                const style = button.getAttribute('data-style');

                basemapButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');

                if (window.mapInstance && window.basemapStyles) {
                    window.mapInstance.setStyle(window.basemapStyles[style]);
                }

                basemapOptions.classList.remove('show');
                basemapToggle.classList.remove('active');
            });
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.map-toolbar')) {
                basemapOptions.classList.remove('show');
                basemapToggle.classList.remove('active');
            }
        });
    }
}

// ============================================
// MOBILE MENU
// ============================================

function initializeMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const overlayMenu = document.getElementById('overlayMenu');
    
    if (menuToggle && overlayMenu) {
        menuToggle.addEventListener('click', () => {
            // Close all panels when opening mobile menu
            closeAllPanels();
            closeAllModals();
            
            overlayMenu.classList.toggle('menu-open');
            menuToggle.classList.toggle('active');
        });

        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (!overlayMenu.contains(e.target) && !menuToggle.contains(e.target)) {
                    overlayMenu.classList.remove('menu-open');
                    menuToggle.classList.remove('active');
                }
            }
        });
    }
}

// ============================================
// UNIFIED VIDEO PANEL SYSTEM
// ============================================

// Panel configurations
const panelConfigs = {
    simex: {
        triggerId: 'simexTrigger',
        panelId: 'simexVideoPanel',
        closePanelId: 'closeSimexPanel',
        modalId: 'simexVideoModal',
        closeModalId: 'closeSimexModal',
        fullscreenBtnId: 'simexFullscreenBtn',
        modalVideoId: 'simexModalVideo',
        modalTitleId: 'simexModalTitle'
    },
    calendars: {
        triggerId: 'hazardCalendarsTrigger',
        panelId: 'calendarsVideoPanel',
        closePanelId: 'closeCalendarsPanel',
        modalId: 'calendarsVideoModal',
        closeModalId: 'closeCalendarsModal',
        fullscreenBtnId: 'calendarsFullscreenBtn',
        modalVideoId: 'calendarsModalVideo',
        modalTitleId: 'calendarsModalTitle'
    },
    general: {
        triggerId: 'generalVideosTrigger',
        panelId: 'generalVideoPanel',
        closePanelId: 'closeGeneralPanel',
        modalId: 'generalVideoModal',
        closeModalId: 'closeGeneralModal',
        fullscreenBtnId: 'generalFullscreenBtn',
        modalVideoId: 'generalModalVideo',
        modalTitleId: 'generalModalTitle'
    }
};

function initializeVideoPanelSystem() {
    // Initialize each panel
    Object.keys(panelConfigs).forEach(panelType => {
        initializePanel(panelType, panelConfigs[panelType]);
    });

    // Initialize unified event handlers for video items
    initializeVideoItemHandlers();
}

function initializePanel(panelType, config) {
    const trigger = document.getElementById(config.triggerId);
    const panel = document.getElementById(config.panelId);
    const closePanel = document.getElementById(config.closePanelId);
    const modal = document.getElementById(config.modalId);
    const closeModal = document.getElementById(config.closeModalId);
    const fullscreenBtn = document.getElementById(config.fullscreenBtnId);
    const modalVideo = document.getElementById(config.modalVideoId);
    const modalTitle = document.getElementById(config.modalTitleId);

    // Open panel on trigger click
    if (trigger && panel) {
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Check if this panel is already open (toggle behavior)
            const isCurrentlyOpen = panel.classList.contains('show');
            
            // Close ALL other UI elements first
            closeAllUIElements();
            
            // If panel was not open, open it now
            if (!isCurrentlyOpen) {
                panel.classList.add('show');
                activePanel = panelType;
                console.log(`%c📂 Opened ${panelType} panel`, 'color: #00ffff;');
            } else {
                // Panel was open, now it's closed (toggle off)
                activePanel = null;
                console.log(`%c📁 Closed ${panelType} panel`, 'color: #FFA500;');
            }
        });
    }

    // Close panel button
    if (closePanel && panel) {
        closePanel.addEventListener('click', () => {
            closeSinglePanel(panelType);
        });
    }

    // Close modal button
    if (closeModal && modal && modalVideo) {
        closeModal.addEventListener('click', () => {
            closeSingleModal(panelType);
        });
    }

    // Close modal on backdrop click
    if (modal && modalVideo) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeSingleModal(panelType);
            }
        });
    }

    // Fullscreen button
    if (fullscreenBtn && modalVideo) {
        fullscreenBtn.addEventListener('click', () => {
            requestFullscreen(modalVideo);
        });
    }
}

function initializeVideoItemHandlers() {
    // Handle all play buttons using event delegation
    document.addEventListener('click', (e) => {
        const playBtn = e.target.closest('.play-btn');
        if (playBtn) {
            e.stopPropagation();
            handlePlayButtonClick(playBtn);
        }
    });

    // Handle all enlarge buttons using event delegation
    document.addEventListener('click', (e) => {
        const enlargeBtn = e.target.closest('.enlarge-btn');
        if (enlargeBtn) {
            e.stopPropagation();
            handleEnlargeButtonClick(enlargeBtn);
        }
    });

    // Handle video ended events
    document.addEventListener('ended', (e) => {
        if (e.target.classList.contains('preview-video')) {
            handleVideoEnded(e.target);
        }
    }, true);

    // Disable default controls on preview videos
    document.querySelectorAll('.preview-video').forEach(video => {
        video.controls = false;
    });
}

function handlePlayButtonClick(playBtn) {
    const videoItem = playBtn.closest('.video-item');
    if (!videoItem) return;

    const video = videoItem.querySelector('.preview-video');
    const overlay = videoItem.querySelector('.video-overlay');
    
    if (!video) return;

    if (video.paused) {
        // Stop all other preview videos first
        stopAllPreviewVideos();
        
        // Play this video
        video.play().then(() => {
            video.classList.add('playing');
            if (overlay) overlay.style.opacity = '0';
            playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            console.log('%c▶️ Playing preview video', 'color: #4CAF50;');
        }).catch(err => {
            console.error('Video play failed:', err);
        });
    } else {
        // Pause this video
        video.pause();
        video.classList.remove('playing');
        if (overlay) overlay.style.opacity = '';
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function handleEnlargeButtonClick(enlargeBtn) {
    const videoItem = enlargeBtn.closest('.video-item');
    if (!videoItem) return;

    const panelType = videoItem.getAttribute('data-panel');
    const videoSrc = enlargeBtn.getAttribute('data-video');
    const videoTitle = enlargeBtn.getAttribute('data-title');

    if (!panelType || !videoSrc) return;

    const config = panelConfigs[panelType];
    if (!config) return;

    const modal = document.getElementById(config.modalId);
    const modalVideo = document.getElementById(config.modalVideoId);
    const modalTitle = document.getElementById(config.modalTitleId);

    if (!modal || !modalVideo) return;

    // Stop all preview videos
    stopAllPreviewVideos();
    
    // Close any other open modals first
    closeAllModals();

    // Set modal content
    modalVideo.src = videoSrc;
    if (modalTitle) modalTitle.textContent = videoTitle || 'Video';

    // Show modal
    modal.classList.add('show');
    activeModal = panelType;

    // Play video
    modalVideo.play().catch(err => {
        console.error('Modal video play failed:', err);
    });

    console.log(`%c🎬 Opened modal: ${videoTitle}`, 'color: #FFD700;');
}

function handleVideoEnded(video) {
    video.currentTime = 0;
    video.classList.remove('playing');
    
    const videoItem = video.closest('.video-item');
    if (videoItem) {
        const playBtn = videoItem.querySelector('.play-btn');
        const overlay = videoItem.querySelector('.video-overlay');
        
        if (playBtn) playBtn.innerHTML = '<i class="fas fa-play"></i>';
        if (overlay) overlay.style.opacity = '';
    }
}

// ============================================
// CLOSE FUNCTIONS - CENTRALIZED
// ============================================

/**
 * Close ALL UI elements (panels, modals, menus, basemap)
 */
function closeAllUIElements() {
    closeAllPanels();
    closeAllModals();
    closeBasemapSelector();
    closeMobileMenu();
    stopAllPreviewVideos();
}

/**
 * Close all video panels
 */
function closeAllPanels() {
    Object.keys(panelConfigs).forEach(panelType => {
        closeSinglePanel(panelType);
    });
    activePanel = null;
}

/**
 * Close a single panel by type
 */
function closeSinglePanel(panelType) {
    const config = panelConfigs[panelType];
    if (!config) return;
    
    const panel = document.getElementById(config.panelId);
    if (!panel) return;
    
    panel.classList.remove('show');
    
    // Stop all videos in this panel
    panel.querySelectorAll('.preview-video').forEach(video => {
        video.pause();
        video.currentTime = 0;
        video.classList.remove('playing');
    });

    panel.querySelectorAll('.play-btn').forEach(btn => {
        btn.innerHTML = '<i class="fas fa-play"></i>';
    });

    panel.querySelectorAll('.video-overlay').forEach(overlay => {
        overlay.style.opacity = '';
    });

    if (activePanel === panelType) {
        activePanel = null;
    }
}

/**
 * Close all video modals
 */
function closeAllModals() {
    Object.keys(panelConfigs).forEach(panelType => {
        closeSingleModal(panelType);
    });

    // Also close regular video modal if exists
    const regularModal = document.getElementById('videoModal');
    const regularVideo = document.getElementById('modalVideo');
    if (regularModal && regularVideo) {
        regularModal.classList.remove('show');
        regularVideo.pause();
        regularVideo.src = '';
    }
    
    activeModal = null;
}

/**
 * Close a single modal by type
 */
function closeSingleModal(panelType) {
    const config = panelConfigs[panelType];
    if (!config) return;
    
    const modal = document.getElementById(config.modalId);
    const modalVideo = document.getElementById(config.modalVideoId);
    
    if (!modal) return;
    
    modal.classList.remove('show');
    
    if (modalVideo) {
        modalVideo.pause();
        modalVideo.src = '';
    }

    if (activeModal === panelType) {
        activeModal = null;
    }
}

/**
 * Close basemap selector
 */
function closeBasemapSelector() {
    const basemapOptions = document.getElementById('basemapOptions');
    if (basemapOptions) {
        basemapOptions.classList.remove('show');
    }
}

/**
 * Close mobile menu
 */
function closeMobileMenu() {
    const overlayMenu = document.getElementById('overlayMenu');
    const menuToggle = document.getElementById('menuToggle');
    
    if (overlayMenu) overlayMenu.classList.remove('menu-open');
    if (menuToggle) menuToggle.classList.remove('active');
}

/**
 * Stop all preview videos
 */
function stopAllPreviewVideos() {
    document.querySelectorAll('.preview-video').forEach(video => {
        video.pause();
        video.currentTime = 0;
        video.classList.remove('playing');
    });

    document.querySelectorAll('.play-btn').forEach(btn => {
        btn.innerHTML = '<i class="fas fa-play"></i>';
    });

    document.querySelectorAll('.video-overlay').forEach(overlay => {
        overlay.style.opacity = '';
    });
}

// ============================================
// LEGACY SUPPORT FUNCTIONS
// ============================================

function closePanelAndStopVideos(panel) {
    if (!panel) return;
    
    panel.classList.remove('show');
    
    // Stop all videos in this panel
    panel.querySelectorAll('.preview-video').forEach(video => {
        video.pause();
        video.currentTime = 0;
        video.classList.remove('playing');
    });

    panel.querySelectorAll('.play-btn').forEach(btn => {
        btn.innerHTML = '<i class="fas fa-play"></i>';
    });

    panel.querySelectorAll('.video-overlay').forEach(overlay => {
        overlay.style.opacity = '';
    });
}

function closeModalAndStopVideo(modal, video) {
    if (!modal) return;
    
    modal.classList.remove('show');
    
    if (video) {
        video.pause();
        video.src = '';
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function requestFullscreen(element) {
    if (!element) return;
    
    if (element.requestFullscreen) {
        element.requestFullscreen();
    } else if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
    } else if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    } else if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
    }
}

/**
 * Check if any panel is currently open
 */
function isAnyPanelOpen() {
    return activePanel !== null;
}

/**
 * Check if any modal is currently open
 */
function isAnyModalOpen() {
    return activeModal !== null;
}

/**
 * Get currently active panel type
 */
function getActivePanel() {
    return activePanel;
}

/**
 * Get currently active modal type
 */
function getActiveModal() {
    return activeModal;
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // ESC - Close all UI elements
        if (e.key === 'Escape') {
            closeAllUIElements();
            const addModal = document.getElementById('addVideoModal');
            if (addModal) addModal.classList.remove('show');
            console.log('%c⎋ ESC pressed - Closed all UI elements', 'color: #888;');
        }

        // F - Toggle fullscreen for active modal video
        if (e.key === 'f' || e.key === 'F') {
            if (!e.target.matches('input, textarea')) {
                const activeModalElement = document.querySelector('.video-modal.show');
                if (activeModalElement) {
                    const video = activeModalElement.querySelector('video');
                    if (video) {
                        e.preventDefault();
                        requestFullscreen(video);
                    }
                }
            }
        }

        // Space - Play/pause focused video
        if (e.key === ' ' && e.target.tagName === 'VIDEO') {
            e.preventDefault();
            if (e.target.paused) {
                e.target.play();
            } else {
                e.target.pause();
            }
        }

        // Number keys 1-3 to toggle panels (optional feature)
        if (e.key === '1' && e.ctrlKey) {
            e.preventDefault();
            togglePanel('simex');
        }
        if (e.key === '2' && e.ctrlKey) {
            e.preventDefault();
            togglePanel('calendars');
        }
        if (e.key === '3' && e.ctrlKey) {
            e.preventDefault();
            togglePanel('general');
        }
    });

    console.log('%c⌨️ Keyboard shortcuts: ESC (close all), F (fullscreen), Space (play/pause), Ctrl+1/2/3 (toggle panels)', 'color: #888;');
}

/**
 * Toggle a specific panel (open if closed, close if open)
 */
function togglePanel(panelType) {
    const config = panelConfigs[panelType];
    if (!config) return;

    const panel = document.getElementById(config.panelId);
    if (!panel) return;

    const isCurrentlyOpen = panel.classList.contains('show');

    // Close all panels first
    closeAllPanels();

    // If it wasn't open, open it now
    if (!isCurrentlyOpen) {
        panel.classList.add('show');
        activePanel = panelType;
        console.log(`%c📂 Toggled ${panelType} panel ON`, 'color: #00ffff;');
    } else {
        console.log(`%c📁 Toggled ${panelType} panel OFF`, 'color: #FFA500;');
    }
}

// ============================================
// BOUNDARY LAYER TOGGLE
// ============================================

// NOTE: toggleBoundaryLayer() used to be defined here too, duplicating (and
// silently shadowing, since this file loads after boundaries.js) the real
// implementation in boundaries.js. That duplicate was removed; the call at
// the top of this file now correctly resolves to boundaries.js's version.

// ============================================
// LOADING INDICATOR
// ============================================

function showLoadingIndicator() {
    let loader = document.getElementById('mapLoader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'mapLoader';
        loader.innerHTML = `
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
                       background: rgba(0,0,0,0.8); padding: 20px 40px; border-radius: 10px;
                       color: #00ffff; font-family: sans-serif; z-index: 9999;
                       border: 1px solid rgba(0,255,255,0.3);">
                <div style="text-align: center;">
                    <div style="width: 40px; height: 40px; border: 3px solid rgba(0,255,255,0.3);
                               border-top-color: #00ffff; border-radius: 50%; margin: 0 auto 10px;
                               animation: spin 1s linear infinite;"></div>
                    <p>Loading map data...</p>
                </div>
            </div>
            <style>
                @keyframes spin { to { transform: rotate(360deg); } }
            </style>
        `;
        const mapContainer = document.getElementById('map');
        if (mapContainer) mapContainer.appendChild(loader);
    }
    loader.style.display = 'block';
}

function hideLoadingIndicator() {
    const loader = document.getElementById('mapLoader');
    if (loader) loader.style.display = 'none';
}

// ============================================
// ERROR HANDLING
// ============================================

function handleMapError(error) {
    console.error('Map error:', error);
    hideLoadingIndicator();
    
    const errorDiv = document.createElement('div');
    errorDiv.innerHTML = `
        <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
                   background: rgba(200,0,0,0.9); color: white; padding: 30px; border-radius: 12px;
                   text-align: center; z-index: 10000; max-width: 400px;">
            <h3 style="margin: 0 0 15px;">⚠️ Map Loading Error</h3>
            <p style="margin: 0 0 20px;">Unable to load map data. Please check your connection and try again.</p>
            <button onclick="location.reload()" style="padding: 10px 25px; background: white;
                   border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">
                Reload Page
            </button>
        </div>
    `;
    document.body.appendChild(errorDiv);
}


// ============================================
// EXPORT FUNCTIONS TO GLOBAL SCOPE
// ============================================

window.initializeControls = initializeControls;
window.showLoadingIndicator = showLoadingIndicator;
window.hideLoadingIndicator = hideLoadingIndicator;
window.handleMapError = handleMapError;
window.closeAllPanels = closeAllPanels;
window.closeAllModals = closeAllModals;
window.closeAllUIElements = closeAllUIElements;
window.stopAllPreviewVideos = stopAllPreviewVideos;
window.togglePanel = togglePanel;
window.isAnyPanelOpen = isAnyPanelOpen;
window.isAnyModalOpen = isAnyModalOpen;
window.getActivePanel = getActivePanel;
window.getActiveModal = getActiveModal;
window.closeSinglePanel = closeSinglePanel;
window.closeSingleModal = closeSingleModal;
window.closeBasemapSelector = closeBasemapSelector;
window.closeMobileMenu = closeMobileMenu;

// ============================================
// ADD VIDEO FEATURE  (Google Drive-backed - see google-drive-videos.js)
// ============================================

function initializeAddVideoFeature() {
    const modal = document.getElementById('addVideoModal');
    const form = document.getElementById('addVideoForm');
    const closeBtn = document.getElementById('closeAddVideoModal');
    const cancelBtn = document.getElementById('cancelAddVideo');
    const fileInput = document.getElementById('addVideoFile');
    const fileLabel = document.getElementById('fileInputLabel');
    const fileDisplay = document.querySelector('.file-input-display');
    const submitBtn = form ? form.querySelector('.submit-btn') : null;
    const submitBtnDefaultHTML = submitBtn ? submitBtn.innerHTML : '';

    let videosLoaded = false;

    // Pulls every video previously uploaded to Drive and rebuilds their
    // cards. Safe to call more than once - only actually renders once per
    // page load (called both on startup, if already signed in from earlier
    // this session, and right after a fresh sign-in).
    function loadSavedVideos() {
        if (videosLoaded || !window.driveVideos || !window.driveVideos.isSignedIn()) return;
        videosLoaded = true;
        window.driveVideos.list().then(records => {
            records.forEach(record => {
                const card = createVideoCard(record.panelType, record.url, record.title, record.description, record.id);
                const config = panelConfigs[record.panelType];
                if (config) {
                    const grid = document.querySelector(`#${config.panelId} .video-grid`);
                    if (grid) grid.appendChild(card);
                }
            });
            if (records.length > 0) {
                console.log(`%c☁️ Restored ${records.length} video(s) from Google Drive`, 'color: #00ff96;');
            }
        }).catch(err => {
            videosLoaded = false;
            console.error('Failed to load Drive videos:', err);
        });
    }

    loadSavedVideos();

    // Open modal when any "Add Video" button is clicked - connects to
    // Google Drive first if this session hasn't signed in yet.
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.add-video-btn');
        if (!btn) return;
        e.stopPropagation();

        if (!window.driveVideos || !window.driveVideos.isConfigured()) {
            alert('Google Drive isn\'t set up for this portal yet.\n\nSee the one-time setup steps in the comment at the top of google-drive-videos.js.');
            return;
        }

        const openModal = () => {
            document.getElementById('addVideoPanel').value = btn.getAttribute('data-panel');
            form.reset();
            if (fileLabel) fileLabel.textContent = 'Click to browse or drag a video file';
            if (fileDisplay) fileDisplay.classList.remove('has-file');
            modal.classList.add('show');
        };

        if (window.driveVideos.isSignedIn()) {
            openModal();
            return;
        }

        window.driveVideos.signIn()
            .then(() => {
                loadSavedVideos(); // pick up anything already in Drive from a previous session
                openModal();
            })
            .catch(err => {
                console.error('Google Drive sign-in failed:', err);
                alert('Could not connect to Google Drive: ' + err.message);
            });
    });

    // Handle delete button on user-added cards
    document.addEventListener('click', (e) => {
        const deleteBtn = e.target.closest('.delete-video-btn');
        if (deleteBtn) {
            e.stopPropagation();
            const fileId = deleteBtn.getAttribute('data-db-id');
            if (confirm('Remove this video from Google Drive?')) {
                window.driveVideos.delete(fileId).then(() => {
                    const card = deleteBtn.closest('.video-item');
                    if (card) card.remove();
                    console.log(`%c🗑️ Deleted Drive video id=${fileId}`, 'color: #ff6b6b;');
                }).catch(err => {
                    console.error('Delete failed:', err);
                    alert('Failed to delete video: ' + err.message);
                });
            }
        }
    });

    // Show chosen filename
    if (fileInput) {
        fileInput.addEventListener('change', () => {
            const file = fileInput.files && fileInput.files[0];
            if (file) {
                if (fileLabel) fileLabel.textContent = file.name;
                if (fileDisplay) fileDisplay.classList.add('has-file');
            } else {
                if (fileLabel) fileLabel.textContent = 'Click to browse or drag a video file';
                if (fileDisplay) fileDisplay.classList.remove('has-file');
            }
        });
    }

    function closeAddModal() { modal.classList.remove('show'); }

    if (closeBtn) closeBtn.addEventListener('click', closeAddModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeAddModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeAddModal(); });

    // Submit — upload to Google Drive, then add its card to the grid
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const panelType = document.getElementById('addVideoPanel').value;
            const title = document.getElementById('addVideoTitle').value.trim();
            const description = document.getElementById('addVideoDescription').value.trim();
            const file = fileInput.files && fileInput.files[0];
            if (!title || !file) return;

            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading to Drive...';
            }

            window.driveVideos.upload(panelType, title, description, file).then(record => {
                const card = createVideoCard(record.panelType, record.url, record.title, record.description, record.id);
                const config = panelConfigs[record.panelType];
                if (config) {
                    const grid = document.querySelector(`#${config.panelId} .video-grid`);
                    if (grid) grid.appendChild(card);
                }
                closeAddModal();
                console.log(`%c☁️ Uploaded "${title}" to Google Drive (id=${record.id})`, 'color: #00ff96;');
            }).catch(err => {
                console.error('Failed to upload video to Drive:', err);
                alert('Upload failed: ' + err.message);
            }).finally(() => {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = submitBtnDefaultHTML;
                }
            });
        });
    }
}

function createVideoCard(panelType, videoUrl, title, description, dbId) {
    const item = document.createElement('div');
    item.className = 'video-item';
    item.setAttribute('data-panel', panelType);
    if (dbId != null) item.setAttribute('data-db-id', dbId);

    item.innerHTML = `
        <div class="video-thumbnail">
            <video class="preview-video" preload="metadata" muted>
                <source src="${videoUrl}" type="video/mp4">
            </video>
            <div class="video-overlay">
                <button class="play-btn" data-action="preview">
                    <i class="fas fa-play"></i>
                </button>
            </div>
            ${dbId != null ? `<button class="delete-video-btn" data-db-id="${dbId}" title="Remove video"><i class="fas fa-trash"></i></button>` : ''}
        </div>
        <div class="video-info">
            <h4 class="video-title">${escapeHtml(title)}</h4>
            <p class="video-description">${escapeHtml(description)}</p>
        </div>
        <div class="video-actions">
            <button class="enlarge-btn"
                    data-video="${videoUrl}"
                    data-title="${escapeHtml(title)}">
                <i class="fas fa-expand"></i> Enlarge
            </button>
        </div>
    `;

    return item;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.initializeAddVideoFeature = initializeAddVideoFeature;