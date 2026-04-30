import Rapier from '@dimforge/rapier3d-compat'
import { KeyboardControls, PointerLockControls, useKeyboardControls } from '@react-three/drei'
import { useFrame, useThree, createPortal } from '@react-three/fiber'
import { CapsuleCollider, RigidBody, RigidBodyProps, useBeforePhysicsStep, useRapier } from '@react-three/rapier'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGamepad } from '../common/hooks/use-gamepad'
import { useControls } from 'leva'
import * as THREE from 'three'
import { playerCollision } from './physics-collision-filters'
import { Component, Entity, EntityType } from './ecs'
import type { Vec3 } from '../level/types'
import { SpriteFrameAnimation, type SpriteAnimationState } from './sprite-animation'
import { PLAYER_WEAPON_RELOAD_COMPLETE_EVENT, PLAYER_WEAPON_RELOAD_EVENT, PLAYER_WEAPON_SHOOT_EVENT } from './weapon-events'

const _direction = new THREE.Vector3()
const _frontVector = new THREE.Vector3()
const _sideVector = new THREE.Vector3()
const _characterLinvel = new THREE.Vector3()
const _characterTranslation = new THREE.Vector3()
const _cameraWorldDirection = new THREE.Vector3()
const _cameraPosition = new THREE.Vector3()

const normalFov = 90
const sprintFov = 100
const STAND_CAMERA_HEIGHT = 1
const CROUCH_CAMERA_HEIGHT = 0.35
const STAND_CAPSULE_HALF_HEIGHT = 1
const CROUCH_CAPSULE_HALF_HEIGHT = 0.45
const PLAYER_CAPSULE_RADIUS = 0.5
const CROUCH_COLLIDER_OFFSET_Y =
    -(STAND_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS) +
    (CROUCH_CAPSULE_HALF_HEIGHT + PLAYER_CAPSULE_RADIUS)
const CROUCH_SPEED_MULTIPLIER = 0.7

const WEAPON_SPRITE_STATES: Record<string, SpriteAnimationState> = {
    idle: {
        frames: ['/assets/sprites/player/staplergun/idle/staplergun_idle.png'],
        frameMs: 120,
        loop: true,
    },
    shoot: {
        frames: [
            '/assets/sprites/player/staplergun/shooting/Shoot_00000.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00001.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00002.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00003.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00004.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00005.png',
            '/assets/sprites/player/staplergun/shooting/Shoot_00006.png',
        ],
        frameMs: 12,
        loop: false,
    },
    reload: {
        frames: [
            '/assets/sprites/player/staplergun/reloading/Reload_00004.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00005.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00006.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00007.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00008.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00009.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00010.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00011.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00012.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00013.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00014.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00015.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00016.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00017.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00018.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00019.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00020.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00021.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00022.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00023.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00024.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00025.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00026.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00027.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00028.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00029.png',
            '/assets/sprites/player/staplergun/reloading/Reload_00030.png',
        ],
        frameMs: 80,
        loop: false,
    },
}

function FirstPersonWeaponSprite({
    position,
    scale,
}: {
    position: [number, number, number]
    scale: number
}) {
    const [state, setState] = useState<'idle' | 'shoot' | 'reload'>('idle')
    const stateRef = useRef<typeof state>(state)

    useEffect(() => {
        stateRef.current = state
    }, [state])

    useEffect(() => {
        const onShoot = () => {
            if (stateRef.current === 'reload') return
            setState('shoot')
        }
        const onReload = () => {
            setState('reload')
        }
        window.addEventListener(PLAYER_WEAPON_SHOOT_EVENT, onShoot)
        window.addEventListener(PLAYER_WEAPON_RELOAD_EVENT, onReload)
        return () => {
            window.removeEventListener(PLAYER_WEAPON_SHOOT_EVENT, onShoot)
            window.removeEventListener(PLAYER_WEAPON_RELOAD_EVENT, onReload)
        }
    }, [])

    const onAnimationComplete = (completedState: string) => {
        if (completedState === 'reload') {
            window.dispatchEvent(new CustomEvent(PLAYER_WEAPON_RELOAD_COMPLETE_EVENT))
        }
        if (completedState === stateRef.current) {
            setState('idle')
        }
    }

    return (
        <group position={position}>
            <SpriteFrameAnimation
                states={WEAPON_SPRITE_STATES}
                state={state}
                width={scale}
                faceCamera={false}
                renderOrder={1000}
                onComplete={onAnimationComplete}
            />
        </group>
    )
}

