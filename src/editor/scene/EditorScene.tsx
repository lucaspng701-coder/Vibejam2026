import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// Flag global: bloqueia o "onPointerMissed" do Canvas logo apos o usuario
// soltar uma handle do gizmo (se nao, a Canvas acha que foi clique no vazio
// e deseleciona o objeto).
const gizmoInteractionState = { justUsed: false }
import type { Instance } from '../../level/types'
import { CATEGORY_DEFAULTS } from '../../level/colliderFactory'
import { useEditorStore } from '../state/store'
import { useMeshRegistry } from '../state/mesh-registry'
import { Workplane } from './Workplane'
import { resolveAssetUrl } from '../../level/asset-catalog'
import { lightKindFromAssetId } from '../../level/LevelLoader'
import { applyTintToObject } from '../../level/tint'

export function EditorScene() {
    const showGrid = useEditorStore((s) => s.showGrid)
    const showColliders = useEditorStore((s) => s.showColliders)
    const instances = useEditorStore((s) => s.instances)
    const previewLighting = useEditorStore((s) => s.previewLighting)

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
                    {/* Match App.tsx defaults so the editor previews the real game look. */}
                    <fog attach="fog" args={['#dbdbdb', 13, 95]} />
                    <Environment
                        preset="sunset"
                        background
                        blur={0.8}
                        resolution={256}
                    />
                    <ambientLight intensity={1.3} />
                    <directionalLight
                        position={[10, 20, 10]}
                        intensity={1}
                        castShadow
                        shadow-mapSize={[4096, 4096]}
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
                        shadow-mapSize={[2048, 2048]}
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
                    <EditorInstance key={inst.id} instance={inst} />
                ))}
            </Physics>

            <SelectionBoundingBox />
            <SelectionGizmo />

            <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        </Canvas>
    )
}

const EditorInstance = memo(function EditorInstance({ instance }: { instance: Instance }) {
    const selectedId = useEditorStore((s) => s.selectedId)
    const select = useEditorStore((s) => s.select)
    const registerMesh = useMeshRegistry((s) => s.set)
    const previewLighting = useEditorStore((s) => s.previewLighting)

    const groupRef = useRef<THREE.Group>(null)
    const isSelected = selectedId === instance.id
    const color = CATEGORY_DEFAULTS[instance.category].debugColor
    // `props.color` is the light color for lights, otherwise it's a debug tint
    // applied to the material(s).
    const tintColor =
        instance.category !== 'light' ? (instance.props?.color as string | undefined) : undefined

    useEffect(() => {
        if (!groupRef.current) return
        registerMesh(instance.id, groupRef.current)
        return () => registerMesh(instance.id, null)
    }, [instance.id, registerMesh])

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
                select(instance.id)
            }}
        >
            {instance.category === 'light' ? (
                <>
                    <LightPreview instance={instance} highlighted={isSelected} />
                    {previewLighting && <ActiveLightEmitter instance={instance} />}
                </>
            ) : (
                <AssetPreview
                    assetId={instance.assetId}
                    color={color}
                    tintColor={tintColor}
                    highlighted={isSelected}
                />
            )}
        </group>
    )
})

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
            />
        )
    }
    if (kind === 'directional') {
        return (
            <directionalLight
                color={color}
                intensity={intensity}
                castShadow={castShadow}
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
    highlighted,
}: {
    assetId: string
    color: string
    tintColor?: string
    highlighted: boolean
}) {
    if (!assetId.startsWith('primitives/')) {
        return <GlbPreview assetId={assetId} tintColor={tintColor} />
    }

    const kind = assetId.slice('primitives/'.length)
    const renderColor = tintColor ?? color

    return (
        <mesh castShadow receiveShadow>
            {kind === 'sphere' ? (
                <sphereGeometry args={[0.5, 24, 16]} />
            ) : kind === 'cylinder' ? (
                <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
            ) : (
                <boxGeometry args={[1, 1, 1]} />
            )}
            <meshStandardMaterial
                color={renderColor}
                roughness={0.8}
                metalness={0.05}
                emissive={highlighted ? '#ffffff' : '#000000'}
                emissiveIntensity={highlighted ? 0.25 : 0}
            />
        </mesh>
    )
}

function GlbPreview({ assetId, tintColor }: { assetId: string; tintColor?: string }) {
    const url = resolveAssetUrl(assetId)
    const gltf = useGLTF(url)

    const sceneClone = useMemo(() => {
        const clone = gltf.scene.clone(true)
        clone.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (mesh.isMesh) {
                mesh.castShadow = true
                mesh.receiveShadow = true
                if (Array.isArray(mesh.material)) {
                    mesh.material = mesh.material.map((m) => m.clone())
                } else if (mesh.material) {
                    mesh.material = mesh.material.clone()
                }
            }
        })
        applyTintToObject(clone, tintColor)
        return clone
    }, [gltf.scene, tintColor])

    return <primitive object={sceneClone} />
}

/**
 * Attaches drei's TransformControls to the currently selected instance.
 * Commits the final transform to the store once the user releases the gizmo,
 * so each drag produces exactly one history entry.
 */
function SelectionGizmo() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const mode = useEditorStore((s) => s.mode)
    const updateTransform = useEditorStore((s) => s.updateTransform)
    const meshes = useMeshRegistry((s) => s.meshes)
    const target = selectedId ? meshes[selectedId] : null

    const tcRef = useRef<THREE.Object3D & { axis?: string | null } | null>(null)
    const gl = useThree((s) => s.gl)
    const selectedIdRef = useRef(selectedId)
    const targetRef = useRef(target)
    selectedIdRef.current = selectedId
    targetRef.current = target

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

    if (!target) return null

    return (
        <TransformControls
            ref={tcRef as unknown as React.Ref<THREE.Object3D>}
            object={target}
            mode={mode}
            size={1.5}
            onMouseUp={() => {
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
    )
}

/**
 * Caixa amarela ao redor do objeto selecionado (estilo three.js editor).
 * Atualiza automaticamente enquanto o usuario move/gira/escala via gizmo.
 */
function SelectionBoundingBox() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const meshes = useMeshRegistry((s) => s.meshes)
    const target = selectedId ? meshes[selectedId] : null

    const helper = useMemo(() => {
        if (!target) return null
        return new THREE.BoxHelper(target, 0xffff00)
    }, [target])

    useFrame(() => {
        helper?.update()
    })

    useEffect(() => {
        return () => {
            helper?.geometry.dispose()
            ;(helper?.material as THREE.Material | undefined)?.dispose()
        }
    }, [helper])

    if (!helper) return null
    return <primitive object={helper} />
}
