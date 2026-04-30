import { Environment } from '@react-three/drei'
import type { EnvironmentPreset, LevelEdgeOutline, LevelEnvironment, LevelLighting } from './types'

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
    'apartment',
    'city',
    'dawn',
    'forest',
    'lobby',
    'night',
    'park',
    'studio',
    'sunset',
    'warehouse',
]

export const ENVIRONMENT_PRESET_OPTIONS = {
    Apartment: 'apartment',
    City: 'city',
    Dawn: 'dawn',
    Forest: 'forest',
    Lobby: 'lobby',
    Night: 'night',
    Park: 'park',
    Studio: 'studio',
    Sunset: 'sunset',
    Warehouse: 'warehouse',
} as const

export const DEFAULT_LEVEL_ENVIRONMENT: Required<Pick<
    LevelEnvironment,
    'mode' | 'preset' | 'file' | 'background' | 'backgroundColor' | 'ibl' | 'blur' | 'intensity' | 'resolution'
>> = {
    mode: 'preset',
    preset: 'sunset',
    file: '',
    background: true,
    backgroundColor: '#1a1d22',
    ibl: true,
    blur: 0.8,
    intensity: 1,
    resolution: 256,
}

export function normalizeLevelEnvironment(environment?: LevelEnvironment): typeof DEFAULT_LEVEL_ENVIRONMENT {
    const mode = environment?.mode ?? DEFAULT_LEVEL_ENVIRONMENT.mode
    const preset = environment?.preset ?? DEFAULT_LEVEL_ENVIRONMENT.preset
    const file = environment?.file ?? DEFAULT_LEVEL_ENVIRONMENT.file
    return {
        mode,
        preset: ENVIRONMENT_PRESETS.includes(preset) ? preset : DEFAULT_LEVEL_ENVIRONMENT.preset,
        file,
        background: environment?.background ?? DEFAULT_LEVEL_ENVIRONMENT.background,
        backgroundColor: environment?.backgroundColor ?? DEFAULT_LEVEL_ENVIRONMENT.backgroundColor,
        ibl: environment?.ibl ?? DEFAULT_LEVEL_ENVIRONMENT.ibl,
        blur: environment?.blur ?? DEFAULT_LEVEL_ENVIRONMENT.blur,
        intensity: environment?.intensity ?? DEFAULT_LEVEL_ENVIRONMENT.intensity,
        resolution: environment?.resolution ?? DEFAULT_LEVEL_ENVIRONMENT.resolution,
    }
}

export const DEFAULT_LEVEL_LIGHTING: Required<LevelLighting> = {
    ambientIntensity: 1.3,
    directionalIntensity: 1,
    directionalHeight: 20,
    directionalDistance: 10,
    shadows: true,
}

export function normalizeLevelLighting(lighting?: LevelLighting): typeof DEFAULT_LEVEL_LIGHTING {
    return {
        ambientIntensity: lighting?.ambientIntensity ?? DEFAULT_LEVEL_LIGHTING.ambientIntensity,
        directionalIntensity: lighting?.directionalIntensity ?? DEFAULT_LEVEL_LIGHTING.directionalIntensity,
        directionalHeight: lighting?.directionalHeight ?? DEFAULT_LEVEL_LIGHTING.directionalHeight,
        directionalDistance: lighting?.directionalDistance ?? DEFAULT_LEVEL_LIGHTING.directionalDistance,
        shadows: lighting?.shadows ?? DEFAULT_LEVEL_LIGHTING.shadows,
    }
}

export const DEFAULT_LEVEL_EDGE_OUTLINE: Required<LevelEdgeOutline> = {
    enabled: true,
    color: '#111111',
    threshold: 20,
    lineWidth: 1,
}

export function normalizeLevelEdgeOutline(edgeOutline?: LevelEdgeOutline): typeof DEFAULT_LEVEL_EDGE_OUTLINE {
    return {
        enabled: edgeOutline?.enabled ?? DEFAULT_LEVEL_EDGE_OUTLINE.enabled,
        color: edgeOutline?.color ?? DEFAULT_LEVEL_EDGE_OUTLINE.color,
        threshold: edgeOutline?.threshold ?? DEFAULT_LEVEL_EDGE_OUTLINE.threshold,
        lineWidth: edgeOutline?.lineWidth ?? DEFAULT_LEVEL_EDGE_OUTLINE.lineWidth,
    }
}

export function LevelEnvironmentRenderer({ environment }: { environment?: LevelEnvironment }) {
    const env = normalizeLevelEnvironment(environment)
    const hasEnvironment = env.mode === 'preset' || (env.mode === 'file' && env.file.trim().length > 0)
    const shouldRenderEnvironment = hasEnvironment && (env.background || env.ibl)

    return (
        <>
            {(!env.background || !shouldRenderEnvironment) && (
                <color attach="background" args={[env.backgroundColor]} />
            )}
            {shouldRenderEnvironment && env.mode === 'preset' && (
                <Environment
                    key={`preset:${env.preset}:${env.background}:${env.ibl}:${env.blur}:${env.intensity}:${env.resolution}`}
                    preset={env.preset}
                    background={env.background}
                    blur={env.blur}
                    resolution={env.resolution}
                    environmentIntensity={env.ibl ? env.intensity : 0}
                    backgroundIntensity={env.intensity}
                />
            )}
            {shouldRenderEnvironment && env.mode === 'file' && (
                <Environment
                    key={`file:${env.file}:${env.background}:${env.ibl}:${env.blur}:${env.intensity}:${env.resolution}`}
                    files={env.file}
                    background={env.background}
                    blur={env.blur}
                    resolution={env.resolution}
                    environmentIntensity={env.ibl ? env.intensity : 0}
                    backgroundIntensity={env.intensity}
                />
            )}
        </>
    )
}
