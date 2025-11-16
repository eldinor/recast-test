import { useEffect, useRef, useState, useCallback } from "react";
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
  HighlightLayer,
} from "@babylonjs/core";
import "@babylonjs/loaders";
import { CreateNavigationPluginAsync, WaitForFullTileCacheUpdate } from "@babylonjs/addons";
import * as RecastCore from "@recast-navigation/core";
import * as RecastGenerators from "@recast-navigation/generators";
import type { INavMeshParametersV2 } from "@babylonjs/addons/navigation/types";

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const crowdRef = useRef<unknown>(null);
  const navigationPluginRef = useRef<any>(null);

  // Unified building storage - Map of building type to array of buildings
  const buildingsRef = useRef<Map<BuildingType, Building[]>>(new Map([
    ["house", []],
    ["workplace", []],
    ["tavern", []],
    ["clinic", []],
    ["restaurant", []],
    ["bathhouse", []]
  ]));

  const workersRef = useRef<Worker[]>([]);
  const tileCacheRef = useRef<unknown>(null);
  const agentMeshesRef = useRef<Map<number, Mesh>>(new Map());
  const highlightLayerRef = useRef<HighlightLayer | null>(null);

  // UI State
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showWorkerPanel, setShowWorkerPanel] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<Building | null>(null);
  const [showBuildingPanel, setShowBuildingPanel] = useState(false);
  const [workersToAssign, setWorkersToAssign] = useState(1); // Slider value for assigning workers
  const [showStatsPanel, setShowStatsPanel] = useState(true); // Stats panel visibility
  const [notification, setNotification] = useState<string | null>(null); // Notification message
  const [statsUpdateTrigger, setStatsUpdateTrigger] = useState(0); // Trigger to force Stats panel re-render
  const [showAttentionPanel, setShowAttentionPanel] = useState(true); // Attention panel visibility
  const [alertFilter, setAlertFilter] = useState<"all" | "critical" | "warning" | "info">("all"); // Alert filter

  // Alert types for Attention panel
  interface Alert {
    id: string;
    type: "critical" | "warning" | "info";
    icon: string;
    message: string;
    timestamp: number;
  }
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Helper function to add alerts
  const addAlert = useCallback((type: "critical" | "warning" | "info", icon: string, message: string) => {
    const newAlert: Alert = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      icon,
      message,
      timestamp: Date.now(),
    };
    setAlerts(prev => {
      // Keep only last 20 alerts
      const updated = [newAlert, ...prev].slice(0, 20);
      return updated;
    });
  }, []);

  // Refs to access current state in event handlers (to avoid closure issues)
  const selectedWorkerRef = useRef<Worker | null>(null);
  const selectedBuildingRef = useRef<Building | null>(null);
  const changeWorkerWorkplaceRef = useRef<((worker: Worker, workplace: Building | null) => void) | null>(null);
  const changeWorkerHouseRef = useRef<((worker: Worker, house: Building | null) => void) | null>(null);

  // Helper functions for unified building storage
  const getBuildings = (type: BuildingType): Building[] => {
    return buildingsRef.current.get(type) || [];
  };

  const getAllBuildings = (): Building[] => {
    const all: Building[] = [];
    buildingsRef.current.forEach(buildings => all.push(...buildings));
    return all;
  };

  const addBuildingToStorage = (type: BuildingType, building: Building): void => {
    const buildings = buildingsRef.current.get(type) || [];
    buildings.push(building);
    buildingsRef.current.set(type, buildings);
  };

  const getBuildingIndex = (building: Building): number => {
    const buildings = getBuildings(building.type);
    return buildings.findIndex(b => b.mesh === building.mesh);
  };

  // Sync state with refs for event handlers
  useEffect(() => {
    selectedWorkerRef.current = selectedWorker;
  }, [selectedWorker]);

  useEffect(() => {
    selectedBuildingRef.current = selectedBuilding;
  }, [selectedBuilding]);

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

  // Manage selection outline highlighting
  useEffect(() => {
    const highlightLayer = highlightLayerRef.current;
    if (!highlightLayer) return;

    // Clear all highlights
    highlightLayer.removeAllMeshes();

    // Highlight selected building
    if (selectedBuilding && selectedBuilding.mesh) {
      highlightLayer.addMesh(selectedBuilding.mesh, Color3.White());
    }

    // Highlight selected worker
    if (selectedWorker) {
      const workerMesh = agentMeshesRef.current.get(selectedWorker.agentIndex);
      if (workerMesh) {
        highlightLayer.addMesh(workerMesh, Color3.White());
      }
    }
  }, [selectedBuilding, selectedWorker]);

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

    // Create highlight layer for selection outlines
    const highlightLayer = new HighlightLayer("highlight", scene);
    highlightLayer.outerGlow = false; // Only show inner glow (outline)
    highlightLayer.innerGlow = true;
    highlightLayerRef.current = highlightLayer;

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

      buildingsRef.current.set("house", houses);
      buildingsRef.current.set("workplace", workplaces);
      buildingsRef.current.set("tavern", taverns);
      buildingsRef.current.set("clinic", clinics);
      buildingsRef.current.set("restaurant", restaurants);
      buildingsRef.current.set("bathhouse", bathhouses);

      // Add obstacles to navmesh using configuration
      const obstacles: unknown[] = [];
      const allBuildings = [...houses, ...workplaces, ...taverns, ...clinics, ...restaurants, ...bathhouses];

      allBuildings.forEach((building) => {
        const position = building.mesh.position;
        const config = BUILDING_CONFIGS[building.type];
        const params = config.obstacleParams;

        if (config.obstacleType === "cylinder") {
          const obstacle = tileCache.addCylinderObstacle(
            { x: position.x, y: position.y, z: position.z },
            params.radius!,
            params.height
          );
          obstacles.push(obstacle);
        } else {
          // Box obstacle
          const obstacle = tileCache.addBoxObstacle(
            { x: position.x, y: position.y, z: position.z },
            { x: params.width! / 2, y: params.height / 2, z: params.depth! / 2 },
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

      // Add click handler for agents and buildings
      scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
          const pickResult = pointerInfo.pickInfo;
          const isRightClick = pointerInfo.event.button === 2; // Right mouse button

          if (pickResult?.hit && pickResult.pickedMesh) {
            const meshName = pickResult.pickedMesh.name;
            console.log("Clicked on mesh:", meshName, "isPickable:", pickResult.pickedMesh.isPickable, "rightClick:", isRightClick);

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
                  if (!isRightClick) {
                    // Left click - select worker
                    setSelectedWorker(worker);
                    setShowWorkerPanel(true);
                  }
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
                const buildingType = match[1] as BuildingType;
                const buildingIndex = parseInt(match[2]);

                const buildings = buildingsRef.current.get(buildingType);
                const building = buildings ? buildings[buildingIndex] : null;

                if (building) {
                  console.log("Clicked on building:", buildingType, buildingIndex, "rightClick:", isRightClick);

                  if (isRightClick) {
                    // Right click - assign selected worker to this building
                    const currentSelectedWorker = selectedWorkerRef.current;
                    if (currentSelectedWorker) {
                      const crowd = crowdRef.current;
                      const navigationPlugin = navigationPluginRef.current;
                      const changeHouse = changeWorkerHouseRef.current;
                      const changeWorkplace = changeWorkerWorkplaceRef.current;

                      if (crowd && navigationPlugin && changeHouse && changeWorkplace) {
                        // Assign worker to building based on type
                        if (buildingType === "house") {
                          // Assign to house
                          if (building.workers.length < building.capacity) {
                            changeHouse(currentSelectedWorker, building);
                            const targetPos = building.entranceZone;
                            crowd.agentGoto(currentSelectedWorker.agentIndex, navigationPlugin.getClosestPoint(targetPos));
                            setNotification(`Worker ${currentSelectedWorker.agentIndex} assigned to House ${buildingIndex}`);
                            setTimeout(() => setNotification(null), 2000);
                          } else {
                            setNotification(`⚠️ House ${buildingIndex} is full!`);
                            setTimeout(() => setNotification(null), 2000);
                          }
                        } else {
                          // Assign to workplace (workplace, clinic, restaurant, bathhouse, tavern)
                          if (building.workers.length < building.capacity) {
                            changeWorkplace(currentSelectedWorker, building);
                            const targetPos = building.entranceZone;
                            crowd.agentGoto(currentSelectedWorker.agentIndex, navigationPlugin.getClosestPoint(targetPos));
                            const buildingName = `${buildingType.charAt(0).toUpperCase() + buildingType.slice(1)} ${buildingIndex}`;
                            setNotification(`Worker ${currentSelectedWorker.agentIndex} assigned to ${buildingName}`);
                            setTimeout(() => setNotification(null), 2000);
                          } else {
                            const buildingName = `${buildingType.charAt(0).toUpperCase() + buildingType.slice(1)} ${buildingIndex}`;
                            setNotification(`⚠️ ${buildingName} is full!`);
                            setTimeout(() => setNotification(null), 2000);
                          }
                        }
                      }
                    } else {
                      console.log("No worker selected - cannot assign to building");
                      setNotification("⚠️ Select a worker first!");
                      setTimeout(() => setNotification(null), 2000);
                    }
                  } else {
                    // Left click - select building
                    setSelectedBuilding(building);
                    setShowBuildingPanel(true);
                  }
                }
              }
            }
            // Clicked on ground or other non-interactive mesh
            else if (meshName === "ground" || !meshName.startsWith("agent-")) {
              if (!isRightClick) {
                // Left click on ground - clear selections
                console.log("Clicked on ground/empty space - clearing selections");
                setSelectedWorker(null);
                setSelectedBuilding(null);
                setShowWorkerPanel(false);
                setShowBuildingPanel(false);
              }
            }
          } else {
            // No mesh picked - clear selections on left click
            if (!isRightClick) {
              console.log("No mesh picked - clearing selections");
              setSelectedWorker(null);
              setSelectedBuilding(null);
              setShowWorkerPanel(false);
              setShowBuildingPanel(false);
            }
          }
        }
      });

      // Start simulation
      startSimulation(workers, crowd, navigationPlugin, taverns, clinics, restaurants, bathhouses, addAlert);
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

  }, [addAlert]);

  // Monitor worker conditions and generate alerts
  useEffect(() => {
    const alertedConditions = new Map<number, Set<string>>(); // Track which conditions have been alerted for each worker
    const conditionTimers = new Map<number, Map<string, number>>(); // Track how long a condition has persisted

    const monitorInterval = setInterval(() => {
      const workers = workersRef.current;

      workers.forEach(worker => {
        if (!alertedConditions.has(worker.agentIndex)) {
          alertedConditions.set(worker.agentIndex, new Set());
        }
        if (!conditionTimers.has(worker.agentIndex)) {
          conditionTimers.set(worker.agentIndex, new Map());
        }
        const workerAlerts = alertedConditions.get(worker.agentIndex)!;
        const timers = conditionTimers.get(worker.agentIndex)!;

        // Helper to check if condition has persisted long enough
        const checkCondition = (conditionKey: string, threshold: number = 0): boolean => {
          const currentTime = timers.get(conditionKey) || 0;
          timers.set(conditionKey, currentTime + 5000); // Add 5 seconds
          return currentTime >= threshold;
        };

        const resetCondition = (conditionKey: string) => {
          timers.delete(conditionKey);
        };

        // Critical health
        if (worker.health < 20 && worker.health > 0) {
          if (!workerAlerts.has('critical_health') && checkCondition('critical_health', 0)) {
            addAlert("critical", "💀", `Worker #${worker.agentIndex} has critical health (${worker.health.toFixed(0)})`);
            workerAlerts.add('critical_health');
          }
        } else {
          workerAlerts.delete('critical_health');
          resetCondition('critical_health');
        }

        // Critical happiness
        if (worker.happiness < 20) {
          if (!workerAlerts.has('critical_happiness') && checkCondition('critical_happiness', 0)) {
            addAlert("warning", "😢", `Worker #${worker.agentIndex} is very unhappy (${worker.happiness.toFixed(0)})`);
            workerAlerts.add('critical_happiness');
          }
        } else {
          workerAlerts.delete('critical_happiness');
          resetCondition('critical_happiness');
        }

        // Starvation
        if (worker.hunger < 15) {
          if (!workerAlerts.has('starvation') && checkCondition('starvation', 0)) {
            addAlert("critical", "🍽️", `Worker #${worker.agentIndex} is starving (hunger: ${worker.hunger.toFixed(0)})`);
            workerAlerts.add('starvation');
          }
        } else {
          workerAlerts.delete('starvation');
          resetCondition('starvation');
        }

        // Exhaustion
        if (worker.energy < 15) {
          if (!workerAlerts.has('exhaustion') && checkCondition('exhaustion', 0)) {
            addAlert("warning", "😴", `Worker #${worker.agentIndex} is exhausted (energy: ${worker.energy.toFixed(0)})`);
            workerAlerts.add('exhaustion');
          }
        } else {
          workerAlerts.delete('exhaustion');
          resetCondition('exhaustion');
        }

        // Low social
        if (worker.social < 15) {
          if (!workerAlerts.has('low_social') && checkCondition('low_social', 10000)) { // 10 seconds
            addAlert("info", "🎭", `Worker #${worker.agentIndex} feels isolated (social: ${worker.social.toFixed(0)})`);
            workerAlerts.add('low_social');
          }
        } else {
          workerAlerts.delete('low_social');
          resetCondition('low_social');
        }

        // Poor hygiene
        if (worker.hygiene < 15) {
          if (!workerAlerts.has('poor_hygiene') && checkCondition('poor_hygiene', 10000)) { // 10 seconds
            addAlert("info", "🛁", `Worker #${worker.agentIndex} has poor hygiene (${worker.hygiene.toFixed(0)})`);
            workerAlerts.add('poor_hygiene');
          }
        } else {
          workerAlerts.delete('poor_hygiene');
          resetCondition('poor_hygiene');
        }

        // Homelessness - only alert after 15 seconds
        if (!worker.house) {
          if (!workerAlerts.has('homeless') && checkCondition('homeless', 15000)) {
            addAlert("warning", "🏠", `Worker #${worker.agentIndex} is homeless`);
            workerAlerts.add('homeless');
          }
        } else {
          workerAlerts.delete('homeless');
          resetCondition('homeless');
        }

        // Unemployment - only alert after 20 seconds
        if (!worker.workplace) {
          if (!workerAlerts.has('unemployed') && checkCondition('unemployed', 20000)) {
            addAlert("info", "💼", `Worker #${worker.agentIndex} is unemployed`);
            workerAlerts.add('unemployed');
          }
        } else {
          workerAlerts.delete('unemployed');
          resetCondition('unemployed');
        }
      });
    }, 5000); // Check every 5 seconds

    return () => clearInterval(monitorInterval);
  }, [addAlert]);

  // Helper functions for dynamic building/worker creation
  const addBuilding = (type: BuildingType) => {
    const scene = sceneRef.current;
    const tileCache = tileCacheRef.current;
    const navigationPlugin = navigationPluginRef.current;

    if (!scene || !tileCache || !navigationPlugin) return;

    const config = BUILDING_CONFIGS[type];
    const existingBuildings = getBuildings(type);
    const index = existingBuildings.length;

    // Get all existing building positions
    const existingPositions = getAllBuildings().map(b => b.mesh.position);

    // Find non-overlapping position
    let x: number, z: number, position: Vector3;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * 16;
      z = (Math.random() - 0.5) * 16;
      position = new Vector3(x, 0, z);
      attempts++;
    } while (isTooClose(position, existingPositions, 2.5) && attempts < 50);

    // Create material
    const material = new StandardMaterial(`${type}Mat-${index}`, scene);
    material.diffuseColor = new Color3(config.color.r, config.color.g, config.color.b);

    // Create mesh based on shape
    let mesh: Mesh;
    let yPosition: number;

    if (config.shape === "box") {
      mesh = MeshBuilder.CreateBox(`${type}-${index}`, config.dimensions, scene);
      yPosition = config.dimensions.height / 2;
    } else if (config.shape === "cylinder") {
      mesh = MeshBuilder.CreateCylinder(`${type}-${index}`, config.dimensions, scene);
      yPosition = config.dimensions.height / 2;
    } else { // cone
      mesh = MeshBuilder.CreateCylinder(`${type}-${index}`, config.dimensions, scene);
      yPosition = config.dimensions.height / 2;
    }

    mesh.position = new Vector3(x, yPosition, z);
    mesh.material = material;
    mesh.isPickable = true;

    // Create building object
    const newBuilding: Building = {
      mesh,
      entranceZone: new Vector3(x + 0.8, 0, z),
      type,
      workers: [],
      capacity: config.capacity,
      clientCapacity: config.clientCapacity,
      currentClients: config.clientCapacity ? [] : undefined
    };

    // Add to storage
    addBuildingToStorage(type, newBuilding);

    // Add obstacle to navmesh using configuration
    const buildingPos = newBuilding.mesh.position;
    const params = config.obstacleParams;

    if (config.obstacleType === "cylinder") {
      (tileCache as any).addCylinderObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        params.radius!,
        params.height
      );
    } else {
      (tileCache as any).addBoxObstacle(
        { x: buildingPos.x, y: buildingPos.y, z: buildingPos.z },
        { x: params.width! / 2, y: params.height / 2, z: params.depth! / 2 },
        0
      );
    }

    console.log(`Added ${config.displayName} at position (${x.toFixed(2)}, ${z.toFixed(2)})`);

    // Trigger Stats panel update
    setStatsUpdateTrigger(prev => prev + 1);
  };

  const addWorker = () => {
    const scene = sceneRef.current;
    const crowd = crowdRef.current;
    const navigationPlugin = navigationPluginRef.current;
    const houses = getBuildings("house");

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

    // Trigger Stats panel update
    setStatsUpdateTrigger(prev => prev + 1);
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
  // Store function in ref for event handlers
  changeWorkerWorkplaceRef.current = changeWorkerWorkplace;

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
          console.log(`Worker ${worker.agentIndex} house changed to House ${getBuildingIndex(house)}`);
        } else {
          console.log(`House ${getBuildingIndex(house)} is full! Capacity: ${house.capacity}`);
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
  // Store function in ref for event handlers
  changeWorkerHouseRef.current = changeWorkerHouse;

  return (
    <>
      <canvas
        ref={canvasRef}
        id="renderCanvas"
        onContextMenu={(e) => e.preventDefault()} // Prevent right-click context menu
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
          left: 220,
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "12px 15px",
          borderRadius: "8px",
          minWidth: "280px",
          maxWidth: "350px",
          maxHeight: "55vh",
          overflowY: "auto",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          zIndex: 1000,
          fontSize: "13px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>
              {BUILDING_CONFIGS[selectedBuilding.type].emoji} {BUILDING_CONFIGS[selectedBuilding.type].displayName} {getBuildingIndex(selectedBuilding)}
            </h2>
            <button
              onClick={() => setShowBuildingPanel(false)}
              style={{
                background: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              ✕
            </button>
          </div>

          <hr style={{ margin: "8px 0", border: "1px solid #555" }} />

          {/* For service buildings, show staff and client info separately */}
          {(selectedBuilding.type === "clinic" || selectedBuilding.type === "restaurant" || selectedBuilding.type === "bathhouse" || selectedBuilding.type === "tavern") ? (
            <>
              <div style={{ marginBottom: "15px" }}>
                <strong>�‍⚕️ Staff:</strong>
                <span style={{ fontSize: "16px", marginLeft: "8px" }}>
                  {selectedBuilding.workers.length} / {selectedBuilding.capacity}
                </span>
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
          padding: "12px 15px",
          borderRadius: "8px",
          minWidth: "280px",
          maxWidth: "320px",
          fontFamily: "Arial, sans-serif",
          maxHeight: "55vh",
          overflowY: "auto",
          fontSize: "13px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>👷 Worker #{selectedWorker.agentIndex}</h2>
            <button onClick={() => setShowWorkerPanel(false)} style={{
              ...buttonStyle,
              background: "#d32f2f",
              padding: "4px 8px",
              marginBottom: 0,
              fontSize: "12px",
            }}>
              ✕
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
            value={selectedWorker.house ? getBuildingIndex(selectedWorker.house) : -1}
            onChange={(e) => {
              const index = parseInt(e.target.value);
              const house = index >= 0 ? getBuildings("house")[index] : null;
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
            {getBuildings("house").map((house, index) => (
              <option key={index} value={index}>
                House {index} ({house.workers.length}/{house.capacity})
              </option>
            ))}
          </select>

          <h3 style={{ margin: "10px 0", fontSize: "16px" }}>🏢 Change Workplace</h3>
          <select
            value={
              selectedWorker.workplace
                ? `${selectedWorker.workplace.type}-${getBuildingIndex(selectedWorker.workplace)}`
                : "none"
            }
            onChange={(e) => {
              const value = e.target.value;
              if (value === "none") {
                changeWorkerWorkplace(selectedWorker, null);
              } else {
                const [type, indexStr] = value.split("-");
                const index = parseInt(indexStr);
                const workplace = getBuildings(type as BuildingType)[index];
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
            {/* Render workplace options dynamically */}
            {(Object.keys(BUILDING_CONFIGS) as BuildingType[])
              .filter(type => BUILDING_CONFIGS[type].category !== "residential")
              .map(buildingType => {
                const config = BUILDING_CONFIGS[buildingType];
                const buildings = getBuildings(buildingType);

                return (
                  <optgroup key={buildingType} label={`${config.emoji} ${config.displayName}s`}>
                    {buildings.map((building, index) => (
                      <option key={`${buildingType}-${index}`} value={`${buildingType}-${index}`}>
                        {config.displayName} {index} ({building.workers.length}/{building.capacity})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
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

      {/* Stats Panel */}
      {showStatsPanel && (
        <div
          key={statsUpdateTrigger}
          style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "15px",
          borderRadius: "8px",
          minWidth: "500px",
          maxWidth: "600px",
          maxHeight: "45vh",
          overflowY: "auto",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          zIndex: 1000,
          fontSize: "13px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "18px" }}>📊 Statistics</h2>
            <button
              onClick={() => setShowStatsPanel(false)}
              style={{
                background: "transparent",
                color: "white",
                border: "none",
                fontSize: "20px",
                cursor: "pointer",
                padding: "0 5px",
              }}
            >
              ✕
            </button>
          </div>

          <hr style={{ margin: "10px 0", border: "1px solid #555" }} />

          {/* Summary Stats */}
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "15px" }}>📈 Summary</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px" }}>
              <div>👷 Workers: <strong>{workersRef.current.length}</strong></div>
              <div>🏠 Houses: <strong>{getBuildings("house").length}</strong></div>
              <div>🏢 Workplaces: <strong>{getBuildings("workplace").length}</strong></div>
              <div>🍺 Taverns: <strong>{getBuildings("tavern").length}</strong></div>
              <div>🏥 Clinics: <strong>{getBuildings("clinic").length}</strong></div>
              <div>🍽️ Restaurants: <strong>{getBuildings("restaurant").length}</strong></div>
              <div>🛁 Bathhouses: <strong>{getBuildings("bathhouse").length}</strong></div>
              <div>😴 Homeless: <strong style={{ color: "#ff9800" }}>{workersRef.current.filter(w => !w.house).length}</strong></div>
              <div>💼 Unemployed: <strong style={{ color: "#ff9800" }}>{workersRef.current.filter(w => !w.workplace).length}</strong></div>
            </div>
          </div>

          {/* Average Worker Stats */}
          {workersRef.current.length > 0 && (() => {
            const workers = workersRef.current;
            const avgHealth = workers.reduce((sum, w) => sum + w.health, 0) / workers.length;
            const avgHappiness = workers.reduce((sum, w) => sum + w.happiness, 0) / workers.length;
            const avgHunger = workers.reduce((sum, w) => sum + w.hunger, 0) / workers.length;
            const avgEnergy = workers.reduce((sum, w) => sum + w.energy, 0) / workers.length;
            const avgSocial = workers.reduce((sum, w) => sum + w.social, 0) / workers.length;
            const avgHygiene = workers.reduce((sum, w) => sum + w.hygiene, 0) / workers.length;

            return (
              <div style={{ marginBottom: "15px" }}>
                <h3 style={{ margin: "0 0 8px 0", fontSize: "15px" }}>👥 Population Averages</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "12px" }}>
                  <div>
                    ❤️ Health: <strong style={{ color: avgHealth > 60 ? "#4caf50" : avgHealth > 30 ? "#ff9800" : "#f44336" }}>
                      {avgHealth.toFixed(1)}
                    </strong>
                  </div>
                  <div>
                    😊 Happiness: <strong style={{ color: avgHappiness > 60 ? "#4caf50" : avgHappiness > 30 ? "#ff9800" : "#f44336" }}>
                      {avgHappiness.toFixed(1)}
                    </strong>
                  </div>
                  <div>
                    🍽️ Hunger: <strong style={{ color: avgHunger > 60 ? "#4caf50" : avgHunger > 30 ? "#ff9800" : "#f44336" }}>
                      {avgHunger.toFixed(1)}
                    </strong>
                  </div>
                  <div>
                    ⚡ Energy: <strong style={{ color: avgEnergy > 60 ? "#4caf50" : avgEnergy > 30 ? "#ff9800" : "#f44336" }}>
                      {avgEnergy.toFixed(1)}
                    </strong>
                  </div>
                  <div>
                    🎭 Social: <strong style={{ color: avgSocial > 60 ? "#4caf50" : avgSocial > 30 ? "#ff9800" : "#f44336" }}>
                      {avgSocial.toFixed(1)}
                    </strong>
                  </div>
                  <div>
                    🛁 Hygiene: <strong style={{ color: avgHygiene > 60 ? "#4caf50" : avgHygiene > 30 ? "#ff9800" : "#f44336" }}>
                      {avgHygiene.toFixed(1)}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })()}

          <hr style={{ margin: "10px 0", border: "1px solid #555" }} />

          {/* Buildings List */}
          <div style={{ marginBottom: "15px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "15px" }}>🏗️ Buildings</h3>
            <div style={{ maxHeight: "150px", overflowY: "auto" }}>
              {/* Render all building types dynamically */}
              {(Object.keys(BUILDING_CONFIGS) as BuildingType[]).map(buildingType => {
                const config = BUILDING_CONFIGS[buildingType];
                const buildings = getBuildings(buildingType);

                return buildings.map((building, index) => {
                  const label = config.category === "residential"
                    ? `${building.workers.length}/${building.capacity}`
                    : `Staff: ${building.workers.length}/${building.capacity}`;

                  return (
                    <div
                      key={`stats-${buildingType}-${index}`}
                      onClick={() => {
                        setSelectedBuilding(building);
                        setShowBuildingPanel(true);
                      }}
                      style={{
                        padding: "6px 8px",
                        marginBottom: "4px",
                        background: selectedBuilding === building ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                        borderRadius: "4px",
                        cursor: "pointer",
                        transition: "background 0.2s",
                        fontSize: "12px",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = selectedBuilding === building ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)"}
                    >
                      {config.emoji} {config.displayName} {index} - {label}
                    </div>
                  );
                });
              })}
            </div>
          </div>

          <hr style={{ margin: "10px 0", border: "1px solid #555" }} />

          {/* Workers List */}
          <div>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "15px" }}>👷 Workers</h3>
            <div style={{ maxHeight: "150px", overflowY: "auto" }}>
              {workersRef.current.map((worker) => (
                <div
                  key={`stats-worker-${worker.agentIndex}`}
                  onClick={() => {
                    setSelectedWorker(worker);
                    setShowWorkerPanel(true);
                  }}
                  style={{
                    padding: "6px 8px",
                    marginBottom: "4px",
                    background: selectedWorker?.agentIndex === worker.agentIndex ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    transition: "background 0.2s",
                    fontSize: "11px",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = selectedWorker?.agentIndex === worker.agentIndex ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)"}
                >
                  <div style={{ fontWeight: "bold", marginBottom: "2px" }}>
                    Worker {worker.agentIndex} - {worker.state}
                  </div>
                  <div style={{ color: "#ccc" }}>
                    ❤️ {worker.health.toFixed(0)} | 😊 {worker.happiness.toFixed(0)} |
                    🍽️ {worker.hunger.toFixed(0)} | ⚡ {worker.energy.toFixed(0)}
                  </div>
                  <div style={{ color: "#999", fontSize: "10px", marginTop: "2px" }}>
                    {worker.house ? `🏠 House ${getBuildingIndex(worker.house)}` : "😴 Homeless"} |
                    {worker.workplace ? ` 💼 ${worker.workplace.type} ${getBuildingIndex(worker.workplace)}` : " 💼 Unemployed"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Toggle Stats Panel Button */}
      {!showStatsPanel && (
        <button
          onClick={() => setShowStatsPanel(true)}
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            background: "rgba(0, 0, 0, 0.7)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "10px 15px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
          }}
        >
          📊 Show Stats
        </button>
      )}

      {/* Attention Panel - Bottom Right */}
      {showAttentionPanel && (
        <div style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "15px",
          borderRadius: "8px",
          minWidth: "350px",
          maxWidth: "400px",
          maxHeight: "45vh",
          overflowY: "auto",
          boxShadow: "0 4px 6px rgba(0, 0, 0, 0.3)",
          zIndex: 1000,
          fontSize: "13px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <h2 style={{ margin: 0, fontSize: "16px" }}>⚠️ Attention Panel</h2>
            <button
              onClick={() => setShowAttentionPanel(false)}
              style={{
                background: "#f44336",
                color: "white",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              ✕
            </button>
          </div>

          <hr style={{ margin: "8px 0", border: "1px solid #555" }} />

          {/* Filter Buttons */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                onClick={() => setAlertFilter("all")}
                style={{
                  flex: 1,
                  minWidth: "70px",
                  background: alertFilter === "all" ? "#4caf50" : "#555",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: alertFilter === "all" ? "bold" : "normal",
                }}
              >
                All ({alerts.length})
              </button>
              <button
                onClick={() => setAlertFilter("critical")}
                style={{
                  flex: 1,
                  minWidth: "70px",
                  background: alertFilter === "critical" ? "#f44336" : "#555",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: alertFilter === "critical" ? "bold" : "normal",
                }}
              >
                🔴 Critical ({alerts.filter(a => a.type === "critical").length})
              </button>
              <button
                onClick={() => setAlertFilter("warning")}
                style={{
                  flex: 1,
                  minWidth: "70px",
                  background: alertFilter === "warning" ? "#ff9800" : "#555",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: alertFilter === "warning" ? "bold" : "normal",
                }}
              >
                🟠 Warning ({alerts.filter(a => a.type === "warning").length})
              </button>
              <button
                onClick={() => setAlertFilter("info")}
                style={{
                  flex: 1,
                  minWidth: "70px",
                  background: alertFilter === "info" ? "#2196f3" : "#555",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: "11px",
                  fontWeight: alertFilter === "info" ? "bold" : "normal",
                }}
              >
                🔵 Info ({alerts.filter(a => a.type === "info").length})
              </button>
            </div>
          </div>

          <hr style={{ margin: "8px 0", border: "1px solid #555" }} />

          {/* Alerts List */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <h3 style={{ margin: 0, fontSize: "14px" }}>📋 Recent Alerts</h3>
              {alerts.length > 0 && (
                <button
                  onClick={() => setAlerts([])}
                  style={{
                    background: "#555",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    padding: "3px 8px",
                    cursor: "pointer",
                    fontSize: "11px",
                  }}
                >
                  Clear All
                </button>
              )}
            </div>

            <div style={{ maxHeight: "25vh", overflowY: "auto" }}>
              {(() => {
                const filteredAlerts = alertFilter === "all"
                  ? alerts
                  : alerts.filter(a => a.type === alertFilter);

                if (filteredAlerts.length === 0) {
                  return (
                    <div style={{ color: "#999", fontStyle: "italic", padding: "10px 0", textAlign: "center" }}>
                      {alerts.length === 0
                        ? "✅ No alerts - everything is running smoothly!"
                        : `No ${alertFilter} alerts`}
                    </div>
                  );
                }

                return filteredAlerts.map(alert => {
                  const bgColor = alert.type === "critical" ? "rgba(244, 67, 54, 0.15)" :
                                  alert.type === "warning" ? "rgba(255, 152, 0, 0.15)" :
                                  "rgba(33, 150, 243, 0.15)";
                  const borderColor = alert.type === "critical" ? "#f44336" :
                                      alert.type === "warning" ? "#ff9800" :
                                      "#2196f3";

                  return (
                    <div
                      key={alert.id}
                      style={{
                        background: bgColor,
                        borderLeft: `3px solid ${borderColor}`,
                        padding: "8px 10px",
                        marginBottom: "6px",
                        borderRadius: "4px",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "16px" }}>{alert.icon}</span>
                        <span style={{ flex: 1 }}>{alert.message}</span>
                      </div>
                      <div style={{ color: "#999", fontSize: "10px", marginTop: "4px", marginLeft: "24px" }}>
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Toggle Attention Panel Button */}
      {!showAttentionPanel && (
        <button
          onClick={() => setShowAttentionPanel(true)}
          style={{
            position: "absolute",
            bottom: 10,
            right: 10,
            background: alerts.some(a => a.type === "critical") ? "rgba(244, 67, 54, 0.9)" :
                       alerts.some(a => a.type === "warning") ? "rgba(255, 152, 0, 0.9)" :
                       "rgba(0, 0, 0, 0.7)",
            color: "white",
            border: "none",
            borderRadius: "8px",
            padding: "10px 15px",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: "bold",
          }}
        >
          ⚠️ Alerts ({alerts.length})
        </button>
      )}

      {/* Notification Toast */}
      {notification && (
        <div style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "rgba(0, 0, 0, 0.9)",
          color: "white",
          padding: "15px 25px",
          borderRadius: "8px",
          fontSize: "16px",
          fontWeight: "bold",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.5)",
          zIndex: 10000,
          animation: "fadeIn 0.3s ease-in-out",
        }}>
          {notification}
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

  const ground = CreateGround("ground", { width: 20, height: 20 }, scene);
  ground.isPickable = true; // Make pickable to detect clicks on empty space
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
type BuildingType = "house" | "workplace" | "tavern" | "clinic" | "restaurant" | "bathhouse";

type BuildingCategory = "residential" | "workplace" | "service";

interface BuildingConfig {
  type: BuildingType;
  category: BuildingCategory;
  emoji: string;
  displayName: string;
  color: { r: number; g: number; b: number };
  shape: "box" | "cylinder" | "cone";
  dimensions: {
    width?: number;
    height: number;
    depth?: number;
    diameter?: number;
    diameterTop?: number;
    diameterBottom?: number;
  };
  capacity: number; // Max workers/staff
  clientCapacity?: number; // Max clients for service buildings
  obstacleType: "box" | "cylinder";
  obstacleParams: {
    radius?: number;
    width?: number;
    depth?: number;
    height: number;
  };
}

interface Building {
  mesh: Mesh;
  entranceZone: Vector3;
  type: BuildingType;
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

// Building Configuration System
const BUILDING_CONFIGS: Record<BuildingType, BuildingConfig> = {
  house: {
    type: "house",
    category: "residential",
    emoji: "🏠",
    displayName: "House",
    color: { r: 0.8, g: 0.6, b: 0.4 },
    shape: "box",
    dimensions: { width: 0.75, height: 0.5, depth: 0.75 },
    capacity: 4,
    obstacleType: "box",
    obstacleParams: { width: 0.75, depth: 0.75, height: 0.5 }
  },
  workplace: {
    type: "workplace",
    category: "workplace",
    emoji: "🏢",
    displayName: "Workplace",
    color: { r: 0.5, g: 0.5, b: 0.7 },
    shape: "cylinder",
    dimensions: { height: 0.75, diameter: 0.75 },
    capacity: 5,
    obstacleType: "cylinder",
    obstacleParams: { radius: 0.375, height: 0.75 }
  },
  tavern: {
    type: "tavern",
    category: "service",
    emoji: "🍺",
    displayName: "Tavern",
    color: { r: 0.7, g: 0.3, b: 0.3 },
    shape: "cone",
    dimensions: { height: 0.6, diameterTop: 0, diameterBottom: 0.75 },
    capacity: 2,
    clientCapacity: 20,
    obstacleType: "cylinder",
    obstacleParams: { radius: 0.375, height: 0.6 }
  },
  clinic: {
    type: "clinic",
    category: "service",
    emoji: "🏥",
    displayName: "Clinic",
    color: { r: 0.3, g: 0.8, b: 0.3 },
    shape: "box",
    dimensions: { width: 0.8, height: 0.7, depth: 0.8 },
    capacity: 4,
    clientCapacity: 20,
    obstacleType: "box",
    obstacleParams: { width: 0.8, depth: 0.8, height: 0.7 }
  },
  restaurant: {
    type: "restaurant",
    category: "service",
    emoji: "🍽️",
    displayName: "Restaurant",
    color: { r: 1.0, g: 0.7, b: 0.2 },
    shape: "box",
    dimensions: { width: 0.9, height: 0.6, depth: 0.75 },
    capacity: 4,
    clientCapacity: 20,
    obstacleType: "box",
    obstacleParams: { width: 0.9, depth: 0.75, height: 0.6 }
  },
  bathhouse: {
    type: "bathhouse",
    category: "service",
    emoji: "🛁",
    displayName: "Bathhouse",
    color: { r: 0.4, g: 0.6, b: 0.9 },
    shape: "cylinder",
    dimensions: { height: 0.5, diameter: 0.8 },
    capacity: 2,
    clientCapacity: 20,
    obstacleType: "cylinder",
    obstacleParams: { radius: 0.4, height: 0.5 }
  }
};

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
  bathhouses: Building[],
  addAlert: (type: "critical" | "warning" | "info", icon: string, message: string) => void
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
            addAlert("warning", "🤒", `Worker #${worker.agentIndex} got ill while sleeping! Health: ${worker.health.toFixed(0)}`);
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
                addAlert("warning", "🏥", `Worker #${worker.agentIndex} needs clinic but none are staffed!`);
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
            addAlert("critical", "⚠️", `Worker #${worker.agentIndex} had a workplace accident! Health: ${worker.health.toFixed(0)}`);
          }

          // Random chance of getting ill - 1% chance per tick
          if (Math.random() < 0.01) {
            worker.health = Math.max(0, worker.health - 15);
            console.log(`🤒 Agent ${worker.agentIndex} got ill at work! Health: ${worker.health}`);
            addAlert("warning", "🤒", `Worker #${worker.agentIndex} got ill at work! Health: ${worker.health.toFixed(0)}`);
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
                addAlert("warning", "🏥", `Worker #${worker.agentIndex} needs clinic but none are staffed!`);
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
                addAlert("warning", "🍽️", `Worker #${worker.agentIndex} is hungry but no restaurants are staffed!`);
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
                addAlert("info", "🛁", `Worker #${worker.agentIndex} needs bathhouse but none are staffed!`);
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
                addAlert("info", "🍺", `Worker #${worker.agentIndex} needs tavern but none are staffed!`);
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
                addAlert("warning", "🍽️", `Worker #${worker.agentIndex} is hungry but no restaurants are staffed!`);
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