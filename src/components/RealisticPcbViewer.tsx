import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, Line, OrbitControls, RoundedBox, Text } from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import { DoubleSide } from 'three'
import {
  demoBoardRoutes,
  demoBoardVias,
  demoPlacedFootprints,
  packageById,
  resolvePlacedFootprints,
  type BoardRoute,
  type BoardVia,
  type PlacedFootprint,
} from '../data/footprints'
import type { GenerationRequest } from '../data/models'

type RealisticPcbViewerProps = {
  request: GenerationRequest
  footprints?: PlacedFootprint[]
  routes?: BoardRoute[]
  vias?: BoardVia[]
  interactive?: boolean
  autoRotate?: boolean
}

const boardToWorld = (x: number, y: number, width: number, height: number) => [(x - 0.5) * width, 0.08, (y - 0.5) * height] as const

function CopperTraces({ width, height, routes }: { width: number; height: number; routes: BoardRoute[] }) {
  return (
    <>
      {routes.map((route) => (
        <Line
          key={route.id}
          points={route.points.map(([x, y]) => boardToWorld(x, y, width, height))}
          color={route.width === 'power' ? '#d6a94d' : '#d58a43'}
          lineWidth={route.width === 'power' ? 4 : 2.5}
          transparent
          opacity={0.86}
        />
      ))}
    </>
  )
}

function ViaField({ width, height, vias }: { width: number; height: number; vias: BoardVia[] }) {
  return (
    <>
      {vias.map((via) => {
        const [wx, wy, wz] = boardToWorld(via.x, via.y, width, height)
        return (
          <mesh key={via.id} position={[wx, wy + 0.012, wz]} rotation={[-Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.018, 32]} />
            <meshStandardMaterial color="#d7ad50" metalness={0.8} roughness={0.22} />
          </mesh>
        )
      })}
    </>
  )
}

function FootprintMesh({ placed, width, height }: { placed: PlacedFootprint; width: number; height: number }) {
  const pkg = packageById(placed.packageId)
  const [x, y, z] = boardToWorld(placed.x, placed.y, width, height)
  const [sx, sz, sy] = pkg.body
  const pinRows = Math.max(2, Math.min(14, Math.ceil(pkg.pinCount / 4)))

  return (
    <group position={[x, y + sy / 2, z]} rotation={[0, (placed.rotation * Math.PI) / 180, 0]}>
      <RoundedBox args={[sx, sy, sz]} radius={0.025} smoothness={4} castShadow>
        <meshStandardMaterial color={pkg.color} roughness={0.38} metalness={pkg.kind === 'usb-c' ? 0.72 : 0.18} />
      </RoundedBox>
      {pkg.pinCount > 1 &&
        Array.from({ length: pinRows }).map((_, index) => {
          const offset = -sz / 2 + ((index + 0.5) / pinRows) * sz
          return (
            <group key={index}>
              <mesh position={[-sx / 2 - 0.025, -sy / 2 + 0.025, offset]}>
                <boxGeometry args={[0.05, 0.025, 0.035]} />
                <meshStandardMaterial color="#d8dce1" metalness={0.9} roughness={0.2} />
              </mesh>
              <mesh position={[sx / 2 + 0.025, -sy / 2 + 0.025, offset]}>
                <boxGeometry args={[0.05, 0.025, 0.035]} />
                <meshStandardMaterial color="#d8dce1" metalness={0.9} roughness={0.2} />
              </mesh>
            </group>
          )
        })}
      <Text position={[0, sy / 2 + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.075} color="#f8fafc" anchorX="center">
        {placed.ref}
      </Text>
    </group>
  )
}

function BoardScene({ request, footprints = demoPlacedFootprints, routes = demoBoardRoutes, vias = demoBoardVias }: RealisticPcbViewerProps) {
  const width = Math.max(2.8, Math.min(5.8, request.boardWidthMm / 16))
  const height = Math.max(1.8, Math.min(4.2, request.boardHeightMm / 16))
  const isRound = request.boardShape === 'circle'
  const renderFootprints = useMemo(() => resolvePlacedFootprints(footprints), [footprints])

  return (
    <group rotation={[-0.2, -0.25, 0]}>
      <mesh receiveShadow position={[0, 0, 0]}>
        {isRound ? <cylinderGeometry args={[Math.min(width, height) / 2, Math.min(width, height) / 2, 0.09, 96]} /> : <boxGeometry args={[width, 0.09, height]} />}
        <meshPhysicalMaterial
          color="#115e59"
          roughness={0.34}
          metalness={0.04}
          clearcoat={0.55}
          clearcoatRoughness={0.18}
          side={DoubleSide}
        />
      </mesh>
      <mesh position={[0, 0.052, 0]}>
        {isRound ? <cylinderGeometry args={[Math.min(width, height) / 2.02, Math.min(width, height) / 2.02, 0.006, 96]} /> : <boxGeometry args={[width * 0.97, 0.006, height * 0.94]} />}
        <meshStandardMaterial color="#1fb6a6" transparent opacity={0.18} roughness={0.7} />
      </mesh>
      <CopperTraces width={width} height={height} routes={routes} />
      <ViaField width={width} height={height} vias={vias} />
      {renderFootprints.map((placed) => <FootprintMesh key={placed.id} placed={placed} width={width} height={height} />)}
      {request.placementMarks.map((mark) => {
        const [x, y, z] = boardToWorld(mark.x, mark.y, width, height)
        return (
          <group key={mark.id} position={[x, y + 0.03, z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.08, 0.105, 32]} />
              <meshBasicMaterial color={mark.kind === 'keepout' ? '#fb7185' : '#67e8f9'} transparent opacity={0.85} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export function RealisticPcbViewer({ request, footprints = demoPlacedFootprints, routes = demoBoardRoutes, vias = demoBoardVias, interactive = true, autoRotate = false }: RealisticPcbViewerProps) {
  return (
    <div className="realistic-viewer">
      <Canvas shadows dpr={[1, 1.7]} camera={{ position: [0, 4.2, 6.6], fov: 38 }}>
        <color attach="background" args={['#071110']} />
        <ambientLight intensity={0.55} />
        <directionalLight position={[3, 5, 4]} intensity={3.2} castShadow />
        <pointLight position={[-4, 2, -3]} color="#67e8f9" intensity={10} />
        <Suspense fallback={null}>
          <BoardScene request={request} footprints={footprints} routes={routes} vias={vias} />
          <ContactShadows position={[0, -0.16, 0]} opacity={0.4} scale={8} blur={2.6} />
          <Environment preset="city" />
        </Suspense>
        {(interactive || autoRotate) && (
          <OrbitControls
            autoRotate={autoRotate}
            autoRotateSpeed={0.75}
            enablePan={false}
            enableZoom={interactive}
            enableRotate={interactive || autoRotate}
            minDistance={4.2}
            maxDistance={9}
            maxPolarAngle={Math.PI / 2.15}
          />
        )}
      </Canvas>
      <div className="viewer-controls" aria-label="3D viewer controls">
        <span>Rotate</span>
        <span>Zoom</span>
        <span>Reset-ready</span>
      </div>
    </div>
  )
}
