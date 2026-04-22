import { RigidBody } from '@react-three/rapier'
import { useEffect, useState } from 'react'
import { CATEGORY_DEFAULTS } from './colliderFactory'
import type { Instance, LevelFile } from './types'

interface LevelLoaderProps {
    src: string
}

/**
 * Fetches a level JSON and renders every instance as a Rapier rigid body.
 * Fase 0: suporta apenas placeholders (`primitives/*`) — GLBs chegam na próxima fase.
 */
export function LevelLoader({ src }: LevelLoaderProps) {
    const [level, setLevel] = useState<LevelFile | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setError(null)
        setLevel(null)

        fetch(src)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status} ao carregar ${src}`)
                return r.json()
            })
            .then((data: LevelFile) => {
                if (cancelled) return
                if (data.version !== 1) throw new Error(`Level version ${data.version} não suportada`)
                setLevel(data)
            })
            .catch((err) => {
                if (cancelled) return
                console.error('[LevelLoader]', err)
                setError(String(err))
            })

        return () => {
            cancelled = true
        }
    }, [src])

    if (error) {
        console.warn(`[LevelLoader] falhou em carregar ${src}: ${error}`)
        return null
    }
    if (!level) return null

    return (
        <group>
            {level.instances.map((inst) => (
                <LevelInstance key={inst.id} instance={inst} />
            ))}
        </group>
    )
}

function LevelInstance({ instance }: { instance: Instance }) {
    const { category, position, rotation, scale, props, assetId } = instance
    const defaults = CATEGORY_DEFAULTS[category]
    const mass = props?.mass ?? defaults.defaultMass

    return (
        <RigidBody
            type={defaults.bodyType}
            position={position}
            rotation={rotation}
            colliders="cuboid"
            mass={mass}
            friction={0.5}
            restitution={0}
        >
            <PlaceholderMesh assetId={assetId} scale={scale} color={defaults.debugColor} />
        </RigidBody>
    )
}

function PlaceholderMesh({
    assetId,
    scale,
    color,
}: {
    assetId: string
    scale: [number, number, number]
    color: string
}) {
    const kind = assetId.startsWith('primitives/') ? assetId.slice('primitives/'.length) : 'cube'

    return (
        <mesh castShadow receiveShadow scale={scale}>
            {kind === 'sphere' ? (
                <sphereGeometry args={[0.5, 24, 16]} />
            ) : kind === 'cylinder' ? (
                <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
            ) : (
                <boxGeometry args={[1, 1, 1]} />
            )}
            <meshStandardMaterial color={color} roughness={0.8} metalness={0.05} />
        </mesh>
    )
}
