import type { Vec3 } from '../level/types'

export const PROJECTILE_HIT_ENEMY_EVENT = 'projectile-hit-enemy'

export type ProjectileHitEnemyDetail = {
    projectileHandle?: number
    position: Vec3
    normal: Vec3
}

export function dispatchProjectileHitEnemy(detail: ProjectileHitEnemyDetail) {
    window.dispatchEvent(new CustomEvent<ProjectileHitEnemyDetail>(PROJECTILE_HIT_ENEMY_EVENT, { detail }))
}
