import { Canvas, useFrame } from '@react-three/fiber'
import { ContactShadows, Environment, Float, Line, PerspectiveCamera, RoundedBox, Text } from '@react-three/drei'
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
    [-1.36, 0.09, 0.18],
    [-1.02, 0.09, 0.18],
    [-0.72, 0.09, 0.02],
    [-0.16, 0.09, 0.02],
    [0.38, 0.09, -0.04],
  ],
  [
    [1.2, 0.092, -0.14],
    [0.88, 0.092, -0.14],
    [0.68, 0.092, 0.02],
    [0.12, 0.092, 0.02],
  ],
  [
    [0.52, 0.094, 0.42],
    [0.52, 0.094, 0.24],
    [0.2, 0.094, 0.08],
    [-0.08, 0.094, 0.08],
  ],
  [
    [-0.82, 0.096, -0.24],
    [-0.58, 0.096, -0.24],
    [-0.42, 0.096, -0.08],
    [-0.16, 0.096, -0.08],
    [0.18, 0.096, -0.16],
  ],
] as const

const passiveParts: PassivePart[] = [
  { id: 'C1', x: -0.48, z: -0.24, rotation: 0 },
  { id: 'C2', x: -0.32, z: -0.24, rotation: 0, color: '#b98c62' },
  { id: 'R1', x: -0.66, z: -0.04, rotation: 90 },
  { id: 'R2', x: 0.22, z: -0.22, rotation: 0, color: '#b98c62' },
  { id: 'C3', x: 0.5, z: -0.28, rotation: 90 },
  { id: 'R3', x: 0.74, z: -0.28, rotation: 90 },
  { id: 'C4', x: 0.82, z: 0.04, rotation: 0 },
  { id: 'R4', x: 1.0, z: 0.04, rotation: 90, color: '#b98c62' },
  { id: 'C5', x: -1.16, z: 0.38, rotation: 0 },
  { id: 'R5', x: -0.94, z: 0.38, rotation: 0, color: '#b98c62' },
  { id: 'C6', x: 0.16, z: 0.46, rotation: 0 },
  { id: 'R6', x: 0.66, z: 0.38, rotation: 0, color: '#b98c62' },
]

