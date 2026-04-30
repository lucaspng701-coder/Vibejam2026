import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { InstanceProps } from './types'
import { clampOpacity } from './tint'

let decalPlaneGeometry: THREE.PlaneGeometry | null = null

function getDecalPlaneGeometry() {
    if (!decalPlaneGeometry) decalPlaneGeometry = new THREE.PlaneGeometry(1, 1)
    return decalPlaneGeometry
}

function useTexture(url: string | undefined) {
    const [texture, setTexture] = useState<THREE.Texture | null>(null)

    useEffect(() => {
        if (!url) {
            setTexture(null)
            return
        }
        let cancelled = false
        const loader = new THREE.TextureLoader()
        loader.load(
            url,
            (loaded) => {
                if (cancelled) {
                    loaded.dispose()
                    return
                }
                loaded.colorSpace = THREE.SRGBColorSpace
                loaded.wrapS = THREE.ClampToEdgeWrapping
                loaded.wrapT = THREE.ClampToEdgeWrapping
                loaded.magFilter = THREE.NearestFilter
                loaded.minFilter = THREE.LinearMipMapLinearFilter
                loaded.needsUpdate = true
                setTexture(loaded)
            },
            undefined,
            () => {
                if (!cancelled) {
                    console.warn(`[decal-plane] textura nao encontrada: ${url}`)
                    setTexture(null)
                }
            },
        )
        return () => {
            cancelled = true
        }
    }, [url])

    return texture
}

function normalized(value: unknown, fallback: number) {
    const n = Number(value)
    return Number.isFinite(n) ? THREE.MathUtils.clamp(n, 0, 1) : fallback
}

function positiveInt(value: unknown, fallback: number) {
    const n = Math.floor(Number(value))
    return Number.isFinite(n) && n > 0 ? n : fallback
}

function frameUv(props: InstanceProps | undefined, elapsed: number) {
    const columns = positiveInt(props?.sheetColumns, 1)
    const rows = positiveInt(props?.sheetRows, 1)
    const frameCount = positiveInt(props?.frameCount, 1)
    const frameStart = Math.max(0, Math.floor(Number(props?.frameStart ?? 0)))
    const fps = Math.max(0, Number(props?.frameFps ?? 0))
    const loop = props?.frameLoop !== false

    if (columns > 1 || rows > 1 || frameCount > 1) {
        const rawFrame = fps > 0 ? Math.floor(elapsed * fps) : 0
        const localFrame = loop ? rawFrame % frameCount : Math.min(frameCount - 1, rawFrame)
        const frame = frameStart + localFrame
        const col = frame % columns
        const row = Math.floor(frame / columns) % rows
        return {
            x: col / columns,
            y: row / rows,
            w: 1 / columns,
            h: 1 / rows,
        }
    }

    return {
        x: normalized(props?.uvX, 0),
        y: normalized(props?.uvY, 0),
        w: normalized(props?.uvW, 1),
        h: normalized(props?.uvH, 1),
    }
}

function applyAtlasUv(texture: THREE.Texture, uv: { x: number; y: number; w: number; h: number }) {
    texture.repeat.set(Math.max(0.001, uv.w), Math.max(0.001, uv.h))
    texture.offset.set(uv.x, 1 - uv.y - uv.h)
    texture.needsUpdate = true
}

export function DecalPlane({
    props,
    fallbackColor = '#ffffff',
    highlighted = false,
}: {
    props?: InstanceProps
    fallbackColor?: string
    highlighted?: boolean
}) {
    const sourceTexture = useTexture(props?.textureUrl)
    const materialRef = useRef<THREE.MeshBasicMaterial>(null)
    const texture = useMemo(() => {
        if (!sourceTexture) return null
        return sourceTexture.clone()
    }, [sourceTexture])
    const startedAt = useRef(performance.now())
    const opacity = clampOpacity(props?.opacity)

    useEffect(() => {
        if (!texture) return
        applyAtlasUv(texture, frameUv(props, 0))
    }, [
        texture,
        props?.uvX,
        props?.uvY,
        props?.uvW,
        props?.uvH,
        props?.sheetColumns,
        props?.sheetRows,
        props?.frameStart,
        props?.frameCount,
    ])

    useFrame(() => {
        if (!texture) return
        const frameCount = positiveInt(props?.frameCount, 1)
        const fps = Math.max(0, Number(props?.frameFps ?? 0))
        if (frameCount <= 1 || fps <= 0) return
        applyAtlasUv(texture, frameUv(props, (performance.now() - startedAt.current) / 1000))
    })

    useEffect(() => {
        return () => texture?.dispose()
    }, [texture])

    return (
        <mesh castShadow={false} receiveShadow={false}>
            <primitive object={getDecalPlaneGeometry()} attach="geometry" />
            <meshBasicMaterial
                ref={materialRef}
                map={texture}
                color={props?.color as string | undefined ?? fallbackColor}
                transparent
                opacity={opacity}
                alphaTest={0.01}
                depthWrite={false}
                side={THREE.DoubleSide}
                toneMapped={false}
            />
            {highlighted && (
                <lineSegments renderOrder={20}>
                    <edgesGeometry args={[getDecalPlaneGeometry()]} />
                    <lineBasicMaterial color="#ffff66" depthTest={false} />
                </lineSegments>
            )}
        </mesh>
    )
}
