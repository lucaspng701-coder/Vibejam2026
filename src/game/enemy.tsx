import { useFrame } from '@react-three/fiber'
import {
    CapsuleCollider,
    RigidBody,
    type RapierCollider,
    type CollisionEnterPayload,
    type RapierRigidBody,
    interactionGroups,
    useRapier,
} from '@react-three/rapier'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../level/types'
import { clampOpacity } from '../level/tint'
import { CollisionGroup, enemyCollision } from './physics-collision-filters'
import { registerEnemyHitTarget, setEnemyHitTargetActive, unregisterEnemyHitTarget, updateEnemyHitTargetPose } from './enemy-hit-registry'
import { dispatchProjectileHitEnemy } from './projectile-hit-events'
import { SpriteFrameAnimation } from './sprite-animation'
import { isSphereProjectileHandle } from './sphere-projectile-handles'

const DEFAULT_MAX_HP = 100
const DEFAULT_MOVE_SPEED = 2.2
const DAMAGE_PER_HIT = 10
const DAMAGE_COOLDOWN_MS = 80
const EYE_HEIGHT = 1
const STOP_DISTANCE = 1.2
const HIT_FLASH_MS = 90
const NAV_CHECK_INTERVAL_MS = 90
const NAV_PROBE_DISTANCE = 4
const NAV_PROBE_HEIGHT = 0.45
const NAV_TURN_SMOOTHING = 0.65
const NAV_SAMPLE_ANGLES = [0, 30, -30, 55, -55, 85, -85, 120, -120, 160, -160]
const NAV_AVOIDANCE_TRIGGER_CLEARANCE = 0.16
const NAV_SLOW_CLEARANCE = 0.22
const NAV_CRAWL_CLEARANCE = 0.1
const ENEMY_BODY_MASS = 12
const ENEMY_WALK_SPRITE = '/assets/sprites/enemies/walk/walk.png'
const ENEMY_SPRITE_WIDTH = 7
const ENEMY_CAPSULE_HALF_HEIGHT = 1.1
const ENEMY_CAPSULE_RADIUS = 0.5
const ENEMY_DESPAWN_DELAY_MS = 120

const _enemyEye = new THREE.Vector3()
const _playerEye = new THREE.Vector3()
const _toPlayer = new THREE.Vector3()
const _flatToPlayer = new THREE.Vector3()
const _velocity = new THREE.Vector3()
const _navOrigin = new THREE.Vector3()
const _navDesired = new THREE.Vector3()
const _navCandidate = new THREE.Vector3()
const _navBest = new THREE.Vector3()
const _navUp = new THREE.Vector3(0, 1, 0)

type EnemyProps = {
    id: string
    position: Vec3
    rotation: Vec3
    scale: Vec3
    maxHp?: number
    visionRange?: number
    visionAngleDeg?: number
    moveSpeed?: number
    showVisionCone?: boolean
    activated?: boolean
    color?: string
    opacity?: number
    playerPositionRef?: RefObject<THREE.Vector3>
}

function getRigidBodyHandle(body: RapierRigidBody | undefined): number | undefined {
    return (body as { handle?: number } | undefined)?.handle
}

function yawFromForward(forward: THREE.Vector3) {
    return Math.atan2(-forward.x, -forward.z)
}

