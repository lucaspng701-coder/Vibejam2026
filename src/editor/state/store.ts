import { create } from 'zustand'
import {
    DEFAULT_LEVEL_EDGE_OUTLINE,
    DEFAULT_LEVEL_ENVIRONMENT,
    DEFAULT_LEVEL_LIGHTING,
    normalizeLevelEdgeOutline,
    normalizeLevelEnvironment,
    normalizeLevelLighting,
} from '../../level/environment'
import type {
    Category,
    Instance,
    InstanceProps,
    LevelEdgeOutline,
    LevelFile,
    LevelEnvironment,
    LevelLighting,
    Vec3,
} from '../../level/types'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

interface HistoryEntry {
    instances: Instance[]
}

export interface EditorGroup {
    id: string
    name: string
    children: string[]
}

interface EditorState {
    levelName: string
    environment: LevelEnvironment
    lighting: LevelLighting
    edgeOutline: LevelEdgeOutline
    instances: Instance[]
    selectedId: string | null
    selectedIds: string[]
    selectedGroupId: string | null
    groups: EditorGroup[]
    mode: GizmoMode
    showColliders: boolean
    showGrid: boolean
    previewLighting: boolean

    // history
    past: HistoryEntry[]
    future: HistoryEntry[]

    // actions
    setLevelName: (name: string) => void
    setEnvironment: (patch: LevelEnvironment) => void
    setLighting: (patch: LevelLighting) => void
    setEdgeOutline: (patch: LevelEdgeOutline) => void
    setMode: (mode: GizmoMode) => void
    toggleColliders: () => void
    toggleGrid: () => void
    togglePreviewLighting: () => void
    select: (id: string | null, options?: { additive?: boolean }) => void
    selectGroup: (id: string | null) => void

    addInstance: (inst: Omit<Instance, 'id'> & { id?: string }) => string
    removeInstance: (id: string) => void
    removeSelected: () => void
    duplicateInstance: (id: string) => string | null
    duplicateSelected: () => string[]
    groupSelected: () => string | null
    updateTransform: (
        id: string,
        patch: Partial<Pick<Instance, 'position' | 'rotation' | 'scale'>>,
        options?: { mergeHistory?: boolean },
    ) => void
    updateTransforms: (
        patches: Array<{ id: string; patch: Partial<Pick<Instance, 'position' | 'rotation' | 'scale'>> }>,
    ) => void
    updateCategory: (id: string, category: Category) => void
    updateProps: (id: string, patch: InstanceProps) => void
    updateAssetId: (id: string, assetId: string) => void

    loadLevel: (level: LevelFile) => void
    toLevelFile: () => LevelFile

    undo: () => void
    redo: () => void
    canUndo: () => boolean
    canRedo: () => boolean
}

const HISTORY_LIMIT = 100

