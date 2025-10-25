class MovementPad {
    constructor(container) {
        this.container = container;
        this.padElement = document.createElement('div');
        this.padElement.classList.add('movement-pad');

    this.padElement.style.position = 'fixed';
        this.padElement.style.zIndex = '9999';
        this.padElement.style.touchAction = 'none';

        this.region = document.createElement('div');
        this.region.classList.add('region');
        this.handle = document.createElement('div');
        this.handle.classList.add('handle');
        this.region.appendChild(this.handle);
        this.padElement.appendChild(this.region);
        this.container.appendChild(this.padElement);

    this.regionData = {};
    this.handleData = {};
    this.eventRepeatTimeout = null;
    // Track active touch identifier so multiple pads can be used simultaneously
    this.activePointerId = null;
    // Separate mouse flag for desktop interactions
    this.mouseDown = false;

        // Basic inline styles so it's usable without CSS
    this.region.style.width = '120px';
    this.region.style.height = '120px';
    // Make the pad visually white and opaque instead of translucent
    this.region.style.background = 'rgba(255,255,255,0.95)';
    this.region.style.border = '1px solid rgba(0,0,0,0.08)';
    this.region.style.borderRadius = '50%';
    this.region.style.position = 'relative';
    this.region.style.boxShadow = '0 6px 18px rgba(0,0,0,0.12)';

    this.handle.style.width = '40px';
    this.handle.style.height = '40px';
    // Solid black handle for clear contrast
    this.handle.style.background = '#000000';
    // Light border so it reads on dark backgrounds when needed
    this.handle.style.border = '1px solid rgba(255,255,255,0.08)';
    this.handle.style.borderRadius = '50%';
    this.handle.style.position = 'absolute';
    this.handle.style.left = '40px';
    this.handle.style.top = '40px';
    this.handle.style.transition = 'opacity 0.15s, transform 0.05s';
    // Make the handle visible by default (not almost transparent)
    this.handle.style.opacity = '0.95';

    // Align pad to bottom-left of viewport
    const canvas = container.getElementsByTagName('canvas')[0];
    this.alignAndConfigPad(canvas);
    window.addEventListener('resize', () => { this.alignAndConfigPad(canvas); });

        // Mouse
        this.region.addEventListener('mousedown', (event) => {
            this.mouseDown = true;
            this.handle.style.opacity = 1.0;
            this.update(event.pageX, event.pageY);
        });

        document.addEventListener('mouseup', () => {
            this.mouseDown = false;
            this.resetHandlePosition();
        });

        document.addEventListener('mousemove', (event) => {
            if (!this.mouseDown) return;
            this.update(event.pageX, event.pageY);
        });

        // Touch — track pointer id for this pad so a second thumb can control rotation
        this.region.addEventListener('touchstart', (event) => {
            const t = event.changedTouches && event.changedTouches[0];
            if (!t) return;
            this.activePointerId = t.identifier;
            this.handle.style.opacity = 1.0;
            if (event.cancelable) event.preventDefault();
            this.update(t.pageX, t.pageY);
        }, { passive: false });

        const touchEnd = (event) => {
            if (this.activePointerId === null) return;
            for (let i = 0; i < event.changedTouches.length; i++) {
                if (event.changedTouches[i].identifier === this.activePointerId) {
                    this.activePointerId = null;
                    this.resetHandlePosition();
                    break;
                }
            }
        };
        document.addEventListener('touchend', touchEnd);
        document.addEventListener('touchcancel', touchEnd);

        document.addEventListener('touchmove', (event) => {
            if (this.activePointerId === null) return;
            // find matching touch
            let touch = null;
            for (let i = 0; i < event.touches.length; i++) {
                if (event.touches[i].identifier === this.activePointerId) {
                    touch = event.touches[i];
                    break;
                }
            }
            if (!touch) return;
            if (event.cancelable) event.preventDefault();
            this.update(touch.pageX, touch.pageY);
        }, { passive: false });

        this.resetHandlePosition();
    }

    alignAndConfigPad(canvas) {
        // Position pad 20px from left, 20px from bottom of viewport
        this.padElement.style.left = '20px';
        this.padElement.style.bottom = '20px';

    // compute region metrics using viewport coordinates
    const regionRect = this.region.getBoundingClientRect();
    this.regionData.width = regionRect.width;
    this.regionData.height = regionRect.height;
    // region offset in page coordinates (account for scroll)
    this.regionData.offset = { left: regionRect.left + window.scrollX, top: regionRect.top + window.scrollY };
    // center in local region coordinates
    this.regionData.centerX = this.regionData.width / 2;
    this.regionData.centerY = this.regionData.height / 2;
    // radius available for handle movement (local units)
    this.handleData.width = this.handle.offsetWidth;
    this.handleData.height = this.handle.offsetHeight;
    this.handleData.radius = this.handleData.width / 2;
    this.regionData.radius = this.regionData.width / 2 - this.handleData.radius;

        this.handleData.width = this.handle.offsetWidth;
        this.handleData.height = this.handle.offsetHeight;
        this.handleData.radius = this.handleData.width / 2;

        this.regionData.radius = this.regionData.width / 2 - this.handleData.radius;
    }

    update(pageX, pageY) {
    let newLeft = (pageX - this.regionData.offset.left);
    let newTop = (pageY - this.regionData.offset.top);

        // Bound to circle
        let distance = Math.pow(this.regionData.centerX - newLeft, 2) + Math.pow(this.regionData.centerY - newTop, 2);
        if (distance > Math.pow(this.regionData.radius, 2)) {
            let angle = Math.atan2((newTop - this.regionData.centerY), (newLeft - this.regionData.centerX));
            newLeft = (Math.cos(angle) * this.regionData.radius) + this.regionData.centerX;
            newTop = (Math.sin(angle) * this.regionData.radius) + this.regionData.centerY;
        }
        newTop = Math.round(newTop * 10) / 10;
        newLeft = Math.round(newLeft * 10) / 10;

    // Place handle using local coordinates relative to region
    this.handle.style.top = (newTop - this.handleData.radius) + 'px';
    this.handle.style.left = (newLeft - this.handleData.radius) + 'px';

    // Compute deltas in local region coordinates (center - handle)
    let deltaX = this.regionData.centerX - newLeft;
    let deltaY = this.regionData.centerY - newTop;
        // Normalize to -2..2
    // Normalize to -2..2 based on radius
    const r = this.regionData.radius;
    deltaX = -2 + (4) * (deltaX - (-r)) / (r - (-r));
    deltaY = -2 + (4) * (deltaY - (-r)) / (r - (-r));
        deltaX = Math.round(deltaX * 10) / 10;
        deltaY = Math.round(deltaY * 10) / 10;

        this.sendEvent(deltaX, deltaY, 0);
    }

    sendEvent(dx, dy, middle) {
        if (this.eventRepeatTimeout) clearTimeout(this.eventRepeatTimeout);

        // Only send repeat events while the pad has an active pointer (touch) or mouse is down
        if (this.activePointerId === null && !this.mouseDown) {
            const stopEvent = new Event('stopMove', { bubbles: false });
            this.padElement.dispatchEvent(stopEvent);
            return;
        }

        this.eventRepeatTimeout = setTimeout(() => {
            this.sendEvent(dx, dy, middle);
        }, 5);

        const moveEvent = new CustomEvent('move', {
            bubbles: false,
            detail: { deltaX: dx, deltaY: dy, middle }
        });
        this.padElement.dispatchEvent(moveEvent);
    }

    resetHandlePosition() {
        // Center handle inside region (local coords)
        const cx = (this.regionData.width || this.region.offsetWidth) / 2;
        const cy = (this.regionData.height || this.region.offsetHeight) / 2;
        this.handle.style.top = (cy - (this.handleData.radius || (this.handle.offsetHeight / 2))) + 'px';
        this.handle.style.left = (cx - (this.handleData.radius || (this.handle.offsetWidth / 2))) + 'px';
        this.handle.style.opacity = 0.1;
    }

    dispose() {
        if (this.padElement && this.padElement.parentNode) this.padElement.parentNode.removeChild(this.padElement);
        this.padElement = null;
    }
}

export default MovementPad;
