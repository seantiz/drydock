import * as PIXI from 'pixi.js'
import { FillGradient, Color } from 'pixi.js'

type IdleEffect = (delta: number) => void

export type ScenePlanetData = {
    id: string
    cx: number
    cy: number
    arc: 'complete' | 'partial' | 'none'
    state: string
    externalId: string
    title: string
    strongly: SceneOrbiter[]
    loosely: SceneOrbiter[]
}

export type SceneOrbiter = {
    id: string
    x: number
    y: number
    source: string
    title: string
    isLoose?: boolean
}

export type SceneTopicData = {
    clusterId: number
    label: string
    cx: number
    cy: number
    members: SceneTopicMember[]
}

export type SceneTopicMember = {
    id: string
    x: number
    y: number
    state: string
    externalId: string
    title: string
}

export type SceneData =
    | { mode: 'issue'; name: string; planets: ScenePlanetData[]; width: number; height: number }
    | { mode: 'topic'; name: string; planets: SceneTopicData[]; width: number; height: number }

function globalColours(varName: string): string {
    const el = document.createElement('span')
    el.style.color = `var(${varName})`
    document.body.appendChild(el)
    const color = getComputedStyle(el).color
    el.remove()
    return color
}

export class Repospace {
    app: PIXI.Application | null = null
    ready = $state(false)

    world = new PIXI.Container()
    bgLayer = new PIXI.Container()
    midLayer = new PIXI.Container()
    nearLayer = new PIXI.Container()
    hudLayer = new PIXI.Container()

    private idleEffects: IdleEffect[] = []

    private tooltipRect: PIXI.Graphics | null = null
    private tooltipText: PIXI.Text | null = null

    private planetGroups = new Map<string, { elements: PIXI.Container[]; baseAlpha: number }>()
    private nameLabel: PIXI.Text | null = null
    private orbiterDots = new Map<
        string,
        { inner: PIXI.Graphics[]; outer: PIXI.Graphics[]; strongCount: number }
    >()
    private topicDots = new Map<number, PIXI.Graphics[]>()
    private focusedPlanetId: string | null = null

    onTooltip: ((text: string, x: number, y: number) => void) | null = null
    onClearTooltip: (() => void) | null = null
    onClickPlanet: ((id: string) => void) | null = null
    onClickPlanetoid: ((id: string, index: number) => void) | null = null
    onClickDrifter: ((id: string, index: number) => void) | null = null
    onClickTopicPlanet: ((clusterId: number) => void) | null = null
    onClickTopicMember: ((clusterId: number, index: number) => void) | null = null
    onClickBackground: (() => void) | null = null

    async init(canvasEl: HTMLCanvasElement, width: number, height: number): Promise<void> {
        const app = new PIXI.Application()
        await app.init({
            canvas: canvasEl,
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: window.devicePixelRatio || 1,
        })
        this.app = app
        this.ready = true

        this.app.stage.eventMode = 'static'
        this.app.stage.hitArea = this.app.screen

        this.world.addChild(this.bgLayer)
        this.world.addChild(this.midLayer)
        this.world.addChild(this.nearLayer)
        this.app.stage.addChild(this.world)
        this.app.stage.addChild(this.hudLayer)

        this.tooltipRect = new PIXI.Graphics()
        this.tooltipRect.visible = false
        this.tooltipText = new PIXI.Text({
            text: '',
            style: {
                fontSize: 10,
                fill: '#f8fafc',
                fontFamily: 'inherit',
            },
        })
        this.tooltipText.visible = false
        this.hudLayer.addChild(this.tooltipRect)
        this.hudLayer.addChild(this.tooltipText)

        this.app.stage.on('pointerdown', (e) => {
            if (e.target === this.app!.stage) {
                this.onClickBackground?.()
            }
        })

        this.app.ticker.add((ticker) => {
            const delta = ticker.deltaTime
            for (const effect of this.idleEffects) {
                effect(delta)
            }
        })
    }

