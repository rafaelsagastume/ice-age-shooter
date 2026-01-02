import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// Socket.io
const socket = io();

// Estado del juego
let gameStarted = false;
let currentGyro = { beta: 0, gamma: 0 };
let score = 0;
let currentRoomCode = null;

// Three.js variables
let scene, camera, renderer, composer;
let crosshair, crosshairTarget = { x: 0, y: 0 };
let dinosaurs = [];
let clock = new THREE.Clock();
let dinoModels = [];
let cameraShake = { intensity: 0, decay: 0.9 };
let originalCameraPos = { x: 0, y: 2, z: 8 };
let particles, leaves;

// Raycaster para detección de disparos
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Inicializar sala
socket.emit('create-room', (response) => {
  if (response.success) {
    currentRoomCode = response.roomCode;
    document.getElementById('room-code').textContent = response.roomCode;
    updateQRCode(response.roomCode);
    setupCopyButton(response.roomCode);
  }
});

function getControllerUrl(roomCode) {
  return `${window.location.origin}/controller?room=${roomCode}`;
}

function updateQRCode(roomCode) {
  const qrImg = document.getElementById('qr-code');
  qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(getControllerUrl(roomCode))}`;
}

function setupCopyButton(roomCode) {
  const btn = document.getElementById('copy-link-btn');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getControllerUrl(roomCode));
      btn.textContent = '¡Copiado!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copiar link del control';
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      prompt('Copia este link:', getControllerUrl(roomCode));
    }
  });
}

socket.on('controller-connected', () => {
  document.getElementById('connection-status').textContent = '¡Controlador conectado!';
  document.getElementById('connection-status').classList.add('connected');
  setTimeout(() => {
    document.getElementById('room-overlay').classList.add('hidden');
    gameStarted = true;
  }, 1000);
});

document.getElementById('skip-btn').addEventListener('click', () => {
  document.getElementById('room-overlay').classList.add('hidden');
  gameStarted = true;
});

socket.on('controller-disconnected', () => {
  document.getElementById('room-overlay').classList.remove('hidden');
  document.getElementById('connection-status').textContent = 'Controlador desconectado...';
  document.getElementById('connection-status').classList.remove('connected');
  gameStarted = false;
});

socket.on('gyro-update', (data) => {
  currentGyro = data;
  useMouseFallback = false;
});

socket.on('player-shoot', () => {
  if (gameStarted) shoot();
});

// Mouse fallback
let useMouseFallback = true;
document.addEventListener('mousemove', (e) => {
  if (useMouseFallback && gameStarted) {
    currentGyro.gamma = ((e.clientX - window.innerWidth / 2) / (window.innerWidth / 2)) * 45;
    currentGyro.beta = ((e.clientY - window.innerHeight / 2) / (window.innerHeight / 2)) * 30 + 15;
  }
});

document.addEventListener('click', () => {
  if (gameStarted) shoot();
});

// ==================== THREE.JS ====================

function init() {
  const container = document.getElementById('game-container');

  // Escena
  scene = new THREE.Scene();

  // Cámara - MÁS INMERSIVA (más cerca y baja)
  camera = new THREE.PerspectiveCamera(85, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 2, 8);
  camera.lookAt(0, 2, -30);

  // Renderer con efectos mejorados
  renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Post-procesamiento: Bloom para brillo cinematográfico
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.4,  // intensidad
    0.4,  // radio
    0.85  // umbral
  );
  composer.addPass(bloomPass);

  // Crear escena
  createSky();
  setupLights();
  createEnvironment();
  createDinoModels();
  createCrosshair();
  createScoreUI();
  createParticles();
  createVignette();

  // Events
  window.addEventListener('resize', onWindowResize);

  // Loop
  animate();

  // Spawner - más frecuente para más acción
  setInterval(() => {
    if (gameStarted && dinoModels.length > 0) spawnDinosaur();
  }, 1800);
}

// ==================== CIELO ====================

function createSky() {
  // Degradado de cielo - OPTIMIZADO
  const skyGeo = new THREE.SphereGeometry(400, 16, 16);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0066cc) },
      bottomColor: { value: new THREE.Color(0x99ddff) },
      offset: { value: 20 },
      exponent: { value: 0.6 }
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Niebla azulada suave
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.008);
}

// ==================== LUCES ====================

function setupLights() {
  // Ambiente más cálido
  scene.add(new THREE.AmbientLight(0xfff5e6, 0.4));

  // Sol principal
  const sun = new THREE.DirectionalLight(0xfffacd, 2.2);
  sun.position.set(30, 80, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.bias = -0.0001;
  scene.add(sun);

  // Hemisférica para ambiente natural
  scene.add(new THREE.HemisphereLight(0x87ceeb, 0x3a5f0b, 0.7));

  // Rayos de luz volumétricos (god rays simulados)
  createSunRays();
}

function createSunRays() {
  const rayMat = new THREE.MeshBasicMaterial({
    color: 0xffffcc,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });

  // Crear varios rayos de luz
  for (let i = 0; i < 5; i++) {
    const rayGeo = new THREE.PlaneGeometry(8 + Math.random() * 6, 80);
    const ray = new THREE.Mesh(rayGeo, rayMat.clone());

    ray.position.set(
      -20 + i * 12 + Math.random() * 8,
      35,
      -40 - Math.random() * 30
    );
    ray.rotation.x = -0.3;
    ray.rotation.y = 0.2 + Math.random() * 0.2;
    ray.rotation.z = -0.1 + Math.random() * 0.2;
    ray.material.opacity = 0.04 + Math.random() * 0.06;
    scene.add(ray);
  }
}

// ==================== ENTORNO ====================

function createEnvironment() {
  createGround();
  createPath();
  createPalmTrees();
  createRocks();
  createBushes();
  createWater();
  createMountains();
  createClouds();
  createForegroundVegetation();
}

function createGround() {
  // Textura procedural de pasto - SIMPLIFICADA
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Base verde
  ctx.fillStyle = '#3a5f0b';
  ctx.fillRect(0, 0, 128, 128);

  // Variaciones de color - REDUCIDO
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `hsl(${90 + Math.random() * 30}, ${50 + Math.random() * 30}%, ${20 + Math.random() * 25}%)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(15, 30);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 400),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function createPath() {
  // Textura de tierra - SIMPLIFICADA
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#8b6914';
  ctx.fillRect(0, 0, 64, 64);

  for (let i = 0; i < 200; i++) {
    ctx.fillStyle = `hsl(35, ${40 + Math.random() * 30}%, ${30 + Math.random() * 25}%)`;
    ctx.fillRect(Math.random() * 64, Math.random() * 64, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 30);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 400),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.02;
  path.receiveShadow = true;
  scene.add(path);
}

