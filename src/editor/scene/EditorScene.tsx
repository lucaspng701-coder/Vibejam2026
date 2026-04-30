import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// Flag global: bloqueia o "onPointerMissed" do Canvas logo apos o usuario
// soltar uma handle do gizmo (se nao, a Canvas acha que foi clique no vazio
// e deseleciona o objeto).
const gizmoInteractionState = { justUsed: false }
import type { ColliderBox, Instance } from '../../level/types'
import { CATEGORY_DEFAULTS } from '../../level/colliderFactory'
import { useEditorStore } from '../state/store'
import { useMeshRegistry } from '../state/mesh-registry'
import { Workplane } from './Workplane'
import { getAssetMeta, resolveAssetUrl } from '../../level/asset-catalog'
import { lightKindFromAssetId } from '../../level/LevelLoader'
import {
    PrimitiveMesh,
    primitiveKindFromAssetId,
} from '../../level/primitive-mesh'
import { DecalPlane } from '../../level/decal-plane'
import { applyOpacityToObject, applyTintToObject, clampOpacity } from '../../level/tint'
import { SpriteFrameAnimation } from '../../game/sprite-animation'
import {
    LevelEnvironmentRenderer,
    normalizeLevelEdgeOutline,
    normalizeLevelEnvironment,
    normalizeLevelLighting,
} from '../../level/environment'

export function EditorScene() {
    const showGrid = useEditorStore((s) => s.showGrid)
    const showColliders = useEditorStore((s) => s.showColliders)
    const instances = useEditorStore((s) => s.instances)
    const previewLighting = useEditorStore((s) => s.previewLighting)
    const environment = useEditorStore((s) => s.environment)
    const lighting = useEditorStore((s) => s.lighting)
    const edgeOutline = useEditorStore((s) => s.edgeOutline)
    const normalizedEnvironment = normalizeLevelEnvironment(environment)
    const normalizedLighting = normalizeLevelLighting(lighting)
    const normalizedEdgeOutline = normalizeLevelEdgeOutline(edgeOutline)

    return (
        <Canvas
            shadows
            camera={{ position: [12, 10, 12], fov: 50, near: 0.1, far: 500 }}
            onPointerMissed={() => {
                if (gizmoInteractionState.justUsed) return
                useEditorStore.getState().select(null)
            }}
        >
            {previewLighting ? (
                <>
                    <LevelEnvironmentRenderer environment={normalizedEnvironment} />
                    <ambientLight intensity={normalizedLighting.ambientIntensity} />
                    <directionalLight
                        position={[
                            normalizedLighting.directionalDistance,
                            normalizedLighting.directionalHeight,
                            normalizedLighting.directionalDistance,
                        ]}
                        intensity={normalizedLighting.directionalIntensity}
                        castShadow={normalizedLighting.shadows}
                        shadow-mapSize={[1024, 1024]}
                        shadow-camera-left={-30}
                        shadow-camera-right={30}
                        shadow-camera-top={30}
                        shadow-camera-bottom={-30}
                        shadow-camera-near={1}
                        shadow-camera-far={150}
                        shadow-bias={-0.0001}
                        shadow-normalBias={0.02}
                    />
                </>
            ) : (
                <>
                    <color attach="background" args={['#1a1d22']} />
                    <ambientLight intensity={0.8} />
                    <directionalLight
                        position={[10, 20, 10]}
                        intensity={1}
                        castShadow
                        shadow-mapSize={[1024, 1024]}
                        shadow-camera-left={-30}
                        shadow-camera-right={30}
                        shadow-camera-top={30}
                        shadow-camera-bottom={-30}
                        shadow-bias={-0.0001}
                    />
                </>
            )}

            <Workplane />

            {showGrid && (
                <Grid
                    args={[100, 100]}
                    cellSize={1}
                    cellThickness={0.5}
                    cellColor="#3a3f47"
                    sectionSize={5}
                    sectionThickness={1}
                    sectionColor="#5b6168"
                    fadeDistance={60}
                    fadeStrength={1}
                    infiniteGrid
                />
            )}

            <Physics paused debug={showColliders} gravity={[0, 0, 0]}>
                {instances.map((inst) => (
                <EditorInstance
                    key={inst.id}
                    instance={inst}
                    edgeOutline={normalizedEdgeOutline}
                    showColliders={showColliders}
                />
            ))}
            </Physics>

            <SelectionBoundingBox />
            <SelectionGizmo />

            <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        </Canvas>
    )
}