    renderScene(data: SceneData): SceneData {
        this.clearScene()
        this.world.position.set(0, 0)
        this.world.scale.set(1)

        if (data.mode === 'topic') {
            this.renderTopicMode(data)
        } else {
            this.renderIssueMode(data)
        }
        return data
    }

    clearScene() {
        this.bgLayer.removeChildren()
        this.midLayer.removeChildren()
        this.nearLayer.removeChildren()
        this.hudLayer.removeChildren()
        this.idleEffects = []
        this.planetGroups.clear()
        this.orbiterDots.clear()
        this.topicDots.clear()
        this.nameLabel = null

        this.tooltipRect = new PIXI.Graphics()
        this.tooltipRect.visible = false
        this.tooltipText = new PIXI.Text({
            text: '',
            style: {
                fontSize: 10,
                fill: '#f8fafc',
                fontFamily: 'inherit',
            },
        })
        this.tooltipText.visible = false
        this.hudLayer.addChild(this.tooltipRect)
        this.hudLayer.addChild(this.tooltipText)
    }

    setViewBox(cx: number, cy: number, focusedId: string | null = null, panelOpen = false) {
        if (!this.app) return
        this.focusedPlanetId = focusedId

        const screenCX = this.app.screen.width * 0.375
        const screenCY = this.app.screen.height / 2
        const targetScale = 1.8
        const targetX = screenCX - cx * targetScale
        const targetY = screenCY - cy * targetScale

        const startX = this.world.x
        const startY = this.world.y
        const startScale = this.world.scale.x
        const duration = 500
        const fadeDuration = 600
        const start = performance.now()
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

        const startAlphas = new Map<string, number>()
        for (const [id, group] of this.planetGroups) {
            startAlphas.set(id, group.elements[0]?.alpha ?? group.baseAlpha)
        }
        const startLabelAlpha = this.nameLabel?.alpha ?? 1

        const animate = () => {
            const elapsed = performance.now() - start
            const t = Math.min(elapsed / duration, 1)
            const eased = easeOutCubic(t)
            this.world.x = startX + (targetX - startX) * eased
            this.world.y = startY + (targetY - startY) * eased
            this.world.scale.set(startScale + (targetScale - startScale) * eased)

            const fadeT = Math.min(elapsed / fadeDuration, 1)
            const fadeEased = easeOutCubic(fadeT)
            for (const [id, group] of this.planetGroups) {
                const startAlpha = startAlphas.get(id) ?? group.baseAlpha
                const target = id === focusedId ? 1 : 0
                for (const el of group.elements) {
                    el.alpha = startAlpha + (target - startAlpha) * fadeEased
                }
            }
            if (this.nameLabel) {
                this.nameLabel.alpha = startLabelAlpha + (0 - startLabelAlpha) * fadeEased
            }

            if (t < 1) requestAnimationFrame(animate)
        }
        requestAnimationFrame(animate)
    }

    resetView() {
        this.focusedPlanetId = null
        const startX = this.world.x
        const startY = this.world.y
        const startScale = this.world.scale.x
        const duration = 700
        const fadeDuration = 500
        const start = performance.now()
        const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

        const startAlphas = new Map<string, number>()
        for (const [id, group] of this.planetGroups) {
            startAlphas.set(id, group.elements[0]?.alpha ?? 0)
        }
        const startLabelAlpha = this.nameLabel?.alpha ?? 0

        const animate = () => {
            const elapsed = performance.now() - start
            const t = Math.min(elapsed / duration, 1)
            const eased = easeOutCubic(t)
            this.world.x = startX * (1 - eased)
            this.world.y = startY * (1 - eased)
            this.world.scale.set(startScale + (1 - startScale) * eased)

            const fadeT = Math.min(elapsed / fadeDuration, 1)
            const fadeEased = easeOutCubic(fadeT)
            for (const [id, group] of this.planetGroups) {
                const startAlpha = startAlphas.get(id) ?? 0
                for (const el of group.elements) {
                    el.alpha = startAlpha + (group.baseAlpha - startAlpha) * fadeEased
                }
            }
            if (this.nameLabel) {
                this.nameLabel.alpha = startLabelAlpha + (1 - startLabelAlpha) * fadeEased
            }

            if (t < 1) requestAnimationFrame(animate)
        }
        requestAnimationFrame(animate)
    }

