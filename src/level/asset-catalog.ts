import type { Category, ColliderBox } from './types'

export interface AssetMeta {
    category?: Category
    mass?: number
    fractureThreshold?: number
    fracturedAssetId?: string
    debrisMass?: number
    debrisLifetimeMs?: number
    colliderBoxes?: ColliderBox[]
    colliderSize?: [number, number, number]
    colliderOffset?: [number, number, number]
}

export interface AssetCatalogEntry {
    assetId: string
    url: string
    label: string
    group: string
    isFracturedVariant: boolean
    meta?: AssetMeta
}

const glbModules = import.meta.glob('../../public/assets/**/*.glb', {
    eager: true,
    query: '?url',
    import: 'default',
}) as Record<string, string>

const metaModules = import.meta.glob('../../public/assets/**/*.meta.json', {
    eager: true,
    import: 'default',
}) as Record<string, AssetMeta>

function toAssetId(path: string, extension: '.glb' | '.meta.json'): string | null {
    const normalized = path.replace(/\\/g, '/')
    const marker = '/public/assets/'
    const idx = normalized.indexOf(marker)
    if (idx < 0) return null
    const rest = normalized.slice(idx + marker.length)
    if (!rest.endsWith(extension)) return null
    return rest.slice(0, -extension.length)
}

function toLabel(assetId: string): string {
    const name = assetId.split('/').pop() ?? assetId
    return name
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
}

const metaByAssetId = Object.entries(metaModules).reduce<Record<string, AssetMeta>>((acc, [path, meta]) => {
    const id = toAssetId(path, '.meta.json')
    if (id) acc[id] = meta
    return acc
}, {})

export const ASSET_CATALOG: AssetCatalogEntry[] = Object.entries(glbModules)
    .map(([path, url]) => {
        const assetId = toAssetId(path, '.glb')
        if (!assetId) return null
        const group = assetId.split('/')[0] ?? 'misc'
        return {
            assetId,
            url,
            label: toLabel(assetId),
            group,
            isFracturedVariant: /_fractured$/.test(assetId),
            meta: metaByAssetId[assetId],
        } satisfies AssetCatalogEntry
    })
    .filter((entry): entry is AssetCatalogEntry => entry !== null)
    .sort((a, b) => a.assetId.localeCompare(b.assetId))

const byId = new Map(ASSET_CATALOG.map((e) => [e.assetId, e]))

export function resolveAssetUrl(assetId: string): string {
    return byId.get(assetId)?.url ?? `/assets/${assetId}.glb`
}

export function getAssetMeta(assetId: string): AssetMeta | undefined {
    return byId.get(assetId)?.meta
}

export function resolveFracturedAssetId(assetId: string, explicit?: string): string {
    if (explicit) return explicit
    const preferred = `${assetId}_fractured`
    if (byId.has(preferred)) return preferred
    const alt = `${assetId}_fracture`
    if (byId.has(alt)) return alt
    return preferred
}
