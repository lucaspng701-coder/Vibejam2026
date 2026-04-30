import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

export type SpriteAnimationState = {
    frames: string[]
    frameMs?: number
    loop?: boolean
}

type SpriteFrameAnimationProps = {
    states: Record<string, SpriteAnimationState>
    state: string
    width?: number
    height?: number
    faceCamera?: boolean
    transparent?: boolean
    opacity?: number
    color?: string
    depthTest?: boolean
    depthWrite?: boolean
    anchorY?: 'center' | 'bottom'
    renderOrder?: number
    onComplete?: (state: string) => void
}

const _spriteWorldPosition = new THREE.Vector3()
const _spriteLookTarget = new THREE.Vector3()

export function SpriteFrameAnimation({
    states,
    state,
    width = 1,
    height,
    faceCamera = true,
    transparent = true,
    opacity = 1,
    color = '#ffffff',
    depthTest = false,
    depthWrite = false,
    anchorY = 'center',
    renderOrder = 10,
    onComplete,
}: SpriteFrameAnimationProps) {
    const camera = useThree((s) => s.camera)
    const meshRef = useRef<THREE.Mesh>(null)
    const startedAt = useRef(performance.now())
    const completedRef = useRef(false)
    const [frameIndex, setFrameIndex] = useState(0)
    const allFrames = useMemo(
        () => Array.from(new Set(Object.values(states).flatMap((entry) => entry.frames))),
        [states],
    )
    const textures = useTexture(allFrames)
    const textureByUrl = useMemo(() => {
        const map = new Map<string, THREE.Texture>()
        allFrames.forEach((url, index) => {
            const texture = textures[index]
            if (!texture) return
            texture.colorSpace = THREE.SRGBColorSpace
            texture.minFilter = THREE.LinearFilter
            texture.magFilter = THREE.LinearFilter
            map.set(url, texture)
        })
        return map
    }, [allFrames, textures])

    const active = states[state] ?? Object.values(states)[0]
    const activeFrames = active?.frames.length ? active.frames : allFrames
    const activeUrl = activeFrames[Math.min(frameIndex, activeFrames.length - 1)] ?? allFrames[0]
    const activeTexture = activeUrl ? textureByUrl.get(activeUrl) : undefined
    const image = activeTexture?.image as { width?: number; height?: number } | undefined
    const aspect = image?.width && image?.height ? image.width / image.height : 1
    const displayHeight = height ?? width / aspect

    useEffect(() => {
        startedAt.current = performance.now()
        completedRef.current = false
        setFrameIndex(0)
    }, [state])

    useFrame(() => {
        const mesh = meshRef.current
        if (mesh && faceCamera) {
            mesh.getWorldPosition(_spriteWorldPosition)
            _spriteLookTarget.copy(camera.position)
            _spriteLookTarget.y = _spriteWorldPosition.y
            mesh.lookAt(_spriteLookTarget)
        }
        if (!active || activeFrames.length <= 1) return

        const frameMs = active.frameMs ?? 80
        const elapsed = performance.now() - startedAt.current
        const rawFrame = Math.floor(elapsed / frameMs)
        if (!active.loop && rawFrame >= activeFrames.length && !completedRef.current) {
            completedRef.current = true
            onComplete?.(state)
        }
        const next = active.loop
            ? rawFrame % activeFrames.length
            : Math.min(activeFrames.length - 1, rawFrame)
        if (next !== frameIndex) setFrameIndex(next)
    })

    if (!activeTexture) return null

    return (
        <mesh ref={meshRef} renderOrder={renderOrder} position-y={anchorY === 'bottom' ? displayHeight / 2 : 0}>
            <planeGeometry args={[width, displayHeight]} />
            <meshBasicMaterial
                map={activeTexture}
                transparent={transparent}
                opacity={opacity}
                color={color}
                depthTest={depthTest}
                depthWrite={depthWrite}
                toneMapped={false}
                side={THREE.DoubleSide}
            />
        </mesh>
    )
}
