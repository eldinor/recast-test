import { useEffect, useRef, useState } from "react";
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
  PointerEventTypes,
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
  const navigationPluginRef = useRef<any>(null);
  const housesRef = useRef<Building[]>([]);
  const workplacesRef = useRef<Building[]>([]);
  const tavernsRef = useRef<Building[]>([]);
  const clinicsRef = useRef<Building[]>([]);
  const workersRef = useRef<Worker[]>([]);
  const tileCacheRef = useRef<any>(null);
  const agentMeshesRef = useRef<Map<number, Mesh>>(new Map());

  // UI State
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showWorkerPanel, setShowWorkerPanel] = useState(false);

  // Update worker panel in real-time
  useEffect(() => {
    if (showWorkerPanel && selectedWorker) {
      const interval = setInterval(() => {
        // Find the current worker state from the ref
        const currentWorker = workersRef.current.find(w => w.agentIndex === selectedWorker.agentIndex);
        if (currentWorker) {
          setSelectedWorker({ ...currentWorker });
        }
      }, 500); // Update every 500ms

      return () => clearInterval(interval);
    }
  }, [showWorkerPanel, selectedWorker]);

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
      navigationPluginRef.current = navigationPlugin;
      console.log("Navigation plugin created:", navigationPlugin);

      const staticMesh = createStaticGround(scene);

      const maxAgentRadius = 0.15;
      const AGENT_COUNT = 20;
      const MAX_CROWD_CAPACITY = 100; // Allow up to 100 agents total (initial + dynamically added)

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
      tileCacheRef.current = tileCache;

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

      // Create buildings
      const houses = createHouses(scene, 8);
      const workplaces = createWorkplaces(scene, 3);
      const taverns = createTaverns(scene, 2);
      const clinics = createClinics(scene, 2);

      housesRef.current = houses;
      workplacesRef.current = workplaces;
      tavernsRef.current = taverns;
      clinicsRef.current = clinics;

      // Add obstacles to navmesh
      const obstacles: any[] = [];
      [...houses, ...workplaces, ...taverns, ...clinics].forEach((building) => {
        const position = building.mesh.position;

        // Use appropriate obstacle type based on building type
        if (building.type === "workplace") {
          // Workplace is a cylinder
          const obstacle = tileCache.addCylinderObstacle(
            { x: position.x, y: position.y, z: position.z },
            0.375, // radius (diameter 0.75 / 2)
            0.75   // height
          );
          obstacles.push(obstacle);
        } else if (building.type === "tavern") {
          // Tavern is a cone/pyramid - use cylinder obstacle with average radius
          const obstacle = tileCache.addCylinderObstacle(
            { x: position.x, y: position.y, z: position.z },
            0.375, // radius (diameter 0.75 / 2)
            0.6    // height
          );
          obstacles.push(obstacle);
        } else {
          // House and clinic are boxes
          const obstacle = tileCache.addBoxObstacle(
            { x: position.x, y: position.y, z: position.z },
            { x: 0.375, y: 0.5, z: 0.375 }, // half-extents (width/2, height/2, depth/2)
            0
          );
          obstacles.push(obstacle);
        }
      });

      // Wait for obstacles to be processed
      await WaitForFullTileCacheUpdate(navMesh, tileCache);
      console.log("Obstacles added and navmesh updated");

      // Update debug navmesh visualization
      const debugNavMesh2 = navigationPlugin.createDebugNavMesh(scene);
      debugNavMesh2.material = material;

      // Create crowd with capacity for initial agents + dynamically added ones
      const crowd = navigationPlugin.createCrowd(MAX_CROWD_CAPACITY, maxAgentRadius, scene);
      crowdRef.current = crowd;
      console.log("Crowd created with capacity:", MAX_CROWD_CAPACITY);

      // Create 20 agents with visual representation and assign them homes/workplaces
      const agents = [];
      const workers: Worker[] = [];

      for (let i = 0; i < AGENT_COUNT; i++) {
        const agentParams = {
          radius: 0.1 + Math.random() * 0.05,
          height: 0.5,
          maxAcceleration: 4.0,
          maxSpeed: 1.0,
          separationWeight: 1.0,
        } as IAgentParameters;

        // Assign a house to each agent
        const house = houses[i % houses.length];
        const startPosition = navigationPlugin.getClosestPoint(house.entranceZone);

        // Create agent transform
        const agentTransform = new TransformNode(`agent-transform-${i}`, scene);

        // Add agent to crowd with navmesh position
        const agentIndex = crowd.addAgent(
          startPosition,
          agentParams,
          agentTransform
        );

        console.log(`Agent ${i}: crowd.addAgent returned index ${agentIndex}`);

        if (agentIndex === -1) {
          console.error(`Failed to add agent ${i} to crowd! Position:`, startPosition);
          continue; // Skip this agent
        }

        // Create visual mesh for agent
        const agentMesh = createAgentMesh(agentParams, agentIndex, scene);
        agentMesh.parent = agentTransform;
        agentMesh.isPickable = true; // Make sure it's clickable
        agentMeshesRef.current.set(agentIndex, agentMesh);

        agents.push({ agentIndex, agentMesh, agentTransform });

        // Create worker with assigned buildings
        // Randomize initial state timer so agents don't all move at once
        const randomTimer = Math.floor(Math.random() * 3);
        const worker: Worker = {
          agentIndex,
          house,
          workplace: i < workplaces.length * 5 ? workplaces[i % workplaces.length] : null,
          happiness: 50,
          health: 100,
          state: "sleeping",
          stateTimer: randomTimer,
        };
        workers.push(worker);

        console.log(`Agent ${i} created successfully with agentIndex ${agentIndex} at house ${houses.indexOf(house)}, workplace: ${worker.workplace ? 'yes' : 'no'}`);
      }

      workersRef.current = workers;
      console.log(`All ${AGENT_COUNT} agents created with assignments`);

      // Add click handler for agents
      scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
          const pickResult = pointerInfo.pickInfo;
          if (pickResult?.hit && pickResult.pickedMesh) {
            const meshName = pickResult.pickedMesh.name;
            console.log("Clicked on mesh:", meshName, "isPickable:", pickResult.pickedMesh.isPickable);

            // Check if clicked on agent mesh (format: "agent-0", "agent-1", etc.)
            if (meshName.startsWith("agent-")) {
              // Extract the number after "agent-" using regex (handles negative numbers too)
              const match = meshName.match(/agent-(-?\d+)/);
              if (match && match[1]) {
                const agentIndex = parseInt(match[1]);
                console.log("Agent index:", agentIndex, "Workers count:", workersRef.current.length);

                if (agentIndex === -1) {
                  console.error("Clicked on agent with invalid index -1. This agent was not properly created.");
                  return;
                }

                const worker = workersRef.current.find(w => w.agentIndex === agentIndex);
                if (worker) {
                  console.log("Found worker:", worker);
                  setSelectedWorker(worker);
                  setShowWorkerPanel(true);
                } else {
                  console.log("Worker not found for agent index:", agentIndex);
                  console.log("Available workers:", workersRef.current.map(w => w.agentIndex));
                }
              } else {
                console.log("Could not extract agent index from:", meshName);
              }
            }
          } else {
            console.log("No mesh picked or no hit");
          }
        }
      });

      // Start simulation
      startSimulation(workers, crowd, navigationPlugin, taverns, clinics);
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

  // Helper functions for dynamic building/worker creation
  const addBuilding = (type: "house" | "workplace" | "tavern" | "clinic") => {
    const scene = sceneRef.current;
    const tileCache = tileCacheRef.current;
    const navigationPlugin = navigationPluginRef.current;

    if (!scene || !tileCache || !navigationPlugin) return;

    let newBuilding: Building;
    const existingPositions = [
      ...housesRef.current.map(b => b.mesh.position),
      ...workplacesRef.current.map(b => b.mesh.position),
      ...tavernsRef.current.map(b => b.mesh.position),
      ...clinicsRef.current.map(b => b.mesh.position),
    ];

    // Find non-overlapping position
    let x: number, z: number, position: Vector3;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, existingPositions, 2.5) && attempts < 50);

    if (type === "house") {
      const index = housesRef.current.length;
      const houseMat = new StandardMaterial(`houseMat-${index}`, scene);
      houseMat.diffuseColor = new Color3(0.8, 0.6, 0.4);
      const house = MeshBuilder.CreateBox(`house-${index}`, { width: 0.75, height: 0.5, depth: 0.75 }, scene);
      house.position = new Vector3(x, 0.25, z);
      house.material = houseMat;
      house.isPickable = false;
      newBuilding = { mesh: house, entranceZone: new Vector3(x + 0.8, 0, z), type: "house" };
      housesRef.current.push(newBuilding);
    } else if (type === "workplace") {
      const index = workplacesRef.current.length;
      const workMat = new StandardMaterial(`workMat-${index}`, scene);
      workMat.diffuseColor = new Color3(0.5, 0.5, 0.7);
      const workplace = MeshBuilder.CreateCylinder(`workplace-${index}`, { height: 0.75, diameter: 0.75 }, scene);
      workplace.position = new Vector3(x, 0.375, z);
      workplace.material = workMat;
      workplace.isPickable = false;
      newBuilding = { mesh: workplace, entranceZone: new Vector3(x + 0.8, 0, z), type: "workplace" };
      workplacesRef.current.push(newBuilding);
    } else if (type === "tavern") {
      const index = tavernsRef.current.length;
      const tavernMat = new StandardMaterial(`tavernMat-${index}`, scene);
      tavernMat.diffuseColor = new Color3(0.7, 0.3, 0.3);
      const tavern = MeshBuilder.CreateCylinder(`tavern-${index}`, {
        height: 0.6,
        diameterTop: 0,
        diameterBottom: 0.75
      }, scene);
      tavern.position = new Vector3(x, 0.3, z);
      tavern.material = tavernMat;
      tavern.isPickable = false;
      newBuilding = { mesh: tavern, entranceZone: new Vector3(x + 0.8, 0, z), type: "tavern" };
      tavernsRef.current.push(newBuilding);
    } else {
      const index = clinicsRef.current.length;
      const clinicMat = new StandardMaterial(`clinicMat-${index}`, scene);
      clinicMat.diffuseColor = new Color3(0.3, 0.8, 0.3);
      const clinic = MeshBuilder.CreateBox(`clinic-${index}`, { width: 0.75, height: 0.5, depth: 0.75 }, scene);
      clinic.position = new Vector3(x, 0.25, z);
      clinic.material = clinicMat;
      clinic.isPickable = false;
      newBuilding = { mesh: clinic, entranceZone: new Vector3(x + 0.8, 0, z), type: "clinic" };
      clinicsRef.current.push(newBuilding);
    }

    // Add obstacle to navmesh using appropriate type
    const buildingPos = newBuilding.mesh.position;

    if (type === "workplace") {
      // Workplace is a cylinder
      tileCache.addCylinderObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        0.375, // radius (diameter 0.75 / 2)
        0.75   // height
      );
    } else if (type === "tavern") {
      // Tavern is a cone/pyramid - use cylinder obstacle
      tileCache.addCylinderObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        0.375, // radius (diameter 0.75 / 2)
        0.6    // height
      );
    } else {
      // House and clinic are boxes
      tileCache.addBoxObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        { x: 0.375, y: 0.5, z: 0.375 }, // half-extents (width/2, height/2, depth/2)
        0
      );
    }

    console.log(`Added ${type} at position (${x.toFixed(2)}, ${z.toFixed(2)})`);
  };

  const addWorker = () => {
    const scene = sceneRef.current;
    const crowd = crowdRef.current;
    const navigationPlugin = navigationPluginRef.current;
    const houses = housesRef.current;

    if (!scene || !crowd || !navigationPlugin || houses.length === 0) return;

    const agentParams = {
      radius: 0.1 + Math.random() * 0.05,
      height: 0.5,
      maxAcceleration: 4.0,
      maxSpeed: 1.0,
      separationWeight: 1.0,
    } as IAgentParameters;

    const house = houses[Math.floor(Math.random() * houses.length)];
    const startPosition = navigationPlugin.getClosestPoint(house.entranceZone);

    const agentTransform = new TransformNode(`agent-transform-${workersRef.current.length}`, scene);
    const agentIndex = crowd.addAgent(startPosition, agentParams, agentTransform);

    console.log(`addWorker: crowd.addAgent returned index ${agentIndex}`);

    if (agentIndex === -1) {
      console.error(`Failed to add worker to crowd! Position:`, startPosition);
      return;
    }

    const agentMesh = createAgentMesh(agentParams, agentIndex, scene);
    agentMesh.parent = agentTransform;
    agentMesh.isPickable = true; // Make sure it's clickable
    agentMeshesRef.current.set(agentIndex, agentMesh);

    const worker: Worker = {
      agentIndex,
      house,
      workplace: null,
      happiness: 50,
      health: 100,
      state: "sleeping",
      stateTimer: 0,
    };
    workersRef.current.push(worker);

    console.log(`Added worker with agentIndex ${agentIndex} at house`);
  };

  const changeWorkerWorkplace = (worker: Worker, workplace: Building | null) => {
    // Find the actual worker in the ref and update it
    const workerInRef = workersRef.current.find(w => w.agentIndex === worker.agentIndex);
    if (workerInRef) {
      workerInRef.workplace = workplace;
      // Update the selected worker state to reflect the change
      setSelectedWorker({ ...workerInRef });
      console.log(`Worker ${worker.agentIndex} workplace changed to ${workplace ? 'Workplace ' + workplacesRef.current.indexOf(workplace) : 'None'}`);
    }
  };

  const changeWorkerHouse = (worker: Worker, house: Building) => {
    // Find the actual worker in the ref and update it
    const workerInRef = workersRef.current.find(w => w.agentIndex === worker.agentIndex);
    if (workerInRef) {
      workerInRef.house = house;
      // Update the selected worker state to reflect the change
      setSelectedWorker({ ...workerInRef });
      console.log(`Worker ${worker.agentIndex} house changed to House ${housesRef.current.indexOf(house)}`);
    }
  };

  return (
    <>
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

      {/* Building Controls */}
      <div style={{
        position: "absolute",
        top: 10,
        left: 10,
        background: "rgba(0, 0, 0, 0.7)",
        color: "white",
        padding: "15px",
        borderRadius: "8px",
        fontFamily: "Arial, sans-serif",
      }}>
        <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Add Buildings</h3>
        <button onClick={() => addBuilding("house")} style={buttonStyle}>
          🏠 House
        </button>
        <button onClick={() => addBuilding("workplace")} style={buttonStyle}>
          🏢 Workplace
        </button>
        <button onClick={() => addBuilding("tavern")} style={buttonStyle}>
          🍺 Tavern
        </button>
        <button onClick={() => addBuilding("clinic")} style={{...buttonStyle, background: "#2e7d32"}}>
          🏥 Clinic
        </button>
        <hr style={{ margin: "10px 0", border: "1px solid #555" }} />
        <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Add Worker</h3>
        <button onClick={addWorker} style={buttonStyle}>
          👷 Worker
        </button>
      </div>

      {/* Worker Info Panel */}
      {showWorkerPanel && selectedWorker && (
        <div style={{
          position: "absolute",
          top: 10,
          right: 10,
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "20px",
          borderRadius: "10px",
          minWidth: "320px",
          maxWidth: "350px",
          fontFamily: "Arial, sans-serif",
          maxHeight: "90vh",
          overflowY: "auto",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>👷 Worker #{selectedWorker.agentIndex}</h2>
            <button onClick={() => setShowWorkerPanel(false)} style={{
              ...buttonStyle,
              background: "#d32f2f",
              padding: "5px 10px",
              marginBottom: 0,
            }}>
              Close
            </button>
          </div>

          <div style={{ marginBottom: "10px" }}>
            <strong>State:</strong> <span style={{color: "#90caf9"}}>{selectedWorker.state}</span>
          </div>
          <div style={{ marginBottom: "10px" }}>
            <strong>Health:</strong>
            <span style={{color: selectedWorker.health > 60 ? "#4caf50" : selectedWorker.health > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.health.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "8px",
              background: "#333",
              borderRadius: "4px",
              marginTop: "5px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.health}%`,
                height: "100%",
                background: selectedWorker.health > 60 ? "#4caf50" : selectedWorker.health > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>
          <div style={{ marginBottom: "10px" }}>
            <strong>Happiness:</strong>
            <span style={{color: selectedWorker.happiness > 60 ? "#4caf50" : selectedWorker.happiness > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.happiness.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "8px",
              background: "#333",
              borderRadius: "4px",
              marginTop: "5px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.happiness}%`,
                height: "100%",
                background: selectedWorker.happiness > 60 ? "#4caf50" : selectedWorker.happiness > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>

          <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>🏠 Change House</h3>
          <select
            value={housesRef.current.indexOf(selectedWorker.house)}
            onChange={(e) => {
              const index = parseInt(e.target.value);
              const house = housesRef.current[index];
              changeWorkerHouse(selectedWorker, house);
            }}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "#333",
              color: "white",
              fontSize: "14px",
              cursor: "pointer",
              marginBottom: "15px",
            }}
          >
            {housesRef.current.map((_, index) => (
              <option key={index} value={index}>House {index}</option>
            ))}
          </select>

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>🏢 Change Workplace</h3>
          <select
            value={selectedWorker.workplace ? workplacesRef.current.indexOf(selectedWorker.workplace) : -1}
            onChange={(e) => {
              const index = parseInt(e.target.value);
              const workplace = index >= 0 ? workplacesRef.current[index] : null;
              changeWorkerWorkplace(selectedWorker, workplace);
            }}
            style={{
              width: "100%",
              padding: "8px",
              borderRadius: "4px",
              border: "1px solid #555",
              background: "#333",
              color: "white",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            <option value={-1}>No Workplace</option>
            {workplacesRef.current.map((_, index) => (
              <option key={index} value={index}>Workplace {index}</option>
            ))}
          </select>

          <div style={{
            marginTop: "15px",
            padding: "10px",
            background: "rgba(25, 118, 210, 0.2)",
            borderRadius: "4px",
            fontSize: "12px",
            color: "#90caf9",
            lineHeight: "1.5"
          }}>
            💡 <strong>Tips:</strong><br/>
            • Health decreases over time<br/>
            • Low happiness affects health<br/>
            • Visit clinic to restore health<br/>
            • Visit tavern to boost happiness
          </div>
        </div>
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 12px",
  marginBottom: "8px",
  background: "#1976d2",
  color: "white",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  fontSize: "14px",
  fontWeight: "bold",
};


function createStaticGround(scene: Scene) {
  const mat1 = new StandardMaterial("mat1", scene);
  mat1.diffuseColor = new Color3(0.8, 1, 1);

  const ground = CreateGround("ground1", { width: 20, height: 20 }, scene);
  ground.isPickable = false; // Don't block clicks on agents
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

// Types
interface Building {
  mesh: Mesh;
  entranceZone: Vector3;
  type: "house" | "workplace" | "tavern" | "clinic";
}

interface Worker {
  agentIndex: number;
  house: Building;
  workplace: Building | null;
  happiness: number;
  health: number;
  state: "sleeping" | "working" | "going_to_work" | "going_home" | "visiting_tavern" | "at_tavern" | "visiting_clinic" | "at_clinic";
  stateTimer: number;
}

// Helper function to check if position is too close to existing buildings
function isTooClose(pos: Vector3, existingPositions: Vector3[], minDistance: number): boolean {
  return existingPositions.some(existing =>
    Vector3.Distance(pos, existing) < minDistance
  );
}

// Building creation functions
function createHouses(scene: Scene, count: number): Building[] {
  const houses: Building[] = [];
  const houseMat = new StandardMaterial("houseMat", scene);
  houseMat.diffuseColor = new Color3(0.8, 0.6, 0.4);

  const positions: Vector3[] = [];
  const minDistance = 2.5; // Minimum distance between buildings

  for (let i = 0; i < count; i++) {
    let x: number, z: number, position: Vector3;
    let attempts = 0;

    // Try to find a non-overlapping position
    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, positions, minDistance) && attempts < 50);

    positions.push(position);

    const house = MeshBuilder.CreateBox(`house-${i}`, { width: 0.75, height: 0.5, depth: 0.75 }, scene);
    house.position = new Vector3(x, 0.25, z);
    house.material = houseMat;
    house.isPickable = false;

    const entranceZone = new Vector3(x + 0.8, 0, z);

    houses.push({ mesh: house, entranceZone, type: "house" });
  }

  return houses;
}

function createWorkplaces(scene: Scene, count: number): Building[] {
  const workplaces: Building[] = [];
  const workMat = new StandardMaterial("workMat", scene);
  workMat.diffuseColor = new Color3(0.5, 0.5, 0.7);

  const positions: Vector3[] = [];
  const minDistance = 2.5;

  for (let i = 0; i < count; i++) {
    let x: number, z: number, position: Vector3;
    let attempts = 0;

    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, positions, minDistance) && attempts < 50);

    positions.push(position);

    const workplace = MeshBuilder.CreateCylinder(`workplace-${i}`, { height: 0.75, diameter: 0.75 }, scene);
    workplace.position = new Vector3(x, 0.375, z);
    workplace.material = workMat;
    workplace.isPickable = false;

    const entranceZone = new Vector3(x + 0.8, 0, z);

    workplaces.push({ mesh: workplace, entranceZone, type: "workplace" });
  }

  return workplaces;
}

function createTaverns(scene: Scene, count: number): Building[] {
  const taverns: Building[] = [];
  const tavernMat = new StandardMaterial("tavernMat", scene);
  tavernMat.diffuseColor = new Color3(0.7, 0.3, 0.3);

  const positions: Vector3[] = [];
  const minDistance = 2.5;

  for (let i = 0; i < count; i++) {
    let x: number, z: number, position: Vector3;
    let attempts = 0;

    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, positions, minDistance) && attempts < 50);

    positions.push(position);

    const tavern = MeshBuilder.CreateCylinder(`tavern-${i}`, {
      height: 0.6,
      diameterTop: 0,
      diameterBottom: 0.75
    }, scene);
    tavern.position = new Vector3(x, 0.3, z);
    tavern.material = tavernMat;
    tavern.isPickable = false;

    const entranceZone = new Vector3(x + 0.8, 0, z);

    taverns.push({ mesh: tavern, entranceZone, type: "tavern" });
  }

  return taverns;
}

function createClinics(scene: Scene, count: number): Building[] {
  const clinics: Building[] = [];
  const clinicMat = new StandardMaterial("clinicMat", scene);
  clinicMat.diffuseColor = new Color3(0.3, 0.8, 0.3); // Green color for health

  const positions: Vector3[] = [];
  const minDistance = 2.5;

  for (let i = 0; i < count; i++) {
    let x: number, z: number, position: Vector3;
    let attempts = 0;

    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, positions, minDistance) && attempts < 50);

    positions.push(position);

    // Create a cross shape for clinic (using box with a cross on top)
    const clinic = MeshBuilder.CreateBox(`clinic-${i}`, { width: 0.75, height: 0.5, depth: 0.75 }, scene);
    clinic.position = new Vector3(x, 0.25, z);
    clinic.material = clinicMat;
    clinic.isPickable = false;

    const entranceZone = new Vector3(x + 0.8, 0, z);

    clinics.push({ mesh: clinic, entranceZone, type: "clinic" });
  }

  return clinics;
}

// Simulation logic
function startSimulation(
  workers: Worker[],
  crowd: any,
  navigationPlugin: any,
  taverns: Building[],
  clinics: Building[]
) {
  console.log("Starting simulation with", workers.length, "workers");

  // Update worker states every second
  setInterval(() => {
    workers.forEach((worker) => {
      worker.stateTimer += 1;

      // Health decreases over time, happiness affects health
      if (worker.stateTimer % 3 === 0) {
        worker.health = Math.max(0, worker.health - 1);
        // Low happiness decreases health faster
        if (worker.happiness < 30) {
          worker.health = Math.max(0, worker.health - 1);
        }
        // High happiness slowly restores health
        if (worker.happiness > 70) {
          worker.health = Math.min(100, worker.health + 0.5);
        }
      }

      switch (worker.state) {
        case "sleeping": {
          // Restore some health while sleeping
          worker.health = Math.min(100, worker.health + 2);

          if (worker.stateTimer > 5) {
            // Check if need clinic urgently
            if (worker.health < 30) {
              worker.state = "visiting_clinic";
              const clinic = clinics[Math.floor(Math.random() * clinics.length)];
              const target = navigationPlugin.getClosestPoint(clinic.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going to clinic (low health: ${worker.health})`);
            } else if (worker.workplace) {
              // Wake up and go to work
              worker.state = "going_to_work";
              const target = navigationPlugin.getClosestPoint(worker.workplace.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going to work`);
            } else {
              // No workplace, just stay home longer
              worker.stateTimer = 0;
            }
            worker.stateTimer = 0;
          }
          break;
        }

        case "going_to_work": {
          const workPos = crowd.getAgentPosition(worker.agentIndex);
          if (worker.workplace && Vector3.Distance(workPos, worker.workplace.entranceZone) < 0.5) {
            worker.state = "working";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} arrived at work`);
          }
          break;
        }

        case "working": {
          // Working decreases health and happiness slowly
          if (worker.stateTimer % 2 === 0) {
            worker.happiness = Math.max(0, worker.happiness - 1);
          }

          if (worker.stateTimer > 10) {
            // Check if need clinic
            if (worker.health < 40) {
              worker.state = "visiting_clinic";
              const clinic = clinics[Math.floor(Math.random() * clinics.length)];
              const target = navigationPlugin.getClosestPoint(clinic.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going to clinic from work (health: ${worker.health})`);
            } else if (worker.happiness < 60 && Math.random() > 0.5) {
              // Decide: go to tavern
              worker.state = "visiting_tavern";
              const tavern = taverns[Math.floor(Math.random() * taverns.length)];
              const target = navigationPlugin.getClosestPoint(tavern.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going to tavern`);
            } else {
              worker.state = "going_home";
              const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going home`);
            }
            worker.stateTimer = 0;
          }
          break;
        }

        case "visiting_tavern": {
          // Check if arrived at any tavern
          const tavernPos = crowd.getAgentPosition(worker.agentIndex);
          const arrivedAtTavern = taverns.some(
            (t) => Vector3.Distance(tavernPos, t.entranceZone) < 0.5
          );
          if (arrivedAtTavern) {
            worker.state = "at_tavern";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} at tavern`);
          }
          break;
        }

        case "at_tavern": {
          worker.happiness = Math.min(100, worker.happiness + 10);
          if (worker.stateTimer > 5) {
            worker.state = "going_home";
            const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
            crowd.agentGoto(worker.agentIndex, target);
            console.log(`Agent ${worker.agentIndex} leaving tavern, happiness: ${worker.happiness}`);
            worker.stateTimer = 0;
          }
          break;
        }

        case "visiting_clinic": {
          // Check if arrived at any clinic
          const clinicPos = crowd.getAgentPosition(worker.agentIndex);
          const arrivedAtClinic = clinics.some(
            (c) => Vector3.Distance(clinicPos, c.entranceZone) < 0.5
          );
          if (arrivedAtClinic) {
            worker.state = "at_clinic";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} at clinic`);
          }
          break;
        }

        case "at_clinic": {
          // Restore health at clinic
          worker.health = Math.min(100, worker.health + 15);
          if (worker.stateTimer > 3) {
            worker.state = "going_home";
            const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
            crowd.agentGoto(worker.agentIndex, target);
            console.log(`Agent ${worker.agentIndex} leaving clinic, health: ${worker.health}`);
            worker.stateTimer = 0;
          }
          break;
        }

        case "going_home": {
          const homePos = crowd.getAgentPosition(worker.agentIndex);
          if (Vector3.Distance(homePos, worker.house.entranceZone) < 0.5) {
            worker.state = "sleeping";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} arrived home`);
          }
          break;
        }
      }
    });
  }, 1000);
}