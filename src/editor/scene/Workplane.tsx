import { useMemo } from 'react'
import * as THREE from 'three'
import { useEditorStore } from '../state/store'

/**
 * Visual reference mirroring the gameplay arena (50x50 floor, 4m tall walls).
 * Clicking anywhere on it deselects (acts as "empty space").
 */
const ARENA_SIZE = 50
const ARENA_HALF = ARENA_SIZE / 2
const WALL_HEIGHT = 4

export function Workplane() {
    const deselect = () => useEditorStore.getState().select(null)

    return (
        <group onClick={(e) => { e.stopPropagation(); deselect() }}>
            {/* Floor plane slightly below y=0 so the drei Grid overlays on top cleanly. */}
            <mesh position={[0, -0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[ARENA_SIZE, ARENA_SIZE]} />
                <meshBasicMaterial color="#0d1013" transparent opacity={0.85} depthWrite={false} />
            </mesh>

            <ArenaWalls />

            <axesHelper args={[2.5]} />
        </group>
    )
}

function wallEdges(w: number, h: number, d: number) {
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d))
}

function ArenaWalls() {
    const geos = useMemo(
        () => ({
            side: wallEdges(0.1, WALL_HEIGHT, ARENA_SIZE),
            front: wallEdges(ARENA_SIZE, WALL_HEIGHT, 0.1),
        }),
        [],
    )

    return (
        <group>
            <lineSegments geometry={geos.side} position={[ARENA_HALF, WALL_HEIGHT / 2, 0]}>
                <lineBasicMaterial color="#334155" transparent opacity={0.55} />
            </lineSegments>
            <lineSegments geometry={geos.side} position={[-ARENA_HALF, WALL_HEIGHT / 2, 0]}>
                <lineBasicMaterial color="#334155" transparent opacity={0.55} />
            </lineSegments>
            <lineSegments geometry={geos.front} position={[0, WALL_HEIGHT / 2, ARENA_HALF]}>
                <lineBasicMaterial color="#334155" transparent opacity={0.55} />
            </lineSegments>
            <lineSegments geometry={geos.front} position={[0, WALL_HEIGHT / 2, -ARENA_HALF]}>
                <lineBasicMaterial color="#334155" transparent opacity={0.55} />
            </lineSegments>
        </group>
    )
}