const EditorInstance = memo(function EditorInstance({
    instance,
    edgeOutline,
    showColliders,
}: {
    instance: Instance
    edgeOutline: ReturnType<typeof normalizeLevelEdgeOutline>
    showColliders: boolean
}) {
    const selectedId = useEditorStore((s) => s.selectedId)
    const selectedIds = useEditorStore((s) => s.selectedIds)
    const select = useEditorStore((s) => s.select)
    const registerMesh = useMeshRegistry((s) => s.set)
    const previewLighting = useEditorStore((s) => s.previewLighting)

    const groupRef = useRef<THREE.Group>(null)
    const isSelected = selectedId === instance.id || selectedIds.includes(instance.id)
    const editorHidden = Boolean(instance.props?.editorHidden)
    const opacity = clampOpacity(instance.props?.opacity)
    const color = CATEGORY_DEFAULTS[instance.category].debugColor
    // `props.color` is the light color for lights, otherwise it's a debug tint
    // applied to the material(s).
    const tintColor =
        instance.category !== 'light' ? (instance.props?.color as string | undefined) : undefined
    const isLight = instance.category === 'light'
    const isPlayer = instance.category === 'player'

    useEffect(() => {
        if (editorHidden) {
            registerMesh(instance.id, null)
            return
        }
        if (!groupRef.current) return
        registerMesh(instance.id, groupRef.current)
        return () => registerMesh(instance.id, null)
    }, [editorHidden, instance.id, registerMesh])

    if (editorHidden) return null

    return (
        <group
            ref={groupRef}
            position={instance.position}
            rotation={instance.rotation}
            scale={instance.scale}
            onClick={(e) => {
                // Ignora cliques que vieram de uma interacao com o gizmo
                // (quando o usuario solta a seta X/Y/Z em cima de outro objeto).
                if (gizmoInteractionState.justUsed) return
                e.stopPropagation()
                select(instance.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey })
            }}
        >
            {instance.category === 'light' ? (
                <>
                    <LightPreview instance={instance} highlighted={isSelected} />
                    {previewLighting && <ActiveLightEmitter instance={instance} />}
                </>
            ) : instance.category === 'player' ? (
                <PlayerPreview highlighted={isSelected} opacity={opacity} />
            ) : instance.category === 'enemy' ? (
                <EnemyPreview highlighted={isSelected} tintColor={tintColor} opacity={opacity} />
            ) : instance.category === 'enemy-trigger' ? (
                <EnemyTriggerPreview highlighted={isSelected} opacity={opacity} />
            ) : instance.category === 'decal' ? (
                <DecalPlane
                    props={{ ...(instance.props ?? {}), opacity }}
                    fallbackColor={tintColor ?? color}
                    highlighted={isSelected}
                />
            ) : (
                <AssetPreview
                    assetId={instance.assetId}
                    color={color}
                    tintColor={tintColor}
                    instanceProps={instance.props}
                    instanceScale={instance.scale}
                    edgeOutline={edgeOutline}
                    opacity={opacity}
                    highlighted={isSelected}
                />
            )}
            {showColliders && !isLight && !isPlayer && (
                <ManualColliderPreview
                    assetId={instance.assetId}
                    props={instance.props}
                    rootScale={instance.scale}
                />
            )}
        </group>
    )
})

function ManualColliderPreview({
    assetId,
    props,
    rootScale,
}: {
    assetId: string
    props?: import('../../level/types').InstanceProps
    rootScale: import('../../level/types').Vec3
}) {
    const boxes = colliderBoxesForPreview(assetId, props)
    if (boxes.length === 0) return null
    const safe = (v: number) => (Math.abs(v) > 0.0001 ? v : 1)
    return (
        <>
            {boxes.map((box, idx) => {
                const offset = box.offset ?? [0, 0, 0]
                const size = box.size
                return (
                    <mesh
                        key={`collider-preview-${idx}`}
                        position={[
                            Number(offset[0] ?? 0) / safe(rootScale[0]),
                            Number(offset[1] ?? 0) / safe(rootScale[1]),
                            Number(offset[2] ?? 0) / safe(rootScale[2]),
                        ]}
                        scale={[
                            Math.max(0.01, Math.abs(Number(size[0] ?? 1))) / safe(rootScale[0]),
                            Math.max(0.01, Math.abs(Number(size[1] ?? 1))) / safe(rootScale[1]),
                            Math.max(0.01, Math.abs(Number(size[2] ?? 1))) / safe(rootScale[2]),
                        ]}
                        userData={{ __selectionBox: true }}
                    >
                        <boxGeometry args={[1, 1, 1]} />
                        <meshBasicMaterial color="#00e5ff" wireframe transparent opacity={0.85} depthTest={false} />
                    </mesh>
                )
            })}
        </>
    )
}

