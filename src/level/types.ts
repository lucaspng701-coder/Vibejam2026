export type Vec3 = [number, number, number]

export interface ColliderBox {
    /** Tamanho do cuboid em metros, no espaco local do objeto/asset. */
    size: Vec3
    /** Offset local do centro do cuboid. */
    offset?: Vec3
}

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
    | 'enemy-trigger'
    | 'decal'

export type LightKind = 'point' | 'spot' | 'directional'

export type EnvironmentPreset =
    | 'apartment'
    | 'city'
    | 'dawn'
    | 'forest'
    | 'lobby'
    | 'night'
    | 'park'
    | 'studio'
    | 'sunset'
    | 'warehouse'

export interface LevelEnvironment {
    /** none = no HDR/environment map; preset = drei preset; file = public URL/path. */
    mode?: 'none' | 'preset' | 'file'
    preset?: EnvironmentPreset
    /** Public file URL, e.g. /hdrs/studio.hdr or /env/office.exr. */
    file?: string
    /** Use the HDR as visible background. If false, backgroundColor is used. */
    background?: boolean
    backgroundColor?: string
    /** Use the HDR as image-based lighting for PBR materials. */
    ibl?: boolean
    blur?: number
    intensity?: number
    resolution?: number
}

export interface LevelLighting {
    ambientIntensity?: number
    directionalIntensity?: number
    directionalHeight?: number
    directionalDistance?: number
    shadows?: boolean
}

export interface LevelEdgeOutline {
    enabled?: boolean
    color?: string
    threshold?: number
    lineWidth?: number
}

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
    /** Resolucao do shadow map desta luz. Valores comuns: 512, 1024, 2048, 4096. */
    shadowMapSize?: number
    /** Ajuste fino contra acne/peter-panning de sombra. */
    shadowBias?: number
    shadowNormalBias?: number
    /** Blur do shadow map quando suportado pelo tipo de sombra. */
    shadowRadius?: number

    // ---- Material / surface (static-bulk, static-prop, no-collision) ----
    /**
     * URL pública de uma textura (ex: '/final-texture.png'). Se ausente, o
     * material fica sólido (cor via `color` ou fallback da categoria).
     */
    textureUrl?: string
    /** Material nativo do Three para primitivas: standard, unlit/basic ou toon. */
    material?: 'standard' | 'unlit' | 'toon'
    roughness?: number
    metalness?: number
    emissive?: string
    emissiveIntensity?: number
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
    /** Opacidade visual do objeto, 0..1. */
    opacity?: number
    /** Editor-only: oculta na viewport do editor, mas continua no level/outliner/runtime. */
    editorHidden?: boolean
    /** Se este objeto projeta sombra. Default true para props/renderables. */
    receiveShadow?: boolean

    /** Colliders manuais por instancia. Se ausente, pode cair no meta do asset. */
    colliderBoxes?: ColliderBox[]
    /**
     * Collider cuboid manual legado em metros, no espaco local do objeto.
     * Se ausente, o Rapier continua inferindo o collider automaticamente.
     */
    colliderSize?: Vec3
    /** Offset local do collider manual, em metros. */
    colliderOffset?: Vec3

    /** Pontos de vida (apenas category `enemy`). Default 100. */
    maxHp?: number
    /** Enemy sight range in meters. Default 12. */
    visionRange?: number
    /** Enemy sight cone angle in degrees. Default 70. */
    visionAngleDeg?: number
    /** Enemy chase speed in meters/second. Default 2.2. */
    moveSpeed?: number
    /** Shows the runtime enemy vision cone. Default true. */
    showVisionCone?: boolean
    /** Trigger de inimigos dispara uma vez e fica travado. Default true. */
    triggerOnce?: boolean
    /** Mostra o cubo do trigger tambem no runtime. Default false. */
    showTriggerVolume?: boolean

    // ---- Decal / sprite plane ----
    /** Coordenadas normalizadas do atlas/spritesheet, origem no topo-esquerdo. */
    uvX?: number
    uvY?: number
    uvW?: number
    uvH?: number
    /** Grid opcional para animacao por spritesheet. */
    sheetColumns?: number
    sheetRows?: number
    frameStart?: number
    frameCount?: number
    frameFps?: number
    frameLoop?: boolean

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
    environment?: LevelEnvironment
    lighting?: LevelLighting
    edgeOutline?: LevelEdgeOutline
    instances: Instance[]
    /** Editor-only grouping. Runtime may ignore this safely. */
    groups?: Array<{
        id: string
        name: string
        children: string[]
    }>
}
