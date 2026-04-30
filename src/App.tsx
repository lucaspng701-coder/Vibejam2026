import { Canvas } from './common/components/canvas'
import { FpsMonitorCollector, FpsMonitorDisplay } from './common/components/fps-monitor'
import { Crosshair } from './common/components/crosshair'
import { useLoadingAssets } from './common/hooks/use-loading-assets'
import { PerspectiveCamera } from '@react-three/drei'
import { EffectComposer, Vignette, ChromaticAberration, BrightnessContrast, ToneMapping } from '@react-three/postprocessing'
import {
    BlendFunction,
} from 'postprocessing'
import { useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { Leva, useControls, folder } from 'leva'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Player, PlayerControls } from './game/player'
import { Ball } from './game/ball'
import { SphereTool } from './game/sphere-tool'
import { LevelLoader, subscribeDebrisCount } from './level/LevelLoader'
import { LEVEL_PRESETS, levelJsonPath, type LevelPreset } from './level/level-presets'
import {
    DEFAULT_LEVEL_ENVIRONMENT,
    DEFAULT_LEVEL_EDGE_OUTLINE,
    DEFAULT_LEVEL_LIGHTING,
    LevelEnvironmentRenderer,
    normalizeLevelEdgeOutline,
    normalizeLevelEnvironment,
    normalizeLevelLighting,
} from './level/environment'
import type { LevelEdgeOutline, LevelEnvironment, LevelFile, LevelLighting, Vec3 } from './level/types'

/**
 * Toggles `gl.shadowMap.enabled` at the WebGL level so every light's shadow
 * pass is skipped (rather than juggling `castShadow` on individual lights and
 * meshes). We also force a one-shot rebuild + material refresh so materials
 * that had shader programs baked with shadow sampling stop reading the depth
 * texture immediately.
 */
function ShadowToggle({ enabled }: { enabled: boolean }) {
    const gl = useThree((s) => s.gl)
    const scene = useThree((s) => s.scene)
    useEffect(() => {
        gl.shadowMap.enabled = enabled
        gl.shadowMap.needsUpdate = true
        scene.traverse((obj) => {
            const mesh = obj as THREE.Mesh
            if (!mesh.isMesh || !mesh.material) return
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const m of mats) m.needsUpdate = true
        })
    }, [enabled, gl, scene])
    return null
}