function readVec3(value: unknown): import('../../level/types').Vec3 | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const next = value.map((v) => Number(v))
    if (next.some((v) => !Number.isFinite(v))) return null
    return [next[0], next[1], next[2]]
}

function normalizeColliderBox(value: unknown): ColliderBox | null {
    if (!value || typeof value !== 'object') return null
    const source = value as { size?: unknown; offset?: unknown }
    const size = readVec3(source.size)
    if (!size) return null
    return {
        size,
        offset: readVec3(source.offset) ?? [0, 0, 0],
    }
}

function colliderBoxesForPreview(assetId: string, props?: import('../../level/types').InstanceProps): ColliderBox[] {
    const propBoxes = Array.isArray(props?.colliderBoxes)
        ? props.colliderBoxes.map(normalizeColliderBox).filter((box): box is ColliderBox => Boolean(box))
        : []
    if (propBoxes.length > 0) return propBoxes
    const propSize = readVec3(props?.colliderSize)
    if (propSize) return [{ size: propSize, offset: readVec3(props?.colliderOffset) ?? [0, 0, 0] }]

    const meta = getAssetMeta(assetId)
    const metaBoxes = Array.isArray(meta?.colliderBoxes)
        ? meta.colliderBoxes.map(normalizeColliderBox).filter((box): box is ColliderBox => Boolean(box))
        : []
    if (metaBoxes.length > 0) return metaBoxes
    const metaSize = readVec3(meta?.colliderSize)
    if (metaSize) return [{ size: metaSize, offset: readVec3(meta?.colliderOffset) ?? [0, 0, 0] }]
    return []
}

/**
 * Mirrors the in-game `LightInstance` from LevelLoader, but consumed here
 * directly so selecting / transforming a light in the editor shows the real
 * radius/cone/shadow it will cast at runtime.
 *
 * The parent group already applies position/rotation; this component just
 * spawns the emitter at local origin.
 */
function ActiveLightEmitter({ instance }: { instance: Instance }) {
    const kind = instance.props?.lightKind ?? lightKindFromAssetId(instance.assetId)
    const color = instance.props?.color ?? '#ffffff'
    const intensity = instance.props?.intensity ?? 1
    const castShadow = instance.props?.castShadow ?? false
    const shadowMapSize = Number(instance.props?.shadowMapSize ?? 1024)
    const shadowProps = {
        'shadow-mapSize': [shadowMapSize, shadowMapSize] as [number, number],
        'shadow-bias': Number(instance.props?.shadowBias ?? -0.0001),
        'shadow-normalBias': Number(instance.props?.shadowNormalBias ?? 0.02),
        'shadow-radius': Number(instance.props?.shadowRadius ?? 1),
    }

    if (kind === 'spot') {
        return (
            <spotLight
                color={color}
                intensity={intensity}
                distance={instance.props?.distance ?? 0}
                decay={instance.props?.decay ?? 2}
                angle={instance.props?.angle ?? Math.PI / 6}
                penumbra={instance.props?.penumbra ?? 0.2}
                castShadow={castShadow}
                {...shadowProps}
            />
        )
    }
    if (kind === 'directional') {
        return (
            <directionalLight
                color={color}
                intensity={intensity}
                castShadow={castShadow}
                {...shadowProps}
            />
        )
    }
    return (
        <pointLight
            color={color}
            intensity={intensity}
            distance={instance.props?.distance ?? 0}
            decay={instance.props?.decay ?? 2}
            castShadow={castShadow}
            {...shadowProps}
        />
    )
}