function createPalmTrees() {
  // Palmeras - MUCHAS MÁS
  for (let i = 0; i < 35; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (10 + Math.random() * 45);
    const z = -5 - Math.random() * 180;
    createSimplePalmTree(x, z, 0.6 + Math.random() * 0.6);
  }

  // Árboles de jungla - MUCHOS MÁS
  for (let i = 0; i < 30; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (15 + Math.random() * 50);
    const z = -5 - Math.random() * 180;
    createSimpleJungleTree(x, z, 0.7 + Math.random() * 0.7);
  }

  // Helechos - MÁS
  for (let i = 0; i < 25; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (7 + Math.random() * 45);
    const z = -Math.random() * 180;
    createSimpleFern(x, z, 0.5 + Math.random() * 0.6);
  }

  // Árboles cerca del camino para más densidad
  for (let i = 0; i < 20; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (8 + Math.random() * 12);
    const z = -15 - Math.random() * 150;
    if (Math.random() > 0.5) {
      createSimplePalmTree(x, z, 0.5 + Math.random() * 0.4);
    } else {
      createSimpleJungleTree(x, z, 0.6 + Math.random() * 0.5);
    }
  }

  // Árboles MUY CERCA del jugador (a los lados)
  for (let i = 0; i < 12; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (6 + Math.random() * 8);
    const z = 5 - Math.random() * 25; // Cerca del jugador (z=8)
    if (Math.random() > 0.5) {
      createSimplePalmTree(x, z, 0.7 + Math.random() * 0.5);
    } else {
      createSimpleJungleTree(x, z, 0.8 + Math.random() * 0.5);
    }
  }

  // Arbustos cerca del jugador
  for (let i = 0; i < 10; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (5 + Math.random() * 6);
    const z = 6 - Math.random() * 20;
    createSimpleFern(x, z, 0.6 + Math.random() * 0.4);
  }
}

// VERSIONES SIMPLIFICADAS DE ÁRBOLES PARA MEJOR RENDIMIENTO

function createSimplePalmTree(x, z, scale) {
  const tree = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });

  // Tronco simple
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.5, 12, 6),
    trunkMat
  );
  trunk.position.y = 6;
  trunk.castShadow = true;
  tree.add(trunk);

  // Hojas simples (conos verdes)
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a2d, roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 5, 4),
      leafMat
    );
    leaf.position.set(0, 12, 0);
    leaf.rotation.y = (i / 6) * Math.PI * 2;
    leaf.rotation.x = -0.3 - (i % 2) * 0.4;
    leaf.rotation.z = Math.PI / 2;
    leaf.castShadow = true;
    tree.add(leaf);
  }

  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
}

function createSimpleJungleTree(x, z, scale) {
  const tree = new THREE.Group();

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2d7a2d, roughness: 0.8 });

  // Tronco
  const trunkHeight = 8 + Math.random() * 4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.8, trunkHeight, 6),
    trunkMat
  );
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  tree.add(trunk);

  // Copa simple (esferas)
  for (let i = 0; i < 4; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(2 + Math.random(), 6, 4),
      leafMat.clone()
    );
    leaf.material.color.setHSL(0.28 + Math.random() * 0.05, 0.5, 0.3 + Math.random() * 0.1);
    leaf.position.set(
      (Math.random() - 0.5) * 3,
      trunkHeight + Math.random() * 2,
      (Math.random() - 0.5) * 3
    );
    leaf.scale.y = 0.6;
    leaf.castShadow = true;
    tree.add(leaf);
  }

  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  scene.add(tree);
}