function ScenePerfLogger({ enabled }: { enabled: boolean }) {
    const { gl, scene } = useThree()
    const frameCountRef = useRef(0)
    const lastReportRef = useRef(performance.now())

    useFrame(() => {
        if (!enabled || !import.meta.env.DEV) return
        frameCountRef.current += 1
        const now = performance.now()
        const elapsed = now - lastReportRef.current
        if (elapsed < 2000) return

        let meshes = 0
        let lineSegments = 0
        let edgeLines = 0
        let edgeSegments = 0
        scene.traverse((obj) => {
            const maybeMesh = obj as THREE.Mesh
            if (maybeMesh.isMesh) meshes += 1
            const maybeLine = obj as THREE.LineSegments
            if (maybeLine.isLineSegments) {
                lineSegments += 1
                if (maybeLine.userData.dreiEdges) {
                    edgeLines += 1
                    const position = maybeLine.geometry.getAttribute('position')
                    edgeSegments += position ? Math.floor(position.count / 2) : 0
                }
            }
        })

        const fps = Math.round((frameCountRef.current * 1000) / elapsed)
        const payload = {
            fps,
            meshes,
            lineSegments,
            edgeLines,
            edgeSegments,
            calls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            lines: gl.info.render.lines,
            points: gl.info.render.points,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
        }
        frameCountRef.current = 0
        lastReportRef.current = now

        fetch('/__debug/perf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        }).catch(() => {})
    })

    return null
}

export function App() {
    const loading = useLoadingAssets()
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)
    const [levelEnvironment, setLevelEnvironment] = useState<LevelEnvironment>(DEFAULT_LEVEL_ENVIRONMENT)
    const [levelLighting, setLevelLighting] = useState<LevelLighting>(DEFAULT_LEVEL_LIGHTING)
    const [levelEdgeOutline, setLevelEdgeOutline] = useState<LevelEdgeOutline>(DEFAULT_LEVEL_EDGE_OUTLINE)

    const { 
        walkSpeed,
        runSpeed,
        jumpForce
    } = useControls('Character', {
        walkSpeed: { value: 0.2, min: 0.05, max: 0.45, step: 0.01 },
        runSpeed: { value: 0.3, min: 0.1, max: 0.6, step: 0.01 },
        jumpForce: { value: 0.6, min: 0.3, max: 1.2, step: 0.05 }
    }, {
        collapsed: true,
        hidden: true
    })

    const { 
        fogEnabled,
        fogColor,
        fogNear,
        fogFar,
        enablePostProcessing,
        vignetteEnabled,
        vignetteOffset,
        vignetteDarkness,
        chromaticAberrationEnabled,
        chromaticAberrationOffset,
        brightnessContrastEnabled,
        brightness,
        contrast,
        colorGradingEnabled,
        toneMapping,
        toneMappingExposure,
    } = useControls({
        fog: folder({
            fogEnabled: true,
            fogColor: '#dbdbdb',
            fogNear: { value: 13, min: 0, max: 50, step: 1 },
            fogFar: { value: 95, min: 0, max: 100, step: 1 }
        }, { collapsed: true, hidden: true }),
        postProcessing: folder({
            enablePostProcessing: false,
            vignetteEnabled: true,
            vignetteOffset: { value: 0.8, min: 0, max: 1, step: 0.1 },
            vignetteDarkness: { value: 0.4, min: 0, max: 1, step: 0.1 },
            chromaticAberrationEnabled: true,
            chromaticAberrationOffset: { value: 0, min: 0, max: 0.01, step: 0.0001 },
            brightnessContrastEnabled: true,
            brightness: { value: 0, min: -1, max: 1, step: 0.1 },
            contrast: { value: 0.2, min: -1, max: 1, step: 0.1 },
            colorGradingEnabled: true,
            toneMapping: { 
                value: THREE.ACESFilmicToneMapping,
                options: {
                    'ACESFilmic': THREE.ACESFilmicToneMapping,
                    'Reinhard': THREE.ReinhardToneMapping,
                    'Cineon': THREE.CineonToneMapping,
                    'Linear': THREE.LinearToneMapping
                }
            },
            toneMappingExposure: { value: 1.2, min: 0, max: 2, step: 0.1 },
        }, { collapsed: true, hidden: true })
    }, {
        collapsed: true,
        hidden: true
    })

    const {
        levelPreset,
        showColliders,
        useBreakableThresholdOverride,
        breakableThresholdOverride,
    } = useControls(
        'Level',
        {
            levelPreset: {
                value: 'level1' as LevelPreset,
                options: [...LEVEL_PRESETS],
                label: 'level JSON',
            },
            showColliders: { value: false, label: 'debug colliders' },
            useBreakableThresholdOverride: {
                value: false,
                label: 'override break speed',
            },
            breakableThresholdOverride: {
                value: 16.5,
                min: 0,
                max: 80,
                step: 0.5,
                label: 'break speed m/s (0=never)',
            },
        },
        { collapsed: true },
    )
    const { perfTelemetryEnabled } = useControls(
        'Performance Log',
        {
            perfTelemetryEnabled: { value: true, label: 'log to file' },
        },
        { collapsed: true, order: 992 },
    )

    // Spawn do player: extraído do level JSON no load. Enquanto o level não
    // chegou (primeiro frame / troca de preset), mantemos `null` e não
    // renderizamos o <Player /> — assim evitamos o player cair no vazio se o
    // level não tiver chão ainda.
    const [playerSpawn, setPlayerSpawn] = useState<Vec3 | null>(null)
    const [playerSpawnRotation, setPlayerSpawnRotation] = useState<Vec3>([0, 0, 0])
    const [playerSpawnKey, setPlayerSpawnKey] = useState(0)
    const [debrisCount, setDebrisCount] = useState(0)
    const playerPositionRef = useRef(new THREE.Vector3())
    const handleLevelLoaded = useCallback((level: LevelFile) => {
        const env = normalizeLevelEnvironment(level.environment)
        const lighting = normalizeLevelLighting(level.lighting)
        const edgeOutline = normalizeLevelEdgeOutline(level.edgeOutline)
        setLevelEnvironment(env)
        setLevelLighting(lighting)
        setLevelEdgeOutline(edgeOutline)
        const player = level.instances.find((i) => i.category === 'player')
        if (player) {
            setPlayerSpawn(player.position)
            setPlayerSpawnRotation(player.rotation)
            playerPositionRef.current.set(player.position[0], player.position[1], player.position[2])
        } else {
            console.warn(
                `[App] level "${level.name}" não tem instance de category "player"; usando spawn default [0, 2, 10].`,
            )
            setPlayerSpawn([0, 2, 10])
            setPlayerSpawnRotation([0, 0, 0])
            playerPositionRef.current.set(0, 2, 10)
        }
        setPlayerSpawnKey((k) => k + 1)
    }, [])
    useEffect(() => {
        setPlayerSpawn(null)
    }, [levelPreset])

    useEffect(() => subscribeDebrisCount(setDebrisCount), [])

    const runtimeEnvironment = normalizeLevelEnvironment(levelEnvironment)
    const runtimeLighting = normalizeLevelLighting(levelLighting)
    const runtimeEdgeOutline = normalizeLevelEdgeOutline(levelEdgeOutline)

    const levelSrc = levelJsonPath(levelPreset)

    return (
        <>
            <Leva
                theme={{
                    fontSizes: {
                        root: '14px',
                        toolTip: '13px',
                    },
                    sizes: {
                        rootWidth: '420px',
                        controlWidth: '280px',
                        numberInputMinWidth: '92px',
                        scrubberWidth: '12px',
                        scrubberHeight: '16px',
                        rowHeight: '34px',
                        folderTitleHeight: '32px',
                    },
                }}
            />
            <div style={{
                position: 'absolute',
                top: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '13px',
                fontFamily: 'monospace',
                userSelect: 'none',
                zIndex: 1000
            }}>
                <div style={{
                    background: 'rgba(255, 255, 255, 0.15)',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    letterSpacing: '0.5px',
                    whiteSpace: 'nowrap'
                }}>
                    WASD to move | SPACE to jump | SHIFT to run | U to unstuck
                </div>
            </div>
            
            <div id="ammo-display" style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                color: 'rgba(255, 255, 255, 0.75)',
                fontSize: '14px',
                fontFamily: 'monospace',
                userSelect: 'none',
                zIndex: 1000
            }}>
                AMMO: 50/50
            </div>

            <div style={{
                position: 'absolute',
                left: '10px',
                bottom: '62px',
                color: '#9ffcff',
                background: 'rgba(0, 0, 0, 0.65)',
                border: '1px solid rgba(159, 252, 255, 0.35)',
                padding: '4px 7px',
                fontFamily: 'monospace',
                fontSize: '11px',
                lineHeight: 1,
                userSelect: 'none',
                pointerEvents: 'none',
                zIndex: 1000
            }}>
                DEBRIS: {debrisCount}
            </div>

            <FpsMonitorDisplay />

            <Canvas>
                    <FpsMonitorCollector />
                    <ScenePerfLogger enabled={perfTelemetryEnabled} />
                    <ShadowToggle enabled={runtimeLighting.shadows} />
                    {fogEnabled && <fog attach="fog" args={[fogColor, fogNear, fogFar]} />}

                    <LevelEnvironmentRenderer environment={runtimeEnvironment} />

                    <ambientLight intensity={runtimeLighting.ambientIntensity} />
                    <directionalLight
                        castShadow={runtimeLighting.shadows}
                        position={[
                            runtimeLighting.directionalDistance,
                            runtimeLighting.directionalHeight,
                            runtimeLighting.directionalDistance,
                        ]}
                        ref={directionalLightRef}
                        intensity={runtimeLighting.directionalIntensity}
                        shadow-mapSize={[1024, 1024]}
                        shadow-camera-left={-30}
                        shadow-camera-right={30}
                        shadow-camera-top={30}
                        shadow-camera-bottom={-30}
                        shadow-camera-near={1}
                        shadow-camera-far={150}
                        shadow-bias={-0.0001}
                        shadow-normalBias={0.02}
                    />

                    <Physics 
                        debug={showColliders} 
                        paused={loading}
                        timeStep={1/60}
                        interpolate={true}
                        gravity={[0, -9.81, 0]}
                        substeps={1}
                        maxStabilizationIterations={6}
                        maxVelocityIterations={6}
                        maxVelocityFriction={1}
                    >
                        <PlayerControls>
                            {playerSpawn && (
                                <Player
                                    key={playerSpawnKey}
                                    position={playerSpawn}
                                    spawnRotation={playerSpawnRotation}
                                    walkSpeed={walkSpeed}
                                    runSpeed={runSpeed}
                                    jumpForce={jumpForce}
                                    respawnPosition={playerSpawn}
                                    fallLimitY={-18}
                                    onMove={(position) => {
                                        playerPositionRef.current.copy(position)
                                        if (directionalLightRef.current) {
                                            const light = directionalLightRef.current
                                            light.position.x = position.x + runtimeLighting.directionalDistance
                                            light.position.z = position.z + runtimeLighting.directionalDistance
                                            light.target.position.copy(position)
                                            light.target.updateMatrixWorld()
                                        }
                                    }}
                                />
                            )}
                        </PlayerControls>
                        {levelSrc && (
                            <LevelLoader
                                src={levelSrc}
                                breakableThresholdOverride={
                                    useBreakableThresholdOverride
                                        ? breakableThresholdOverride
                                        : undefined
                                }
                                onLevelLoaded={handleLevelLoaded}
                                playerPositionRef={playerPositionRef}
                                edgeOutline={runtimeEdgeOutline}
                            />
                        )}
                        <Ball />
                        <SphereTool />
                    </Physics>

                    <PerspectiveCamera 
                        makeDefault 
                        position={[0, 10, 10]} 
                        rotation={[0, 0, 0]}
                        near={0.1}
                        far={1000}
                    />

                    {enablePostProcessing && (
                        <EffectComposer>
                            {vignetteEnabled && (
                                <Vignette
                                    offset={vignetteOffset}
                                    darkness={vignetteDarkness}
                                    eskil={false}
                                />
                            )}
                            {chromaticAberrationEnabled && (
                                <ChromaticAberration
                                    offset={new THREE.Vector2(
                                        chromaticAberrationOffset,
                                        chromaticAberrationOffset,
                                    )}
                                    radialModulation={false}
                                    modulationOffset={0}
                                />
                            )}
                            {brightnessContrastEnabled && (
                                <BrightnessContrast brightness={brightness} contrast={contrast} />
                            )}
                            {colorGradingEnabled && (
                                <ToneMapping blendFunction={BlendFunction.NORMAL} mode={toneMapping} />
                            )}
                        </EffectComposer>
                    )}
            </Canvas>

            <Crosshair />
        </>
    )
}

export default App