function LightPreview({ instance, highlighted }: { instance: Instance; highlighted: boolean }) {
    const kind = instance.props?.lightKind ?? lightKindFromAssetId(instance.assetId)
    const color = instance.props?.color ?? '#ffffff'
    const intensity = instance.props?.intensity ?? 1

    return (
        <group>
            {/* Bulbo clicavel que representa a luz */}
            <mesh>
                <sphereGeometry args={[0.18, 16, 12]} />
                <meshBasicMaterial color={color} />
            </mesh>
            <mesh visible={highlighted}>
                <sphereGeometry args={[0.24, 16, 12]} />
                <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.6} />
            </mesh>
            {/* Wireframe indicador do alcance/ângulo */}
            {kind === 'point' && (
                <mesh>
                    <sphereGeometry args={[Math.max(0.01, instance.props?.distance ?? 5), 16, 10]} />
                    <meshBasicMaterial color={color} wireframe transparent opacity={0.08} />
                </mesh>
            )}
            {kind === 'spot' && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <coneGeometry
                        args={[
                            Math.tan(instance.props?.angle ?? Math.PI / 6) *
                                Math.max(1, instance.props?.distance ?? 5),
                            Math.max(1, instance.props?.distance ?? 5),
                            24,
                            1,
                            true,
                        ]}
                    />
                    <meshBasicMaterial color={color} wireframe transparent opacity={0.18} />
                </mesh>
            )}
            {kind === 'directional' && (
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.02, 0.02, Math.max(1, intensity * 2), 6]} />
                    <meshBasicMaterial color={color} />
                </mesh>
            )}
        </group>
    )
}

function AssetPreview({
    assetId,
    color,
    tintColor,
    instanceProps,
    instanceScale,
    edgeOutline,
    opacity,
    highlighted,
}: {
    assetId: string
    color: string
    tintColor?: string
    instanceProps?: import('../../level/types').InstanceProps
    instanceScale?: import('../../level/types').Vec3
    edgeOutline?: import('../../level/types').LevelEdgeOutline
    opacity: number
    highlighted: boolean
}) {
    if (!assetId.startsWith('primitives/')) {
        return <GlbPreview assetId={assetId} tintColor={tintColor} opacity={opacity} instanceProps={instanceProps} />
    }

    const kind = primitiveKindFromAssetId(assetId) ?? 'cube'
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
            highlighted={highlighted}
        />
    )
}

/** Preview de inimigo: cápsula vermelha (mesma proporção do runtime). */
function EnemyPreview({ highlighted, tintColor, opacity }: { highlighted: boolean; tintColor?: string; opacity: number }) {
    const c = tintColor ?? '#b02222'
    return (
        <mesh castShadow userData={{ __selectionBox: true }}>
            <capsuleGeometry args={[0.5, 1, 4, 12]} />
            <meshStandardMaterial
                color={c}
                roughness={0.5}
                emissive={highlighted ? '#662222' : '#000000'}
                emissiveIntensity={highlighted ? 0.25 : 0}
                opacity={opacity}
                transparent={opacity < 0.999}
                depthWrite={opacity >= 0.999}
            />
        </mesh>
    )
}

function EnemyTriggerPreview({ highlighted, opacity }: { highlighted: boolean; opacity: number }) {
    return (
        <group>
            <mesh userData={{ __selectionBox: true }}>
                <boxGeometry args={[1, 1, 1]} />
                <meshBasicMaterial
                    color={highlighted ? '#fff36a' : '#ffd400'}
                    transparent
                    opacity={Math.min(0.45, opacity * 0.28)}
                    depthWrite={false}
                />
            </mesh>
            <lineSegments userData={{ __selectionBox: true }}>
                <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
                <lineBasicMaterial color={highlighted ? '#ffffff' : '#ffd400'} depthTest={false} />
            </lineSegments>
        </group>
    )
}

/**
 * Preview visual do spawn do Player no editor: capsula verde do tamanho
 * da hitbox real + sprite da arma usado em runtime.
 */
function PlayerPreview({ highlighted, opacity }: { highlighted: boolean; opacity: number }) {
    return (
        <group>
            {/* Cápsula: CapsuleCollider(half-height=1, radius=0.5). A
                capsuleGeometry do three é (radius, length, ...) onde length é
                a parte cilíndrica; altura total = length + 2*radius. */}
            <mesh castShadow>
                <capsuleGeometry args={[0.5, 1, 4, 12]} />
                <meshStandardMaterial
                    color="#33cc66"
                    roughness={0.6}
                    metalness={0.1}
                    emissive={highlighted ? '#66ff99' : '#000000'}
                    emissiveIntensity={highlighted ? 0.3 : 0}
                    opacity={opacity}
                    transparent={opacity < 0.999}
                    depthWrite={opacity >= 0.999}
                />
            </mesh>
            {/* Sprite da arma no "olho" da capsula, como referencia visual do runtime. */}
            <group position={[0.42, 0.52, 0.78]} scale={0.7}>
                <SpriteFrameAnimation
                    states={{
                        idle: {
                            frames: ['/assets/sprites/player/staplergun/idle/staplergun_idle.png'],
                            loop: true,
                        },
                    }}
                    state="idle"
                    width={1.35}
                    renderOrder={20}
                />
            </group>
            {/* Seta de direção pra deixar claro pra onde o player vai olhar. */}
            <group position={[0, 0.35, -1.05]}>
                <mesh rotation={[-Math.PI / 2, 0, 0]}>
                    <coneGeometry args={[0.18, 0.45, 16]} />
                    <meshBasicMaterial color="#9dff9d" />
                </mesh>
                <mesh position={[0, 0, 0.35]} rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.035, 0.035, 0.75, 8]} />
                    <meshBasicMaterial color="#9dff9d" />
                </mesh>
            </group>
        </group>
    )
}

