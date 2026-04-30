/**
 * Registro de handles Rapier de projéteis (bolas do SphereTool). O inimigo
 * compara o `rigidBody.handle` do contato com este Set — nada de userData
 * compartilhado nem tocar em `linvel`/`velocities`, então a física das bolas
 * permanece intacta; só rastreiamos a identidade do corpo após o spawn.
 */
const sphereProjectileHandles = new Set<number>()
const projectileHandleToId = new Map<number, string>()

export function registerSphereProjectileHandle(handle: number, projectileId?: string) {
    sphereProjectileHandles.add(handle)
    if (projectileId) projectileHandleToId.set(handle, projectileId)
}

export function unregisterSphereProjectileHandle(handle: number) {
    sphereProjectileHandles.delete(handle)
    projectileHandleToId.delete(handle)
}

export function isSphereProjectileHandle(handle: number | undefined): boolean {
    return handle !== undefined && sphereProjectileHandles.has(handle)
}

export function getSphereProjectileIdByHandle(handle: number | undefined): string | undefined {
    return handle === undefined ? undefined : projectileHandleToId.get(handle)
}
