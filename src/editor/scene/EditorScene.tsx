import { Canvas } from '@react-three/fiber'
import { Grid, OrbitControls, TransformControls, useGLTF } from '@react-three/drei'
import { Physics } from '@react-three/rapier'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Instance } from '../../level/types'
import { CATEGORY_DEFAULTS } from '../../level/colliderFactory'
import { useEditorStore } from '../state/store'
import { useMeshRegistry } from '../state/mesh-registry'
import { Workplane } from './Workplane'
import { resolveAssetUrl } from '../../level/asset-catalog'

export function EditorScene() {
    const showGrid = useEditorStore((s) => s.showGrid)
    const showColliders = useEditorStore((s) => s.showColliders)
    const instances = useEditorStore((s) => s.instances)

    return (
        <Canvas
            shadows
            camera={{ position: [12, 10, 12], fov: 50, near: 0.1, far: 500 }}
            onPointerMissed={() => useEditorStore.getState().select(null)}
        >
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

            <SelectionGizmo />

            <OrbitControls makeDefault enableDamping dampingFactor={0.1} />
        </Canvas>
    )
}

const EditorInstance = memo(function EditorInstance({ instance }: { instance: Instance }) {
    const selectedId = useEditorStore((s) => s.selectedId)
    const select = useEditorStore((s) => s.select)
    const registerMesh = useMeshRegistry((s) => s.set)

    const groupRef = useRef<THREE.Group>(null)
    const isSelected = selectedId === instance.id
    const color = CATEGORY_DEFAULTS[instance.category].debugColor

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
                e.stopPropagation()
                select(instance.id)
            }}
        >
            <AssetPreview assetId={instance.assetId} color={color} highlighted={isSelected} />
        </group>
    )
})

function AssetPreview({
    assetId,
    color,
    highlighted,
}: {
    assetId: string
    color: string
    highlighted: boolean
}) {
    if (!assetId.startsWith('primitives/')) {
        return <GlbPreview assetId={assetId} />
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
            <meshStandardMaterial
                color={color}
                roughness={0.8}
                metalness={0.05}
                emissive={highlighted ? '#ffffff' : '#000000'}
                emissiveIntensity={highlighted ? 0.25 : 0}
            />
        </mesh>
    )
}

function GlbPreview({ assetId }: { assetId: string }) {
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

    const [, setDragging] = useState(false)

    if (!target) return null

    return (
        <TransformControls
            object={target}
            mode={mode}
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => {
                setDragging(false)
                if (!selectedId) return
                updateTransform(selectedId, {
                    position: [target.position.x, target.position.y, target.position.z],
                    rotation: [target.rotation.x, target.rotation.y, target.rotation.z],
                    scale: [target.scale.x, target.scale.y, target.scale.z],
                })
            }}
        />
    )
}
