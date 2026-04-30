import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { BallCollider, ConvexHullCollider, CuboidCollider, RapierRigidBody, RigidBody } from '@react-three/rapier'
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { worldCollision } from '../game/physics-collision-filters'
import { Enemy } from '../game/enemy'
import { isSphereProjectileHandle } from '../game/sphere-projectile-handles'
import { getAssetMeta, resolveAssetUrl, resolveFracturedAssetId } from './asset-catalog'
import { CATEGORY_DEFAULTS } from './colliderFactory'
import {
    type EdgeOutlineSettings,
    PrimitiveMesh,
    primitiveKindFromAssetId,
} from './primitive-mesh'
import { DecalPlane } from './decal-plane'
import { applyOpacityToObject, applyTintToMaterial, applyTintToObject } from './tint'
import type { ColliderBox, Instance, LevelFile, LightKind, Vec3 } from './types'

function vec3Prop(value: unknown): Vec3 | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const next = value.map((v) => Number(v))
    if (next.some((v) => !Number.isFinite(v))) return null
    return [next[0], next[1], next[2]]
}

function normalizeColliderBox(value: unknown): ColliderBox | null {
    if (!value || typeof value !== 'object') return null
    const source = value as { size?: unknown; offset?: unknown }
    const size = vec3Prop(source.size)
    if (!size) return null
    return {
        size,
        offset: vec3Prop(source.offset) ?? [0, 0, 0],
    }
}

function colliderBoxesFrom(
    props: Instance['props'] | undefined,
    meta?: ReturnType<typeof getAssetMeta>,
): ColliderBox[] {
    const propBoxes = Array.isArray(props?.colliderBoxes)
        ? props.colliderBoxes.map(normalizeColliderBox).filter((box): box is ColliderBox => Boolean(box))
        : []
    if (propBoxes.length > 0) return propBoxes

    const propSize = vec3Prop(props?.colliderSize)
    if (propSize) {
        return [{ size: propSize, offset: vec3Prop(props?.colliderOffset) ?? [0, 0, 0] }]
    }

    const metaBoxes = Array.isArray(meta?.colliderBoxes)
        ? meta.colliderBoxes.map(normalizeColliderBox).filter((box): box is ColliderBox => Boolean(box))
        : []
    if (metaBoxes.length > 0) return metaBoxes

    const metaSize = vec3Prop(meta?.colliderSize)
    if (metaSize) {
        return [{ size: metaSize, offset: vec3Prop(meta?.colliderOffset) ?? [0, 0, 0] }]
    }

    return []
}

function manualCuboidFromBox(box: ColliderBox) {
    const offset = vec3Prop(box.offset) ?? [0, 0, 0]
    const size = vec3Prop(box.size) ?? [1, 1, 1]
    return {
        halfExtents: [
            Math.max(0.01, Math.abs(size[0])) / 2,
            Math.max(0.01, Math.abs(size[1])) / 2,
            Math.max(0.01, Math.abs(size[2])) / 2,
        ] as Vec3,
        offset,
    }
}

function manualCuboidFromProps(props: Instance['props'] | undefined) {
    const size = vec3Prop(props?.colliderSize)
    if (!size) return null
    return {
        halfExtents: [
            Math.max(0.01, Math.abs(size[0])) / 2,
            Math.max(0.01, Math.abs(size[1])) / 2,
            Math.max(0.01, Math.abs(size[2])) / 2,
        ] as Vec3,
        offset: vec3Prop(props?.colliderOffset) ?? [0, 0, 0] as Vec3,
    }
}

function lightShadowProps(props: Instance['props'] | undefined) {
    const size = Number(props?.shadowMapSize ?? 1024)
    const mapSize = [size, size] as [number, number]
    return {
        'shadow-mapSize': mapSize,
        'shadow-bias': Number(props?.shadowBias ?? -0.0001),
        'shadow-normalBias': Number(props?.shadowNormalBias ?? 0.02),
        'shadow-radius': Number(props?.shadowRadius ?? 1),
    }
}

