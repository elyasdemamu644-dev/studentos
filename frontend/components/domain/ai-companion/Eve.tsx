"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";

/**
 * EVE - A smooth white floating robot with blue illuminated eyes.
 * Built with three.js primitives for a recognizable EVE appearance.
 */

// EVE body - smooth white capsule shape
function EveBody({ position = [0, 0, 0], scale = 1 }: { position?: [number, number, number]; scale?: number }) {
  const bodyRef = useRef<THREE.Group>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Idle animation - gentle floating
  useFrame((state) => {
    if (bodyRef.current) {
      bodyRef.current.position.y = position[1] + Math.sin(state.clock.getElapsedTime() * 1.2) * 0.03;
      bodyRef.current.rotation.z = Math.sin(state.clock.getElapsedTime() * 0.3) * 0.02;
    }
  });

  return (
    <group ref={bodyRef} position={position} scale={scale} onPointerOver={() => setIsHovered(true)} onPointerOut={() => setIsHovered(false)}>
      {/* Main body - white capsule/ellipsoid */}
      <mesh castShadow receiveShadow onPointerOver={() => setIsHovered(true)} onPointerOut={() => setIsHovered(false)}>
        <sphereGeometry args={[0.8, 1.2, 0.8, 32, 32]} />
        <meshStandardMaterial
          color={isHovered ? "#FFFFFF" : "#F5F5F5"}
          roughness={0.1}
          metalness={0.2}
          transparent
          opacity={0.95}
        />
      </mesh>

      {/* Inner glow layer */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.75, 1.15, 0.75, 24, 24]} />
        <meshBasicMaterial
          color="#00BFFF"
          transparent
          opacity={0.05}
          side={THREE.BackSide}
        />
      </mesh>

      {/* EVE text on front */}
      <mesh position={[0, 0.1, 0.82]} rotation={[-Math.PI / 2, 0, 0]}>
        <Text
          fontSize={0.12}
          anchorX="center"
          anchorY="middle"
        >
          EVE
          <meshStandardMaterial color="#00BFFF" emissive="#00BFFF" emissiveIntensity={0.5} />
        </Text>
      </mesh>

      {/* Apple-style logo on back */}
      <mesh position={[0, 0.2, -0.82]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 16]} />
        <meshStandardMaterial color="#CCCCCC" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function EveEyes({ position = [0, 0.1, 0.6] }: {
  position?: [number, number, number];
}) {

  return (
    <group position={position}>
      {/* Single continuous eye screen */}
      <mesh castShadow receiveShadow>
        <planeGeometry args={[0.7, 0.18]} />
        <meshStandardMaterial
          color="#000000"
          roughness={0.1}
          metalness={0.9}
          emissive="#00BFFF"
          emissiveIntensity={0.8}
          transparent
          opacity={0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Left eye indicator (glowing segment) */}
      <mesh position={[-0.22, 0, 0.02]} scale={[0.08, 0.12, 1]}>
        <planeGeometry />
        <meshBasicMaterial
          color="#00BFFF"
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Right eye indicator */}
      <mesh position={[0.22, 0, 0.02]} scale={[0.08, 0.12, 1]}>
        <planeGeometry />
        <meshBasicMaterial
          color="#00BFFF"
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Central glow line */}
      <mesh position={[0, 0, 0.02]} scale={[0.5, 0.02, 1]}>
        <planeGeometry />
        <meshBasicMaterial
          color="#00BFFF"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

function EveArms({ position = [0, -0.3, 0] }: { position?: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Left arm - sleek and tapered */}
      <group position={[-0.9, -0.2, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.1} metalness={0.3} />
        </mesh>
        {/* Hand */}
        <mesh position={[0, -0.25, 0]} castShadow>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.1} metalness={0.2} />
        </mesh>
      </group>

      {/* Right arm */}
      <group position={[0.9, -0.2, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.4, 8]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.1} metalness={0.3} />
        </mesh>
        <mesh position={[0, -0.25, 0]} castShadow>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#FFFFFF" roughness={0.1} metalness={0.2} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Complete EVE character with all animations
 */
export function EveCharacter({
  position = [0, 0, 0],
  scale = 1,
  className = "",
}: {
  position?: [number, number, number];
  scale?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ width: "100%", height: "100%", minHeight: 200 }}>
      <Canvas
        camera={{ position: [0, 1, 3], fov: 30 }}
        shadows
        className="w-full h-full"
      >
        <ambientLight intensity={0.8} color="#E0F7FF" />
        <directionalLight position={[2, 4, 3]} intensity={1} castShadow color="#FFFFFF" />
        <directionalLight position={[-2, 2, -2]} intensity={0.3} color="#E0F7FF" />
        <pointLight position={[0, 2, 0]} intensity={0.5} color="#00BFFF" distance={5} decay={2} />
        
        {/* Ground plane for shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.2, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#E8F8FF" transparent opacity={0.2} />
        </mesh>

        <group position={position} scale={scale}>
          <EveBody position={[0, 0.5, 0]} scale={1} />
          <EveEyes position={[0, 0.1, 0]} />
          <EveArms position={[0, 0, 0]} />
          {/* Subtle glow effects */}
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[1.2, 1.6, 1.2, 16, 16]} />
            <meshBasicMaterial
              color="#00BFFF"
              transparent
              opacity={0.03}
              side={THREE.BackSide}
            />
          </mesh>
        </group>
      </Canvas>
    </div>
  );
}

/**
 * Simplified EVE for smaller spaces (like dashboard AI box)
 */
export function EveCompact({
  position = [0, 0, 0],
  scale = 0.5,
  className = "",
}: {
  position?: [number, number, number];
  scale?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ width: 120, height: 120 }}>
      <Canvas
        camera={{ position: [0, 0.5, 2], fov: 30 }}
        shadows
        className="w-full h-full"
      >
        <ambientLight intensity={0.8} color="#E0F7FF" />
        <directionalLight position={[1, 2, 1]} intensity={1} castShadow color="#FFFFFF" />
        <pointLight position={[0, 1, 0]} intensity={0.5} color="#00BFFF" distance={3} decay={2} />
        
        <group position={position} scale={scale}>
          <EveBody position={[0, 0.3, 0]} scale={0.8} />
          <EveEyes position={[0, 0, 0]} />
        </group>
      </Canvas>
    </div>
  );
}