    showTooltip(text: string, x: number, y: number) {
        if (!this.tooltipRect || !this.tooltipText || !this.app) return

        const rectWidth = Math.min(250, text.length * 5.5 + 12)
        const rectX = Math.min(x - 4, this.app.screen.width - 260)

        this.tooltipRect.clear()
        this.tooltipRect.roundRect(rectX, y - 16, rectWidth, 20, 4)
        this.tooltipRect.fill({ color: 0x1e293b, alpha: 0.95 })
        this.tooltipRect.visible = true

        this.tooltipText.text = text
        this.tooltipText.x = Math.min(x, this.app.screen.width - 256)
        this.tooltipText.y = y - 2
        this.tooltipText.visible = true
    }

    hideTooltip() {
        if (this.tooltipRect) this.tooltipRect.visible = false
        if (this.tooltipText) this.tooltipText.visible = false
    }

    highlightOrbiter(id: string | number | null, memberIndex: number) {
        if (id === null) {
            for (const { inner, outer } of this.orbiterDots.values()) {
                for (const dot of inner) {
                    dot.scale.set(1)
                    dot.alpha = 0.85
                }
                for (const dot of outer) {
                    dot.scale.set(1)
                    dot.alpha = 0.55
                }
            }
            for (const dots of this.topicDots.values()) {
                for (const dot of dots) {
                    dot.scale.set(1)
                    dot.alpha = 0.8
                }
            }
            return
        }
        if (typeof id === 'number') {
            for (const dots of this.topicDots.values()) {
                for (const dot of dots) {
                    dot.scale.set(1)
                    dot.alpha = 0.8
                }
            }
            const dots = this.topicDots.get(id)
            if (!dots) return
            for (const dot of dots) dot.alpha = 0.3
            const target = dots[memberIndex]
            if (target) {
                target.scale.set(1.9)
                target.alpha = 1
            }
        } else {
            for (const { inner, outer } of this.orbiterDots.values()) {
                for (const dot of inner) {
                    dot.scale.set(1)
                    dot.alpha = 0.85
                }
                for (const dot of outer) {
                    dot.scale.set(1)
                    dot.alpha = 0.55
                }
            }
            if (memberIndex === 0) return
            const entry = this.orbiterDots.get(id)
            if (!entry) return
            const { inner, outer, strongCount } = entry
            const orbiterIdx = memberIndex - 1
            if (orbiterIdx < strongCount) {
                for (const dot of inner) dot.alpha = 0.3
                const target = inner[orbiterIdx]
                if (target) {
                    target.scale.set(1.9)
                    target.alpha = 1
                }
            } else {
                for (const dot of outer) dot.alpha = 0.2
                const target = outer[orbiterIdx - strongCount]
                if (target) {
                    target.scale.set(1.9)
                    target.alpha = 1
                }
            }
        }
    }

    destroy() {
        this.app?.destroy(true)
        this.app = null
        this.idleEffects = []
    }

    private arcColor(arc: 'complete' | 'partial' | 'none'): number {
        if (arc === 'complete') return 0x10b981
        if (arc === 'partial') return 0xf59e0b
        return 0xef4444
    }

    private sourceColor(source: string): number {
        switch (source) {
            case 'pr':
                return 0x8b5cf6
            case 'release':
                return 0x10b981
            case 'discussion':
                return 0xf59e0b
            default:
                return 0x94a3b8
        }
    }

