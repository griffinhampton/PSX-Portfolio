import * as utils from './utils.js'


class RotationPad {
    container
    padElement
    region
    handle
    eventRepeatTimeout
    regionData = {}
    handleData = {}
    // Track active touch identifier for multi-touch support
    activePointerId = null
    // Separate mouse flag for desktop interactions
    mouseDown = false
    mouseStopped = false

    constructor(container) {
        this.container = container
        this.padElement = document.createElement('div')
        this.padElement.classList.add('rotation-pad')
    // Basic inline styles so pad is visible without external CSS
    this.padElement.style.position = 'fixed'
    this.padElement.style.zIndex = '10001' // sit above movement pad
    this.padElement.style.pointerEvents = 'auto'
    this.padElement.style.userSelect = 'none'
        this.region = document.createElement('div')
        this.region.classList.add('region')
    // region styles
    this.region.style.width = '160px'
    this.region.style.height = '160px'
    this.region.style.background = 'rgba(0,0,0,0.25)'
    this.region.style.border = '1px solid rgba(255,255,255,0.06)'
    this.region.style.borderRadius = '50%'
    this.region.style.position = 'relative'
    this.region.style.touchAction = 'none'
        this.handle = document.createElement('div')
        this.handle.classList.add('handle')
    // handle styles
    this.handle.style.width = '40px'
    this.handle.style.height = '40px'
    this.handle.style.background = 'rgba(255,255,255,0.95)'
    this.handle.style.border = '1px solid rgba(0,0,0,0.08)'
    this.handle.style.borderRadius = '50%'
    this.handle.style.position = 'absolute'
    this.handle.style.left = '40px'
    this.handle.style.top = '40px'
    this.handle.style.transition = 'opacity 0.15s, transform 0.05s'
    this.handle.style.opacity = '0.95'
        this.region.appendChild(this.handle)
        this.padElement.append(this.region)
        this.container.append(this.padElement)

        // Aligning pad:
        let canvas = container.getElementsByTagName('canvas')[0]
        this.alignAndConfigPad(canvas)

        // events
        window.addEventListener('resize', () => {this.alignAndConfigPad(canvas)})

        // Mouse events:
        this.region.addEventListener('mousedown', (event) => {
            this.mouseDown = true
            this.handle.style.opacity = 1.0
            this.update(event.pageX, event.pageY)
        })

        document.addEventListener('mouseup', () => {
            this.mouseDown = false
            this.resetHandlePosition()
        })

        document.addEventListener('mousemove', (event) => {
            if (!this.mouseDown)
                return
            this.update(event.pageX, event.pageY)
        })

        // Touch events — track specific touch identifier so two pads can be used simultaneously
        this.region.addEventListener('touchstart', (event) => {
            // Use the first touch that started on this region and remember its id
            const t = event.changedTouches && event.changedTouches[0]
            if (!t) return
            this.activePointerId = t.identifier
            this.handle.style.opacity = 1.0
            // Prevent the page from scrolling while interacting
            if (event.cancelable) event.preventDefault()
            this.update(t.pageX, t.pageY)
        }, { passive: false })

        let touchEnd = (event) => {
            if (!this.activePointerId) return
            // If one of the ended/cancelled touches matches our active id, clear it
            for (let i = 0; i < event.changedTouches.length; i++) {
                if (event.changedTouches[i].identifier === this.activePointerId) {
                    this.activePointerId = null
                    this.resetHandlePosition()
                    break
                }
            }
        }
        document.addEventListener('touchend', touchEnd)
        document.addEventListener('touchcancel', touchEnd)

        document.addEventListener('touchmove', (event) => {
            if (this.activePointerId === null) return
            // Find the touch that matches our active id
            let touch = null
            for (let i = 0; i < event.touches.length; i++) {
                if (event.touches[i].identifier === this.activePointerId) {
                    touch = event.touches[i]
                    break
                }
            }
            if (!touch) return
            if (event.cancelable) event.preventDefault()
            this.update(touch.pageX, touch.pageY)
        }, { passive: false })

        this.resetHandlePosition()
    }

