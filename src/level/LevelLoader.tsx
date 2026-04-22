import { useGLTF } from '@react-three/drei'
import { RapierRigidBody, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { getAssetMeta, resolveAssetUrl, resolveFracturedAssetId } from './asset-catalog'
import { CATEGORY_DEFAULTS } from './colliderFactory'
import type { Instance, LevelFile } from './types'

interface LevelLoaderProps {
    src: string
}

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
    const meta = getAssetMeta(assetId)
    const mass = props?.mass ?? meta?.mass ?? defaults.defaultMass

    if (category === 'breakable') {
        return <BreakableInstance instance={instance} />
    }

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
            <group scale={scale}>
                <AssetMesh assetId={assetId} color={defaults.debugColor} />
            </group>
        </RigidBody>
    )
}

function AssetMesh({
    assetId,
    color,
}: {
    assetId: string
    color: string
}) {
    if (!assetId.startsWith('primitives/')) {
        return <GlbMesh assetId={assetId} />
    }

    const kind = assetId.slice('primitives/'.length)

    return (
        <mesh castShadow receiveShadow>
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

function GlbMesh({ assetId }: { assetId: string }) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)
    const sceneClone = useMemo(() => {
        const clone = gltf.scene.clone(true)
        clone.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.isMesh) {
                mesh.castShadow = true
                mesh.receiveShadow = true
            }
        })
        return clone
    }, [gltf.scene])

    return <primitive object={sceneClone} />
}

interface ContactForcePayload {
    totalForceMagnitude?: number
    maxForceMagnitude?: number
    maxForceDirection?: { x: number; y: number; z: number }
}

function BreakableInstance({ instance }: { instance: Instance }) {
    const { position, rotation, scale, assetId, props } = instance
    const meta = getAssetMeta(assetId)

    const [broken, setBroken] = useState(false)
    const [showDebris, setShowDebris] = useState(false)
    const brokenRef = useRef(false)
    const impulseRef = useRef<[number, number, number]>([0, 3, 0])

    const fractureThreshold = props?.fractureThreshold ?? meta?.fractureThreshold ?? 28
    const fracturedAssetId = resolveFracturedAssetId(assetId, props?.fracturedAssetId ?? meta?.fracturedAssetId)
    const debrisMass = props?.debrisMass ?? meta?.debrisMass ?? 0.55
    const debrisLifetimeMs = props?.debrisLifetimeMs ?? meta?.debrisLifetimeMs ?? 7000
    const baseMass = props?.mass ?? meta?.mass ?? CATEGORY_DEFAULTS.breakable.defaultMass

    useEffect(() => {
        if (!broken) return
        setShowDebris(true)
        if (debrisLifetimeMs <= 0) return
        const t = window.setTimeout(() => setShowDebris(false), debrisLifetimeMs)
        return () => window.clearTimeout(t)
    }, [broken, debrisLifetimeMs])

    return (
        <group position={position} rotation={rotation}>
            {!broken && (
                <RigidBody
                    type="dynamic"
                    colliders="cuboid"
                    mass={baseMass}
                    friction={0.5}
                    restitution={0}
                    onContactForce={(payload: ContactForcePayload) => {
                        if (brokenRef.current) return
                        const total = payload.totalForceMagnitude ?? 0
                        if (total < fractureThreshold) return

                        const d = payload.maxForceDirection
                        const dir = new THREE.Vector3(d?.x ?? 0, d?.y ?? 1, d?.z ?? 0)
                        if (dir.lengthSq() < 0.0001) dir.set(0, 1, 0)
                        dir.normalize()

                        const m = payload.maxForceMagnitude ?? total
                        const strength = THREE.MathUtils.clamp(m * 0.04, 2.5, 20)
                        impulseRef.current = [
                            dir.x * strength,
                            Math.max(2, dir.y * strength + 2),
                            dir.z * strength,
                        ]

                        brokenRef.current = true
                        setBroken(true)
                    }}
                >
                    <group scale={scale}>
                        <AssetMesh assetId={assetId} color={CATEGORY_DEFAULTS.breakable.debugColor} />
                    </group>
                </RigidBody>
            )}

            {broken && showDebris && (
                <FracturedDebris assetId={fracturedAssetId} scale={scale} baseImpulse={impulseRef.current} mass={debrisMass} />
            )}
        </group>
    )
}

function FracturedDebris({
    assetId,
    scale,
    baseImpulse,
    mass,
}: {
    assetId: string
    scale: [number, number, number]
    baseImpulse: [number, number, number]
    mass: number
}) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)

    const parts = useMemo(() => {
        const meshes: THREE.Mesh[] = []
        gltf.scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.castShadow = true
            mesh.receiveShadow = true
            meshes.push(mesh)
        })
        return meshes.map((m) => m.clone(true))
    }, [gltf.scene])

    return (
        <group scale={scale}>
            {parts.map((part, idx) => (
                <DebrisPiece key={`${assetId}-${idx}`} mesh={part} baseImpulse={baseImpulse} mass={mass} />
            ))}
        </group>
    )
}

function DebrisPiece({
    mesh,
    baseImpulse,
    mass,
}: {
    mesh: THREE.Mesh
    baseImpulse: [number, number, number]
    mass: number
}) {
    const ref = useRef<RapierRigidBody>(null)

    useEffect(() => {
        if (!ref.current) return
        const jitter = new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            Math.random() * 1.1,
            (Math.random() - 0.5) * 1.2,
        )
        const impulse = new THREE.Vector3(baseImpulse[0], baseImpulse[1], baseImpulse[2]).add(jitter)
        ref.current.applyImpulse(impulse, true)
        ref.current.applyTorqueImpulse(
            new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
            true,
        )
    }, [baseImpulse])

    return (
        <RigidBody
            ref={ref}
            type="dynamic"
            colliders="hull"
            mass={mass}
            friction={0.6}
            restitution={0.1}
            position={[mesh.position.x, mesh.position.y, mesh.position.z]}
            rotation={[mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]}
        >
            <primitive object={mesh} />
        </RigidBody>
    )
}