    private renderTopicMode(data: {
        mode: 'topic'
        name: string
        planets: SceneTopicData[]
        width: number
        height: number
    }) {
        const logoRecon = globalColours('--logo-recon')
        const logoRescue = globalColours('--logo-rescue')
        const logoRebuild = globalColours('--logo-rebuild')

        const title = new PIXI.Text({
            text: data.name,
            style: {
                fontSize: 19,
                fill: logoRecon,
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
                fontWeight: '600',
            },
        })
        title.x = 14
        title.y = 12
        this.nearLayer.addChild(title)
        this.nameLabel = title

        for (let ti = 0; ti < data.planets.length; ti++) {
            const tc = data.planets[ti]
            const phase = ti * 0.9

            // Mooring buoy dimensions
            const BUOY_RX = 14 // float body half-width
            const BUOY_RY = 7 // float body half-height (foreshortened cylinder top)
            const BUOY_DEPTH = 5 // cylinder thickness
            const STRIPE_RY = 2 // horizontal warning stripe half-height

            // Ambient glow
            const glow = new PIXI.Graphics()
            glow.circle(tc.cx, tc.cy, 22)
            glow.fill({ color: logoRebuild, alpha: 1 })
            glow.alpha = 0.07
            this.bgLayer.addChild(glow)

            // Member dots — scattered around the buoy at any angle
            const memberDots: PIXI.Graphics[] = []
            for (let mi = 0; mi < tc.members.length; mi++) {
                const m = tc.members[mi]
                const dotGrad = new FillGradient({
                    type: 'radial',
                    center: { x: 0.3, y: 0.3 },
                    innerRadius: 0,
                    outerCenter: { x: 0.3, y: 0.3 },
                    outerRadius: 0.5,
                    colorStops: [
                        { offset: 0, color: 'rgba(255,255,255,0.35)' },
                        { offset: 1, color: 'rgba(255,255,255,0)' },
                    ],
                })
                const dot = new PIXI.Graphics()
                dot.circle(0, 0, 5)
                dot.fill({ color: logoRescue, alpha: m.state === 'open' ? 0.8 : 0.35 })
                dot.circle(-1.5, -1.5, 2)
                dot.fill(dotGrad)
                dot.x = m.x
                dot.y = m.y
                dot.eventMode = 'static'
                dot.cursor = 'pointer'
                dot.on('pointerenter', (e) =>
                    this.onTooltip?.(`#${m.externalId}: ${m.title}`, e.globalX, e.globalY - 12)
                )
                dot.on('pointerleave', () => this.onClearTooltip?.())
                dot.on('pointerdown', () => this.onClickTopicMember?.(tc.clusterId, mi))
                this.nearLayer.addChild(dot)
                memberDots.push(dot)
            }
            this.topicDots.set(tc.clusterId, memberDots)

            // Buoy body container
            const buoyContainer = new PIXI.Container()
            buoyContainer.x = tc.cx
            buoyContainer.y = tc.cy

            const body = new PIXI.Container()

            // Underside rim
            const rimColor = new Color(logoRebuild).multiply(new Color(0x1e293b)).toNumber()
            const underside = new PIXI.Graphics()
            underside.ellipse(0, BUOY_DEPTH, BUOY_RX - 1, BUOY_RY)
            underside.fill({ color: rimColor, alpha: 0.9 })
            body.addChild(underside)

            // Top face — main cylinder top
            const topFaceGrad = new FillGradient({
                type: 'radial',
                center: { x: 0.3, y: 0.3 },
                innerRadius: 0,
                outerCenter: { x: 0.5, y: 0.5 },
                outerRadius: 0.7,
                colorStops: [
                    { offset: 0, color: new Color(logoRebuild).setAlpha(0.95).toHexa() },
                    { offset: 0.65, color: new Color(logoRebuild).setAlpha(0.8).toHexa() },
                    {
                        offset: 1,
                        color: new Color(logoRebuild)
                            .multiply(new Color(0x1e293b))
                            .setAlpha(0.9)
                            .toHexa(),
                    },
                ],
            })
            const topFace = new PIXI.Graphics()
            topFace.ellipse(0, 0, BUOY_RX, BUOY_RY)
            topFace.fill(topFaceGrad)
            topFace.eventMode = 'static'
            topFace.cursor = 'pointer'
            topFace.on('pointerenter', () =>
                this.onTooltip?.(tc.label, tc.cx, tc.cy - BUOY_RY - 14)
            )
            topFace.on('pointerleave', () => this.onClearTooltip?.())
            topFace.on('pointerdown', () => this.onClickTopicPlanet?.(tc.clusterId))
            body.addChild(topFace)

            // Warning stripe — horizontal band across the cylinder body, classic buoy detail
            const stripeGrad = new FillGradient({
                type: 'radial',
                center: { x: 0.3, y: 0.3 },
                innerRadius: 0,
                outerCenter: { x: 0.5, y: 0.5 },
                outerRadius: 0.7,
                colorStops: [
                    { offset: 0, color: 'rgba(255,255,255,0.3)' },
                    { offset: 1, color: 'rgba(255,255,255,0.05)' },
                ],
            })
            const stripe = new PIXI.Graphics()
            stripe.ellipse(0, BUOY_DEPTH * 0.5, BUOY_RX, STRIPE_RY)
            stripe.fill(stripeGrad)
            body.addChild(stripe)

            // Specular catch
            const specGrad = new FillGradient({
                type: 'radial',
                center: { x: 0.3, y: 0.3 },
                innerRadius: 0,
                outerCenter: { x: 0.3, y: 0.3 },
                outerRadius: 0.5,
                colorStops: [
                    { offset: 0, color: 'rgba(255,255,255,0.6)' },
                    { offset: 1, color: 'rgba(255,255,255,0)' },
                ],
            })
            const specular = new PIXI.Graphics()
            specular.ellipse(-BUOY_RX * 0.35, -BUOY_RY * 0.45, BUOY_RX * 0.28, BUOY_RY * 0.28)
            specular.fill(specGrad)
            body.addChild(specular)

            // Mooring chain stub — short vertical line below the body
            const chain = new PIXI.Graphics()
            chain.moveTo(0, BUOY_DEPTH + BUOY_RY)
            chain.lineTo(0, BUOY_DEPTH + BUOY_RY + 10)
            chain.stroke({ color: rimColor, width: 1.5, alpha: 0.5 })
            body.addChild(chain)

            buoyContainer.addChild(body)

            // Label
            const labelText = new PIXI.Text({
                text: tc.label,
                style: {
                    fontSize: 9,
                    fill: logoRebuild,
                    wordWrap: true,
                    wordWrapWidth: 90,
                    align: 'center',
                },
            })
            labelText.alpha = 0.8
            labelText.anchor.set(0.5, 0)
            labelText.y = BUOY_DEPTH + BUOY_RY + 16
            buoyContainer.addChild(labelText)

            this.midLayer.addChild(buoyContainer)

            this.planetGroups.set(`topic-${tc.clusterId}`, {
                elements: [glow, ...memberDots, buoyContainer],
                baseAlpha: 1,
            })

            this.idleEffects.push((_delta) => {
                const t = this.app!.ticker.lastTime
                // Buoy bobs on water — gentle vertical sine, slight rotation
                buoyContainer.y = tc.cy + Math.sin(t * 0.001 + phase) * 2.5
                buoyContainer.rotation = Math.sin(t * 0.0008 + phase + 1) * 0.04

                if (
                    this.focusedPlanetId === null ||
                    this.focusedPlanetId === `topic-${tc.clusterId}`
                ) {
                    glow.alpha = 0.05 + Math.abs(Math.sin(t * 0.002 + phase + 0.8)) * 0.1
                }
            })
        }
    }