function GlbPreview({
    assetId,
    tintColor,
    opacity,
    instanceProps,
}: {
    assetId: string
    tintColor?: string
    opacity: number
    instanceProps?: import('../../level/types').InstanceProps
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
        applyOpacityToObject(clone, opacity)
        return clone
    }, [
        gltf.scene,
        tintColor,
        opacity,
        instanceProps?.castShadow,
        instanceProps?.receiveShadow,
        instanceProps?.material,
        instanceProps?.emissive,
        instanceProps?.emissiveIntensity,
    ])

    return <primitive object={sceneClone} />
}

/**
 * Attaches drei's TransformControls to the currently selected instance.
 * Commits the final transform to the store once the user releases the gizmo,
 * so each drag produces exactly one history entry.
 */
function SelectionGizmo() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const selectedIds = useEditorStore((s) => s.selectedIds)
    const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
    const groups = useEditorStore((s) => s.groups)
    const mode = useEditorStore((s) => s.mode)
    const updateTransform = useEditorStore((s) => s.updateTransform)
    const updateTransforms = useEditorStore((s) => s.updateTransforms)
    const meshes = useMeshRegistry((s) => s.meshes)
    const target = selectedId ? meshes[selectedId] : null
    const groupPivot = useMemo(() => new THREE.Object3D(), [])
    const activeGroup = selectedGroupId ? groups.find((g) => g.id === selectedGroupId) ?? null : null
    const groupTargets = activeGroup
        ? activeGroup.children.map((id) => meshes[id]).filter((x): x is THREE.Object3D => Boolean(x))
        : []
    const transformTarget = activeGroup && groupTargets.length > 0 ? groupPivot : target

    const tcRef = useRef<THREE.Object3D & { axis?: string | null } | null>(null)
    const gl = useThree((s) => s.gl)
    const selectedIdRef = useRef(selectedId)
    const targetRef = useRef(transformTarget)
    const groupDragRef = useRef<{
        startPosition: THREE.Vector3
        startQuaternion: THREE.Quaternion
        children: Array<{
            id: string
            object: THREE.Object3D
            position: THREE.Vector3
            quaternion: THREE.Quaternion
        }>
    } | null>(null)
    selectedIdRef.current = selectedId
    targetRef.current = transformTarget

    useEffect(() => {
        if (!activeGroup || groupTargets.length === 0) return
        const box = new THREE.Box3()
        for (const object of groupTargets) {
            object.updateWorldMatrix(true, true)
            box.union(new THREE.Box3().setFromObject(object))
        }
        box.getCenter(groupPivot.position)
        groupPivot.quaternion.identity()
        groupPivot.scale.set(1, 1, 1)
    }, [activeGroup, groupPivot, groupTargets])

    // Listeners DOM em capture phase: rodam antes de R3F e do proprio
    // TransformControls, e usam diretamente `tc.axis` (null = sem handle
    // sob o cursor, string = handle ativa). 100% deterministico.
    useEffect(() => {
        const dom = gl.domElement

        const onDownCapture = () => {
            const axis = tcRef.current?.axis
            if (axis) {
                gizmoInteractionState.justUsed = true
            }
        }
        const onUpCapture = () => {
            if (!gizmoInteractionState.justUsed) return
            // Mantem o flag ativo pelo proximo ciclo de eventos inteiro,
            // para cobrir onPointerMissed / onClick que o R3F dispare em
            // seguida. Limpo no proximo animation frame + pequena margem.
            requestAnimationFrame(() => {
                setTimeout(() => {
                    gizmoInteractionState.justUsed = false
                }, 0)
            })
        }

        dom.addEventListener('pointerdown', onDownCapture, true)
        dom.addEventListener('pointerup', onUpCapture, true)
        return () => {
            dom.removeEventListener('pointerdown', onDownCapture, true)
            dom.removeEventListener('pointerup', onUpCapture, true)
        }
    }, [gl])

    if (!transformTarget) return null

    return (
        <>
            {activeGroup && <primitive object={groupPivot} visible={false} />}
            <TransformControls
                ref={tcRef as unknown as React.Ref<THREE.Object3D>}
                object={transformTarget}
                mode={activeGroup ? (mode === 'rotate' ? 'rotate' : 'translate') : mode}
                size={1.5}
                onMouseDown={() => {
                    if (!activeGroup) return
                    groupDragRef.current = {
                        startPosition: groupPivot.position.clone(),
                        startQuaternion: groupPivot.quaternion.clone(),
                        children: activeGroup.children
                            .map((id) => {
                                const object = meshes[id]
                                return object
                                    ? {
                                        id,
                                        object,
                                        position: object.position.clone(),
                                        quaternion: object.quaternion.clone(),
                                    }
                                    : null
                            })
                            .filter((x): x is {
                                id: string
                                object: THREE.Object3D
                                position: THREE.Vector3
                                quaternion: THREE.Quaternion
                            } => Boolean(x)),
                    }
                }}
                onObjectChange={() => {
                    const drag = groupDragRef.current
                    if (!drag) return
                    const deltaPosition = groupPivot.position.clone().sub(drag.startPosition)
                    const inverseStart = drag.startQuaternion.clone().invert()
                    const deltaRotation = groupPivot.quaternion.clone().multiply(inverseStart)
                    for (const child of drag.children) {
                        const relativePosition = child.position.clone().sub(drag.startPosition)
                        child.object.position
                            .copy(drag.startPosition)
                            .add(deltaPosition)
                            .add(relativePosition.applyQuaternion(deltaRotation))
                        child.object.quaternion.copy(deltaRotation).multiply(child.quaternion)
                    }
                }}
                onMouseUp={() => {
                    if (groupDragRef.current) {
                        const drag = groupDragRef.current
                        groupDragRef.current = null
                        updateTransforms(drag.children.map((child) => ({
                            id: child.id,
                            patch: {
                                position: [
                                    child.object.position.x,
                                    child.object.position.y,
                                    child.object.position.z,
                                ],
                                rotation: [
                                    child.object.rotation.x,
                                    child.object.rotation.y,
                                    child.object.rotation.z,
                                ],
                            },
                        })))
                        return
                    }
                    const id = selectedIdRef.current
                    const t = targetRef.current
                    if (!id || !t) return
                    updateTransform(id, {
                        position: [t.position.x, t.position.y, t.position.z],
                        rotation: [t.rotation.x, t.rotation.y, t.rotation.z],
                        scale: [t.scale.x, t.scale.y, t.scale.z],
                    })
                }}
            />
        </>
    )
}

