import { useGLTF } from '@react-three/drei'
import { ConvexHullCollider, RapierRigidBody, RigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { getAssetMeta, resolveAssetUrl, resolveFracturedAssetId } from './asset-catalog'
import { CATEGORY_DEFAULTS } from './colliderFactory'
import type { Instance, LevelFile, LightKind, Vec3 } from './types'

interface LevelLoaderProps {
    src: string
    /** Overrides fractureThreshold for every breakable. 0 = indestructible. */
    breakableThresholdOverride?: number
}

export function LevelLoader({ src, breakableThresholdOverride }: LevelLoaderProps) {
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

    const fracturedUrls = useMemo(() => {
        if (!level) return []
        const urls = new Set<string>()
        for (const inst of level.instances) {
            if (inst.category !== 'breakable') continue
            const meta = getAssetMeta(inst.assetId)
            const fracturedId = resolveFracturedAssetId(
                inst.assetId,
                inst.props?.fracturedAssetId ?? meta?.fracturedAssetId,
            )
            if (fracturedId) urls.add(resolveAssetUrl(fracturedId))
        }
        return Array.from(urls)
    }, [level])

    if (error) {
        console.warn(`[LevelLoader] falhou em carregar ${src}: ${error}`)
        return null
    }
    if (!level) return null

    return (
        <group>
            {fracturedUrls.map((url) => (
                <FracturePrewarm key={url} url={url} />
            ))}
            {level.instances.map((inst) => (
                <LevelInstance
                    key={inst.id}
                    instance={inst}
                    breakableThresholdOverride={breakableThresholdOverride}
                />
            ))}
        </group>
    )
}

/**
 * Renders each unique fractured GLB once, far below the map, so three.js/WebGL
 * compile the programs/materials before the player breaks anything. Unmounts
 * itself after ~2 frames.
 */
function FracturePrewarm({ url }: { url: string }) {
    const gltf = useGLTF(url)
    const sceneClone = useMemo(() => gltf.scene.clone(true), [gltf.scene])
    const [done, setDone] = useState(false)

    useEffect(() => {
        let second = 0
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => setDone(true))
        })
        return () => {
            cancelAnimationFrame(first)
            if (second) cancelAnimationFrame(second)
        }
    }, [])

    if (done) return null
    return <primitive object={sceneClone} position={[0, -10000, 0]} />
}

