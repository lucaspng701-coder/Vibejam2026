import { useState } from 'react'
import type { Category, Instance, LightKind } from '../../level/types'
import { defaultInstanceFor, PLAYER_ASSET_ID, useEditorStore } from '../state/store'
import { ASSET_CATALOG } from '../../level/asset-catalog'

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

const LIGHTS: { id: string; label: string; kind: LightKind }[] = [
    { id: 'lights/point', label: 'Point Light', kind: 'point' },
    { id: 'lights/spot', label: 'Spot Light', kind: 'spot' },
    { id: 'lights/directional', label: 'Directional Light', kind: 'directional' },
]

const CATEGORY_LABEL: Record<Category, string> = {
    'static-bulk': 'Static Bulk',
    'static-prop': 'Static Prop',
    dynamic: 'Dynamic',
    breakable: 'Breakable',
    'no-collision': 'No collision',
    light: 'Light',
    player: 'Player',
}

const CATEGORIES: Category[] = ['static-bulk', 'static-prop', 'dynamic', 'breakable', 'no-collision']

type Tab = 'glbs' | 'primitives' | 'lights' | 'gameplay'

export function AssetLibraryPanel() {
    const [tab, setTab] = useState<Tab>('glbs')
    const [defaultCat, setDefaultCat] = useState<Category>('static-prop')
    const addInstance = useEditorStore((s) => s.addInstance)
    const hasPlayer = useEditorStore((s) =>
        s.instances.some((i) => i.category === 'player'),
    )
    const selectPlayer = () => {
        const existing = useEditorStore
            .getState()
            .instances.find((i) => i.category === 'player')
        if (existing) useEditorStore.getState().select(existing.id)
    }

    const glbEntries: AssetEntry[] = ASSET_CATALOG.filter((e) => !e.isFracturedVariant).map((e) => ({
        id: e.assetId,
        label: e.label,
        defaultCategory: e.meta?.category ?? (e.group === 'breakables' ? 'breakable' : 'static-prop'),
    }))

    const addAsset = (asset: AssetEntry, category?: Category) => {
        addInstance(defaultInstanceFor(asset.id, category ?? asset.defaultCategory))
    }

    const addLight = (kind: LightKind, assetId: string) => {
        const base: Omit<Instance, 'id'> = {
            ...defaultInstanceFor(assetId, 'light'),
            position: [0, 3, 0],
            props: {
                lightKind: kind,
                color: '#ffffff',
                intensity: kind === 'directional' ? 1 : 5,
                distance: kind === 'directional' ? 0 : 10,
                decay: 2,
                angle: kind === 'spot' ? Math.PI / 6 : undefined,
                penumbra: kind === 'spot' ? 0.3 : undefined,
                castShadow: false,
            },
        }
        addInstance(base)
    }

    return (
        <div className="h-full flex flex-col text-neutral-200 text-xs">
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-neutral-800 bg-neutral-950">
                <TabBtn active={tab === 'glbs'} onClick={() => setTab('glbs')}>
                    GLBs <span className="text-neutral-600">({glbEntries.length})</span>
                </TabBtn>
                <TabBtn active={tab === 'primitives'} onClick={() => setTab('primitives')}>
                    Primitives
                </TabBtn>
                <TabBtn active={tab === 'lights'} onClick={() => setTab('lights')}>
                    Lights
                </TabBtn>
                <TabBtn active={tab === 'gameplay'} onClick={() => setTab('gameplay')}>
                    Gameplay
                </TabBtn>

                <div className="flex-1" />

                {(tab === 'glbs' || tab === 'primitives') && (
                    <label className="text-[10px] text-neutral-500 flex items-center gap-1">
                        Add as
                        <select
                            value={defaultCat}
                            onChange={(e) => setDefaultCat(e.target.value as Category)}
                            className="bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-[10px] text-neutral-300"
                        >
                            {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                    {CATEGORY_LABEL[c]}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-hidden">
                <div className="flex gap-2 p-3 h-full items-stretch">
                    {tab === 'glbs' &&
                        (glbEntries.length === 0 ? (
                            <div className="text-neutral-600">Nenhum GLB em public/assets.</div>
                        ) : (
                            glbEntries.map((asset) => (
                                <AssetCard
                                    key={asset.id}
                                    label={asset.label}
                                    sub={asset.id}
                                    icon="▣"
                                    iconColor="#6a8fb0"
                                    onAdd={() => addAsset(asset, defaultCat)}
                                />
                            ))
                        ))}

                    {tab === 'primitives' &&
                        PRIMITIVES.map((asset) => (
                            <AssetCard
                                key={asset.id}
                                label={asset.label}
                                sub={asset.id}
                                icon={asset.id.endsWith('sphere') ? '●' : asset.id.endsWith('cylinder') ? '▮' : '▣'}
                                iconColor="#8aa0b8"
                                onAdd={() => addAsset(asset, defaultCat)}
                            />
                        ))}

                    {tab === 'lights' &&
                        LIGHTS.map((light) => (
                            <AssetCard
                                key={light.id}
                                label={light.label}
                                sub={light.id}
                                icon="●"
                                iconColor="#f2d25a"
                                onAdd={() => addLight(light.kind, light.id)}
                            />
                        ))}

                    {tab === 'gameplay' && (
                        <AssetCard
                            label={hasPlayer ? 'Player (já adicionado)' : 'Player Spawn'}
                            sub={hasPlayer ? 'click pra selecionar' : PLAYER_ASSET_ID}
                            icon="☻"
                            iconColor="#33cc66"
                            onAdd={
                                hasPlayer
                                    ? selectPlayer
                                    : () =>
                                          addInstance({
                                              ...defaultInstanceFor(PLAYER_ASSET_ID, 'player'),
                                          })
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    )
}

function TabBtn({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: React.ReactNode
}) {
    return (
        <button
            onClick={onClick}
            className={`text-xs px-2.5 py-1 rounded border ${
                active
                    ? 'bg-blue-900/60 border-blue-700 text-blue-100'
                    : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800 text-neutral-300'
            }`}
        >
            {children}
        </button>
    )
}

function AssetCard({
    label,
    sub,
    icon,
    iconColor,
    onAdd,
}: {
    label: string
    sub: string
    icon: string
    iconColor: string
    onAdd: () => void
}) {
    return (
        <button
            onClick={onAdd}
            className="shrink-0 w-40 flex flex-col items-stretch text-left bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 rounded overflow-hidden transition-colors"
            title="Click to add to scene"
        >
            <div className="h-16 flex items-center justify-center bg-neutral-950/70">
                <span style={{ color: iconColor }} className="text-3xl">
                    {icon}
                </span>
            </div>
            <div className="px-2 py-1.5 border-t border-neutral-800">
                <div className="font-medium text-neutral-200 truncate">{label}</div>
                <div className="text-[10px] text-neutral-500 font-mono truncate">{sub}</div>
            </div>
        </button>
    )
}
