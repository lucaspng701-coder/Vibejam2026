import type { Category, InstanceProps, LightKind, Vec3 } from '../../level/types'
import { useEditorStore } from '../state/store'

const CATEGORY_OPTIONS: Category[] = [
    'static-bulk',
    'static-prop',
    'dynamic',
    'breakable',
    'no-collision',
    'light',
]

const CATEGORY_SELECT_LABEL: Record<Category, string> = {
    'static-bulk': 'Static (bulk)',
    'static-prop': 'Static (prop)',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
    'no-collision': 'No collision (visual)',
    light: 'Light',
}

const LIGHT_KIND_OPTIONS: LightKind[] = ['point', 'spot', 'directional']

export function InspectorPanel() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const instance = useEditorStore((s) => s.instances.find((i) => i.id === s.selectedId) ?? null)
    const updateTransform = useEditorStore((s) => s.updateTransform)
    const updateCategory = useEditorStore((s) => s.updateCategory)
    const updateProps = useEditorStore((s) => s.updateProps)
    const removeInstance = useEditorStore((s) => s.removeInstance)
    const duplicateInstance = useEditorStore((s) => s.duplicateInstance)

    const isLight = instance?.category === 'light'

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 font-semibold uppercase text-xs tracking-wider text-neutral-400">
                Inspector
            </div>
            {!instance || !selectedId ? (
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
                        <select
                            value={instance.category}
                            onChange={(e) => updateCategory(selectedId, e.target.value as Category)}
                            className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                        >
                            {CATEGORY_OPTIONS.map((c) => (
                                <option key={c} value={c}>
                                    {CATEGORY_SELECT_LABEL[c]}
                                </option>
                            ))}
                        </select>
                    </Field>

                    <Vec3Field
                        label="Position"
                        value={instance.position}
                        step={0.1}
                        onChange={(v) => updateTransform(selectedId, { position: v })}
                    />
                    <Vec3Field
                        label="Rotation (rad)"
                        value={instance.rotation}
                        step={0.05}
                        onChange={(v) => updateTransform(selectedId, { rotation: v })}
                    />
                    {!isLight && (
                        <Vec3Field
                            label="Scale"
                            value={instance.scale}
                            step={0.1}
                            min={0.01}
                            onChange={(v) => updateTransform(selectedId, { scale: v })}
                        />
                    )}

                    {(instance.category === 'dynamic' || instance.category === 'breakable') && (
                        <Field label="Mass">
                            <NumberInput
                                step={0.5}
                                min={0.1}
                                value={instance.props?.mass}
                                placeholder="default"
                                onChange={(v) => updateProps(selectedId, { mass: v })}
                            />
                        </Field>
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
    placeholder,
    onChange,
}: {
    value: number | undefined
    step: number
    min?: number
    placeholder?: string
    onChange: (v: number | undefined) => void
}) {
    return (
        <input
            type="number"
            step={step}
            min={min}
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