    alignAndConfigPad(canvas){
        // Safely handle missing canvas
        const canvasRect = canvas ? canvas.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, top: 0, left: 0 };
        // Position near bottom-right of canvas but lifted a bit so it doesn't overlap the movement pad
        this.padElement.style.position = 'fixed'
        this.padElement.style.zIndex = '10001'
    // Lift pad up by additional offset so it doesn't overlap movement pad (increase if still overlapping)
    // Increased lift and left offset to move the pad higher and more to the left per user request
    const LIFT_OFFSET = 130; // pixels to raise pad from its default bottom placement (reduced slightly to move pad down)
    const padSize = 120;
    // move further up (larger LIFT_OFFSET) and further left (larger right-side subtraction)
    this.padElement.style.top = (canvasRect.top + canvasRect.height - padSize  - LIFT_OFFSET) + 'px'
    this.padElement.style.left = (canvasRect.left + canvasRect.width - padSize - 50) + 'px'

        this.regionData.width = this.region.offsetWidth
        this.regionData.height = this.region.offsetHeight
        this.regionData.position = {
            top: this.region.offsetTop,
            left: this.region.offsetLeft
        }
        this.regionData.offset = utils.getOffset(this.region)
        this.regionData.radius = this.regionData.width / 2
        this.regionData.centerX = this.regionData.position.left + this.regionData.radius
        this.regionData.centerY = this.regionData.position.top + this.regionData.radius

        this.handleData.width = this.handle.offsetWidth
        this.handleData.height = this.handle.offsetHeight
        this.handleData.radius = this.handleData.width / 2

        this.regionData.radius = this.regionData.width / 2 - this.handleData.radius
    }

    update(pageX, pageY) {
        let newLeft = (pageX - this.regionData.offset.left)
        let newTop = (pageY - this.regionData.offset.top)

        // If handle reaches the pad boundaries.
        let distance = Math.pow(this.regionData.centerX - newLeft, 2) + Math.pow(this.regionData.centerY - newTop, 2)
        if (distance > Math.pow(this.regionData.radius, 2)) {
            let angle = Math.atan2((newTop - this.regionData.centerY), (newLeft - this.regionData.centerX))
            newLeft = (Math.cos(angle) * this.regionData.radius) + this.regionData.centerX
            newTop = (Math.sin(angle) * this.regionData.radius) + this.regionData.centerY
        }
        newTop = Math.round(newTop * 10) / 10
        newLeft = Math.round(newLeft * 10) / 10

        this.handle.style.top = newTop - this.handleData.radius + 'px'
        this.handle.style.left = newLeft - this.handleData.radius + 'px'

        // Providing event and data for handling camera movement.
        var deltaX = this.regionData.centerX - parseInt(newLeft)
        var deltaY = this.regionData.centerY - parseInt(newTop)
        // Normalize x,y between -2 to 2 range.
        deltaX = -2 + (2 + 2) * (deltaX - (-this.regionData.radius)) / (this.regionData.radius - (-this.regionData.radius))
        deltaY = -2 + (2 + 2) * (deltaY - (-this.regionData.radius)) / (this.regionData.radius - (-this.regionData.radius))
        deltaX = -1 * Math.round(deltaX * 10) / 10
        deltaY = -1 * Math.round(deltaY * 10) / 10
        
        this.sendEvent(deltaX, deltaY)
    }

    sendEvent(dx, dy) {
        if (this.eventRepeatTimeout) {
            clearTimeout(this.eventRepeatTimeout)
        }

        // Only continue sending events while we have an active pointer (touch) or mouse is down
        if (this.activePointerId === null && !this.mouseDown) {
            clearTimeout(this.eventRepeatTimeout)
            return
        }

        this.eventRepeatTimeout = setTimeout(() => {
            this.sendEvent(dx, dy)
        }, 5)

        let picthEvent = new CustomEvent('YawPitch', {
            bubbles: false,
            detail: {
                'deltaX': dx,
                'deltaY': dy
            }
        })
        this.padElement.dispatchEvent(picthEvent)
    }

    resetHandlePosition() {
        this.handle.style.top = this.regionData.centerY - this.handleData.radius + 'px'
        this.handle.style.left = this.regionData.centerX - this.handleData.radius + 'px'
        this.handle.style.opacity = 0.1
    }
}


export default RotationPad
