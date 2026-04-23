export type Vec3 = [number, number, number]

export type Category = 'static-bulk' | 'static-prop' | 'dynamic' | 'breakable'

export interface InstanceProps {
    /** kg; usado em dynamic/breakable. Default vem do meta do asset ou da categoria. */
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
    /** Permite extensão futura sem quebrar o schema. */
    [key: string]: unknown
}

export interface Instance {
    id: string
    /**
     * Identificador do asset. Nesta fase inicial aceita:
     *   - `primitives/cube` | `primitives/sphere` | `primitives/cylinder` (placeholders coloridos)
     *   - Futuramente: caminho relativo dentro de `public/assets/`, sem `.glb`.
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
