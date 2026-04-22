import type { Category, Vec3 } from '../../level/types'
import { useEditorStore } from '../state/store'

const CATEGORY_OPTIONS: Category[] = ['static-bulk', 'static-prop', 'dynamic', 'breakable']

export function InspectorPanel() {
    const selectedId = useEditorStore((s) => s.selectedId)
    const instance = useEditorStore((s) => s.instances.find((i) => i.id === s.selectedId) ?? null)
    const updateTransform = useEditorStore((s) => s.updateTransform)
    const updateCategory = useEditorStore((s) => s.updateCategory)
    const updateProps = useEditorStore((s) => s.updateProps)
    const removeInstance = useEditorStore((s) => s.removeInstance)
    const duplicateInstance = useEditorStore((s) => s.duplicateInstance)

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 font-semibold uppercase text-xs tracking-wider text-neutral-400">
                Inspector
            </div>
            {!instance || !selectedId ? (
                <div className="p-4 text-neutral-500 text-xs">Nada selecionado. Clique em um objeto na cena.</div>
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
                                    {c}
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
                    <Vec3Field
                        label="Scale"
                        value={instance.scale}
                        step={0.1}
                        min={0.01}
                        onChange={(v) => updateTransform(selectedId, { scale: v })}
                    />

                    {instance.category === 'dynamic' || instance.category === 'breakable' ? (
                        <Field label="Mass">
                            <input
                                type="number"
                                step={0.5}
                                min={0.1}
                                value={instance.props?.mass ?? ''}
                                placeholder="default"
                                onChange={(e) => {
                                    const v = e.target.value
                                    updateProps(selectedId, { mass: v === '' ? undefined : Number(v) })
                                }}
                                className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                            />
                        </Field>
                    ) : null}

                    {instance.category === 'breakable' ? (
                        <>
                            <Field label="Fracture Threshold">
                                <input
                                    type="number"
                                    step={1}
                                    min={0}
                                    value={instance.props?.fractureThreshold ?? ''}
                                    placeholder="default"
                                    onChange={(e) => {
                                        const v = e.target.value
                                        updateProps(selectedId, {
                                            fractureThreshold: v === '' ? undefined : Number(v),
                                        })
                                    }}
                                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-sm"
                                />
                            </Field>
                            <Field label="Fractured AssetId">
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
                    ) : null}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block">
            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">{label}</div>
            {children}
        </label>
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
