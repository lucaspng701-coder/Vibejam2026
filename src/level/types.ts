export type Vec3 = [number, number, number]

export type Category =
    | 'static-bulk'
    | 'static-prop'
    | 'dynamic'
    | 'breakable'
    /** Só renderiza malha; sem corpo Rapier (decoração, decals, etc.). */
    | 'no-collision'
    | 'light'

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
