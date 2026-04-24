import { interactionGroups } from '@react-three/rapier'

/**
 * Índices 0..15 (API Rapier / r3/rapier). Não trocar ordem sem revalidar tudo o que usa
 * `interactionGroups`.
 */
export const CollisionGroup = {
    /** Cenário: chão, paredes, props estáticos, breakables, debris, etc. */
    world: 0,
    player: 1,
    projectile: 2,
    enemy: 3,
} as const

/** Cenário: colide com tudo o que ainda interessa (player, inimigo, bala). */
const ALL = [CollisionGroup.world, CollisionGroup.player, CollisionGroup.projectile, CollisionGroup.enemy] as const

export const worldCollision = () => interactionGroups([CollisionGroup.world], [...ALL])

/**
 * Jogador: mura + inimigos, **não** com projéteis (evita ricochete no próprio corpo).
 */
export const playerCollision = () => interactionGroups([CollisionGroup.player], [CollisionGroup.world, CollisionGroup.enemy])

/**
 * Bala: mura e inimigos, **não** o capsule do player.
 */
export const projectileCollision = () =>
    interactionGroups([CollisionGroup.projectile], [CollisionGroup.world, CollisionGroup.enemy])

/** Inimigo: cenário, player e balas; inclui inimigo–inimigo. */
export const enemyCollision = () => interactionGroups([CollisionGroup.enemy], [...ALL])
