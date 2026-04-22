import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'

const FPS_VALUE_ID = 'fps-monitor-value'

/** Inside `<Canvas>`: counts r3f frames and updates the DOM label once per second. */
export function FpsMonitorCollector() {
    const acc = useRef({ frames: 0, time: performance.now() })

    useFrame(() => {
        const a = acc.current
        a.frames++
        const now = performance.now()
        if (now - a.time < 1000) return

        const fps = Math.round((a.frames * 1000) / (now - a.time))
        a.frames = 0
        a.time = now

        const node = document.getElementById(FPS_VALUE_ID)
        if (node) node.textContent = `${fps} FPS`
    })

    return null
}

/** HTML overlay; place a sibling before `<Canvas>` so the id exists when the collector runs. */
export function FpsMonitorDisplay() {
    return (
        <div
            style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '13px',
                fontFamily: 'monospace',
                userSelect: 'none',
                zIndex: 1000,
                pointerEvents: 'none',
                background: 'rgba(0, 0, 0, 0.35)',
                padding: '6px 10px',
                borderRadius: '4px',
                letterSpacing: '0.5px',
            }}
        >
            <span id={FPS_VALUE_ID}>-- FPS</span>
        </div>
    )
}
