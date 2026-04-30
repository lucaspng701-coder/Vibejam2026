import Rapier, { ActiveEvents } from '@dimforge/rapier3d-compat'
import { useFrame, useThree } from '@react-three/fiber'
import { BallCollider, RigidBody, interactionGroups, useRapier, type CollisionEnterPayload, type RapierRigidBody } from '@react-three/rapier'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useControls } from 'leva'
import { useGamepad } from '../common/hooks/use-gamepad'
import * as THREE from 'three'
import { raycastEnemyHitTargets } from './enemy-hit-registry'
import { CollisionGroup, projectileCollision, projectileSolverCollision } from './physics-collision-filters'
import { PROJECTILE_HIT_ENEMY_EVENT, type ProjectileHitEnemyDetail } from './projectile-hit-events'
import { SurfaceImpactFx } from './projectile-surface-impact'
import { getSphereProjectileIdByHandle, registerSphereProjectileHandle, unregisterSphereProjectileHandle } from './sphere-projectile-handles'
import { PLAYER_WEAPON_RELOAD_COMPLETE_EVENT, PLAYER_WEAPON_RELOAD_EVENT, PLAYER_WEAPON_SHOOT_EVENT } from './weapon-events'

// -----------------------------------------------------------------------------
// Ajuste visual / física dos projéteis (SphereTool) — tudo no mesmo arquivo:
//
//  — PROJECTILE_SPHERE_RADIUS: raio do collider Rapier (m). Afeta contato
//    com paredes, inimigos e breakables. Não há mesh visível; só o BallCollider.
//  — SHOOT_FORCE, mass, restitution, etc.: parâmetros do `RigidBody` (física).
//  — PROJECTILE_LIFETIME_MS: tempo até o corpo some do mundo (ricochete + trail).
//  — TRAIL_MAX_POINTS: quantos segmentos a linha do rastro guarda (comprimento
//    aparente do trail). Não muda a bolinha (ela é só colisor invisível).
//  — TRAIL_COLOR_TAIL / TRAIL_COLOR_HEAD: RGB em 0..1, gradiente do rastro.
//  — Trail: tubo (secção poligonal) no world space — mesma amostra do corpo; visto de
//    frente/ lado/ cima o volume lê-se sólido, não "papel" como uma faixa.
//    Leva trailWidth = diâmetro; TRAIL_TUBE_RADIAL = lados (mais = mais caro).
//    trailTailFade (cor), trailTaper (raio), lifeEndFade (opac. no fim da vida).
//  — Fim de vida: onExpire tira o id do estado → desmonta o Projectile; o
//    RigidBody deixa a cena e o Rapier deixa de simular (sem corpo invisível a custar colisão).
//  — Emissor: `offset` local à câmera + `applyQuaternion`. Eixo +Z *local* = *atrás* do olho; z **negativo**
//    aproxima o bico na cena. O bug “costas na parede” era z **positivo** (empurrava 2,5m p/ trás, não
//    “alongView 2,5m na mira” a partir do olho — isso deixava o tiro 2,5m na frente do corpo de forma errada).
// -----------------------------------------------------------------------------

const _tangent = new THREE.Vector3()
const _uAxis = new THREE.Vector3()
const _vAxis = new THREE.Vector3()
const _wUp = new THREE.Vector3(0, 1, 0)
const _wAlt = new THREE.Vector3(1, 0, 0)
const _hitscanOrigin = new THREE.Vector3()
const _hitscanDirection = new THREE.Vector3()
const _localShotDirection = new THREE.Vector3()
const _shotRotation = new THREE.Euler()
let shotAudioContext: AudioContext | null = null

function playShotSound() {
    const AudioContextCtor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    shotAudioContext ??= new AudioContextCtor()
    const ctx = shotAudioContext
    if (ctx.state === 'suspended') void ctx.resume()

    const now = ctx.currentTime
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * 0.045))
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
    }

    const noise = ctx.createBufferSource()
    const osc = ctx.createOscillator()
    const filter = ctx.createBiquadFilter()
    const noiseGain = ctx.createGain()
    const toneGain = ctx.createGain()

    noise.buffer = noiseBuffer
    filter.type = 'highpass'
    filter.frequency.setValueAtTime(900, now)
    osc.type = 'square'
    osc.frequency.setValueAtTime(180, now)
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.055)

    noiseGain.gain.setValueAtTime(0.13, now)
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045)
    toneGain.gain.setValueAtTime(0.08, now)
    toneGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065)

    noise.connect(filter)
    filter.connect(noiseGain)
    noiseGain.connect(ctx.destination)
    osc.connect(toneGain)
    toneGain.connect(ctx.destination)

    noise.start(now)
    noise.stop(now + 0.05)
    osc.start(now)
    osc.stop(now + 0.07)
}

