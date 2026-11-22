import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import packUrl from './assets/pack.bin?url';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

// Зимний двор-диорама из моделей Kenney Holiday Kit (CC0):
// ёлка с подарками, олень с санями, фонарь, гирлянда с носками-именами,
// леденцы в снегу, снеговик и лес. Поверх — bloom, tilt-shift, цветокор.
// Подарок в центре проходит фазы 'idle' → 'shake' → 'open'.

const GIFT_SCALE = 4.6;
const LAMP_SCALE = 3.2;
// Сколько носков помещается на гирлянде в один ряд. Больше — вешаем в два ряда через один.
const ONE_ROW_MAX = 4;

// детерминированный рандом, чтобы сцена всегда была одинаковой
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // тени в холодный индиго, света в тёплый янтарь
      vec3 shadowTint = vec3(0.86, 0.9, 1.12);
      vec3 lightTint = vec3(1.08, 1.0, 0.88);
      c *= mix(shadowTint, lightTint, smoothstep(0.1, 0.75, l));
      c += vec3(0.012, 0.01, 0.03) * (1.0 - l); // приподнятые тени, «киношный» чёрный
      // насыщенность и мягкая S-кривая
      c = mix(vec3(l), c, 1.15);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
      // виньетка
      vec2 d = vUv - 0.5;
      d.x *= uAspect;
      c *= mix(0.62, 1.0, smoothstep(0.95, 0.3, length(d)));
      // плёночное зерно
      c += (hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * 0.03;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export class GiftScene {
  // onProgress(0..1) — загрузка моделей, onReady — сцена собрана и шейдеры скомпилированы
  constructor(container, { onProgress, onReady } = {}) {
    this.container = container;
    this.onProgress = onProgress;
    this.onReady = onReady;
    this.phase = 'idle';
    this.phaseStart = 0;
    this.clock = new THREE.Clock();
    this.names = [];
    this.bulbs = [];
    this.stockings = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // сцена статична: тени пересчитываем только когда что-то двигается
    renderer.shadowMap.autoUpdate = false;
    this.shadowDirty = 2;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x2c2850, 22, 60);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
    this.camBase = { pos: new THREE.Vector3(0, 3, 13), look: new THREE.Vector3(0, 1.4, 0) };

    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildSnow();
    this.buildConfetti();
    this.buildBeam();
    this.buildComposer();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    renderer.setAnimationLoop(() => this.tick());

    this.ready = this.loadModels().catch((e) => console.error('models failed', e));
  }

  // ---------- база: небо, свет, земля ----------

  buildSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(120, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          uniform float uTime;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          void main() {
            float h = vDir.y;
            // синий час: тёплый персиковый горизонт → лиловый → глубокий индиго
            vec3 horizon = vec3(0.62, 0.34, 0.36);
            vec3 mid = vec3(0.17, 0.15, 0.36);
            vec3 top = vec3(0.02, 0.03, 0.1);
            vec3 c = mix(horizon, mid, smoothstep(-0.02, 0.18, h));
            c = mix(c, top, smoothstep(0.15, 0.65, h));
            // звёзды
            vec3 cell = floor(vDir * 260.0);
            float s = hash(cell);
            float star = step(0.9975, s) * smoothstep(0.12, 0.4, h);
            star *= 0.6 + 0.4 * sin(uTime * 2.0 + s * 80.0);
            c += star * 2.5;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      })
    );
    this.sky = sky;
    this.scene.add(sky);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x6f7fd6, 0x8a6a5a, 0.75));
    // лунный контровой свет сзади — красивые тени на снег к камере
    const moon = new THREE.DirectionalLight(0xaec2ff, 1.4);
    moon.position.set(-7, 11, -9);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.bias = -0.0004;
    moon.shadow.normalBias = 0.02;
    Object.assign(moon.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
    this.scene.add(moon);
    // тёплый заполняющий спереди
    const fill = new THREE.DirectionalLight(0xffb27a, 0.55);
    fill.position.set(6, 6, 10);
    this.scene.add(fill);

    this.giftGlow = new THREE.PointLight(0xffc070, 0, 9, 1.6);
    this.giftGlow.position.set(0, 2, 1.2);
    this.scene.add(this.giftGlow);
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 64),
      new THREE.MeshStandardMaterial({ color: 0xdfe5f4, roughness: 0.92 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildSnow() {
    const flakeTex = dotTexture();
    const make = (n, area, size, opacity) => {
      const pos = new Float32Array(n * 3);
      const speed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (Math.random() - 0.5) * area.x;
        pos[i * 3 + 1] = Math.random() * area.y;
        pos[i * 3 + 2] = area.z0 + Math.random() * (area.z1 - area.z0);
        speed[i] = 0.3 + Math.random() * 0.6;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size, map: flakeTex, transparent: true, opacity, depthWrite: false, color: 0xffffff })
      );
      pts.userData = { speed, top: area.y };
      this.scene.add(pts);
      return pts;
    };
    this.snowLayers = [
      make(1600, { x: 34, y: 14, z0: -18, z1: 6 }, 0.09, 0.9),
      // крупные расфокусированные хлопья у самой камеры
      make(70, { x: 12, y: 8, z0: 7, z1: 11 }, 0.35, 0.45),
    ];
  }

  buildConfetti() {
    const N = 360;
    const mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.09, 0.15),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.2 }),
      N
    );
    const palette = [0xd8322c, 0xfff4e0, 0xf2b93b, 0x2f8a55, 0xffffff];
    const c = new THREE.Color();
    this.conf = [];
    for (let i = 0; i < N; i++) {
      mesh.setColorAt(i, c.setHex(palette[i % palette.length]));
      this.conf.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3() });
    }
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    this.confetti = mesh;
    this.scene.add(mesh);
    this.dummy = new THREE.Object3D();
  }

  buildBeam() {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 0.8, 9, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      })
    );
    beam.position.set(0, 5.6, 0.6);
    this.beam = beam;
    this.scene.add(beam);
  }

  buildComposer() {
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.45, 1.15);
    composer.addPass(this.bloom);
    // tilt-shift: резкая полоса на подарке, верх и низ кадра мягко размыты
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    composer.addPass(this.tiltH);
    composer.addPass(this.tiltV);
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
  }

  // ---------- модели ----------

  async loadModels() {
    // Все модели — один сжатый файл (scripts/pack-models.sh): одна загрузка вместо 24.
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(packUrl, (e) => {
      if (e.total) this.onProgress?.(e.loaded / e.total);
    });
    this.models = {};
    for (const sc of gltf.scenes) {
      const g = new THREE.Group();
      g.name = sc.name;
      [...sc.children].forEach((c) => g.add(c));
      this.models[sc.name] = g;
    }
    // общий атлас Kenney: чуть матовее, чтобы не было «пластика»
    this.models['tree-decorated-snow'].traverse((o) => {
      if (o.isMesh) {
        o.material.roughness = 0.85;
        o.material.metalness = 0;
      }
    });
    this.layout();
    // компилируем шейдеры заранее, чтобы после заставки не было рывка
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {}
    this.onProgress?.(1);
    requestAnimationFrame(() => requestAnimationFrame(() => this.onReady?.()));
  }

  put(name, { pos = [0, 0, 0], rot = 0, scale = 1, parent = this.scene, shadow = true } = {}) {
    const obj = this.models[name].clone(true);
    obj.position.set(...pos);
    obj.rotation.y = rot;
    obj.scale.setScalar(scale);
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = shadow;
        o.receiveShadow = true;
      }
    });
    parent.add(obj);
    return obj;
  }

  layout() {
    const R = rng(7);

    // Главный подарок с отдельной крышкой
    const gift = this.put('present-a-cube', { pos: [0, 0, 0.6], rot: 0.45, scale: GIFT_SCALE });
    gift.traverse((o) => o.isMesh && (o.material = o.material.clone()));
    this.gift = gift;
    this.lid = gift.getObjectByName('lid');
    this.lidBase = this.lid.position.clone();
    this.giftMats = [];
    gift.traverse((o) => o.isMesh && this.giftMats.push(o.material));

    // Ёлка и подарки под ней
    this.tree = this.put('tree-decorated-snow', { pos: [-4.4, 0, -1.6], rot: 0.3, scale: 2.8 });
    this.put('present-b-round', { pos: [-2.8, 0, -0.3], rot: 0.6, scale: 2.4 });
    this.put('present-a-rectangle', { pos: [-5.7, 0, 0.1], rot: -0.4, scale: 2.3 });
    this.put('present-b-cube', { pos: [-3.7, 0, 0.6], rot: 1.1, scale: 2.2 });
    this.put('gingerbread-man', { pos: [-1.9, 0, 1.6], rot: 0.35, scale: 2.3 });

    // Олень ведёт сани с подарками
    const heading = -0.55; // смотрит влево-вперёд, к подарку
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const deerPos = new THREE.Vector3(2.0, 0, -1.2);
    this.deer = this.put('reindeer', { pos: deerPos.toArray(), rot: heading, scale: 2.4 });
    const sledPos = deerPos.clone().addScaledVector(dir, -3.1);
    const sled = this.put('sled-long', { pos: sledPos.toArray(), rot: heading, scale: 2.7 });
    sled.updateMatrixWorld(true);
    [
      ['present-a-round', [0.05, 0.38, -0.2], 0.95, 0.3],
      ['present-b-cube', [-0.1, 0.38, 0.18], 0.85, 1.0],
      ['present-a-cube', [0.08, 0.38 + 0.3, -0.05], 0.7, -0.4],
    ].forEach(([n, p, s, r]) => {
      const w = sled.localToWorld(new THREE.Vector3(...p));
      this.put(n, { pos: w.toArray(), rot: heading + r, scale: 2.7 * s });
    });

    // Фонарь с венком. Высокий, чтобы гирлянда с носками висела над сценой.
    // Всё, что на нём висит или светит, задаём в долях высоты фонаря.
    const lampPos = new THREE.Vector3(0.9, 0, -4.0);
    this.lampPos = lampPos;
    const lampH = 1.737 * LAMP_SCALE; // высота модели lantern × масштаб
    this.lampH = lampH;
    this.lamp = this.put('lantern', { pos: lampPos.toArray(), rot: -0.3, scale: LAMP_SCALE });
    this.put('wreath-decorated', { pos: [lampPos.x, lampH * 0.49, lampPos.z + 0.28], rot: -0.3, scale: 1.4 });
    const lampLight = new THREE.PointLight(0xffb866, 30, 14, 1.7);
    lampLight.position.set(lampPos.x, lampH * 0.86, lampPos.z + 0.4);
    this.scene.add(lampLight);
    const lampGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc477).multiplyScalar(1.8), fog: false })
    );
    lampGlow.position.set(lampPos.x, lampH * 0.83, lampPos.z);
    this.scene.add(lampGlow);

    // Тёплый свет от ёлки
    const treeLight = new THREE.PointLight(0xff9f4a, 22, 10, 1.6);
    treeLight.position.set(-3.3, 2.4, 0.4);
    this.scene.add(treeLight);
    this.treeLight = treeLight;
    this.addTreeBulbs();

    // Снеговик и леденцы в снегу
    this.put('snowman-hat', { pos: [-7.6, 0, -2.6], rot: 0.5, scale: 2.3 });
    [
      ['candy-cane-red', [-1.6, 0, 3.4], 0.3, 3.4],
      ['candy-cane-green', [-0.7, 0, 3.9], -0.2, 2.6],
      ['candy-cane-red', [1.7, 0, 3.2], -0.5, 3.0],
      ['candy-cane-green', [4.6, 0, 1.6], 0.9, 3.2],
      ['candy-cane-red', [5.5, 0, 0.9], 0.2, 2.6],
      ['candy-cane-red', [-6.3, 0, 1.8], -0.8, 3.0],
      ['candy-cane-green', [-4.9, 0, 2.6], 0.4, 2.4],
    ].forEach(([n, p, r, s]) => this.put(n, { pos: p, rot: r, scale: s }));

    // Сугробы и камни
    [[-1.8, -2.4, 3.2], [3.5, 2.4, 2.6], [6.5, -1.5, 3.8], [-7.5, 0.8, 3.4], [0.5, -6, 4.5], [-3, 3.2, 2.2], [7.5, -5, 4]].forEach(
      ([x, z, s]) => this.put('snow-pile', { pos: [x, 0, z], rot: R() * 6, scale: s, shadow: false })
    );
    this.put('rocks-medium', { pos: [6.6, 0, -3.2], rot: 1, scale: 2.4 });

    // Лес на заднем плане (уходит в туман и tilt-shift)
    const trees = ['tree-snow-a', 'tree-snow-b', 'tree-snow-c'];
    const spots = [[], [], []];
    for (let i = 0; i < 46; i++) {
      const x = (R() - 0.5) * 44;
      const z = -9 - R() * 20;
      const rot = R() * 6;
      const sc = 2.4 + R() * 2.2;
      if (Math.abs(x) < 4 && z > -12) continue;
      spots[i % 3].push(new THREE.Matrix4().compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot),
        new THREE.Vector3(sc, sc, sc)
      ));
    }
    trees.forEach((name, ti) => {
      const root = this.models[name];
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        const inst = new THREE.InstancedMesh(o.geometry, o.material, spots[ti].length);
        spots[ti].forEach((mx, k) => inst.setMatrixAt(k, mx.clone().multiply(o.matrixWorld)));
        inst.castShadow = true;
        inst.receiveShadow = true;
        this.scene.add(inst);
      });
    });
    // и пара ёлок по бокам ближе к камере
    this.put('tree-snow-b', { pos: [-10.5, 0, -1.5], rot: 1, scale: 3.4 });
    this.put('tree-snow-a', { pos: [10.5, 0, -2.5], rot: 2, scale: 3.6 });

    this.buildGarland();
    this.resize(true);
    this.shadowDirty = 2;
  }

  // Огоньки прямо на ветках: стреляем лучами в модель ёлки снаружи к оси.
  addTreeBulbs() {
    const tree = this.tree;
    tree.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(tree);
    const center = box.getCenter(new THREE.Vector3());
    const H = box.max.y - box.min.y;
    const ray = new THREE.Raycaster();
    const R = rng(3);
    const colors = [0xffcf6e, 0xff5a4a, 0x8fe07a, 0x7cc4ff, 0xffffff];
    const points = [];
    for (let i = 0; i < 90; i++) {
      const y = box.min.y + H * (0.16 + R() * 0.68);
      const a = R() * Math.PI * 2;
      const dirOut = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const origin = new THREE.Vector3(center.x, y, center.z).addScaledVector(dirOut, 6);
      ray.set(origin, dirOut.clone().negate());
      const hit = ray.intersectObject(tree, true)[0];
      if (!hit) continue;
      points.push({
        pos: hit.point.clone().addScaledVector(dirOut, 0.04),
        base: new THREE.Color(colors[i % colors.length]),
        phase: R() * 10,
      });
    }
    // все огоньки — один InstancedMesh, один draw call
    const mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      points.length
    );
    const m = new THREE.Matrix4();
    points.forEach((p, i) => {
      mesh.setMatrixAt(i, m.makeTranslation(p.pos.x, p.pos.y, p.pos.z));
      mesh.setColorAt(i, p.base);
    });
    this.scene.add(mesh);
    this.bulbMesh = mesh;
    this.bulbs = points;
  }

  // Гирлянда от ёлки до фонаря из моделей lights-colored, на ней носки с именами.
  buildGarland() {
    if (!this.models) return;
    if (this.garland) this.scene.remove(this.garland);
    this.stockings = [];
    const g = new THREE.Group();
    const A = new THREE.Vector3(-3.85, 5.9, -1.4);
    const B = this.lampPos.clone().add(new THREE.Vector3(-0.15, this.lampH * 0.9, 0.15));
    const N = Math.max(this.names.length, 4);
    // Один ряд — носки уменьшаются, когда их больше 4. Два ряда (чётные выше, нечётные
    // ниже на длинной верёвочке) — бирки соседей не налезают друг на друга.
    const twoRows = N > ONE_ROW_MAX;
    // Гирлянда уходит вглубь сцены, а бирки смотрят в камеру, поэтому соседей на экране
    // разделяет только горизонтальная проекция шага. Бирка (1.15 в ширину) занимает
    // не больше 80% этого расстояния.
    const step = ((twoRows ? 2 : 1) * Math.abs(B.x - A.x)) / N;
    const K = Math.min(twoRows ? 0.85 : 1, (0.8 * step) / 1.15);
    // второй ряд висит ниже: его носок с подарком сверху не должен заходить на бирку первого ряда
    const DROP = 1.9 * K;
    const src = this.models['lights-colored'];
    const bb = new THREE.Box3().setFromObject(src);
    const segLen = A.distanceTo(B) / N;
    const s = segLen / (bb.max.x - bb.min.x);
    const dir = B.clone().sub(A).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const sockModels = ['sock-red-cane', 'sock-green', 'sock-red', 'sock-green-cane'];

    for (let i = 0; i < N; i++) {
      const mid = A.clone().lerp(B, (i + 0.5) / N);
      const seg = src.clone(true);
      seg.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          o.material.emissive = new THREE.Color(0xffffff);
          o.material.emissiveMap = o.material.map;
          o.material.emissiveIntensity = 2.2;
        }
      });
      seg.scale.setScalar(s);
      seg.quaternion.copy(q);
      // концы сегмента — на линии A–B, провисание вниз
      seg.position.copy(mid).add(new THREE.Vector3(0, -bb.max.y * s, 0));
      g.add(seg);

      const person = this.names[i];
      if (!person) continue;
      // pivot — точка крепления к гирлянде (вокруг неё носок покачивается),
      // holder — сам носок с биркой; во втором ряду он висит ниже на верёвочке.
      const pivot = new THREE.Group();
      pivot.position.copy(mid).add(new THREE.Vector3(0, -bb.max.y * s * 0.85, 0));
      pivot.scale.setScalar(K);
      const holder = new THREE.Group();
      pivot.add(holder);
      if (twoRows && i % 2 === 1) {
        const drop = DROP / K; // в координатах pivot, он уже уменьшен в K раз
        holder.position.y = -drop;
        const rope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, drop, 5),
          new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 1 })
        );
        rope.position.y = -drop / 2;
        pivot.add(rope);
      }
      const SS = 2.1;
      const red = i % 2 === 0;
      // вытянул — носок с леденцом и большим подарком сверху; нет — носок пустой
      const sock = this.put(person.drawn ? (red ? 'sock-red-cane' : 'sock-green-cane') : red ? 'sock-red' : 'sock-green', {
        scale: SS,
        parent: holder,
      });
      sock.position.y = -0.64 * SS;
      if (person.drawn) {
        const p = this.put(i % 2 ? 'present-b-cube' : 'present-a-cube', {
          pos: [0.02, -0.26, 0.04],
          rot: 0.6,
          scale: 1.5,
          parent: holder,
        });
        p.rotation.z = 0.18;
      }
      if (person.name) {
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(1.15, 0.54),
          new THREE.MeshStandardMaterial({
            map: nameTexture(person.name, person.drawn),
            transparent: true,
            roughness: 0.9,
            alphaTest: 0.05,
          })
        );
        // бирка висит перед носком, ниже отворота: не пересекается с моделью
        label.position.set(0.02, -0.95, 0.5);
        label.rotation.z = (i % 2 ? 1 : -1) * 0.07;
        label.castShadow = true;
        holder.add(label);
        this.shadowDirty = 2;
      }
      g.add(pivot);
      this.stockings.push(pivot);
    }
    this.garland = g;
    this.scene.add(g);
  }

  // people: [{ name, drawn }]
  setStockingNames(people) {
    this.names = people;
    this.buildGarland();
  }

  // ---------- имя из подарка ----------

  // Бирка с именем вылетает из коробки, крутится и зависает перед камерой.
  // Промис отдаёт её прямоугольник на экране — оттуда HTML-копия полетит в карточку.
  raiseName(name) {
    this.hideName();
    const W = 2.4;
    const H = (W * 188) / 400;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: bigTagTexture(name), transparent: true, side: THREE.DoubleSide, fog: false })
    );
    mesh.renderOrder = 10;
    mesh.userData = { W, H };
    const from = this.gift ? this.gift.position.clone() : new THREE.Vector3(0, 0, 0.6);
    mesh.position.set(from.x, 1.0, from.z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.nameTag = mesh;
    this.nameStart = this.clock.elapsedTime;
    return new Promise((resolve) => (this.nameResolve = resolve));
  }

  hideName() {
    if (!this.nameTag) return;
    this.scene.remove(this.nameTag);
    this.nameTag.material.map.dispose();
    this.nameTag = null;
  }

  // Прямоугольник бирки в координатах окна.
  nameRect() {
    const m = this.nameTag;
    m.updateMatrixWorld(true);
    const { W, H } = m.userData;
    const box = this.renderer.domElement.getBoundingClientRect();
    const xs = [];
    const ys = [];
    for (const [x, y] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]) {
      const v = new THREE.Vector3(x, y, 0).applyMatrix4(m.matrixWorld).project(this.camera);
      xs.push(box.left + ((v.x + 1) / 2) * box.width);
      ys.push(box.top + ((1 - v.y) / 2) * box.height);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  // ---------- фазы подарка ----------

  burst() {
    this.confetti.visible = true;
    for (const c of this.conf) {
      c.p.set((Math.random() - 0.5) * 1.2, 1.6, 0.6 + (Math.random() - 0.5) * 1.2);
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3.5;
      c.v.set(Math.cos(a) * sp * 0.6, 5 + Math.random() * 6, Math.sin(a) * sp * 0.6);
      c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      c.w.set(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5);
    }
  }

  setPhase(phase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.phaseStart = this.clock.elapsedTime;
    if (phase === 'open') this.burst();
    if (phase === 'idle') this.hideName();
    if (phase === 'idle' && this.lid) {
      this.lid.position.copy(this.lidBase);
      this.lid.rotation.set(0, 0, 0);
      this.lid.visible = true;
      this.confetti.visible = false;
      this.beam.material.opacity = 0;
      this.giftGlow.intensity = 0;
    }
  }

  // ---------- кадр ----------

  resize(force) {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h || (!force && w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    const aspect = w / h;
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);

    const cam = this.camera;
    cam.aspect = aspect;
    if (aspect < 0.8) {
      // телефон: камера дальше и выше, сцена в верхней половине экрана
      cam.fov = 40;
      this.camBase.pos.set(-0.6, 7, 25);
      this.camBase.look.set(-0.6, -1.4, 0);
      this.focus = 0.62;
    } else {
      cam.fov = 32;
      this.camBase.pos.set(-0.6, 4.4, 17.5);
      this.camBase.look.set(-0.6, 1.9, 0);
      this.focus = 0.4;
    }
    if (w > 900) cam.setViewOffset(w, h, w * 0.2, 0, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();

    this.tiltH.uniforms.r.value = this.focus;
    this.tiltV.uniforms.r.value = this.focus;
    this.grade.uniforms.uAspect.value = aspect;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    const pt = t - this.phaseStart;

    // «дышащая» камера
    const cam = this.camera;
    const want = this.phase === 'open' ? 1 : 0;
    this.push = (this.push || 0) + (want - (this.push || 0)) * Math.min(1, dt * 2.2);
    cam.position.copy(this.camBase.pos).add(new THREE.Vector3(Math.sin(t * 0.13) * 0.35, Math.sin(t * 0.21) * 0.12, 0));
    cam.position.lerp(this.camBase.look, this.push * 0.16); // лёгкий наезд на подарок
    cam.lookAt(this.camBase.look);
    const sharp = 1 - this.push;
    if (this.w) {
      this.tiltH.uniforms.h.value = (0.9 / this.w) * sharp;
      this.tiltV.uniforms.v.value = (0.9 / this.h) * sharp;
    }

    if (this.nameTag) {
      const m = this.nameTag;
      const nt = t - this.nameStart;
      const k = Math.min(nt / 1.4, 1);
      const e = 1 - Math.pow(1 - k, 3); // ease-out
      const back = k < 1 ? 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2) : 1; // лёгкий перелёт
      // цель — перед подарком, ближе к камере
      const target = new THREE.Vector3(this.gift ? this.gift.position.x : 0, 3.0, 2.6);
      m.position.set(
        THREE.MathUtils.lerp(m.position.x, target.x, 0.2),
        1.0 + (target.y - 1.0) * e + (k >= 1 ? Math.sin((nt - 1.4) * 2.4) * 0.05 : 0),
        0.6 + (target.z - 0.6) * e
      );
      m.scale.setScalar(0.1 + 0.9 * back);
      m.lookAt(cam.position);
      m.rotateY((1 - e) * Math.PI * 4); // два оборота, пока летит вверх
      if (nt > 2.0 && this.nameResolve) {
        m.lookAt(cam.position);
        const r = this.nameResolve;
        this.nameResolve = null;
        r(this.nameRect());
      }
    }

    for (const layer of this.snowLayers) {
      const pos = layer.geometry.attributes.position.array;
      const { speed, top } = layer.userData;
      for (let i = 0; i < speed.length; i++) {
        pos[i * 3 + 1] -= speed[i] * dt;
        pos[i * 3] += Math.sin(t * 0.5 + i) * 0.003;
        if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = top;
      }
      layer.geometry.attributes.position.needsUpdate = true;
    }

    if (this.bulbMesh) {
      const tmp = this.tmpColor || (this.tmpColor = new THREE.Color());
      this.bulbs.forEach((b, i) => {
        const k = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.8 + b.phase));
        this.bulbMesh.setColorAt(i, tmp.copy(b.base).multiplyScalar(5 * k));
      });
      this.bulbMesh.instanceColor.needsUpdate = true;
    }
    if (this.treeLight) this.treeLight.intensity = 20 + Math.sin(t * 2.3) * 2;
    this.stockings.forEach((s, i) => (s.rotation.z = Math.sin(t * 1.2 + i * 1.3) * 0.05));

    this.sky.material.uniforms.uTime.value = t;
    this.grade.uniforms.uTime.value = t;

    const g = this.gift;
    if (g) {
      const S = GIFT_SCALE;
      if (this.phase === 'idle') {
        g.rotation.z = 0;
        g.rotation.x = 0;
        g.position.y = 0;
        this.giftMats.forEach((m) => m.emissive.setRGB(0, 0, 0));
      } else if (this.phase === 'shake') {
        const k = Math.min(pt / 2, 1);
        g.rotation.y += dt * k * 5;
        g.rotation.z = Math.sin(t * 38) * 0.07 * k;
        g.rotation.x = Math.cos(t * 31) * 0.05 * k;
        g.position.y = Math.abs(Math.sin(t * 14)) * 0.2 * k;
        this.lid.position.y = this.lidBase.y + (Math.abs(Math.sin(t * 22)) * 0.1 * k) / S;
        this.giftMats.forEach((m) => m.emissive.setRGB(0.12 * k, 0.06 * k, 0.01 * k));
        this.giftGlow.intensity = 14 * k;
      } else if (this.phase === 'open') {
        g.rotation.y += dt * Math.max(0, 3 - pt * 3);
        g.rotation.z *= 0.9;
        g.rotation.x *= 0.9;
        g.position.y *= 0.9;
        this.giftMats.forEach((m) => m.emissive.multiplyScalar(0.9));
        this.lid.position.y = this.lidBase.y + (pt * 7 + pt * pt * 2) / S;
        this.lid.position.x = (pt * 2.2) / S;
        this.lid.rotation.z = -pt * 4;
        this.lid.rotation.x = pt * 2;
        if (pt > 2.5) this.lid.visible = false;
        this.beam.material.opacity = Math.min(pt * 1.2, 0.14) * (0.85 + Math.sin(t * 6) * 0.15);
        this.beam.rotation.y += dt * 0.4;
        this.giftGlow.intensity = (14 + Math.sin(t * 5) * 3) * Math.max(0.35, 1 - pt / 4);
      }
    }

    if (this.confetti.visible) {
      const d = this.dummy;
      this.conf.forEach((c, i) => {
        c.v.y -= 9.8 * dt;
        c.v.multiplyScalar(0.985);
        if (c.v.y < -1.4) c.v.y = -1.4;
        c.p.addScaledVector(c.v, dt);
        if (c.p.y < 0.02) {
          c.p.y = 0.02;
          c.v.set(0, 0, 0);
          c.w.set(0, 0, 0);
          c.r.set(-Math.PI / 2, 0, c.r.z);
        }
        c.r.x += c.w.x * dt;
        c.r.y += c.w.y * dt;
        c.r.z += c.w.z * dt;
        d.position.copy(c.p);
        d.rotation.copy(c.r);
        d.updateMatrix();
        this.confetti.setMatrixAt(i, d.matrix);
      });
      this.confetti.instanceMatrix.needsUpdate = true;
    }

    if (this.phase !== 'idle' || this.shadowDirty > 0) {
      this.renderer.shadowMap.needsUpdate = true;
      if (this.shadowDirty > 0) this.shadowDirty--;
    }
    this.composer.render(dt);
    this.adaptQuality(dt);
  }

  // Если кадры медленные — снижаем разрешение и выключаем tilt-shift.
  adaptQuality(dt) {
    if (this.qualityDone) return;
    this.fpsT = (this.fpsT || 0) + dt;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsT < 2.5) return;
    const fps = this.fpsN / this.fpsT;
    this.fpsT = 0;
    this.fpsN = 0;
    if (fps >= 45) return (this.qualityDone = true);
    if (this.renderer.getPixelRatio() > 1) {
      this.renderer.setPixelRatio(1);
      this.composer.setPixelRatio(1);
      this.resize(true);
    } else {
      this.tiltH.enabled = false;
      this.tiltV.enabled = false;
      this.bloom.resolution.set(128, 128);
      this.qualityDone = true;
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.ro.disconnect();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// Имя от руки на белом отвороте носка.
function nameTexture(name, drawn) {
  const W = 400;
  const H = 188;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.beginPath();
  ctx.roundRect(8, 8, W - 16, H - 16, 26);
  ctx.fillStyle = drawn ? '#2f8a55' : '#fbf3e2';
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = drawn ? '#1d5c37' : '#d23a2f';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, 32, 9, 0, Math.PI * 2);
  ctx.fillStyle = drawn ? '#1d5c37' : '#d23a2f';
  ctx.fill();
  const label = drawn ? `${name} ✓` : name;
  ctx.fillStyle = drawn ? '#fff8ec' : '#3a2a1f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 88;
  do {
    ctx.font = `900 ${size}px Nunito, sans-serif`;
    size -= 4;
  } while (ctx.measureText(label).width > W - 50 && size > 24);
  ctx.fillText(label, W / 2, H / 2 + 16);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function bigTagTexture(name) {
  const W = 800;
  const H = 376;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const bw = 13;
  ctx.beginPath();
  ctx.roundRect(bw / 2, bw / 2, W - bw, H - bw, 53);
  ctx.fillStyle = '#fbf3e2';
  ctx.fill();
  ctx.lineWidth = bw;
  ctx.strokeStyle = '#d23a2f';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, H * 0.14, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#d23a2f';
  ctx.fill();
  ctx.fillStyle = '#d8322c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 144;
  do {
    ctx.font = `900 ${size}px Nunito, sans-serif`;
    size -= 6;
  } while (ctx.measureText(name).width > W - 110 && size > 40);
  ctx.fillText(name, W / 2, H * 0.56);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dotTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