    private renderIssueMode(data: {
        mode: 'issue'
        name: string
        planets: ScenePlanetData[]
        width: number
        height: number
    }) {
        const FORESHORTEN = 0.28
        const DC_RX = 20
        const DC_RY = 10
        const DC_DEPTH = 7
        const RING_INNER_RX = 78
        const RING_OUTER_RX = 100

        const title = new PIXI.Text({
            text: data.name,
            style: {
                fontSize: 14,
                fill: '#94a3b8',
                fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
                fontWeight: '600',
            },
        })
        title.x = 14
        title.y = 12
        this.nearLayer.addChild(title)
        this.nameLabel = title

        for (let pi = 0; pi < data.planets.length; pi++) {
            const pc = data.planets[pi]
            const color = this.arcColor(pc.arc)
            const isClosed = pc.state !== 'open'
            const baseAlpha = isClosed ? 0.5 : 0.9
            const phase = pi * 0.7

            // Ambient glow beneath the charge
            const glow = new PIXI.Graphics()
            glow.ellipse(pc.cx, pc.cy + DC_DEPTH, DC_RX * 2.2, DC_RX * 2.2 * FORESHORTEN * 1.4)
            glow.fill({ color, alpha: 1 })
            glow.alpha = 0.06
            this.bgLayer.addChild(glow)

            // Static pressure rings — mark the orbiter radii
            let innerRing: PIXI.Graphics | undefined
            let outerRing: PIXI.Graphics | undefined
            if (pc.strongly.length > 0) {
                innerRing = new PIXI.Graphics()
                innerRing.ellipse(pc.cx, pc.cy, RING_INNER_RX, RING_INNER_RX * FORESHORTEN)
                innerRing.stroke({ color, width: 1.5, alpha: 0.22 })
                this.bgLayer.addChild(innerRing)
            }
            if (pc.loosely.length > 0) {
                outerRing = new PIXI.Graphics()
                outerRing.ellipse(pc.cx, pc.cy, RING_OUTER_RX, RING_OUTER_RX * FORESHORTEN)
                outerRing.stroke({ color, width: 1, alpha: 0.13 })
                this.bgLayer.addChild(outerRing)
            }

            // Animated pressure wave rings
            const waveRings: PIXI.Graphics[] = []
            for (let wi = 0; wi < 3; wi++) {
                const wave = new PIXI.Graphics()
                this.bgLayer.addChild(wave)
                waveRings.push(wave)
            }

            // Orbiter dots — sit on static rings, no rotation
            const innerDots: PIXI.Graphics[] = []
            for (let oi = 0; oi < pc.strongly.length; oi++) {
                const o = pc.strongly[oi]
                const oColor = this.sourceColor(o.source)
                const specGrad = new FillGradient({
                    type: 'radial',
                    center: { x: 0.3, y: 0.3 },
                    innerRadius: 0,
                    outerCenter: { x: 0.3, y: 0.3 },
                    outerRadius: 0.5,
                    colorStops: [
                        { offset: 0, color: 'rgba(255,255,255,0.4)' },
                        { offset: 1, color: 'rgba(255,255,255,0)' },
                    ],
                })
                const dot = new PIXI.Graphics()
                dot.circle(0, 0, 5)
                dot.fill({ color: oColor, alpha: 0.85 })
                dot.circle(-1.5, -1.5, 2)
                dot.fill(specGrad)
                dot.x = o.x
                dot.y = o.y
                dot.eventMode = 'static'
                dot.cursor = 'pointer'
                dot.on('pointerenter', (e) => this.onTooltip?.(o.title, e.globalX, e.globalY - 12))
                dot.on('pointerleave', () => this.onClearTooltip?.())
                dot.on('pointerdown', () => this.onClickPlanetoid?.(pc.id, oi))
                this.nearLayer.addChild(dot)
                innerDots.push(dot)
            }

            const outerDots: PIXI.Graphics[] = []
            for (let wi = 0; wi < pc.loosely.length; wi++) {
                const w = pc.loosely[wi]
                const wColor = this.sourceColor(w.source)
                const specGrad = new FillGradient({
                    type: 'radial',
                    center: { x: 0.3, y: 0.3 },
                    innerRadius: 0,
                    outerCenter: { x: 0.3, y: 0.3 },
                    outerRadius: 0.5,
                    colorStops: [
                        { offset: 0, color: 'rgba(255,255,255,0.3)' },
                        { offset: 1, color: 'rgba(255,255,255,0)' },
                    ],
                })
                const dot = new PIXI.Graphics()
                dot.circle(0, 0, 4)
                dot.fill({ color: wColor, alpha: 0.55 })
                dot.circle(-1, -1, 1.5)
                dot.fill(specGrad)
                dot.x = w.x
                dot.y = w.y
                dot.eventMode = 'static'
                dot.cursor = 'pointer'
                dot.on('pointerenter', (e) => this.onTooltip?.(w.title, e.globalX, e.globalY - 10))
                dot.on('pointerleave', () => this.onClearTooltip?.())
                dot.on('pointerdown', () => this.onClickDrifter?.(pc.id, wi))
                this.nearLayer.addChild(dot)
                outerDots.push(dot)
            }

            this.orbiterDots.set(pc.id, {
                inner: innerDots,
                outer: outerDots,
                strongCount: pc.strongly.length,
            })

            // Depth charge body
            const chargeContainer = new PIXI.Container()
            chargeContainer.x = pc.cx
            chargeContainer.y = pc.cy

            const body = new PIXI.Container()

            // Underside rim — gives cylinder depth, draw before top face
            const rimColor = new Color(color).multiply(new Color(0x334155)).toNumber()
            const underside = new PIXI.Graphics()
            underside.ellipse(0, DC_DEPTH, DC_RX - 1, DC_RY)
            underside.fill({ color: rimColor, alpha: baseAlpha * 0.9 })
            body.addChild(underside)

            // Cylinder side band
            const side = new PIXI.Graphics()
            side.ellipse(0, DC_DEPTH * 0.5, DC_RX, DC_RY * 0.6)
            side.fill({ color: rimColor, alpha: baseAlpha * 0.6 })
            body.addChild(side)

            // Top face — main surface, hit target
            const topFaceGrad = new FillGradient({
                type: 'radial',
                center: { x: 0.3, y: 0.3 },
                innerRadius: 0,
                outerCenter: { x: 0.5, y: 0.5 },
                outerRadius: 0.7,
                colorStops: [
                    { offset: 0, color: new Color(color).setAlpha(baseAlpha).toHexa() },
                    { offset: 0.6, color: new Color(color).setAlpha(baseAlpha * 0.85).toHexa() },
                    {
                        offset: 1,
                        color: new Color(color)
                            .multiply(new Color(0x1e293b))
                            .setAlpha(baseAlpha)
                            .toHexa(),
                    },
                ],
            })
            const topFace = new PIXI.Graphics()
            topFace.ellipse(0, 0, DC_RX, DC_RY)
            topFace.fill(topFaceGrad)
            topFace.eventMode = 'static'
            topFace.cursor = 'pointer'
            topFace.on('pointerenter', () =>
                this.onTooltip?.(`#${pc.externalId}: ${pc.title}`, pc.cx, pc.cy - DC_RY - 14)
            )
            topFace.on('pointerleave', () => this.onClearTooltip?.())
            topFace.on('pointerdown', () => this.onClickPlanet?.(pc.id))
            body.addChild(topFace)

            // Specular catch — top-left highlight
            const specGrad = new FillGradient({
                type: 'radial',
                center: { x: 0.3, y: 0.3 },
                innerRadius: 0,
                outerCenter: { x: 0.3, y: 0.3 },
                outerRadius: 0.5,
                colorStops: [
                    { offset: 0, color: 'rgba(255,255,255,0.55)' },
                    { offset: 1, color: 'rgba(255,255,255,0)' },
                ],
            })
            const specular = new PIXI.Graphics()
            specular.ellipse(-DC_RX * 0.35, -DC_RY * 0.45, DC_RX * 0.28, DC_RY * 0.28)
            specular.fill(specGrad)
            body.addChild(specular)

            // Tail fins — silhouette detail only, no interaction
            const finColor = new Color(color).multiply(new Color(0x0f172a)).toNumber()
            const finL = new PIXI.Graphics()
            finL.ellipse(-DC_RX * 0.45, DC_DEPTH + DC_RY * 0.8, DC_RX * 0.38, DC_RY * 0.22)
            finL.fill({ color: finColor, alpha: baseAlpha * 0.75 })
            body.addChild(finL)

            const finR = new PIXI.Graphics()
            finR.ellipse(DC_RX * 0.45, DC_DEPTH + DC_RY * 0.8, DC_RX * 0.38, DC_RY * 0.22)
            finR.fill({ color: finColor, alpha: baseAlpha * 0.75 })
            body.addChild(finR)

            chargeContainer.addChild(body)

            // Issue number + title labels
            const issueText = new PIXI.Text({
                text: `#${pc.externalId}`,
                style: {
                    fontSize: 9,
                    fontWeight: '700',
                    fill: '#' + color.toString(16).padStart(6, '0'),
                },
            })
            issueText.anchor.set(0.5, 0)
            issueText.alpha = 0.7
            issueText.y = DC_DEPTH + DC_RY + 6
            chargeContainer.addChild(issueText)

            const titleStr = pc.title.length > 22 ? pc.title.substring(0, 22) + '\u2026' : pc.title
            const titleText = new PIXI.Text({
                text: titleStr,
                style: { fontSize: 9, fill: '#' + color.toString(16).padStart(6, '0') },
            })
            titleText.alpha = 0.6
            titleText.anchor.set(0.5, 0)
            titleText.y = DC_DEPTH + DC_RY + 18
            chargeContainer.addChild(titleText)

            this.midLayer.addChild(chargeContainer)

            this.planetGroups.set(pc.id, {
                elements: [
                    glow,
                    innerRing,
                    outerRing,
                    ...waveRings,
                    ...innerDots,
                    ...outerDots,
                    chargeContainer,
                ].filter((el): el is PIXI.Container => el !== undefined),
                baseAlpha,
            })

            this.idleEffects.push((_delta) => {
                const t = this.app!.ticker.lastTime

                // Subtle bob
                chargeContainer.y = pc.cy + Math.sin(t * 0.0012 + phase) * 1.2

                // Glow pulse
                if (this.focusedPlanetId === null || this.focusedPlanetId === pc.id) {
                    glow.alpha = 0.04 + Math.abs(Math.sin(t * 0.0018 + phase)) * 0.1
                }

                // Pressure wave rings — 3 rings pulse outward sequentially
                const WAVE_PERIOD = 4200
                const MAX_RX = RING_OUTER_RX * 1.35
                for (let wi = 0; wi < 3; wi++) {
                    const waveT =
                        ((t + phase * 800 + (wi * WAVE_PERIOD) / 3) % WAVE_PERIOD) / WAVE_PERIOD
                    const rx = waveT * MAX_RX
                    const ry = rx * FORESHORTEN
                    const alpha =
                        waveT < 0.15
                            ? (waveT / 0.15) * 0.18
                            : waveT > 0.7
                              ? (1 - (waveT - 0.7) / 0.3) * 0.18
                              : 0.18
                    const strokeWidth = Math.max(0.3, 1.5 - waveT * 1.2)
                    waveRings[wi].clear()
                    waveRings[wi].ellipse(pc.cx, pc.cy, rx, ry)
                    waveRings[wi].stroke({ color, width: strokeWidth, alpha })
                }
            })
        }
    }
}
