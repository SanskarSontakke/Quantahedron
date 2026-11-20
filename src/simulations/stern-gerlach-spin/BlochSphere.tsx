'use client';

/**
 * BlochSphere.tsx — the synchronised 3D spinor viewer.
 *
 * @react-three/fiber + drei OrbitControls, mounted only through
 * `next/dynamic(..., { ssr: false })` from Canvas.tsx, so three.js is never
 * evaluated on the server. Nothing here keeps per-frame React state: the bench's
 * `useAnimationClock` writes `liveSpin` and `useFrame` copies it into transforms.
 *
 * What is drawn, all of it computed by `@/engine/physics/blochSpin`:
 *  • the prepared |χ⟩ = cos(θ/2)|↑⟩ + e^{iφ}sin(θ/2)|↓⟩ as a grey arrow,
 *  • the spinor actually in the beam right now (Larmor-precessed) as a blue arrow
 *    plus its latitude circle — the precession orbit about the guide field ẑ,
 *  • one double-headed arrow per analyser: its ± measurement directions,
 *  • a fading trail of the state vector,
 *  • click anywhere on the sphere to collapse |χ⟩ onto that direction.
 */

import { useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { BufferAttribute, BufferGeometry, Group, Points } from 'three';
import { blochVector, precess, v3, vNormalize, type Vec3 } from '@/engine/physics/blochSpin';
import { useSimStore } from '@/store/useSimStore';
import type { SimSlug } from '@/simulations/types';
import { buildModel } from './chain';
import { liveSpin, TRAIL_MAX } from './live';

const ACCENT = '#60a5fa';
const STAGE_COLORS = ['#5eead4', '#fbbf24', '#c084fc'];
const AXIS_COLORS = ['#fb7185', '#fbbf24', '#5eead4'];
const AXIS_LABELS = ['x̂', 'ŷ', 'ẑ'];

/** Quaternion taking local +Y onto the unit direction `u`. */
function quatFromY(u: Vec3): [number, number, number, number] {
  const vx = u[2];
  const vz = -u[0];
  const s = 1 + u[1];
  if (s < 1e-9) return [1, 0, 0, 0];
  const n = Math.hypot(vx, 0, vz, s) || 1;
  return [vx / n, 0, vz / n, s / n];
}

interface ArrowProps {
  dir: Vec3;
  color: string;
  radius?: number;
  head?: number;
  opacity?: number;
}

function Arrow({ dir, color, radius = 0.015, head = 0.13, opacity = 1 }: ArrowProps) {
  const len = Math.max(1e-4, Math.hypot(dir[0], dir[1], dir[2]));
  const u: Vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  const q = quatFromY(u);
  const shaft = Math.max(1e-3, len - head);
  return (
    <group quaternion={q}>
      <mesh position={[0, shaft / 2, 0]}>
        <cylinderGeometry args={[radius, radius, shaft, 10]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
      <mesh position={[0, shaft + head / 2, 0]}>
        <coneGeometry args={[radius * 3.4, head, 12]} />
        <meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} />
      </mesh>
    </group>
  );
}

function Scene() {
  const slug: SimSlug = 'stern-gerlach-spin';
  const params = useSimStore((s) => s.params[slug]);
  const setParams = useSimStore((s) => s.setParams);
  const model = useMemo(() => buildModel(params), [params]);

  const liveRef = useRef<Group>(null);
  const ringRef = useRef<Group>(null);
  const ghostRef = useRef<Group>(null);
  const pointsRef = useRef<Points>(null);
  const geomRef = useRef<BufferGeometry>(null);
  const attrRef = useRef<BufferAttribute>(null);
  const trail = useMemo(() => new Float32Array(TRAIL_MAX * 3), []);

  useFrame(() => {
    const b = liveSpin.bloch;
    const g = liveRef.current;
    if (g) {
      const len = Math.min(1, Math.hypot(b[0], b[1], b[2]));
      const u: Vec3 = len > 1e-6 ? [b[0] / len, b[1] / len, b[2] / len] : v3(0, 1, 0);
      g.quaternion.set(...quatFromY(u));
      g.scale.setScalar(Math.max(1e-3, len));
    }
    const ring = ringRef.current;
    if (ring) {
      // Latitude circle of the precessing vector: polar angle θ from ⟨σz⟩.
      const rho = Math.hypot(b[0], b[1]);
      ring.position.set(0, 0, b[2]);
      ring.scale.set(Math.max(1e-3, rho), Math.max(1e-3, rho), 1);
      ring.visible = rho > 0.02;
    }
    const gh = ghostRef.current;
    if (gh) {
      const p = model.bloch;
      const len = Math.max(1e-4, Math.hypot(p[0], p[1], p[2]));
      gh.quaternion.set(...quatFromY([p[0] / len, p[1] / len, p[2] / len]));
    }
    const attr = attrRef.current;
    const geom = geomRef.current;
    if (attr && geom) {
      const n = liveSpin.trailLen;
      for (let i = 0; i < n; i++) {
        const src = ((liveSpin.trailHead - n + i + TRAIL_MAX * 2) % TRAIL_MAX) * 3;
        const dst = i * 3;
        trail[dst] = liveSpin.trail[src];
        trail[dst + 1] = liveSpin.trail[src + 1];
        trail[dst + 2] = liveSpin.trail[src + 2];
      }
      attr.needsUpdate = true;
      geom.setDrawRange(0, n);
    }
  });

  const collapse = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return;
    e.stopPropagation();
    const n = vNormalize(v3(e.point.x, e.point.y, e.point.z));
    const theta = Math.acos(Math.max(-1, Math.min(1, n[2])));
    const phi = Math.atan2(n[1], n[0]);
    liveSpin.flash = typeof performance === 'undefined' ? 0 : performance.now() / 1000;
    liveSpin.bloch = blochVector(precess(model.input, v3(0, 0, 1), liveSpin.turns * Math.PI * 2));
    setParams(slug, {
      spinTheta: (theta * 180) / Math.PI,
      spinPhi: (((phi * 180) / Math.PI) + 360) % 360,
    });
  };

  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 32, 20]} />
        <meshBasicMaterial color="#94a3b8" wireframe transparent opacity={0.09} depthWrite={false} />
      </mesh>
      {/* invisible pick shell for click-to-collapse */}
      <mesh onClick={collapse}>
        <sphereGeometry args={[1.02, 24, 16]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>
      <mesh>
        <torusGeometry args={[1, 0.0035, 6, 96]} />
        <meshBasicMaterial color="#94a3b8" transparent opacity={0.35} />
      </mesh>

      {AXIS_LABELS.map((lab, i) => {
        const d: Vec3 = i === 0 ? v3(1, 0, 0) : i === 1 ? v3(0, 1, 0) : v3(0, 0, 1);
        return (
          <group key={lab}>
            <Arrow dir={d} color={AXIS_COLORS[i]} radius={0.006} head={0.07} opacity={0.5} />
            <Arrow dir={[-d[0], -d[1], -d[2]]} color={AXIS_COLORS[i]} radius={0.004} head={0.05} opacity={0.22} />
          </group>
        );
      })}

      {model.stages.map((st, i) => (
        <group key={`sg${i}`}>
          <Arrow dir={st.axis} color={STAGE_COLORS[i % 3]} radius={0.011} head={0.11} opacity={st.blockUp ? 0.25 : 0.95} />
          <Arrow
            dir={[-st.axis[0], -st.axis[1], -st.axis[2]]}
            color={STAGE_COLORS[i % 3]}
            radius={0.009}
            head={0.09}
            opacity={st.blockDown ? 0.25 : 0.7}
          />
        </group>
      ))}

      <group ref={ringRef}>
        <mesh>
          <torusGeometry args={[1, 0.006, 6, 80]} />
          <meshBasicMaterial color={ACCENT} transparent opacity={0.5} />
        </mesh>
      </group>

      <group ref={ghostRef}>
        <Arrow dir={v3(0, 1, 0)} color="#e2eeec" radius={0.009} head={0.09} opacity={0.35} />
      </group>

      <group ref={liveRef}>
        <Arrow dir={v3(0, 1, 0)} color={ACCENT} radius={0.017} head={0.15} />
        <mesh position={[0, 1, 0]}>
          <sphereGeometry args={[0.03, 14, 10]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
      </group>

      <points ref={pointsRef}>
        <bufferGeometry ref={geomRef}>
          <bufferAttribute ref={attrRef} attach="attributes-position" args={[trail, 3]} />
        </bufferGeometry>
        <pointsMaterial size={0.028} color={ACCENT} transparent opacity={0.45} sizeAttenuation depthWrite={false} />
      </points>

      <OrbitControls enablePan={false} minDistance={1.6} maxDistance={5} rotateSpeed={0.7} zoomSpeed={0.6} />
    </>
  );
}

export default function BlochSphere({ slug }: { slug: SimSlug }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [1.8, 1.5, 2.1], fov: 42 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
    >
      <Scene key={slug} />
    </Canvas>
  );
}
