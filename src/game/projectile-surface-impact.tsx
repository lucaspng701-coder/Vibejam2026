import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

// ═══════════════════════════════════════════════════════════════════════════
// Impacto na superfície — ajuste tamanho, cor e velocidade aqui.
// (O efeito termina após a maior duração: faíscas podem ser > vida da bala.)
// ═══════════════════════════════════════════════════════════════════════════
const IMPACT = {
    /** Anel: geometria (outer ≈ "raio" do buraco no anel, em unidades de mundo) */
    ring: {
        inner: 0.02,
        outer: 0.55,
        segments: 32,
        /** Cor principal do anel: hex 0xRRGGBB (ex.: 0xffcc22 amarelo) */
        color: 0xffcc22,
        /** ms — anima expandir + sumir; pode ser < ou > do que a bala vive */
        durationMs: 230,
        /** Escala animada: começa em scaleMin, termina em scaleMax (abertura) */
        scaleMin: 0.9,
        scaleMax: 2.6,
    },
    /** Partículas: duram o próprio "voo"; independente do resto do jogo */
    sparks: {
        count: 10,
        /** ms — muitas vezes > ring.durationMs: faíscas continuam após o anel */
        durationMs: 305,
        /** Tamanho de cada ponto (sprite) */
        pointSize: 0.05,
        /**
         * “Distância” máx. que cada faísca percorre (0–1) — padrão ~0,35
         * menor = viagem mais curta; combine com `durationMs` para mais lento
         */
        travelScale: 1.5,
    },
} as const

// --- derivados ---
const { ring: R, sparks: S } = IMPACT
const IMPACT_FX_MAX_MS = Math.max(R.durationMs, S.durationMs)
const RING_COLOR = new THREE.Color(R.color)

const _b1 = new THREE.Vector3()
const _b2 = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _ax = new THREE.Vector3(0, 0, 1)
const _v = new THREE.Vector3(0, 1, 0)

type SparkV = { sx: number; sy: number; sn: number }

type SurfaceImpactFxProps = {
    position: [number, number, number]
    normal: [number, number, number]
    onDone: () => void
}

function buildTangentBasis(n: THREE.Vector3) {
    const t = _v
    t.set(0, 1, 0)
    if (Math.abs(n.dot(t)) > 0.9) t.set(1, 0, 0)
    _b1.copy(n).cross(t)
    if (_b1.lengthSq() < 1e-8) {
        t.set(0, 0, 1)
        _b1.copy(n).cross(t)
    }
    _b1.normalize()
    _b2.copy(n).cross(_b1).normalize()
}

/**
 * Anel + faíscas (Points) alinhado à normal da superfície; amarelo flat / sem shading além de MeshBasic.
 */
export function SurfaceImpactFx({ position, normal, onDone }: SurfaceImpactFxProps) {
    const group = useRef<THREE.Group>(null)
    const ring = useRef<THREE.Mesh>(null)
    const points = useRef<THREE.Points>(null)
    const t0 = useRef(performance.now())
    const done = useRef(false)
    const sparkData = useRef<SparkV[]>([])

    const n = useMemo(() => {
        return new THREE.Vector3(normal[0], normal[1], normal[2]).normalize()
    }, [normal])

    const p = useMemo(
        () => new THREE.Vector3(position[0], position[1], position[2]).addScaledVector(n, 0.002),
        [position, n]
    )

    const quat = useMemo(() => {
        const q = new THREE.Quaternion()
        q.setFromUnitVectors(_ax, n)
        return q
    }, [n])

    const travel = S.travelScale

    const geom = useMemo(() => {
        buildTangentBasis(n)
        const g = new THREE.BufferGeometry()
        const count = S.count
        const pos = new Float32Array(count * 3)
        const col = new Float32Array(count * 3)
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        const svel: SparkV[] = []
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4
            const o = 0.4 + Math.random() * 0.9
            const out = 0.2 + Math.random() * 0.45
            _dir
                .copy(_b1)
                .multiplyScalar(Math.cos(a) * o * travel)
                .addScaledVector(_b2, Math.sin(a) * o * travel)
                .addScaledVector(n, out * travel)
            svel.push({ sx: _dir.x, sy: _dir.y, sn: _dir.z })
            pos[i * 3] = 0
            pos[i * 3 + 1] = 0
            pos[i * 3 + 2] = 0
            col[i * 3] = 1
            col[i * 3 + 1] = 0.9
            col[i * 3 + 2] = 0.2
        }
        sparkData.current = svel
        return g
    }, [n, travel])

    useFrame(() => {
        if (done.current) return
        const tMs = performance.now() - t0.current
        if (tMs >= IMPACT_FX_MAX_MS) {
            done.current = true
            onDone()
            return
        }
        // Anel: u normalizado pela duração só dele; depois fica invisível
        const uRing = Math.min(1, tMs / R.durationMs)
        const eR = 1 - uRing
        if (group.current) {
            const s = R.scaleMin + (R.scaleMax - R.scaleMin) * (uRing * uRing)
            group.current.scale.setScalar(s)
        }
        if (ring.current) {
            const mat = ring.current.material as THREE.MeshBasicMaterial
            if (uRing >= 1) {
                mat.opacity = 0
            } else {
                mat.opacity = 0.92 * (eR * eR)
            }
        }
        // Faíscas: eixo de tempo separado, pode ainda andar com anel já morto
        const uSpark = Math.min(1, tMs / S.durationMs)
        if (points.current) {
            const pos = geom.getAttribute('position') as THREE.BufferAttribute
            const col = geom.getAttribute('color') as THREE.BufferAttribute
            const pa = pos.array as Float32Array
            const ca = col.array as Float32Array
            const svel = sparkData.current
            for (let i = 0; i < svel.length; i++) {
                const sv = svel[i]!
                pa[i * 3] = sv.sx * uSpark
                pa[i * 3 + 1] = sv.sy * uSpark
                pa[i * 3 + 2] = sv.sn * uSpark
                const w = 1 - uSpark
                ca[i * 3] = 1
                ca[i * 3 + 1] = 0.7 + 0.25 * w
                ca[i * 3 + 2] = 0.1 + 0.2 * w
            }
            pos.needsUpdate = true
        }
    })

    return (
        <>
            <group position={p.toArray() as [number, number, number]}>
                <points ref={points} geometry={geom}>
                    <pointsMaterial
                        size={S.pointSize}
                        sizeAttenuation
                        transparent
                        opacity={0.95}
                        depthWrite={false}
                        toneMapped={false}
                        vertexColors
                        blending={THREE.AdditiveBlending}
                    />
                </points>
            </group>
            <group position={p.toArray() as [number, number, number]} quaternion={quat}>
                <group ref={group} scale={1}>
                    <mesh ref={ring}>
                        <ringGeometry args={[R.inner, R.outer, R.segments]} />
                        <meshBasicMaterial
                            color={RING_COLOR}
                            transparent
                            opacity={0.95}
                            depthWrite={false}
                            side={THREE.DoubleSide}
                            toneMapped={false}
                            blending={THREE.AdditiveBlending}
                        />
                    </mesh>
                </group>
            </group>
        </>
    )
}
