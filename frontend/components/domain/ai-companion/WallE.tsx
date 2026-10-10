"use client";

import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";

/**
 * WALL-E - A boxy yellow robot with binocular eyes and tracks.
 * Built with three.js primitives for a recognizable WALL-E appearance.
 */

// WALL-E body parts as separate components for animation
function WallEBody({ position = [0, 0, 0], scale = 1 }: { position?: [number, number, number]; scale?: number }) {
  const bodyRef = useRef<THREE.Group>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Idle animation - subtle bobbing
  useFrame((state) => {
    if (bodyRef.current) {
      bodyRef.current.position.y = position[1] + Math.sin(state.clock.getElapsedTime() * 1.5) * 0.02;
    }
  });

  return (
    <group ref={bodyRef} position={position} scale={scale} onPointerOver={() => setIsHovered(true)} onPointerOut={() => setIsHovered(false)}>
      {/* Main body - yellow cube */}
      <mesh
        castShadow
        receiveShadow
        onPointerOver={() => setIsHovered(true)}
        onPointerOut={() => setIsHovered(false)}
      >
        <boxGeometry args={[1.2, 1.4, 1]} />
        <meshStandardMaterial
          color={isHovered ? "#FFD600" : "#FFC107"}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>

      {/* Front panel - lighter yellow */}
      <mesh position={[0, 0, 0.51]} castShadow receiveShadow>
        <boxGeometry args={[1.1, 1.3, 0.1]} />
        <meshStandardMaterial color="#FFD54F" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* WALL-E text on front */}
      <mesh position={[0, 0.3, 0.56]} rotation={[-Math.PI / 2, 0, 0]}>
        <Text
          fontSize={0.15}
          anchorX="center"
          anchorY="middle"
        >
          WALL·E
          <meshStandardMaterial color="#333333" />
        </Text>
      </mesh>
    </group>
  );
}

function WallEEyes({ position = [0, 0.3, 0.6], lookAtTarget = [0, 0, 10] }: {
  position?: [number, number, number];
  lookAtTarget?: [number, number, number];
}) {
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);
  const pupilLeftRef = useRef<THREE.Mesh>(null);
  const pupilRightRef = useRef<THREE.Mesh>(null);

  // Blinking animation
  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    const shouldBlink = Math.sin(time * 0.5) > 0.98 || false;
    
    if (leftEyeRef.current && rightEyeRef.current) {
      const scaleY = shouldBlink ? 0.05 : 1;
      if (leftEyeRef.current) leftEyeRef.current.scale.y = scaleY;
      if (rightEyeRef.current) rightEyeRef.current.scale.y = scaleY;
    }

    // Pupil tracking - look at target
    if (pupilLeftRef.current && pupilRightRef.current) {
      const target = new THREE.Vector3(...lookAtTarget);
      const leftEyePos = new THREE.Vector3(-0.25, position[1], position[2]);
      const rightEyePos = new THREE.Vector3(0.25, position[1], position[2]);
      
      const leftDir = target.clone().sub(leftEyePos).normalize();
      const rightDir = target.clone().sub(rightEyePos).normalize();
      
      if (pupilLeftRef.current) {
        pupilLeftRef.current.position.set(
          leftDir.x * 0.08,
          leftDir.y * 0.08,
          0.12
        );
      }
      if (pupilRightRef.current) {
        pupilRightRef.current.position.set(
          rightDir.x * 0.08,
          rightDir.y * 0.08,
          0.12
        );
      }
    }
  });

  return (
    <group position={position}>
      {/* Left eye stalk */}
      <group position={[-0.25, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.12, 0.1, 0.4, 8]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
        {/* Eye housing */}
        <mesh ref={leftEyeRef} position={[0, 0.2, 0]} castShadow>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color="#222222" roughness={0.1} metalness={0.9} />
        </mesh>
        {/* Pupil */}
        <mesh ref={pupilLeftRef} position={[0, 0, 0.18]} castShadow>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#00BFFF" roughness={0.1} metalness={0.9} emissive="#00BFFF" emissiveIntensity={0.3} />
        </mesh>
        {/* Eye highlight */}
        <mesh position={[0.05, 0.25, 0.19]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.02, 8]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.8} />
        </mesh>
      </group>

      {/* Right eye stalk */}
      <group position={[0.25, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.12, 0.1, 0.4, 8]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
        {/* Eye housing */}
        <mesh ref={rightEyeRef} position={[0, 0.2, 0]} castShadow>
          <sphereGeometry args={[0.18, 16, 16]} />
          <meshStandardMaterial color="#222222" roughness={0.1} metalness={0.9} />
        </mesh>
        {/* Pupil */}
        <mesh ref={pupilRightRef} position={[0, 0, 0.18]} castShadow>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color="#00BFFF" roughness={0.1} metalness={0.9} emissive="#00BFFF" emissiveIntensity={0.3} />
        </mesh>
        {/* Eye highlight */}
        <mesh position={[0.05, 0.25, 0.19]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.02, 8]} />
          <meshBasicMaterial color="#FFFFFF" transparent opacity={0.8} />
        </mesh>
      </group>
    </group>
  );
}

