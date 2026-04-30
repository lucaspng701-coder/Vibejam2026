import { useMemo, useState } from 'react'
import type { Category, Instance } from '../../level/types'
import { useEditorStore } from '../state/store'
import { CATEGORY_DEFAULTS } from '../../level/colliderFactory'

const CATEGORY_ORDER: Category[] = [
    'player',
    'enemy',
    'light',
    'static-bulk',
    'static-prop',
    'dynamic',
    'breakable',
    'no-collision',
]

const CATEGORY_LABEL: Record<Category, string> = {
    player: 'Player',
    enemy: 'Enemy',
    light: 'Light',
    'static-bulk': 'Static bulk',
    'static-prop': 'Static prop',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
    'no-collision': 'No collision',
}

const CATEGORY_ICON: Record<Category, string> = {
    player: 'P',
    enemy: 'E',
    light: 'L',
    'static-bulk': 'B',
    'static-prop': 'S',
    dynamic: 'D',
    breakable: 'X',
    'no-collision': 'N',
}

export function OutlinerPanel() {
    const instances = useEditorStore((s) => s.instances)
    const groups = useEditorStore((s) => s.groups)
    const selectedId = useEditorStore((s) => s.selectedId)
    const selectedIds = useEditorStore((s) => s.selectedIds)
    const selectedGroupId = useEditorStore((s) => s.selectedGroupId)
    const select = useEditorStore((s) => s.select)
    const selectGroup = useEditorStore((s) => s.selectGroup)
    const removeInstance = useEditorStore((s) => s.removeInstance)
    const updateProps = useEditorStore((s) => s.updateProps)
    const [filter, setFilter] = useState<Category | 'all'>('all')

    const instancesById = useMemo(() => new Map(instances.map((inst) => [inst.id, inst])), [instances])
    const groupedIds = useMemo(() => new Set(groups.flatMap((g) => g.children)), [groups])
    const visibleUngrouped = instances.filter(
        (inst) => !groupedIds.has(inst.id) && (filter === 'all' || inst.category === filter),
    )

    const renderInstanceRow = (inst: Instance, nested = false) => {
        const color = CATEGORY_DEFAULTS[inst.category].debugColor
        const active = inst.id === selectedId || selectedIds.includes(inst.id)
        const hidden = Boolean(inst.props?.editorHidden)
        return (
            <div
                key={inst.id}
                onClick={(e) => select(inst.id, { additive: e.shiftKey || e.ctrlKey || e.metaKey })}
                className={`group flex items-center gap-2 py-1 cursor-pointer text-xs ${
                    nested ? 'pl-7 pr-2' : 'px-3'
                } ${active ? 'bg-blue-900/40 text-blue-100' : 'hover:bg-neutral-800/60 text-neutral-300'} ${
                    hidden ? 'opacity-45' : ''
                }`}
            >
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        updateProps(inst.id, { editorHidden: hidden ? undefined : true })
                    }}
                    className={`w-5 h-5 rounded border border-neutral-800 grid place-items-center text-[10px] ${
                        hidden ? 'text-neutral-600 hover:text-neutral-300' : 'text-sky-300 hover:text-sky-100'
                    }`}
                    title={hidden ? 'Show in editor viewport' : 'Hide in editor viewport'}
                >
                    {hidden ? '-' : 'o'}
                </button>
                <span
                    style={{ color }}
                    className="w-4 h-4 rounded border border-neutral-700 grid place-items-center text-[9px] font-mono shrink-0"
                    title={CATEGORY_LABEL[inst.category]}
                >
                    {CATEGORY_ICON[inst.category]}
                </span>
                <span className="flex-1 truncate font-mono">{inst.assetId}</span>
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        removeInstance(inst.id)
                    }}
                    className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400"
                    title="Delete"
                >
                    x
                </button>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 font-semibold uppercase text-xs tracking-wider text-neutral-400 flex items-center justify-between">
                <span>Outliner</span>
                <span className="text-neutral-600 normal-case tracking-normal">{instances.length} objs</span>
            </div>

            <div className="px-3 py-2 border-b border-neutral-800">
                <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as Category | 'all')}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs"
                    title="Filter ungrouped objects by category"
                >
                    <option value="all">All ungrouped</option>
                    {CATEGORY_ORDER.map((cat) => (
                        <option key={cat} value={cat}>
                            {CATEGORY_LABEL[cat]}
                        </option>
                    ))}
                </select>
            </div>

            <div className="flex-1 overflow-y-auto">
                {groups.map((group) => {
                    const active = group.id === selectedGroupId
                    const children = group.children
                        .map((id) => instancesById.get(id))
                        .filter((inst): inst is Instance => Boolean(inst))
                        .filter((inst) => filter === 'all' || inst.category === filter)

                    if (filter !== 'all' && children.length === 0) return null

                    return (
                        <div key={group.id} className="border-b border-neutral-900">
                            <div
                                onClick={() => selectGroup(group.id)}
                                className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${
                                    active
                                        ? 'bg-yellow-900/40 text-yellow-100'
                                        : 'bg-neutral-900/60 hover:bg-neutral-800/70 text-neutral-300'
                                }`}
                            >
                                <span className="w-4 h-4 rounded border border-yellow-500/50 grid place-items-center text-[9px] text-yellow-300">
                                    G
                                </span>
                                <span className="flex-1 truncate font-mono">{group.name}</span>
                                <span className="text-neutral-600">{group.children.length}</span>
                            </div>
                            {children.map((inst) => renderInstanceRow(inst, true))}
                        </div>
                    )
                })}

                {visibleUngrouped.length > 0 && (
                    <div className="border-b border-neutral-900">
                        <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 bg-neutral-900/60">
                            Ungrouped ({visibleUngrouped.length})
                        </div>
                        {visibleUngrouped.map((inst) => renderInstanceRow(inst))}
                    </div>
                )}

                {instances.length === 0 && (
                    <div className="p-4 text-xs text-neutral-600">
                        Sem objetos. Adicione assets pela barra inferior.
                    </div>
                )}
            </div>
        </div>
    )
}
