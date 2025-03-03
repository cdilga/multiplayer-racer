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
        if (this.isFullscreen) {
            return this.exitFullscreen();
        }
        return this.enterFullscreen();
    },
    
    // Initialize mobile optimizations
    async init() {
        if (!this.isMobile()) return;
        
        // Enter fullscreen if supported
        if (this.isFullscreenSupported()) {
            await this.enterFullscreen();
        }
        
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