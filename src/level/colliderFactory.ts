import type { Category } from './types'

export type BodyType = 'fixed' | 'dynamic'

export interface CategoryDefaults {
    bodyType: BodyType
    /** Cor usada nos placeholders desta fase. */
    debugColor: string
    /** Massa default (kg) quando não vem do asset/props. */
    defaultMass: number
    /** Se true, o editor deve bloquear escala não-uniforme (evita problemas com colliders rotacionados). */
    uniformScaleOnly: boolean
}

export const CATEGORY_DEFAULTS: Record<Category, CategoryDefaults> = {
    'static-bulk': {
        bodyType: 'fixed',
        debugColor: '#7a7a7a',
        defaultMass: 0,
        uniformScaleOnly: false,
    },
    'static-prop': {
        bodyType: 'fixed',
        debugColor: '#8a6a4a',
        defaultMass: 0,
        uniformScaleOnly: false,
    },
    dynamic: {
        bodyType: 'dynamic',
        debugColor: '#3a7ac8',
        defaultMass: 10,
        uniformScaleOnly: true,
    },
    breakable: {
        bodyType: 'dynamic',
        debugColor: '#d98036',
        defaultMass: 15,
        uniformScaleOnly: true,
    },
    'no-collision': {
        // Sem rigid body no jogo; valores só para editor / consistência de tipo.
        bodyType: 'fixed',
        debugColor: '#9b7bb8',
        defaultMass: 0,
        uniformScaleOnly: false,
    },
    light: {
        // Luzes não têm rigid body; bodyType é s\u00f3 pra satisfazer o tipo.
        bodyType: 'fixed',
        debugColor: '#f2d25a',
        defaultMass: 0,
        uniformScaleOnly: false,
    },
    player: {
        // Player não vira RigidBody a partir do loader; o jogo spawna o
        // `<Player />` na posição da instância. Valores só pro editor/tipo.
        bodyType: 'fixed',
        debugColor: '#33cc66',
        defaultMass: 0,
        uniformScaleOnly: true,
    },
    enemy: {
        // Runtime: `<Enemy />` com collider próprio; não usa estes defaults
        // de massa no LevelLoader, só cor/escala uniforme no editor.
        bodyType: 'fixed',
        debugColor: '#b02222',
        defaultMass: 0,
        uniformScaleOnly: true,
    },
}

export function bodyTypeFor(category: Category): BodyType {
    return CATEGORY_DEFAULTS[category].bodyType
}
