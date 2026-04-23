import * as THREE from 'three'

/**
 * Applies a debug tint to every material inside `root`.
 *
 * Behaviour:
 * - If `color` is undefined/empty, materials are left untouched.
 * - For materials that expose a `color` property (Standard, Basic, Lambert,
 *   Phong, Physical, Toon, ...) we directly set it. Existing `map`/textures
 *   keep rendering because three.js multiplies the sample by `color`.
 * - Materials without a `color` field (e.g. `ShaderMaterial`) are skipped.
 *
 * IMPORTANT: we assume materials were already cloned upstream (via
 * `gltf.scene.clone(true)` + reassigning `.material`) so mutation here stays
 * local to a single instance.
 */
export function applyTintToObject(root: THREE.Object3D, color: string | undefined): void {
    if (!color) return
    const tint = new THREE.Color(color)
    root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !mesh.material) return
        if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => applyTintToMaterial(m, tint))
        } else {
            applyTintToMaterial(mesh.material, tint)
        }
    })
}

export function applyTintToMaterial(material: THREE.Material, color: THREE.Color): void {
    const withColor = material as unknown as { color?: THREE.Color }
    if (withColor.color instanceof THREE.Color) {
        withColor.color.copy(color)
    }
}