function LevelInstance({
    instance,
    breakableThresholdOverride,
}: {
    instance: Instance
    breakableThresholdOverride?: number
}) {
    const { category, position, rotation, scale, props, assetId } = instance
    const defaults = CATEGORY_DEFAULTS[category]
    const meta = getAssetMeta(assetId)
    const mass = props?.mass ?? meta?.mass ?? defaults.defaultMass

    if (category === 'light') {
        return <LightInstance instance={instance} />
    }

    if (category === 'no-collision') {
        return (
            <group position={position} rotation={rotation}>
                <group scale={scale}>
                    <AssetMesh assetId={assetId} color={defaults.debugColor} />
                </group>
            </group>
        )
    }

    if (category === 'breakable') {
        return (
            <BreakableInstance
                instance={instance}
                breakableThresholdOverride={breakableThresholdOverride}
            />
        )
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

export function lightKindFromAssetId(assetId: string): LightKind {
    if (assetId === 'lights/spot') return 'spot'
    if (assetId === 'lights/directional') return 'directional'
    return 'point'
}

function LightInstance({ instance }: { instance: Instance }) {
    const { assetId, position, rotation, props } = instance
    const kind = props?.lightKind ?? lightKindFromAssetId(assetId)
    const color = props?.color ?? '#ffffff'
    const intensity = props?.intensity ?? 1
    const castShadow = props?.castShadow ?? false

    if (kind === 'spot') {
        return (
            <spotLight
                position={position}
                rotation={rotation}
                color={color}
                intensity={intensity}
                distance={props?.distance ?? 0}
                decay={props?.decay ?? 2}
                angle={props?.angle ?? Math.PI / 6}
                penumbra={props?.penumbra ?? 0.2}
                castShadow={castShadow}
            />
        )
    }
    if (kind === 'directional') {
        return (
            <directionalLight
                position={position}
                rotation={rotation}
                color={color}
                intensity={intensity}
                castShadow={castShadow}
            />
        )
    }
    return (
        <pointLight
            position={position}
            color={color}
            intensity={intensity}
            distance={props?.distance ?? 0}
            decay={props?.decay ?? 2}
            castShadow={castShadow}
        />
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

interface CollisionPayload {
    other?: {
        rigidBody?: {
            linvel?: () => { x: number; y: number; z: number }
            bodyType?: () => number
        }
    }
}

interface BreakSnapshot {
    position: Vec3
    rotation: Vec3
}

function BreakableInstance({
    instance,
    breakableThresholdOverride,
}: {
    instance: Instance
    breakableThresholdOverride?: number
}) {
    const { position, rotation, scale, assetId, props } = instance
    const meta = getAssetMeta(assetId)

    const intactBodyRef = useRef<RapierRigidBody>(null)
    const [broken, setBroken] = useState<BreakSnapshot | null>(null)
    const brokenRef = useRef(false)

    // threshold em m/s (velocidade do outro corpo no impacto). 0 = indestrutível.
    const thresholdFromMeta = props?.fractureThreshold ?? meta?.fractureThreshold ?? 20
    const fractureThreshold =
        breakableThresholdOverride !== undefined ? breakableThresholdOverride : thresholdFromMeta
    const indestructible = fractureThreshold <= 0

    const fracturedAssetId = resolveFracturedAssetId(
        assetId,
        props?.fracturedAssetId ?? meta?.fracturedAssetId,
    )
    const debrisMass = props?.debrisMass ?? meta?.debrisMass ?? 0.55
    const baseMass = props?.mass ?? meta?.mass ?? CATEGORY_DEFAULTS.breakable.defaultMass

    const triggerBreak = () => {
        if (brokenRef.current) return
        brokenRef.current = true

        // Captura a pose atual do corpo intacto para que os debris spawnem
        // exatamente onde o objeto está no momento do impacto (e não na
        // posição inicial do level).
        let capturedPosition: Vec3 = position
        let capturedRotation: Vec3 = rotation
        const rb = intactBodyRef.current
        if (rb) {
            const t = rb.translation()
            const q = rb.rotation()
            const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w)
            const eul = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
            capturedPosition = [t.x, t.y, t.z]
            capturedRotation = [eul.x, eul.y, eul.z]
        }

        setBroken({ position: capturedPosition, rotation: capturedRotation })
    }

    return (
        <>
            {broken === null && (
                <RigidBody
                    ref={intactBodyRef}
                    type="dynamic"
                    position={position}
                    rotation={rotation}
                    colliders="cuboid"
                    mass={baseMass}
                    friction={0.5}
                    restitution={0}
                    onCollisionEnter={
                        indestructible
                            ? undefined
                            : (payload: CollisionPayload) => {
                                  const v = payload.other?.rigidBody?.linvel?.()
                                  if (!v) return
                                  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
                                  if (speed < fractureThreshold) return
                                  triggerBreak()
                              }
                    }
                >
                    <group scale={scale}>
                        <AssetMesh assetId={assetId} color={CATEGORY_DEFAULTS.breakable.debugColor} />
                    </group>
                </RigidBody>
            )}

            {broken !== null && (
                <FracturedDebris
                    assetId={fracturedAssetId}
                    instancePosition={broken.position}
                    instanceRotation={broken.rotation}
                    instanceScale={scale}
                    mass={debrisMass}
                />
            )}
        </>
    )
}

interface FracturedDebrisProps {
    assetId: string
    instancePosition: Vec3
    instanceRotation: Vec3
    instanceScale: Vec3
    mass: number
}

interface ExtractedPiece {
    mesh: THREE.Mesh
    position: Vec3
    rotation: Vec3
    hullPoints: Float32Array
}

/**
 * Quanto o collider dos debris é encolhido em relação à mesh visual.
 * Pedaços de Voronoi têm muita concavidade escondida; shrink reduz "explosão"
 * ao pousarem uns nos outros. 0.72 = 72% do tamanho visual (+20% vs 0.6).
 */
const DEBRIS_COLLIDER_SHRINK = 0.9

function FracturedDebris({
    assetId,
    instancePosition,
    instanceRotation,
    instanceScale,
    mass,
}: FracturedDebrisProps) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)

    const parts = useMemo<ExtractedPiece[]>(() => {
        const instanceMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(...instancePosition),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...instanceRotation)),
            new THREE.Vector3(...instanceScale),
        )

        gltf.scene.updateMatrixWorld(true)

        const extracted: ExtractedPiece[] = []
        const worldMat = new THREE.Matrix4()
        const pos = new THREE.Vector3()
        const quat = new THREE.Quaternion()
        const scl = new THREE.Vector3()

        gltf.scene.traverse((obj) => {
            const src = obj as THREE.Mesh
            if (!src.isMesh) return

            worldMat.multiplyMatrices(instanceMatrix, src.matrixWorld)
            worldMat.decompose(pos, quat, scl)

            const geometry = src.geometry.clone()
            geometry.applyMatrix4(new THREE.Matrix4().makeScale(scl.x, scl.y, scl.z))
            geometry.computeBoundingBox()
            geometry.computeBoundingSphere()

            const material = Array.isArray(src.material)
                ? src.material.map((m) => m.clone())
                : src.material.clone()

            const mesh = new THREE.Mesh(geometry, material)
            mesh.castShadow = true
            mesh.receiveShadow = true

            const posAttr = geometry.attributes.position as THREE.BufferAttribute
            const bbox = geometry.boundingBox ?? new THREE.Box3().setFromBufferAttribute(posAttr)
            const center = bbox.getCenter(new THREE.Vector3())
            const hullPoints = new Float32Array(posAttr.count * 3)
            for (let i = 0; i < posAttr.count; i++) {
                const vx = posAttr.getX(i)
                const vy = posAttr.getY(i)
                const vz = posAttr.getZ(i)
                hullPoints[i * 3 + 0] = (vx - center.x) * DEBRIS_COLLIDER_SHRINK + center.x
                hullPoints[i * 3 + 1] = (vy - center.y) * DEBRIS_COLLIDER_SHRINK + center.y
                hullPoints[i * 3 + 2] = (vz - center.z) * DEBRIS_COLLIDER_SHRINK + center.z
            }

            const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ')
            extracted.push({
                mesh,
                position: [pos.x, pos.y, pos.z],
                rotation: [euler.x, euler.y, euler.z],
                hullPoints,
            })
        })

        return extracted
    }, [gltf.scene, instancePosition, instanceRotation, instanceScale])

    return (
        <>
            {parts.map((part, idx) => (
                <DebrisPiece
                    key={`${assetId}-${idx}`}
                    mesh={part.mesh}
                    hullPoints={part.hullPoints}
                    position={part.position}
                    rotation={part.rotation}
                    mass={mass}
                />
            ))}
        </>
    )
}

function DebrisPiece({
    mesh,
    hullPoints,
    position,
    rotation,
    mass,
}: {
    mesh: THREE.Mesh
    hullPoints: Float32Array
    position: Vec3
    rotation: Vec3
    mass: number
}) {
    return (
        <RigidBody
            type="dynamic"
            colliders={false}
            mass={mass}
            friction={0.6}
            restitution={0.1}
            position={position}
            rotation={rotation}
        >
            <ConvexHullCollider args={[hullPoints]} />
            <primitive object={mesh} />
        </RigidBody>
    )
}
