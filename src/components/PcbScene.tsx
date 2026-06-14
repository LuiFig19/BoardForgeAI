import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Float, Grid, Line, PerspectiveCamera, RoundedBox, Text } from '@react-three/drei'
import { Suspense, useMemo, useRef } from 'react'
import { DoubleSide, Path, Shape } from 'three'
import type { Group, Mesh } from 'three'
import { useReducedMotion } from 'framer-motion'

type PcbSceneProps = {
  progress?: number
  compact?: boolean
}

type PassivePart = {
  id: string
  x: number
  z: number
  rotation?: number
  color?: string
}

const traces = [
  [
    [-1.42, 0.09, 0.12],
    [-0.82, 0.09, 0.12],
    [-0.48, 0.09, -0.16],
    [0.08, 0.09, -0.16],
    [0.46, 0.09, -0.42],
  ],
  [
    [-1.18, 0.092, -0.48],
    [-0.52, 0.092, -0.48],
    [-0.18, 0.092, -0.02],
    [0.68, 0.092, -0.02],
    [1.32, 0.092, 0.22],
  ],
  [
    [0.2, 0.094, 0.56],
    [0.2, 0.094, 0.2],
    [0.58, 0.094, 0.2],
    [0.98, 0.094, -0.28],
  ],
  [
    [-0.1, 0.096, 0.64],
    [-0.1, 0.096, 0.25],
    [-0.62, 0.096, 0.25],
    [-0.92, 0.096, 0.52],
  ],
] as const

const passiveParts: PassivePart[] = [
  { id: 'C1', x: -0.78, z: -0.28, rotation: 0 },
  { id: 'C2', x: -0.58, z: -0.34, rotation: 0, color: '#b98c62' },
  { id: 'R1', x: -0.34, z: -0.46, rotation: 0 },
  { id: 'R2', x: 0.08, z: -0.48, rotation: 0, color: '#b98c62' },
  { id: 'C3', x: 0.38, z: -0.3, rotation: 90 },
  { id: 'R3', x: 0.72, z: -0.36, rotation: 90 },
  { id: 'C4', x: 1.12, z: -0.05, rotation: 0 },
  { id: 'R4', x: 1.26, z: 0.16, rotation: 90, color: '#b98c62' },
  { id: 'C5', x: -1.22, z: 0.46, rotation: 0 },
  { id: 'R5', x: -0.96, z: 0.5, rotation: 0, color: '#b98c62' },
  { id: 'C6', x: 0.52, z: 0.56, rotation: 0 },
  { id: 'R6', x: 0.78, z: 0.58, rotation: 0, color: '#b98c62' },
]

const viaGrid = Array.from({ length: 42 }, (_, index) => ({
  x: -1.45 + (index % 14) * 0.22,
  z: -0.58 + Math.floor(index / 14) * 0.48,
}))

function Silkscreen({ label, x, z, size = 0.06, rotation = 0 }: { label: string; x: number; z: number; size?: number; rotation?: number }) {
  return (
    <Text
      position={[x, 0.121, z]}
      rotation={[-Math.PI / 2, 0, rotation]}
      fontSize={size}
      color="#dce8d7"
      anchorX="center"
      anchorY="middle"
    >
      {label}
    </Text>
  )
}

