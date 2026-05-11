import type { DocHandle } from "@automerge/automerge-repo";
import { Canvas } from "@react-three/fiber";
import { Sky, PointerLockControls, KeyboardControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { createXRStore, XR } from "@react-three/xr";

import type { MergecraftDoc } from "./datatype";
import { Ground } from "./Ground";
import { Player } from "./Player";
import { Cubes } from "./Cube";

const keyboardMap = [
  { name: "forward", keys: ["ArrowUp", "w", "W"] },
  { name: "backward", keys: ["ArrowDown", "s", "S"] },
  { name: "left", keys: ["ArrowLeft", "a", "A"] },
  { name: "right", keys: ["ArrowRight", "d", "D"] },
  { name: "jump", keys: ["Space"] },
];

type MergecraftProps = {
  handle: DocHandle<MergecraftDoc>;
};

export default function Mergecraft({ handle }: MergecraftProps) {
  const store = createXRStore();

  return (
    <div className="mergecraft">
      <button className="mergecraft__enter-vr" onClick={() => store.enterVR()}>
        Enter VR
      </button>
      <div className="dot" />
      <KeyboardControls map={keyboardMap}>
        <Canvas shadows camera={{ fov: 45 }}>
          <XR store={store}>
            <Sky sunPosition={[100, 20, 100]} />
            <ambientLight intensity={1.5} />
            <pointLight castShadow intensity={2.5} position={[100, 100, 100]} />
            <Physics gravity={[0, -30, 0]}>
              <Ground />
              <Player />
              <Cubes handle={handle} />
            </Physics>
            {/* selector scopes the "click to lock" handler to this
                mergecraft viewport so clicks elsewhere on the host
                page don't grab the cursor. */}
            <PointerLockControls selector=".mergecraft" />
          </XR>
        </Canvas>
      </KeyboardControls>
    </div>
  );
}
