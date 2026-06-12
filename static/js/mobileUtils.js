// Mobile utilities for handling fullscreen and touch interactions

const mobileUtils = {
    isFullscreen: false,
    
    // Check if the device is mobile
    isMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    },
    
    // Check if fullscreen is supported
    isFullscreenSupported() {
        const doc = document.documentElement;
        return !!(
            doc.requestFullscreen ||
            doc.webkitRequestFullscreen ||
            doc.mozRequestFullScreen ||
            doc.msRequestFullscreen
        );
    },
    
    // Enter fullscreen
    async enterFullscreen() {
        const elem = document.documentElement;
        try {
            if (elem.requestFullscreen) {
                await elem.requestFullscreen();
            } else if (elem.webkitRequestFullscreen) {
                await elem.webkitRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
                await elem.mozRequestFullScreen();
            } else if (elem.msRequestFullscreen) {
                await elem.msRequestFullscreen();
            } else {
                // No Fullscreen API (e.g. iPhone Safari) - don't pretend
                return false;
            }
            this.isFullscreen = true;
            return true;
        } catch (error) {
            console.warn('Failed to enter fullscreen:', error);
            return false;
        }
    },
    
    // Exit fullscreen
    async exitFullscreen() {
        try {
            if (document.exitFullscreen) {
                await document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                await document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                await document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                await document.msExitFullscreen();
            }
            this.isFullscreen = false;
            return true;
        } catch (error) {
            console.warn('Failed to exit fullscreen:', error);
            return false;
        }
    },
    
    // Toggle fullscreen
    async toggleFullscreen() {
        // Trust the document's actual state over our flag - the user can exit
        // fullscreen via system gestures without us seeing the event in time
        const actuallyFullscreen = !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullscreenElement ||
            document.msFullscreenElement
        );
        this.isFullscreen = actuallyFullscreen;

        if (this.isFullscreen) {
            return this.exitFullscreen();
        }
        return this.enterFullscreen();
    },

    // Initialize mobile optimizations
    async init() {
        if (!this.isMobile()) return;

        // NOTE: no auto-fullscreen here - browsers reject requestFullscreen
        // without a user gesture. The toggle button handles it on first tap.

        // Listen for fullscreen changes
        document.addEventListener('fullscreenchange', () => {
            this.isFullscreen = !!document.fullscreenElement;
        });
        document.addEventListener('webkitfullscreenchange', () => {
            this.isFullscreen = !!document.webkitFullscreenElement;
        });
        document.addEventListener('mozfullscreenchange', () => {
            this.isFullscreen = !!document.mozFullscreenElement;
        });
        document.addEventListener('MSFullscreenChange', () => {
            this.isFullscreen = !!document.msFullscreenElement;
        });
    }
};

// Export for use in other files
window.mobileUtils = mobileUtils;

// Wire the fullscreen toggle button. This script is loaded dynamically after
// the DOM exists, so wiring here avoids the DOMContentLoaded race that left
// the button permanently hidden.
(function initFullscreenToggle() {
    const toggle = document.getElementById('fullscreen-toggle');
    if (!toggle) return;

    // Show wherever the API actually works (iOS Safari has none - stays hidden)
    if (!mobileUtils.isFullscreenSupported()) return;

    mobileUtils.init();
    toggle.classList.remove('hidden');

    const updateLabel = () => {
        const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
        toggle.textContent = active ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
    };
    toggle.addEventListener('click', async () => {
        await mobileUtils.toggleFullscreen();
        updateLabel();
    });
    document.addEventListener('fullscreenchange', updateLabel);
    document.addEventListener('webkitfullscreenchange', updateLabel);
})(); 