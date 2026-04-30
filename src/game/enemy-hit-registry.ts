import type { Vec3 } from '../level/types'

type EnemyHitEntry = {
    id: string
    damage: (hitPosition: Vec3, normal: Vec3) => void
    position: Vec3
    radius: number
    halfHeight: number
    active: boolean
}

const enemiesByRigidBodyHandle = new Map<number, EnemyHitEntry>()
const enemiesByColliderHandle = new Map<number, EnemyHitEntry>()

export function registerEnemyHitTarget(
    id: string,
    rigidBodyHandle: number | undefined,
    colliderHandle: number | undefined,
    damage: (hitPosition: Vec3, normal: Vec3) => void,
) {
    const entry: EnemyHitEntry = {
        id,
        damage,
        position: [0, 0, 0],
        radius: 0.6,
        halfHeight: 1.1,
        active: true,
    }
    if (rigidBodyHandle !== undefined) enemiesByRigidBodyHandle.set(rigidBodyHandle, entry)
    if (colliderHandle !== undefined) enemiesByColliderHandle.set(colliderHandle, entry)
}

export function unregisterEnemyHitTarget(
    rigidBodyHandle: number | undefined,
    colliderHandle: number | undefined,
) {
    if (rigidBodyHandle !== undefined) enemiesByRigidBodyHandle.delete(rigidBodyHandle)
    if (colliderHandle !== undefined) enemiesByColliderHandle.delete(colliderHandle)
}

export function setEnemyHitTargetActive(
    rigidBodyHandle: number | undefined,
    colliderHandle: number | undefined,
    active: boolean,
) {
    const entry =
        getEnemyByRigidBodyHandle(rigidBodyHandle) ??
        getEnemyByColliderHandle(colliderHandle)
    if (!entry) return
    entry.active = active
}

export function getEnemyByRigidBodyHandle(handle: number | undefined): EnemyHitEntry | undefined {
    return handle === undefined ? undefined : enemiesByRigidBodyHandle.get(handle)
}

export function getEnemyByColliderHandle(handle: number | undefined): EnemyHitEntry | undefined {
    return handle === undefined ? undefined : enemiesByColliderHandle.get(handle)
}

export function updateEnemyHitTargetPose(
    rigidBodyHandle: number | undefined,
    colliderHandle: number | undefined,
    position: Vec3,
    radius: number,
    halfHeight: number,
) {
    const entry =
        getEnemyByRigidBodyHandle(rigidBodyHandle) ??
        getEnemyByColliderHandle(colliderHandle)
    if (!entry) return
    entry.position = position
    entry.radius = radius
    entry.halfHeight = halfHeight
    entry.active = true
}

function raySphere(
    origin: Vec3,
    direction: Vec3,
    center: Vec3,
    radius: number,
    maxDistance: number,
): number | null {
    const ox = origin[0] - center[0]
    const oy = origin[1] - center[1]
    const oz = origin[2] - center[2]
    const b = ox * direction[0] + oy * direction[1] + oz * direction[2]
    const c = ox * ox + oy * oy + oz * oz - radius * radius
    const h = b * b - c
    if (h < 0) return null
    const s = Math.sqrt(h)
    const t = -b - s
    const fallback = -b + s
    const hit = t >= 0 ? t : fallback
    return hit >= 0 && hit <= maxDistance ? hit : null
}

function rayVerticalCapsule(
    origin: Vec3,
    direction: Vec3,
    center: Vec3,
    radius: number,
    halfHeight: number,
    maxDistance: number,
): number | null {
    let best: number | null = null
    const dx = origin[0] - center[0]
    const dz = origin[2] - center[2]
    const a = direction[0] * direction[0] + direction[2] * direction[2]
    const b = 2 * (dx * direction[0] + dz * direction[2])
    const c = dx * dx + dz * dz - radius * radius

    if (a > 1e-8) {
        const h = b * b - 4 * a * c
        if (h >= 0) {
            const s = Math.sqrt(h)
            const candidates = [(-b - s) / (2 * a), (-b + s) / (2 * a)]
            for (const t of candidates) {
                const y = origin[1] + direction[1] * t
                if (t >= 0 && t <= maxDistance && y >= center[1] - halfHeight && y <= center[1] + halfHeight) {
                    best = best === null ? t : Math.min(best, t)
                }
            }
        }
    }

    const top = raySphere(origin, direction, [center[0], center[1] + halfHeight, center[2]], radius, maxDistance)
    const bottom = raySphere(origin, direction, [center[0], center[1] - halfHeight, center[2]], radius, maxDistance)
    for (const t of [top, bottom]) {
        if (t !== null) best = best === null ? t : Math.min(best, t)
    }

    return best
}

export function raycastEnemyHitTargets(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
): { enemy: EnemyHitEntry; distance: number; position: Vec3; normal: Vec3 } | null {
    let best: { enemy: EnemyHitEntry; distance: number; position: Vec3; normal: Vec3 } | null = null
    const seen = new Set<EnemyHitEntry>()
    for (const enemy of enemiesByRigidBodyHandle.values()) seen.add(enemy)
    for (const enemy of enemiesByColliderHandle.values()) seen.add(enemy)

    for (const enemy of seen) {
        if (!enemy.active) continue
        const distance = rayVerticalCapsule(origin, direction, enemy.position, enemy.radius, enemy.halfHeight, maxDistance)
        if (distance === null || (best && distance >= best.distance)) continue

        const position: Vec3 = [
            origin[0] + direction[0] * distance,
            origin[1] + direction[1] * distance,
            origin[2] + direction[2] * distance,
        ]
        const clampedY = Math.max(
            enemy.position[1] - enemy.halfHeight,
            Math.min(enemy.position[1] + enemy.halfHeight, position[1]),
        )
        const normal: Vec3 = [
            position[0] - enemy.position[0],
            position[1] - clampedY,
            position[2] - enemy.position[2],
        ]
        const len = Math.hypot(normal[0], normal[1], normal[2]) || 1
        normal[0] /= len
        normal[1] /= len
        normal[2] /= len
        best = { enemy, distance, position, normal }
    }

    return best
}
