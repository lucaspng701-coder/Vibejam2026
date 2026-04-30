import { Edges, MeshReflectorMaterial } from '@react-three/drei'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { InstanceProps } from './types'
import { clampOpacity } from './tint'

export type PrimitiveKind = 'cube' | 'sphere' | 'cylinder' | 'plane'

export function primitiveKindFromAssetId(assetId: string): PrimitiveKind | null {
    if (!assetId.startsWith('primitives/')) return null
    const rest = assetId.slice('primitives/'.length)
    if (rest === 'cube' || rest === 'sphere' || rest === 'cylinder' || rest === 'plane') {
        return rest
    }
    return null
}

/**
 * Geometria compartilhada de plano (1x1, normal local +Z).
 *
 * IMPORTANTE: NÃO pré-rotacionamos a geometria. O `MeshReflectorMaterial` da
 * drei deriva o plano de reflexão a partir de `mesh.matrixWorld` assumindo
 * que a normal local é +Z; se a gente rotacionar no buffer, o reflector vê
 * mesh.rotation = 0 e acha que o "espelho" é vertical, produzindo aquele
 * reflexo "esticado" que parece sombra.
 *
 * Para um plano horizontal, a instância deve ter `rotation = [-π/2, 0, 0]`
 * (é o default do `AssetLibraryPanel` e do `defaultInstanceFor`).
 */
let planeGeometryCached: THREE.BufferGeometry | null = null
function getPlaneGeometry(): THREE.BufferGeometry {
    if (planeGeometryCached) return planeGeometryCached
    planeGeometryCached = new THREE.PlaneGeometry(1, 1)
    return planeGeometryCached
}

