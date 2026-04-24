import { Canvas } from './common/components/canvas'
import { FpsMonitorCollector, FpsMonitorDisplay } from './common/components/fps-monitor'
import { Crosshair } from './common/components/crosshair'
import { useLoadingAssets } from './common/hooks/use-loading-assets'
import { Environment, PerspectiveCamera } from '@react-three/drei'
import { EffectComposer, Vignette, ChromaticAberration, BrightnessContrast, ToneMapping } from '@react-three/postprocessing'
import {
    BlendFunction,
    EffectComposer as PostEffectComposer,
    EffectPass,
    PixelationEffect,
    RenderPass as PostRenderPass,
} from 'postprocessing'
import { useFrame, useThree } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { useControls, folder } from 'leva'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EffectComposer as ThreeEffectComposer, HalftonePass, RenderPass } from 'three-stdlib'
import { Player, PlayerControls } from './game/player'
import { Ball } from './game/ball'
import { SphereTool } from './game/sphere-tool'
import { LevelLoader } from './level/LevelLoader'
import { LEVEL_PRESETS, levelJsonPath, type LevelPreset } from './level/level-presets'
import type { LevelFile, Vec3 } from './level/types'

function HalftoneComposer({
    shape,
    radius,
    rotateRDeg,
    rotateGDeg,
    rotateBDeg,
    scatter,
    blending,
    greyscale,
}: {
    shape: number
    radius: number
    rotateRDeg: number
    rotateGDeg: number
    rotateBDeg: number
    scatter: number
    blending: number
    greyscale: boolean
}) {
    const { gl, scene, camera, size } = useThree()
    const composerRef = useRef<ThreeEffectComposer | null>(null)
    const halftoneRef = useRef<HalftonePass | null>(null)

    useEffect(() => {
        const composer = new ThreeEffectComposer(gl)
        const renderPass = new RenderPass(scene, camera)
        const halftonePass = new HalftonePass(size.width, size.height, {})
        composer.addPass(renderPass)
        composer.addPass(halftonePass)
        composerRef.current = composer
        halftoneRef.current = halftonePass

        return () => {
            composer.dispose()
            composerRef.current = null
            halftoneRef.current = null
        }
    }, [camera, gl, scene, size.height, size.width])

    useEffect(() => {
        composerRef.current?.setPixelRatio(gl.getPixelRatio())
        composerRef.current?.setSize(size.width, size.height)
        halftoneRef.current?.setSize(size.width, size.height)
    }, [gl, size.height, size.width])

    useEffect(() => {
        const uniforms = halftoneRef.current?.uniforms
        if (!uniforms) return
        uniforms.shape.value = shape
        uniforms.radius.value = radius
        uniforms.rotateR.value = THREE.MathUtils.degToRad(rotateRDeg)
        uniforms.rotateG.value = THREE.MathUtils.degToRad(rotateGDeg)
        uniforms.rotateB.value = THREE.MathUtils.degToRad(rotateBDeg)
        uniforms.scatter.value = scatter
        uniforms.blending.value = blending
        uniforms.greyscale.value = greyscale ? 1 : 0
        uniforms.disable.value = 0
    }, [blending, greyscale, radius, rotateBDeg, rotateGDeg, rotateRDeg, scatter, shape])

    useFrame((_, delta) => {
        composerRef.current?.render(delta)
    }, 1)

    return null
}

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