/**
 * Caixa amarela ao redor do objeto selecionado (estilo three.js editor).
 * Atualiza automaticamente enquanto o usuario move/gira/escala via gizmo.
 */
function SelectionBoundingBox() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const selectedIds = useEditorStore((s) => s.selectedIds)
    const meshes = useMeshRegistry((s) => s.meshes)
    const ids = selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : []
    const targets = ids.map((id) => meshes[id]).filter((x): x is THREE.Object3D => Boolean(x))

    const helper = useMemo(() => {
        if (targets.length === 0) return null
        if (targets.length === 1) return new THREE.BoxHelper(targets[0], 0xffff00)

        const box = new THREE.Box3()
        for (const target of targets) {
            target.updateWorldMatrix(true, true)
            box.union(new THREE.Box3().setFromObject(target))
        }
        const boxHelper = new THREE.Box3Helper(box, 0xffff00)
        return boxHelper
    }, [targets])

    useFrame(() => {
        if (!helper) return
        if (helper instanceof THREE.BoxHelper) {
            helper.update()
            return
        }
        const box = helper.box
        box.makeEmpty()
        for (const target of targets) {
            target.updateWorldMatrix(true, true)
            box.union(new THREE.Box3().setFromObject(target))
        }
    })

    useEffect(() => {
        return () => {
            if (helper instanceof THREE.BoxHelper) helper.geometry.dispose()
            ;(helper?.material as THREE.Material | undefined)?.dispose()
        }
    }, [helper])

    if (!helper) return null
    return <primitive object={helper} />
}
