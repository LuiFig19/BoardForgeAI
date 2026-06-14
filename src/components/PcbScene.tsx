import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Float, Grid, Line, PerspectiveCamera, RoundedBox, Text } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'
import { useReducedMotion } from 'framer-motion'

type PcbSceneProps = {
  progress?: number
  compact?: boolean
}

const traces = [
  [
    [-1.45, 0.06, 0.24],
    [-0.55, 0.06, 0.24],
    [-0.2, 0.06, -0.18],
    [0.62, 0.06, -0.18],
  ],
  [
    [-1.1, 0.07, -0.55],
    [-0.15, 0.07, -0.55],
    [0.28, 0.07, 0.42],
    [1.15, 0.07, 0.42],
  ],
  [
    [0.72, 0.08, -0.56],
    [0.3, 0.08, -0.1],
    [-0.38, 0.08, -0.1],
    [-0.8, 0.08, 0.58],
  ],
] as const

function Chip({ x, z, label, visible }: { x: number; z: number; label: string; visible: boolean }) {
  const ref = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = visible ? 0.17 + Math.sin(clock.elapsedTime * 2 + x) * 0.008 : 1.2
  })

  return (
    <group position={[x, 0.16, z]} visible={visible} ref={ref}>
      <RoundedBox args={[0.52, 0.13, 0.44]} radius={0.025} smoothness={4} castShadow>
        <meshStandardMaterial color="#171c22" metalness={0.18} roughness={0.42} />
      </RoundedBox>
      {Array.from({ length: 10 }).map((_, index) => (
        <group key={index}>
          <mesh position={[-0.3, -0.048, -0.2 + index * 0.044]}>
            <boxGeometry args={[0.065, 0.022, 0.024]} />
            <meshStandardMaterial color="#d9dde2" metalness={0.86} roughness={0.22} />
          </mesh>
          <mesh position={[0.3, -0.048, -0.2 + index * 0.044]}>
            <boxGeometry args={[0.065, 0.022, 0.024]} />
            <meshStandardMaterial color="#d9dde2" metalness={0.86} roughness={0.22} />
          </mesh>
        </group>
      ))}
      <Text position={[0, 0.083, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.075} color="#f8fafc" anchorX="center">
        {label}
      </Text>
    </group>
  )
}

function Passive({ x, z, color = '#c9b08f', visible }: { x: number; z: number; color?: string; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.14 : 0.72, z]} visible={visible}>
      <mesh castShadow>
        <boxGeometry args={[0.22, 0.055, 0.11]} />
        <meshStandardMaterial color={color} roughness={0.42} metalness={0.12} />
      </mesh>
      <mesh position={[-0.13, -0.004, 0]}>
        <boxGeometry args={[0.045, 0.025, 0.115]} />
        <meshStandardMaterial color="#d7dce2" metalness={0.82} roughness={0.2} />
      </mesh>
      <mesh position={[0.13, -0.004, 0]}>
        <boxGeometry args={[0.045, 0.025, 0.115]} />
        <meshStandardMaterial color="#d7dce2" metalness={0.82} roughness={0.2} />
      </mesh>
    </group>
  )
}

function EdgeConnector({ x, z, label, visible }: { x: number; z: number; label: string; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.2 : 0.95, z]} visible={visible}>
      <RoundedBox args={[0.62, 0.24, 0.42]} radius={0.03} smoothness={4} castShadow>
        <meshStandardMaterial color="#cfd5dc" metalness={0.72} roughness={0.24} />
      </RoundedBox>
      <Text position={[0, 0.135, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.065} color="#111827" anchorX="center">
        {label}
      </Text>
    </group>
  )
}