const TRAIL_TUBE_RADIAL = 4
const TRAILS_ENABLED = true
const TRAIL_SPAWN_DELAY_MS = 24
const TWO_PI = Math.PI * 2
const TRAIL_ORIGIN_TAPER_FRACTION = 0.36

const TRAIL_OPACITY_BASE = 1
/** Aumenta brilho do tubo pós-vertexColors (MeshBasic ainda passa por tone mapping; ver `toneMapped: false` no mat). */
const TRAIL_COLOR_BOOST = 5

/** Última fração da vida (0.35 = 35% final) em que o trail esmaece até 0. */
function computeLifeOpacity(
    spawnedAt: number,
    lifeMs: number,
    endFadeFract: number
): number {
    if (lifeMs <= 0) return 0
    const u = (performance.now() - spawnedAt) / lifeMs
    if (u >= 1) return 0
    const f = Math.max(0, Math.min(1, endFadeFract))
    if (f <= 0) return 1
    const fadeStart = 1 - f
    if (u <= fadeStart) return 1
    return (1 - u) / f
}

export const PROJECTILE_SPHERE_RADIUS = 0.3
export const PROJECTILE_LIFETIME_MS = 120
/** Máx. eventos de impacto com superfície por projétil (ex.: ricochete). */
const MAX_IMPACTS_PER_BULLET = 2
const SHOOT_FORCE = 250
export const TRAIL_MAX_POINTS = 10
const ENEMY_HITSCAN_RANGE = 120

/** Cor da cauda / ponta (0–1) — ajuste para tom quente; sem shading (Basic + unlit, ver material). */
const TRAIL_COLOR_TAIL: [number, number, number] = [1, 1, 1]
const TRAIL_COLOR_HEAD: [number, number, number] = [1, 1, 1]

const EMITTER_OFFSET_FROM_CAMERA = {
    x: 0.1,
    y: -0.08,
    z: -0.21,
}

const EMITTER_ROTATION_DEG = {
    x: -1.2,
    y: 0.6,
    z: 29.8,
}

type SphereEntry = {
    id: string
    position: [number, number, number]
    direction: [number, number, number]
    radius: number
    /** `performance.now()` no disparo — fade de fim de vida, etc. */
    spawnedAt: number
}

type SurfaceImpactItem = {
    id: string
    pos: [number, number, number]
    nrm: [number, number, number]
}

type HitscanTrailItem = {
    id: string
    from: [number, number, number]
    to: [number, number, number]
    spawnedAt: number
}

function isEnemyCollision(payload: CollisionEnterPayload): boolean {
    return Boolean(payload.other.rigidBodyObject?.name?.startsWith('enemy-'))
}

function HitscanTrail({ item, onDone }: { item: HitscanTrailItem; onDone: () => void }) {
    const line = useMemo(() => {
        const geom = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...item.from),
            new THREE.Vector3(...item.to),
        ])
        const mat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.9,
            toneMapped: false,
            blending: THREE.AdditiveBlending,
        })
        return new THREE.Line(geom, mat)
    }, [item.from, item.to])

    useEffect(() => {
        return () => {
            line.geometry.dispose()
                ; (line.material as THREE.Material).dispose()
        }
    }, [line])

    useFrame(() => {
        const age = performance.now() - item.spawnedAt
        if (age < TRAIL_SPAWN_DELAY_MS) {
            line.visible = false
            return
        }
        line.visible = true
        const u = (age - TRAIL_SPAWN_DELAY_MS) / 90
        if (u >= 1) {
            onDone()
            return
        }
        ; (line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - u) * (1 - u)
    })

    return <primitive object={line} />
}