function PixelationComposer({ granularity }: { granularity: number }) {
    const { gl, scene, camera, size } = useThree()
    const composerRef = useRef<PostEffectComposer | null>(null)
    const pixelationRef = useRef<PixelationEffect | null>(null)

    useEffect(() => {
        const composer = new PostEffectComposer(gl)
        const renderPass = new PostRenderPass(scene, camera)
        const pixelation = new PixelationEffect(granularity)
        const effectPass = new EffectPass(camera, pixelation)
        composer.addPass(renderPass)
        composer.addPass(effectPass)
        composerRef.current = composer
        pixelationRef.current = pixelation

        return () => {
            composer.dispose()
            composerRef.current = null
            pixelationRef.current = null
        }
    }, [camera, gl, granularity, scene])

    useEffect(() => {
        composerRef.current?.setSize(size.width, size.height)
    }, [gl, size.height, size.width])

    useEffect(() => {
        if (!pixelationRef.current) return
        pixelationRef.current.granularity = granularity
    }, [granularity])

    useFrame((_, delta) => {
        composerRef.current?.render(delta)
    }, 1)

    return null
}

export function App() {
    const loading = useLoadingAssets()
    const directionalLightRef = useRef<THREE.DirectionalLight>(null)

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
        ambientIntensity,
        directionalIntensity,
        directionalHeight,
        directionalDistance,
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
        halftoneEnabled,
        halftoneShape,
        halftoneRadius,
        halftoneRotateR,
        halftoneRotateG,
        halftoneRotateB,
        halftoneScatter,
        halftoneBlending,
        halftoneGreyscale,
        pixelationEnabled,
        pixelationGranularity,
    } = useControls({
        fog: folder({
            fogEnabled: true,
            fogColor: '#dbdbdb',
            fogNear: { value: 13, min: 0, max: 50, step: 1 },
            fogFar: { value: 95, min: 0, max: 100, step: 1 }
        }, { collapsed: true, hidden: true }),
        lighting: folder({
            ambientIntensity: { value: 1.3, min: 0, max: 2, step: 0.1 },
            directionalIntensity: { value: 1, min: 0, max: 2, step: 0.1 },
            directionalHeight: { value: 20, min: 5, max: 50, step: 1 },
            directionalDistance: { value: 10, min: 5, max: 30, step: 1 }
        }, { collapsed: true, hidden: true }),
        postProcessing: folder({
            enablePostProcessing: true,
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
            halftoneEnabled: false,
            halftoneShape: {
                value: 1,
                options: { Dot: 1, Ellipse: 2, Line: 3, Square: 4, Diamond: 5 },
            },
            halftoneRadius: { value: 4, min: 1, max: 25, step: 1 },
            halftoneRotateR: { value: 15, min: 0, max: 90, step: 1 },
            halftoneRotateG: { value: 30, min: 0, max: 90, step: 1 },
            halftoneRotateB: { value: 45, min: 0, max: 90, step: 1 },
            halftoneScatter: { value: 0, min: 0, max: 1, step: 0.01 },
            halftoneBlending: { value: 1, min: 0, max: 1, step: 0.01 },
            halftoneGreyscale: false,
            pixelationEnabled: false,
            pixelationGranularity: { value: 8, min: 1, max: 64, step: 1 },
        }, { collapsed: true, hidden: true })
    }, {
        collapsed: true,
        hidden: true
    })

    const { levelPreset, showColliders, breakableThresholdOverride } = useControls(
        'Level',
        {
            levelPreset: {
                value: 'level1' as LevelPreset,
                options: [...LEVEL_PRESETS],
                label: 'level JSON',
            },
            showColliders: { value: false, label: 'debug colliders' },
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

    // Spawn do player: extraído do level JSON no load. Enquanto o level não
    // chegou (primeiro frame / troca de preset), mantemos `null` e não
    // renderizamos o <Player /> — assim evitamos o player cair no vazio se o
    // level não tiver chão ainda.
    const [playerSpawn, setPlayerSpawn] = useState<Vec3 | null>(null)
    const [playerSpawnKey, setPlayerSpawnKey] = useState(0)
    const handleLevelLoaded = useCallback((level: LevelFile) => {
        const player = level.instances.find((i) => i.category === 'player')
        if (player) {
            setPlayerSpawn(player.position)
        } else {
            console.warn(
                `[App] level "${level.name}" não tem instance de category "player"; usando spawn default [0, 2, 10].`,
            )
            setPlayerSpawn([0, 2, 10])
        }
        setPlayerSpawnKey((k) => k + 1)
    }, [])

    useEffect(() => {
        // Quando o preset muda, limpa o spawn pra segurar o <Player /> até o
        // novo level responder.
        setPlayerSpawn(null)
    }, [levelPreset])

    const {
        skyboxMode,
        backgroundColor,
        environmentIBL,
        shadowsEnabled,
    } = useControls(
        'Debug',
        {
            skyboxMode: {
                value: 'environment' as 'environment' | 'solid',
                options: { 'Environment (sunset)': 'environment', 'Solid color': 'solid' },
                label: 'background',
            },
            backgroundColor: { value: '#1a1d22', label: 'bg color' },
            environmentIBL: { value: true, label: 'IBL (lighting)' },
            shadowsEnabled: { value: true, label: 'shadows' },
        },
        { collapsed: false },
    )

    const levelSrc = levelJsonPath(levelPreset)

    return (
        <>
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
                    WASD to move | SPACE to jump | SHIFT to run
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

            <FpsMonitorDisplay />

            <Canvas>
                <FpsMonitorCollector />
                <ShadowToggle enabled={shadowsEnabled} />
                {fogEnabled && <fog attach="fog" args={[fogColor, fogNear, fogFar]} />}

                {skyboxMode === 'solid' && (
                    <color attach="background" args={[backgroundColor]} />
                )}
                {/* Environment is kept (even with solid bg) only when IBL is
                    requested, because drei's Environment needs `background` to
                    render the sky AND can contribute IBL to PBR materials with
                    `background={false}`. */}
                {skyboxMode === 'environment' ? (
                    <Environment
                        preset="sunset"
                        intensity={1}
                        background
                        blur={0.8}
                        resolution={256}
                    />
                ) : environmentIBL ? (
                    <Environment preset="sunset" blur={0.8} resolution={256} />
                ) : null}

                <ambientLight intensity={ambientIntensity} />
                <directionalLight
                    castShadow={shadowsEnabled}
                    position={[directionalDistance, directionalHeight, directionalDistance]}
                    ref={directionalLightRef}
                    intensity={directionalIntensity}
                    shadow-mapSize={[4096, 4096]}
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
                    substeps={2}
                    maxStabilizationIterations={10}
                    maxVelocityIterations={10}
                    maxVelocityFriction={1}
                >
                    <PlayerControls>
                        {playerSpawn && (
                            <Player
                                key={playerSpawnKey}
                                position={playerSpawn}
                                walkSpeed={walkSpeed}
                                runSpeed={runSpeed}
                                jumpForce={jumpForce}
                                onMove={(position) => {
                                    if (directionalLightRef.current) {
                                        const light = directionalLightRef.current
                                        light.position.x = position.x + directionalDistance
                                        light.position.z = position.z + directionalDistance
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
                            breakableThresholdOverride={breakableThresholdOverride}
                            onLevelLoaded={handleLevelLoaded}
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

                {enablePostProcessing &&
                    (halftoneEnabled ? (
                        <HalftoneComposer
                            shape={halftoneShape}
                            radius={halftoneRadius}
                            rotateRDeg={halftoneRotateR}
                            rotateGDeg={halftoneRotateG}
                            rotateBDeg={halftoneRotateB}
                            scatter={halftoneScatter}
                            blending={halftoneBlending}
                            greyscale={halftoneGreyscale}
                        />
                    ) : pixelationEnabled ? (
                        <PixelationComposer granularity={pixelationGranularity} />
                    ) : (
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
                                <BrightnessContrast
                                    brightness={brightness}
                                    contrast={contrast}
                                />
                            )}
                            {colorGradingEnabled && (
                                <ToneMapping
                                    blendFunction={BlendFunction.NORMAL}
                                    mode={toneMapping}
                                />
                            )}
                        </EffectComposer>
                    ))}
            </Canvas>

            <Crosshair />
        </>
    )
}

export default App