function CustomBoard() {
  const shape = useMemo(() => {
    const board = new Shape()
    board.moveTo(-1.72, -0.78)
    board.lineTo(-1.08, -0.78)
    board.quadraticCurveTo(-0.98, -0.78, -0.92, -0.68)
    board.lineTo(-0.78, -0.42)
    board.quadraticCurveTo(-0.72, -0.31, -0.58, -0.31)
    board.lineTo(0.9, -0.31)
    board.quadraticCurveTo(1.05, -0.31, 1.08, -0.47)
    board.lineTo(1.14, -0.78)
    board.lineTo(1.64, -0.78)
    board.quadraticCurveTo(1.76, -0.78, 1.78, -0.66)
    board.lineTo(1.78, 0.62)
    board.quadraticCurveTo(1.78, 0.78, 1.62, 0.78)
    board.lineTo(1.05, 0.78)
    board.quadraticCurveTo(0.92, 0.78, 0.88, 0.66)
    board.lineTo(0.78, 0.38)
    board.quadraticCurveTo(0.72, 0.24, 0.56, 0.24)
    board.lineTo(-0.28, 0.24)
    board.quadraticCurveTo(-0.46, 0.24, -0.55, 0.39)
    board.lineTo(-0.72, 0.67)
    board.quadraticCurveTo(-0.79, 0.78, -0.94, 0.78)
    board.lineTo(-1.72, 0.78)
    board.quadraticCurveTo(-1.86, 0.78, -1.86, 0.64)
    board.lineTo(-1.86, -0.64)
    board.quadraticCurveTo(-1.86, -0.78, -1.72, -0.78)

    const holes = [
      [-1.62, -0.58],
      [1.48, -0.58],
      [-1.6, 0.58],
      [1.48, 0.58],
    ]
    holes.forEach(([x, y]) => {
      const hole = new Path()
      hole.absarc(x, y, 0.08, 0, Math.PI * 2, false)
      board.holes.push(hole)
    })

    return board
  }, [])

  return (
    <>
      <mesh position={[0, 0.055, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow castShadow>
        <extrudeGeometry args={[shape, { depth: 0.11, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 3 }]} />
        <meshPhysicalMaterial color="#102a1b" roughness={0.72} metalness={0.01} clearcoat={0.18} clearcoatRoughness={0.48} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.118, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <shapeGeometry args={[shape]} />
        <meshBasicMaterial color="#123820" side={DoubleSide} />
      </mesh>
    </>
  )
}

function Chip({
  x,
  z,
  label,
  visible,
  size = [0.54, 0.14, 0.48],
  pins = 12,
}: {
  x: number
  z: number
  label: string
  visible: boolean
  size?: [number, number, number]
  pins?: number
}) {
  const ref = useRef<Mesh>(null)
  const rows = Math.max(4, pins)

  useFrame(({ clock }) => {
    if (ref.current) ref.current.position.y = visible ? 0.18 + Math.sin(clock.elapsedTime * 2 + x) * 0.006 : 1.2
  })

  return (
    <group position={[x, 0.18, z]} visible={visible} ref={ref}>
      <RoundedBox args={size} radius={0.022} smoothness={4} castShadow>
        <meshStandardMaterial color="#15191f" metalness={0.22} roughness={0.5} />
      </RoundedBox>
      {Array.from({ length: rows }).map((_, index) => {
        const offset = -size[2] / 2 + ((index + 0.5) / rows) * size[2]
        return (
          <group key={index}>
            <mesh position={[-size[0] / 2 - 0.026, -size[1] / 2 + 0.024, offset]}>
              <boxGeometry args={[0.052, 0.02, 0.03]} />
              <meshStandardMaterial color="#d5d9dc" metalness={0.86} roughness={0.22} />
            </mesh>
            <mesh position={[size[0] / 2 + 0.026, -size[1] / 2 + 0.024, offset]}>
              <boxGeometry args={[0.052, 0.02, 0.03]} />
              <meshStandardMaterial color="#d5d9dc" metalness={0.86} roughness={0.22} />
            </mesh>
          </group>
        )
      })}
      <Text position={[0, size[1] / 2 + 0.014, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.065} color="#f8fafc" anchorX="center">
        {label}
      </Text>
    </group>
  )
}

function Passive({ part, visible }: { part: PassivePart; visible: boolean }) {
  return (
    <group position={[part.x, visible ? 0.155 : 0.8, part.z]} rotation={[0, ((part.rotation || 0) * Math.PI) / 180, 0]} visible={visible}>
      <mesh castShadow>
        <boxGeometry args={[0.18, 0.045, 0.09]} />
        <meshStandardMaterial color={part.color || '#d5c1a4'} roughness={0.45} metalness={0.12} />
      </mesh>
      <mesh position={[-0.105, -0.002, 0]}>
        <boxGeometry args={[0.036, 0.022, 0.094]} />
        <meshStandardMaterial color="#d7dce2" metalness={0.82} roughness={0.22} />
      </mesh>
      <mesh position={[0.105, -0.002, 0]}>
        <boxGeometry args={[0.036, 0.022, 0.094]} />
        <meshStandardMaterial color="#d7dce2" metalness={0.82} roughness={0.22} />
      </mesh>
      <Silkscreen label={part.id} x={0} z={-0.12} size={0.038} />
    </group>
  )
}

function UsbC({ x, z, label, visible }: { x: number; z: number; label: string; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.205 : 0.95, z]} visible={visible}>
      <RoundedBox args={[0.52, 0.2, 0.36]} radius={0.04} smoothness={6} castShadow>
        <meshStandardMaterial color="#d8dde2" metalness={0.9} roughness={0.18} />
      </RoundedBox>
      <RoundedBox position={[0, 0.018, -0.02]} args={[0.38, 0.08, 0.19]} radius={0.025} smoothness={6}>
        <meshStandardMaterial color="#353b42" metalness={0.28} roughness={0.38} />
      </RoundedBox>
      <Text position={[0, 0.118, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.052} color="#111827" anchorX="center">
        {label}
      </Text>
    </group>
  )
}

function Rj45({ x, z, visible }: { x: number; z: number; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.235 : 0.98, z]} visible={visible}>
      <RoundedBox args={[0.62, 0.32, 0.52]} radius={0.035} smoothness={6} castShadow>
        <meshStandardMaterial color="#c9d0d6" metalness={0.68} roughness={0.2} />
      </RoundedBox>
      <mesh position={[0, 0.02, -0.18]}>
        <boxGeometry args={[0.48, 0.14, 0.13]} />
        <meshStandardMaterial color="#15191f" roughness={0.4} />
      </mesh>
      <Text position={[0, 0.175, 0.03]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.055} color="#111827" anchorX="center">
        RJ45
      </Text>
    </group>
  )
}