function useSafeTexture(url: string): THREE.Texture | null {
    const [texture, setTexture] = useState<THREE.Texture | null>(null)

    useEffect(() => {
        let cancelled = false
        setTexture(null)
        const loader = new THREE.TextureLoader()
        loader.load(
            url,
            (loaded) => {
                if (cancelled) {
                    loaded.dispose()
                    return
                }
                setTexture(loaded)
            },
            undefined,
            () => {
                if (!cancelled) {
                    console.warn(`[primitive-mesh] textura nao encontrada: ${url}`)
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

interface PrimitiveMeshProps {
    kind: PrimitiveKind
    color: string
    props?: InstanceProps
    instanceScale?: [number, number, number]
    /** Para highlight de seleção no editor. Ignorado em runtime do jogo. */
    highlighted?: boolean
    edgeOutline?: EdgeOutlineSettings
}

export interface EdgeOutlineSettings {
    enabled: boolean
    color: string
    threshold: number
    lineWidth: number
}

interface PrimitiveOutlineMeshProps {
    kind: PrimitiveKind
    color: string
    width: number
}

/**
 * Renderiza uma primitiva (cube/sphere/cylinder) com material derivado de
 * `InstanceProps`:
 *
 *   textureUrl + triplanar + textureScale + reflector + color
 *
 * Regras simples desta versão:
 *   - `reflector = true` substitui o material por `MeshReflectorMaterial`
 *     (pros chões reflexivos). Se também vier com `triplanar = true`, a textura
 *     usa projeção em world-space e o reflexo continua ativo.
 *   - `triplanar = true` requer `textureUrl` e usa `textureScale` como TILE em
 *     metros (world-space). A UV é recalculada no fragment shader a partir da
 *     world position, então escalar o cubo não estica — a textura se repete.
 *   - Sem `triplanar` mas com `textureUrl`: textura normal com `repeat` igual
 *     a `textureScale` (default 1). Escalar o objeto estica — é o trade-off.
 */
export function PrimitiveMesh({ kind, color, props, instanceScale, highlighted, edgeOutline }: PrimitiveMeshProps) {
    const tintColor = props?.color as string | undefined
    const renderColor = tintColor ?? color
    const castShadow = props?.castShadow !== false
    const receiveShadow = props?.receiveShadow !== false

    return (
        <mesh castShadow={castShadow} receiveShadow={receiveShadow}>
            <PrimitiveGeometry kind={kind} />
            <PrimitiveMaterial
                kind={kind}
                renderColor={renderColor}
                props={props}
                instanceScale={instanceScale}
                highlighted={highlighted}
            />
            {edgeOutline?.enabled && (
                <Edges
                    color={edgeOutline.color}
                    threshold={edgeOutline.threshold}
                    lineWidth={edgeOutline.lineWidth}
                    toneMapped={false}
                    renderOrder={10}
                />
            )}
        </mesh>
    )
}

export function PrimitiveOutlineMesh({ kind, color, width }: PrimitiveOutlineMeshProps) {
    const shellScale = 1 + Math.max(0, width)
    return (
        <mesh scale={[shellScale, shellScale, shellScale]} renderOrder={-1}>
            <PrimitiveGeometry kind={kind} />
            <meshBasicMaterial
                color={color}
                side={THREE.BackSide}
                toneMapped={false}
                depthWrite={false}
            />
        </mesh>
    )
}

function PrimitiveGeometry({ kind }: { kind: PrimitiveKind }) {
    if (kind === 'sphere') return <sphereGeometry args={[0.5, 24, 16]} />
    if (kind === 'cylinder') return <cylinderGeometry args={[0.5, 0.5, 1, 24]} />
    if (kind === 'plane') return <primitive object={getPlaneGeometry()} attach="geometry" />
    return <boxGeometry args={[1, 1, 1]} />
}

function planeRepeatFromScale(
    scale: [number, number, number] | undefined,
    tileMeters: number,
): [number, number] {
    const tile = Math.max(0.001, tileMeters)
    return [
        Math.max(0.001, Math.abs(scale?.[0] ?? 1) / tile),
        Math.max(0.001, Math.abs(scale?.[1] ?? 1) / tile),
    ]
}

function configureTexture(texture: THREE.Texture, repeat: number | [number, number]): THREE.Texture {
    const t = texture.clone()
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1])
    else t.repeat.set(repeat, repeat)
    t.needsUpdate = true
    return t
}

function PrimitiveMaterial({
    kind,
    renderColor,
    props,
    instanceScale,
    highlighted,
}: {
    kind: PrimitiveKind
    renderColor: string
    props?: InstanceProps
    instanceScale?: [number, number, number]
    highlighted?: boolean
}) {
    const textureUrl = props?.textureUrl
    const textureScale = props?.textureScale ?? 1
    const triplanar = Boolean(props?.triplanar)
    const reflector = Boolean(props?.reflector)
    const materialType = props?.material ?? (props?.unlit === true ? 'unlit' : 'standard')
    const opacity = clampOpacity(props?.opacity)
    const repeat = kind === 'plane' ? planeRepeatFromScale(instanceScale, textureScale) : textureScale
    const roughness = props?.roughness ?? 0.8
    const metalness = props?.metalness ?? 0.05
    const emissive = props?.emissive ?? (highlighted ? '#ffffff' : '#000000')
    const emissiveIntensity = props?.emissiveIntensity ?? (highlighted ? 0.25 : 0)

    if (materialType === 'unlit') {
        return (
            <BasicPrimitiveMaterial
                textureUrl={textureUrl}
                repeat={repeat}
                color={renderColor}
                opacity={opacity}
            />
        )
    }

    if (reflector) {
        return (
            <ReflectorMaterial
                textureUrl={textureUrl}
                textureScale={textureScale}
                triplanar={triplanar}
                planarRepeat={kind === 'plane' ? repeat as [number, number] : undefined}
                color={renderColor}
                mirror={props?.reflectorMirror ?? 0}
                roughness={props?.reflectorRoughness ?? 1}
                opacity={opacity}
            />
        )
    }

    if (materialType === 'toon') {
        return (
            <ToonPrimitiveMaterial
                textureUrl={textureUrl}
                repeat={repeat}
                color={renderColor}
                opacity={opacity}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
            />
        )
    }

    if (triplanar && textureUrl) {
        return (
            <TriplanarStandardMaterial
                textureUrl={textureUrl}
                tileMeters={textureScale}
                color={renderColor}
                opacity={opacity}
                roughness={roughness}
                metalness={metalness}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
            />
        )
    }

    if (textureUrl) {
        return (
            <TexturedStandardMaterial
                textureUrl={textureUrl}
                repeat={repeat}
                color={renderColor}
                opacity={opacity}
                roughness={roughness}
                metalness={metalness}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
            />
        )
    }

    return (
        <meshStandardMaterial
            color={renderColor}
            roughness={roughness}
            metalness={metalness}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            opacity={opacity}
            transparent={opacity < 0.999}
            depthWrite={opacity >= 0.999}
        />
    )
}

function BasicPrimitiveMaterial({
    textureUrl,
    repeat,
    color,
    opacity,
}: {
    textureUrl: string | undefined
    repeat: number | [number, number]
    color: string
    opacity: number
}) {
    const texture = useSafeTexture(textureUrl ?? '')
    const configured = useMemo(
        () => (texture ? configureTexture(texture, repeat) : null),
        [texture, repeat],
    )

    return (
        <meshBasicMaterial
            map={configured}
            color={color}
            side={THREE.DoubleSide}
            toneMapped={false}
            opacity={opacity}
            transparent={opacity < 0.999}
            depthWrite={opacity >= 0.999}
        />
    )
}

function ToonPrimitiveMaterial({
    textureUrl,
    repeat,
    color,
    opacity,
    emissive,
    emissiveIntensity,
}: {
    textureUrl: string | undefined
    repeat: number | [number, number]
    color: string
    opacity: number
    emissive: string
    emissiveIntensity: number
}) {
    const texture = useSafeTexture(textureUrl ?? '')
    const configured = useMemo(
        () => (texture ? configureTexture(texture, repeat) : null),
        [texture, repeat],
    )

    return (
        <meshToonMaterial
            map={configured}
            color={color}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            side={THREE.DoubleSide}
            opacity={opacity}
            transparent={opacity < 0.999}
            depthWrite={opacity >= 0.999}
        />
    )
}

function TexturedStandardMaterial({
    textureUrl,
    repeat,
    color,
    opacity,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
}: {
    textureUrl: string
    repeat: number | [number, number]
    color: string
    opacity: number
    roughness: number
    metalness: number
    emissive: string
    emissiveIntensity: number
}) {
    const texture = useSafeTexture(textureUrl)
    const configured = useMemo(() => {
        if (!texture) return null
        const t = texture.clone()
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        if (Array.isArray(repeat)) t.repeat.set(repeat[0], repeat[1])
        else t.repeat.set(repeat, repeat)
        t.needsUpdate = true
        return t
    }, [texture, repeat])

    if (!configured) {
        return (
            <meshStandardMaterial
                color={color}
                roughness={roughness}
                metalness={metalness}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                side={THREE.DoubleSide}
                opacity={opacity}
                transparent={opacity < 0.999}
                depthWrite={opacity >= 0.999}
            />
        )
    }

    return (
        <meshStandardMaterial
            map={configured}
            color={color}
            roughness={roughness}
            metalness={metalness}
            emissive={emissive}
            emissiveIntensity={emissiveIntensity}
            side={THREE.DoubleSide}
            opacity={opacity}
            transparent={opacity < 0.999}
            depthWrite={opacity >= 0.999}
        />
    )
}

/**
 * MeshStandardMaterial com triplanar mapping injetado via `onBeforeCompile`.
 *
 * No vertex shader expomos `vTriPos` e `vTriNormal` em world-space.
 * No fragment shader, dentro de `#include <map_fragment>`, fazemos 3 samples
 * (um por plano YZ / XZ / XY) e misturamos com blend weights derivados do
 * quadrado da normal mundial, pra evitar costuras.
 *
 * `tileMeters` é o tamanho do tile da textura no mundo — escalar o mesh não
 * aumenta/diminui a tile, só aumenta o número de repetições visíveis.
 */
function TriplanarStandardMaterial({
    textureUrl,
    tileMeters,
    color,
    opacity,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
}: {
    textureUrl: string
    tileMeters: number
    color: string
    opacity: number
    roughness: number
    metalness: number
    emissive: string
    emissiveIntensity: number
}) {
    const texture = useSafeTexture(textureUrl)

    const material = useMemo(() => {
        if (!texture) return null
        const mapTex = texture.clone()
        mapTex.wrapS = mapTex.wrapT = THREE.RepeatWrapping
        // Quando triplanar, mantemos repeat 1: as UVs são construídas no shader.
        mapTex.repeat.set(1, 1)
        mapTex.needsUpdate = true

        const mat = new THREE.MeshStandardMaterial({
            map: mapTex,
            color: new THREE.Color(color),
            roughness,
            metalness,
            emissive: new THREE.Color(emissive),
            emissiveIntensity,
            side: THREE.DoubleSide,
            opacity,
            transparent: opacity < 0.999,
            depthWrite: opacity >= 0.999,
        })

        const uniforms = { uTile: { value: Math.max(0.001, tileMeters) } }

        mat.onBeforeCompile = (shader) => {
            shader.uniforms.uTile = uniforms.uTile

            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    varying vec3 vTriPos;
                    varying vec3 vTriNormal;`,
                )
                .replace(
                    '#include <worldpos_vertex>',
                    `#include <worldpos_vertex>
                    vTriPos = worldPosition.xyz;
                    vTriNormal = normalize(mat3(modelMatrix) * normal);`,
                )

            shader.fragmentShader = shader.fragmentShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    uniform float uTile;
                    varying vec3 vTriPos;
                    varying vec3 vTriNormal;`,
                )
                .replace(
                    '#include <map_fragment>',
                    `#ifdef USE_MAP
                        vec3 triBlend = abs(vTriNormal);
                        triBlend = pow(triBlend, vec3(4.0));
                        triBlend /= max(triBlend.x + triBlend.y + triBlend.z, 1e-5);
                        vec2 uvX = vTriPos.zy / uTile;
                        vec2 uvY = vTriPos.xz / uTile;
                        vec2 uvZ = vTriPos.xy / uTile;
                        vec4 cx = texture2D(map, uvX);
                        vec4 cy = texture2D(map, uvY);
                        vec4 cz = texture2D(map, uvZ);
                        vec4 sampledDiffuseColor = cx * triBlend.x + cy * triBlend.y + cz * triBlend.z;
                        diffuseColor *= sampledDiffuseColor;
                    #endif`,
                )
        }

        return mat
    }, [texture, tileMeters, color, roughness, metalness, emissive, emissiveIntensity, opacity])

    if (!material) {
        return (
            <meshStandardMaterial
                color={color}
                roughness={roughness}
                metalness={metalness}
                emissive={emissive}
                emissiveIntensity={emissiveIntensity}
                side={THREE.DoubleSide}
                opacity={opacity}
                transparent={opacity < 0.999}
                depthWrite={opacity >= 0.999}
            />
        )
    }

    // Atualiza o uniform quando tileMeters muda (sem recompilar shader se
    // estrutura for a mesma — mas useMemo já recria por tileMeters, então
    // este efeito é redundante; deixo como defensivo).
    return <primitive object={material} attach="material" />
}

function ReflectorMaterial({
    textureUrl,
    textureScale,
    triplanar,
    planarRepeat,
    color,
    mirror,
    roughness,
    opacity,
}: {
    textureUrl: string | undefined
    textureScale: number
    triplanar: boolean
    planarRepeat?: [number, number]
    color: string
    mirror: number
    roughness: number
    opacity: number
}) {
    if (!textureUrl) {
        return (
            <MeshReflectorMaterial
                color={color}
                mirror={mirror}
                roughness={roughness}
                depthScale={0}
                minDepthThreshold={0.9}
                maxDepthThreshold={1}
                metalness={0}
                opacity={opacity}
                transparent={opacity < 0.999}
                depthWrite={opacity >= 0.999}
            />
        )
    }
    return <ReflectorWithTexture
        url={textureUrl}
        textureScale={textureScale}
        triplanar={triplanar}
        planarRepeat={planarRepeat}
        color={color}
        mirror={mirror}
        roughness={roughness}
        opacity={opacity}
    />
}

function ReflectorWithTexture({
    url,
    textureScale,
    planarRepeat,
    color,
    mirror,
    roughness,
    opacity,
}: {
    url: string
    textureScale: number
    triplanar: boolean
    planarRepeat?: [number, number]
    color: string
    mirror: number
    roughness: number
    opacity: number
}) {
    const texture = useSafeTexture(url)
    const configured = useMemo(() => {
        if (!texture) return null
        const t = texture.clone()
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        if (planarRepeat) t.repeat.set(planarRepeat[0], planarRepeat[1])
        else t.repeat.set(textureScale, textureScale)
        t.needsUpdate = true
        return t
    }, [texture, textureScale, planarRepeat])

    return (
        <MeshReflectorMaterial
            key={`${url}:${textureScale}:${planarRepeat?.join('x') ?? 'none'}`}
            map={configured}
            color={color}
            mirror={mirror}
            roughness={roughness}
            depthScale={0}
            minDepthThreshold={0.9}
            maxDepthThreshold={1}
            metalness={0}
            opacity={opacity}
            transparent={opacity < 0.999}
            depthWrite={opacity >= 0.999}
        />
    )
}