interface LevelLoaderProps {
    src: string
    /** Overrides fractureThreshold for every breakable. 0 = indestructible. */
    breakableThresholdOverride?: number
    /**
     * Notificado quando o level é carregado. Usado pra extrair o spawn do
     * player (singleton) e qualquer metadado extra que o jogo precise.
     */
    onLevelLoaded?: (level: LevelFile) => void
    playerPositionRef?: RefObject<THREE.Vector3>
    edgeOutline?: EdgeOutlineSettings
}

export function LevelLoader({ src, breakableThresholdOverride, onLevelLoaded, playerPositionRef, edgeOutline }: LevelLoaderProps) {
    const [level, setLevel] = useState<LevelFile | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [enemyTriggersActivated, setEnemyTriggersActivated] = useState(false)

    useEffect(() => {
        let cancelled = false
        setError(null)
        setLevel(null)
        setEnemyTriggersActivated(false)

        fetch(src)
            .then((r) => {
                if (!r.ok) throw new Error(`HTTP ${r.status} ao carregar ${src}`)
                return r.json()
            })
            .then((data: LevelFile) => {
                if (cancelled) return
                if (data.version !== 1) throw new Error(`Level version ${data.version} não suportada`)
                setLevel(data)
                onLevelLoaded?.(data)
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

    const hasEnemyTriggers = level.instances.some((inst) => inst.category === 'enemy-trigger')
    const enemiesActivated = hasEnemyTriggers ? enemyTriggersActivated : true

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
                    playerPositionRef={playerPositionRef}
                    edgeOutline={edgeOutline}
                    enemiesActivated={enemiesActivated}
                    onEnemyTrigger={() => setEnemyTriggersActivated(true)}
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
    playerPositionRef,
    edgeOutline,
    enemiesActivated,
    onEnemyTrigger,
}: {
    instance: Instance
    breakableThresholdOverride?: number
    playerPositionRef?: RefObject<THREE.Vector3>
    edgeOutline?: EdgeOutlineSettings
    enemiesActivated: boolean
    onEnemyTrigger: () => void
}) {
    const { category, position, rotation, scale, props, assetId } = instance
    const defaults = CATEGORY_DEFAULTS[category]
    const meta = getAssetMeta(assetId)
    const mass = props?.mass ?? meta?.mass ?? defaults.defaultMass
    // `props.color` doubles as a debug tint for non-light categories.
    const tintColor = category !== 'light' ? (props?.color as string | undefined) : undefined
    const outlined =
        category === 'static-bulk' ||
        category === 'static-prop' ||
        category === 'no-collision' ||
        category === 'decal' ||
        category === 'breakable' ||
        category === 'dynamic'

    if (category === 'light') {
        return <LightInstance instance={instance} />
    }

    // Player é consumido pelo <App /> via `onLevelLoaded` (pra posicionar o
    // controller). O loader não renderiza nada pra ele no jogo.
    if (category === 'player') {
        return null
    }

    if (category === 'enemy') {
        return (
            <Enemy
                id={instance.id}
                position={position}
                rotation={rotation}
                scale={scale}
                maxHp={props?.maxHp as number | undefined}
                visionRange={props?.visionRange as number | undefined}
                visionAngleDeg={props?.visionAngleDeg as number | undefined}
                moveSpeed={props?.moveSpeed as number | undefined}
                showVisionCone={props?.showVisionCone as boolean | undefined}
                color={tintColor}
                opacity={props?.opacity as number | undefined}
                playerPositionRef={playerPositionRef}
                activated={enemiesActivated}
            />
        )
    }

    if (category === 'enemy-trigger') {
        return (
            <EnemyTriggerInstance
                instance={instance}
                playerPositionRef={playerPositionRef}
                onTriggered={onEnemyTrigger}
            />
        )
    }

    if (category === 'decal') {
        return (
            <group position={position} rotation={rotation} scale={scale}>
                <DecalPlane props={props} fallbackColor={tintColor ?? defaults.debugColor} />
            </group>
        )
    }

    if (category === 'no-collision') {
        return (
            <group position={position} rotation={rotation}>
                <OutlineLayer enabled={outlined}>
                    <group scale={scale}>
                        <AssetMesh
                            assetId={assetId}
                            color={defaults.debugColor}
                            tintColor={tintColor}
                            instanceProps={props}
                            instanceScale={scale}
                            edgeOutline={edgeOutline}
                        />
                    </group>
                </OutlineLayer>
            </group>
        )
    }

    if (category === 'breakable') {
        return (
            <BreakableInstance
                instance={instance}
                breakableThresholdOverride={breakableThresholdOverride}
                tintColor={tintColor}
                outlined={outlined}
                edgeOutline={edgeOutline}
            />
        )
    }

    // Planos precisam de collider manual: `colliders="cuboid"` inferiria
    // espessura 0 a partir da bounding box do `planeGeometry` (0 em Z local)
    // e o Rapier não aceita cuboid degenerado.
    //
    // A geometria do plano NÃO é pré-rotacionada (necessário pro reflector),
    // então a rotação pra deixar horizontal vive na instância — tipicamente
    // `rotation = [-π/2, 0, 0]`, o que mapeia:
    //   local +X → world +X      (largura)
    //   local +Y → world -Z      (profundidade, simétrica no cuboid)
    //   local +Z → world +Y      (normal / espessura)
    //
    // Logo, com scale da instância = [sx, sy, _], o collider fino no frame
    // da RigidBody tem args = [sx/2, sy/2, thickness/2] e offset -Z local
    // pra ficar logo abaixo da superfície visível.
    const isPlane = assetId === 'primitives/plane'
    const isSphere = assetId === 'primitives/sphere'
    const colliderBoxes = !isPlane && !isSphere ? colliderBoxesFrom(props, meta) : []
    const manualCuboids = colliderBoxes.map(manualCuboidFromBox)
    const planeThickness = 0.05
    const planeHalfX = Math.max(scale[0], 0.01) / 2
    const planeHalfY = Math.max(scale[1], 0.01) / 2
    const sphereRadius = Math.max(scale[0], scale[1], scale[2], 0.01) / 2

    return (
        <RigidBody
            type={defaults.bodyType}
            position={position}
            rotation={rotation}
            colliders={isPlane || isSphere || manualCuboids.length > 0 ? false : 'cuboid'}
            mass={mass}
            friction={0.5}
            restitution={0}
            {...(isPlane || isSphere || manualCuboids.length > 0
                ? {}
                : { collisionGroups: worldCollision(), solverGroups: worldCollision() })}
        >
            {isPlane && (
                <CuboidCollider
                    args={[planeHalfX, planeHalfY, planeThickness / 2]}
                    position={[0, 0, -planeThickness / 2]}
                    collisionGroups={worldCollision()}
                    solverGroups={worldCollision()}
                />
            )}
            {isSphere && (
                <BallCollider
                    args={[sphereRadius]}
                    collisionGroups={worldCollision()}
                    solverGroups={worldCollision()}
                />
            )}
            {manualCuboids.map((manualCuboid, idx) => (
                <CuboidCollider
                    key={`manual-collider-${idx}`}
                    args={manualCuboid.halfExtents}
                    position={manualCuboid.offset}
                    collisionGroups={worldCollision()}
                    solverGroups={worldCollision()}
                />
            ))}
            <OutlineLayer enabled={outlined}>
                <group scale={scale}>
                    <AssetMesh
                        assetId={assetId}
                        color={defaults.debugColor}
                        tintColor={tintColor}
                        instanceProps={props}
                        instanceScale={scale}
                        edgeOutline={edgeOutline}
                    />
                </group>
            </OutlineLayer>
        </RigidBody>
    )
}

function OutlineLayer({ enabled, children }: { enabled: boolean; children: ReactNode }) {
    const ref = useRef<THREE.Group>(null)
    useLayoutEffect(() => {
        const root = ref.current
        if (!root) return
        root.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (!mesh.isMesh) return
            mesh.userData.toonOutline = enabled
        })
    }, [children, enabled])
    return <group ref={ref}>{children}</group>
}

function EnemyTriggerInstance({
    instance,
    playerPositionRef,
    onTriggered,
}: {
    instance: Instance
    playerPositionRef?: RefObject<THREE.Vector3>
    onTriggered: () => void
}) {
    const triggeredRef = useRef(false)
    const matrix = useMemo(() => new THREE.Matrix4(), [])
    const inverseMatrix = useMemo(() => new THREE.Matrix4(), [])
    const localPlayer = useMemo(() => new THREE.Vector3(), [])
    const triggerOnce = (instance.props?.triggerOnce as boolean | undefined) ?? true
    const showVolume = (instance.props?.showTriggerVolume as boolean | undefined) ?? false

    useFrame(() => {
        if (triggerOnce && triggeredRef.current) return
        const player = playerPositionRef?.current
        if (!player) return

        matrix.compose(
            new THREE.Vector3(...instance.position),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(...instance.rotation)),
            new THREE.Vector3(1, 1, 1),
        )
        inverseMatrix.copy(matrix).invert()
        localPlayer.copy(player).applyMatrix4(inverseMatrix)

        const halfX = Math.max(0.05, Math.abs(instance.scale[0]) / 2)
        const halfY = Math.max(0.05, Math.abs(instance.scale[1]) / 2)
        const halfZ = Math.max(0.05, Math.abs(instance.scale[2]) / 2)
        const inside =
            Math.abs(localPlayer.x) <= halfX &&
            Math.abs(localPlayer.y) <= halfY &&
            Math.abs(localPlayer.z) <= halfZ

        if (!inside) return
        triggeredRef.current = true
        onTriggered()
    })

    if (!showVolume) return null
    return (
        <mesh position={instance.position} rotation={instance.rotation} scale={instance.scale}>
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial color="#ffd400" transparent opacity={0.18} depthWrite={false} />
        </mesh>
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
    const shadowProps = lightShadowProps(props)

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
                {...shadowProps}
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
                {...shadowProps}
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
            {...shadowProps}
        />
    )
}