function PinHeader({ x, z, visible }: { x: number; z: number; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.22 : 0.9, z]} visible={visible}>
      {Array.from({ length: 10 }).map((_, index) => (
        <group key={index} position={[-0.54 + index * 0.12, 0, 0]}>
          <mesh castShadow>
            <boxGeometry args={[0.032, 0.38, 0.032]} />
            <meshStandardMaterial color="#d6ad53" metalness={0.82} roughness={0.22} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <boxGeometry args={[0.07, 0.07, 0.07]} />
            <meshStandardMaterial color="#171b21" roughness={0.38} />
          </mesh>
        </group>
      ))}
      <Silkscreen label="JTAG / GPIO" x={0} z={0.16} size={0.045} />
    </group>
  )
}

function Crystal({ x, z, visible }: { x: number; z: number; visible: boolean }) {
  return (
    <group position={[x, visible ? 0.17 : 0.72, z]} visible={visible}>
      <RoundedBox args={[0.28, 0.07, 0.18]} radius={0.02} smoothness={4} castShadow>
        <meshStandardMaterial color="#d9dde2" metalness={0.75} roughness={0.24} />
      </RoundedBox>
      <Silkscreen label="XTAL" x={0} z={0.18} size={0.045} />
    </group>
  )
}

function CopperDetails({ routeGlow }: { routeGlow: number }) {
  return (
    <>
      {traces.map((points, index) => (
        <Line
          key={index}
          points={points.map(([x, y, z]) => [x, y + 0.035, z])}
          color={index === 1 ? '#d8af55' : '#c77b38'}
          lineWidth={2 + routeGlow * 2.1}
          transparent
          opacity={0.42 + routeGlow * 0.52}
        />
      ))}
      {viaGrid.map((via) => (
        <mesh key={`${via.x}-${via.z}`} position={[via.x, 0.128, via.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.024, 0.024, 0.012, 24]} />
          <meshStandardMaterial color="#d2a443" metalness={0.86} roughness={0.18} />
        </mesh>
      ))}
      {[-1.62, 1.48].map((x) =>
        [-0.58, 0.58].map((z) => (
          <group key={`${x}-${z}`} position={[x, 0.13, z]} rotation={[-Math.PI / 2, 0, 0]}>
            <mesh>
              <ringGeometry args={[0.09, 0.13, 36]} />
              <meshStandardMaterial color="#d3a544" metalness={0.86} roughness={0.2} />
            </mesh>
          </group>
        )),
      )}
    </>
  )
}

