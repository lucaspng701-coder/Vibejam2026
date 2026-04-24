import { CapsuleCollider, RigidBody, type RapierRigidBody, type CollisionEnterPayload } from '@react-three/rapier'
import { useCallback, useRef, useState } from 'react'
import type { Vec3 } from '../level/types'
import { enemyCollision } from './physics-collision-filters'
import { isSphereProjectileHandle } from './sphere-projectile-handles'

const DEFAULT_MAX_HP = 100
const DAMAGE_PER_SHOT = 10
const DAMAGE_COOLDOWN_MS = 80

type EnemyProps = {
    id: string
    position: Vec3
    rotation: Vec3
    scale: Vec3
    maxHp?: number
    color?: string
}

function getRigidBodyHandleFromPayload(body: RapierRigidBody | undefined): number | undefined {
    if (body == null) return undefined
    // RigidBody do Rapier: propriedade .handle (number) — o tipo re-exportado
    // costuma ser compatível, mas caimos pra um acesso defensivo.
    return (body as { handle?: number }).handle
}

/**
 * Inimigo estático: cápsula vermelha, HP simples. Dano somente se o contato
 * vier de um corpo cujo handle foi registrado em `sphere-projectile-handles`
 * (spawn do SphereTool) — nenhuma alteração na simulação da bala.
 */
export function Enemy({ id, position, rotation, scale, maxHp, color = '#b02222' }: EnemyProps) {
    const maxHealth = maxHp ?? DEFAULT_MAX_HP
    const [hp, setHp] = useState(maxHealth)
    const lastDamageAt = useRef(0)
    const canTakeDamage = useRef(true)

    const onCollisionEnter = useCallback((payload: CollisionEnterPayload) => {
        if (!canTakeDamage.current) return
        const other = payload.other.rigidBody
        const handle = getRigidBodyHandleFromPayload(other)
        if (!isSphereProjectileHandle(handle)) return
        const now = performance.now()
        if (now - lastDamageAt.current < DAMAGE_COOLDOWN_MS) return
        lastDamageAt.current = now
        setHp((h) => {
            if (h <= 0) return 0
            const next = Math.max(0, h - DAMAGE_PER_SHOT)
            if (next <= 0) canTakeDamage.current = false
            return next
        })
    }, [])

    if (hp <= 0) return null

    return (
        <RigidBody
            name={`enemy-${id}`}
            type="fixed"
            position={position}
            rotation={rotation}
            colliders={false}
            onCollisionEnter={onCollisionEnter}
        >
            <group scale={scale}>
                <CapsuleCollider
                    args={[1, 0.5]}
                    collisionGroups={enemyCollision()}
                    solverGroups={enemyCollision()}
                />
                <mesh castShadow>
                    <capsuleGeometry args={[0.5, 1, 4, 12]} />
                    <meshStandardMaterial color={color} roughness={0.5} />
                </mesh>
            </group>
        </RigidBody>
    )
}
