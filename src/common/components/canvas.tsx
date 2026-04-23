import { Canvas as ThreeCanvas } from '@react-three/fiber'
import { ReactNode } from 'react'

type CanvasProps = {
  children: ReactNode
}

export function Canvas({ children }: CanvasProps) {
  return (
    <ThreeCanvas
      shadows
      camera={{ position: [0, 0, 5], fov: 90 }}
      gl={{ antialias: true }}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}
    >
      {children}
    </ThreeCanvas>
  )
}