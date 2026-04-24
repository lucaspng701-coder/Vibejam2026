/**
 * Registro de handles Rapier de projéteis (bolas do SphereTool). O inimigo
 * compara o `rigidBody.handle` do contato com este Set — nada de userData
 * compartilhado nem tocar em `linvel`/`velocities`, então a física das bolas
 * permanece intacta; só rastreiamos a identidade do corpo após o spawn.
 */
const sphereProjectileHandles = new Set<number>()

export function registerSphereProjectileHandle(handle: number) {
    sphereProjectileHandles.add(handle)
}

export function unregisterSphereProjectileHandle(handle: number) {
    sphereProjectileHandles.delete(handle)
}

export function isSphereProjectileHandle(handle: number | undefined): boolean {
    return handle !== undefined && sphereProjectileHandles.has(handle)
}
