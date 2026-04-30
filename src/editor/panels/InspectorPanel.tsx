import { useState } from 'react'
import * as THREE from 'three'
import {
    ENVIRONMENT_PRESET_OPTIONS,
    normalizeLevelEdgeOutline,
    normalizeLevelEnvironment,
    normalizeLevelLighting,
} from '../../level/environment'
import type {
    Category,
    InstanceProps,
    LevelEdgeOutline,
    LevelEnvironment,
    LevelLighting,
    LightKind,
    Vec3,
} from '../../level/types'
import { useEditorStore } from '../state/store'
import { useMeshRegistry } from '../state/mesh-registry'

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180
const INSPECTOR_HISTORY_MERGE_MS = 450

const lastInspectorEdit = {
    key: '',
    at: 0,
}

function readVec3(value: unknown): Vec3 | null {
    if (!Array.isArray(value) || value.length !== 3) return null
    const next = value.map((v) => Number(v))
    if (next.some((v) => !Number.isFinite(v))) return null
    return [next[0], next[1], next[2]]
}

function roundVec3(value: THREE.Vector3): Vec3 {
    return [
        Number(value.x.toFixed(4)),
        Number(value.y.toFixed(4)),
        Number(value.z.toFixed(4)),
    ]
}

function measureObjectBoundsInBodySpace(root: THREE.Object3D): { size: Vec3; offset: Vec3 } | null {
    root.updateWorldMatrix(true, true)

    const rootPosition = new THREE.Vector3()
    const rootQuaternion = new THREE.Quaternion()
    const rootScale = new THREE.Vector3()
    root.matrixWorld.decompose(rootPosition, rootQuaternion, rootScale)

    const bodyMatrix = new THREE.Matrix4().compose(
        rootPosition,
        rootQuaternion,
        new THREE.Vector3(1, 1, 1),
    )
    const worldToBody = bodyMatrix.invert()
    const bounds = new THREE.Box3()
    const corner = new THREE.Vector3()

    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.geometry) return
        mesh.geometry.computeBoundingBox()
        const box = mesh.geometry.boundingBox
        if (!box) return
        for (const x of [box.min.x, box.max.x]) {
            for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                    corner.set(x, y, z).applyMatrix4(mesh.matrixWorld).applyMatrix4(worldToBody)
                    bounds.expandByPoint(corner)
                }
            }
        }
    })

    if (bounds.isEmpty()) return null
    const size = new THREE.Vector3()
    const center = new THREE.Vector3()
    bounds.getSize(size)
    bounds.getCenter(center)
    return {
        size: roundVec3(size),
        offset: roundVec3(center),
    }
}

const CATEGORY_OPTIONS: Category[] = [
    'static-bulk',
    'static-prop',
    'dynamic',
    'breakable',
    'no-collision',
    'light',
    'enemy',
    'enemy-trigger',
    'decal',
]

const CATEGORY_SELECT_LABEL: Record<Category, string> = {
    'static-bulk': 'Static (bulk)',
    'static-prop': 'Static (prop)',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
    'no-collision': 'No collision (visual)',
    light: 'Light',
    player: 'Player (spawn)',
    enemy: 'Enemy',
    'enemy-trigger': 'Enemy Trigger',
    decal: 'Decal / Sprite',
}

const LIGHT_KIND_OPTIONS: LightKind[] = ['point', 'spot', 'directional']