function AssetMesh({
    assetId,
    color,
    tintColor,
    instanceProps,
    instanceScale,
    edgeOutline,
}: {
    assetId: string
    color: string
    tintColor?: string
    instanceProps?: import('./types').InstanceProps
    instanceScale?: Vec3
    edgeOutline?: EdgeOutlineSettings
}) {
    if (!assetId.startsWith('primitives/')) {
        return <GlbMesh assetId={assetId} tintColor={tintColor} instanceProps={instanceProps} edgeOutline={edgeOutline} />
    }

    const kind = primitiveKindFromAssetId(assetId) ?? 'cube'
    // O tint é repassado via props.color; o color default entra pra quando
    // nem props.color nem textura estejam presentes.
    const mergedProps = tintColor
        ? { ...(instanceProps ?? {}), color: tintColor }
        : instanceProps
    return (
        <PrimitiveMesh
            kind={kind}
            color={color}
            props={mergedProps}
            instanceScale={instanceScale}
            edgeOutline={edgeOutline}
        />
    )
}

function GlbMesh({
    assetId,
    tintColor,
    instanceProps,
    edgeOutline,
}: {
    assetId: string
    tintColor?: string
    instanceProps?: import('./types').InstanceProps
    edgeOutline?: EdgeOutlineSettings
}) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)
    const sceneClone = useMemo(() => {
        const clone = gltf.scene.clone(true)
        const castShadow = instanceProps?.castShadow !== false
        const receiveShadow = instanceProps?.receiveShadow !== false
        const forceUnlit = instanceProps?.material === 'unlit'
        const forceToon = instanceProps?.material === 'toon'
        clone.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.isMesh) {
                mesh.castShadow = castShadow
                mesh.receiveShadow = receiveShadow
                // Ensure the clone has its own material instances before we
                // tint them, otherwise mutation would leak to every user of
                // the cached gltf. Array materials are cloned per-entry.
                if (Array.isArray(mesh.material)) {
                    mesh.material = mesh.material.map((m) => m.clone())
                } else if (mesh.material) {
                    mesh.material = mesh.material.clone()
                }
                if (forceUnlit && mesh.material) {
                    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                    const basicMaterials = materials.map((material) => {
                        const source = material as THREE.MeshStandardMaterial
                        return new THREE.MeshBasicMaterial({
                            map: source.map ?? null,
                            color: source.color ?? new THREE.Color('#ffffff'),
                            transparent: source.transparent,
                            opacity: source.opacity,
                            side: source.side,
                            toneMapped: false,
                        })
                    })
                    mesh.material = Array.isArray(mesh.material) ? basicMaterials : basicMaterials[0]
                } else if (forceToon && mesh.material) {
                    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
                    const toonMaterials = materials.map((material) => {
                        const source = material as THREE.MeshStandardMaterial
                        return new THREE.MeshToonMaterial({
                            map: source.map ?? null,
                            color: source.color ?? new THREE.Color('#ffffff'),
                            emissive: instanceProps?.emissive ?? '#000000',
                            emissiveIntensity: instanceProps?.emissiveIntensity ?? 0,
                            transparent: source.transparent,
                            opacity: source.opacity,
                            side: source.side,
                        })
                    })
                    mesh.material = Array.isArray(mesh.material) ? toonMaterials : toonMaterials[0]
                }
            }
        })
        applyTintToObject(clone, tintColor)
        applyOpacityToObject(clone, instanceProps?.opacity)
        if (edgeOutline?.enabled) {
            attachEdgeLinesToMeshes(clone, edgeOutline)
        }
        return clone
    }, [
        gltf.scene,
        tintColor,
        instanceProps?.opacity,
        instanceProps?.castShadow,
        instanceProps?.receiveShadow,
        instanceProps?.material,
        instanceProps?.emissive,
        instanceProps?.emissiveIntensity,
        edgeOutline?.enabled,
        edgeOutline?.color,
        edgeOutline?.threshold,
    ])

    return <primitive object={sceneClone} />
}