const characterShapeOffset = 0.1
const autoStepMaxHeight = 2
const autoStepMinWidth = 0.05
const accelerationTimeAirborne = 0.2
const accelerationTimeGrounded = 0.025
const timeToJumpApex = 2
const maxJumpHeight = 0.5
const minJumpHeight = 0.2
const velocityXZSmoothing = 0.1
const velocityXZMin = 0.0001
const jumpGravity = -(2 * maxJumpHeight) / Math.pow(timeToJumpApex, 2)
const maxJumpVelocity = Math.abs(jumpGravity) * timeToJumpApex
const minJumpVelocity = Math.sqrt(2 * Math.abs(jumpGravity) * minJumpHeight)

const up = new THREE.Vector3(0, 1, 0)

export type PlayerControls = {
    children: React.ReactNode
}

type PlayerProps = RigidBodyProps & {
    onMove?: (position: THREE.Vector3) => void
    walkSpeed?: number
    runSpeed?: number
    jumpForce?: number
    respawnPosition?: Vec3
    spawnRotation?: Vec3
    fallLimitY?: number
}

export const Player = ({
    onMove,
    walkSpeed = 0.1,
    runSpeed = 0.15,
    jumpForce = 0.5,
    respawnPosition,
    spawnRotation = [0, 0, 0],
    fallLimitY = -20,
    ...props
}: PlayerProps) => {
    const playerRef = useRef<EntityType>(null!)

    const { x, y, z, scale } = useControls('Weapon Sprite', {
        x: { value: 0.13, min: -1, max: 1, step: 0.01 },
        y: { value: -0.26, min: -1, max: 1, step: 0.01 },
        z: { value: -0.54, min: -2, max: -0.1, step: 0.01 },
        scale: { value: 1.43, min: 0.2, max: 4, step: 0.01 },
    }, {
        collapsed: true,
        order: 998,
    })

    const rapier = useRapier()
    const camera = useThree((state) => state.camera)
    const clock = useThree((state) => state.clock)

    // Arma: `createPortal` (R3F) anexa o modelo na câmera. O `camera.add`
    // imperativo quebrava com re-renders da cena (muitos projéteis, etc.),
    // fazendo a arma sumir — o reconcilier gerencia a hierarquia de forma
    // estável.

    const characterController = useRef<Rapier.KinematicCharacterController>(null!)

    const [, getKeyboardControls] = useKeyboardControls()
    const gamepadState = useGamepad()

    const horizontalVelocity = useRef({ x: 0, z: 0 })
    const jumpVelocity = useRef(0)
    const holdingJump = useRef(false)
    const jumpTime = useRef(0)
    const jumping = useRef(false)
    const lastRespawnAt = useRef(0)
    const [colliderCrouched, setColliderCrouched] = useState(false)

    const respawnPlayer = useCallback(() => {
        const body = playerRef.current?.rigidBody
        if (!body) return
        const target = respawnPosition ?? (props.position as Vec3 | undefined) ?? [0, 2, 10]
        body.setNextKinematicTranslation({ x: target[0], y: target[1], z: target[2] })
        body.setTranslation({ x: target[0], y: target[1], z: target[2] }, true)
        horizontalVelocity.current = { x: 0, z: 0 }
        jumpVelocity.current = 0
        jumping.current = false
        holdingJump.current = false
        camera.position.set(target[0], target[1] + STAND_CAMERA_HEIGHT, target[2])
        camera.quaternion.setFromEuler(new THREE.Euler(0, spawnRotation[1] ?? 0, 0, 'YXZ'))
    }, [camera, props.position, respawnPosition, spawnRotation])

    useEffect(() => {
        camera.quaternion.setFromEuler(new THREE.Euler(0, spawnRotation[1] ?? 0, 0, 'YXZ'))
    }, [camera, spawnRotation])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code === 'KeyU') respawnPlayer()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [respawnPlayer])

    useEffect(() => {
        const { world } = rapier

        characterController.current = world.createCharacterController(characterShapeOffset)
        characterController.current.enableAutostep(autoStepMaxHeight, autoStepMinWidth, true)
        characterController.current.setSlideEnabled(true)
        characterController.current.enableSnapToGround(0.1)
        characterController.current.setApplyImpulsesToDynamicBodies(true)

        return () => {
            world.removeCharacterController(characterController.current)
            characterController.current = null!
        }
    }, [rapier])

    useBeforePhysicsStep(() => {
        const characterRigidBody = playerRef.current.rigidBody

        if (!characterRigidBody) return

        const characterCollider = characterRigidBody.collider(0)

        const { forward, backward, left, right, jump, sprint, crouch } = getKeyboardControls() as KeyControls

        // Combine keyboard and gamepad input
        const moveForward = forward || (gamepadState.leftStick.y < 0)
        const moveBackward = backward || (gamepadState.leftStick.y > 0)
        const moveLeft = left || (gamepadState.leftStick.x < 0)
        const moveRight = right || (gamepadState.leftStick.x > 0)
        const isJumping = jump || gamepadState.buttons.jump
        const isCrouching = crouch
        setColliderCrouched((current) => (current === isCrouching ? current : isCrouching))
        const isSprinting = !isCrouching && (sprint || gamepadState.buttons.leftStickPress)

        const speed =
            walkSpeed *
            (isSprinting ? runSpeed / walkSpeed : 1) *
            (isCrouching ? CROUCH_SPEED_MULTIPLIER : 1)

        const grounded = characterController.current.computedGrounded()

        // x and z movement
        _frontVector.set(0, 0, Number(moveBackward) - Number(moveForward))
        _sideVector.set(Number(moveLeft) - Number(moveRight), 0, 0)

        const cameraWorldDirection = camera.getWorldDirection(_cameraWorldDirection)
        const cameraYaw = Math.atan2(cameraWorldDirection.x, cameraWorldDirection.z)

        _direction.subVectors(_frontVector, _sideVector).normalize().multiplyScalar(speed)
        _direction.applyAxisAngle(up, cameraYaw).multiplyScalar(-1)

        const horizontalVelocitySmoothing = velocityXZSmoothing * (grounded ? accelerationTimeGrounded : accelerationTimeAirborne)
        const horizontalVelocityLerpFactor = 1 - Math.pow(horizontalVelocitySmoothing, 0.116)
        horizontalVelocity.current = {
            x: THREE.MathUtils.lerp(horizontalVelocity.current.x, _direction.x, horizontalVelocityLerpFactor),
            z: THREE.MathUtils.lerp(horizontalVelocity.current.z, _direction.z, horizontalVelocityLerpFactor),
        }

        if (Math.abs(horizontalVelocity.current.x) < velocityXZMin) {
            horizontalVelocity.current.x = 0
        }
        if (Math.abs(horizontalVelocity.current.z) < velocityXZMin) {
            horizontalVelocity.current.z = 0
        }

        // jumping and gravity
        if (isJumping && grounded) {
            jumping.current = true
            holdingJump.current = true
            jumpTime.current = clock.elapsedTime
            jumpVelocity.current = maxJumpVelocity * (jumpForce / 0.5) // Scale jump velocity based on jumpForce
        }

        if (!isJumping && grounded) {
            jumping.current = false
        }

        if (jumping.current && holdingJump.current && !isJumping) {
            if (jumpVelocity.current > minJumpVelocity) {
                jumpVelocity.current = minJumpVelocity
            }
        }

        if (!isJumping && grounded) {
            jumpVelocity.current = 0
        } else {
            jumpVelocity.current += jumpGravity * 0.116
        }

        holdingJump.current = isJumping

        // compute movement direction
        const movementDirection = {
            x: horizontalVelocity.current.x,
            y: jumpVelocity.current,
            z: horizontalVelocity.current.z,
        }

        // compute collider movement and update rigid body
        characterController.current.computeColliderMovement(characterCollider, movementDirection)

        const translation = characterRigidBody.translation()
        const newPosition = _characterTranslation.copy(translation as THREE.Vector3)
        const movement = characterController.current.computedMovement()
        newPosition.add(movement)

        characterRigidBody.setNextKinematicTranslation(newPosition)
    })

    useFrame((_, delta) => {
        const characterRigidBody = playerRef.current.rigidBody
        if (!characterRigidBody) {
            return
        }

        _characterLinvel.copy(characterRigidBody.linvel() as THREE.Vector3)
        const currentSpeed = _characterLinvel.length()

        const controlsState = getKeyboardControls() as KeyControls
        const isCrouching = controlsState.crouch
        const isSprinting = !isCrouching && (controlsState.sprint || gamepadState.buttons.leftStickPress)

        const translation = characterRigidBody.translation()
        if (translation.y < fallLimitY) {
            const now = performance.now()
            if (now - lastRespawnAt.current > 500) {
                lastRespawnAt.current = now
                respawnPlayer()
            }
            return
        }
        onMove?.(translation as THREE.Vector3)
        const targetCameraHeight = isCrouching ? CROUCH_CAMERA_HEIGHT : STAND_CAMERA_HEIGHT
        const cameraPosition = _cameraPosition.set(translation.x, translation.y + targetCameraHeight, translation.z)
        const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')

        // Different sensitivities for horizontal and vertical aiming
        const CAMERA_SENSITIVITY_X = 0.04
        const CAMERA_SENSITIVITY_Y = 0.03

        // Apply gamepad right stick for camera rotation
        if (gamepadState.connected && (Math.abs(gamepadState.rightStick.x) > 0 || Math.abs(gamepadState.rightStick.y) > 0)) {
            // Update Euler angles
            cameraEuler.y -= gamepadState.rightStick.x * CAMERA_SENSITIVITY_X
            cameraEuler.x = THREE.MathUtils.clamp(
                cameraEuler.x - gamepadState.rightStick.y * CAMERA_SENSITIVITY_Y,
                -Math.PI / 2,
                Math.PI / 2
            )

            // Apply the new rotation while maintaining up vector
            camera.quaternion.setFromEuler(cameraEuler)
        }

        camera.position.lerp(cameraPosition, Math.min(1, delta * 30))

        // FOV change for sprint
        if (camera instanceof THREE.PerspectiveCamera) {
            camera.fov = THREE.MathUtils.lerp(
                camera.fov,
                isSprinting && currentSpeed > 0.1 ? sprintFov : normalFov,
                Math.min(1, 10 * delta),
            )
            camera.updateProjectionMatrix()
        }
    })

    return (
        <>
            {createPortal(
                <FirstPersonWeaponSprite position={[x, y, z]} scale={scale} />,
                camera,
            )}
            <Entity isPlayer ref={playerRef}>
                <Component name="rigidBody">
                    <RigidBody
                        {...props}
                        colliders={false}
                        mass={1}
                        type="kinematicPosition"
                        enabledRotations={[false, false, false]}
                    >
                        <object3D name="player" />
                        <CapsuleCollider
                            args={[
                                colliderCrouched
                                    ? CROUCH_CAPSULE_HALF_HEIGHT
                                    : STAND_CAPSULE_HALF_HEIGHT,
                                PLAYER_CAPSULE_RADIUS,
                            ]}
                            position={[
                                0,
                                colliderCrouched ? CROUCH_COLLIDER_OFFSET_Y : 0,
                                0,
                            ]}
                            collisionGroups={playerCollision()}
                            solverGroups={playerCollision()}
                        />
                    </RigidBody>
                </Component>
            </Entity>
        </>
    )
}

type KeyControls = {
    forward: boolean
    backward: boolean
    left: boolean
    right: boolean
    sprint: boolean
    jump: boolean
    crouch: boolean
}

const controls = [
    { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
    { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
    { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
    { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
    { name: 'jump', keys: ['Space'] },
    { name: 'sprint', keys: ['Shift'] },
    { name: 'crouch', keys: ['c', 'C'] },
]

export const PlayerControls = ({ children }: PlayerControls) => {
    return (
        <KeyboardControls map={controls}>
            {children}
            <PointerLockControls makeDefault />
        </KeyboardControls>
    )
}