type ProjectileProps = {
    entry: SphereEntry
    onExpire: (id: string) => void
    showColliderDebug: boolean
    trailTailFade: number
    trailWidth: number
    trailTaper: number
    lifeEndFade: number
    onRecordImpact: (p: [number, number, number], n: [number, number, number]) => void
}

/**
 * Rastro: tubo com `TRAIL_TUBE_RADIAL` lados (prisma/cilindro) ao longo do path — volume visível de qualquer ângulo.
 */
function BulletTrail({
    rigidBodyRef,
    /** Mesmo ponto de spawn do `RigidBody` — semente da cauda do rastro (senão 1.º ponto vira a posição já deslocada). */
    spawnPosition,
    tailFade,
    trailWidth,
    trailTaper,
    lifeEndFade,
    spawnedAt,
}: {
    rigidBodyRef: RefObject<RapierRigidBody | null>
    spawnPosition: [number, number, number]
    tailFade: number
    trailWidth: number
    trailTaper: number
    lifeEndFade: number
    /** instante do tiro; vem de `entry.spawnedAt` */
    spawnedAt: number
}) {
    const maxPts = TRAIL_MAX_POINTS
    const ring = useRef<THREE.Vector3[]>([])

    const [sx, sy, sz] = spawnPosition
    useLayoutEffect(() => {
        ring.current = [new THREE.Vector3(sx, sy, sz)]
    }, [sx, sy, sz])

    const { mesh, posAttr, colAttr, geom } = useMemo(() => {
        const rPoly = TRAIL_TUBE_RADIAL
        const g = new THREE.BufferGeometry()
        const nVert = maxPts * rPoly
        const pos = new THREE.BufferAttribute(new Float32Array(nVert * 3), 3)
        const col = new THREE.BufferAttribute(new Float32Array(nVert * 3), 3)
        g.setAttribute('position', pos)
        g.setAttribute('color', col)

        const maxSeg = maxPts - 1
        const nIdx = maxSeg * rPoly * 6
        const index = new Uint32Array(nIdx)
        let w = 0
        for (let s = 0; s < maxSeg; s++) {
            for (let k = 0; k < rPoly; k++) {
                const k2 = (k + 1) % rPoly
                const a = s * rPoly + k
                const b = s * rPoly + k2
                const c = (s + 1) * rPoly + k
                const d = (s + 1) * rPoly + k2
                index[w++] = a
                index[w++] = b
                index[w++] = c
                index[w++] = b
                index[w++] = d
                index[w++] = c
            }
        }
        g.setIndex(new THREE.BufferAttribute(index, 1))

        const mat = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
        })
        const m = new THREE.Mesh(g, mat)
        m.frustumCulled = false
        return { mesh: m, posAttr: pos, colAttr: col, geom: g }
    }, [maxPts])

    useEffect(() => {
        return () => {
            const mat = mesh.material
            if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
            else mat.dispose()
            geom.dispose()
        }
    }, [mesh, geom])

    useFrame(() => {
        const mat = mesh.material as THREE.MeshBasicMaterial
        const age = performance.now() - spawnedAt
        if (age < TRAIL_SPAWN_DELAY_MS) {
            mesh.visible = false
            return
        }

        const t = rigidBodyRef.current?.translation()
        if (!t) {
            return
        }

        if (!mesh.visible) {
            mesh.visible = true
            ring.current = [new THREE.Vector3(t.x, t.y, t.z)]
        }

        const lifeOp = computeLifeOpacity(spawnedAt, PROJECTILE_LIFETIME_MS, lifeEndFade)
        mat.opacity = TRAIL_OPACITY_BASE * lifeOp

        const v = new THREE.Vector3(t.x, t.y, t.z)
        const ringArr = ring.current
        const last = ringArr.length > 0 ? ringArr[ringArr.length - 1]! : null
        if (last && last.distanceToSquared(v) < 1e-6) {
            return
        }
        ringArr.push(v)
        if (ringArr.length > maxPts) ringArr.shift()

        const n = ringArr.length
        if (n < 2) {
            geom.setDrawRange(0, 0)
            return
        }

        const p = posAttr.array as Float32Array
        const c = colAttr.array as Float32Array
        const rBase = Math.max(0.001, trailWidth * 0.5)
        const rPoly = TRAIL_TUBE_RADIAL
        const tpr = Math.max(0, Math.min(1, trailTaper))

        for (let i = 0; i < n; i++) {
            if (i === 0) {
                _tangent.subVectors(ringArr[1]!, ringArr[0]!)
            } else if (i === n - 1) {
                _tangent.subVectors(ringArr[n - 1]!, ringArr[n - 2]!)
            } else {
                _tangent.subVectors(ringArr[i + 1]!, ringArr[i - 1]!)
            }
            if (_tangent.lengthSq() < 1e-12) {
                _tangent.set(0, 0, 1)
            } else {
                _tangent.normalize()
            }
            _uAxis.copy(_tangent).cross(_wUp)
            if (_uAxis.lengthSq() < 1e-10) {
                _uAxis.copy(_tangent).cross(_wAlt)
            }
            _uAxis.normalize()
            _vAxis.copy(_tangent).cross(_uAxis).normalize()

            const pt = ringArr[i]!
            const along = n > 1 ? i / (n - 1) : 0
            const originT = Math.min(1, Math.max(0, along / TRAIL_ORIGIN_TAPER_FRACTION))
            const originFade = originT * originT * (3 - 2 * originT)
            const tailThin = 1 - tpr * (1 - along)
            const rTube = rBase * Math.max(0.001, tailThin * originFade)
            const baseR = TRAIL_COLOR_TAIL[0] + (TRAIL_COLOR_HEAD[0] - TRAIL_COLOR_TAIL[0]) * along
            const baseG = TRAIL_COLOR_TAIL[1] + (TRAIL_COLOR_HEAD[1] - TRAIL_COLOR_TAIL[1]) * along
            const baseB = TRAIL_COLOR_TAIL[2] + (TRAIL_COLOR_HEAD[2] - TRAIL_COLOR_TAIL[2]) * along
            const tailBlend = along * along
            const normalFade = 1 - (1 - tailBlend) * tailFade
            const fade = THREE.MathUtils.lerp(1, normalFade, originFade)
            const r = Math.min(1, baseR * fade * TRAIL_COLOR_BOOST)
            const g0 = Math.min(1, baseG * fade * TRAIL_COLOR_BOOST)
            const b0 = Math.min(1, baseB * fade * TRAIL_COLOR_BOOST)

            for (let k = 0; k < rPoly; k++) {
                const theta = (k / rPoly) * TWO_PI
                const co = Math.cos(theta) * rTube
                const si = Math.sin(theta) * rTube
                const o = 3 * (i * rPoly + k)
                p[o] = pt.x + co * _uAxis.x + si * _vAxis.x
                p[o + 1] = pt.y + co * _uAxis.y + si * _vAxis.y
                p[o + 2] = pt.z + co * _uAxis.z + si * _vAxis.z
                c[o] = r
                c[o + 1] = g0
                c[o + 2] = b0
            }
        }

        posAttr.needsUpdate = true
        colAttr.needsUpdate = true
        geom.setDrawRange(0, (n - 1) * rPoly * 6)
    })

    return <primitive object={mesh} />
}