function createSimpleFern(x, z, scale) {
  const fern = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x3a8a30,
    roughness: 0.8,
    side: THREE.DoubleSide
  });

  // Hojas simples
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 2),
      leafMat.clone()
    );
    leaf.material.color.setHSL(0.3 + Math.random() * 0.05, 0.6, 0.3);
    leaf.rotation.y = (i / 5) * Math.PI * 2;
    leaf.rotation.x = -0.5;
    leaf.position.y = 0.8;
    fern.add(leaf);
  }

  fern.position.set(x, 0, z);
  fern.scale.setScalar(scale);
  scene.add(fern);
}

function createRocks() {
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.9,
    flatShading: true
  });

  // REDUCIDO de 30 a 12
  for (let i = 0; i < 12; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (8 + Math.random() * 40);
    const z = -Math.random() * 180;

    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.5 + Math.random() * 1.5, 0),
      rockMat.clone()
    );
    rock.material.color.setHSL(0, 0, 0.3 + Math.random() * 0.2);
    rock.position.set(x, 0.3, z);
    rock.rotation.set(Math.random(), Math.random(), Math.random());
    rock.scale.set(1 + Math.random(), 0.6 + Math.random() * 0.5, 1 + Math.random());
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
}

function createBushes() {
  // Más arbustos para llenar espacios
  for (let i = 0; i < 40; i++) {
    const side = Math.random() > 0.5 ? 1 : -1;
    const x = side * (6 + Math.random() * 50);
    const z = -Math.random() * 180;

    const bushMat = new THREE.MeshStandardMaterial({
      color: 0x2d5a1d,
      roughness: 0.9
    });
    bushMat.color.setHSL(0.28 + Math.random() * 0.08, 0.6, 0.18 + Math.random() * 0.15);

    const bush = new THREE.Mesh(
      new THREE.SphereGeometry(0.8 + Math.random() * 0.6, 6, 4),
      bushMat
    );
    bush.position.set(x, 0.5, z);
    bush.scale.set(1.5 + Math.random() * 0.5, 0.7 + Math.random() * 0.3, 1.5 + Math.random() * 0.5);
    bush.castShadow = true;
    scene.add(bush);
  }
}

function createWater() {
  // Río a un lado
  const waterGeo = new THREE.PlaneGeometry(15, 400);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1e90ff,
    transparent: true,
    opacity: 0.7,
    roughness: 0.1,
    metalness: 0.3
  });

  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(-50, 0.1, -100);
  scene.add(water);

  // Animación del agua
  water.userData.update = (time) => {
    water.position.y = 0.1 + Math.sin(time * 2) * 0.05;
  };
}

function createMountains() {
  const mountainMat = new THREE.MeshStandardMaterial({
    color: 0x4a6741,
    roughness: 0.9,
    flatShading: true
  });

  // REDUCIDO de 12 a 6 montañas
  for (let i = 0; i < 6; i++) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(30 + Math.random() * 25, 50 + Math.random() * 30, 5),
      mountainMat.clone()
    );
    mountain.material.color.setHSL(0.28, 0.4, 0.25 + Math.random() * 0.1);
    mountain.position.set(
      -80 + i * 35 + Math.random() * 15,
      20,
      -200 + Math.random() * 20
    );
    mountain.castShadow = false; // Sin sombras para montañas lejanas
    scene.add(mountain);
  }
}

// Vegetación en primer plano para inmersión
function createForegroundVegetation() {
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x1a5a1a,
    roughness: 0.8,
    side: THREE.DoubleSide
  });

  // Hojas grandes en los bordes de la pantalla
  const positions = [
    { x: -8, z: 6, rotY: 0.5 },
    { x: -10, z: 4, rotY: 0.3 },
    { x: 8, z: 6, rotY: -0.5 },
    { x: 10, z: 4, rotY: -0.3 },
    { x: -9, z: 7, rotY: 0.7 },
    { x: 9, z: 7, rotY: -0.7 },
  ];

  positions.forEach(pos => {
    const plant = new THREE.Group();

    // Hojas grandes tipo helecho
    for (let i = 0; i < 4; i++) {
      const leaf = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 4),
        leafMat.clone()
      );
      leaf.material.color.setHSL(0.28 + Math.random() * 0.05, 0.7, 0.15 + Math.random() * 0.1);
      leaf.rotation.x = -0.3 - i * 0.15;
      leaf.rotation.y = (i - 1.5) * 0.3;
      leaf.position.y = 1.5;
      plant.add(leaf);
    }

    plant.position.set(pos.x, 0, pos.z);
    plant.rotation.y = pos.rotY;
    scene.add(plant);
  });

  // Tallos de bambú/caña en las esquinas
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x4a7a3a, roughness: 0.7 });
  [[-7, 5], [7, 5], [-8, 3], [8, 3]].forEach(([x, z]) => {
    for (let i = 0; i < 3; i++) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.1, 4 + Math.random() * 2, 5),
        stalkMat
      );
      stalk.position.set(x + (Math.random() - 0.5), 2, z + (Math.random() - 0.5));
      stalk.rotation.x = (Math.random() - 0.5) * 0.2;
      stalk.rotation.z = (Math.random() - 0.5) * 0.2;
      scene.add(stalk);
    }
  });
}

// Array global para animar nubes
let clouds = [];