function attachEdgeLinesToMeshes(
    root: THREE.Object3D,
    edgeOutline: EdgeOutlineSettings
) {
    const meshes: THREE.Mesh[] = []
    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.isMesh && mesh.geometry) meshes.push(mesh)
    })

    for (const mesh of meshes) {
        const geometry = new THREE.EdgesGeometry(mesh.geometry, edgeOutline.threshold)
        const material = new THREE.LineBasicMaterial({
            color: edgeOutline.color,
            toneMapped: false,
            depthTest: true,
            depthWrite: false,
        })
        const line = new THREE.LineSegments(geometry, material)
        line.renderOrder = 10
        line.userData.dreiEdges = true
        mesh.add(line)
    }
}

interface CollisionPayload {
    other?: {
        rigidBody?: {
            handle?: number
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
    tintColor,
    outlined,
    edgeOutline,
}: {
    instance: Instance
    breakableThresholdOverride?: number
    tintColor?: string
    outlined: boolean
    edgeOutline?: EdgeOutlineSettings
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
    const manualCuboids = colliderBoxesFrom(props, meta).map(manualCuboidFromBox)

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
                    colliders={manualCuboids.length > 0 ? false : 'cuboid'}
                    mass={baseMass}
                    friction={0.5}
                    restitution={0}
                    {...(manualCuboids.length > 0
                        ? {}
                        : { collisionGroups: worldCollision(), solverGroups: worldCollision() })}
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
                    {manualCuboids.map((manualCuboid, idx) => (
                        <CuboidCollider
                            key={`intact-manual-collider-${idx}`}
                            args={manualCuboid.halfExtents}
                            position={manualCuboid.offset}
                            collisionGroups={worldCollision()}
                            solverGroups={worldCollision()}
                        />
                    ))}
                    <OutlineLayer enabled={outlined}>
                        <group scale={scale}>
                            <AssetMesh
                                assetId={assetId}
                                color={CATEGORY_DEFAULTS.breakable.debugColor}
                                tintColor={tintColor}
                                instanceProps={props}
                                instanceScale={scale}
                                edgeOutline={edgeOutline}
                            />
                        </group>
                    </OutlineLayer>
                </RigidBody>
            )}

