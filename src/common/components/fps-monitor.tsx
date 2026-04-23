import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import Stats from 'stats.js'

const statsRef: { current: Stats | null } = { current: null }

/**
 * Mounts a single stats.js panel in a fixed, controlled container.
 * Click the panel to cycle between FPS / MS / MB (classic stats.js behavior).
 */
export function FpsMonitorDisplay() {
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const stats = new Stats()
        stats.showPanel(0)

        const dom = stats.dom
        dom.style.position = 'relative'
        dom.style.top = ''
        dom.style.left = ''
        dom.style.cursor = 'pointer'
        dom.style.opacity = '0.9'
        container.appendChild(dom)

        statsRef.current = stats

        return () => {
            stats.dom.remove()
            statsRef.current = null
        }
    }, [])

    return (
        <div
            ref={containerRef}
            className="fps-monitor"
            style={{
                position: 'fixed',
                bottom: '10px',
                left: '10px',
                zIndex: 1000,
                pointerEvents: 'auto',
            }}
        />
    )
}

/** Inside <Canvas>: ticks the stats panel every frame. */
export function FpsMonitorCollector() {
    useFrame(() => {
        statsRef.current?.update()
    })
    return null
}
