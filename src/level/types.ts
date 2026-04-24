export type Vec3 = [number, number, number]

export type Category =
    | 'static-bulk'
    | 'static-prop'
    | 'dynamic'
    | 'breakable'
    /** Só renderiza malha; sem corpo Rapier (decoração, decals, etc.). */
    | 'no-collision'
    | 'light'
    /**
     * Spawn do jogador. Singleton por level: o LevelLoader descarta duplicatas
     * e o jogo usa a `position` desta instância pra posicionar o `<Player />`.
     * No editor aparece como uma cápsula verde + GLB da arma só pra referência
     * visual (não é renderizado no runtime do jogo).
     */
    | 'player'
    /**
     * Inimigo (cápsula vermelha no jogo). Instâncias múltiplas. Dano só de
     * projéteis do SphereTool, identificados por handle — sem alterar a física
     * das bolas.
     */
    | 'enemy'

export type LightKind = 'point' | 'spot' | 'directional'

export interface InstanceProps {
    /** kg; usado em dynamic/breakable. Ignorado em no-collision/light/static. */
    mass?: number
    /**
     * Velocidade mínima (m/s) do corpo que colide com o breakable para que ele frature.
     * 0 = indestrutível. Só considera corpos dinâmicos (estáticos têm velocidade 0).
     */
    fractureThreshold?: number
    /** assetId da variante fraturada (apenas breakable). */
    fracturedAssetId?: string
    /** Massa de cada pedaço após fratura (apenas breakable). */
    debrisMass?: number
    /** Tempo de vida dos pedaços após fratura (ms). */
    debrisLifetimeMs?: number

    // ---- Light-only props (category === 'light') ----
    /** Tipo de luz (derivável também do assetId `lights/<kind>`). */
    lightKind?: LightKind
    /** Cor hex (#rrggbb). */
    color?: string
    /** Intensidade. */
    intensity?: number
    /** Alcance em metros (0 = infinito, para point/spot). */
    distance?: number
    /** Decay (point/spot). Default 2 = físico. */
    decay?: number
    /** Ângulo em radianos (spot). */
    angle?: number
    /** Penumbra 0..1 (spot). */
    penumbra?: number
    /** Se a luz projeta sombras. */
    castShadow?: boolean

    // ---- Material / surface (static-bulk, static-prop, no-collision) ----
    /**
     * URL pública de uma textura (ex: '/final-texture.png'). Se ausente, o
     * material fica sólido (cor via `color` ou fallback da categoria).
     */
    textureUrl?: string
    /**
     * Quando `triplanar` é true, é o tamanho do tile em metros (world-space).
     * Quando é false, age como `repeat` em UVs nativas do mesh (ambos eixos).
     */
    textureScale?: number
    /**
     * Projeção triplanar / box: UVs calculadas em world-space no shader, pra
     * que escalar um cubo não estique a textura — a tile é fixa em metros.
     * Implementado via `onBeforeCompile` no MeshStandardMaterial.
     */
    triplanar?: boolean
    /**
     * Substitui o material por `MeshReflectorMaterial` (drei). Usa-se em chão
     * pra ter reflexo ambient. Combina com `textureUrl`/`triplanar`.
     */
    reflector?: boolean
    /** Força do espelhamento (0 = sem reflexo, 1 = espelho puro). Default 0. */
    reflectorMirror?: number
    /** Rugosidade do reflector (0 = nítido, 1 = borrado). Default 1. */
    reflectorRoughness?: number

    /** Pontos de vida (apenas category `enemy`). Default 100. */
    maxHp?: number

    /** Permite extensão futura sem quebrar o schema. */
    [key: string]: unknown
}

export interface Instance {
    id: string
    /**
     * Identificador do asset. Aceita:
     *   - `primitives/cube` | `primitives/sphere` | `primitives/cylinder`
     *   - `lights/point` | `lights/spot` | `lights/directional`
     *   - Caminho relativo em `public/assets/`, sem `.glb`.
     */
    assetId: string
    category: Category
    position: Vec3
    /** Euler XYZ em radianos. */
    rotation: Vec3
    scale: Vec3
    props?: InstanceProps
}

export interface LevelFile {
    version: 1
    name: string
    instances: Instance[]
}