function genId(): string {
    return `inst_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

function snapshot(state: EditorState): HistoryEntry {
    return { instances: state.instances }
}

function pushHistory(state: EditorState): Pick<EditorState, 'past' | 'future'> {
    const next = [...state.past, snapshot(state)]
    if (next.length > HISTORY_LIMIT) next.shift()
    return { past: next, future: [] }
}

export const useEditorStore = create<EditorState>((set, get) => ({
    levelName: 'untitled',
    environment: DEFAULT_LEVEL_ENVIRONMENT,
    lighting: DEFAULT_LEVEL_LIGHTING,
    edgeOutline: DEFAULT_LEVEL_EDGE_OUTLINE,
    instances: [],
    selectedId: null,
    selectedIds: [],
    selectedGroupId: null,
    groups: [],
    mode: 'translate',
    showColliders: false,
    showGrid: true,
    previewLighting: false,
    past: [],
    future: [],

    setLevelName: (name) => set({ levelName: name }),
    setEnvironment: (patch) =>
        set((s) => ({
            environment: normalizeLevelEnvironment({ ...s.environment, ...patch }),
        })),
    setLighting: (patch) =>
        set((s) => ({
            lighting: normalizeLevelLighting({ ...s.lighting, ...patch }),
        })),
    setEdgeOutline: (patch) =>
        set((s) => ({
            edgeOutline: normalizeLevelEdgeOutline({ ...s.edgeOutline, ...patch }),
        })),
    setMode: (mode) => set({ mode }),
    toggleColliders: () => set((s) => ({ showColliders: !s.showColliders })),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    togglePreviewLighting: () => set((s) => ({ previewLighting: !s.previewLighting })),
    select: (id, options) =>
        set((s) => {
            if (id === null) return { selectedId: null, selectedIds: [], selectedGroupId: null }
            if (!options?.additive) return { selectedId: id, selectedIds: [id], selectedGroupId: null }
            const exists = s.selectedIds.includes(id)
            const selectedIds = exists
                ? s.selectedIds.filter((x) => x !== id)
                : [...s.selectedIds, id]
            return {
                selectedId: exists ? selectedIds[selectedIds.length - 1] ?? null : id,
                selectedIds,
                selectedGroupId: null,
            }
        }),

    selectGroup: (id) =>
        set((s) => {
            if (!id) return { selectedGroupId: null, selectedId: null, selectedIds: [] }
            const group = s.groups.find((g) => g.id === id)
            if (!group) return {}
            return {
                selectedGroupId: id,
                selectedId: group.children[group.children.length - 1] ?? null,
                selectedIds: group.children.filter((childId) =>
                    s.instances.some((inst) => inst.id === childId),
                ),
            }
        }),

    addInstance: (inst) => {
        const id = inst.id ?? genId()
        set((s) => {
            // Player é singleton por level: se já existir um, substitui a
            // posição do antigo em vez de criar duplicado. Assim o usuário
            // pode clicar "Add Player" quantas vezes quiser sem poluir o
            // outliner.
            if (inst.category === 'player') {
                const existing = s.instances.find((i) => i.category === 'player')
                if (existing) {
                    return {
                        ...pushHistory(s),
                        instances: s.instances.map((i) =>
                            i.id === existing.id
                                ? { ...existing, position: inst.position, rotation: inst.rotation }
                                : i,
                        ),
                        selectedId: existing.id,
                        selectedIds: [existing.id],
                    }
                }
            }
            return {
                ...pushHistory(s),
                instances: [...s.instances, { ...inst, id }],
                selectedId: id,
                selectedIds: [id],
                selectedGroupId: null,
            }
        })
        return id
    },

    removeInstance: (id) =>
        set((s) => ({
            ...pushHistory(s),
            instances: s.instances.filter((i) => i.id !== id),
            selectedId: s.selectedId === id ? null : s.selectedId,
            selectedIds: s.selectedIds.filter((x) => x !== id),
            groups: s.groups
                .map((g) => ({ ...g, children: g.children.filter((childId) => childId !== id) }))
                .filter((g) => g.children.length > 0),
            selectedGroupId: s.groups.find((g) => g.id === s.selectedGroupId)?.children.includes(id)
                ? null
                : s.selectedGroupId,
        })),

    removeSelected: () =>
        set((s) => {
            const selected = new Set(s.selectedIds)
            if (selected.size === 0) return {}
            return {
                ...pushHistory(s),
                instances: s.instances.filter((i) => !selected.has(i.id)),
                selectedId: null,
                selectedIds: [],
                selectedGroupId: null,
                groups: s.groups
                    .map((g) => ({ ...g, children: g.children.filter((id) => !selected.has(id)) }))
                    .filter((g) => g.children.length > 0),
            }
        }),

    duplicateInstance: (id) => {
        const source = get().instances.find((i) => i.id === id)
        if (!source) return null
        // Player é singleton: não permite duplicar.
        if (source.category === 'player') return null
        const newId = genId()
        const clone: Instance = {
            ...source,
            id: newId,
            position: [source.position[0] + 1, source.position[1], source.position[2] + 1],
        }
        set((s) => ({
            ...pushHistory(s),
            instances: [...s.instances, clone],
            selectedId: newId,
            selectedIds: [newId],
            selectedGroupId: null,
        }))
        return newId
    },

    duplicateSelected: () => {
        const state = get()
        const sourceGroup = state.selectedGroupId
            ? state.groups.find((g) => g.id === state.selectedGroupId) ?? null
            : null
        const selected = sourceGroup
            ? sourceGroup.children
            : state.selectedIds.length > 0
            ? state.selectedIds
            : state.selectedId
              ? [state.selectedId]
              : []
        const sources = selected
            .map((id) => state.instances.find((i) => i.id === id))
            .filter((i): i is Instance => Boolean(i) && i.category !== 'player')
        if (sources.length === 0) return []
        const newIds: string[] = []
        const clones = sources.map((source) => {
            const newId = genId()
            newIds.push(newId)
            return {
                ...source,
                id: newId,
                position: [source.position[0] + 1, source.position[1], source.position[2] + 1] as Vec3,
            }
        })
        const newGroupId = sourceGroup && newIds.length > 1
            ? `group_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
            : null
        set((s) => ({
            ...pushHistory(s),
            instances: [...s.instances, ...clones],
            groups: newGroupId
                ? [
                      ...s.groups,
                      {
                          id: newGroupId,
                          name: `${sourceGroup?.name ?? 'Group'} copy`,
                          children: newIds,
                      },
                  ]
                : s.groups,
            selectedId: newIds[newIds.length - 1] ?? null,
            selectedIds: newIds,
            selectedGroupId: newGroupId,
        }))
        return newIds
    },

    groupSelected: () => {
        const state = get()
        const selected = state.selectedIds.filter((id) => state.instances.some((i) => i.id === id))
        if (selected.length < 2) return null
        const id = `group_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`
        set((s) => ({
            groups: [
                ...s.groups.filter((g) => !selected.every((childId) => g.children.includes(childId))),
                { id, name: `Group ${s.groups.length + 1}`, children: selected },
            ],
            selectedGroupId: id,
            selectedId: selected[selected.length - 1] ?? null,
            selectedIds: selected,
        }))
        return id
    },

    updateTransform: (id, patch, options) =>
        set((s) => {
            const history = options?.mergeHistory
                ? { past: s.past, future: [] }
                : pushHistory(s)
            return {
                ...history,
                instances: s.instances.map((i) => (i.id === id ? { ...i, ...patch } : i)),
            }
        }),

    updateTransforms: (patches) =>
        set((s) => {
            if (patches.length === 0) return {}
            const byId = new Map(patches.map((p) => [p.id, p.patch]))
            return {
                ...pushHistory(s),
                instances: s.instances.map((i) => {
                    const patch = byId.get(i.id)
                    return patch ? { ...i, ...patch } : i
                }),
            }
        }),

    updateCategory: (id, category) =>
        set((s) => {
            // Impede ter 2 players por level: se o usuário tentar promover um
            // objeto pra player com outro já existente, ignora a mudança.
            if (category === 'player' && s.instances.some((i) => i.category === 'player' && i.id !== id)) {
                console.warn('[editor] já existe um Player no level; category não alterada.')
                return {}
            }
            return {
                ...pushHistory(s),
                instances: s.instances.map((i) => (i.id === id ? { ...i, category } : i)),
            }
        }),

    updateProps: (id, patch) =>
        set((s) => ({
            ...pushHistory(s),
            instances: s.instances.map((i) =>
                i.id === id ? { ...i, props: { ...(i.props ?? {}), ...patch } } : i,
            ),
        })),

    updateAssetId: (id, assetId) =>
        set((s) => ({
            ...pushHistory(s),
            instances: s.instances.map((i) => (i.id === id ? { ...i, assetId } : i)),
        })),

    loadLevel: (level) => {
        // Enforce singleton do Player no load: mantém o primeiro encontrado,
        // descarta os outros e loga aviso.
        const seen = new Set<string>()
        const sanitized: Instance[] = []
        let droppedPlayers = 0
        for (const inst of level.instances) {
            if (inst.category === 'player') {
                if (seen.has('player')) {
                    droppedPlayers++
                    continue
                }
                seen.add('player')
            }
            sanitized.push(inst)
        }
        if (droppedPlayers > 0) {
            console.warn(
                `[editor] level ${level.name} tinha ${droppedPlayers + 1} players; mantido apenas o primeiro.`,
            )
        }
        set({
            levelName: level.name,
            environment: normalizeLevelEnvironment(level.environment),
            lighting: normalizeLevelLighting(level.lighting),
            edgeOutline: normalizeLevelEdgeOutline(level.edgeOutline),
            instances: sanitized,
            selectedId: null,
            selectedIds: [],
            selectedGroupId: null,
            groups: (level.groups ?? [])
                .map((g) => ({
                    ...g,
                    children: g.children.filter((id) => sanitized.some((inst) => inst.id === id)),
                }))
                .filter((g) => g.children.length > 0),
            past: [],
            future: [],
        })
    },

    toLevelFile: () => {
        const groups = get().groups
            .map((g) => ({
                ...g,
                children: g.children.filter((id) => get().instances.some((inst) => inst.id === id)),
            }))
            .filter((g) => g.children.length > 0)
        return {
            version: 1,
            name: get().levelName,
            environment: normalizeLevelEnvironment(get().environment),
            lighting: normalizeLevelLighting(get().lighting),
            edgeOutline: normalizeLevelEdgeOutline(get().edgeOutline),
            instances: get().instances,
            ...(groups.length > 0 ? { groups } : {}),
        }
    },

    undo: () =>
        set((s) => {
            if (s.past.length === 0) return {}
            const prev = s.past[s.past.length - 1]
            return {
                instances: prev.instances,
                past: s.past.slice(0, -1),
                future: [snapshot(s), ...s.future],
                selectedId: prev.instances.some((i) => i.id === s.selectedId) ? s.selectedId : null,
                selectedIds: s.selectedIds.filter((id) => prev.instances.some((i) => i.id === id)),
            }
        }),

    redo: () =>
        set((s) => {
            if (s.future.length === 0) return {}
            const next = s.future[0]
            return {
                instances: next.instances,
                past: [...s.past, snapshot(s)],
                future: s.future.slice(1),
                selectedId: next.instances.some((i) => i.id === s.selectedId) ? s.selectedId : null,
                selectedIds: s.selectedIds.filter((id) => next.instances.some((i) => i.id === id)),
            }
        }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
}))

