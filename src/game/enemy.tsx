import { CapsuleCollider, RigidBody, type CollisionEnterPayload, type RapierRigidBody } from '@react-three/rapier'
import { useCallback, useRef, useState } from 'react'
import type { Vec3 } from '../level/types'
import { enemyCollision } from './physics-collision-filters'
import { isSphereProjectileHandle } from './sphere-projectile-handles'

const DEFAULT_MAX_HP = 100
const DAMAGE_PER_HIT = 10
const DAMAGE_COOLDOWN_MS = 80

type EnemyProps = {
    id: string
    position: Vec3
    rotation: Vec3
    scale: Vec3
    maxHp?: number
    color?: string
}

function getRigidBodyHandle(body: RapierRigidBody | undefined): number | undefined {
    return (body as { handle?: number } | undefined)?.handle
}

/** Static target only: HP, projectile damage, death. No AI or movement. */
export function Enemy({ id, position, rotation, scale, maxHp, color = '#b02222' }: EnemyProps) {
    const [hp, setHp] = useState(maxHp ?? DEFAULT_MAX_HP)
    const lastDamageAt = useRef(0)

    const onCollisionEnter = useCallback((payload: CollisionEnterPayload) => {
        const handle = getRigidBodyHandle(payload.other.rigidBody)
        if (!isSphereProjectileHandle(handle)) return

        const now = performance.now()
        if (now - lastDamageAt.current < DAMAGE_COOLDOWN_MS) return
        lastDamageAt.current = now

        setHp((current) => Math.max(0, current - DAMAGE_PER_HIT))
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
