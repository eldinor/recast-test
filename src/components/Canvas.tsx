import { useEffect, useRef } from "react";
import {
  Engine,
  Scene,
  LoadAssetContainerAsync,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  ArcRotateCamera,
  Tools,
  ImportMeshAsync,
  Mesh,
  Color3,
  StandardMaterial,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { CreateNavigationPluginAsync } from "@babylonjs/addons";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGenerators from "@recast-navigation/generators";

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);

  // Initialize scene only once
  useEffect(() => {
    if (!canvasRef.current) return;

    // Create Babylon.js engine
    const engine = new Engine(canvasRef.current, true);

    // Create scene
    const scene = new Scene(engine);
    sceneRef.current = scene;
    // scene.clearColor.set(0.1, 0.1, 0.1, 1);

    // Create default camera and light
    const camera = new ArcRotateCamera("camera", Tools.ToRadians(60), Tools.ToRadians(57.3), 10, Vector3.Zero(), scene);
    camera.attachControl(canvasRef.current, true);
    camera.setTarget(Vector3.Zero());
    camera.wheelDeltaPercentage = 0.01;

    // Add a hemispheric light
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    light.intensity = 0.7;

    // Create a simple box mesh
    const box = MeshBuilder.CreateBox("box", { size: 1 }, scene);
    box.position.x = -2;
    box.position.y = 1;

    // Create a ground plane
    MeshBuilder.CreateGround("ground", { width: 5, height: 5 }, scene);

    //

 const createStaticMesh = async  () =>{
        const mesh = await ImportMeshAsync("https://playgrounds.babylonjs.xyz/nav_test.glb", scene)
        return mesh.meshes[1]
    }
    
    //

    const testAsset = "https://assets.babylonjs.com/meshes/alien.glb";

    (async () => {
      const assetContainer = await LoadAssetContainerAsync(testAsset, scene);
      assetContainer.addAllToScene();
      assetContainer.meshes[0].position.y = 1;

await RecastCore.init();
const navigationPlugin = await CreateNavigationPluginAsync({
    instance: {
        ...RecastCore,
        ...RecastGenerators,
    },
});
console.log(navigationPlugin)
 const staticMesh = await createStaticMesh()

    const cellSize = 0.05
    const navmeshParameters = {
        cs: cellSize,
        ch: 0.2,
    }
    const { navMesh, navMeshQuery } = await navigationPlugin.createNavMeshAsync([staticMesh as  Mesh], navmeshParameters)
    console.log(navMesh, navMeshQuery)
    const debugNavMesh = navigationPlugin.createDebugNavMesh(scene)
    const material = new StandardMaterial("debug")
    material.emissiveColor = Color3.Magenta()
    material.disableLighting = true
    debugNavMesh.material = material
    })();

    // Render loop
    engine.runRenderLoop(() => {
      scene.render();
    });

    // Handle window resize
    const handleResize = () => {
      engine.resize();
    };
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("resize", handleResize);
      scene.dispose();
      engine.dispose();
    };
   
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="renderCanvas"
      style={{
        display: "block",
        width: "100%",
        height: "100vh",
        margin: 0,
        padding: 0,
        outline: "none",
      }}
    />
  );
}