function createClouds() {
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85
  });

  // Crear 12 nubes en el cielo
  for (let i = 0; i < 12; i++) {
    const cloud = new THREE.Group();

    // Cada nube tiene varias esferas
    const numSpheres = 4 + Math.floor(Math.random() * 3);
    for (let j = 0; j < numSpheres; j++) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(8 + Math.random() * 10, 6, 4),
        cloudMat
      );
      sphere.position.set(
        (j - numSpheres / 2) * 8,
        Math.random() * 4,
        Math.random() * 6
      );
      sphere.scale.y = 0.5;
      cloud.add(sphere);
    }

    // Posición aleatoria en el cielo
    cloud.position.set(
      -150 + Math.random() * 300,
      60 + Math.random() * 40,
      -100 - Math.random() * 150
    );

    cloud.userData.speed = 0.05 + Math.random() * 0.1;
    clouds.push(cloud);
    scene.add(cloud);
  }
}

function updateClouds() {
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed;
    // Reiniciar posición cuando sale de la pantalla
    if (cloud.position.x > 200) {
      cloud.position.x = -200;
    }
  }
}

// ==================== DINOSAURIOS ====================

function createDinoModels() {
  dinoModels.push(createTRex());
  dinoModels.push(createRaptor());
  dinoModels.push(createTriceratops());
}

function createTRex() {
  const dino = new THREE.Group();
  dino.userData.type = 'trex';

  const skinColor = 0x2d5a27;
  const bellyColor = 0x4a7a3f;

  const skinMat = new THREE.MeshStandardMaterial({
    color: skinColor,
    roughness: 0.8,
    flatShading: true
  });
  const bellyMat = new THREE.MeshStandardMaterial({
    color: bellyColor,
    roughness: 0.8
  });

  // Cuerpo principal
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 12, 10),
    skinMat
  );
  body.scale.set(1, 0.85, 1.4);
  body.position.set(0, 2.5, 0);
  body.castShadow = true;
  dino.add(body);

  // Panza
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 10, 8),
    bellyMat
  );
  belly.scale.set(0.8, 0.7, 1);
  belly.position.set(0, 2.2, 0.5);
  dino.add(belly);

  // Cabeza
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.2, 2),
    skinMat.clone()
  );
  head.position.set(0, 4, 2);
  head.castShadow = true;
  dino.add(head);

  // Mandíbula superior
  const upperJaw = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.4, 1.5),
    skinMat.clone()
  );
  upperJaw.position.set(0, 3.8, 3);
  dino.add(upperJaw);

  // Mandíbula inferior
  const lowerJaw = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.35, 1.3),
    skinMat.clone()
  );
  lowerJaw.position.set(0, 3.3, 2.8);
  dino.add(lowerJaw);

  // Dientes
  const toothMat = new THREE.MeshStandardMaterial({ color: 0xfffff0 });
  for (let i = 0; i < 8; i++) {
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.3, 4),
      toothMat
    );
    tooth.position.set(-0.4 + i * 0.11, 3.55, 3.4);
    tooth.rotation.x = Math.PI;
    dino.add(tooth);
  }

  // Ojos
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffff00, emissive: 0x444400 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000 });

  [-0.5, 0.5].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), eyeMat);
    eye.position.set(side, 4.3, 2.8);
    dino.add(eye);

    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), pupilMat);
    pupil.position.set(side, 4.3, 3);
    dino.add(pupil);
  });

  // Brazos pequeños
  [-0.9, 0.9].forEach(side => {
    const arm = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.15, 0.6, 4, 8),
      skinMat
    );
    arm.position.set(side, 2.8, 1.2);
    arm.rotation.z = side > 0 ? -0.6 : 0.6;
    arm.rotation.x = 0.3;
    arm.castShadow = true;
    dino.add(arm);
  });

  // Piernas
  [-0.6, 0.6].forEach(side => {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.8, 4, 8),
      skinMat
    );
    leg.position.set(side, 1, 0);
    leg.castShadow = true;
    dino.add(leg);

    // Pie
    const foot = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.2, 0.8),
      skinMat
    );
    foot.position.set(side, 0.1, 0.3);
    dino.add(foot);
  });

  // Cola
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.5, -1),
    new THREE.Vector3(0, 2.8, -2.5),
    new THREE.Vector3(0, 3, -4),
    new THREE.Vector3(0, 2.5, -5)
  ]);
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(tailCurve, 15, 0.4, 8, false),
    skinMat
  );
  tail.castShadow = true;
  dino.add(tail);

  // Escamas decorativas en la espalda
  for (let i = 0; i < 6; i++) {
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 0.4, 4),
      skinMat.clone()
    );
    spike.material.color.setHex(0x1a3a17);
    spike.position.set(0, 3.2 + Math.sin(i * 0.5) * 0.2, -0.5 - i * 0.6);
    spike.rotation.x = -0.3;
    dino.add(spike);
  }

  return dino;
}