const Projectile = ({
    entry,
    onExpire,
    showColliderDebug,
    trailTailFade,
    trailWidth,
    trailTaper,
    lifeEndFade,
    onRecordImpact,
}: ProjectileProps) => {
    const rb = useRef<RapierRigidBody>(null)
    const { id, position, direction, radius, spawnedAt } = entry
    const debugRef = useRef<THREE.Mesh | null>(null)
    const impactCount = useRef(0)

    const onCollisionEnter = useCallback(
        (payload: CollisionEnterPayload) => {
            if (impactCount.current >= MAX_IMPACTS_PER_BULLET) return
            if (isEnemyCollision(payload)) {
                onExpire(id)
                return
            }
            const m = payload.manifold
            const tr = rb.current?.translation()
            if (!tr) return
            const nv = m.normal()
            const n = new THREE.Vector3(nv.x, nv.y, nv.z)
            if (n.lengthSq() < 1e-8) return
            n.normalize()
            impactCount.current += 1
            onRecordImpact([tr.x, tr.y, tr.z], [n.x, n.y, n.z])
        },
        [id, onExpire, onRecordImpact]
    )

    useFrame(() => {
        if (!showColliderDebug) return
        const m = computeLifeOpacity(spawnedAt, PROJECTILE_LIFETIME_MS, lifeEndFade)
        const d = debugRef.current
        if (d) {
            const mat = d.material as THREE.MeshBasicMaterial
            mat.opacity = 0.6 * m
        }
    })

    useEffect(() => {
        const t = window.setTimeout(() => onExpire(id), PROJECTILE_LIFETIME_MS)
        return () => window.clearTimeout(t)
    }, [id, onExpire])

    useEffect(() => {
        let handle: number | undefined
        let cancelled = false
        const to = window.setTimeout(() => {
            if (cancelled) return
            const body = rb.current
            if (!body) return
            handle = (body as { handle?: number }).handle
            if (handle === undefined) return
            registerSphereProjectileHandle(handle, id)
        }, 0)
        return () => {
            cancelled = true
            window.clearTimeout(to)
            if (handle !== undefined) unregisterSphereProjectileHandle(handle)
        }
    }, [id])

    return (
        <group>
            <RigidBody
                ref={rb}
                position={position}
                friction={1}
                angularDamping={0.2}
                linearDamping={0.1}
                restitution={0.5}
                colliders={false}
                mass={0.4}
                ccd={true}
                linearVelocity={[direction[0] * SHOOT_FORCE, direction[1] * SHOOT_FORCE, direction[2] * SHOOT_FORCE]}
                onCollisionEnter={onCollisionEnter}
            >
                <BallCollider
                    args={[radius]}
                    collisionGroups={projectileCollision()}
                    solverGroups={projectileSolverCollision()}
                    activeEvents={ActiveEvents.COLLISION_EVENTS}
                />
                {showColliderDebug && (
                    <mesh ref={debugRef}>
                        <sphereGeometry args={[radius, 20, 20]} />
                        <meshBasicMaterial color="#4ade80" wireframe transparent opacity={0.6} />
                    </mesh>
                )}
            </RigidBody>
            {TRAILS_ENABLED && (
                <BulletTrail
                    rigidBodyRef={rb}
                    spawnPosition={position}
                    tailFade={trailTailFade}
                    trailWidth={trailWidth}
                    trailTaper={trailTaper}
                    lifeEndFade={lifeEndFade}
                    spawnedAt={spawnedAt}
                />
            )}
        </group>
    )
}