function PinHeader({ x, z, visible }: { x: number; z: number; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.18 : 0.9, z]} visible={visible}>
      {Array.from({ length: 8 }).map((_, index) => (
        <group key={index} position={[-0.42 + index * 0.12, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.032, 0.34, 0.032]} />
            <meshStandardMaterial color="#d1a64b" metalness={0.78} roughness={0.25} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <boxGeometry args={[0.07, 0.07, 0.07]} />
            <meshStandardMaterial color="#15191f" roughness={0.38} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function BoardAssembly({ progress = 0.4, compact = false }: PcbSceneProps) {
  const group = useRef<Group>(null)
  const reduced = useReducedMotion()
  const clamped = Math.max(0, Math.min(1, progress))
  const components = Math.min(1, Math.max(0, (clamped - 0.25) / 0.25))
  const routeGlow = Math.min(1, Math.max(0, (clamped - 0.45) / 0.25))
  const scanner = Math.min(1, Math.max(0, (clamped - 0.62) / 0.2))
  const packageStep = clamped > 0.82

  useFrame(({ clock }) => {
    if (!group.current || reduced) return
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.28) * 0.11 + clamped * 0.16
    group.current.rotation.x = -0.1 + Math.sin(clock.elapsedTime * 0.24) * 0.02
  })

  const vias = useMemo(
    () =>
      Array.from({ length: 30 }, (_, index) => ({
        x: -1.35 + (index % 10) * 0.3,
        z: -0.62 + Math.floor(index / 10) * 0.55,
      })),
    [],
  )

  return (
    <Float speed={reduced ? 0 : 1.4} rotationIntensity={0.1} floatIntensity={compact ? 0.25 : 0.6}>
      <group ref={group} scale={compact ? 0.72 : 0.9}>
        <mesh position={[0, 0, 0]} receiveShadow>
          <boxGeometry args={[3.4, 0.11, 1.82]} />
          <meshPhysicalMaterial color="#1f8f3a" roughness={0.34} metalness={0.03} clearcoat={0.45} clearcoatRoughness={0.22} />
        </mesh>
        <mesh position={[0, 0.061, 0]}>
          <boxGeometry args={[3.24, 0.008, 1.66]} />
          <meshStandardMaterial color="#2bae54" transparent opacity={0.28} roughness={0.68} />
        </mesh>
        {vias.map((via) => (
          <mesh key={`${via.x}-${via.z}`} position={[via.x, 0.078, via.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.032, 0.032, 0.012, 24]} />
            <meshStandardMaterial color="#d2a443" metalness={0.82} roughness={0.2} />
          </mesh>
        ))}
        <Chip x={-0.18} z={0.03} label="U1" visible={components > 0.05} />
        <EdgeConnector x={-1.36} z={0.42} label="USB-C" visible={components > 0.18} />
        <EdgeConnector x={1.25} z={0.16} label="RJ45" visible={components > 0.34} />
        <Chip x={0.72} z={-0.46} label="U2" visible={components > 0.45} />
        <PinHeader x={0.46} z={0.72} visible={components > 0.55} />
        <Passive x={-0.62} z={-0.32} visible={components > 0.3} />
        <Passive x={-0.42} z={-0.38} color="#b78753" visible={components > 0.35} />
        <Passive x={0.08} z={-0.44} visible={components > 0.42} />
        <Passive x={0.34} z={-0.28} color="#b78753" visible={components > 0.48} />
        <Passive x={0.98} z={0.52} visible={components > 0.62} />
        {traces.map((points, index) => (
          <Line
            key={index}
            points={points.map(([x, y, z]) => [x, y + 0.035, z])}
            color={index === 1 ? '#d7aa48' : '#c87934'}
            lineWidth={2 + routeGlow * 2.4}
            transparent
            opacity={0.28 + routeGlow * 0.72}
          />
        ))}
        {scanner > 0 && (
          <mesh position={[-1.65 + scanner * 3.3, 0.42, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[1.9, 0.018, 0.03]} />
            <meshStandardMaterial color="#f9ff8b" emissive="#f9ff8b" emissiveIntensity={0.7} transparent opacity={0.35} />
          </mesh>
        )}
        {packageStep && (
          <group position={[1.75, 0.35, -0.15]} rotation={[0.2, -0.45, 0.05]}>
            <mesh>
              <boxGeometry args={[0.55, 0.44, 0.2]} />
              <meshStandardMaterial color="#273342" emissive="#22d3ee" emissiveIntensity={0.2} />
            </mesh>
            <Text position={[0, 0.24, 0.11]} fontSize={0.1} color="#ecfeff" anchorX="center">
              FAB ZIP
            </Text>
          </group>
        )}
      </group>
    </Float>
  )
}

export function PcbScene(props: PcbSceneProps) {
  return (
    <div className="scene-shell">
      <Canvas shadows dpr={[1, 1.6]}>
        <PerspectiveCamera makeDefault position={[0, 4.8, 4.85]} rotation={[-0.78, 0, 0]} fov={31} />
        <color attach="background" args={['#2f3437']} />
        <ambientLight intensity={0.68} />
        <directionalLight position={[2.8, 4.4, 3.2]} intensity={3.8} castShadow />
        <pointLight position={[-3, 2, -2]} intensity={6} color="#d9f99d" />
        <Grid position={[0, -0.28, 0]} args={[6, 4]} cellSize={0.28} cellThickness={0.25} cellColor="#565f64" sectionColor="#7b858c" fadeDistance={7} fadeStrength={1.2} />
        <Suspense fallback={null}>
          <BoardAssembly {...props} />
          <ContactShadows position={[0, -0.18, 0]} opacity={0.38} scale={6} blur={2.2} />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