function createRaptor() {
  const dino = new THREE.Group();
  dino.userData.type = 'raptor';

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x8b4513,
    roughness: 0.7,
    flatShading: true
  });

  // Cuerpo esbelto
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.6, 1.5, 8, 12),
    skinMat
  );
  body.rotation.x = Math.PI / 6;
  body.position.set(0, 1.8, 0);
  body.castShadow = true;
  dino.add(body);

  // Cabeza alargada
  const head = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.2, 6),
    skinMat.clone()
  );
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 2.5, 1.5);
  head.castShadow = true;
  dino.add(head);

  // Ojos
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x331100 });
  [-0.2, 0.2].forEach(side => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), eyeMat);
    eye.position.set(side, 2.6, 1.8);
    dino.add(eye);
  });

  // Piernas largas
  [-0.3, 0.3].forEach(side => {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.15, 1.2, 4, 8),
      skinMat
    );
    leg.position.set(side, 0.8, -0.2);
    leg.castShadow = true;
    dino.add(leg);

    // Garra
    const claw = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    claw.position.set(side, 0.1, 0.1);
    claw.rotation.x = -Math.PI / 4;
    dino.add(claw);
  });

  // Cola larga
  const tailCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.5, -0.5),
    new THREE.Vector3(0, 1.8, -1.5),
    new THREE.Vector3(0, 2, -2.5),
    new THREE.Vector3(0, 1.8, -3.5)
  ]);
  const tail = new THREE.Mesh(
    new THREE.TubeGeometry(tailCurve, 12, 0.15, 6, false),
    skinMat
  );
  tail.castShadow = true;
  dino.add(tail);

  // Plumas decorativas
  const featherMat = new THREE.MeshStandardMaterial({
    color: 0xcc4400,
    side: THREE.DoubleSide
  });
  for (let i = 0; i < 4; i++) {
    const feather = new THREE.Mesh(
      new THREE.PlaneGeometry(0.3, 0.6),
      featherMat
    );
    feather.position.set(0, 2.2 - i * 0.3, -0.3 - i * 0.4);
    feather.rotation.x = -0.5;
    dino.add(feather);
  }

  return dino;
}

function createTriceratops() {
  const dino = new THREE.Group();
  dino.userData.type = 'triceratops';

  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x6b8e23,
    roughness: 0.85,
    flatShading: true
  });

  // Cuerpo grande
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(2, 12, 10),
    skinMat
  );
  body.scale.set(1.2, 0.9, 1.5);
  body.position.set(0, 2.2, 0);
  body.castShadow = true;
  dino.add(body);

  // Cabeza con cresta
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1, 10, 8),
    skinMat.clone()
  );
  head.scale.set(1, 0.8, 1.2);
  head.position.set(0, 2.5, 2.5);
  head.castShadow = true;
  dino.add(head);

  // Cresta
  const frill = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 8),
    skinMat.clone()
  );
  frill.material.color.setHex(0x8fbc8f);
  frill.position.set(0, 3.2, 1.8);
  frill.rotation.x = -0.3;
  frill.material.side = THREE.DoubleSide;
  dino.add(frill);

  // Cuernos
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xf5f5dc });

  // Cuernos grandes
  [-0.6, 0.6].forEach(side => {
    const horn = new THREE.Mesh(
      new THREE.ConeGeometry(0.15, 1.5, 6),
      hornMat
    );
    horn.position.set(side, 3.2, 2.8);
    horn.rotation.x = Math.PI / 4;
    horn.rotation.z = side > 0 ? 0.2 : -0.2;
    dino.add(horn);
  });

  // Cuerno nasal
  const noseHorn = new THREE.Mesh(
    new THREE.ConeGeometry(0.12, 0.6, 6),
    hornMat
  );
  noseHorn.position.set(0, 2.8, 3.3);
  noseHorn.rotation.x = Math.PI / 3;
  dino.add(noseHorn);

  // Pico
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.6, 4),
    hornMat
  );
  beak.position.set(0, 2.2, 3.4);
  beak.rotation.x = Math.PI / 2;
  dino.add(beak);

  // Patas
  [[-0.8, 0.5], [0.8, 0.5], [-0.8, -1], [0.8, -1]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.35, 1.2, 4, 8),
      skinMat
    );
    leg.position.set(x, 1, z);
    leg.castShadow = true;
    dino.add(leg);
  });

  // Cola corta
  const tail = new THREE.Mesh(
    new THREE.ConeGeometry(0.5, 2, 6),
    skinMat
  );
  tail.position.set(0, 2, -2);
  tail.rotation.x = -Math.PI / 2 + 0.3;
  tail.castShadow = true;
  dino.add(tail);

  return dino;
}

function spawnDinosaur() {
  const modelIndex = Math.floor(Math.random() * dinoModels.length);
  const dino = dinoModels[modelIndex].clone();

  // Spawn más cerca para más inmersión
  const startX = (Math.random() - 0.5) * 20;
  const startZ = -80;

  dino.position.set(startX, 0, startZ);
  dino.scale.set(0.4, 0.4, 0.4);

  dino.userData = {
    ...dino.userData,
    startTime: Date.now(),
    duration: 4000 + Math.random() * 2500, // Más rápido
    startPos: new THREE.Vector3(startX, 0, startZ),
    endPos: new THREE.Vector3((Math.random() - 0.5) * 25, 0, 12), // Terminan más cerca
    startScale: 0.4,
    endScale: 2.8, // Más grandes al final
    wobbleOffset: Math.random() * Math.PI * 2,
    legPhase: Math.random() * Math.PI * 2
  };

  scene.add(dino);
  dinosaurs.push(dino);
}

