import type { Category } from '../../level/types'
import { defaultInstanceFor, useEditorStore } from '../state/store'

interface AssetEntry {
    id: string
    label: string
    defaultCategory: Category
}

const PRIMITIVES: AssetEntry[] = [
    { id: 'primitives/cube', label: 'Cube', defaultCategory: 'static-prop' },
    { id: 'primitives/sphere', label: 'Sphere', defaultCategory: 'dynamic' },
    { id: 'primitives/cylinder', label: 'Cylinder', defaultCategory: 'static-prop' },
]

const CATEGORY_LABEL: Record<Category, string> = {
    'static-bulk': 'Static Bulk',
    'static-prop': 'Static Prop',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
}

const CATEGORIES: Category[] = ['static-bulk', 'static-prop', 'dynamic', 'breakable']

export function AssetLibraryPanel() {
    const addInstance = useEditorStore((s) => s.addInstance)

    const onAdd = (asset: AssetEntry, category: Category) => {
        addInstance(defaultInstanceFor(asset.id, category))
    }

    return (
        <div className="flex flex-col h-full text-neutral-200 text-sm">
            <div className="px-3 py-2 border-b border-neutral-800 font-semibold uppercase text-xs tracking-wider text-neutral-400">
                Assets
            </div>
            <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-500">
                Primitives (Phase 1). GLBs em <code className="text-neutral-400">public/assets/</code> chegam na Phase 2.
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="px-3 py-2 text-xs uppercase tracking-wider text-neutral-500">Primitives</div>
                {PRIMITIVES.map((asset) => (
                    <div key={asset.id} className="px-3 py-2 hover:bg-neutral-800/50 border-b border-neutral-900">
                        <div className="flex items-center justify-between">
                            <span className="font-medium">{asset.label}</span>
                            <span className="text-xs text-neutral-500">{asset.id}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1">
                            {CATEGORIES.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => onAdd(asset, cat)}
                                    className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-left"
                                    title={`Add as ${CATEGORY_LABEL[cat]}`}
                                >
                                    + {CATEGORY_LABEL[cat]}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
