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
  const restaurantsRef = useRef<Building[]>([]);
  const bathhousesRef = useRef<Building[]>([]);
  const workersRef = useRef<Worker[]>([]);
  const tileCacheRef = useRef<any>(null);
  const agentMeshesRef = useRef<Map<number, Mesh>>(new Map());

  // UI State
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showWorkerPanel, setShowWorkerPanel] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);
  const [workersToAssign, setWorkersToAssign] = useState(1); // Slider value for assigning workers

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

  // Update building panel in real-time
  useEffect(() => {
    if (showBuildingPanel && selectedBuilding) {
      const interval = setInterval(() => {
        // Force re-render to update worker counts
        setSelectedBuilding({ ...selectedBuilding });
      }, 500); // Update every 500ms

      return () => clearInterval(interval);
    }
  }, [showBuildingPanel, selectedBuilding]);

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
      const restaurants = createRestaurants(scene, 2);
      const bathhouses = createBathhouses(scene, 2);

      housesRef.current = houses;
      workplacesRef.current = workplaces;
      tavernsRef.current = taverns;
      clinicsRef.current = clinics;
      restaurantsRef.current = restaurants;
      bathhousesRef.current = bathhouses;

      // Add obstacles to navmesh
      const obstacles: any[] = [];
      [...houses, ...workplaces, ...taverns, ...clinics, ...restaurants, ...bathhouses].forEach((building) => {
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

        // Assign a house to each agent (respecting capacity)
        let house: Building | null = null;
        for (const h of houses) {
          if (h.workers.length < h.capacity) {
            house = h;
            break;
          }
        }

        // If no house available, worker is homeless (starts at random position)
        const startPosition = house
          ? navigationPlugin.getClosestPoint(house.entranceZone)
          : navigationPlugin.getClosestPoint(new Vector3((Math.random() - 0.5) * 16, 0, (Math.random() - 0.5) * 16));

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

        // Assign workplace (respecting capacity)
        let workplace: Building | null = null;
        for (const w of workplaces) {
          if (w.workers.length < w.capacity) {
            workplace = w;
            break;
          }
        }

        // Create worker with assigned buildings
        // Randomize initial state timer so agents don't all move at once
        const randomTimer = Math.floor(Math.random() * 3);
        const worker: Worker = {
          agentIndex,
          house,
          workplace,
          happiness: 50,
          health: 100,
          // Initialize needs (start with random values between 50-100)
          hunger: 50 + Math.random() * 50,
          energy: 50 + Math.random() * 50,
          social: 50 + Math.random() * 50,
          hygiene: 50 + Math.random() * 50,
          state: "sleeping",
          stateTimer: randomTimer,
        };
        workers.push(worker);

        // Add worker to building arrays
        if (house) {
          house.workers.push(agentIndex);
        }
        if (workplace) {
          workplace.workers.push(agentIndex);
        }

        console.log(`Agent ${i} created successfully with agentIndex ${agentIndex} at house ${house ? houses.indexOf(house) : 'HOMELESS'}, workplace: ${workplace ? workplaces.indexOf(workplace) : 'UNEMPLOYED'}`);
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
            // Check if clicked on a building
            else if (meshName.startsWith("house-") || meshName.startsWith("workplace-") ||
                     meshName.startsWith("tavern-") || meshName.startsWith("clinic-") ||
                     meshName.startsWith("restaurant-") || meshName.startsWith("bathhouse-")) {
              // Extract building type and index
              const match = meshName.match(/^(\w+)-(\d+)$/);
              if (match) {
                const buildingType = match[1];
                const buildingIndex = parseInt(match[2]);

                let building: Building | null = null;
                if (buildingType === "house") building = housesRef.current[buildingIndex];
                else if (buildingType === "workplace") building = workplacesRef.current[buildingIndex];
                else if (buildingType === "tavern") building = tavernsRef.current[buildingIndex];
                else if (buildingType === "clinic") building = clinicsRef.current[buildingIndex];
                else if (buildingType === "restaurant") building = restaurantsRef.current[buildingIndex];
                else if (buildingType === "bathhouse") building = bathhousesRef.current[buildingIndex];

                if (building) {
                  console.log("Clicked on building:", buildingType, buildingIndex);
                  setSelectedBuilding(building);
                  setShowBuildingPanel(true);
                  setShowWorkerPanel(false); // Close worker panel
                }
              }
            }
          } else {
            console.log("No mesh picked or no hit");
          }
        }
      });

      // Start simulation
      startSimulation(workers, crowd, navigationPlugin, taverns, clinics, restaurants, bathhouses);
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
        //  console.log(`Frame ${frameCount}: Agent 2 pos:`, pos, "vel:", vel);
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
  const addBuilding = (type: "house" | "workplace" | "tavern" | "clinic" | "restaurant" | "bathhouse") => {
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
      ...restaurantsRef.current.map(b => b.mesh.position),
      ...bathhousesRef.current.map(b => b.mesh.position),
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
      house.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: house, entranceZone: new Vector3(x + 0.8, 0, z), type: "house", workers: [], capacity: 4 };
      housesRef.current.push(newBuilding);
    } else if (type === "workplace") {
      const index = workplacesRef.current.length;
      const workMat = new StandardMaterial(`workMat-${index}`, scene);
      workMat.diffuseColor = new Color3(0.5, 0.5, 0.7);
      const workplace = MeshBuilder.CreateCylinder(`workplace-${index}`, { height: 0.75, diameter: 0.75 }, scene);
      workplace.position = new Vector3(x, 0.375, z);
      workplace.material = workMat;
      workplace.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: workplace, entranceZone: new Vector3(x + 0.8, 0, z), type: "workplace", workers: [], capacity: 5 };
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
      tavern.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: tavern, entranceZone: new Vector3(x + 0.8, 0, z), type: "tavern", workers: [], capacity: 999 };
      tavernsRef.current.push(newBuilding);
    } else if (type === "clinic") {
      const index = clinicsRef.current.length;
      const clinicMat = new StandardMaterial(`clinicMat-${index}`, scene);
      clinicMat.diffuseColor = new Color3(0.3, 0.8, 0.3);
      const clinic = MeshBuilder.CreateBox(`clinic-${index}`, { width: 0.75, height: 0.5, depth: 0.75 }, scene);
      clinic.position = new Vector3(x, 0.25, z);
      clinic.material = clinicMat;
      clinic.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: clinic, entranceZone: new Vector3(x + 0.8, 0, z), type: "clinic", workers: [], capacity: 999 };
      clinicsRef.current.push(newBuilding);
    } else if (type === "restaurant") {
      const index = restaurantsRef.current.length;
      const restaurantMat = new StandardMaterial(`restaurantMat-${index}`, scene);
      restaurantMat.diffuseColor = new Color3(1.0, 0.7, 0.2);
      const restaurant = MeshBuilder.CreateBox(`restaurant-${index}`, { width: 0.9, height: 0.6, depth: 0.75 }, scene);
      restaurant.position = new Vector3(x, 0.3, z);
      restaurant.material = restaurantMat;
      restaurant.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: restaurant, entranceZone: new Vector3(x + 0.8, 0, z), type: "restaurant", workers: [], capacity: 999 };
      restaurantsRef.current.push(newBuilding);
    } else {
      const index = bathhousesRef.current.length;
      const bathhouseMat = new StandardMaterial(`bathhouseMat-${index}`, scene);
      bathhouseMat.diffuseColor = new Color3(0.4, 0.6, 0.9);
      const bathhouse = MeshBuilder.CreateCylinder(`bathhouse-${index}`, { height: 0.5, diameter: 0.8 }, scene);
      bathhouse.position = new Vector3(x, 0.25, z);
      bathhouse.material = bathhouseMat;
      bathhouse.isPickable = true; // Make buildings clickable
      newBuilding = { mesh: bathhouse, entranceZone: new Vector3(x + 0.8, 0, z), type: "bathhouse", workers: [], capacity: 999 };
      bathhousesRef.current.push(newBuilding);
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
    } else if (type === "bathhouse") {
      // Bathhouse is a cylinder
      tileCache.addCylinderObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        0.4,   // radius (diameter 0.8 / 2)
        0.5    // height
      );
    } else if (type === "restaurant") {
      // Restaurant is a box
      tileCache.addBoxObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        { x: 0.45, y: 0.6, z: 0.375 }, // half-extents (width/2, height/2, depth/2)
        0
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

    if (!scene || !crowd || !navigationPlugin) return;

    const agentParams = {
      radius: 0.1 + Math.random() * 0.05,
      height: 0.5,
      maxAcceleration: 4.0,
      maxSpeed: 1.0,
      separationWeight: 1.0,
    } as IAgentParameters;

    // Create worker near one of the corners of the ground
    // Ground is 20x20, so corners are at approximately (-9, -9), (9, -9), (-9, 9), (9, 9)
    const corners = [
      new Vector3(-9, 0, -9),
      new Vector3(9, 0, -9),
      new Vector3(-9, 0, 9),
      new Vector3(9, 0, 9)
    ];
    const randomCorner = corners[Math.floor(Math.random() * corners.length)];
    // Add small random offset from exact corner
    const offset = new Vector3(
      (Math.random() - 0.5) * 2,
      0,
      (Math.random() - 0.5) * 2
    );
    const spawnPosition = randomCorner.add(offset);
    const startPosition = navigationPlugin.getClosestPoint(spawnPosition);

    const agentTransform = new TransformNode(`agent-transform-${workersRef.current.length}`, scene);
    const agentIndex = crowd.addAgent(startPosition, agentParams, agentTransform);

    console.log(`addWorker: crowd.addAgent returned index ${agentIndex} at corner position`, spawnPosition);

    if (agentIndex === -1) {
      console.error(`Failed to add worker to crowd! Position:`, startPosition);
      return;
    }

    const agentMesh = createAgentMesh(agentParams, agentIndex, scene);
    agentMesh.parent = agentTransform;
    agentMesh.isPickable = true; // Make sure it's clickable
    agentMeshesRef.current.set(agentIndex, agentMesh);

    // Try to find a house with free slots
    let assignedHouse: Building | null = null;
    for (const house of houses) {
      if (house.workers.length < house.capacity) {
        assignedHouse = house;
        house.workers.push(agentIndex);
        console.log(`Assigned new worker ${agentIndex} to house with ${house.workers.length}/${house.capacity} occupancy`);
        break;
      }
    }

    const worker: Worker = {
      agentIndex,
      house: assignedHouse, // Assign to house if available, otherwise homeless
      workplace: null, // New workers start unemployed
      happiness: 50,
      health: 100,
      // Initialize needs
      hunger: 50 + Math.random() * 50,
      energy: 50 + Math.random() * 50,
      social: 50 + Math.random() * 50,
      hygiene: 50 + Math.random() * 50,
      state: "sleeping",
      stateTimer: 0,
    };
    workersRef.current.push(worker);

    if (assignedHouse) {
      console.log(`Added worker with agentIndex ${agentIndex} at corner (assigned to house, unemployed)`);
    } else {
      console.log(`Added worker with agentIndex ${agentIndex} at corner (homeless - no houses available, unemployed)`);
    }
  };

  const changeWorkerWorkplace = (worker: Worker, workplace: Building | null) => {
    // Find the actual worker in the ref and update it
    const workerInRef = workersRef.current.find(w => w.agentIndex === worker.agentIndex);
    if (workerInRef) {
      // Remove from old workplace
      if (workerInRef.workplace) {
        const oldWorkplaceIndex = workerInRef.workplace.workers.indexOf(worker.agentIndex);
        if (oldWorkplaceIndex !== -1) {
          workerInRef.workplace.workers.splice(oldWorkplaceIndex, 1);
        }
      }

      // Add to new workplace (if not null)
      if (workplace) {
        if (workplace.workers.length < workplace.capacity) {
          workplace.workers.push(worker.agentIndex);
          workerInRef.workplace = workplace;
          console.log(`Worker ${worker.agentIndex} workplace changed to building type ${workplace.type}`);
        } else {
          console.log(`Building type ${workplace.type} is full! Capacity: ${workplace.capacity}`);
          return; // Don't change if workplace is full
        }
      } else {
        workerInRef.workplace = null;
        console.log(`Worker ${worker.agentIndex} is now unemployed`);
      }

      // Update the selected worker state to reflect the change
      setSelectedWorker({ ...workerInRef });

      // If building panel is open and showing this workplace, update it
      if (selectedBuilding && selectedBuilding === workplace) {
        setSelectedBuilding({ ...workplace });
      }
    }
  };

  const changeWorkerHouse = (worker: Worker, house: Building | null) => {
    // Find the actual worker in the ref and update it
    const workerInRef = workersRef.current.find(w => w.agentIndex === worker.agentIndex);
    if (workerInRef) {
      // Remove from old house
      if (workerInRef.house) {
        const oldHouseIndex = workerInRef.house.workers.indexOf(worker.agentIndex);
        if (oldHouseIndex !== -1) {
          workerInRef.house.workers.splice(oldHouseIndex, 1);
        }
      }

      // Add to new house (if not null)
      if (house) {
        if (house.workers.length < house.capacity) {
          house.workers.push(worker.agentIndex);
          workerInRef.house = house;
          console.log(`Worker ${worker.agentIndex} house changed to House ${housesRef.current.indexOf(house)}`);
        } else {
          console.log(`House ${housesRef.current.indexOf(house)} is full! Capacity: ${house.capacity}`);
          return; // Don't change if house is full
        }
      } else {
        workerInRef.house = null;
        console.log(`Worker ${worker.agentIndex} is now homeless`);
      }

      // Update the selected worker state to reflect the change
      setSelectedWorker({ ...workerInRef });

      // If building panel is open and showing this house, update it
      if (selectedBuilding && selectedBuilding === house) {
        setSelectedBuilding({ ...house });
      }
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
        <button onClick={() => addBuilding("restaurant")} style={{...buttonStyle, background: "#ff8c00"}}>
          🍽️ Restaurant
        </button>
        <button onClick={() => addBuilding("bathhouse")} style={{...buttonStyle, background: "#4682b4"}}>
          🛁 Bathhouse
        </button>
        <hr style={{ margin: "10px 0", border: "1px solid #555" }} />
        <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Add Worker</h3>
        <button onClick={addWorker} style={buttonStyle}>
          👷 Worker
        </button>
      </div>

      {/* Building Info Panel */}
      {showBuildingPanel && selectedBuilding && (
        <div style={{
          position: "absolute",
          top: 10,
          left: 10,
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "20px",
          borderRadius: "8px",
          minWidth: "300px",
          maxWidth: "400px",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          zIndex: 1000,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px" }}>
            <h2 style={{ margin: 0, fontSize: "20px" }}>
              {selectedBuilding.type === "house" && "🏠 House"}
              {selectedBuilding.type === "workplace" && "🏢 Workplace"}
              {selectedBuilding.type === "tavern" && "🍺 Tavern"}
              {selectedBuilding.type === "clinic" && "🏥 Clinic"}
              {selectedBuilding.type === "restaurant" && "🍽️ Restaurant"}
              {selectedBuilding.type === "bathhouse" && "🛁 Bathhouse"}
              {" "}
              {selectedBuilding.type === "house" && housesRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
              {selectedBuilding.type === "workplace" && workplacesRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
              {selectedBuilding.type === "tavern" && tavernsRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
              {selectedBuilding.type === "clinic" && clinicsRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
              {selectedBuilding.type === "restaurant" && restaurantsRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
              {selectedBuilding.type === "bathhouse" && bathhousesRef.current.findIndex(b => b.mesh === selectedBuilding.mesh)}
            </h2>
            <button
              onClick={() => setShowBuildingPanel(false)}
              style={{
                background: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ✕
            </button>
          </div>

          <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

          {/* For service buildings, show staff and client info separately */}
          {(selectedBuilding.type === "clinic" || selectedBuilding.type === "restaurant" || selectedBuilding.type === "bathhouse" || selectedBuilding.type === "tavern") ? (
            <>
              <div style={{ marginBottom: "15px" }}>
                <strong>�‍⚕️ Staff:</strong>
                <div style={{ fontSize: "24px", marginTop: "5px" }}>
                  {selectedBuilding.workers.length} / {selectedBuilding.capacity}
                </div>
                <div style={{
                  width: "100%",
                  height: "10px",
                  background: "#333",
                  borderRadius: "5px",
                  marginTop: "8px",
                  overflow: "hidden"
                }}>
                  <div style={{
                    width: `${(selectedBuilding.workers.length / selectedBuilding.capacity) * 100}%`,
                    height: "100%",
                    background: selectedBuilding.workers.length === 0 ? "#f44336" : selectedBuilding.workers.length >= selectedBuilding.capacity ? "#ff9800" : "#4caf50",
                    transition: "width 0.3s"
                  }}></div>
                </div>
                {selectedBuilding.workers.length === 0 && (
                  <div style={{ color: "#f44336", fontSize: "12px", marginTop: "5px", fontStyle: "italic" }}>
                    ⚠️ No staff - building cannot serve clients!
                  </div>
                )}
              </div>

              <div style={{ marginBottom: "15px" }}>
                <strong>🧑‍🤝‍🧑 Clients:</strong>
                <div style={{ fontSize: "24px", marginTop: "5px" }}>
                  {selectedBuilding.currentClients?.length || 0} / {selectedBuilding.clientCapacity || 0}
                </div>
                <div style={{
                  width: "100%",
                  height: "10px",
                  background: "#333",
                  borderRadius: "5px",
                  marginTop: "8px",
                  overflow: "hidden"
                }}>
                  <div style={{
                    width: `${((selectedBuilding.currentClients?.length || 0) / (selectedBuilding.clientCapacity || 1)) * 100}%`,
                    height: "100%",
                    background: (selectedBuilding.currentClients?.length || 0) >= (selectedBuilding.clientCapacity || 0) ? "#f44336" : "#2196f3",
                    transition: "width 0.3s"
                  }}></div>
                </div>
              </div>
            </>
          ) : (
            <div style={{ marginBottom: "15px" }}>
              <strong>�📊 Occupancy:</strong>
              <div style={{ fontSize: "24px", marginTop: "5px" }}>
                {selectedBuilding.workers.length} / {selectedBuilding.capacity}
              </div>
              <div style={{
                width: "100%",
                height: "10px",
                background: "#333",
                borderRadius: "5px",
                marginTop: "8px",
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${(selectedBuilding.workers.length / selectedBuilding.capacity) * 100}%`,
                  height: "100%",
                  background: selectedBuilding.workers.length >= selectedBuilding.capacity ? "#f44336" : "#4caf50",
                  transition: "width 0.3s"
                }}></div>
              </div>
            </div>
          )}

          <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>
            {(selectedBuilding.type === "clinic" || selectedBuilding.type === "restaurant" || selectedBuilding.type === "bathhouse" || selectedBuilding.type === "tavern") ? "👨‍⚕️ Staff Members" : "👷 Assigned Workers"}
          </h3>
          {selectedBuilding.workers.length === 0 ? (
            <div style={{ color: "#999", fontStyle: "italic", padding: "10px 0" }}>
              No workers assigned
            </div>
          ) : (
            <div style={{ maxHeight: "300px", overflowY: "auto" }}>
              {selectedBuilding.workers.map((agentIndex) => {
                const worker = workersRef.current.find(w => w.agentIndex === agentIndex);
                if (!worker) return null;

                return (
                  <div
                    key={agentIndex}
                    onClick={() => {
                      setSelectedWorker(worker);
                      setShowWorkerPanel(true);
                      // Keep Building Panel open - don't close it
                    }}
                    style={{
                      padding: "10px",
                      marginBottom: "8px",
                      background: "rgba(255, 255, 255, 0.1)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.2)"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)"}
                  >
                    <div style={{ fontWeight: "bold", marginBottom: "5px" }}>
                      Worker {agentIndex}
                    </div>
                    <div style={{ fontSize: "12px", color: "#ccc" }}>
                      ❤️ {worker.health.toFixed(0)} | 😊 {worker.happiness.toFixed(0)} |
                      🍽️ {worker.hunger.toFixed(0)} | ⚡ {worker.energy.toFixed(0)}
                    </div>
                    <div style={{ fontSize: "12px", color: "#999", marginTop: "3px" }}>
                      State: {worker.state}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Assign Free Workers Button - for workplaces and service buildings */}
          {(selectedBuilding.type === "workplace" || selectedBuilding.type === "clinic" ||
            selectedBuilding.type === "restaurant" || selectedBuilding.type === "bathhouse" ||
            selectedBuilding.type === "tavern") && selectedBuilding.workers.length < selectedBuilding.capacity && (() => {
              const freeWorkersCount = workersRef.current.filter(w => !w.workplace).length;
              const maxAssignable = Math.min(freeWorkersCount, selectedBuilding.capacity - selectedBuilding.workers.length);

              return maxAssignable > 0 && (
                <>
                  <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

                  {/* Slider to choose how many workers to assign */}
                  <div style={{ marginBottom: "10px" }}>
                    <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                      Workers to assign: <strong>{Math.min(workersToAssign, maxAssignable)}</strong>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max={maxAssignable}
                      value={Math.min(workersToAssign, maxAssignable)}
                      onChange={(e) => setWorkersToAssign(parseInt(e.target.value))}
                      style={{
                        width: "100%",
                        cursor: "pointer",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#999", marginTop: "3px" }}>
                      <span>1</span>
                      <span>Max: {maxAssignable}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const freeWorkers = workersRef.current.filter(w => !w.workplace);
                      const numToAssign = Math.min(workersToAssign, freeWorkers.length, selectedBuilding.capacity - selectedBuilding.workers.length);

                      for (let i = 0; i < numToAssign; i++) {
                        changeWorkerWorkplace(freeWorkers[i], selectedBuilding);
                      }

                      alert(`Assigned ${numToAssign} free worker(s) to this building!`);
                    }}
                    style={{
                      width: "100%",
                      padding: "10px",
                      background: "#4caf50",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#45a049"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "#4caf50"}
                  >
                    👷 Assign {Math.min(workersToAssign, maxAssignable)} Free Worker{Math.min(workersToAssign, maxAssignable) > 1 ? 's' : ''} ({freeWorkersCount} available)
                  </button>
                </>
              );
            })()}

          {/* Assign Homeless Workers Button - for houses only */}
          {selectedBuilding.type === "house" && selectedBuilding.workers.length < selectedBuilding.capacity && (() => {
            const homelessCount = workersRef.current.filter(w => !w.house).length;
            const maxAssignable = Math.min(homelessCount, selectedBuilding.capacity - selectedBuilding.workers.length);

            return maxAssignable > 0 && (
              <>
                <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

                {/* Slider to choose how many homeless workers to assign */}
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ display: "block", marginBottom: "5px", fontSize: "14px" }}>
                    Homeless to assign: <strong>{Math.min(workersToAssign, maxAssignable)}</strong>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max={maxAssignable}
                    value={Math.min(workersToAssign, maxAssignable)}
                    onChange={(e) => setWorkersToAssign(parseInt(e.target.value))}
                    style={{
                      width: "100%",
                      cursor: "pointer",
                    }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#999", marginTop: "3px" }}>
                    <span>1</span>
                    <span>Max: {maxAssignable}</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    const homelessWorkers = workersRef.current.filter(w => !w.house);
                    const numToAssign = Math.min(workersToAssign, homelessWorkers.length, selectedBuilding.capacity - selectedBuilding.workers.length);

                    for (let i = 0; i < numToAssign; i++) {
                      changeWorkerHouse(homelessWorkers[i], selectedBuilding);
                    }

                    alert(`Assigned ${numToAssign} homeless worker(s) to this house!`);
                  }}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "#ff9800",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "bold",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "#fb8c00"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "#ff9800"}
                >
                  🏠 Assign {Math.min(workersToAssign, maxAssignable)} Homeless Worker{Math.min(workersToAssign, maxAssignable) > 1 ? 's' : ''} ({homelessCount} available)
                </button>
              </>
            );
          })()}
        </div>
      )}

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

          <h3 style={{ margin: "10px 0 5px 0", fontSize: "16px" }}>📊 Needs</h3>

          {/* Hunger */}
          <div style={{ marginBottom: "10px" }}>
            <strong>🍽️ Hunger:</strong>
            <span style={{color: selectedWorker.hunger > 60 ? "#4caf50" : selectedWorker.hunger > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.hunger.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "6px",
              background: "#333",
              borderRadius: "3px",
              marginTop: "3px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.hunger}%`,
                height: "100%",
                background: selectedWorker.hunger > 60 ? "#4caf50" : selectedWorker.hunger > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>

          {/* Energy */}
          <div style={{ marginBottom: "10px" }}>
            <strong>⚡ Energy:</strong>
            <span style={{color: selectedWorker.energy > 60 ? "#4caf50" : selectedWorker.energy > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.energy.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "6px",
              background: "#333",
              borderRadius: "3px",
              marginTop: "3px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.energy}%`,
                height: "100%",
                background: selectedWorker.energy > 60 ? "#4caf50" : selectedWorker.energy > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>

          {/* Social */}
          <div style={{ marginBottom: "10px" }}>
            <strong>👥 Social:</strong>
            <span style={{color: selectedWorker.social > 60 ? "#4caf50" : selectedWorker.social > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.social.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "6px",
              background: "#333",
              borderRadius: "3px",
              marginTop: "3px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.social}%`,
                height: "100%",
                background: selectedWorker.social > 60 ? "#4caf50" : selectedWorker.social > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>

          {/* Hygiene */}
          <div style={{ marginBottom: "10px" }}>
            <strong>🛁 Hygiene:</strong>
            <span style={{color: selectedWorker.hygiene > 60 ? "#4caf50" : selectedWorker.hygiene > 30 ? "#ff9800" : "#f44336"}}>
              {" "}{selectedWorker.hygiene.toFixed(0)}
            </span>
            <div style={{
              width: "100%",
              height: "6px",
              background: "#333",
              borderRadius: "3px",
              marginTop: "3px",
              overflow: "hidden"
            }}>
              <div style={{
                width: `${selectedWorker.hygiene}%`,
                height: "100%",
                background: selectedWorker.hygiene > 60 ? "#4caf50" : selectedWorker.hygiene > 30 ? "#ff9800" : "#f44336",
                transition: "width 0.3s"
              }}></div>
            </div>
          </div>

          <hr style={{ margin: "15px 0", border: "1px solid #555" }} />

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>🏠 Change House</h3>
          <select
            value={selectedWorker.house ? housesRef.current.indexOf(selectedWorker.house) : -1}
            onChange={(e) => {
              const index = parseInt(e.target.value);
              const house = index >= 0 ? housesRef.current[index] : null;
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
            <option value={-1}>Homeless</option>
            {housesRef.current.map((house, index) => (
              <option key={index} value={index}>
                House {index} ({house.workers.length}/{house.capacity})
              </option>
            ))}
          </select>

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>🏢 Change Workplace</h3>
          <select
            value={
              selectedWorker.workplace
                ? (() => {
                    const wpIndex = workplacesRef.current.indexOf(selectedWorker.workplace);
                    if (wpIndex !== -1) return `workplace-${wpIndex}`;
                    const clinicIndex = clinicsRef.current.indexOf(selectedWorker.workplace);
                    if (clinicIndex !== -1) return `clinic-${clinicIndex}`;
                    const restaurantIndex = restaurantsRef.current.indexOf(selectedWorker.workplace);
                    if (restaurantIndex !== -1) return `restaurant-${restaurantIndex}`;
                    const bathhouseIndex = bathhousesRef.current.indexOf(selectedWorker.workplace);
                    if (bathhouseIndex !== -1) return `bathhouse-${bathhouseIndex}`;
                    const tavernIndex = tavernsRef.current.indexOf(selectedWorker.workplace);
                    if (tavernIndex !== -1) return `tavern-${tavernIndex}`;
                    return "none";
                  })()
                : "none"
            }
            onChange={(e) => {
              const value = e.target.value;
              if (value === "none") {
                changeWorkerWorkplace(selectedWorker, null);
              } else {
                const [type, indexStr] = value.split("-");
                const index = parseInt(indexStr);
                let workplace: Building | null = null;
                if (type === "workplace") workplace = workplacesRef.current[index];
                else if (type === "clinic") workplace = clinicsRef.current[index];
                else if (type === "restaurant") workplace = restaurantsRef.current[index];
                else if (type === "bathhouse") workplace = bathhousesRef.current[index];
                else if (type === "tavern") workplace = tavernsRef.current[index];
                if (workplace) changeWorkerWorkplace(selectedWorker, workplace);
              }
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
            <option value="none">No Workplace</option>
            <optgroup label="🏭 Workplaces">
              {workplacesRef.current.map((workplace, index) => (
                <option key={`workplace-${index}`} value={`workplace-${index}`}>
                  Workplace {index} ({workplace.workers.length}/{workplace.capacity})
                </option>
              ))}
            </optgroup>
            <optgroup label="🏥 Clinics">
              {clinicsRef.current.map((clinic, index) => (
                <option key={`clinic-${index}`} value={`clinic-${index}`}>
                  Clinic {index} ({clinic.workers.length}/{clinic.capacity})
                </option>
              ))}
            </optgroup>
            <optgroup label="🍽️ Restaurants">
              {restaurantsRef.current.map((restaurant, index) => (
                <option key={`restaurant-${index}`} value={`restaurant-${index}`}>
                  Restaurant {index} ({restaurant.workers.length}/{restaurant.capacity})
                </option>
              ))}
            </optgroup>
            <optgroup label="🛁 Bathhouses">
              {bathhousesRef.current.map((bathhouse, index) => (
                <option key={`bathhouse-${index}`} value={`bathhouse-${index}`}>
                  Bathhouse {index} ({bathhouse.workers.length}/{bathhouse.capacity})
                </option>
              ))}
            </optgroup>
            <optgroup label="🍺 Taverns">
              {tavernsRef.current.map((tavern, index) => (
                <option key={`tavern-${index}`} value={`tavern-${index}`}>
                  Tavern {index} ({tavern.workers.length}/{tavern.capacity})
                </option>
              ))}
            </optgroup>
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
  type: "house" | "workplace" | "tavern" | "clinic" | "restaurant" | "bathhouse";
  workers: number[]; // Array of worker agent indices assigned to this building (staff for service buildings)
  capacity: number; // Maximum workers/staff allowed
  clientCapacity?: number; // Maximum clients that can be served (for service buildings)
  currentClients?: number[]; // Array of client worker indices currently being served
}

interface Worker {
  agentIndex: number;
  house: Building | null; // Can be null if homeless
  workplace: Building | null;
  happiness: number;
  health: number;
  // Needs system (0-100, where 100 is fully satisfied)
  hunger: number;      // Decreases over time, restored at restaurant
  energy: number;      // Decreases while working, restored while sleeping
  social: number;      // Decreases over time, restored at tavern
  hygiene: number;     // Decreases over time, restored at bathhouse
  state: "sleeping" | "working" | "going_to_work" | "going_home" | "visiting_tavern" | "at_tavern" | "visiting_clinic" | "at_clinic" | "visiting_restaurant" | "at_restaurant" | "visiting_bathhouse" | "at_bathhouse";
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
    house.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    houses.push({ mesh: house, entranceZone, type: "house", workers: [], capacity: 4 });
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
    workplace.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    workplaces.push({ mesh: workplace, entranceZone, type: "workplace", workers: [], capacity: 5 });
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
    tavern.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    // Taverns have 2 worker slots (staff) and can serve 20 clients
    taverns.push({
      mesh: tavern,
      entranceZone,
      type: "tavern",
      workers: [],
      capacity: 2,
      clientCapacity: 20,
      currentClients: []
    });
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
    clinic.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    // Clinics have 4 worker slots (staff) and can serve 20 clients
    clinics.push({
      mesh: clinic,
      entranceZone,
      type: "clinic",
      workers: [],
      capacity: 4,
      clientCapacity: 20,
      currentClients: []
    });
  }

  return clinics;
}

function createRestaurants(scene: Scene, count: number): Building[] {
  const restaurants: Building[] = [];
  const restaurantMat = new StandardMaterial("restaurantMat", scene);
  restaurantMat.diffuseColor = new Color3(1.0, 0.7, 0.2); // Orange color for food

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

    // Create restaurant as a box with a flat roof (like a diner)
    const restaurant = MeshBuilder.CreateBox(`restaurant-${i}`, { width: 0.9, height: 0.6, depth: 0.75 }, scene);
    restaurant.position = new Vector3(x, 0.3, z);
    restaurant.material = restaurantMat;
    restaurant.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    // Restaurants have 4 worker slots (staff) and can serve 20 clients
    restaurants.push({
      mesh: restaurant,
      entranceZone,
      type: "restaurant",
      workers: [],
      capacity: 4,
      clientCapacity: 20,
      currentClients: []
    });
  }

  return restaurants;
}

function createBathhouses(scene: Scene, count: number): Building[] {
  const bathhouses: Building[] = [];
  const bathhouseMat = new StandardMaterial("bathhouseMat", scene);
  bathhouseMat.diffuseColor = new Color3(0.4, 0.6, 0.9); // Light blue color for water/cleanliness

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

    // Create bathhouse as a cylinder (like a Roman bath)
    const bathhouse = MeshBuilder.CreateCylinder(`bathhouse-${i}`, { height: 0.5, diameter: 0.8 }, scene);
    bathhouse.position = new Vector3(x, 0.25, z);
    bathhouse.material = bathhouseMat;
    bathhouse.isPickable = true; // Make buildings clickable

    const entranceZone = new Vector3(x + 0.8, 0, z);

    // Bathhouses have 2 worker slots (staff) and can serve 20 clients
    bathhouses.push({
      mesh: bathhouse,
      entranceZone,
      type: "bathhouse",
      workers: [],
      capacity: 2,
      clientCapacity: 20,
      currentClients: []
    });
  }

  return bathhouses;
}

// Helper function to check if a service building can accept clients
function canServiceBuilding(building: Building): boolean {
  // Service buildings (clinic, restaurant, bathhouse, tavern) need staff to operate
  if (building.type === "clinic" || building.type === "restaurant" || building.type === "bathhouse" || building.type === "tavern") {
    // Must have at least 1 staff member
    if (building.workers.length === 0) {
      return false;
    }

    // Check if there's capacity for more clients
    const currentClients = building.currentClients?.length || 0;
    const clientCapacity = building.clientCapacity || 0;

    return currentClients < clientCapacity;
  }

  // Other buildings (house, workplace) don't need this check
  return true;
}

// Helper function to add client to service building
function addClientToBuilding(building: Building, workerIndex: number): boolean {
  if (!building.currentClients) {
    building.currentClients = [];
  }

  if (canServiceBuilding(building) && !building.currentClients.includes(workerIndex)) {
    building.currentClients.push(workerIndex);
    return true;
  }

  return false;
}

// Helper function to remove client from service building
function removeClientFromBuilding(building: Building, workerIndex: number): void {
  if (building.currentClients) {
    const index = building.currentClients.indexOf(workerIndex);
    if (index !== -1) {
      building.currentClients.splice(index, 1);
    }
  }
}

// Simulation logic
function startSimulation(
  workers: Worker[],
  crowd: any,
  navigationPlugin: any,
  taverns: Building[],
  clinics: Building[],
  restaurants: Building[],
  bathhouses: Building[]
) {
  console.log("Starting simulation with", workers.length, "workers");

  // Update worker states every second
  setInterval(() => {
    workers.forEach((worker) => {
      worker.stateTimer += 1;

      // === NEEDS DECAY SYSTEM ===
      // Hunger decreases over time (faster when working)
      if (worker.state === "working") {
        worker.hunger = Math.max(0, worker.hunger - 0.5); // Faster decay at work
      } else {
        worker.hunger = Math.max(0, worker.hunger - 0.2); // Slower decay otherwise
      }

      // Energy decreases while working, restored while sleeping
      if (worker.state === "working") {
        worker.energy = Math.max(0, worker.energy - 0.8); // Work drains energy
      } else if (worker.state === "sleeping") {
        worker.energy = Math.min(100, worker.energy + 2); // Sleep restores energy
      } else {
        worker.energy = Math.max(0, worker.energy - 0.1); // Slow decay otherwise
      }

      // Social decreases over time, restored at tavern
      if (worker.state === "at_tavern") {
        worker.social = Math.min(100, worker.social + 3); // Tavern restores social
      } else {
        worker.social = Math.max(0, worker.social - 0.15); // Slow decay
      }

      // Hygiene decreases over time (faster when working)
      if (worker.state === "working") {
        worker.hygiene = Math.max(0, worker.hygiene - 0.4); // Faster decay at work
      } else if (worker.state === "at_bathhouse") {
        worker.hygiene = Math.min(100, worker.hygiene + 5); // Bathhouse restores hygiene
      } else {
        worker.hygiene = Math.max(0, worker.hygiene - 0.15); // Slow decay otherwise
      }

      // === NEEDS AFFECT HAPPINESS AND HEALTH ===
      // Calculate average needs satisfaction
      const avgNeeds = (worker.hunger + worker.energy + worker.social + worker.hygiene) / 4;

      // Low needs decrease happiness
      if (avgNeeds < 30) {
        worker.happiness = Math.max(0, worker.happiness - 0.5);
      } else if (avgNeeds > 70) {
        worker.happiness = Math.min(100, worker.happiness + 0.3);
      }

      // Critical needs affect health
      if (worker.hunger < 20 || worker.energy < 20) {
        worker.health = Math.max(0, worker.health - 0.5); // Starvation or exhaustion damages health
      }

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
          // Homeless workers suffer health penalty while sleeping outside
          if (!worker.house) {
            worker.health = Math.max(0, worker.health - 1); // Health penalty for homelessness
            worker.happiness = Math.max(0, worker.happiness - 0.5); // Unhappy being homeless
          } else {
            // Restore some health while sleeping in a house
            worker.health = Math.min(100, worker.health + 2);
          }

          // Small random chance of getting ill while sleeping - 0.5% chance per tick
          if (Math.random() < 0.005) {
            worker.health = Math.max(0, worker.health - 20);
            console.log(`🤒 Agent ${worker.agentIndex} got ill while sleeping! Health: ${worker.health}`);
          }

          if (worker.stateTimer > 5) {
            // Check if need clinic urgently
            if (worker.health < 30 && clinics.length > 0) {
              // Find a staffed clinic with capacity
              const availableClinics = clinics.filter(c => canServiceBuilding(c));
              if (availableClinics.length > 0) {
                worker.state = "visiting_clinic";
                const clinic = availableClinics[Math.floor(Math.random() * availableClinics.length)];
                const target = navigationPlugin.getClosestPoint(clinic.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(clinic, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to clinic (low health: ${worker.health})`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs clinic but none are staffed!`);
                // Go to work anyway if no clinic available
                if (worker.workplace) {
                  worker.state = "going_to_work";
                  const target = navigationPlugin.getClosestPoint(worker.workplace.entranceZone);
                  crowd.agentGoto(worker.agentIndex, target);
                }
              }
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

          // Random chance of workplace accident (trauma) - 2% chance per tick
          if (Math.random() < 0.02) {
            worker.health = Math.max(0, worker.health - 25);
            console.log(`⚠️ Agent ${worker.agentIndex} had a workplace accident! Health: ${worker.health}`);
          }

          // Random chance of getting ill - 1% chance per tick
          if (Math.random() < 0.01) {
            worker.health = Math.max(0, worker.health - 15);
            console.log(`🤒 Agent ${worker.agentIndex} got ill at work! Health: ${worker.health}`);
          }

          if (worker.stateTimer > 10) {
            // Priority system: Check critical needs first

            // 1. Health critical - go to clinic
            if (worker.health < 40 && clinics.length > 0) {
              // Find a staffed clinic with capacity
              const availableClinics = clinics.filter(c => canServiceBuilding(c));
              if (availableClinics.length > 0) {
                worker.state = "visiting_clinic";
                const clinic = availableClinics[Math.floor(Math.random() * availableClinics.length)];
                const target = navigationPlugin.getClosestPoint(clinic.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(clinic, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to clinic from work (health: ${worker.health})`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs clinic but none are staffed! Continuing work.`);
              }
            }
            // 2. Hunger critical - go to restaurant
            else if (worker.hunger < 30 && restaurants.length > 0) {
              // Find a staffed restaurant with capacity
              const availableRestaurants = restaurants.filter(r => canServiceBuilding(r));
              if (availableRestaurants.length > 0) {
                worker.state = "visiting_restaurant";
                const restaurant = availableRestaurants[Math.floor(Math.random() * availableRestaurants.length)];
                const target = navigationPlugin.getClosestPoint(restaurant.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(restaurant, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to restaurant (hunger: ${worker.hunger.toFixed(0)})`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} is hungry but no restaurants are staffed!`);
              }
            }
            // 3. Energy critical - go home to sleep
            else if (worker.energy < 25) {
              worker.state = "going_home";
              if (worker.house) {
                const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                console.log(`Agent ${worker.agentIndex} going home (exhausted, energy: ${worker.energy.toFixed(0)})`);
              } else {
                // Homeless - just sleep where they are
                worker.state = "sleeping";
                worker.stateTimer = 0;
                console.log(`Agent ${worker.agentIndex} is homeless, sleeping outside (exhausted)`);
              }
            }
            // 4. Hygiene low - go to bathhouse
            else if (worker.hygiene < 30 && bathhouses.length > 0) {
              // Find a staffed bathhouse with capacity
              const availableBathhouses = bathhouses.filter(b => canServiceBuilding(b));
              if (availableBathhouses.length > 0) {
                worker.state = "visiting_bathhouse";
                const bathhouse = availableBathhouses[Math.floor(Math.random() * availableBathhouses.length)];
                const target = navigationPlugin.getClosestPoint(bathhouse.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(bathhouse, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to bathhouse (hygiene: ${worker.hygiene.toFixed(0)})`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs bathhouse but none are staffed!`);
              }
            }
            // 5. Social low or happiness low - go to tavern
            else if ((worker.social < 40 || worker.happiness < 60) && Math.random() > 0.5 && taverns.length > 0) {
              // Find a staffed tavern with capacity
              const availableTaverns = taverns.filter(t => canServiceBuilding(t));
              if (availableTaverns.length > 0) {
                worker.state = "visiting_tavern";
                const tavern = availableTaverns[Math.floor(Math.random() * availableTaverns.length)];
                const target = navigationPlugin.getClosestPoint(tavern.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(tavern, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to tavern (social: ${worker.social.toFixed(0)})`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs tavern but none are staffed!`);
              }
            }
            // 6. All needs satisfied - go home
            else {
              if (worker.house) {
                worker.state = "going_home";
                const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                console.log(`Agent ${worker.agentIndex} going home`);
              } else {
                // Homeless - just sleep where they are
                worker.state = "sleeping";
                worker.stateTimer = 0;
                console.log(`Agent ${worker.agentIndex} is homeless, sleeping outside`);
              }
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
          worker.social = Math.min(100, worker.social + 5); // Socializing at tavern
          if (worker.stateTimer > 5) {
            // Remove from tavern's client list
            taverns.forEach(t => removeClientFromBuilding(t, worker.agentIndex));

            if (worker.house) {
              worker.state = "going_home";
              const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} leaving tavern, happiness: ${worker.happiness}`);
            } else {
              // Homeless - just sleep where they are
              worker.state = "sleeping";
              console.log(`Agent ${worker.agentIndex} leaving tavern (homeless), sleeping outside`);
            }
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
            // Remove from clinic's client list
            clinics.forEach(c => removeClientFromBuilding(c, worker.agentIndex));

            if (worker.house) {
              worker.state = "going_home";
              const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} leaving clinic, health: ${worker.health}`);
            } else {
              // Homeless - just sleep where they are
              worker.state = "sleeping";
              console.log(`Agent ${worker.agentIndex} leaving clinic (homeless), sleeping outside`);
            }
            worker.stateTimer = 0;
          }
          break;
        }

        case "visiting_restaurant": {
          // Check if arrived at any restaurant
          const restaurantPos = crowd.getAgentPosition(worker.agentIndex);
          const arrivedAtRestaurant = restaurants.some(
            (r) => Vector3.Distance(restaurantPos, r.entranceZone) < 0.5
          );
          if (arrivedAtRestaurant) {
            worker.state = "at_restaurant";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} at restaurant`);
          }
          break;
        }

        case "at_restaurant": {
          // Restore hunger at restaurant
          worker.hunger = Math.min(100, worker.hunger + 10);
          worker.happiness = Math.min(100, worker.happiness + 2); // Eating makes you happy
          if (worker.stateTimer > 3) {
            // Remove from restaurant's client list
            restaurants.forEach(r => removeClientFromBuilding(r, worker.agentIndex));

            // After eating, decide where to go
            if (worker.hygiene < 30 && bathhouses.length > 0) {
              // Find a staffed bathhouse with capacity
              const availableBathhouses = bathhouses.filter(b => canServiceBuilding(b));
              if (availableBathhouses.length > 0) {
                worker.state = "visiting_bathhouse";
                const bathhouse = availableBathhouses[Math.floor(Math.random() * availableBathhouses.length)];
                const target = navigationPlugin.getClosestPoint(bathhouse.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(bathhouse, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to bathhouse after eating`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs bathhouse but none are staffed!`);
              }
            } else if (worker.social < 40 && taverns.length > 0) {
              // Find a staffed tavern with capacity
              const availableTaverns = taverns.filter(t => canServiceBuilding(t));
              if (availableTaverns.length > 0) {
                worker.state = "visiting_tavern";
                const tavern = availableTaverns[Math.floor(Math.random() * availableTaverns.length)];
                const target = navigationPlugin.getClosestPoint(tavern.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(tavern, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to tavern after eating`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs tavern but none are staffed!`);
              }
            } else if (worker.house) {
              worker.state = "going_home";
              const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going home after eating, hunger: ${worker.hunger.toFixed(0)}`);
            } else {
              // Homeless - just sleep where they are
              worker.state = "sleeping";
              console.log(`Agent ${worker.agentIndex} done eating (homeless), sleeping outside`);
            }
            worker.stateTimer = 0;
          }
          break;
        }

        case "visiting_bathhouse": {
          // Check if arrived at any bathhouse
          const bathhousePos = crowd.getAgentPosition(worker.agentIndex);
          const arrivedAtBathhouse = bathhouses.some(
            (b) => Vector3.Distance(bathhousePos, b.entranceZone) < 0.5
          );
          if (arrivedAtBathhouse) {
            worker.state = "at_bathhouse";
            worker.stateTimer = 0;
            console.log(`Agent ${worker.agentIndex} at bathhouse`);
          }
          break;
        }

        case "at_bathhouse": {
          // Restore hygiene at bathhouse
          worker.hygiene = Math.min(100, worker.hygiene + 12);
          worker.happiness = Math.min(100, worker.happiness + 1); // Being clean makes you happy
          if (worker.stateTimer > 3) {
            // Remove from bathhouse's client list
            bathhouses.forEach(b => removeClientFromBuilding(b, worker.agentIndex));

            // After bathing, decide where to go
            if (worker.hunger < 30 && restaurants.length > 0) {
              // Find a staffed restaurant with capacity
              const availableRestaurants = restaurants.filter(r => canServiceBuilding(r));
              if (availableRestaurants.length > 0) {
                worker.state = "visiting_restaurant";
                const restaurant = availableRestaurants[Math.floor(Math.random() * availableRestaurants.length)];
                const target = navigationPlugin.getClosestPoint(restaurant.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(restaurant, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to restaurant after bathing`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} is hungry but no restaurants are staffed!`);
              }
            } else if (worker.social < 40 && taverns.length > 0) {
              // Find a staffed tavern with capacity
              const availableTaverns = taverns.filter(t => canServiceBuilding(t));
              if (availableTaverns.length > 0) {
                worker.state = "visiting_tavern";
                const tavern = availableTaverns[Math.floor(Math.random() * availableTaverns.length)];
                const target = navigationPlugin.getClosestPoint(tavern.entranceZone);
                crowd.agentGoto(worker.agentIndex, target);
                addClientToBuilding(tavern, worker.agentIndex);
                console.log(`Agent ${worker.agentIndex} going to tavern after bathing`);
              } else {
                console.log(`⚠️ Agent ${worker.agentIndex} needs tavern but none are staffed!`);
              }
            } else if (worker.house) {
              worker.state = "going_home";
              const target = navigationPlugin.getClosestPoint(worker.house.entranceZone);
              crowd.agentGoto(worker.agentIndex, target);
              console.log(`Agent ${worker.agentIndex} going home after bathing, hygiene: ${worker.hygiene.toFixed(0)}`);
            } else {
              // Homeless - just sleep where they are
              worker.state = "sleeping";
              console.log(`Agent ${worker.agentIndex} done bathing (homeless), sleeping outside`);
            }
            worker.stateTimer = 0;
          }
          break;
        }

        case "going_home": {
          // Only process if worker has a house
          if (worker.house) {
            const homePos = crowd.getAgentPosition(worker.agentIndex);
            if (Vector3.Distance(homePos, worker.house.entranceZone) < 0.5) {
              worker.state = "sleeping";
              worker.stateTimer = 0;
              console.log(`Agent ${worker.agentIndex} arrived home`);
            }
          } else {
            // Homeless worker shouldn't be in this state, transition to sleeping
            worker.state = "sleeping";
            worker.stateTimer = 0;
          }
          break;
        }
      }
    });
  }, 1000);
}