            {broken !== null && (
                <FracturedDebris
                    assetId={fracturedAssetId}
                    instancePosition={broken.position}
                    instanceRotation={broken.rotation}
                    instanceScale={scale}
                    mass={debrisMass}
                    tintColor={tintColor}
                    opacity={props?.opacity as number | undefined}
                    outlined={outlined}
                    edgeOutline={edgeOutline}
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
    tintColor?: string
    opacity?: number
    outlined: boolean
    edgeOutline?: EdgeOutlineSettings
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
const DEBRIS_HIT_FADE_MS = 200
const DEBRIS_MAX_HITS = 4
const DEBRIS_BUDGET_MIN = 110
const DEBRIS_BUDGET_MAX = 190
const DEBRIS_BUDGET_FADE_MS = 250
const DEBRIS_BUDGET_STEP_MIN_MS = 120
const DEBRIS_BUDGET_STEP_MAX_MS = 360

type DebrisRemovalReason = 'hit' | 'budget'

const debrisRegistry = new Set<{
    startedAt: number
    isFading: () => boolean
    beginFade: (reason: DebrisRemovalReason) => void
}>()
const debrisCountListeners = new Set<(count: number) => void>()

let debrisBudgetTimer: number | null = null
let debrisBudgetCleanupActive = false

export function getActiveDebrisCount() {
    return debrisRegistry.size
}

export function subscribeDebrisCount(listener: (count: number) => void) {
    debrisCountListeners.add(listener)
    listener(debrisRegistry.size)
    return () => {
        debrisCountListeners.delete(listener)
    }
}

function notifyDebrisCountChanged() {
    const count = debrisRegistry.size
    debrisCountListeners.forEach((listener) => listener(count))
}

function registerDebris(entry: {
    startedAt: number
    isFading: () => boolean
    beginFade: (reason: DebrisRemovalReason) => void
}) {
    debrisRegistry.add(entry)
    notifyDebrisCountChanged()
    scheduleDebrisBudgetCleanup()
    return () => {
        debrisRegistry.delete(entry)
        notifyDebrisCountChanged()
        scheduleDebrisBudgetCleanup()
    }
}

function scheduleDebrisBudgetCleanup() {
    if (debrisRegistry.size > DEBRIS_BUDGET_MAX) {
        debrisBudgetCleanupActive = true
    }

    if (!debrisBudgetCleanupActive || debrisBudgetTimer !== null) return

    debrisBudgetTimer = window.setTimeout(() => {
        debrisBudgetTimer = null
        enforceDebrisBudgetStep()
    }, THREE.MathUtils.randInt(DEBRIS_BUDGET_STEP_MIN_MS, DEBRIS_BUDGET_STEP_MAX_MS))
}

function enforceDebrisBudgetStep() {
    if (debrisRegistry.size <= DEBRIS_BUDGET_MIN) {
        debrisBudgetCleanupActive = false
        return
    }

    const candidates = Array.from(debrisRegistry)
        .filter((entry) => !entry.isFading())
    if (candidates.length === 0) {
        scheduleDebrisBudgetCleanup()
        return
    }

    const randomIndex = THREE.MathUtils.randInt(0, candidates.length - 1)
    candidates[randomIndex]?.beginFade('budget')
    scheduleDebrisBudgetCleanup()
}

function FracturedDebris({
    assetId,
    instancePosition,
    instanceRotation,
    instanceScale,
    mass,
    tintColor,
    opacity,
    outlined,
    edgeOutline,
}: FracturedDebrisProps) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)

    const tintColorObj = useMemo(
        () => (tintColor ? new THREE.Color(tintColor) : null),
        [tintColor],
    )

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

            if (tintColorObj) {
                if (Array.isArray(material)) {
                    material.forEach((m) => applyTintToMaterial(m, tintColorObj))
                } else {
                    applyTintToMaterial(material, tintColorObj)
                }
            }
            if (opacity !== undefined) {
                if (Array.isArray(material)) {
                    material.forEach((m) => {
                        m.opacity = opacity
                        m.transparent = opacity < 0.999
                        m.depthWrite = opacity >= 0.999
                        m.needsUpdate = true
                    })
                } else {
                    material.opacity = opacity
                    material.transparent = opacity < 0.999
                    material.depthWrite = opacity >= 0.999
                    material.needsUpdate = true
                }
            }

            const mesh = new THREE.Mesh(geometry, material)
            mesh.castShadow = true
            mesh.receiveShadow = true
            mesh.userData.toonOutline = outlined
            if (edgeOutline?.enabled) {
                attachEdgeLinesToMeshes(mesh, edgeOutline)
            }

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
    }, [
        gltf.scene,
        instancePosition,
        instanceRotation,
        instanceScale,
        tintColorObj,
        opacity,
        edgeOutline?.enabled,
        edgeOutline?.color,
        edgeOutline?.threshold,
    ])

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
                    outlined={outlined}
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
    outlined,
}: {
    mesh: THREE.Mesh
    hullPoints: Float32Array
    position: Vec3
    rotation: Vec3
    mass: number
    outlined: boolean
}) {
    const [alive, setAlive] = useState(true)
    const [fade, setFade] = useState<{ reason: DebrisRemovalReason; durationMs: number } | null>(null)
    const hitCountRef = useRef(0)
    const fadeStartedAtRef = useRef(0)
    const fadeRef = useRef<typeof fade>(null)
    const startedAtRef = useRef(performance.now())
    const unregisterRef = useRef<(() => void) | null>(null)
    const disposedRef = useRef(false)
    const removedRef = useRef(false)

    const beginFade = useCallback((reason: DebrisRemovalReason) => {
        if (fadeRef.current) return
        const durationMs = reason === 'hit' ? DEBRIS_HIT_FADE_MS : DEBRIS_BUDGET_FADE_MS
        fadeStartedAtRef.current = performance.now()
        const next = { reason, durationMs }
        fadeRef.current = next
        setFade(next)
    }, [])

    useEffect(() => {
        fadeRef.current = fade
    }, [fade])

    useEffect(() => {
        unregisterRef.current = registerDebris({
            startedAt: startedAtRef.current,
            isFading: () => fadeRef.current !== null,
            beginFade,
        })
        return () => {
            unregisterRef.current?.()
            unregisterRef.current = null
        }
    }, [beginFade])

    const disposeMesh = useCallback(() => {
        if (disposedRef.current) return
        disposedRef.current = true
        mesh.traverse((obj) => {
            const childMesh = obj as THREE.Mesh
            const childLine = obj as THREE.LineSegments
            if (childMesh.isMesh || childLine.isLineSegments) {
                childMesh.geometry?.dispose()
                const material = childMesh.material
                if (Array.isArray(material)) material.forEach((m) => m.dispose())
                else material?.dispose()
            }
        })
    }, [mesh])

    const removePiece = useCallback(() => {
        if (removedRef.current) return
        removedRef.current = true
        unregisterRef.current?.()
        unregisterRef.current = null
        disposeMesh()
        setAlive(false)
        scheduleDebrisBudgetCleanup()
    }, [disposeMesh])

    useFrame(() => {
        if (!fade) return
        const t = THREE.MathUtils.clamp((performance.now() - fadeStartedAtRef.current) / fade.durationMs, 0, 1)
        const opacity = 1 - t
        mesh.traverse((obj) => {
            const childMesh = obj as THREE.Mesh
            const childLine = obj as THREE.LineSegments
            if (childMesh.isMesh || childLine.isLineSegments) {
                const materials = Array.isArray(childMesh.material)
                    ? childMesh.material
                    : childMesh.material
                        ? [childMesh.material]
                        : []
                materials.forEach((material) => {
                    material.transparent = true
                    material.opacity = opacity
                    material.depthWrite = false
                    material.needsUpdate = true
                })
            }
        })
        if (t >= 1) removePiece()
    })

    useEffect(() => {
        return disposeMesh
    }, [disposeMesh])

    if (!alive) return null

    return (
        <RigidBody
            type="dynamic"
            colliders={false}
            mass={mass}
            friction={0.6}
            restitution={0.1}
            position={position}
            rotation={rotation}
            onCollisionEnter={(payload: CollisionPayload) => {
                if (fadeRef.current) return
                if (!isSphereProjectileHandle(payload.other?.rigidBody?.handle)) return
                hitCountRef.current += 1
                if (hitCountRef.current >= DEBRIS_MAX_HITS) beginFade('hit')
            }}
        >
            <ConvexHullCollider
                args={[hullPoints]}
                collisionGroups={worldCollision()}
                solverGroups={worldCollision()}
            />
            <primitive object={mesh} />
        </RigidBody>
    )
}
