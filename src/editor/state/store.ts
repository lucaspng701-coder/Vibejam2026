import { create } from 'zustand'
import type { Category, Instance, InstanceProps, LevelFile, Vec3 } from '../../level/types'

export type GizmoMode = 'translate' | 'rotate' | 'scale'

interface HistoryEntry {
    instances: Instance[]
}

interface EditorState {
    levelName: string
    instances: Instance[]
    selectedId: string | null
    mode: GizmoMode
    showColliders: boolean
    showGrid: boolean
    previewLighting: boolean

    // history
    past: HistoryEntry[]
    future: HistoryEntry[]

    // actions
    setLevelName: (name: string) => void
    setMode: (mode: GizmoMode) => void
    toggleColliders: () => void
    toggleGrid: () => void
    togglePreviewLighting: () => void
    select: (id: string | null) => void

    addInstance: (inst: Omit<Instance, 'id'> & { id?: string }) => string
    removeInstance: (id: string) => void
    duplicateInstance: (id: string) => string | null
    updateTransform: (id: string, patch: Partial<Pick<Instance, 'position' | 'rotation' | 'scale'>>) => void
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
    instances: [],
    selectedId: null,
    mode: 'translate',
    showColliders: false,
    showGrid: true,
    previewLighting: false,
    past: [],
    future: [],

    setLevelName: (name) => set({ levelName: name }),
    setMode: (mode) => set({ mode }),
    toggleColliders: () => set((s) => ({ showColliders: !s.showColliders })),
    toggleGrid: () => set((s) => ({ showGrid: !s.showGrid })),
    togglePreviewLighting: () => set((s) => ({ previewLighting: !s.previewLighting })),
    select: (id) => set({ selectedId: id }),

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
                    }
                }
            }
            return {
                ...pushHistory(s),
                instances: [...s.instances, { ...inst, id }],
                selectedId: id,
            }
        })
        return id
    },

    removeInstance: (id) =>
        set((s) => ({
            ...pushHistory(s),
            instances: s.instances.filter((i) => i.id !== id),
            selectedId: s.selectedId === id ? null : s.selectedId,
        })),

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
        }))
        return newId
    },

    updateTransform: (id, patch) =>
        set((s) => ({
            ...pushHistory(s),
            instances: s.instances.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        })),

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
            instances: sanitized,
            selectedId: null,
            past: [],
            future: [],
        })
    },

    toLevelFile: () => ({
        version: 1,
        name: get().levelName,
        instances: get().instances,
    }),

    undo: () =>
        set((s) => {
            if (s.past.length === 0) return {}
            const prev = s.past[s.past.length - 1]
            return {
                instances: prev.instances,
                past: s.past.slice(0, -1),
                future: [snapshot(s), ...s.future],
                selectedId: prev.instances.some((i) => i.id === s.selectedId) ? s.selectedId : null,
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
            }
        }),

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
}))

export function defaultInstanceFor(assetId: string, category: Category): Omit<Instance, 'id'> {
    // Player spawna um pouco acima do chão pra não ficar enterrado na altura
    // padrão da cápsula do Player (1m de meia-altura).
    const pos: Vec3 = category === 'player' ? [0, 1.5, 0] : [0, 1, 0]
    return {
        assetId,
        category,
        position: pos,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
    }
}

/**
 * ID de asset "virtual" usado pra o Player singleton. Não corresponde a um
 * GLB: no editor renderiza uma cápsula verde + o `fps.glb` da câmera do jogo
 * como preview visual.
 */
export const PLAYER_ASSET_ID = 'player/spawn'
