import { MeshReflectorMaterial, useTexture } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { InstanceProps } from './types'

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

interface PrimitiveMeshProps {
    kind: PrimitiveKind
    color: string
    props?: InstanceProps
    /** Para highlight de seleção no editor. Ignorado em runtime do jogo. */
    highlighted?: boolean
}

/**
 * Renderiza uma primitiva (cube/sphere/cylinder) com material derivado de
 * `InstanceProps`:
 *
 *   textureUrl + triplanar + textureScale + reflector + color
 *
 * Regras simples desta versão:
 *   - `reflector = true` substitui o material por `MeshReflectorMaterial`
 *     (pros chões reflexivos). Se também vier com `triplanar = true`, hoje
 *     apenas logamos um aviso e o reflector vence — misturar os dois exige
 *     injetar o triplanar via `onBeforeCompile` na versão interna do reflector
 *     e deixo pra uma PR futura.
 *   - `triplanar = true` requer `textureUrl` e usa `textureScale` como TILE em
 *     metros (world-space). A UV é recalculada no fragment shader a partir da
 *     world position, então escalar o cubo não estica — a textura se repete.
 *   - Sem `triplanar` mas com `textureUrl`: textura normal com `repeat` igual
 *     a `textureScale` (default 1). Escalar o objeto estica — é o trade-off.
 */
export function PrimitiveMesh({ kind, color, props, highlighted }: PrimitiveMeshProps) {
    const tintColor = props?.color as string | undefined
    const renderColor = tintColor ?? color

    return (
        <mesh castShadow receiveShadow>
            <PrimitiveGeometry kind={kind} />
            <PrimitiveMaterial
                renderColor={renderColor}
                props={props}
                highlighted={highlighted}
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

function PrimitiveMaterial({
    renderColor,
    props,
    highlighted,
}: {
    renderColor: string
    props?: InstanceProps
    highlighted?: boolean
}) {
    const textureUrl = props?.textureUrl
    const textureScale = props?.textureScale ?? 1
    const triplanar = Boolean(props?.triplanar)
    const reflector = Boolean(props?.reflector)

    if (reflector) {
        if (triplanar) {
            console.warn(
                '[primitive-mesh] reflector + triplanar ainda não é suportado; usando reflector com UV normal.',
            )
        }
        return (
            <ReflectorMaterial
                textureUrl={textureUrl}
                textureScale={textureScale}
                color={renderColor}
                mirror={props?.reflectorMirror ?? 0}
                roughness={props?.reflectorRoughness ?? 1}
            />
        )
    }

    if (triplanar && textureUrl) {
        return (
            <TriplanarStandardMaterial
                textureUrl={textureUrl}
                tileMeters={textureScale}
                color={renderColor}
                highlighted={highlighted}
            />
        )
    }

    if (textureUrl) {
        return (
            <TexturedStandardMaterial
                textureUrl={textureUrl}
                repeat={textureScale}
                color={renderColor}
                highlighted={highlighted}
            />
        )
    }

    return (
        <meshStandardMaterial
            color={renderColor}
            roughness={0.8}
            metalness={0.05}
            emissive={highlighted ? '#ffffff' : '#000000'}
            emissiveIntensity={highlighted ? 0.25 : 0}
        />
    )
}

function TexturedStandardMaterial({
    textureUrl,
    repeat,
    color,
    highlighted,
}: {
    textureUrl: string
    repeat: number
    color: string
    highlighted?: boolean
}) {
    const texture = useTexture(textureUrl)
    const configured = useMemo(() => {
        const t = texture.clone()
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(repeat, repeat)
        t.needsUpdate = true
        return t
    }, [texture, repeat])

    return (
        <meshStandardMaterial
            map={configured}
            color={color}
            roughness={0.8}
            metalness={0.05}
            emissive={highlighted ? '#ffffff' : '#000000'}
            emissiveIntensity={highlighted ? 0.25 : 0}
            side={THREE.DoubleSide}
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
    highlighted,
}: {
    textureUrl: string
    tileMeters: number
    color: string
    highlighted?: boolean
}) {
    const texture = useTexture(textureUrl)

    const material = useMemo(() => {
        const mapTex = texture.clone()
        mapTex.wrapS = mapTex.wrapT = THREE.RepeatWrapping
        // Quando triplanar, mantemos repeat 1: as UVs são construídas no shader.
        mapTex.repeat.set(1, 1)
        mapTex.needsUpdate = true

        const mat = new THREE.MeshStandardMaterial({
            map: mapTex,
            color: new THREE.Color(color),
            roughness: 0.8,
            metalness: 0.05,
            emissive: new THREE.Color(highlighted ? 0xffffff : 0x000000),
            emissiveIntensity: highlighted ? 0.25 : 0,
            side: THREE.DoubleSide,
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
    }, [texture, tileMeters, color, highlighted])

    // Atualiza o uniform quando tileMeters muda (sem recompilar shader se
    // estrutura for a mesma — mas useMemo já recria por tileMeters, então
    // este efeito é redundante; deixo como defensivo).
    useMemo(() => {
        const shaderUniforms = (material as unknown as { userData: { shader?: { uniforms: Record<string, { value: number }> } } })
            .userData.shader
        if (shaderUniforms?.uniforms?.uTile) {
            shaderUniforms.uniforms.uTile.value = tileMeters
        }
    }, [material, tileMeters])

    return <primitive object={material} attach="material" />
}

function ReflectorMaterial({
    textureUrl,
    textureScale,
    color,
    mirror,
    roughness,
}: {
    textureUrl: string | undefined
    textureScale: number
    color: string
    mirror: number
    roughness: number
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
            />
        )
    }
    return <ReflectorWithTexture
        url={textureUrl}
        textureScale={textureScale}
        color={color}
        mirror={mirror}
        roughness={roughness}
    />
}

function ReflectorWithTexture({
    url,
    textureScale,
    color,
    mirror,
    roughness,
}: {
    url: string
    textureScale: number
    color: string
    mirror: number
    roughness: number
}) {
    const texture = useTexture(url)
    const configured = useMemo(() => {
        const t = texture.clone()
        t.wrapS = t.wrapT = THREE.RepeatWrapping
        t.repeat.set(textureScale, textureScale)
        t.needsUpdate = true
        return t
    }, [texture, textureScale])

    return (
        <MeshReflectorMaterial
            map={configured}
            color={color}
            mirror={mirror}
            roughness={roughness}
            depthScale={0}
            minDepthThreshold={0.9}
            maxDepthThreshold={1}
            metalness={0}
        />
    )
}