export function Enemy({
    id,
    position,
    rotation,
    scale,
    maxHp,
    moveSpeed = DEFAULT_MOVE_SPEED,
    activated = true,
    color = '#b02222',
    opacity,
    playerPositionRef,
}: EnemyProps) {
    const rb = useRef<RapierRigidBody>(null)
    const colliderRef = useRef<RapierCollider>(null)
    const facingGroup = useRef<THREE.Group>(null)
    const { world, rapier } = useRapier()
    const [hp, setHp] = useState(maxHp ?? DEFAULT_MAX_HP)
    const [isChasing, setIsChasing] = useState(false)
    const [hitFlash, setHitFlash] = useState(false)
    const [shouldDespawn, setShouldDespawn] = useState(false)
    const isChasingRef = useRef(false)
    const isDead = hp <= 0
    const lastDamageAt = useRef(0)
    const registeredHandles = useRef<{ body?: number; collider?: number } | null>(null)
    const facingYaw = useRef(rotation[1] ?? 0)
    const navDir = useRef(new THREE.Vector3(0, 0, -1))
    const navSpeedScale = useRef(1)
    const lastNavCheckAt = useRef(0)
    const renderOpacity = clampOpacity(opacity)
    const worldProbeGroups = useMemo(
        () => interactionGroups([CollisionGroup.enemy], [CollisionGroup.world]),
        [],
    )

    const setChasing = useCallback((next: boolean) => {
        if (isChasingRef.current === next) return
        isChasingRef.current = next
        setIsChasing(next)
    }, [])

    const applyHit = useCallback((hitPosition: Vec3, normal: Vec3) => {
        if (hp <= 0) return
        const now = performance.now()
        if (now - lastDamageAt.current < DAMAGE_COOLDOWN_MS) return
        lastDamageAt.current = now
        dispatchProjectileHitEnemy({ position: hitPosition, normal })
        setHitFlash(true)
        window.setTimeout(() => setHitFlash(false), HIT_FLASH_MS)
        setHp((current) => Math.max(0, current - DAMAGE_PER_HIT))
    }, [hp])

    const syncHitTargetRegistration = useCallback(() => {
        const bodyHandle = (rb.current as { handle?: number } | null)?.handle
        const colliderHandle = (colliderRef.current as { handle?: number } | null)?.handle
        if (bodyHandle === undefined && colliderHandle === undefined) return

        const current = registeredHandles.current
        if (current?.body === bodyHandle && current?.collider === colliderHandle) {
            registerEnemyHitTarget(id, bodyHandle, colliderHandle, applyHit)
            return
        }

        if (current) unregisterEnemyHitTarget(current.body, current.collider)
        registerEnemyHitTarget(id, bodyHandle, colliderHandle, applyHit)
        registeredHandles.current = { body: bodyHandle, collider: colliderHandle }
    }, [applyHit, id])

    const updateHitTargetPose = useCallback(() => {
        const body = rb.current
        if (!body) return
        const bodyHandle = (body as { handle?: number }).handle
        const colliderHandle = (colliderRef.current as { handle?: number } | null)?.handle
        const t = body.translation()
        updateEnemyHitTargetPose(
            bodyHandle,
            colliderHandle,
            [t.x, t.y, t.z],
            0.62 * Math.max(scale[0], scale[2]),
            ENEMY_CAPSULE_HALF_HEIGHT * scale[1],
        )
    }, [scale])

    useEffect(() => {
        syncHitTargetRegistration()
        updateHitTargetPose()
        return () => {
            const current = registeredHandles.current
            if (current) unregisterEnemyHitTarget(current.body, current.collider)
            registeredHandles.current = null
        }
    }, [syncHitTargetRegistration, updateHitTargetPose])

    const onCollisionEnter = useCallback((payload: CollisionEnterPayload) => {
        if (hp <= 0) return
        const handle = getRigidBodyHandle(payload.other.rigidBody)
        if (!isSphereProjectileHandle(handle)) return

        const now = performance.now()
        if (now - lastDamageAt.current < DAMAGE_COOLDOWN_MS) return
        lastDamageAt.current = now

        const body = rb.current
        const t = body?.translation()
        const projectileBody = payload.other.rigidBody?.translation()
        const hitPosition: Vec3 = t
            ? [t.x, t.y + EYE_HEIGHT * 0.35, t.z]
            : position
        const normal = new THREE.Vector3(
            (projectileBody?.x ?? hitPosition[0]) - hitPosition[0],
            (projectileBody?.y ?? hitPosition[1]) - hitPosition[1],
            (projectileBody?.z ?? hitPosition[2]) - hitPosition[2],
        )
        if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0)
        normal.normalize()
        dispatchProjectileHitEnemy({
            position: hitPosition,
            normal: [normal.x, normal.y, normal.z],
            projectileHandle: handle,
        })
        setHitFlash(true)
        window.setTimeout(() => setHitFlash(false), HIT_FLASH_MS)
        setHp((current) => Math.max(0, current - DAMAGE_PER_HIT))
    }, [hp, position])

    useEffect(() => {
        if (!isDead) {
            setShouldDespawn(false)
            return
        }
        const current = registeredHandles.current
        if (current) {
            setEnemyHitTargetActive(current.body, current.collider, false)
            unregisterEnemyHitTarget(current.body, current.collider)
            registeredHandles.current = null
        }
        const body = rb.current
        if (body) {
            body.setLinvel({ x: 0, y: 0, z: 0 }, true)
            body.setAngvel({ x: 0, y: 0, z: 0 }, true)
            body.setEnabled(false)
        }
        setChasing(false)
        const despawnTimer = window.setTimeout(() => setShouldDespawn(true), ENEMY_DESPAWN_DELAY_MS)
        return () => window.clearTimeout(despawnTimer)
    }, [isDead, setChasing])

    useFrame(() => {
        const body = rb.current
        const player = playerPositionRef?.current
        if (isDead) return
        if (!body || !player) return
        syncHitTargetRegistration()
        updateHitTargetPose()

        const currentVel = body.linvel()
        if (!activated) {
            setChasing(false)
            body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true)
            return
        }

        const t = body.translation()
        _enemyEye.set(t.x, t.y + EYE_HEIGHT, t.z)
        _playerEye.copy(player).addScalar(0)
        _playerEye.y += EYE_HEIGHT
        _toPlayer.subVectors(_playerEye, _enemyEye)

        _flatToPlayer.set(_toPlayer.x, 0, _toPlayer.z)
        const flatDistance = _flatToPlayer.length()

        setChasing(true)

        if (flatDistance > STOP_DISTANCE) {
            _navDesired.set(_toPlayer.x, 0, _toPlayer.z).normalize()

            const now = performance.now()
            if (now - lastNavCheckAt.current >= NAV_CHECK_INTERVAL_MS) {
                lastNavCheckAt.current = now
                _navOrigin.set(t.x, t.y + NAV_PROBE_HEIGHT, t.z)
                _navBest.copy(_navDesired)
                navSpeedScale.current = 1

                const directHit = world.castRay(
                    new rapier.Ray(_navOrigin, _navDesired),
                    NAV_PROBE_DISTANCE,
                    true,
                    undefined,
                    worldProbeGroups,
                )
                const directClearance = directHit
                    ? THREE.MathUtils.clamp(directHit.timeOfImpact / NAV_PROBE_DISTANCE, 0, 1)
                    : 1

                if (directClearance <= NAV_AVOIDANCE_TRIGGER_CLEARANCE) {
                    let bestScore = -Infinity
                    let bestClearance = directClearance

                    for (const angleDeg of NAV_SAMPLE_ANGLES) {
                        _navCandidate
                            .copy(_navDesired)
                            .applyAxisAngle(_navUp, THREE.MathUtils.degToRad(angleDeg))
                            .normalize()

                        const hit = world.castRay(
                            new rapier.Ray(_navOrigin, _navCandidate),
                            NAV_PROBE_DISTANCE,
                            true,
                            undefined,
                            worldProbeGroups,
                        )
                        const clearance = hit
                            ? THREE.MathUtils.clamp(hit.timeOfImpact / NAV_PROBE_DISTANCE, 0, 1)
                            : 1
                        const forwardScore = _navCandidate.dot(_navDesired)
                        const turnPenalty = Math.abs(angleDeg) / 180
                        const score = clearance * 1.1 + forwardScore * 1.4 - turnPenalty * 0.18

                        if (score > bestScore) {
                            bestScore = score
                            bestClearance = clearance
                            _navBest.copy(_navCandidate)
                        }
                    }

                    navSpeedScale.current =
                        bestClearance < NAV_CRAWL_CLEARANCE
                            ? 0.32
                            : bestClearance < NAV_SLOW_CLEARANCE
                                ? 0.68
                                : 1
                }

                navDir.current.lerp(_navBest, NAV_TURN_SMOOTHING).normalize()
            }

            _velocity.copy(navDir.current).multiplyScalar(moveSpeed * navSpeedScale.current)
            body.setLinvel({ x: _velocity.x, y: currentVel.y, z: _velocity.z }, true)
            facingYaw.current = yawFromForward(_velocity)
        } else {
            body.setLinvel({ x: 0, y: currentVel.y, z: 0 }, true)
        }

        if (facingGroup.current) {
            facingGroup.current.rotation.y = facingYaw.current - (rotation[1] ?? 0)
        }
    })

    if (shouldDespawn) return null

    return (
        <RigidBody
            ref={rb}
            name={`enemy-${id}`}
            type="dynamic"
            position={position}
            rotation={rotation}
            colliders={false}
            mass={ENEMY_BODY_MASS}
            friction={0.2}
            linearDamping={6}
            angularDamping={10}
            dominanceGroup={-10}
            enabledRotations={[false, false, false]}
            onCollisionEnter={onCollisionEnter}
        >
            <group ref={facingGroup} scale={scale} visible={!isDead}>
                <CapsuleCollider
                    ref={colliderRef}
                    args={[ENEMY_CAPSULE_HALF_HEIGHT, ENEMY_CAPSULE_RADIUS]}
                    collisionGroups={enemyCollision()}
                    solverGroups={enemyCollision()}
                />
            </group>
            <group position-y={-(ENEMY_CAPSULE_HALF_HEIGHT + ENEMY_CAPSULE_RADIUS) * scale[1]} scale={scale}>
                <SpriteFrameAnimation
                    states={{
                        walk: {
                            frames: [ENEMY_WALK_SPRITE],
                            frameMs: 120,
                            loop: true,
                        },
                    }}
                    state="walk"
                    width={ENEMY_SPRITE_WIDTH}
                    opacity={hitFlash ? 0.92 : renderOpacity}
                    color={hitFlash ? '#ff1f1f' : '#ffffff'}
                    faceCamera
                    transparent
                    anchorY="bottom"
                    renderOrder={0}
                    depthTest
                    depthWrite={false}
                />
            </group>
        </RigidBody>
    )
}