function updateDinosaurs(time) {
  const now = Date.now();

  for (let i = dinosaurs.length - 1; i >= 0; i--) {
    const dino = dinosaurs[i];
    const data = dino.userData;
    const elapsed = now - data.startTime;
    const progress = Math.min(elapsed / data.duration, 1);
    const eased = progress * progress;

    // Posición
    dino.position.lerpVectors(data.startPos, data.endPos, eased);

    // Escala
    const scale = data.startScale + (data.endScale - data.startScale) * eased;
    dino.scale.set(scale, scale, scale);

    // Animación de caminar
    const walkCycle = Math.sin(elapsed * 0.012 + data.legPhase);
    dino.position.y = Math.abs(walkCycle) * 0.3 * scale;
    dino.rotation.z = Math.sin(elapsed * 0.01 + data.wobbleOffset) * 0.08;

    // Mirar hacia la cámara
    dino.lookAt(camera.position.x, dino.position.y, camera.position.z);

    if (progress >= 1) {
      scene.remove(dino);
      dinosaurs.splice(i, 1);
    }
  }
}

// ==================== UI & GAMEPLAY ====================

function createCrosshair() {
  const el = document.createElement('div');
  el.id = 'crosshair-3d';
  el.innerHTML = `
    <svg width="100" height="100" viewBox="0 0 100 100">
      <!-- Círculo exterior animado -->
      <circle cx="50" cy="50" r="35" fill="none" stroke="rgba(255,50,50,0.4)" stroke-width="1" stroke-dasharray="8 4"/>
      <!-- Círculo principal -->
      <circle cx="50" cy="50" r="25" fill="none" stroke="rgba(255,80,80,0.9)" stroke-width="2"/>
      <!-- Círculo interior -->
      <circle cx="50" cy="50" r="12" fill="none" stroke="rgba(255,100,100,0.7)" stroke-width="1"/>
      <!-- Líneas de mira -->
      <line x1="50" y1="8" x2="50" y2="22" stroke="rgba(255,80,80,0.9)" stroke-width="2" stroke-linecap="round"/>
      <line x1="50" y1="78" x2="50" y2="92" stroke="rgba(255,80,80,0.9)" stroke-width="2" stroke-linecap="round"/>
      <line x1="8" y1="50" x2="22" y2="50" stroke="rgba(255,80,80,0.9)" stroke-width="2" stroke-linecap="round"/>
      <line x1="78" y1="50" x2="92" y2="50" stroke="rgba(255,80,80,0.9)" stroke-width="2" stroke-linecap="round"/>
      <!-- Marcas diagonales -->
      <line x1="25" y1="25" x2="32" y2="32" stroke="rgba(255,100,100,0.6)" stroke-width="1.5"/>
      <line x1="75" y1="25" x2="68" y2="32" stroke="rgba(255,100,100,0.6)" stroke-width="1.5"/>
      <line x1="25" y1="75" x2="32" y2="68" stroke="rgba(255,100,100,0.6)" stroke-width="1.5"/>
      <line x1="75" y1="75" x2="68" y2="68" stroke="rgba(255,100,100,0.6)" stroke-width="1.5"/>
      <!-- Punto central -->
      <circle cx="50" cy="50" r="3" fill="rgba(255,100,100,1)"/>
    </svg>
  `;
  el.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 1000;
    transform: translate(-50%, -50%);
    filter: drop-shadow(0 0 12px rgba(255,50,50,0.7));
    animation: crosshairPulse 2s ease-in-out infinite;
  `;

  // Agregar animación de pulso
  if (!document.getElementById('crosshair-styles')) {
    const style = document.createElement('style');
    style.id = 'crosshair-styles';
    style.textContent = `
      @keyframes crosshairPulse {
        0%, 100% { filter: drop-shadow(0 0 12px rgba(255,50,50,0.7)); }
        50% { filter: drop-shadow(0 0 20px rgba(255,50,50,0.9)); }
      }
      #crosshair-3d svg circle:first-child {
        animation: rotateCrosshair 8s linear infinite;
        transform-origin: center;
      }
      @keyframes rotateCrosshair {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  document.body.appendChild(el);
  crosshair = el;
  crosshairTarget = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function createScoreUI() {
  const el = document.createElement('div');
  el.id = 'score-3d';
  el.innerHTML = `
    <div style="font-size: 14px; letter-spacing: 3px; opacity: 0.7;">PUNTUACIÓN</div>
    <div id="score-value" style="font-size: 52px; font-weight: bold; letter-spacing: 2px;">0</div>
  `;
  el.style.cssText = `
    position: fixed;
    top: 25px;
    left: 25px;
    font-family: 'Arial Black', sans-serif;
    color: white;
    text-shadow: 2px 2px 10px rgba(0,0,0,0.8), 0 0 30px rgba(255,200,100,0.3);
    z-index: 1000;
    background: linear-gradient(135deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.1) 100%);
    padding: 15px 25px;
    border-radius: 10px;
    border-left: 3px solid rgba(255,200,100,0.6);
  `;
  document.body.appendChild(el);
}

function shoot() {
  // Camera shake al disparar
  cameraShake.intensity = 0.3;

  // Flash más intenso
  const flash = document.createElement('div');
  flash.style.cssText = `
    position: fixed; inset: 0;
    background: radial-gradient(circle at ${crosshairTarget.x}px ${crosshairTarget.y}px, rgba(255,200,100,0.6), transparent 40%);
    pointer-events: none; z-index: 998;
  `;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 100);

  // Raycast
  const rect = crosshair.getBoundingClientRect();
  mouse.x = ((rect.left + 40) / window.innerWidth) * 2 - 1;
  mouse.y = -((rect.top + 40) / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const meshes = [];
  dinosaurs.forEach(d => d.traverse(c => {
    if (c.isMesh) {
      c.userData.parentDino = d;
      meshes.push(c);
    }
  }));

  const hits = raycaster.intersectObjects(meshes);
  if (hits.length > 0) {
    const dino = hits[0].object.userData.parentDino;
    if (dino) {
      const dist = dino.position.distanceTo(camera.position);
      const pts = Math.floor(50 + (dist / 160) * 450);
      score += pts;
      document.getElementById('score-value').textContent = score;

      createExplosion(dino.position.clone().add(new THREE.Vector3(0, 2, 0)));
      showPoints(pts, hits[0].point);

      const idx = dinosaurs.indexOf(dino);
      if (idx > -1) {
        scene.remove(dino);
        dinosaurs.splice(idx, 1);
      }
    }
  }
}

function createExplosion(pos) {
  const colors = [0xff6600, 0xff3300, 0xffcc00, 0xff0000, 0xffff00];
  const particles = new THREE.Group();

  // Partículas de fuego
  for (let i = 0; i < 18; i++) {
    const p = new THREE.Mesh(
      new THREE.SphereGeometry(0.4 + Math.random() * 0.5, 6, 6),
      new THREE.MeshBasicMaterial({
        color: colors[Math.floor(Math.random() * colors.length)],
        transparent: true,
        opacity: 1
      })
    );
    p.position.copy(pos);
    p.userData.vel = new THREE.Vector3(
      (Math.random() - 0.5) * 4,
      Math.random() * 5 + 1,
      (Math.random() - 0.5) * 4
    );
    particles.add(p);
  }

  // Anillo de onda expansiva
  const ringGeo = new THREE.RingGeometry(0.1, 0.5, 16);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffaa00,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.copy(pos);
  ring.lookAt(camera.position);
  scene.add(ring);

  // Flash de luz temporal
  const flash = new THREE.PointLight(0xff6600, 5, 20);
  flash.position.copy(pos);
  scene.add(flash);

  scene.add(particles);

  // Aumentar camera shake en impacto
  cameraShake.intensity = 0.5;

  let f = 0;
  const anim = () => {
    f++;
    particles.children.forEach(p => {
      p.position.add(p.userData.vel);
      p.userData.vel.y -= 0.15;
      p.scale.multiplyScalar(0.92);
      p.material.opacity *= 0.95;
    });

    // Expandir anillo
    ring.scale.x += 0.5;
    ring.scale.y += 0.5;
    ring.material.opacity *= 0.9;

    // Reducir luz
    flash.intensity *= 0.85;

    if (f < 40) {
      requestAnimationFrame(anim);
    } else {
      scene.remove(particles);
      scene.remove(ring);
      scene.remove(flash);
    }
  };
  anim();
}

function showPoints(pts, pos) {
  const el = document.createElement('div');
  el.textContent = `+${pts}`;
  el.style.cssText = `
    position: fixed;
    font-size: 48px;
    font-family: 'Arial Black', sans-serif;
    color: #ffff00;
    text-shadow: 3px 3px 6px rgba(0,0,0,0.8), 0 0 30px rgba(255,255,0,0.8);
    pointer-events: none;
    z-index: 1001;
    transition: all 0.7s ease-out;
  `;
  const v = pos.clone().project(camera);
  el.style.left = (v.x * 0.5 + 0.5) * window.innerWidth + 'px';
  el.style.top = (-v.y * 0.5 + 0.5) * window.innerHeight + 'px';
  document.body.appendChild(el);

  requestAnimationFrame(() => {
    el.style.transform = 'translateY(-80px) scale(1.4)';
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), 800);

  // Mostrar hitmarker en la mira
  showHitmarker();
}

function showHitmarker() {
  const hitmarker = document.createElement('div');
  hitmarker.innerHTML = `
    <svg width="60" height="60" viewBox="0 0 60 60">
      <line x1="15" y1="15" x2="22" y2="22" stroke="white" stroke-width="3"/>
      <line x1="45" y1="15" x2="38" y2="22" stroke="white" stroke-width="3"/>
      <line x1="15" y1="45" x2="22" y2="38" stroke="white" stroke-width="3"/>
      <line x1="45" y1="45" x2="38" y2="38" stroke="white" stroke-width="3"/>
    </svg>
  `;
  hitmarker.style.cssText = `
    position: fixed;
    left: ${crosshairTarget.x}px;
    top: ${crosshairTarget.y}px;
    transform: translate(-50%, -50%) scale(0.5);
    pointer-events: none;
    z-index: 1002;
    filter: drop-shadow(0 0 10px white);
    animation: hitmarkerAnim 0.3s ease-out forwards;
  `;
  document.body.appendChild(hitmarker);

  // Agregar estilos de animación si no existen
  if (!document.getElementById('hitmarker-styles')) {
    const style = document.createElement('style');
    style.id = 'hitmarker-styles';
    style.textContent = `
      @keyframes hitmarkerAnim {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        50% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  setTimeout(() => hitmarker.remove(), 300);
}

function updateCrosshair() {
  if (!crosshair) return;

  const gamma = Math.max(-45, Math.min(45, currentGyro.gamma || 0));
  const beta = Math.max(-30, Math.min(60, currentGyro.beta || 0));

  const targetX = window.innerWidth / 2 + (gamma / 45) * (window.innerWidth * 0.45);
  const targetY = window.innerHeight / 2 + ((beta - 15) / 45) * (window.innerHeight * 0.45);

  crosshairTarget.x += (targetX - crosshairTarget.x) * 0.12;
  crosshairTarget.y += (targetY - crosshairTarget.y) * 0.12;

  crosshairTarget.x = Math.max(40, Math.min(window.innerWidth - 40, crosshairTarget.x));
  crosshairTarget.y = Math.max(40, Math.min(window.innerHeight - 40, crosshairTarget.y));

  crosshair.style.left = crosshairTarget.x + 'px';
  crosshair.style.top = crosshairTarget.y + 'px';
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

// ==================== EFECTOS VISUALES ====================

function createParticles() {
  // Partículas de polvo/polen flotando
  const particleCount = 200;
  const positions = new Float32Array(particleCount * 3);
  const velocities = [];

  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 80;
    positions[i * 3 + 1] = Math.random() * 20;
    positions[i * 3 + 2] = Math.random() * -100;

    velocities.push({
      x: (Math.random() - 0.5) * 0.02,
      y: (Math.random() - 0.5) * 0.01,
      z: (Math.random() - 0.5) * 0.02
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffcc,
    size: 0.3,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending
  });

  particles = new THREE.Points(geometry, material);
  particles.userData.velocities = velocities;
  scene.add(particles);

  // Hojas cayendo
  const leafCount = 30;
  const leafPositions = new Float32Array(leafCount * 3);
  const leafVelocities = [];

  for (let i = 0; i < leafCount; i++) {
    leafPositions[i * 3] = (Math.random() - 0.5) * 60;
    leafPositions[i * 3 + 1] = 15 + Math.random() * 30;
    leafPositions[i * 3 + 2] = Math.random() * -80;

    leafVelocities.push({
      x: (Math.random() - 0.5) * 0.05,
      y: -0.02 - Math.random() * 0.03,
      z: (Math.random() - 0.5) * 0.02,
      rotSpeed: Math.random() * 0.1
    });
  }

  const leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute('position', new THREE.BufferAttribute(leafPositions, 3));

  const leafMat = new THREE.PointsMaterial({
    color: 0x44aa44,
    size: 0.8,
    transparent: true,
    opacity: 0.8
  });

  leaves = new THREE.Points(leafGeo, leafMat);
  leaves.userData.velocities = leafVelocities;
  scene.add(leaves);
}

function updateParticles() {
  if (!particles || !leaves) return;

  // Actualizar polvo
  const positions = particles.geometry.attributes.position.array;
  const velocities = particles.userData.velocities;

  for (let i = 0; i < velocities.length; i++) {
    positions[i * 3] += velocities[i].x;
    positions[i * 3 + 1] += velocities[i].y;
    positions[i * 3 + 2] += velocities[i].z;

    // Reiniciar si sale del área
    if (positions[i * 3 + 1] > 25) positions[i * 3 + 1] = 0;
    if (positions[i * 3 + 1] < 0) positions[i * 3 + 1] = 20;
  }
  particles.geometry.attributes.position.needsUpdate = true;

  // Actualizar hojas
  const leafPos = leaves.geometry.attributes.position.array;
  const leafVel = leaves.userData.velocities;

  for (let i = 0; i < leafVel.length; i++) {
    leafPos[i * 3] += leafVel[i].x + Math.sin(Date.now() * 0.001 + i) * 0.02;
    leafPos[i * 3 + 1] += leafVel[i].y;
    leafPos[i * 3 + 2] += leafVel[i].z;

    // Reiniciar si cae al suelo
    if (leafPos[i * 3 + 1] < 0) {
      leafPos[i * 3] = (Math.random() - 0.5) * 60;
      leafPos[i * 3 + 1] = 20 + Math.random() * 15;
      leafPos[i * 3 + 2] = Math.random() * -80;
    }
  }
  leaves.geometry.attributes.position.needsUpdate = true;
}

function createVignette() {
  const vignette = document.createElement('div');
  vignette.id = 'vignette';
  vignette.style.cssText = `
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 999;
    background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%);
  `;
  document.body.appendChild(vignette);
}

function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  // Animar efectos ambientales
  updateClouds();
  updateParticles();

  // Camera shake
  if (cameraShake.intensity > 0.01) {
    camera.position.x = originalCameraPos.x + (Math.random() - 0.5) * cameraShake.intensity;
    camera.position.y = originalCameraPos.y + (Math.random() - 0.5) * cameraShake.intensity * 0.5;
    cameraShake.intensity *= cameraShake.decay;
  } else {
    camera.position.x = originalCameraPos.x;
    camera.position.y = originalCameraPos.y;
  }

  if (gameStarted) {
    updateCrosshair();
    updateDinosaurs(time);
  }

  // Renderizar con post-procesamiento
  composer.render();
}

// Iniciar
init();
