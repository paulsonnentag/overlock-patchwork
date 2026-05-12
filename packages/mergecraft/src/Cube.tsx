import { useCallback, useRef, useState } from "react";
import type { DocHandle } from "@automerge/automerge-repo";

import { ThreeEvent } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";

import { useHandle } from "patchwork-react";

import type { MergecraftDoc } from "./datatype";
import { coordKey, useCubeDiff } from "./diff";

import dirt from "./assets/dirt.jpg?url";

// Naive implementation: doesn't scale past a few thousand boxes. To
// scale to 100k+ this should become a single instanced mesh.

type CubeVariant = "normal" | "added" | "deleted";

export const Cubes = ({ handle }: { handle: DocHandle<MergecraftDoc> }) => {
  const doc = useHandle(handle);
  const diff = useCubeDiff(handle);

  const addCube = (x: number, y: number, z: number) =>
    handle.change((d) => d.cubes.push([x, y, z]));
  const removeCube = (x: number, y: number, z: number) =>
    handle.change((d) => {
      const index = d.cubes.findIndex(
        (coords) => coords[0] === x && coords[1] === y && coords[2] === z
      );
      if (index !== -1) {
        d.cubes.splice(index, 1);
      }
    });

  if (!doc) {
    return null;
  }

  const cubes = doc.cubes || [];
  return (
    <>
      {cubes.map((coords, index) => (
        <Cube
          key={`live:${index}`}
          addCube={addCube}
          removeCube={removeCube}
          position={coords}
          variant={diff.added.has(coordKey(coords)) ? "added" : "normal"}
        />
      ))}
      {diff.deleted.map((coords, index) => (
        <Cube
          key={`del:${index}`}
          addCube={addCube}
          removeCube={removeCube}
          position={coords}
          variant="deleted"
        />
      ))}
    </>
  );
};

type CubeProps = {
  addCube: (x: number, y: number, z: number) => void;
  removeCube: (x: number, y: number, z: number) => void;
  position: [number, number, number];
  variant: CubeVariant;
};

export function Cube({ addCube, removeCube, variant, ...props }: CubeProps) {
  if (variant === "deleted") return <GhostCube position={props.position} />;
  return (
    <SolidCube addCube={addCube} removeCube={removeCube} {...props} variant={variant} />
  );
}

type SolidCubeProps = Omit<CubeProps, "variant"> & { variant: "normal" | "added" };

function SolidCube({ addCube, removeCube, variant, ...props }: SolidCubeProps) {
  const ref = useRef<RapierRigidBody>(null);
  const [hover, setHover] = useState<number | undefined>(undefined);

  const texture = useTexture(dirt);
  const onMove = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.faceIndex) return;
    setHover(Math.floor(e.faceIndex / 2));
  }, []);
  const onOut = useCallback(() => setHover(undefined), []);
  const onClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.faceIndex || !ref.current) return;
    const { x, y, z } = ref.current.translation();

    if (e.button === 2) {
      removeCube(x, y, z);
      return;
    }

    const dir: [number, number, number][] = [
      [x + 1, y, z],
      [x - 1, y, z],
      [x, y + 1, z],
      [x, y - 1, z],
      [x, y, z + 1],
      [x, y, z - 1],
    ];
    const faceIndex = Math.floor(e.faceIndex / 2);
    const adjacentCubeCoordinates = dir[faceIndex];
    addCube(...adjacentCubeCoordinates);
  }, []);

  const baseTint = variant === "added" ? "#9bff9b" : "white";
  return (
    <RigidBody {...props} type="fixed" colliders="cuboid" ref={ref}>
      <mesh
        receiveShadow
        castShadow
        onPointerMove={onMove}
        onPointerOut={onOut}
        onClick={onClick}
      >
        {[...Array(6)].map((_, index) => (
          <meshStandardMaterial
            attach={`material-${index}`}
            key={index}
            map={texture}
            color={baseTint}
            emissive="#ffffff"
            emissiveIntensity={hover === index ? 0.15 : 0}
          />
        ))}
        <boxGeometry />
      </mesh>
    </RigidBody>
  );
}

// No physics, no raycast — ghosts are visual only so the player walks
// through them and clicks pass to whatever is behind.
function GhostCube({ position }: { position: [number, number, number] }) {
  const texture = useTexture(dirt);
  return (
    <mesh position={position} raycast={() => null}>
      {[...Array(6)].map((_, index) => (
        <meshStandardMaterial
          attach={`material-${index}`}
          key={index}
          map={texture}
          color="#ff7878"
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      ))}
      <boxGeometry />
    </mesh>
  );
}
