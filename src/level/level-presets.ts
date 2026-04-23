/** Presets do dropdown Leva → arquivo em `public/levels/<nome>.json`. */
export const LEVEL_PRESETS = ['none', 'sample', 'level1', 'level2', 'level3'] as const
export type LevelPreset = (typeof LEVEL_PRESETS)[number]

export function levelJsonPath(preset: string): string | null {
    if (preset === 'none') return null
    return `/levels/${preset}.json`
}
