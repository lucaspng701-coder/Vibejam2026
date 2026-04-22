import { create } from 'zustand'
import type * as THREE from 'three'

interface MeshRegistry {
    meshes: Record<string, THREE.Object3D>
    set: (id: string, object: THREE.Object3D | null) => void
}

/**
 * Transient registry mapping instance id → scene object.
 * Kept out of the undoable store so it does not pollute history.
 */
export const useMeshRegistry = create<MeshRegistry>((set) => ({
    meshes: {},
    set: (id, object) =>
        set((s) => {
            const next = { ...s.meshes }
            if (object) next[id] = object
            else delete next[id]
            return { meshes: next }
        }),
}))
