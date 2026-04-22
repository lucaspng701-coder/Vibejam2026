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
}

export function bodyTypeFor(category: Category): BodyType {
    return CATEGORY_DEFAULTS[category].bodyType
}