const viaGrid = Array.from({ length: 36 }, (_, index) => ({
  x: -1.42 + (index % 12) * 0.24,
  z: -0.46 + Math.floor(index / 12) * 0.38,
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

function makeLandingBoardShape() {
  const board = new Shape()
  board.moveTo(-1.78, -0.76)
  board.lineTo(-0.9, -0.76)
  board.quadraticCurveTo(-0.78, -0.76, -0.7, -0.66)
  board.lineTo(-0.58, -0.5)
  board.quadraticCurveTo(-0.5, -0.4, -0.36, -0.4)
  board.lineTo(1.72, -0.4)
  board.quadraticCurveTo(1.88, -0.4, 1.88, -0.24)
  board.lineTo(1.88, 0.62)
  board.quadraticCurveTo(1.88, 0.76, 1.74, 0.76)
  board.lineTo(-1.78, 0.76)
  board.quadraticCurveTo(-1.92, 0.76, -1.92, 0.62)
  board.lineTo(-1.92, 0.22)
  board.quadraticCurveTo(-1.74, 0.14, -1.74, 0)
  board.quadraticCurveTo(-1.74, -0.14, -1.92, -0.22)
  board.lineTo(-1.92, -0.62)
  board.quadraticCurveTo(-1.92, -0.76, -1.78, -0.76)

  const holes = [
    [-1.62, -0.56],
    [1.6, -0.28],
    [-1.62, 0.56],
    [1.56, 0.56],
  ]
  holes.forEach(([x, y]) => {
    const hole = new Path()
    hole.absarc(x, y, 0.08, 0, Math.PI * 2, false)
    board.holes.push(hole)
  })

  return board
}

function CustomBoard() {
  const shape = useMemo(() => makeLandingBoardShape(), [])

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
      {Array.from({ length: 8 }).map((_, index) => (
        <group key={index} position={[-0.42 + index * 0.12, 0, 0]}>
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
      <Silkscreen label="JTAG / GPIO" x={0} z={0.13} size={0.042} />
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

function CopperDetails({ routeGlow, padProgress }: { routeGlow: number; padProgress: number }) {
  return (
    <>
      {traces.map((points, index) => (
        <Line
          key={index}
          points={points.map(([x, y, z]) => [x, y + 0.035, z])}
          color={index === 1 ? '#d8af55' : '#c77b38'}
          lineWidth={2 + routeGlow * 2.1}
          transparent
          opacity={routeGlow * 0.92}
        />
      ))}
      {viaGrid.map((via) => (
        <mesh key={`${via.x}-${via.z}`} position={[via.x, 0.128, via.z]} rotation={[-Math.PI / 2, 0, 0]} visible={padProgress > 0.02}>
          <cylinderGeometry args={[0.024, 0.024, 0.012, 24]} />
          <meshStandardMaterial color="#d2a443" metalness={0.86} roughness={0.18} transparent opacity={padProgress} />
        </mesh>
      ))}
      {[-1.62, 1.48].map((x) =>
        [-0.58, 0.58].map((z) => (
          <group key={`${x}-${z}`} position={[x, 0.13, z]} rotation={[-Math.PI / 2, 0, 0]} visible={padProgress > 0.02}>
            <mesh>
              <ringGeometry args={[0.09, 0.13, 36]} />
              <meshStandardMaterial color="#d3a544" metalness={0.86} roughness={0.2} transparent opacity={padProgress} />
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
  const clamped = Math.max(0, Math.min(1, compact ? progress : Math.max(progress, 0.82)))
  const layers = Math.min(1, Math.max(0, clamped / 0.24))
  const padProgress = Math.min(1, Math.max(0, (clamped - 0.18) / 0.18))
  const components = Math.min(1, Math.max(0, (clamped - 0.38) / 0.22))
  const routeGlow = Math.min(1, Math.max(0, (clamped - 0.58) / 0.2))

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
          {[0.07, 0.16, 0.25].map((offset, index) => (
            <mesh key={offset} position={[0, 0.08 + layers * offset, 0]} rotation={[Math.PI / 2, 0, 0]} visible={layers > 0.12}>
              <shapeGeometry args={[makeLandingBoardShape()]} />
              <meshStandardMaterial color={index === 1 ? '#a8792d' : '#61d8ba'} transparent opacity={(0.035 + index * 0.012) * layers} roughness={0.8} />
            </mesh>
          ))}
        </group>
        <CopperDetails routeGlow={routeGlow} padProgress={padProgress} />
        <UsbC x={-1.42} z={0.16} label="USB-C" visible={components > 0.08} />
        <Rj45 x={1.22} z={-0.1} visible={components > 0.2} />
        <UsbC x={0.92} z={0.28} label="USB-C" visible={components > 0.34} />
        <Chip x={-0.14} z={-0.02} label="ESP32-S3" visible={components > 0.06} size={[0.56, 0.13, 0.5]} pins={16} />
        <Chip x={0.48} z={-0.14} label="QFN MCU" visible={components > 0.42} size={[0.4, 0.12, 0.36]} pins={14} />
        <Chip x={-0.82} z={-0.16} label="LDO" visible={components > 0.52} size={[0.3, 0.1, 0.24]} pins={8} />
        <Crystal x={0.28} z={0.34} visible={components > 0.5} />
        <PinHeader x={0.32} z={0.46} visible={components > 0.62} />
        {passiveParts.map((part, index) => (
          <Passive key={part.id} part={part} visible={components > 0.25 + index * 0.025} />
        ))}
        <Silkscreen label="BOARDFORGE AI" x={0.34} z={0.61} size={0.055} />
        <Silkscreen label="BF-PROTO-01  54x46mm" x={1.62} z={0.04} size={0.038} rotation={Math.PI / 2} />
        <Silkscreen label="MCU" x={-0.18} z={-0.43} size={0.05} />
        <Silkscreen label="POWER" x={-0.72} z={0.07} size={0.045} />
        <Silkscreen label="SENSOR BUS" x={0.5} z={0.05} size={0.045} />
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
        <Suspense fallback={null}>
          <BoardAssembly {...props} />
          <ContactShadows position={[0, -0.18, 0]} opacity={0.45} scale={6} blur={2.4} />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  )
}