export function InspectorPanel() {
    const [levelSettingsOpen, setLevelSettingsOpen] = useState(false)
    const selectedId = useEditorStore((s) => s.selectedId)
    const selectedIds = useEditorStore((s) => s.selectedIds)
    const instance = useEditorStore((s) => s.instances.find((i) => i.id === s.selectedId) ?? null)
    const updateTransform = useEditorStore((s) => s.updateTransform)
    const updateCategory = useEditorStore((s) => s.updateCategory)
    const updateProps = useEditorStore((s) => s.updateProps)
    const removeInstance = useEditorStore((s) => s.removeInstance)
    const removeSelected = useEditorStore((s) => s.removeSelected)
    const duplicateInstance = useEditorStore((s) => s.duplicateInstance)
    const duplicateSelected = useEditorStore((s) => s.duplicateSelected)
    const environment = useEditorStore((s) => s.environment)
    const lighting = useEditorStore((s) => s.lighting)
    const edgeOutline = useEditorStore((s) => s.edgeOutline)
    const setEnvironment = useEditorStore((s) => s.setEnvironment)
    const setLighting = useEditorStore((s) => s.setLighting)
    const setEdgeOutline = useEditorStore((s) => s.setEdgeOutline)
    const meshes = useMeshRegistry((s) => s.meshes)
    const selectedMesh = selectedId ? meshes[selectedId] : null

    const isLight = instance?.category === 'light'
    const isPlayer = instance?.category === 'player'
    const canHaveCollider =
        instance?.category === 'static-bulk' ||
        instance?.category === 'static-prop' ||
        instance?.category === 'dynamic' ||
        instance?.category === 'breakable'
    const updateTransformFromInspector = (
        field: 'position' | 'rotation' | 'scale',
        value: Vec3,
    ) => {
        if (!selectedId) return
        const key = `${selectedId}:${field}`
        const now = performance.now()
        const mergeHistory =
            lastInspectorEdit.key === key &&
            now - lastInspectorEdit.at < INSPECTOR_HISTORY_MERGE_MS
        lastInspectorEdit.key = key
        lastInspectorEdit.at = now
        updateTransform(selectedId, { [field]: value }, { mergeHistory })
    }

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 flex items-center gap-2">
                <div className="font-semibold uppercase text-xs tracking-wider text-neutral-400">
                    Inspector
                </div>
                <button
                    onClick={() => setLevelSettingsOpen((v) => !v)}
                    className={`ml-auto text-[11px] px-2 py-1 rounded border ${
                        levelSettingsOpen
                            ? 'bg-emerald-900/60 border-emerald-700 text-emerald-100'
                            : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-300'
                    }`}
                >
                    Level Settings
                </button>
            </div>
            {levelSettingsOpen && (
                <div className="border-b border-neutral-800 max-h-[55vh] overflow-y-auto p-3">
                    <LevelSettingsPanel
                        environment={environment}
                        lighting={lighting}
                        edgeOutline={edgeOutline}
                        onEnvironment={setEnvironment}
                        onLighting={setLighting}
                        onEdgeOutline={setEdgeOutline}
                    />
                </div>
            )}
            {selectedIds.length > 1 ? (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    <div className="rounded border border-blue-900/50 bg-blue-950/20 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-blue-200">
                            Multi-selection
                        </div>
                        <div className="mt-2 text-sm text-neutral-300">
                            {selectedIds.length} objetos selecionados.
                        </div>
                        <div className="mt-2 text-xs text-neutral-500">
                            Ctrl+D duplica todos juntos. Delete remove todos.
                        </div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-neutral-800">
                        <button
                            onClick={() => duplicateSelected()}
                            className="flex-1 bg-neutral-800 hover:bg-neutral-700 rounded px-3 py-1.5 text-xs"
                        >
                            Duplicate All
                        </button>
                        <button
                            onClick={() => removeSelected()}
                            className="flex-1 bg-red-900/60 hover:bg-red-800 rounded px-3 py-1.5 text-xs"
                        >
                            Delete All
                        </button>
                    </div>
                </div>
            ) : !instance || !selectedId ? (
                <div className="p-4 text-neutral-500 text-xs">
                    Nada selecionado. Clique em um objeto na cena ou no outliner.
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    <Field label="ID">
                        <div className="text-xs text-neutral-500 font-mono truncate">{instance.id}</div>
                    </Field>

                    <Field label="Asset">
                        <div className="text-xs text-neutral-400 font-mono">{instance.assetId}</div>
                    </Field>

                    <Field label="Category">
                        {isPlayer ? (
                            <div className="text-xs text-emerald-300 font-mono">
                                {CATEGORY_SELECT_LABEL.player}
                            </div>
                        ) : (
                            <select
                                value={instance.category}
                                onChange={(e) =>
                                    updateCategory(selectedId, e.target.value as Category)
                                }
                                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                            >
                                {CATEGORY_OPTIONS.map((c) => (
                                    <option key={c} value={c}>
                                        {CATEGORY_SELECT_LABEL[c]}
                                    </option>
                                ))}
                            </select>
                        )}
                    </Field>

                    <div className="space-y-3 p-2 rounded border border-neutral-800 bg-neutral-900/40">
                        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                            Appearance
                        </div>
                        {!isLight && (
                            <Field label="Opacity">
                                <NumberInput
                                    step={0.05}
                                    min={0}
                                    max={1}
                                    value={instance.props?.opacity as number | undefined}
                                    placeholder="1"
                                    onChange={(v) => updateProps(selectedId, { opacity: v })}
                                />
                            </Field>
                        )}
                        <label className="flex items-center gap-2 text-xs text-neutral-300">
                            <input
                                type="checkbox"
                                checked={!Boolean(instance.props?.editorHidden)}
                                onChange={(e) => updateProps(selectedId, { editorHidden: e.target.checked ? undefined : true })}
                            />
                            Visible in editor viewport
                        </label>
                    </div>

                    <Vec3Field
                        label="Position"
                        value={instance.position}
                        step={0.1}
                        onChange={(v) => updateTransformFromInspector('position', v)}
                    />
                    <RotationDegField
                        label="Rotation (deg)"
                        value={instance.rotation}
                        step={1}
                        onChange={(v) => updateTransformFromInspector('rotation', v)}
                    />
                    {!isLight && !isPlayer && (
                        <Vec3Field
                            label="Scale"
                            value={instance.scale}
                            step={0.1}
                            min={0.01}
                            onChange={(v) => updateTransformFromInspector('scale', v)}
                        />
                    )}

                    {canHaveCollider && (
                        <ColliderFields
                            props={instance.props ?? {}}
                            selectedObject={selectedMesh}
                            onPatch={(p) => updateProps(selectedId, p)}
                        />
                    )}

                    {!isLight && !isPlayer && (
                        <Field label="Tint color (debug)">
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={(instance.props?.color as string) ?? '#ffffff'}
                                    onChange={(e) =>
                                        updateProps(selectedId, { color: e.target.value })
                                    }
                                    className="h-7 w-12 rounded border border-neutral-700 bg-neutral-900"
                                />
                                <input
                                    type="text"
                                    value={(instance.props?.color as string) ?? ''}
                                    placeholder="auto"
                                    onChange={(e) =>
                                        updateProps(selectedId, {
                                            color: e.target.value || undefined,
                                        })
                                    }
                                    className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                                />
                                {instance.props?.color !== undefined && (
                                    <button
                                        onClick={() =>
                                            updateProps(selectedId, { color: undefined })
                                        }
                                        className="text-[10px] px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
                                        title="Limpar tint"
                                    >
                                        ×
                                    </button>
                                )}
                            </div>
                        </Field>
                    )}

                    {(instance.category === 'static-bulk' ||
                        instance.category === 'static-prop' ||
                        instance.category === 'no-collision' ||
                        instance.category === 'dynamic' ||
                        instance.category === 'breakable') && (
                        <SurfaceFields
                            props={instance.props ?? {}}
                            onPatch={(p) => updateProps(selectedId, p)}
                        />
                    )}

                    {(instance.category === 'dynamic' || instance.category === 'breakable') && (
                        <div className="space-y-3 p-2 rounded border border-indigo-900/40 bg-indigo-950/10">
                            <div className="text-xs font-semibold uppercase tracking-wider text-indigo-200/80">
                                Physics
                            </div>
                            <Field label="Mass">
                                <NumberInput
                                    step={0.5}
                                    min={0.1}
                                    value={instance.props?.mass}
                                    placeholder="default"
                                    onChange={(v) => updateProps(selectedId, { mass: v })}
                                />
                            </Field>
                        </div>
                    )}

                    {instance.category === 'enemy' && (
                        <div className="space-y-3 p-2 rounded border border-red-900/40 bg-red-950/10">
                            <div className="text-xs font-semibold uppercase tracking-wider text-red-200/80">
                                Enemy
                            </div>
                            <Field label="Max HP">
                                <NumberInput
                                    step={10}
                                    min={1}
                                    value={instance.props?.maxHp}
                                    placeholder="100"
                                    onChange={(v) => updateProps(selectedId, { maxHp: v })}
                                />
                            </Field>
                            <Field label="Vision range (m)">
                                <NumberInput
                                    step={0.5}
                                    min={0.5}
                                    value={instance.props?.visionRange as number | undefined}
                                    placeholder="12"
                                    onChange={(v) => updateProps(selectedId, { visionRange: v })}
                                />
                            </Field>
                            <Field label="Vision angle (deg)">
                                <NumberInput
                                    step={5}
                                    min={5}
                                    value={instance.props?.visionAngleDeg as number | undefined}
                                    placeholder="70"
                                    onChange={(v) => updateProps(selectedId, { visionAngleDeg: v })}
                                />
                            </Field>
                            <Field label="Move speed">
                                <NumberInput
                                    step={0.1}
                                    min={0}
                                    value={instance.props?.moveSpeed as number | undefined}
                                    placeholder="2.2"
                                    onChange={(v) => updateProps(selectedId, { moveSpeed: v })}
                                />
                            </Field>
                            <label className="flex items-center gap-2 text-xs text-neutral-300">
                                <input
                                    type="checkbox"
                                    checked={(instance.props?.showVisionCone as boolean | undefined) ?? true}
                                    onChange={(e) => updateProps(selectedId, { showVisionCone: e.target.checked })}
                                />
                                Show vision cone
                            </label>
                        </div>
                    )}

                    {instance.category === 'enemy-trigger' && (
                        <div className="space-y-3 p-2 rounded border border-yellow-900/40 bg-yellow-950/10">
                            <div className="text-xs font-semibold uppercase tracking-wider text-yellow-200/80">
                                Enemy Trigger
                            </div>
                            <label className="flex items-center gap-2 text-xs text-neutral-300">
                                <input
                                    type="checkbox"
                                    checked={(instance.props?.triggerOnce as boolean | undefined) ?? true}
                                    onChange={(e) => updateProps(selectedId, { triggerOnce: e.target.checked })}
                                />
                                Trigger once
                            </label>
                            <label className="flex items-center gap-2 text-xs text-neutral-300">
                                <input
                                    type="checkbox"
                                    checked={(instance.props?.showTriggerVolume as boolean | undefined) ?? false}
                                    onChange={(e) => updateProps(selectedId, { showTriggerVolume: e.target.checked })}
                                />
                                Show in game
                            </label>
                        </div>
                    )}

                    {instance.category === 'decal' && (
                        <DecalFields
                            props={instance.props ?? {}}
                            onPatch={(p) => updateProps(selectedId, p)}
                        />
                    )}

                    {instance.category === 'breakable' && (
                        <>
                            <Field label="Fracture threshold (m/s)">
                                <NumberInput
                                    step={1}
                                    min={0}
                                    value={instance.props?.fractureThreshold}
                                    placeholder="default"
                                    onChange={(v) => updateProps(selectedId, { fractureThreshold: v })}
                                />
                            </Field>
                            <Field label="Fractured assetId">
                                <input
                                    type="text"
                                    value={instance.props?.fracturedAssetId ?? ''}
                                    placeholder="office/crate_fractured"
                                    onChange={(e) =>
                                        updateProps(selectedId, {
                                            fracturedAssetId: e.target.value || undefined,
                                        })
                                    }
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                                />
                            </Field>
                        </>
                    )}

                    {isLight && (
                        <LightFields
                            props={instance.props ?? {}}
                            onPatch={(p) => updateProps(selectedId, p)}
                        />
                    )}

                    <div className="flex gap-2 pt-2 border-t border-neutral-800">
                        <button
                            onClick={() => duplicateInstance(selectedId)}
                            className="flex-1 bg-neutral-800 hover:bg-neutral-700 rounded px-3 py-1.5 text-xs"
                        >
                            Duplicate
                        </button>
                        <button
                            onClick={() => removeInstance(selectedId)}
                            className="flex-1 bg-red-900/60 hover:bg-red-800 rounded px-3 py-1.5 text-xs"
                        >
                            Delete
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function ColliderFields({
    props,
    selectedObject,
    onPatch,
}: {
    props: InstanceProps
    selectedObject: THREE.Object3D | null
    onPatch: (p: InstanceProps) => void
}) {
    const size = readVec3(props.colliderSize)
    const offset = readVec3(props.colliderOffset) ?? [0, 0, 0]
    const applyVisualBounds = () => {
        if (!selectedObject) return
        const bounds = measureObjectBoundsInBodySpace(selectedObject)
        if (!bounds) return
        onPatch({
            colliderSize: bounds.size,
            colliderOffset: bounds.offset,
        })
    }

    return (
        <div className="space-y-3 p-2 rounded border border-cyan-900/40 bg-cyan-950/10">
            <div className="flex items-center gap-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">
                    Collider
                </div>
                <button
                    onClick={applyVisualBounds}
                    className="ml-auto text-[10px] px-2 py-1 rounded border border-cyan-800 hover:bg-cyan-900/50 text-cyan-100"
                    title="Calcula uma caixa pelo tamanho visual do objeto selecionado."
                >
                    Auto Fit
                </button>
                <button
                    onClick={() => onPatch({ colliderSize: undefined, colliderOffset: undefined })}
                    className="text-[10px] px-2 py-1 rounded border border-neutral-700 hover:bg-neutral-800"
                    title="Volta para o collider automatico do Rapier."
                >
                    Reset
                </button>
            </div>
            <div className="text-[11px] text-neutral-500">
                Sem tamanho manual, o jogo usa o collider automatico. Com tamanho manual, o cuboid azul vira o collider real.
            </div>
            {size && (
                <>
                    <Vec3Field
                        label="Collider size"
                        value={size}
                        step={0.05}
                        min={0.01}
                        onChange={(v) => onPatch({ colliderSize: v })}
                    />
                    <Vec3Field
                        label="Collider offset"
                        value={offset}
                        step={0.05}
                        onChange={(v) => onPatch({ colliderOffset: v })}
                    />
                </>
            )}
        </div>
    )
}

function LevelSettingsPanel({
    environment,
    lighting,
    edgeOutline,
    onEnvironment,
    onLighting,
    onEdgeOutline,
}: {
    environment: LevelEnvironment
    lighting: LevelLighting
    edgeOutline: LevelEdgeOutline
    onEnvironment: (patch: LevelEnvironment) => void
    onLighting: (patch: LevelLighting) => void
    onEdgeOutline: (patch: LevelEdgeOutline) => void
}) {
    const env = normalizeLevelEnvironment(environment)
    const light = normalizeLevelLighting(lighting)
    const edges = normalizeLevelEdgeOutline(edgeOutline)

    return (
        <div className="space-y-4">
            <div className="space-y-3 p-2 rounded border border-emerald-900/40 bg-emerald-950/10">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200/80">
                    Level Environment
                </div>
                <Field label="HDR">
                    <select
                        value={env.mode}
                        onChange={(e) => onEnvironment({ mode: e.target.value as LevelEnvironment['mode'] })}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                    >
                        <option value="none">None</option>
                        <option value="preset">Preset</option>
                        <option value="file">HDR file</option>
                    </select>
                </Field>
                <Field label="Preset">
                    <select
                        value={env.preset}
                        onChange={(e) => onEnvironment({ preset: e.target.value as LevelEnvironment['preset'] })}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                    >
                        {Object.entries(ENVIRONMENT_PRESET_OPTIONS).map(([label, value]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="File">
                    <input
                        type="text"
                        value={env.file}
                        placeholder="/hdrs/office.hdr"
                        onChange={(e) => onEnvironment({ file: e.target.value })}
                        className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                    />
                </Field>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" checked={env.background} onChange={(e) => onEnvironment({ background: e.target.checked })} />
                    Use HDR as background
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" checked={env.ibl} onChange={(e) => onEnvironment({ ibl: e.target.checked })} />
                    Use HDR as IBL
                </label>
                <Field label="Background color">
                    <div className="flex items-center gap-2">
                        <input type="color" value={env.backgroundColor} onChange={(e) => onEnvironment({ backgroundColor: e.target.value })} className="h-7 w-12 rounded border border-neutral-700 bg-neutral-900" />
                        <input type="text" value={env.backgroundColor} onChange={(e) => onEnvironment({ backgroundColor: e.target.value })} className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono" />
                    </div>
                </Field>
                <Field label="HDR intensity">
                    <NumberInput step={0.05} min={0} max={3} value={env.intensity} onChange={(v) => onEnvironment({ intensity: v })} />
                </Field>
                <Field label="HDR blur">
                    <NumberInput step={0.05} min={0} max={1} value={env.blur} onChange={(v) => onEnvironment({ blur: v })} />
                </Field>
                <Field label="Resolution">
                    <select value={env.resolution} onChange={(e) => onEnvironment({ resolution: Number(e.target.value) })} className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm">
                        {[64, 128, 256, 512].map((value) => (
                            <option key={value} value={value}>{value}</option>
                        ))}
                    </select>
                </Field>
            </div>

            <div className="space-y-3 p-2 rounded border border-yellow-900/40 bg-yellow-950/10">
                <div className="text-xs font-semibold uppercase tracking-wider text-yellow-200/80">
                    Default Lighting
                </div>
                <Field label="Ambient intensity">
                    <NumberInput step={0.1} min={0} max={4} value={light.ambientIntensity} onChange={(v) => onLighting({ ambientIntensity: v })} />
                </Field>
                <Field label="Directional intensity">
                    <NumberInput step={0.1} min={0} max={4} value={light.directionalIntensity} onChange={(v) => onLighting({ directionalIntensity: v })} />
                </Field>
                <Field label="Directional height">
                    <NumberInput step={1} min={0} max={80} value={light.directionalHeight} onChange={(v) => onLighting({ directionalHeight: v })} />
                </Field>
                <Field label="Directional distance">
                    <NumberInput step={1} min={0} max={80} value={light.directionalDistance} onChange={(v) => onLighting({ directionalDistance: v })} />
                </Field>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" checked={light.shadows} onChange={(e) => onLighting({ shadows: e.target.checked })} />
                    Shadows
                </label>
            </div>

            <div className="space-y-3 p-2 rounded border border-neutral-700 bg-neutral-950/30">
                <div className="text-xs font-semibold uppercase tracking-wider text-neutral-300">
                    Drei Edges
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input type="checkbox" checked={edges.enabled} onChange={(e) => onEdgeOutline({ enabled: e.target.checked })} />
                    Enabled
                </label>
                <Field label="Color">
                    <div className="flex items-center gap-2">
                        <input type="color" value={edges.color} onChange={(e) => onEdgeOutline({ color: e.target.value })} className="h-7 w-12 rounded border border-neutral-700 bg-neutral-900" />
                        <input type="text" value={edges.color} onChange={(e) => onEdgeOutline({ color: e.target.value })} className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono" />
                    </div>
                </Field>
                <Field label="Threshold">
                    <NumberInput step={1} min={1} max={90} value={edges.threshold} onChange={(v) => onEdgeOutline({ threshold: v })} />
                </Field>
                <Field label="Line width">
                    <NumberInput step={0.5} min={0.5} max={6} value={edges.lineWidth} onChange={(v) => onEdgeOutline({ lineWidth: v })} />
                </Field>
            </div>
        </div>
    )
}

/**
 * Campos de "surface" (textura + projeção + reflector) para primitivas e
 * malhas estáticas. Todos são opcionais: quando vazios, o material cai no
 * `meshStandardMaterial` simples usado antes da fase de level-integration.
 */
function SurfaceFields({
    props,
    onPatch,
}: {
    props: InstanceProps
    onPatch: (p: InstanceProps) => void
}) {
    const textureUrl = (props.textureUrl as string | undefined) ?? ''
    const material = (props.material as string | undefined) ?? 'standard'
    const triplanar = Boolean(props.triplanar)
    const reflector = Boolean(props.reflector)

    return (
        <div className="space-y-3 p-2 rounded border border-sky-900/40 bg-sky-950/10">
            <div className="text-xs font-semibold uppercase tracking-wider text-sky-200/80">
                Surface
            </div>

            <Field label="Material">
                <select
                    value={material}
                    onChange={(e) => onPatch({ material: e.target.value === 'standard' ? undefined : e.target.value })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                >
                    <option value="standard">Standard (PBR)</option>
                    <option value="unlit">Unlit / Basic</option>
                    <option value="toon">Toon</option>
                </select>
            </Field>

            <Field label="Texture URL (public/)">
                <input
                    type="text"
                    value={textureUrl}
                    placeholder="/final-texture.png"
                    onChange={(e) =>
                        onPatch({ textureUrl: e.target.value || undefined })
                    }
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                />
            </Field>

            {material === 'standard' && (
                <>
                    <Field label="Roughness">
                        <NumberInput
                            step={0.05}
                            min={0}
                            max={1}
                            value={props.roughness as number | undefined}
                            placeholder="0.8"
                            onChange={(v) => onPatch({ roughness: v })}
                        />
                    </Field>
                    <Field label="Metalness">
                        <NumberInput
                            step={0.05}
                            min={0}
                            max={1}
                            value={props.metalness as number | undefined}
                            placeholder="0.05"
                            onChange={(v) => onPatch({ metalness: v })}
                        />
                    </Field>
                </>
            )}

            {material !== 'unlit' && (
                <>
                    <Field label="Emissive">
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={(props.emissive as string | undefined) ?? '#000000'}
                                onChange={(e) => onPatch({ emissive: e.target.value })}
                                className="h-7 w-12 rounded border border-neutral-700 bg-neutral-900"
                            />
                            <input
                                type="text"
                                value={(props.emissive as string | undefined) ?? ''}
                                placeholder="#000000"
                                onChange={(e) => onPatch({ emissive: e.target.value || undefined })}
                                className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                            />
                        </div>
                    </Field>
                    <Field label="Emissive intensity">
                        <NumberInput
                            step={0.1}
                            min={0}
                            value={props.emissiveIntensity as number | undefined}
                            placeholder="0"
                            onChange={(v) => onPatch({ emissiveIntensity: v })}
                        />
                    </Field>
                </>
            )}

            <Field label={triplanar ? 'Tile (metros)' : 'Repeat'}>
                <NumberInput
                    step={0.25}
                    min={0.01}
                    value={props.textureScale as number | undefined}
                    placeholder={triplanar ? '1' : '1'}
                    onChange={(v) => onPatch({ textureScale: v })}
                />
            </Field>

            <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                    type="checkbox"
                    checked={triplanar}
                    onChange={(e) => onPatch({ triplanar: e.target.checked })}
                />
                Triplanar (UV world-space; não estica ao escalar)
            </label>

            <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                    type="checkbox"
                    checked={reflector}
                    onChange={(e) => onPatch({ reflector: e.target.checked })}
                />
                Reflector (chão reflexivo)
            </label>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-sky-900/30">
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input
                        type="checkbox"
                        checked={props.castShadow !== false}
                        onChange={(e) => onPatch({ castShadow: e.target.checked ? undefined : false })}
                    />
                    Cast shadow
                </label>
                <label className="flex items-center gap-2 text-xs text-neutral-300">
                    <input
                        type="checkbox"
                        checked={props.receiveShadow !== false}
                        onChange={(e) => onPatch({ receiveShadow: e.target.checked ? undefined : false })}
                    />
                    Receive shadow
                </label>
            </div>

            {reflector && (
                <>
                    <Field label="Mirror (0..1)">
                        <NumberInput
                            step={0.05}
                            min={0}
                            value={props.reflectorMirror as number | undefined}
                            placeholder="0"
                            onChange={(v) => onPatch({ reflectorMirror: v })}
                        />
                    </Field>
                    <Field label="Roughness (0..1)">
                        <NumberInput
                            step={0.05}
                            min={0}
                            value={props.reflectorRoughness as number | undefined}
                            placeholder="1"
                            onChange={(v) => onPatch({ reflectorRoughness: v })}
                        />
                    </Field>
                </>
            )}
        </div>
    )
}

function DecalFields({
    props,
    onPatch,
}: {
    props: InstanceProps
    onPatch: (p: InstanceProps) => void
}) {
    return (
        <div className="space-y-3 p-2 rounded border border-fuchsia-900/40 bg-fuchsia-950/10">
            <div className="text-xs font-semibold uppercase tracking-wider text-fuchsia-200/80">
                Decal / Sprite Plane
            </div>
            <Field label="Texture URL (public/)">
                <input
                    type="text"
                    value={(props.textureUrl as string | undefined) ?? ''}
                    placeholder="/assets/decals/office_atlas.png"
                    onChange={(e) => onPatch({ textureUrl: e.target.value || undefined })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label="UV X">
                    <NumberInput step={0.01} min={0} max={1} value={props.uvX as number | undefined} placeholder="0" onChange={(v) => onPatch({ uvX: v })} />
                </Field>
                <Field label="UV Y">
                    <NumberInput step={0.01} min={0} max={1} value={props.uvY as number | undefined} placeholder="0" onChange={(v) => onPatch({ uvY: v })} />
                </Field>
                <Field label="UV W">
                    <NumberInput step={0.01} min={0.01} max={1} value={props.uvW as number | undefined} placeholder="1" onChange={(v) => onPatch({ uvW: v })} />
                </Field>
                <Field label="UV H">
                    <NumberInput step={0.01} min={0.01} max={1} value={props.uvH as number | undefined} placeholder="1" onChange={(v) => onPatch({ uvH: v })} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-fuchsia-900/30">
                <Field label="Columns">
                    <NumberInput step={1} min={1} value={props.sheetColumns as number | undefined} placeholder="1" onChange={(v) => onPatch({ sheetColumns: v })} />
                </Field>
                <Field label="Rows">
                    <NumberInput step={1} min={1} value={props.sheetRows as number | undefined} placeholder="1" onChange={(v) => onPatch({ sheetRows: v })} />
                </Field>
                <Field label="Start frame">
                    <NumberInput step={1} min={0} value={props.frameStart as number | undefined} placeholder="0" onChange={(v) => onPatch({ frameStart: v })} />
                </Field>
                <Field label="Frame count">
                    <NumberInput step={1} min={1} value={props.frameCount as number | undefined} placeholder="1" onChange={(v) => onPatch({ frameCount: v })} />
                </Field>
                <Field label="FPS">
                    <NumberInput step={1} min={0} value={props.frameFps as number | undefined} placeholder="6" onChange={(v) => onPatch({ frameFps: v })} />
                </Field>
                <label className="flex items-center gap-2 text-xs text-neutral-300 self-end pb-1">
                    <input
                        type="checkbox"
                        checked={(props.frameLoop as boolean | undefined) ?? true}
                        onChange={(e) => onPatch({ frameLoop: e.target.checked })}
                    />
                    Loop
                </label>
            </div>
        </div>
    )
}

function LightFields({
    props,
    onPatch,
}: {
    props: InstanceProps
    onPatch: (p: InstanceProps) => void
}) {
    const kind: LightKind = (props.lightKind as LightKind) ?? 'point'
    return (
        <div className="space-y-3 p-2 rounded border border-yellow-900/40 bg-yellow-950/10">
            <div className="text-xs font-semibold uppercase tracking-wider text-yellow-200/80">
                Light
            </div>

            <Field label="Kind">
                <select
                    value={kind}
                    onChange={(e) => onPatch({ lightKind: e.target.value as LightKind })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                >
                    {LIGHT_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                            {k}
                        </option>
                    ))}
                </select>
            </Field>

            <Field label="Color">
                <div className="flex items-center gap-2">
                    <input
                        type="color"
                        value={(props.color as string) ?? '#ffffff'}
                        onChange={(e) => onPatch({ color: e.target.value })}
                        className="h-7 w-12 rounded border border-neutral-700 bg-neutral-900"
                    />
                    <input
                        type="text"
                        value={(props.color as string) ?? '#ffffff'}
                        onChange={(e) => onPatch({ color: e.target.value })}
                        className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs font-mono"
                    />
                </div>
            </Field>

            <Field label="Intensity">
                <NumberInput
                    step={0.25}
                    min={0}
                    value={props.intensity as number | undefined}
                    placeholder="1"
                    onChange={(v) => onPatch({ intensity: v })}
                />
            </Field>

            {kind !== 'directional' && (
                <>
                    <Field label="Distance (0 = inf)">
                        <NumberInput
                            step={0.5}
                            min={0}
                            value={props.distance as number | undefined}
                            placeholder="0"
                            onChange={(v) => onPatch({ distance: v })}
                        />
                    </Field>
                    <Field label="Decay">
                        <NumberInput
                            step={0.1}
                            min={0}
                            value={props.decay as number | undefined}
                            placeholder="2"
                            onChange={(v) => onPatch({ decay: v })}
                        />
                    </Field>
                </>
            )}

            {kind === 'spot' && (
                <>
                    <Field label="Angle (rad)">
                        <NumberInput
                            step={0.05}
                            min={0}
                            value={props.angle as number | undefined}
                            placeholder={String(Math.PI / 6)}
                            onChange={(v) => onPatch({ angle: v })}
                        />
                    </Field>
                    <Field label="Penumbra (0..1)">
                        <NumberInput
                            step={0.05}
                            min={0}
                            value={props.penumbra as number | undefined}
                            placeholder="0.2"
                            onChange={(v) => onPatch({ penumbra: v })}
                        />
                    </Field>
                </>
            )}

            <label className="flex items-center gap-2 text-xs text-neutral-300">
                <input
                    type="checkbox"
                    checked={Boolean(props.castShadow)}
                    onChange={(e) => onPatch({ castShadow: e.target.checked })}
                />
                Cast shadow
            </label>
            {Boolean(props.castShadow) && (
                <>
                    <Field label="Shadow map size">
                        <select
                            value={(props.shadowMapSize as number | undefined) ?? 1024}
                            onChange={(e) => onPatch({ shadowMapSize: Number(e.target.value) })}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                        >
                            {[512, 1024, 2048, 4096].map((value) => (
                                <option key={value} value={value}>
                                    {value}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Shadow bias">
                        <NumberInput
                            step={0.0001}
                            value={props.shadowBias as number | undefined}
                            placeholder="-0.0001"
                            onChange={(v) => onPatch({ shadowBias: v })}
                        />
                    </Field>
                    <Field label="Shadow normal bias">
                        <NumberInput
                            step={0.005}
                            min={0}
                            value={props.shadowNormalBias as number | undefined}
                            placeholder="0.02"
                            onChange={(v) => onPatch({ shadowNormalBias: v })}
                        />
                    </Field>
                    <Field label="Shadow radius">
                        <NumberInput
                            step={0.25}
                            min={0}
                            value={props.shadowRadius as number | undefined}
                            placeholder="1"
                            onChange={(v) => onPatch({ shadowRadius: v })}
                        />
                    </Field>
                </>
            )}
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
            {children}
        </label>
    )
}

function NumberInput({
    value,
    step,
    min,
    max,
    placeholder,
    onChange,
}: {
    value: number | undefined
    step: number
    min?: number
    max?: number
    placeholder?: string
    onChange: (v: number | undefined) => void
}) {
    return (
        <input
            type="number"
            step={step}
            min={min}
            max={max}
            value={value ?? ''}
            placeholder={placeholder}
            onChange={(e) => {
                const v = e.target.value
                onChange(v === '' ? undefined : Number(v))
            }}
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
        />
    )
}

function Vec3Field({
    label,
    value,
    step,
    min,
    onChange,
}: {
    label: string
    value: Vec3
    step: number
    min?: number
    onChange: (v: Vec3) => void
}) {
    const update = (axis: 0 | 1 | 2, raw: string) => {
        const n = Number(raw)
        if (Number.isNaN(n)) return
        const next: Vec3 = [value[0], value[1], value[2]]
        next[axis] = n
        onChange(next)
    }
    return (
        <Field label={label}>
            <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as const).map((k, i) => (
                    <div key={k} className="flex items-center">
                        <span className="text-xs text-neutral-500 w-4">{k}</span>
                        <input
                            type="number"
                            step={step}
                            min={min}
                            value={Number(value[i].toFixed(4))}
                            onChange={(e) => update(i as 0 | 1 | 2, e.target.value)}
                            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs w-full"
                        />
                    </div>
                ))}
            </div>
        </Field>
    )
}

function RotationDegField({
    label,
    value,
    step,
    onChange,
}: {
    label: string
    value: Vec3
    step: number
    onChange: (v: Vec3) => void
}) {
    const degValue: Vec3 = [
        value[0] * RAD_TO_DEG,
        value[1] * RAD_TO_DEG,
        value[2] * RAD_TO_DEG,
    ]
    const update = (axis: 0 | 1 | 2, raw: string) => {
        const n = Number(raw)
        if (Number.isNaN(n)) return
        const next: Vec3 = [value[0], value[1], value[2]]
        next[axis] = n * DEG_TO_RAD
        onChange(next)
    }
    return (
        <Field label={label}>
            <div className="grid grid-cols-3 gap-1">
                {(['x', 'y', 'z'] as const).map((k, i) => (
                    <div key={k} className="flex items-center">
                        <span className="text-xs text-neutral-500 w-4">{k}</span>
                        <input
                            type="number"
                            step={step}
                            value={Number(degValue[i].toFixed(2))}
                            onChange={(e) => update(i as 0 | 1 | 2, e.target.value)}
                            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs w-full"
                        />
                    </div>
                ))}
            </div>
        </Field>
    )
}
