// src/lib/animator.svelte.ts
/**
 * Every route looks up animator's validationDaddy container like "what phase are we in daddy"
 * Animator cycles through 'exit' → 'enter' → 'idle'
 * Animator tells everyone when they're allowed to do drydock tasks or ui updates
 */
import { animate as animejsanimate, createScope, createTimeline } from 'animejs'
import { morphTo as animejsMorphTo, createMotionPath } from 'animejs/svg'

type AnimationPhase = 'startup' | 'idle' | 'enter' | 'exit'

interface TransitionStyle {
    stagger: number
    duration: number
    ease: string
    mode: 'sequential' | 'simultaneous' | 'overlapping'
    overlap?: number
}

class Animator {
    // Validation container
    validationDaddy = $state<AnimationPhase>('startup')
    startupCompleted = $state(false)

    /**
     * Pressure gauge needle sweep animation
     */
    gaugeSweep(selector: string, rotation: number) {
        this.animate(selector, {
            rotate: rotation,
            duration: 600,
            ease: 'out(3)',
            autoplay: true,
        })
    }

    /**
     * Gauge ping - expanding ring animation
     */
    gaugePing(selector: string) {
        this.animate(selector, {
            scale: [1, 1.8],
            opacity: [0.7, 0],
            duration: 800,
            ease: 'out(2)',
            autoplay: true,
        })
    }

    /**
     *
     * @param element the HTML Element name queried in the page route
     * @param config the config object we built inside the page route effect and pass to AnimeJS
     */
    animate(element: string, config: any) {
        const elements = document.querySelectorAll(element)

        if (elements.length === 0) {
            // REVIEW: There's ONE case where we pass a config object without a complete prop in the entire program
            config.complete?.()
            return
        }

        return animejsanimate(element, config)
    }

    timeline = createTimeline
    scope = createScope
    motionPath = createMotionPath
    morphTo = animejsMorphTo

    /**
     * Complete startup animation and move to idle
     */
    startupComplete() {
        if (this.validationDaddy !== 'startup') return
        this.validationDaddy = 'idle'
        this.startupCompleted = true
        document.body.removeAttribute('data-animating')
    }

    /**
     * Start animation sequence for a navigation
     * Called by AppState after view is updated
     */
    playTransition() {
        document.body.setAttribute('data-animating', 'true')
        this.validationDaddy = 'exit'
    }

    /**
     * Signal that we've left a view
     */
    exitComplete() {
        if (this.validationDaddy !== 'exit') return
        this.validationDaddy = 'enter'
    }

    /**
     * Signal that we've finished entering a view
     */
    enterComplete() {
        if (this.validationDaddy !== 'enter') return
        this.validationDaddy = 'idle'
        document.body.removeAttribute('data-animating')
    }

    /**
     * Default view transition animation
     */
    inAndOutBurger(): TransitionStyle {
        return {
            mode: 'sequential',
            stagger: 100,
            duration: 400,
            ease: 'out(2)',
        }
    }

    /**
     * Run the startup splash animation sequence
     */
    startupSequence(onComplete: () => void) {
        const lines = document.querySelectorAll('.splash-line')
        if (lines.length === 0) {
            onComplete()
            return
        }

        const timeline = this.timeline({
            autoplay: false,
            onComplete: () => onComplete(),
        })

        // Add each individual line element with staggered positions
        lines.forEach((line, i) => {
            timeline.add(
                line,
                {
                    opacity: [0, 1],
                    translateY: [20, 0],
                    duration: 600,
                    ease: 'out(3)',
                },
                i * 800
            )
        })

        timeline.add('.splash-line', {
            opacity: 1,
            duration: 800,
        })

        timeline.add('.splash-container', {
            opacity: [1, 0],
            duration: 600,
            ease: 'in(2)',
        })

        timeline.play()
    }

    /**
     * Animate in the main content after splash
     */
    postSplash(onComplete: () => void) {
        this.animate('.bet-content', {
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 800,
            ease: 'out(3)',
            autoplay: true,
            complete: onComplete,
        })
    }

    /**
     * Animate in link to skip to Mission Control if this is not a virgin start
     */
    notFirstTimeUser() {
        this.animate('.skip-link', {
            opacity: [0, 1],
            translateY: [-10, 0],
            duration: 400,
            ease: 'out(2)',
            autoplay: true,
        })
    }

    /**
     * App-wide modal entrance animation
     * the backdrop should fade in with opacity
     * the actual modal card should fade in with opacity + translateY
     * Usage: <div {@attach animator.modalEntrance('.modal-backdrop', '.modal')}>
     */
    modalEntrance(backdropSelector: string, modalSelector: string) {
        return (_element: HTMLElement) => {
            requestAnimationFrame(() => {
                this.animate(backdropSelector, {
                    opacity: [0, 1],
                    duration: 200,
                    ease: 'out(2)',
                    autoplay: true,
                })
                this.animate(modalSelector, {
                    opacity: [0, 1],
                    translateY: [20, 0],
                    duration: 300,
                    ease: 'out(2)',
                    autoplay: true,
                })
            })
        }
    }

