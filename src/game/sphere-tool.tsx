import { ActiveEvents } from '@dimforge/rapier3d-compat'
import { useThree, useFrame } from '@react-three/fiber'
import { BallCollider, RigidBody, type CollisionEnterPayload, type RapierRigidBody } from '@react-three/rapier'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useControls } from 'leva'
import { useGamepad } from '../common/hooks/use-gamepad'
import * as THREE from 'three'
import { projectileCollision } from './physics-collision-filters'
import { SurfaceImpactFx } from './projectile-surface-impact'
import { registerSphereProjectileHandle, unregisterSphereProjectileHandle } from './sphere-projectile-handles'

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
/** Reuso: boca da arma = olho + offset no espaço local da câmera (igual `shootSphere`). */
const _muzzleOffsetLocal = new THREE.Vector3()

const TRAIL_TUBE_RADIAL = 6
const TWO_PI = Math.PI * 2

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
export const PROJECTILE_LIFETIME_MS = 200
/** Máx. eventos de impacto com superfície por projétil (ex.: ricochete). */
const MAX_IMPACTS_PER_BULLET = 12
const SHOOT_FORCE = 250
export const TRAIL_MAX_POINTS = 24

/** Cor da cauda / ponta (0–1) — ajuste para tom quente; sem shading (Basic + unlit, ver material). */
const TRAIL_COLOR_TAIL: [number, number, number] = [1, 1, 1]
const TRAIL_COLOR_HEAD: [number, number, number] = [1, 1, 1]

// ═══ Muzzle flash (só visual, sem colisão) — mude `mode` / cores aqui ═══
const MUZZLE_FLASH = {
    /** 'solid' = um anel; 'gradient' = anel claro (core) + anel borda (edge) */
    mode: 'gradient' as 'solid' | 'gradient',
    colorSolid: 0xffd040,
    colorCore: 0xffffff,
    colorEdge: 0xff8800,
    durationMs: 78,
    /** escala do raio do anel (animação) */
    scaleMax: 0.82,
} as const

/**
 * Espaço local da câmera (m). Mesmos x/y; **z** negativo = sentido da mira; z positivo = atrás (evitar).
 * Se ajustou com +2,5, troque a **carga** sinalizando: mantém 2,5 em módulo com **−** em vez de pôr
 * “profundidade” na reta de `getWorldDirection` a partir do olho (distorce o bico).
 */
const EMITTER_OFFSET_FROM_CAMERA = {
    x: 0.14,
    y: -0.3,
    z: -1.6,
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
        const lifeOp = computeLifeOpacity(spawnedAt, PROJECTILE_LIFETIME_MS, lifeEndFade)
        mat.opacity = TRAIL_OPACITY_BASE * lifeOp

        const t = rigidBodyRef.current?.translation()
        if (!t) {
            return
        }
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
            const tailThin = 1 - tpr * (1 - along)
            const rTube = rBase * Math.max(0.01, tailThin)
            const baseR = TRAIL_COLOR_TAIL[0] + (TRAIL_COLOR_HEAD[0] - TRAIL_COLOR_TAIL[0]) * along
            const baseG = TRAIL_COLOR_TAIL[1] + (TRAIL_COLOR_HEAD[1] - TRAIL_COLOR_TAIL[1]) * along
            const baseB = TRAIL_COLOR_TAIL[2] + (TRAIL_COLOR_HEAD[2] - TRAIL_COLOR_TAIL[2]) * along
            const tailBlend = along * along
            const fade = 1 - (1 - tailBlend) * tailFade
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

type MuzzleFlashItem = { id: string; t0: number }

/**
 * Pisca na boca da arma, sem colisor. Posição a cada frame = câmera + `EMITTER_OFFSET_FROM_CAMERA`
 * (fica colado na “arma”, não no ponto fixo de onde a bala nasceu no mundo). Cores: `MUZZLE_FLASH`.
 */
function MuzzleFlashFx({ item, onDone }: { item: MuzzleFlashItem; onDone: () => void }) {
    const camera = useThree((s) => s.camera)
    const gRef = useRef<THREE.Group>(null)
    const innerRef = useRef<THREE.Mesh>(null)
    const outerRef = useRef<THREE.Mesh>(null)
    const solidRef = useRef<THREE.Mesh>(null)
    const done = useRef(false)
    const M = MUZZLE_FLASH

    const syncMuzzleToCamera = useCallback(() => {
        const g = gRef.current
        if (!g) return
        _muzzleOffsetLocal.set(
            EMITTER_OFFSET_FROM_CAMERA.x,
            EMITTER_OFFSET_FROM_CAMERA.y,
            EMITTER_OFFSET_FROM_CAMERA.z
        )
        _muzzleOffsetLocal.applyQuaternion(camera.quaternion)
        g.position.copy(camera.position).add(_muzzleOffsetLocal)
        g.quaternion.copy(camera.quaternion)
    }, [camera])

    useLayoutEffect(() => {
        syncMuzzleToCamera()
    }, [syncMuzzleToCamera, item.id])

    useFrame(() => {
        if (done.current) return
        const u = (performance.now() - item.t0) / M.durationMs
        if (u >= 1) {
            done.current = true
            onDone()
            return
        }
        syncMuzzleToCamera()
        const g = gRef.current
        const pulse = 1 - (1 - u) * (1 - u)
        const s = 0.12 + M.scaleMax * (0.35 + 0.65 * pulse)
        const op = 0.92 * (1 - u) * (1 - u)
        g?.scale.setScalar(s)
        if (M.mode === 'gradient') {
            if (innerRef.current) (innerRef.current.material as THREE.MeshBasicMaterial).opacity = op
            if (outerRef.current) (outerRef.current.material as THREE.MeshBasicMaterial).opacity = op * 0.88
        } else if (solidRef.current) {
            (solidRef.current.material as THREE.MeshBasicMaterial).opacity = op
        }
    })

    const matProps = {
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        blending: THREE.AdditiveBlending,
    } as const

    if (M.mode === 'solid') {
        return (
            <group ref={gRef}>
                <mesh ref={solidRef}>
                    <ringGeometry args={[0.04, 0.38, 32]} />
                    <meshBasicMaterial color={M.colorSolid} opacity={0.9} {...matProps} />
                </mesh>
            </group>
        )
    }
    return (
        <group ref={gRef}>
            <mesh ref={innerRef}>
                <ringGeometry args={[0.02, 0.18, 24]} />
                <meshBasicMaterial color={M.colorCore} opacity={0.9} {...matProps} />
            </mesh>
            <mesh ref={outerRef}>
                <ringGeometry args={[0.1, 0.42, 32]} />
                <meshBasicMaterial color={M.colorEdge} opacity={0.75} {...matProps} />
            </mesh>
        </group>
    )
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
        [onRecordImpact]
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
            registerSphereProjectileHandle(handle)
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
                    solverGroups={projectileCollision()}
                    activeEvents={ActiveEvents.COLLISION_EVENTS}
                />
                {showColliderDebug && (
                    <mesh ref={debugRef}>
                        <sphereGeometry args={[radius, 20, 20]} />
                        <meshBasicMaterial color="#4ade80" wireframe transparent opacity={0.6} />
                    </mesh>
                )}
            </RigidBody>
            <BulletTrail
                rigidBodyRef={rb}
                spawnPosition={position}
                tailFade={trailTailFade}
                trailWidth={trailWidth}
                trailTaper={trailTaper}
                lifeEndFade={lifeEndFade}
                spawnedAt={spawnedAt}
            />
        </group>
    )
}

