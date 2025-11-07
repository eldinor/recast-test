import { useEffect, useRef } from "react";
import {
  Engine,
  Scene,
  HemisphericLight,
  Vector3,
  MeshBuilder,
  ArcRotateCamera,
  Tools,
  Mesh,
  Color3,
  StandardMaterial,
  TransformNode,
  CreateGround,
  type IAgentParameters,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { CreateNavigationPluginAsync, WaitForFullTileCacheUpdate } from "@babylonjs/addons";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGenerators from "@recast-navigation/generators";
import type { INavMeshParametersV2 } from "@babylonjs/addons/navigation/types";

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const crowdRef = useRef<any>(null);

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

    //


    
    //

  //  const testAsset = "https://assets.babylonjs.com/meshes/alien.glb";

    (async () => {
      await RecastCore.init();
      const navigationPlugin = await CreateNavigationPluginAsync({
        instance: {
          ...RecastCore,
          ...RecastGenerators,
        },
      });
      console.log("Navigation plugin created:", navigationPlugin);

      const staticMesh = createStaticGround(scene);

      const maxAgentRadius = 0.15;
      const AGENT_COUNT = 10;

      const navmeshParameters = {
        cs: 0.1,
        ch: 0.05,
        tileSize: 32,
        maxObstacles: 32,
        keepIntermediates: true,
      } as INavMeshParametersV2;

      const nm = navigationPlugin.createNavMesh([staticMesh], navmeshParameters);
      console.log("NavMesh created", nm);
      const navMesh = nm!.navMesh;
      const tileCache = nm!.tileCache!;

      // Wait for navmesh to be fully built
      await WaitForFullTileCacheUpdate(navMesh, tileCache);
      console.log("NavMesh fully built");

      // Create debug visualization of navmesh
      const debugNavMesh = navigationPlugin.createDebugNavMesh(scene);
      const material = new StandardMaterial("debug", scene);
      material.emissiveColor = Color3.Magenta();
      material.disableLighting = true;
      material.alpha = 0.5;
      debugNavMesh.material = material;

      // Create crowd with 10 agents
      const crowd = navigationPlugin.createCrowd(AGENT_COUNT, maxAgentRadius, scene);
      crowdRef.current = crowd;
      console.log("Crowd created:", crowd);

      // Create 10 agents with visual representation
      const agents = [];
      for (let i = 0; i < AGENT_COUNT; i++) {
        const agentParams = {
          radius: 0.1 + Math.random() * 0.05,
          height: 0.5,
          maxAcceleration: 4.0,
          maxSpeed: 1.0,
          separationWeight: 1.0,
        } as IAgentParameters;

        // Calculate position in a circle around origin
        const angle = (i / AGENT_COUNT) * Math.PI * 2;
        const radius = 3;
        const position = new Vector3(
          Math.cos(angle) * radius,
          0,  // Changed from 0.5 to 0 to match ground level
          Math.sin(angle) * radius
        );

        // Get closest point on navmesh
        const navmeshPosition = navigationPlugin.getClosestPoint(position);

        // Create agent transform
        const agentTransform = new TransformNode(`agent-transform-${i}`, scene);

        // Add agent to crowd with navmesh position
        const agentIndex = crowd.addAgent(
          navmeshPosition,
          agentParams,
          agentTransform
        );

        // Create visual mesh for agent
        const agentMesh = createAgentMesh(agentParams, agentIndex, scene);
        agentMesh.parent = agentTransform;

        agents.push({ agentIndex, agentMesh, agentTransform });

        console.log(`Agent ${i} created at index ${agentIndex}, position:`, navmeshPosition);
      }

      console.log(`All ${AGENT_COUNT} agents created:`, agents);
      console.log("Crowd agents:", crowd.getAgents());

      // Move agent 2 to a target position
      const targetPos = new Vector3(4, 0, 1);
      const navmeshTarget = navigationPlugin.getClosestPoint(targetPos);
      console.log("Moving agent 2 to:", navmeshTarget);

      // Create visual marker for target
      const targetMarker = MeshBuilder.CreateSphere("target", { diameter: 0.3 }, scene);
      targetMarker.position = navmeshTarget;
      const targetMat = new StandardMaterial("targetMat", scene);
      targetMat.emissiveColor = Color3.Red();
      targetMarker.material = targetMat;

      crowd.agentGoto(2, navmeshTarget);

      // Log agent state
      setTimeout(() => {
        console.log("Agent 2 position:", crowd.getAgentPosition(2));
        console.log("Agent 2 velocity:", crowd.getAgentVelocity(2));
        console.log("Agent 2 next target:", crowd.getAgentNextTargetPath(2));
      }, 100);
    })();

    // Render loop
    let frameCount = 0;
    engine.runRenderLoop(() => {
      // Update crowd simulation
      if (crowdRef.current) {
        const deltaTime = engine.getDeltaTime() / 1000; // Convert to seconds
        crowdRef.current.update(deltaTime);

        // Debug logging every 60 frames
        frameCount++;
        if (frameCount % 60 === 0) {
          const pos = crowdRef.current.getAgentPosition(2);
          const vel = crowdRef.current.getAgentVelocity(2);
          console.log(`Frame ${frameCount}: Agent 2 pos:`, pos, "vel:", vel);
        }
      }
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


function createStaticGround(scene: Scene) {
  const mat1 = new StandardMaterial("mat1", scene);
  mat1.diffuseColor = new Color3(0.8, 1, 1);

  const ground = CreateGround("ground1", { width: 10, height: 10 }, scene);
  return ground;
}

function createAgentMesh(
  agentParams: IAgentParameters,
  agentIndex: number,
  scene: Scene
) {
  const meshName = `agent-${agentIndex}`;
  let agentMesh = scene.getMeshByName(meshName) as Mesh;
  if (!agentMesh) {
    agentMesh = MeshBuilder.CreateCylinder(
      meshName,
      { height: agentParams.height, diameter: agentParams.radius * 2 },
      scene
    );
    agentMesh.position.y += agentParams.height / 2;
    agentMesh.bakeCurrentTransformIntoVertices();
  }

  const matName = `agent-${agentIndex}`;
  const matAgent =
    (scene.getMaterialByName(matName) as StandardMaterial) ??
    new StandardMaterial(matName, scene);
  const variation = Math.random();
  matAgent.diffuseColor = new Color3(
    0.4 + variation * 0.6,
    0.3,
    1.0 - variation * 0.3
  );
  agentMesh.material = matAgent;

  return agentMesh;
}