function WallEArms({ position = [0, -0.2, 0] }: {
  position?: [number, number, number];
}) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.getElapsedTime();
    
    if (leftArmRef.current) {
      if (false) { // isWaving
        leftArmRef.current!.rotation.z = Math.sin(time * 8) * 0.8;
      } else {
        leftArmRef.current!.rotation.z = Math.sin(time * 0.5) * 0.1 - 0.3;
      }
    }
    
    if (rightArmRef.current) {
      if (false) { // isWaving
        rightArmRef.current!.rotation.z = -Math.sin(time * 8) * 0.8;
      } else {
        rightArmRef.current!.rotation.z = -Math.sin(time * 0.5) * 0.1 + 0.3;
      }
    }
  });

  return (
    <group position={position}>
      {/* Left arm */}
      <group ref={leftArmRef} position={[-0.7, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.08, 0.06, 0.5, 8]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
        <mesh position={[0, -0.3, 0]} castShadow>
          <boxGeometry args={[0.2, 0.15, 0.15]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
      </group>

      {/* Right arm */}
      <group ref={rightArmRef} position={[0.7, 0, 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.08, 0.06, 0.5, 8]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
        <mesh position={[0, -0.3, 0]} castShadow>
          <boxGeometry args={[0.2, 0.15, 0.15]} />
          <meshStandardMaterial color="#FFC107" roughness={0.3} metalness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

function WallETracks({ position = [0, -0.8, 0] }: { position?: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Left track */}
      <group position={[-0.5, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.4, 0.2, 1.2]} />
          <meshStandardMaterial color="#333333" roughness={0.8} metalness={0.1} />
        </mesh>
        {/* Track treads */}
        <mesh position={[0, 0.11, 0]} castShadow>
          <boxGeometry args={[0.42, 0.02, 1.22]} />
          <meshStandardMaterial color="#111111" roughness={0.9} metalness={0.1} />
        </mesh>
      </group>

      {/* Right track */}
      <group position={[0.5, 0, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.4, 0.2, 1.2]} />
          <meshStandardMaterial color="#333333" roughness={0.8} metalness={0.1} />
        </mesh>
        <mesh position={[0, 0.11, 0]} castShadow>
          <boxGeometry args={[0.42, 0.02, 1.22]} />
          <meshStandardMaterial color="#111111" roughness={0.9} metalness={0.1} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * Complete WALL-E character with all animations
 */
export function WallECharacter({
  position = [0, 0, 0],
  scale = 1,
  lookAtTarget = [0, 0, 10],
  className = "",
}: {
  position?: [number, number, number];
  scale?: number;
  lookAtTarget?: [number, number, number];
  className?: string;
}) {
  return (
    <div className={className} style={{ width: "100%", height: "100%", minHeight: 200 }}>
      <Canvas
        camera={{ position: [0, 1, 3], fov: 30 }}
        shadows
        className="w-full h-full"
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 4, 3]} intensity={1} castShadow />
        <directionalLight position={[-2, 2, -2]} intensity={0.3} />
        
        {/* Ground plane for shadows */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]} receiveShadow>
          <planeGeometry args={[10, 10]} />
          <meshStandardMaterial color="#f5f5f5" transparent opacity={0.3} />
        </mesh>

        <group position={position} scale={scale}>
          <WallEBody position={[0, 0.3, 0]} scale={1} />
          <WallEEyes 
            position={[0, 0.6, 0]} 
            lookAtTarget={lookAtTarget}
          />
          <WallEArms position={[0, 0.1, 0]} />
          <WallETracks position={[0, -0.3, 0]} />
        </group>
      </Canvas>
    </div>
  );
}

/**
 * Simplified WALL-E for smaller spaces (like dashboard AI box)
 */
export function WallECompact({
  position = [0, 0, 0],
  scale = 0.5,
  lookAtTarget = [0, 0, 10],
  className = "",
}: {
  position?: [number, number, number];
  scale?: number;
  lookAtTarget?: [number, number, number];
  className?: string;
}) {
  return (
    <div className={className} style={{ width: 120, height: 120 }}>
      <Canvas
        camera={{ position: [0, 0.5, 2], fov: 30 }}
        shadows
        className="w-full h-full"
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[1, 2, 1]} intensity={1} castShadow />
        
        <group position={position} scale={scale}>
          <WallEBody position={[0, 0.2, 0]} scale={0.8} />
          <WallEEyes 
            position={[0, 0.5, 0]} 
            lookAtTarget={lookAtTarget}
          />
          <WallEArms position={[0, 0.1, 0]} />
          <WallETracks position={[0, -0.2, 0]} />
        </group>
      </Canvas>
    </div>
  );
}