function genId(): string {
    return `proj_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`
}

export const SphereTool = () => {
    const sphereRadius = PROJECTILE_SPHERE_RADIUS
    const MAX_AMMO = 50

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

    const camera = useThree((s) => s.camera)
    const [spheres, setSpheres] = useState<SphereEntry[]>([])
    const [muzzle, setMuzzle] = useState<MuzzleFlashItem[]>([])
    const [impacts, setImpacts] = useState<SurfaceImpactItem[]>([])

    const removeProjectile = useCallback((projectileId: string) => {
        setSpheres((prev) => prev.filter((s) => s.id !== projectileId))
    }, [])

    const recordImpact = useCallback((p: [number, number, number], n: [number, number, number]) => {
        setImpacts((prev) => [
            ...prev,
            { id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, pos: p, nrm: n },
        ])
    }, [])

    const removeImpact = useCallback((impactId: string) => {
        setImpacts((prev) => prev.filter((x) => x.id !== impactId))
    }, [])

    const [ammoCount, setAmmoCount] = useState(MAX_AMMO)
    const [isReloading, setIsReloading] = useState(false)
    const shootingInterval = useRef<number>()
    const isPointerDown = useRef(false)
    const gamepadState = useGamepad()

    const reload = () => {
        if (isReloading) return

        setIsReloading(true)
        setTimeout(() => {
            setAmmoCount(MAX_AMMO)
            setIsReloading(false)
        }, 1000)
    }

    const shootSphere = () => {
        const pointerLocked = document.pointerLockElement !== null || gamepadState.connected
        if (!pointerLocked || isReloading || ammoCount <= 0) return

        setAmmoCount((prev) => {
            const newCount = prev - 1
            if (newCount <= 0) {
                reload()
            }
            return newCount
        })

        const direction = camera.getWorldDirection(new THREE.Vector3())

        const offset = new THREE.Vector3(
            EMITTER_OFFSET_FROM_CAMERA.x,
            EMITTER_OFFSET_FROM_CAMERA.y,
            EMITTER_OFFSET_FROM_CAMERA.z
        )
        offset.applyQuaternion(camera.quaternion)

        const position = camera.position.clone().add(offset)

        direction.normalize()

        setSpheres((prev) => [
            ...prev,
            {
                id: genId(),
                position: position.toArray() as [number, number, number],
                direction: direction.toArray() as [number, number, number],
                radius: sphereRadius,
                spawnedAt: performance.now(),
            },
        ])
        setMuzzle((prev) => [
            ...prev,
            { id: `muz_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, t0: performance.now() },
        ])
    }

    const startShooting = () => {
        isPointerDown.current = true
        shootSphere()
        shootingInterval.current = window.setInterval(shootSphere, 80)
    }

    const stopShooting = () => {
        isPointerDown.current = false
        if (shootingInterval.current) {
            clearInterval(shootingInterval.current)
        }
    }

    useEffect(() => {
        window.addEventListener('pointerdown', startShooting)
        window.addEventListener('pointerup', stopShooting)

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
        }
        // startShooting/stopShooting intencionalmente omitidos: evita re-binds constantes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [camera, gamepadState.buttons.shoot])

    useEffect(() => {
        const ammoDisplay = document.getElementById('ammo-display')
        if (ammoDisplay) {
            ammoDisplay.textContent = isReloading ? 'RELOADING...' : `AMMO: ${ammoCount}/${MAX_AMMO}`
        }
    }, [ammoCount, isReloading])

    return (
        <group>
            {muzzle.map((m) => (
                <MuzzleFlashFx
                    key={m.id}
                    item={m}
                    onDone={() => setMuzzle((prev) => prev.filter((x) => x.id !== m.id))}
                />
            ))}
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