    /**
     * App-wide view entrance animation
     * Usage: <section {@attach animator.viewEntrance('.my-view')}>
     * Mixed results - use enterView() for stable behaviour
     */
    viewEntrance(selector: string) {
        return (_element: HTMLElement) => {
            requestAnimationFrame(() => {
                this.animate(selector, {
                    opacity: [0, 1],
                    scale: [0.95, 1],
                    duration: 400,
                    ease: 'out(2)',
                    autoplay: true,
                    complete: () => this.enterComplete(),
                })
            })
        }
    }

    /**
     * App-wide fade-in entrance animation
     * Usage: <div {@attach animator.fadeIn('.my-content')}>
     * We're getting mixed results with attachments so maybe just use fadeIn() instead
     */
    fadeInAttached(selector: string) {
        return (_element: HTMLElement) => {
            requestAnimationFrame(() => {
                this.animate(selector, {
                    opacity: [0, 1],
                    translateY: [20, 0],
                    duration: 400,
                    ease: 'out(3)',
                    autoplay: true,
                })
            })
        }
    }

    /**
     * App-wide staggered entrance animation
     * Usage: <div {@attach animator.staggeredEntrance('.item')}>
     */
    staggeredEntrance(itemSelector: string) {
        return (_element: HTMLElement) => {
            requestAnimationFrame(() => {
                this.animate(itemSelector, {
                    opacity: [0, 1],
                    translateX: [-20, 0],
                    duration: 400,
                    delay: (_el: HTMLElement, i: number) => i * 100,
                    ease: 'out(2)',
                    autoplay: true,
                    complete: () => this.enterComplete(),
                })
            })
        }
    }

    /**
     * Fade in animation
     * @param selector - Element to fade in
     */
    fadeIn(selector: string) {
        this.animate(selector, {
            opacity: [0, 1],
            duration: 400,
            ease: 'out(2)',
            autoplay: true,
        })
    }

    /**
     * View entrance animation with scale
     * @param selector - Element to animate in
     */
    enterView(selector: string) {
        this.animate(selector, {
            opacity: [0, 1],
            scale: [0.95, 1],
            duration: 400,
            ease: 'out(2)',
            autoplay: true,
        })
    }

    /**
     * Fade out animation with callback
     * @param selector - Element to fade out
     * @param onComplete - Callback after animation
     */
    fadeOut(selector: string, onComplete?: () => void) {
        this.animate(selector, {
            opacity: [1, 0],
            duration: 200,
            ease: 'in(2)',
            autoplay: true,
            complete: onComplete,
        })
    }

    /**
     * Block hover animation — animate a specific pillar block on mouseenter
     * @param selector - e.g. '.block-recon'
     */
    blockHover(selector: string) {
        this.animate(selector, {
            scaleX: [1, 1.06],
            scaleY: [1, 1.1],
            duration: 300,
            ease: 'out(4)',
            autoplay: true,
        })
    }

    /**
     * Block leave animation — restore a pillar block on mouseleave
     * @param selector - e.g. '.block-recon'
     */
    blockLeave(selector: string) {
        this.animate(selector, {
            scaleX: 1,
            scaleY: 1,
            duration: 250,
            ease: 'out(3)',
            autoplay: true,
        })
    }

    // new slide in for either CSS classes or running attachments
    slideIn(target: string | HTMLElement) {
        if (typeof target === 'string') {
            this.animate(target, {
                translateX: ['100%', '0%'],
                duration: 900,
                ease: 'out(3)',
                autoplay: true,
            })
        } else {
            animejsanimate(target, {
                translateX: ['100%', '0%'],
                duration: 900,
                ease: 'out(3)',
                autoplay: true,
            })
        }
    }

    zoomToViewBox(svgSelector: string, cx: number, cy: number, svgW: number, svgH: number) {
        const zoomW = 250
        const zoomH = 250
        const visibleCenter = 0.25
        const x = cx - visibleCenter * zoomW
        const y = cy - zoomH / 2

        const allGroups = Array.from(document.querySelectorAll('.centroid-group'))
        const toFade = allGroups.filter((el) => !el.classList.contains('focused'))

        const tl = this.timeline({ autoplay: false })
        tl.add(svgSelector, {
            viewBox: `${x} ${y} ${zoomW} ${zoomH}`,
            duration: 900,
            ease: 'out(3)',
        })
        tl.add(toFade, {
            opacity: 0,
            duration: 600,
            ease: 'in(2)',
        })
        tl.play()
    }

    zoomOutViewBox(svgSelector: string, svgW: number, svgH: number, onComplete?: () => void) {
        const to = `0 0 ${svgW} ${svgH}`
        const tl = this.timeline({ autoplay: false })
        tl.add(svgSelector, {
            viewBox: to,
            duration: 700,
            ease: 'out(3)',
        })
        tl.add('.centroid-group', {
            opacity: 1,
            duration: 500,
            ease: 'out(2)',
        })
        tl.play()
        if (onComplete) {
            setTimeout(onComplete, 700)
        }
    }
}

export const animator = new Animator()