function BoardAssembly({ progress = 0.4, compact = false }: PcbSceneProps) {
  const group = useRef<Group>(null)
  const reduced = useReducedMotion()
  const clamped = Math.max(0, Math.min(1, compact ? progress : Math.max(progress, 0.58)))
  const layers = Math.min(1, Math.max(0, clamped / 0.24))
  const components = Math.min(1, Math.max(0, (clamped - 0.18) / 0.28))
  const routeGlow = Math.min(1, Math.max(0, (clamped - 0.42) / 0.24))
  const scanner = Math.min(1, Math.max(0, (clamped - 0.62) / 0.18))
  const packageStep = clamped > 0.82

  useFrame(({ clock }) => {
    if (!group.current || reduced) return
    group.current.rotation.y = Math.sin(clock.elapsedTime * 0.22) * 0.09 + clamped * 0.13
    group.current.rotation.x = -0.08 + Math.sin(clock.elapsedTime * 0.2) * 0.018
  })

  return (
    <Float speed={reduced ? 0 : 1.1} rotationIntensity={0.08} floatIntensity={compact ? 0.16 : 0.36}>
      <group ref={group} scale={compact ? 0.68 : 0.88}>
        <group position={[0, layers > 0.45 ? 0 : -0.1, 0]}>
          <CustomBoard />
          <mesh position={[0, 0.09 + layers * 0.09, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <shapeGeometry
              args={[
                (() => {
                  const layer = new Shape()
                  layer.moveTo(-1.62, -0.66)
                  layer.lineTo(1.55, -0.66)
                  layer.lineTo(1.55, 0.66)
                  layer.lineTo(-1.62, 0.66)
                  layer.lineTo(-1.62, -0.66)
                  return layer
                })(),
              ]}
            />
            <meshStandardMaterial color="#61d8ba" transparent opacity={0.035 * layers} roughness={0.8} />
          </mesh>
        </group>
        <CopperDetails routeGlow={routeGlow} />
        <UsbC x={-1.42} z={0.06} label="USB-C" visible={components > 0.1} />
        <Rj45 x={1.34} z={0.18} visible={components > 0.22} />
        <UsbC x={1.28} z={-0.48} label="USB-C" visible={components > 0.34} />
        <Chip x={-0.18} z={-0.02} label="ESP32-S3" visible={components > 0.06} size={[0.62, 0.15, 0.58]} pins={16} />
        <Chip x={0.58} z={0.32} label="QFN MCU" visible={components > 0.42} size={[0.46, 0.13, 0.42]} pins={14} />
        <Chip x={-0.72} z={0.38} label="LDO" visible={components > 0.52} size={[0.34, 0.11, 0.3]} pins={8} />
        <Crystal x={0.26} z={0.56} visible={components > 0.5} />
        <PinHeader x={0.76} z={-0.64} visible={components > 0.62} />
        {passiveParts.map((part, index) => (
          <Passive key={part.id} part={part} visible={components > 0.25 + index * 0.025} />
        ))}
        <Silkscreen label="BOARDFORGE AI" x={0.7} z={0.68} size={0.072} />
        <Silkscreen label="BF-PROTO-01  54x46mm" x={1.56} z={0.02} size={0.055} rotation={Math.PI / 2} />
        <Silkscreen label="MCU" x={-0.18} z={-0.43} size={0.05} />
        <Silkscreen label="POWER" x={-0.72} z={0.07} size={0.045} />
        <Silkscreen label="SENSOR BUS" x={0.5} z={0.05} size={0.045} />
        {scanner > 0 && (
          <mesh position={[-1.78 + scanner * 3.56, 0.48, 0]} rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[1.68, 0.014, 0.026]} />
            <meshStandardMaterial color="#f2f7d0" emissive="#f9ff8b" emissiveIntensity={0.45} transparent opacity={0.28} />
          </mesh>
        )}
        {packageStep && (
          <group position={[1.8, 0.38, -0.05]} rotation={[0.18, -0.38, 0.04]}>
            <mesh>
              <boxGeometry args={[0.48, 0.38, 0.18]} />
              <meshStandardMaterial color="#22313d" roughness={0.42} metalness={0.08} />
            </mesh>
            <Text position={[0, 0.21, 0.1]} fontSize={0.082} color="#ecfeff" anchorX="center">
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
      <Canvas shadows dpr={[1, 1.75]} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <PerspectiveCamera makeDefault position={[0, 4.7, 4.7]} rotation={[-0.77, 0, 0]} fov={30} />
        <color attach="background" args={['#0d1114']} />
        <ambientLight intensity={0.34} />
        <directionalLight position={[2.6, 5, 3.4]} intensity={2.7} castShadow />
        <pointLight position={[-3.2, 2.2, -2.4]} intensity={2.2} color="#d7f7e7" />
        <Grid position={[0, -0.3, 0]} args={[6, 4]} cellSize={0.28} cellThickness={0.18} cellColor="#394348" sectionColor="#667178" fadeDistance={7} fadeStrength={1.4} />
        <Suspense fallback={null}>
          <BoardAssembly {...props} />
          <ContactShadows position={[0, -0.18, 0]} opacity={0.45} scale={6} blur={2.4} />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
