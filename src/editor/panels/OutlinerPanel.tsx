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
    enemy: 'Enemies',
    light: 'Lights',
    'static-bulk': 'Static (bulk)',
    'static-prop': 'Static (props)',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
    'no-collision': 'No collision',
}

const CATEGORY_ICON: Record<Category, string> = {
    player: '☻',
    enemy: '☠',
    light: '●',
    'static-bulk': '▣',
    'static-prop': '▢',
    dynamic: '◆',
    breakable: '◈',
    'no-collision': '◇',
}

export function OutlinerPanel() {
    const instances = useEditorStore((s) => s.instances)
    const selectedId = useEditorStore((s) => s.selectedId)
    const select = useEditorStore((s) => s.select)
    const removeInstance = useEditorStore((s) => s.removeInstance)

    const groups = new Map<Category, Instance[]>()
    for (const c of CATEGORY_ORDER) groups.set(c, [])
    for (const inst of instances) {
        if (!groups.has(inst.category)) groups.set(inst.category, [])
        groups.get(inst.category)!.push(inst)
    }

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 font-semibold uppercase text-xs tracking-wider text-neutral-400 flex items-center justify-between">
                <span>Outliner</span>
                <span className="text-neutral-600 normal-case tracking-normal">{instances.length} objs</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {CATEGORY_ORDER.map((cat) => {
                    const items = groups.get(cat) ?? []
                    if (items.length === 0) return null
                    const color = CATEGORY_DEFAULTS[cat].debugColor
                    return (
                        <div key={cat} className="border-b border-neutral-900">
                            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 flex items-center gap-2 bg-neutral-900/60">
                                <span style={{ color }}>{CATEGORY_ICON[cat]}</span>
                                <span>{CATEGORY_LABEL[cat]}</span>
                                <span className="text-neutral-600">({items.length})</span>
                            </div>
                            {items.map((inst) => {
                                const active = inst.id === selectedId
                                return (
                                    <div
                                        key={inst.id}
                                        onClick={() => select(inst.id)}
                                        className={`group flex items-center gap-2 px-3 py-1 cursor-pointer text-xs ${
                                            active
                                                ? 'bg-blue-900/40 text-blue-100'
                                                : 'hover:bg-neutral-800/60 text-neutral-300'
                                        }`}
                                    >
                                        <span style={{ color }} className="text-[11px]">
                                            {CATEGORY_ICON[cat]}
                                        </span>
                                        <span className="flex-1 truncate font-mono">
                                            {inst.assetId}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                removeInstance(inst.id)
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-red-400"
                                            title="Delete"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )
                })}
                {instances.length === 0 && (
                    <div className="p-4 text-xs text-neutral-600">
                        Sem objetos. Adicione assets pela barra inferior.
                    </div>
                )}
            </div>
        </div>
    )
}