function genId(): string {
    return `proj_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`
}

export const SphereTool = () => {
    const sphereRadius = PROJECTILE_SPHERE_RADIUS
    const MAX_AMMO = 30
    const FIRE_INTERVAL_MS = 156

    const { showColliders, trailTailFade, trailWidth, trailTaper, lifeEndFade } = useControls(
        'SphereTool',
        {
            showColliders: { value: false, label: 'Ver colisores (wireframe)' },
            trailWidth: { value: 0.15, min: 0.10, max: 5, step: 0.01, label: 'Espessura (m)' },
            trailTaper: { value: 0.92, min: 0, max: 1, step: 0.05, label: 'Taper cauda (raio ↓ na cauda)' },
            trailTailFade: { value: 0.5, min: 0, max: 1, step: 0.05, label: 'Fade cor na cauda' },
            lifeEndFade: { value: 0.35, min: 0.05, max: 0.95, step: 0.05, label: 'Esmaecer fim (frac. vida final)' },
        },
        { collapsed: true, order: 997 }
    )
    const {
        x: emitterX,
        y: emitterY,
        z: emitterZ,
        rotX,
        rotY,
        rotZ,
    } = useControls(
        'Projectile Emitter',
        {
            x: { value: EMITTER_OFFSET_FROM_CAMERA.x, min: -1, max: 1, step: 0.01 },
            y: { value: EMITTER_OFFSET_FROM_CAMERA.y, min: -1, max: 1, step: 0.01 },
            z: { value: EMITTER_OFFSET_FROM_CAMERA.z, min: -3, max: -0.1, step: 0.01 },
            rotX: { value: EMITTER_ROTATION_DEG.x, min: -30, max: 30, step: 0.1, label: 'rot X deg' },
            rotY: { value: EMITTER_ROTATION_DEG.y, min: -30, max: 30, step: 0.1, label: 'rot Y deg' },
            rotZ: { value: EMITTER_ROTATION_DEG.z, min: -180, max: 180, step: 0.1, label: 'rot Z deg' },
        },
        { collapsed: true, order: 996 },
    )

    const camera = useThree((s) => s.camera)
    const rapierWorld = useRapier().world
    const hitscanBlockGroups = useMemo(
        () => interactionGroups([CollisionGroup.projectile], [CollisionGroup.world]),
        [],
    )
    const [spheres, setSpheres] = useState<SphereEntry[]>([])
    const [impacts, setImpacts] = useState<SurfaceImpactItem[]>([])
    const [hitscanTrails, setHitscanTrails] = useState<HitscanTrailItem[]>([])

    const removeProjectile = useCallback((projectileId: string) => {
        setSpheres((prev) => prev.filter((s) => s.id !== projectileId))
    }, [])

    const recordImpact = useCallback((p: [number, number, number], n: [number, number, number]) => {
        setImpacts((prev) => [
            ...prev.slice(-5),
            { id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, pos: p, nrm: n },
        ])
    }, [])

    const removeImpact = useCallback((impactId: string) => {
        setImpacts((prev) => prev.filter((x) => x.id !== impactId))
    }, [])

    const hitscanEnemy = useCallback((direction: THREE.Vector3): [number, number, number] | null => {
        _hitscanOrigin.copy(camera.position)
        _hitscanDirection.copy(direction).normalize()
        const hit = raycastEnemyHitTargets(
            [_hitscanOrigin.x, _hitscanOrigin.y, _hitscanOrigin.z],
            [_hitscanDirection.x, _hitscanDirection.y, _hitscanDirection.z],
            ENEMY_HITSCAN_RANGE,
        )
        if (!hit) return null
        const blockDistance = Math.max(0, hit.distance - 0.04)
        if (blockDistance > 0) {
            const blocker = rapierWorld.castRay(
                new Rapier.Ray(_hitscanOrigin, _hitscanDirection),
                blockDistance,
                true,
                undefined,
                hitscanBlockGroups,
            )
            if (blocker) return null
        }
        hit.enemy.damage(hit.position, hit.normal)
        return hit.position
    }, [camera, hitscanBlockGroups, rapierWorld])

    useEffect(() => {
        const onEnemyHit = (event: Event) => {
            const detail = (event as CustomEvent<ProjectileHitEnemyDetail>).detail
            const projectileId = getSphereProjectileIdByHandle(detail.projectileHandle)
            if (projectileId) removeProjectile(projectileId)
            recordImpact(detail.position, detail.normal)
        }
        window.addEventListener(PROJECTILE_HIT_ENEMY_EVENT, onEnemyHit)
        return () => window.removeEventListener(PROJECTILE_HIT_ENEMY_EVENT, onEnemyHit)
    }, [recordImpact, removeProjectile])

    const [ammoCount, setAmmoCount] = useState(MAX_AMMO)
    const [isReloading, setIsReloading] = useState(false)
    const shootingInterval = useRef<number>()
    const isPointerDown = useRef(false)
    const ammoCountRef = useRef(MAX_AMMO)
    const isReloadingRef = useRef(false)
    const gamepadState = useGamepad()

    const reload = (force = false) => {
        if (isReloadingRef.current) return
        if (!force && ammoCountRef.current >= MAX_AMMO) return

        isReloadingRef.current = true
        setIsReloading(true)
        window.dispatchEvent(new CustomEvent(PLAYER_WEAPON_RELOAD_EVENT))
    }

    const shootSphere = () => {
        const pointerLocked = document.pointerLockElement !== null || gamepadState.connected
        if (!pointerLocked || isReloadingRef.current) return
        const ammoBeforeShot = ammoCountRef.current
        if (ammoBeforeShot <= 0) {
            reload(true)
            return
        }
        const shouldAutoReload = ammoBeforeShot <= 1

        setAmmoCount((prev) => {
            const newCount = prev - 1
            ammoCountRef.current = newCount
            return Math.max(0, newCount)
        })
        window.dispatchEvent(new CustomEvent(PLAYER_WEAPON_SHOOT_EVENT))
        playShotSound()

        const offset = new THREE.Vector3(
            emitterX,
            emitterY,
            emitterZ
        )
        offset.applyQuaternion(camera.quaternion)

        const position = camera.position.clone().add(offset)

        _shotRotation.set(
            THREE.MathUtils.degToRad(rotX),
            THREE.MathUtils.degToRad(rotY),
            THREE.MathUtils.degToRad(rotZ),
            'XYZ',
        )
        const direction = _localShotDirection
            .set(0, 0, -1)
            .applyEuler(_shotRotation)
            .applyQuaternion(camera.quaternion)
            .normalize()
        const enemyHitPoint = hitscanEnemy(direction)
        if (enemyHitPoint) {
            if (TRAILS_ENABLED) {
                setHitscanTrails((prev) => [
                    ...prev.slice(-3),
                    {
                        id: `hittrail_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        from: position.toArray() as [number, number, number],
                        to: enemyHitPoint,
                        spawnedAt: performance.now(),
                    },
                ])
            }
            if (shouldAutoReload) reload(true)
            return
        }

        setSpheres((prev) => [
            ...prev.slice(-3),
            {
                id: genId(),
                position: position.toArray() as [number, number, number],
                direction: direction.toArray() as [number, number, number],
                radius: sphereRadius,
                spawnedAt: performance.now(),
            },
        ])
        if (shouldAutoReload) reload(true)
    }

    const startShooting = () => {
        isPointerDown.current = true
        shootSphere()
        shootingInterval.current = window.setInterval(shootSphere, FIRE_INTERVAL_MS)
    }

    const stopShooting = () => {
        isPointerDown.current = false
        if (shootingInterval.current) {
            clearInterval(shootingInterval.current)
        }
    }

    useEffect(() => {
        ammoCountRef.current = ammoCount
    }, [ammoCount])

    useEffect(() => {
        isReloadingRef.current = isReloading
    }, [isReloading])

    useEffect(() => {
        const onReloadComplete = () => {
            ammoCountRef.current = MAX_AMMO
            setAmmoCount(MAX_AMMO)
            isReloadingRef.current = false
            setIsReloading(false)
        }
        window.addEventListener(PLAYER_WEAPON_RELOAD_COMPLETE_EVENT, onReloadComplete)
        return () => window.removeEventListener(PLAYER_WEAPON_RELOAD_COMPLETE_EVENT, onReloadComplete)
    }, [])

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== 'KeyR') return
            const pointerLocked = document.pointerLockElement !== null || gamepadState.connected
            if (!pointerLocked) return
            event.preventDefault()
            reload()
        }
        window.addEventListener('pointerdown', startShooting)
        window.addEventListener('pointerup', stopShooting)
        window.addEventListener('keydown', onKeyDown)

        if (gamepadState.buttons.shoot) {
            if (!isPointerDown.current) {
                startShooting()
            }
        } else if (isPointerDown.current) {
            stopShooting()
        }

        return () => {
            window.removeEventListener('pointerdown', startShooting)
            window.removeEventListener('pointerup', stopShooting)
            window.removeEventListener('keydown', onKeyDown)
        }
        // startShooting/stopShooting intencionalmente omitidos: evita re-binds constantes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [camera, emitterX, emitterY, emitterZ, gamepadState.buttons.shoot, hitscanEnemy, rotX, rotY, rotZ])

    useEffect(() => {
        const ammoDisplay = document.getElementById('ammo-display')
        if (ammoDisplay) {
            ammoDisplay.textContent = isReloading ? 'RELOADING...' : `AMMO: ${ammoCount}/${MAX_AMMO}`
        }
    }, [ammoCount, isReloading])

    return (
        <group>
            {spheres.map((entry) => (
                <Projectile
                    key={entry.id}
                    entry={entry}
                    onExpire={removeProjectile}
                    showColliderDebug={showColliders}
                    trailTailFade={trailTailFade}
                    trailWidth={trailWidth}
                    trailTaper={trailTaper}
                    lifeEndFade={lifeEndFade}
                    onRecordImpact={recordImpact}
                />
            ))}
            {TRAILS_ENABLED && hitscanTrails.map((trail) => (
                <HitscanTrail
                    key={trail.id}
                    item={trail}
                    onDone={() => setHitscanTrails((prev) => prev.filter((x) => x.id !== trail.id))}
                />
            ))}
            {impacts.map((imp) => (
                <SurfaceImpactFx
                    key={imp.id}
                    position={imp.pos}
                    normal={imp.nrm}
                    onDone={() => removeImpact(imp.id)}
                />
            ))}
        </group>
    )
}