export function defaultInstanceFor(assetId: string, category: Category): Omit<Instance, 'id'> {
    // Player / inimigo spawnam um pouco acima do chão (cápsula ~2m de altura).
    const pos: Vec3 =
        category === 'player' || category === 'enemy' || category === 'enemy-trigger'
            ? [0, 1.5, 0]
            : [0, 1, 0]

    // Planos nascem horizontais (normal +Y). A rotação vive na instância —
    // não baked na geometria — porque o MeshReflectorMaterial deriva o plano
    // de reflexão de `mesh.matrixWorld` assumindo normal local +Z; rotação
    // baked resultaria em reflexo vertical/esticado.
    if (assetId === 'primitives/plane') {
        return {
            assetId,
            category,
            position: [0, 0, 0],
            rotation: [-Math.PI / 2, 0, 0],
            scale: [4, 4, 1],
        }
    }

    return {
        assetId,
        category,
        position: pos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        ...(category === 'enemy'
            ? {
                  props: {
                      maxHp: 100,
                      visionRange: 12,
                      visionAngleDeg: 70,
                      moveSpeed: 2.2,
                      showVisionCone: false,
                  },
              }
            : category === 'enemy-trigger'
              ? {
                    scale: [4, 3, 4],
                    props: {
                        triggerOnce: true,
                        showTriggerVolume: false,
                    },
                }
            : category === 'decal'
              ? {
                    scale: [1, 1, 1],
                    props: {
                        textureUrl: '',
                        material: 'unlit',
                        uvX: 0,
                        uvY: 0,
                        uvW: 1,
                        uvH: 1,
                        sheetColumns: 1,
                        sheetRows: 1,
                        frameStart: 0,
                        frameCount: 1,
                        frameFps: 6,
                        frameLoop: true,
                    },
                }
            : {}),
    }
}

/**
 * ID de asset "virtual" usado pra o Player singleton. Não corresponde a um
 * GLB: no editor renderiza uma cápsula verde + o `fps.glb` da câmera do jogo
 * como preview visual.
 */
export const PLAYER_ASSET_ID = 'player/spawn'

export const ENEMY_ASSET_ID = 'enemy/spawn'
export const ENEMY_TRIGGER_ASSET_ID = 'enemy/trigger'
export const DECAL_ASSET_ID = 'decal/sprite-plane'
