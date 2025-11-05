import * as THREE from "three";
import {
    OrbitControls
} from "https://cdn.jsdelivr.net/npm/three@0.157.0/examples/jsm/controls/OrbitControls.js";
import {
    EffectComposer
} from "https://cdn.jsdelivr.net/npm/three@0.157.0/examples/jsm/postprocessing/EffectComposer.js";
import {
    RenderPass
} from "https://cdn.jsdelivr.net/npm/three@0.157.0/examples/jsm/postprocessing/RenderPass.js";
import {
    AfterimagePass
} from "https://cdn.jsdelivr.net/npm/three@0.157.0/examples/jsm/postprocessing/AfterimagePass.js";
import {
    makeMat
} from "./materials.min.js";

const appData = window.dataMemoryHeartLoveLoom?.data || {};

let allWordsFlat = [];
const originalTexts = appData.messages || [];
originalTexts.forEach(sentence => {
    const words = sentence.split(' ');
    allWordsFlat.push(...words);
});

let currentWordIndex = 0;
let nextWordSpawnTime = 0;
const WORD_SPAWN_INTERVAL = 0.4;

const IMAGE_CONFIG = {
    paths: appData.images || [],
    count: appData.images?.length || 0,
    scale: 2.5,
    glowIntensity: 0.6,
    spawnRate: .18,
    maxActiveImages: 45,
    spawnInterval: 400
};
    console.log("Image config:", IMAGE_CONFIG);
const useCustomColor = appData.heartColor && /^#([A-Fa-f0-9]{8}|[A-Fa-f0-9]{6})$/.test(appData.heartColor);
const heartInitialColor = new THREE.Color(useCustomColor ? appData.heartColor : '#FF69B4');

let imageTextures = [],
    imageLoadingComplete = !1,
    imagePool = [],
    activeImages = new Map,
    freeImageIndices = [],
    currentImageIndex = 0,
    lastImageSpawnTime = 0,
    imageSpawnQueue = [],
    minActiveImages = 8,
    maxConcurrentImages = 24,
    lastStatusLogTime = 0,
    independentImageSprites = [],
    nextIndependentSpawnTime = 0;
const textureLoader = new THREE.TextureLoader;
async function fetchAndPrepareImageTextures() {
    try {
        const t = IMAGE_CONFIG.paths.map(t => new Promise((e, a) => {
            textureLoader.load(t, t => {
                t.minFilter = THREE.LinearFilter, t.magFilter = THREE.LinearFilter, t.format = THREE.RGBAFormat, t.needsUpdate = !0, e(t)
            }, void 0, t => {
                const a = document.createElement("canvas");
                a.width = a.height = 512;
                const o = a.getContext("2d"),
                    s = o.createRadialGradient(256, 256, 0, 256, 256, 256);
                s.addColorStop(0, "#ff69b4"), s.addColorStop(1, "#ff1493"), o.fillStyle = s, o.fillRect(0, 0, 512, 512);
                const r = new THREE.CanvasTexture(a);
                r.needsUpdate = !0, e(r)
            })
        }));
        return imageTextures = await Promise.all(t), !0
    } catch (t) {
        return !1
    }
}

function buildImageSpriteMaterial(t, e = 1) {
    return new THREE.SpriteMaterial({
        map: t,
        transparent: !0,
        opacity: e,
        depthWrite: !1,
        alphaTest: .1,
        sizeAttenuation: !0
    })
}

function getAspectRatioAdjustedScale(t, e = 2.5) {
    if (!t || !t.image) return e;
    const a = t.image.width / t.image.height;
    return {
        x: a > 1 ? e : e * a,
        y: a > 1 ? e / a : e
    }
}
async function setupImageStreaming() {
    imageLoadingComplete = await fetchAndPrepareImageTextures(), imageLoadingComplete && tweakSpawnParametersByImageCount()
}

function tweakSpawnParametersByImageCount() {
    const t = IMAGE_CONFIG.count;
    t <= 2 ? (IMAGE_CONFIG.spawnInterval = 300, minActiveImages = 6, maxConcurrentImages = Math.min(15, 7.5 * t)) : t <= 5 ? (IMAGE_CONFIG.spawnInterval = 400, minActiveImages = 8, maxConcurrentImages = Math.min(18, 3.5 * t)) : (IMAGE_CONFIG.spawnInterval = 500, minActiveImages = 8, maxConcurrentImages = Math.min(30, Math.ceil(2.5 * t)))
}

function printImageSystemReport() {
    activeImages.size, independentImageSprites.length, freeImageIndices.length, imageSpawnQueue.length
}

function setupImageObjectPool() {
    if (imageLoadingComplete && streamHeart) {
        imagePool.forEach(t => {
            t && t.parent && t.parent.remove(t)
        }), imagePool.length = 0, activeImages.clear(), freeImageIndices.length = 0;
        for (let t = 0; t < IMAGE_CONFIG.maxActiveImages; t++) {
            const e = t % IMAGE_CONFIG.count,
                a = imageTextures[e],
                o = buildImageSpriteMaterial(a, 1),
                s = new THREE.Sprite(o),
                r = getAspectRatioAdjustedScale(a, IMAGE_CONFIG.scale);
            s.scale.set(r.x, r.y, 1), s.visible = !1, s.userData = {
                poolIndex: t,
                textureIndex: e,
                isActive: !1,
                particleIndex: -1,
                aspectScale: r
            }, streamHeart.add(s), imagePool.push(s), freeImageIndices.push(t)
        }
    }
}

function retrieveImageFromPool(t) {
    if (0 === freeImageIndices.length) return null;
    const e = freeImageIndices.pop(),
        a = imagePool[e],
        o = currentImageIndex % IMAGE_CONFIG.count,
        s = imageTextures[o];
    a.material.map = s, a.material.needsUpdate = !0;
    const r = getAspectRatioAdjustedScale(s, IMAGE_CONFIG.scale);
    return a.scale.set(r.x, r.y, 1), a.userData.aspectScale = r, a.userData.textureIndex = o, a.userData.isActive = !0, a.userData.particleIndex = t, activeImages.set(t, e), currentImageIndex = (currentImageIndex + 1) % IMAGE_CONFIG.count, a
}

function releaseImageToPool(t) {
    const e = activeImages.get(t);
    if (void 0 !== e) {
        const a = imagePool[e];
        a.visible = !1, a.material.opacity = 0, a.userData.isActive = !1, a.userData.particleIndex = -1, activeImages.delete(t), freeImageIndices.push(e)
    }
}

function controlImageSpawningLogic(t) {
    const e = activeImages.size + independentImageSprites.length,
        a = e < minActiveImages,
        o = t - lastImageSpawnTime >= IMAGE_CONFIG.spawnInterval && e < maxConcurrentImages;
    if (!a && !o) return;
    (a || t >= nextIndependentSpawnTime) && createFloatingImageSprite(t);
    let s = selectBestParticleForImageSpawn(); - 1 !== s && freeImageIndices.length > 0 && (imageSpawnQueue.push({
        particleIndex: s,
        imageIndex: currentImageIndex % IMAGE_CONFIG.count,
        spawnTime: t,
        isForced: a
    }), currentImageIndex = (currentImageIndex + 1) % IMAGE_CONFIG.count, lastImageSpawnTime = t)
}

function createFloatingImageSprite(t) {
    const e = Math.ceil(.8 * maxConcurrentImages);
    if (independentImageSprites.length >= e) return;
    const a = currentImageIndex % IMAGE_CONFIG.count,
        o = imageTextures[a],
        s = buildImageSpriteMaterial(o, 1),
        r = new THREE.Sprite(s),
        i = getAspectRatioAdjustedScale(o, IMAGE_CONFIG.scale);
    r.scale.set(i.x, i.y, 1), r.visible = !1, r.userData = {
        isIndependent: !0,
        imageIndex: a,
        spawnTime: t,
        lifeDuration: 6e3 + 2e3 * Math.random(),
        startY: planeYCenter,
        startX: 0,
        startZ: 0,
        aspectScale: i
    }, streamHeart.add(r), independentImageSprites.push(r), currentImageIndex = (currentImageIndex + 1) % IMAGE_CONFIG.count, lastImageSpawnTime = t, nextIndependentSpawnTime = t + 1.2 * IMAGE_CONFIG.spawnInterval
}

function animateFloatingImageSprites(t) {
    for (let e = independentImageSprites.length - 1; e >= 0; e--) {
        const a = independentImageSprites[e],
            o = a.userData,
            s = (t - o.spawnTime) / o.lifeDuration;
        if (s >= 1) {
            streamHeart.remove(a), independentImageSprites.splice(e, 1);
            continue
        }
        a.visible = !0;
        const r = 1 - Math.pow(1 - s, 2),
            i = 0,
            n = planeYCenter,
            l = 0,
            m = 10 + 4 * Math.sin(s * Math.PI * 2),
            c = THREE.MathUtils.lerp(n, m, r),
            p = 1.5 + o.imageIndex % 5 * .3,
            d = o.imageIndex % 2 == 0 ? 1 : -1,
            h = s * p * Math.PI * 2 * d,
            u = (1 - r) * (6 + 3 * Math.sin(o.imageIndex)),
            A = THREE.MathUtils.lerp(i, 0, r),
            E = THREE.MathUtils.lerp(l, 0, r),
            T = A + Math.cos(h) * u,
            f = E + Math.sin(h) * u;
        if (a.position.set(T, c, f), s < .1) {
            a.material.opacity = s / .1;
            const t = a.userData.aspectScale || {
                x: IMAGE_CONFIG.scale,
                y: IMAGE_CONFIG.scale
            };
            a.scale.set(t.x * (.5 + 5 * s), t.y * (.5 + 5 * s), 1)
        } else if (s > .4) {
            const t = (s - .4) / .6;
            a.material.opacity = 1 - t;
            const e = 1 - .9 * t,
                o = a.userData.aspectScale || {
                    x: IMAGE_CONFIG.scale,
                    y: IMAGE_CONFIG.scale
                };
            a.scale.set(o.x * e, o.y * e, 1), t > .9 && (a.visible = !1)
        } else {
            a.material.opacity = 1;
            const t = a.userData.aspectScale || {
                x: IMAGE_CONFIG.scale,
                y: IMAGE_CONFIG.scale
            };
            a.scale.set(t.x, t.y, 1)
        }
    }
}

function selectBestParticleForImageSpawn() {
    const t = [];
    for (let e = 0; e < streamCount; e++)
        if (!activeImages.has(e)) {
            const a = streamState[e];
            t.push({
                index: e,
                state: a,
                priority: a === STATE_ASCEND ? 3 : a === STATE_ON_DISK ? 2 : 1
            })
        } return 0 === t.length ? -1 : (t.sort((t, e) => e.priority - t.priority), t[0].index)
}

function handleQueuedImageSpawns() {
    for (; imageSpawnQueue.length > 0;) {
        const t = imageSpawnQueue.shift(),
            {
                particleIndex: e,
                imageIndex: a
            } = t;
        !activeImages.has(e) && freeImageIndices.length > 0 && retrieveImageFromPool(e)
    }
}

function applyMobileSpecificSettings() {
    if (!document.querySelector('meta[name="viewport"]')) {
        const t = document.createElement("meta");
        t.name = "viewport", t.content = "width=device-width, initial-scale=1.0, user-scalable=no", document.head.appendChild(t)
    }
    document.body.style.overflow = "hidden", document.body.style.position = "fixed", document.body.style.width = "100%", document.body.style.height = "100%", /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) && renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
}
setupImageStreaming();
let STAR_COUNT = 0,
    starAlpha = null,
    starPhase = null,
    starGeo = null;
const RingText = [...appData.messages];

let cameraAnimationStart = null;
const CAMERA_ANIMATION_DURATION = 2.5;
let CAMERA_START_POSITION = {
    x: 0,
    y: 90,
    z: 30
};
const CAMERA_END_POSITION = {
    x: 0,
    y: 25,
    z: 65
};
let userHasMovedCamera = !1,
    streamHeartStarted = !1,
    streamHeartActiveRatio = 0,
    firstResetCompleted = !1;
const scene = new THREE.Scene,
    heartScene = new THREE.Scene,
    renderer = new THREE.WebGLRenderer({
        antialias: !0,
        alpha: !0
    }),
    HEART_ROTATE = !1;
let heartbeatEnabled = !1;
const fadeObjects = [];


const explosionEffects = []; // Mảng để quản lý các hiệu ứng bùng nổ
const effectPool = { // Một object để chứa tất cả các hồ hiệu ứng
    waves: [],
    sparkles: [],
    texts: []
};
const POOL_SIZE = 5; // Tạo sẵn 5 hiệu ứng, đủ để xử lý các click nhanh
const activeTexts = new Map(); // <<< THÊM DÒNG NÀY: Quản lý các chữ đang bay

let isPulsing = false;
let pulseStartTime = 0;
const PULSE_DURATION = 0.6;   // Nhịp đập kéo dài 0.6 giây
const PULSE_AMPLITUDE = 0.15; // Phồng to hơn 15%

let revealStart = null;
const REVEAL_DURATION = 1.5,
    HEARTBEAT_FREQ_HZ = .5,
    HEARTBEAT_AMPLITUDE = .05,
    STAGE = {
        RIBBON: 0,
        STREAM: 1,
        STAR: 2,
        SHOOT: 3,
        HEART: 4
    },
    STAGE_DURATION = .15;
renderer.setPixelRatio(window.devicePixelRatio), renderer.setSize(window.innerWidth, window.innerHeight), document.body.appendChild(renderer.domElement), applyMobileSpecificSettings();
let staticBottomHeart = null,
    staticTopHeart = null;
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, .1, 300);
camera.position.set(0, 90, 25), camera.lookAt(0, 0, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !0, controls.minDistance = 5, controls.maxDistance = 100, controls.enableZoom = !0, controls.minPolarAngle = THREE.MathUtils.degToRad(60), controls.maxPolarAngle = THREE.MathUtils.degToRad(135), controls.enablePan = !0;

// TẠO MẶT PHẲNG VÔ HÌNH ĐỂ BẮT VỊ TRÍ CLICK
const planeGeo1 = new THREE.PlaneGeometry(30, 30);
const planeMat = new THREE.MeshBasicMaterial({
    color: 0xff00ff,
    side: THREE.DoubleSide,
    visible: false // Quan trọng: làm cho nó vô hình
});
const invisiblePlane = new THREE.Mesh(planeGeo1, planeMat);
invisiblePlane.rotation.z = Math.PI; // Xoay cho khớp với trái tim
invisiblePlane.position.y = 10;     // Đặt ở độ cao của trái tim
scene.add(invisiblePlane);

const composerMain = new EffectComposer(renderer),
    renderPassMain = new RenderPass(scene, camera);
renderPassMain.clear = !1, composerMain.addPass(renderPassMain);
const composerHeart = new EffectComposer(renderer);
composerHeart.addPass(new RenderPass(heartScene, camera));
const afterimagePass = new AfterimagePass;
afterimagePass.uniforms.damp.value = .9, composerHeart.addPass(afterimagePass), scene.add(new THREE.AmbientLight(16777215, .6));
const p1 = new THREE.PointLight(16777215, 1.2);
p1.position.set(10, 10, 10), scene.add(p1);
const p2 = new THREE.PointLight(16744703, .8);

function generateGlowCircleTexture() {
    const t = document.createElement("canvas");
    t.width = 256, t.height = 256;
    const e = t.getContext("2d"),
        a = 128,
        o = e.createRadialGradient(a, a, .4 * 127, a, a, 127);
    o.addColorStop(0, "rgba(255,105,180,0.6)"), o.addColorStop(1, "rgba(255,20,147,0)"), e.fillStyle = o, e.beginPath(), e.arc(a, a, 127, 0, 2 * Math.PI), e.closePath(), e.fill();
    const s = e.createRadialGradient(a, a, 0, a, a, 76.2);
    s.addColorStop(0, "rgba(255,255,255,1)"), s.addColorStop(1, "rgba(255,255,255,0)"), e.fillStyle = s, e.beginPath(), e.arc(a, a, 76.2, 0, 2 * Math.PI), e.closePath(), e.fill();
    const r = new THREE.CanvasTexture(t);
    return r.minFilter = THREE.LinearFilter, r.magFilter = THREE.LinearFilter, r.needsUpdate = !0, r
}
p2.position.set(-10, -10, -10), scene.add(p2);
const circleTexture = generateGlowCircleTexture(),
    heartShape = new THREE.Shape,
    x = 0,
    y = 0;
heartShape.moveTo(5, 5), heartShape.bezierCurveTo(5, 5, 4, 0, 0, 0), heartShape.bezierCurveTo(-6, 0, -6, 7, -6, 7), heartShape.bezierCurveTo(-6, 11, -3, 15.4, 5, 19), heartShape.bezierCurveTo(12, 15.4, 16, 11, 16, 7), heartShape.bezierCurveTo(16, 7, 16, 0, 10, 0), heartShape.bezierCurveTo(7, 0, 5, 5, 5, 5);
const polyPts = heartShape.getPoints(100);

function isPointInsidePolygon(t, e) {
    let a = !1;
    for (let o = 0, s = e.length - 1; o < e.length; s = o++) {
        const r = e[o].x,
            i = e[o].y,
            n = e[s].x,
            l = e[s].y;
        i > t.y != l > t.y && t.x < (n - r) * (t.y - i) / (l - i) + r && (a = !a)
    }
    return a
}
const polyShift = polyPts.map(t => ({
    x: t.x - 5,
    y: t.y - 7
})),
    BORDER_THRESHOLD = .1 * (Math.max(...polyPts.map(t => t.x)) - Math.min(...polyPts.map(t => t.x)));

function calculateMinimumDistanceToBorder(t, e) {
    let a = 1 / 0;
    for (let o = 0; o < polyShift.length; o++) {
        const s = polyShift[o],
            r = polyShift[(o + 1) % polyShift.length],
            i = r.x - s.x,
            n = r.y - s.y,
            l = ((t - s.x) * i + (e - s.y) * n) / (i * i + n * n),
            m = Math.max(0, Math.min(1, l)),
            c = t - (s.x + m * i),
            p = e - (s.y + m * n),
            d = c * c + p * p;
        d < a && (a = d)
    }
    return Math.sqrt(a)
}
// Khởi tạo các đối tượng cần thiết một lần để tối ưu hiệu suất
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const HEART_CENTER_TARGET = new THREE.Vector3(0, 10, 0);
// Hàm tạo hiệu ứng bùng nổ tại vị trí click
function createHeartExplosion(event) {
    // 1. Chuyển đổi tọa độ màn hình (pixel) thành tọa độ 3D
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    // 2. Bắn một tia từ camera qua điểm click
    raycaster.setFromCamera(mouse, camera);

    // 3. THAY VÌ KIỂM TRA VA CHẠM, CHÚNG TA TÍNH TOÁN TRỰC TIẾP MỘT ĐIỂM
    // Điểm này nằm trên tia bắn ra, cách camera một khoảng cố định.
    const explosionDistance = 60; // Khoảng cách từ camera tới điểm nổ, bạn có thể điều chỉnh
    const intersectionPoint = new THREE.Vector3();

    // Lấy điểm bắt đầu (vị trí camera) và hướng của tia
    // Sau đó tính điểm cuối bằng công thức: Điểm = Vị trí bắt đầu + Hướng * Khoảng cách
    raycaster.ray.at(explosionDistance, intersectionPoint);

    // 4. Tạo hiệu ứng bùng nổ tại điểm đã tính toán
    const explosionGroup = new THREE.Group();
    const explosionMat = makeMat({
        map: circleTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        alphaSupport: true,
        vertexColors: true
    });

    const count = 30 + Math.random() * 20;
    const positions = [];
    const colors = [];
    const sizes = [];
    const velocities = [];

    const baseColor = new THREE.Color().setHSL(Math.random(), 0.9, 0.7);

    for (let i = 0; i < count; i++) {
        positions.push(intersectionPoint.x, intersectionPoint.y, intersectionPoint.z);

        const color = baseColor.clone().offsetHSL(Math.random() * 0.2 - 0.1, 0, 0);
        colors.push(color.r, color.g, color.b);

        sizes.push(Math.random() * 0.8 + 0.2);

        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(Math.random() * 2 - 1);
        const speed = Math.random() * 15 + 10;

        const velocity = new THREE.Vector3();
        velocity.setFromSphericalCoords(1, phi, theta);
        velocities.push(velocity.multiplyScalar(speed));
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.Float32BufferAttribute(sizes, 1));

    const points = new THREE.Points(geo, explosionMat);

    explosionGroup.add(points);
    explosionGroup.userData.velocities = velocities;
    explosionGroup.userData.life = 1.0;

    scene.add(explosionGroup);
    explosionEffects.push(explosionGroup);
}
// Hàm khởi tạo tất cả hiệu ứng vào "hồ chứa" để tái sử dụng
function setupEffectPools() {
    // Tạo texture một lần duy nhất
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)'); // Làm cạnh mềm hơn
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const waveTexture = new THREE.CanvasTexture(canvas);

    for (let i = 0; i < POOL_SIZE; i++) {
        // --- Khởi tạo Sóng Năng Lượng ---
        const waveMat = new THREE.MeshBasicMaterial({
            map: waveTexture,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false
        });
        const wave = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), waveMat);
        wave.visible = false;
        wave.userData.active = false;
        scene.add(wave);
        effectPool.waves.push(wave);

        // --- Khởi tạo Bụi Sao ---
        const SPARKLE_COUNT = 100; // Giảm số lượng hạt
        const sparkleGeo = new THREE.BufferGeometry();
        // Cấp phát bộ nhớ trước cho các thuộc tính
        sparkleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKLE_COUNT * 3), 3).setUsage(THREE.DynamicDrawUsage));
        const sparkleMat = makeMat({ map: circleTexture, blending: THREE.AdditiveBlending, alphaSupport: true, depthWrite: false });
        const sparkles = new THREE.Points(sparkleGeo, sparkleMat);
        sparkles.visible = false;
        sparkles.userData.active = false;
        scene.add(sparkles);
        effectPool.sparkles.push(sparkles);
    }

    // Khởi tạo Text Sprites
    const textsToCreate = appData?.messages || [];
    // --- BẮT ĐẦU: KHỞI TẠO TEXT SPRITES (PHIÊN BẢN MỚI CHO TỪNG TỪ) ---
    // 1. Lấy tất cả các từ và tạo ra một danh sách các từ *duy nhất*
    const allWords = (appData?.messages || []).join(' ').split(' ');
    const uniqueWords = [...new Set(allWords.filter(word => word.length > 0))];

    // 2. Tạo một sprite cho mỗi từ duy nhất và đưa vào hồ chứa
    uniqueWords.forEach(word => {
        const textTexture = createFlyingTextTexture(word);
        const textMat = new THREE.SpriteMaterial({
            map: textTexture,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const textSprite = new THREE.Sprite(textMat);

        const aspectRatio = textTexture.image.width / textTexture.image.height;
        textSprite.scale.set(aspectRatio * 1.5, 1.5, 1); // Kích thước có thể nhỏ hơn một chút

        textSprite.visible = false;
        textSprite.userData.active = false;
        textSprite.userData.text = word; // << QUAN TRỌNG: Lưu lại chữ của sprite này
        streamHeart.add(textSprite);
        effectPool.texts.push(textSprite);
    });
    // --- KẾT THÚC: KHỞI TẠO TEXT SPRITES ---
    textsToCreate.forEach(text => {
        const textTexture = createFlyingTextTexture(text);
        const textMat = new THREE.SpriteMaterial({
            map: textTexture,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending // Hiệu ứng phát sáng nhẹ
        });
        const textSprite = new THREE.Sprite(textMat);

        // Điều chỉnh tỷ lệ cho phù hợp
        const aspectRatio = textTexture.image.width / textTexture.image.height;
        textSprite.scale.set(aspectRatio * 2, 2, 1);

        textSprite.visible = false;
        textSprite.userData.active = false;
        streamHeart.add(textSprite); // QUAN TRỌNG: Thêm vào group streamHeart
        effectPool.texts.push(textSprite);
    });
}
function releaseTextToPool(particleIndex) {
    if (activeTexts.has(particleIndex)) {
        const sprite = activeTexts.get(particleIndex);
        sprite.visible = false;
        sprite.userData.active = false;
        activeTexts.delete(particleIndex);
    }
}
function createFlyingTextTexture(text) {
    const canvas = document.createElement("canvas");
    // Kích thước canvas lớn hơn để chữ nét hơn
    canvas.width = 1024;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    context.font = 'bold 70px "Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", "Noto Sans TC", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Hebrew", "Noto Sans Thai", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";

    // Thêm viền màu để chữ nổi bật
    context.strokeStyle = "rgba(160, 30, 95, 0.9)";
    context.lineWidth = 8;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);

    // Thêm lớp màu trắng bên trong
    context.fillStyle = "#ffffff";
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
}


const positions = [],
    sampleCount = 7e3,
    xs = polyPts.map(t => t.x),
    ys = polyPts.map(t => t.y),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys),
    threshold = minY + (maxY - minY) / 6;
for (; positions.length / 3 < 7e3;) {
    const t = Math.random() * (maxX - minX) + minX,
        e = Math.random() * (maxY - minY) + minY;
    if (isPointInsidePolygon({
        x: t,
        y: e
    }, polyPts)) {
        let a = 1 / 0;
        for (let o = 0; o < polyPts.length; o++) {
            const s = polyPts[o],
                r = polyPts[(o + 1) % polyPts.length],
                i = r.x - s.x,
                n = r.y - s.y,
                l = ((t - s.x) * i + (e - s.y) * n) / (i * i + n * n),
                m = Math.max(0, Math.min(1, l)),
                c = t - (s.x + m * i),
                p = e - (s.y + m * n),
                d = c * c + p * p;
            d < a && (a = d)
        }
        const o = 1 / (1 + 2 * Math.sqrt(a));
        if (Math.random() < o) {
            const a = 3.6 * (Math.random() - .5);
            positions.push(t - 5, e - 7, a)
        }
    }
}
let minZ = 1 / 0,
    maxZval = -1 / 0;
for (let t = 2; t < positions.length; t += 3) {
    const e = positions[t];
    e < minZ && (minZ = e), e > maxZval && (maxZval = e)
}
const heartDepth = maxZval - minZ,
    heartWidth = maxX - minX,
    planeXVar = 2 * heartWidth,
    rStreamStart = .8 * heartWidth,
    Rmax = rStreamStart,
    rVortex = .6 * heartWidth,
    planeZVar = 15 * heartDepth,
    planeYCenter = maxY,
    planeYVar = 1,
    riseDuration = 10,
    fallDuration = 0,
    holdDuration = 0,
    STREAM_RISE_MIN = 8,
    STREAM_RISE_MAX = 12,
    INDENT_Y = maxY - .25 * (maxY - minY),
    INDENT_HALF_WIDTH = .35 * heartWidth,
    COS_ANGLE_THRESH = .707106,
    CLIP_FRONT_Z = .3,
    staticGeo = new THREE.BufferGeometry,
    originalPositions = positions.slice();
staticGeo.setAttribute("position", new THREE.Float32BufferAttribute(originalPositions, 3));
const colors = [];
for (let t = 0; t < positions.length; t += 3) colors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b);
staticGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
const staticSizes = new Float32Array(positions.length / 3),
    SIZE_SCALE = 2;
for (let t = 0; t < staticSizes.length; t++) staticSizes[t] = 2 * (.3 * Math.random() + .2);
staticGeo.setAttribute("size", new THREE.Float32BufferAttribute(staticSizes, 1));
const topIndices = [];
for (let t = 0; t < positions.length; t += 3) positions[t + 1] > threshold + .1 * (Math.random() - .5) * (maxY - minY) && topIndices.push(t / 3);
const topSet = new Set(topIndices);
let bottomPositions = [];
const bottomColors = [],
    bottomSizes = [],
    bottomSizesBase = [],
    topPositionsArr = [],
    topColors = [],
    topSizes = [],
    topAlpha = [],
    idxToTopIdx = new Int32Array(positions.length / 3).fill(-1);
for (let t = 0, e = 0; t < positions.length; t += 3) {
    const a = t / 3,
        o = staticSizes[a],
        s = positions[t],
        r = positions[t + 1],
        i = positions[t + 2];
    if (topSet.has(a)) {
        topPositionsArr.push(s, r, i), topColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), topSizes.push(o);
        const t = Math.abs(s) < INDENT_HALF_WIDTH && r > INDENT_Y;
        topAlpha.push(t ? 0 : 1), idxToTopIdx[a] = e++
    } else bottomPositions.push(s, r, i), bottomColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), bottomSizes.push(o)
}
staticGeo.setAttribute("position", new THREE.Float32BufferAttribute(topPositionsArr, 3)), staticGeo.setAttribute("color", new THREE.Float32BufferAttribute(topColors, 3)), staticGeo.setAttribute("size", new THREE.Float32BufferAttribute(topSizes, 1)), staticGeo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(topAlpha), 1)), staticGeo.attributes.position.needsUpdate = !0, staticGeo.attributes.alpha.needsUpdate = !0;
const topCount = topPositionsArr.length / 3,
    topRadiusArr = new Float32Array(topCount),
    topPhaseArr = new Float32Array(topCount),
    topDelayArr = new Float32Array(topCount);
for (let t = 0; t < topCount; t++) {
    const e = topPositionsArr[3 * t],
        a = topPositionsArr[3 * t + 2],
        o = Math.sqrt(e * e + a * a);
    topRadiusArr[t] = o, topPhaseArr[t] = Math.atan2(a, e), topDelayArr[t] = 10 * Math.random()
}
const GLOBAL_SPIRAL_FREQ = .5,
    BASE_OMEGA = -1 * Math.PI / 10,
    GATHER_RATIO = .01,
    HOLD_RATIO = .2,
    radiusPow = 2.5,
    rCore = .25,
    rOuter = rVortex,
    vIn = .9,
    SHRINK_TO_CORE = !1,
    BURST_SPREAD = .1,
    FADE_DURATION = 1.5,
    SPAWN_DELAY_MAX = 3,
    ASCEND_DELAY_MAX = 10,
    apexY = maxY,
    LOW_REGION_FACTOR = .5;
let minBottomY = 1 / 0,
    maxBottomY = -1 / 0;
for (let t = 1; t < bottomPositions.length; t += 3) {
    const e = bottomPositions[t];
    e < minBottomY && (minBottomY = e), e > maxBottomY && (maxBottomY = e)
}
const Y_THRESHOLD = minBottomY + .5 * (maxBottomY - minBottomY),
    HIGH_BOTTOM_MULT = 2;
{
    const t = [],
        e = [],
        a = [];
    for (let o = 0; o < bottomPositions.length; o += 3) {
        const s = bottomPositions[o + 1];
        if (s >= Y_THRESHOLD)
            for (let r = 1; r < 2; r++) t.push(bottomPositions[o], s, bottomPositions[o + 2]), e.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), a.push(bottomSizes[o / 3])
    }
    bottomPositions.push(...t), bottomColors.push(...e), bottomSizes.push(...a)
}
const BOTTOM_ROTATE_RATIO = .2,
    rotPos = [],
    rotColors = [],
    rotSizes = [],
    staticBotPos = [],
    staticBotColors = [],
    staticBotSizes = [];
for (let t = 0; t < bottomPositions.length; t += 3) Math.random() < .2 ? (rotPos.push(bottomPositions[t], bottomPositions[t + 1], bottomPositions[t + 2]), rotColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), rotSizes.push(bottomSizes[t / 3])) : (staticBotPos.push(bottomPositions[t], bottomPositions[t + 1], bottomPositions[t + 2]), staticBotColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), staticBotSizes.push(bottomSizes[t / 3]));
bottomPositions.length = 0, bottomPositions.push(...rotPos), bottomColors.length = 0, bottomColors.push(...rotColors), bottomSizes.length = 0, bottomSizes.push(...rotSizes);
const bottomCount = bottomPositions.length / 3,
    bottomRadiusArr = new Float32Array(bottomCount),
    bottomPhaseArr = new Float32Array(bottomCount),
    bottomDelayArr = new Float32Array(bottomCount),
    CLEFT_FACTOR = 2.5,
    bottomAlphaArr = new Float32Array(bottomCount).fill(1),
    bottomIsLow = new Uint8Array(bottomCount),
    pivotOffset = .25 * heartWidth,
    KEEP_LOW_MIN = 0,
    KEEP_LOW_MAX = .3;
for (let t = 0; t < bottomCount; t++) {
    const e = bottomPositions[3 * t],
        a = bottomPositions[3 * t + 1],
        o = bottomPositions[3 * t + 2],
        s = a < Y_THRESHOLD;
    if (bottomIsLow[t] = s ? 1 : 0, s) {
        const e = 0 + (a - minBottomY) / (Y_THRESHOLD - minBottomY) * .3;
        bottomAlphaArr[t] = Math.random() < e ? 1 : 0
    } else bottomAlphaArr[t] = 1;
    const r = Math.sqrt(e * e + o * o),
        i = Math.atan2(o, e),
        n = Math.min(1, Math.abs(e) / (.25 * heartWidth)),
        l = 1.5 * Math.pow(1 - n, 3) + 1;
    bottomRadiusArr[t] = r * l, bottomPhaseArr[t] = i, bottomDelayArr[t] = 10 * Math.random()
}
const bottomAlphaBase = Float32Array.from(bottomAlphaArr),
    bottomGeo = new THREE.BufferGeometry;
bottomGeo.setAttribute("position", new THREE.Float32BufferAttribute(bottomPositions, 3)), bottomGeo.setAttribute("color", new THREE.Float32BufferAttribute(bottomColors, 3).setUsage(THREE.DynamicDrawUsage)), bottomGeo.setAttribute("size", new THREE.Float32BufferAttribute(bottomSizes, 1)), bottomGeo.setAttribute("alpha", new THREE.BufferAttribute(bottomAlphaArr, 1));
const V_SLOPE = .3,
    matBottom = makeMat({
        map: circleTexture,
        alphaSupport: !0,
        vClipSlope: .3,
        clipFrontZ: .3
    });
matBottom.alphaTest = .5;
const bottomHeart = new THREE.Points(bottomGeo, matBottom);
bottomHeart.rotation.z = Math.PI, bottomHeart.renderOrder = 0, scene.add(bottomHeart);

const BOTTOM_OMEGA = BASE_OMEGA,
    topPointVisibility = new Array(topIndices.length).fill(!0);
let hiddenTopCount = 0;
const matStatic = makeMat({
    map: circleTexture,
    alphaSupport: !0
});
matStatic.alphaTest = .5;
const staticHeart = new THREE.Points(staticGeo, matStatic);
staticHeart.rotation.z = Math.PI, staticHeart.renderOrder = 0, scene.add(staticHeart);
const TOP_STATIC_RATIO = .5;
{
    const t = [],
        e = [],
        a = [];
    for (let o = 0; o < topPositionsArr.length; o += 3) {
        const s = calculateMinimumDistanceToBorder(topPositionsArr[o] + 5, topPositionsArr[o + 1] + 7) < BORDER_THRESHOLD || Math.random() < .3;
        Math.random() < .5 && s && (t.push(topPositionsArr[o], topPositionsArr[o + 1], topPositionsArr[o + 2]), e.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), a.push(topSizes[Math.floor(o / 3)]))
    }
    if (t.length) {
        const o = new THREE.BufferGeometry;
        o.setAttribute("position", new THREE.Float32BufferAttribute(t, 3)), o.setAttribute("color", new THREE.Float32BufferAttribute(e, 3).setUsage(THREE.DynamicDrawUsage)), o.setAttribute("size", new THREE.Float32BufferAttribute(a, 1));
        const s = makeMat({
            map: circleTexture,
            alphaSupport: !0
        });
        s.alphaTest = .5, staticTopHeart = new THREE.Points(o, s), staticTopHeart.rotation.z = Math.PI, staticTopHeart.renderOrder = 0, scene.add(staticTopHeart)
    }
}
if (staticBotPos.length > 0) {
    const t = new THREE.BufferGeometry;
    t.setAttribute("position", new THREE.Float32BufferAttribute(staticBotPos, 3)), t.setAttribute("color", new THREE.Float32BufferAttribute(staticBotColors, 3).setUsage(THREE.DynamicDrawUsage)), t.setAttribute("size", new THREE.Float32BufferAttribute(staticBotSizes, 1));
    const e = makeMat({
        map: circleTexture,
        alphaSupport: !0
    });
    e.alphaTest = .5, staticBottomHeart = new THREE.Points(t, e), staticBottomHeart.rotation.z = Math.PI, staticBottomHeart.renderOrder = 0, scene.add(staticBottomHeart)
}
const SPAWN_MULT = .2,
    rimIndices = [];
for (const t of topIndices) calculateMinimumDistanceToBorder(positions[3 * t], positions[3 * t + 1]) < BORDER_THRESHOLD && rimIndices.push(t);
const streamSource = rimIndices.length ? rimIndices : topIndices,
    streamCount = Math.floor(.5 * streamSource.length),
    targetIdxArr = new Uint32Array(streamCount);
for (let t = 0; t < streamCount; t++) targetIdxArr[t] = streamSource[t % streamSource.length];
const planeIdxForStream = new Int32Array(streamCount).fill(-1),
    streamPositions = new Float32Array(3 * streamCount),
    streamGeo = new THREE.BufferGeometry,
    streamAlpha = new Float32Array(streamCount).fill(1);
streamGeo.setAttribute("alpha", new THREE.BufferAttribute(streamAlpha, 1)), streamGeo.setAttribute("position", new THREE.BufferAttribute(streamPositions, 3).setUsage(THREE.DynamicDrawUsage));
const streamColors = new Float32Array(3 * streamCount);
for (let t = 0; t < streamCount; t++) {
    streamColors[3 * t] = heartInitialColor.r;
    streamColors[3 * t + 1] = heartInitialColor.g;
    streamColors[3 * t + 2] = heartInitialColor.b;
}
streamGeo.setAttribute("color", new THREE.BufferAttribute(streamColors, 3));
const streamSizes = new Float32Array(streamCount);
for (let t = 0; t < streamCount; t++) streamSizes[t] = 2 * (.3 * Math.random() + .2 + .1) * 1.5;
const streamSizeBase = streamSizes.slice(),
    BIG_RATIO = .1;
for (let t = 0; t < streamCount; t++) {
    if (Math.random() < .1) {
        streamSizes[t] *= 1.5;
        streamColors[3 * t] = heartInitialColor.r;
        streamColors[3 * t + 1] = heartInitialColor.g;
        streamColors[3 * t + 2] = heartInitialColor.b;
    }
}
streamGeo.setAttribute("size", new THREE.BufferAttribute(streamSizes, 1));
const matStream = makeMat({
    map: circleTexture,
    alphaSupport: !0,
    clipBandWidth: INDENT_HALF_WIDTH,
    clipFrontZ: .3
});
matStream.alphaTest = .5;
const streamHeart = new THREE.Points(streamGeo, matStream);
streamHeart.rotation.z = Math.PI, streamHeart.renderOrder = 1, scene.add(streamHeart), streamHeart.visible = !1, fadeObjects.push(streamHeart), streamHeart.userData.fadeStage = STAGE.STREAM;
const PLANE_COUNT = Math.floor(120 * rVortex),
    planePositions = [],
    planeColors = [],
    planeSizes = [],
    planeAlphaArr = new Float32Array(PLANE_COUNT).fill(1);
for (let t = 0; t < PLANE_COUNT; t++) {
    const t = Math.random() * Math.PI * 2,
        e = Math.sqrt(Math.random()) * rVortex;
    planePositions.push(Math.cos(t) * e, planeYCenter - 7.5, Math.sin(t) * e), planeColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), planeSizes.push(1 * Math.random() + .25)
}
const planeGeo = new THREE.BufferGeometry;
planeGeo.setAttribute("position", new THREE.Float32BufferAttribute(planePositions, 3)), planeGeo.setAttribute("color", new THREE.Float32BufferAttribute(planeColors, 3)), planeGeo.setAttribute("size", new THREE.Float32BufferAttribute(planeSizes, 1)), planeGeo.setAttribute("alpha", new THREE.BufferAttribute(planeAlphaArr, 1));
const matPlane = makeMat({
    map: circleTexture,
    alphaSupport: !0
});
matPlane.alphaTest = .5;
const planeLayer = new THREE.Points(planeGeo, matPlane);
planeLayer.rotation.z = Math.PI, scene.add(planeLayer), fadeObjects.push(planeLayer), fadeObjects.includes(planeLayer) && fadeObjects.splice(fadeObjects.indexOf(planeLayer), 1), planeLayer.visible = !0;
const PLANE_COLOR_CYCLE = 9,
    PLANE_COL_WHITE = new THREE.Color("rgb(255, 227, 249)"),
    PLANE_COL_LIGHT = new THREE.Color("rgb(255,192,215)"),
    PLANE_COL_DARK = new THREE.Color("rgb(241, 121, 185)");

function createTextSpriteTexture(t) {
    const e = document.createElement("canvas");
    e.width = e.height = 128;
    const a = e.getContext("2d");
    a.fillStyle = "rgba(0,0,0,0)", a.fillRect(0, 0, 128, 128), a.textAlign = "center", a.textBaseline = "middle", a.font = '300 70.4px "Quicksand","Comfortaa","Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji",sans-serif', a.lineWidth = 7.68, a.strokeStyle = "rgba(160, 30, 95, 0.9)", a.strokeText(t, 64, 64), a.fillStyle = "#ffffff", a.fillText(t, 64, 64);
    const o = new THREE.CanvasTexture(e);
    return o.minFilter = o.magFilter = THREE.LinearFilter, o
}
planeGeo.attributes.color.setUsage(THREE.DynamicDrawUsage);
const ringCharsFull = RingText.join(""),
    ringChars = Array.from(ringCharsFull),
    charMatMap = {};

function generateTextRingTexture(t) {
    const e = document.createElement("canvas");
    e.width = 2048; e.height = 256;
    const a = e.getContext("2d");

    a.fillStyle = "rgba(0,0,0,0)";
    a.fillRect(0, 0, e.width, e.height);
    a.font = 'bold 80px "Noto Sans", "Noto Sans JP", "Noto Sans KR", "Noto Sans SC", "Noto Sans TC", "Noto Sans Arabic", "Noto Sans Devanagari", "Noto Sans Hebrew", "Noto Sans Thai", sans-serif';
    a.textAlign = "center";
    a.textBaseline = "middle";

    const o = e.height / t.length;

    t.forEach((textLine, s) => {
        const r = (s + 0.5) * o;

        // --- LỚP 1: VẼ HÀO QUANG (GLOW) ---
        // Đặt các thuộc tính cho hào quang
        a.shadowColor = '#ff40c8';
        a.shadowBlur = 0; // Giảm độ loá so với trước
        a.fillStyle = '#ff40c8'; // Dùng chính màu của hào quang để vẽ lớp nền này
        a.fillText(textLine, e.width / 2, r); // Vẽ lớp hào quang

        // --- TẮT HÀO QUANG ĐỂ VẼ CÁC LỚP SAU SẮC NÉT ---
        a.shadowBlur = 0;

        // --- LỚP 2: VẼ VIỀN (STROKE) ĐỂ TĂNG ĐỘ TƯƠNG PHẢN ---
        a.strokeStyle = "rgba(160, 30, 95, 0.9)"; // Viền hồng sẫm
        a.lineWidth = 3; // Độ dày của viền
        a.strokeText(textLine, e.width / 2, r); // Vẽ lớp viền

        // --- LỚP 3: VẼ LỚP CHỮ TRẮNG SẮC NÉT LÊN TRÊN CÙNG ---
        a.fillStyle = "#ffffff";
        a.fillText(textLine, e.width / 2, r); // Vẽ lớp chữ trắng cuối cùng
    });

    const s = new THREE.CanvasTexture(e);
    s.needsUpdate = true;
    return s;
}

[...new Set(ringChars)].forEach(t => {
    charMatMap[t] = new THREE.SpriteMaterial({
        map: createTextSpriteTexture(t),
        transparent: !0,
        depthWrite: !1
    })
});
const ringTexture = generateTextRingTexture(RingText),
    ringMat = new THREE.MeshBasicMaterial({
        map: ringTexture,
        transparent: !0,
        side: THREE.DoubleSide,
        depthWrite: !1,
        blending: THREE.AdditiveBlending
    }),
    RING_THICKNESS = 3.5,
    RING_HUE_SPEED = .05,
    RING_FADE_DIST = 1,
    RING_FADE_SPEED = 2,
    ringHeight = .8,
    RING_Y_OFFSET = 2 * -planeYCenter - .5,
    ringGeo = new THREE.CylinderGeometry(rVortex, rVortex, 1, 128, 1, !0),
    RING_SPACING = 2,
    RING_START_RADIUS = rVortex,
    RING_END_RADIUS = .25,
    RING_COUNT = Math.ceil((RING_START_RADIUS - .25) / 2),
    RING_FLIP_Y = Math.PI,
    ribbon = new THREE.Group;
ribbon.position.set(0, planeYCenter + RING_Y_OFFSET, 0), ribbon.rotation.z = Math.PI, scene.add(ribbon), ribbon.visible = !0;
for (let t = 0; t < RING_COUNT; t++) {
    const e = generateTextRingTexture([RingText[t % RingText.length]]);
    e.wrapS = THREE.RepeatWrapping, e.repeat.set(2, 1), e.offset.x = 1;
    const a = new THREE.MeshBasicMaterial({
        map: e,
        transparent: !0,
        side: THREE.DoubleSide,
        depthWrite: !1,
        blending: THREE.AdditiveBlending
    }),
        o = new THREE.Mesh(ringGeo, a);
    o.rotation.x = Math.PI;
    const s = RING_START_RADIUS - 2 * t,
        r = 2 * (Math.random() - .5) * .3;
    o.userData.radius = s + r, o.userData.phase = Math.random() * Math.PI * 2;
    const i = s / RING_START_RADIUS;
    o.scale.set(i, 3.5, i), o.material.opacity = 1, o.material.transparent = !0, o.material.depthWrite = !1, o.renderOrder = t, ribbon.add(o)
}
const vortexIndices = [];
for (let t = 0; t < positions.length / 3; t++) topIndices.includes(t) || vortexIndices.push(t);
const vortexCount = vortexIndices.length,
    vortexPositions = new Float32Array(3 * vortexCount),
    vortexPhase = new Float32Array(vortexCount),
    vortexRadius = new Float32Array(vortexCount);
for (let t = 0; t < vortexCount; t++) {
    vortexPhase[t] = Math.random() * Math.PI * 2;
    const e = Math.random() * rVortex;
    vortexRadius[t] = e, vortexPositions[3 * t] = Math.cos(vortexPhase[t]) * e, vortexPositions[3 * t + 1] = planeYCenter, vortexPositions[3 * t + 2] = Math.sin(vortexPhase[t]) * e
}
const vortexGeo = new THREE.BufferGeometry;
vortexGeo.setAttribute("position", new THREE.BufferAttribute(vortexPositions, 3).setUsage(THREE.DynamicDrawUsage));
const vortexColors = new Float32Array(3 * vortexCount);
for (let t = 0; t < vortexCount; t++) vortexColors[3 * t] = heartInitialColor.r, vortexColors[3 * t + 1] = heartInitialColor.g, vortexColors[3 * t + 2] = heartInitialColor.b;
vortexGeo.setAttribute("color", new THREE.BufferAttribute(vortexColors, 3));
const vortexSizes = new Float32Array(vortexCount);
for (let t = 0; t < vortexCount; t++) vortexSizes[t] = .2 * Math.random() + .15;
vortexGeo.setAttribute("size", new THREE.BufferAttribute(vortexSizes, 1));
const vortexMat = makeMat({
    map: circleTexture,
    blending: THREE.AdditiveBlending,
    opacity: .8
});
vortexMat.onBeforeCompile = function (t) {
    t.vertexShader = t.vertexShader.replace("uniform float size;", "attribute float size;")
};
const heartLayers = [staticHeart, bottomHeart, staticBottomHeart, staticTopHeart];
heartLayers.forEach(t => {
    t && (scene.remove(t), heartScene.add(t))
}), heartLayers.forEach(t => {
    t && (t.visible = !1, t.userData.fadeStage = STAGE.HEART, fadeObjects.includes(t) || fadeObjects.push(t))
});
const HEART_OFFSET_Y = 10;
[staticHeart, bottomHeart, staticTopHeart, staticBottomHeart].forEach(t => {
    t && (t.position.y += 10)
});
const HEART_OFFSET_YY = 8;
[streamHeart, ribbon].forEach(t => {
    t && (t.position.y += 8)
});
const ENABLE_EXPLOSION = !1;
let expPositions, expVelocities, expBirth, expGeo, expColors, expMat, explosionPoints, MAX_EXP, expCount = 0;
const startTimes = new Float32Array(streamCount),
    STATE_ON_DISK = 0,
    STATE_ASCEND = 1,
    streamState = new Uint8Array(streamCount),
    curRadiusArr = new Float32Array(streamCount),
    ascendStart = new Float32Array(streamCount),
    spiralPhase = new Float32Array(streamCount),
    streamRadius = new Float32Array(streamCount),
    initialRadius = new Float32Array(streamCount),
    spiralFrequency = new Float32Array(streamCount),
    spiralDirection = new Float32Array(streamCount),
    extraRotArr = new Float32Array(streamCount),
    MAX_TOP_HIDE = Math.floor(1 * topIndices.length),
    HIDE_DISTANCE = .25,
    TOP_ROT_SPEED = .5,
    streamRiseDuration = new Float32Array(streamCount),
    streamOffsets = new Float32Array(3 * streamCount);
for (let t = 0; t < streamCount; t++) {
    const e = 3 * t,
        a = Math.random() * Math.PI * 2,
        o = Math.acos(2 * Math.random() - 1),
        s = .4;
    streamOffsets[e] = s * Math.sin(o) * Math.cos(a), streamOffsets[e + 1] = s * Math.sin(o) * Math.sin(a), streamOffsets[e + 2] = s * Math.cos(o)
}

function initializeStreamParticleState(t, e) {
    const a = 3 * t,
        o = targetIdxArr[t];
    let s = -1;
    for (let t = 0; t < 100; t++) {
        const t = Math.floor(Math.random() * PLANE_COUNT),
            e = planePositions[3 * t],
            a = planePositions[3 * t + 2];
        if (Math.hypot(e, a) <= .26) {
            s = t;
            break
        }
    } - 1 === s && (s = Math.floor(Math.random() * PLANE_COUNT)), planeIdxForStream[t] = s;
    const r = Math.random() * Math.PI * 2;
    planePositions[3 * s] = Math.cos(r) * rOuter, planePositions[3 * s + 2] = Math.sin(r) * rOuter, planeGeo.attributes.position.needsUpdate = !0;
    const i = planeLayer.rotation.y,
        n = Math.cos(i),
        l = Math.sin(i),
        m = n * planePositions[3 * s] - l * planePositions[3 * s + 2],
        c = l * planePositions[3 * s] + n * planePositions[3 * s + 2];
    streamPositions[a] = m, streamPositions[a + 1] = planePositions[3 * s + 1], streamPositions[a + 2] = c;
    const p = .25 + (rOuter - .25) * Math.random(),
        d = Math.random() * Math.PI * 2;
    streamPositions[a] = Math.cos(d) * p, streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = Math.sin(d) * p, curRadiusArr[t] = p, spiralPhase[t] = d, streamState[t] = STATE_ON_DISK, startTimes[t] = e - Math.random() * (rOuter - .25) / .9, ascendStart[t] = 10 * Math.random(), streamRiseDuration[t] = 8 + 4 * Math.random();
    const h = .5 + 1.5 * Math.random(),
        u = Math.random() < .5 ? -1 : 1;
    extraRotArr[t] = 2 * h * Math.PI * u;
    const A = idxToTopIdx[o]; - 1 !== A && (topAlpha[A] = 1, staticGeo.attributes.alpha.needsUpdate = !0), activeImages.has(t) && releaseImageToPool(t), activeTexts.has(t) && releaseTextToPool(t), streamAlpha[t] = 1, streamGeo.attributes.alpha.needsUpdate = !0
}
const now0 = 0;
for (let t = 0; t < streamCount; t++) initializeStreamParticleState(t, 0);
streamGeo.attributes.position.needsUpdate = !0, streamGeo.attributes.alpha.needsUpdate = !0;
const clock = new THREE.Clock;
let initialColorApplied = false;

function mainAnimationLoop() {
    requestAnimationFrame(mainAnimationLoop);
    let t = clock.getDelta();
    const e = clock.getElapsedTime();
    if (t > 0.1) {
        t = 0.1;
    }
    for (let e = 0; e < PLANE_COUNT; e++) {
        const a = 3 * e;
        let o = planePositions[a],
            s = planePositions[a + 2],
            r = Math.hypot(o, s);
        if (r > .25) {
            r = Math.max(.25, r - .9 * t);
            const e = Math.atan2(s, o);
            planePositions[a] = Math.cos(e) * r, planePositions[a + 2] = Math.sin(e) * r
        }
    }
    if (planeGeo.attributes.position.needsUpdate = !0, planeLayer.visible && (planeLayer.visible = !0), planeLayer.rotation.y = BASE_OMEGA * e, void 0 !== ribbon && (ribbon.rotation.y = planeLayer.rotation.y + RING_FLIP_Y), void 0 !== ribbon && ribbon.children.length) {
        const e = RING_START_RADIUS - .25;
        ribbon.children.forEach((a, o) => {
            a.userData.radius -= .9 * t, a.userData.radius - 1.75 < .25 && (a.userData.radius += e + 2);
            const s = a.userData.radius - 1.75;
            if (s < 1.25) {
                const t = THREE.MathUtils.clamp((s - .25) / 1, 0, 1);
                a.material.opacity = t
            }
            s < .25 && (a.userData.radius += e + 2, a.material.opacity = 0), a.material.opacity < 1 && (a.material.opacity = Math.min(1, a.material.opacity + 2 * t));
            const r = a.userData.radius / RING_START_RADIUS;
            a.scale.set(r, 3.5, r), a.material.color.set(16777215), a.rotation.y = a.userData.phase
        })
    }
    camera.updateMatrixWorld();
    const a = camera.matrixWorldInverse;
    cosmicDust.rotation.y += 0.00015;
    if (streamHeartStarted) {
        streamHeart.matrixWorld, new THREE.Vector3, new THREE.Vector3;
        const t = 1e3 * e;
        controlImageSpawningLogic(t), handleQueuedImageSpawns(), animateFloatingImageSprites(t), t - lastStatusLogTime > 3e3 && (printImageSystemReport(), lastStatusLogTime = t);
        for (let t = 0; t < streamCount; t++) {
            const a = 3 * t,
                o = startTimes[t],
                s = e - (o + t % 5 * 1.6),
                r = targetIdxArr[t];
            if (streamState[t] === STATE_ON_DISK) {
                const o = spiralPhase[t] + BASE_OMEGA * (e - startTimes[t]);
                streamPositions[a] = Math.cos(o) * curRadiusArr[t], streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = Math.sin(o) * curRadiusArr[t], activeImages.has(t) && releaseImageToPool(t), streamAlpha[t] = 1, s >= ascendStart[t] && (streamState[t] = STATE_ASCEND, startTimes[t] = e, initialRadius[t] = curRadiusArr[t]);
                continue
            }
            if (s < -1.5) {
                const s = spiralPhase[t] + BASE_OMEGA * (e - o);
                streamPositions[a] = initialRadius[t] * Math.cos(s), streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = initialRadius[t] * Math.sin(s), streamAlpha[t] = 0;
                continue
            }
            if (s < 0) {
                const r = (s + 1.5) / 1.5,
                    i = r * r * (3 - 2 * r);
                streamAlpha[t] = i, activeImages.has(t) && releaseImageToPool(t);
                const n = spiralPhase[t] + BASE_OMEGA * (e - o);
                streamPositions[a] = initialRadius[t] * Math.cos(n), streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = initialRadius[t] * Math.sin(n);
                continue
            }
            const i = streamRiseDuration[t];
            if (s >= i) {
                const r = (s - i) / 1.5;
                if (r < 1) {
                    const s = r * r * (3 - 2 * r);
                    if (streamAlpha[t] = 1 - s, activeImages.has(t)) {
                        const e = activeImages.get(t);
                        imagePool[e].material.opacity *= 1 - s
                    }
                    const i = spiralPhase[t] + BASE_OMEGA * (e - o);
                    streamPositions[a] = initialRadius[t] * Math.cos(i), streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = initialRadius[t] * Math.sin(i);
                    continue
                }
                streamAlpha[t] = 1, activeImages.has(t) && releaseImageToPool(t), initializeStreamParticleState(t, e), firstResetCompleted || (firstResetCompleted = !0);
                continue
            }
            streamAlpha[t] = 1;
            const n = s / i;
            if (n < .01) {
                let s, r, i;
                const l = spiralPhase[t] + BASE_OMEGA * (e - o);
                {
                    const e = initialRadius[t];
                    s = Math.cos(l) * e, i = Math.sin(l) * e;
                    const a = Math.min(1, n / .01);
                    r = THREE.MathUtils.lerp(planeYCenter, apexY, a)
                }
                streamPositions[a] = s, streamPositions[a + 1] = r, streamPositions[a + 2] = i
            } else {
                const s = (n - .01) / .99,
                    i = 1 - Math.pow(1 - s, 3),
                    l = spiralPhase[t] + BASE_OMEGA * (e - o),
                    m = initialRadius[t],
                    c = Math.cos(l) * m,
                    p = Math.sin(l) * m,
                    d = apexY,
                    h = 3 * r,
                    u = positions[h],
                    A = positions[h + 1] - 4 + 2,
                    E = positions[h + 2];
                let T = THREE.MathUtils.lerp(c, u, i),
                    f = THREE.MathUtils.lerp(d, A, i),
                    S = THREE.MathUtils.lerp(p, E, i);
                const I = 1 + .1 * (1 - i);
                T *= I, S *= I;
                const g = (1 - i) * extraRotArr[t],
                    b = Math.cos(g),
                    M = Math.sin(g),
                    P = T * b - S * M,
                    R = T * M + S * b;
                streamPositions[a] = P, streamPositions[a + 1] = f, streamPositions[a + 2] = R
            }
            if (n < .01) streamAlpha[t] = 1, activeImages.has(t) && releaseImageToPool(t);
            else {
                const e = (n - .01) / .99;
                let a = null;
                if (activeImages.has(t)) {
                    const e = activeImages.get(t);
                    a = imagePool[e]
                }
                if (a) {
                    streamAlpha[t] = 0, a.visible = !0;
                    const o = 1 - Math.pow(1 - e, 3),
                        s = 3 * r,
                        i = positions[s],
                        n = positions[s + 1] - 4 + 2,
                        l = positions[s + 2],
                        m = 1 + t % 5 * .2,
                        c = t % 2 == 0 ? 1 : -1,
                        p = spiralPhase[t] + o * m * Math.PI * 2 * c,
                        d = (1 - o) * (2 + 1 * Math.sin(t)),
                        h = THREE.MathUtils.lerp(0, i, o),
                        u = THREE.MathUtils.lerp(apexY, n, o),
                        A = THREE.MathUtils.lerp(0, l, o),
                        E = h + Math.cos(p) * d,
                        T = u,
                        f = A + Math.sin(p) * d;
                    if (a.position.set(E, T, f), o > .4) {
                        const e = (o - .4) / .6,
                            s = 1;
                        a.material.opacity = s * (1 - e);
                        const r = 1 - .9 * e,
                            i = a.userData.aspectScale || {
                                x: IMAGE_CONFIG.scale,
                                y: IMAGE_CONFIG.scale
                            };
                        a.scale.set(i.x * r, i.y * r, 1), e > .9 && (a.visible = !1, releaseImageToPool(t))
                    } else {
                        a.material.opacity = 1;
                        const t = a.userData.aspectScale || {
                            x: IMAGE_CONFIG.scale,
                            y: IMAGE_CONFIG.scale
                        };
                        a.scale.set(t.x, t.y, 1)
                    }
                } else streamAlpha[t] = 1
            }
            if (streamGeo.attributes.size.needsUpdate = !0, n > .95) {
                const t = topIndices.indexOf(r);
                if (topPointVisibility[t] && hiddenTopCount < MAX_TOP_HIDE) {
                    topPointVisibility[t] = !1;
                    const e = idxToTopIdx[r]; - 1 !== e && (topAlpha[e] = 0, staticGeo.attributes.alpha.needsUpdate = !0), hiddenTopCount++
                }
            }
        }
    } else {
        for (let t = 0; t < streamCount; t++) {
            if (streamHeartActiveRatio < 1 && t / streamCount > .1) {
                const a = 3 * t,
                    o = spiralPhase[t] + BASE_OMEGA * e;
                streamPositions[a] = Math.cos(o) * curRadiusArr[t], streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = Math.sin(o) * curRadiusArr[t], streamAlpha[t] = 0;
                continue
            }
            if (!firstResetCompleted && t / streamCount > 1e-4) {
                const a = 3 * t,
                    o = spiralPhase[t] + BASE_OMEGA * e;
                streamPositions[a] = Math.cos(o) * curRadiusArr[t], streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = Math.sin(o) * curRadiusArr[t], streamAlpha[t] = 0;
                continue
            }
            const a = 3 * t,
                o = spiralPhase[t] + BASE_OMEGA * e;
            streamPositions[a] = Math.cos(o) * curRadiusArr[t], streamPositions[a + 1] = planeYCenter, streamPositions[a + 2] = Math.sin(o) * curRadiusArr[t], streamAlpha[t] = 0
        }
        streamGeo.attributes.position.needsUpdate = !0, streamGeo.attributes.alpha.needsUpdate = !0
    }
    streamGeo.attributes.position.needsUpdate = !0, streamGeo.attributes.alpha.needsUpdate = !0;
    for (let t = 0; t < vortexCount; t++) {
        const a = 3 * t,
            o = 1 * Math.PI / 10,
            s = vortexRadius[t],
            r = e * o,
            i = .3 * Math.sin(r + vortexPhase[t]),
            n = .2 * Math.cos(.7 * r + vortexPhase[t]),
            l = r + vortexPhase[t] + i,
            m = s * (1 + n);
        vortexPositions[a] = Math.cos(l) * m, vortexPositions[a + 1] = planeYCenter + .5 * Math.sin(r + vortexPhase[t]), vortexPositions[a + 2] = Math.sin(l) * m
    }
    vortexGeo.attributes.position.needsUpdate = !0;
    const o = bottomGeo.attributes.position.array;
    for (let t = 0; t < bottomCount; t++) {
        if (e < bottomDelayArr[t]) continue;
        const s = bottomPhaseArr[t],
            r = bottomRadiusArr[t],
            i = Math.cos(s) * r;
        if (Math.abs(s) < .25 * Math.PI) {
            const e = Math.min(1, Math.abs(i) / (.25 * heartWidth)),
                a = 1.5 * Math.pow(1 - e, 3) + 1,
                s = i >= 0 ? 1 : -1;
            o[3 * t] = i + s * (Math.abs(i) * (a - 1))
        } else o[3 * t] = i;
        o[3 * t + 2] = Math.sin(s) * r;
        const n = o[3 * t],
            l = o[3 * t + 1],
            m = o[3 * t + 2],
            c = new THREE.Vector3(n, l, m).applyMatrix4(bottomHeart.matrixWorld);
        (new THREE.Vector3).copy(c).applyMatrix4(a), bottomAlphaArr[t] = bottomAlphaBase[t]
    }
    bottomGeo.attributes.position.needsUpdate = !0, bottomGeo.attributes.alpha.needsUpdate = !0;
    const s = controls.getAzimuthalAngle();
    if (staticHeart && (staticHeart.rotation.y = s), bottomHeart && (bottomHeart.rotation.y = s), staticBottomHeart && (staticBottomHeart.rotation.y = s), staticTopHeart && (staticTopHeart.rotation.y = s), heartbeatEnabled) {
        const t = 1 + .05 * Math.sin(.5 * e * Math.PI * 2);
        staticHeart && staticHeart.scale.set(t, t, t), bottomHeart && bottomHeart.scale.set(t, t, t), staticBottomHeart && staticBottomHeart.scale.set(t, t, t), staticTopHeart && staticTopHeart.scale.set(t, t, t)
    }
    if (controls.update(), renderer.clear(), composerHeart.render(), renderer.clearDepth(), renderer.autoClear = !1, composerMain.render(), renderer.autoClear = !0, hiddenTopCount < MAX_TOP_HIDE) {
        for (let t = 0; t < 5 && hiddenTopCount < MAX_TOP_HIDE; t++) {
            const t = Math.floor(Math.random() * topIndices.length),
                e = topIndices[t];
            if (topPointVisibility[t]) {
                topPointVisibility[t] = !1;
                const a = idxToTopIdx[e]; - 1 !== a && (topAlpha[a] = 0, hiddenTopCount++)
            }
        }
        staticGeo.attributes.position.needsUpdate = !0, staticGeo.attributes.alpha.needsUpdate = !0
    }
    // -- BẮT ĐẦU: CẬP NHẬT HIỆU ỨNG BÙNG NỔ (CÓ LỰC HÚT) --
    for (let i = explosionEffects.length - 1; i >= 0; i--) {
        const group = explosionEffects[i];
        group.userData.life -= t;

        if (group.userData.life <= 0) {
            // --- KÍCH HOẠT NHỊP ĐẬP TẠI ĐÂY ---
            // Chỉ bắt đầu một nhịp đập mới nếu không có nhịp đập nào đang diễn ra
            if (!isPulsing) {
                isPulsing = true;
                pulseStartTime = e; // 'e' là thời gian hiện tại của clock
                triggerCosmicRipple(); // <<< THÊM DÒNG NÀY ĐỂ TẠO VÒNG HÀO QUANG
            }
            // --- KẾT THÚC KÍCH HOẠT ---

            scene.remove(group);
            explosionEffects.splice(i, 1);
        } else {
            const points = group.children[0];
            const positions = points.geometry.attributes.position.array;
            const velocities = group.userData.velocities;

            // Hằng số điều chỉnh lực hút, bạn có thể thay đổi
            const attractionStrength = 0.04;

            for (let j = 0; j < velocities.length; j++) {
                const idx = j * 3;

                // Lấy vị trí và vận tốc hiện tại của hạt
                const currentPosition = new THREE.Vector3(positions[idx], positions[idx + 1], positions[idx + 2]);
                const currentVelocity = velocities[j];

                // --- LOGIC HÚT VỀ TRÁI TIM ---
                // Tính toán vector hướng từ hạt về tâm trái tim
                const toHeartVector = HEART_CENTER_TARGET.clone().sub(currentPosition);

                // Dần dần thay đổi vận tốc của hạt để hướng về phía trái tim
                // lerp() giúp tạo ra đường bay cong và mượt mà
                currentVelocity.lerp(toHeartVector, attractionStrength);

                // Cập nhật vị trí hạt dựa trên vận tốc đã được điều chỉnh
                positions[idx] += currentVelocity.x * t;
                positions[idx + 1] += currentVelocity.y * t;
                positions[idx + 2] += currentVelocity.z * t;
            }
            points.geometry.attributes.position.needsUpdate = true;

            // Làm mờ dần khi sắp kết thúc
            if (group.userData.life < 1.0) {
                points.material.opacity = group.userData.life / 1.0;
            }
        }
    }
    // -- KẾT THÚC: CẬP NHẬT HIỆU ỨNG BÙNG NỔ --

    // -- BẮT ĐẦU: CẬP NHẬT HIỆU ỨNG HÀO QUANG (TỐI ƯU) --
    const RIPPLE_LIFESPAN = 1.8; // Kéo dài thời gian để lan tỏa rộng hơn

    // Cập nhật Sóng Năng Lượng
    effectPool.waves.forEach(wave => {
        if (!wave.userData.active) return;
        const progress = (e - wave.userData.creationTime) / RIPPLE_LIFESPAN;
        if (progress >= 1) {
            wave.userData.active = false;
            wave.visible = false;
        } else {
            // =============================================================
            // FIX: Luôn hướng mặt phẳng về phía camera (Billboarding)
            wave.lookAt(camera.position);
            // =============================================================

            // Lan tỏa rộng hơn, nhạt hơn
            wave.scale.set(1 + progress * 6, 1 + progress * 6, 1);
            wave.material.opacity = 0.6 * (1 - progress);
        }
    });

    // Cập nhật Bụi Sao (Phần này không cần thay đổi)
    effectPool.sparkles.forEach(sparkles => {
        if (!sparkles.userData.active) return;
        const progress = (e - sparkles.userData.creationTime) / RIPPLE_LIFESPAN;
        if (progress >= 1) {
            sparkles.userData.active = false;
            sparkles.visible = false;
        } else {
            const positions = sparkles.geometry.attributes.position.array;
            const velocities = sparkles.userData.velocities;
            for (let i = 0; i < 100; i++) {
                const idx = i * 3;
                positions[idx] += velocities[idx] * t;
                positions[idx + 1] += velocities[idx + 1] * t;
            }
            sparkles.geometry.attributes.position.needsUpdate = true;
            sparkles.material.opacity = 1 - Math.pow(progress, 2);
        }
    });


    // -- BẮT ĐẦU: LOGIC CHO TỪNG TỪ BAY LÊN (PHIÊN BẢN MỚI) --
    if (streamHeartStarted && allWordsFlat.length > 0 && e > nextWordSpawnTime) {
        // Lấy từ tiếp theo trong chuỗi
        const wordToSpawn = allWordsFlat[currentWordIndex];

        // Tìm một hạt đang bay lên và chưa gắn gì cả
        let foundParticle = -1;
        for (let i = 0; i < streamCount; i++) {
            const progress = (e - startTimes[i]) / streamRiseDuration[i];
            // Chỉ chọn hạt vừa mới bắt đầu bay lên (progress < 0.1) để các từ không xuất hiện đột ngột giữa đường
            if (streamState[i] === STATE_ASCEND && progress > 0 && progress < 0.1 && !activeImages.has(i) && !activeTexts.has(i)) {
                foundParticle = i;
                break;
            }
        }

        if (foundParticle !== -1) {
            // Tìm một sprite rảnh rỗi trong hồ chứa có nội dung khớp với từ cần hiển thị
            const textSprite = effectPool.texts.find(txt => !txt.userData.active && txt.userData.text === wordToSpawn);

            if (textSprite) {
                textSprite.userData.active = true;
                textSprite.userData.spawnTime = e;
                textSprite.visible = true;
                textSprite.material.opacity = 0;
                activeTexts.set(foundParticle, textSprite);

                // Chuyển sang từ tiếp theo và lặp lại nếu hết
                currentWordIndex = (currentWordIndex + 1) % allWordsFlat.length;
                nextWordSpawnTime = e + WORD_SPAWN_INTERVAL;
            }
        }
    }

    // Cập nhật vị trí và độ mờ của các từ đang bay (logic này gần như không đổi)
    activeTexts.forEach((sprite, particleIndex) => {
        const particleX = streamPositions[particleIndex * 3];
        const particleY = streamPositions[particleIndex * 3 + 1];
        const particleZ = streamPositions[particleIndex * 3 + 2];
        sprite.position.set(particleX, particleY + 1.5, particleZ);

        const lifeTime = e - sprite.userData.spawnTime;
        const FADE_DURATION = 0.8;
        const particleProgress = (e - startTimes[particleIndex]) / streamRiseDuration[particleIndex];

        if (lifeTime < FADE_DURATION) {
            sprite.material.opacity = lifeTime / FADE_DURATION;
        } else if (particleProgress > 0.7) {
            sprite.material.opacity = Math.max(0, 1 - (particleProgress - 0.7) / 0.3);
        } else {
            sprite.material.opacity = 1;
        }

        if (streamState[particleIndex] === STATE_ON_DISK || particleProgress >= 1.0) {
            releaseTextToPool(particleIndex);
        }
    });
    // -- KẾT THÚC: LOGIC CHO TỪNG TỪ BAY LÊN --

    // -- BẮT ĐẦU: CẬP NHẬT VỊ TRÍ VÀ OPACITY CỦA CHỮ ĐANG BAY --
    activeTexts.forEach((sprite, particleIndex) => {
        const particleX = streamPositions[particleIndex * 3];
        const particleY = streamPositions[particleIndex * 3 + 1];
        const particleZ = streamPositions[particleIndex * 3 + 2];
        sprite.position.set(particleX, particleY + 1.5, particleZ); // Nâng chữ lên một chút

        // Logic fade-in và fade-out
        const lifeTime = e - sprite.userData.spawnTime;
        const FADE_DURATION = 1.0;
        const particleProgress = (e - startTimes[particleIndex]) / streamRiseDuration[particleIndex];

        if (lifeTime < FADE_DURATION) {
            sprite.material.opacity = lifeTime / FADE_DURATION;
        } else if (particleProgress > 0.7) {
            sprite.material.opacity = Math.max(0, 1 - (particleProgress - 0.7) / 0.3);
        } else {
            sprite.material.opacity = 1;
        }

        // Nếu hạt đã kết thúc vòng đời, giải phóng chữ
        if (streamState[particleIndex] === STATE_ON_DISK) {
            releaseTextToPool(particleIndex);
        }
    });
    // -- KẾT THÚC: CẬP NHẬT VỊ TRÍ VÀ OPACITY CỦA CHỮ ĐANG BAY --

    // -- BẮT ĐẦU: HIỆU ỨNG TIM ĐẬP & PHẢN ỨNG MÀU SẮC (LOGIC SỬA LỖI) --
    const heartMeshes = [staticHeart, bottomHeart, staticBottomHeart, staticTopHeart];
    let finalColor = new THREE.Color();

    if (useCustomColor) {
        finalColor.copy(heartInitialColor);
    } else {
        finalColor.setHSL((e * 0.05) % 1, 0.8, 0.6);
    }

    if (isPulsing) {
        const pulseProgress = Math.min((e - pulseStartTime) / PULSE_DURATION, 1.0);
        const pulseSine = Math.sin(pulseProgress * Math.PI);
        const scale = 1 + PULSE_AMPLITUDE * pulseSine;
        heartMeshes.forEach(mesh => { if (mesh) mesh.scale.set(scale, scale, scale); });

        const flashColor = new THREE.Color(0xffffff);
        finalColor.lerp(flashColor, pulseSine * 0.8);

        if (pulseProgress >= 1.0) {
            isPulsing = false;
            heartMeshes.forEach(mesh => { if (mesh) mesh.scale.set(1, 1, 1); });
        }
    }

    // SỬA LỖI: Chạy cập nhật màu nếu (màu là động) HOẶC (đang pulsing) HOẶC (chưa áp dụng màu ban đầu)
    if (!useCustomColor || isPulsing || !initialColorApplied) {
        const n = finalColor.r, l = finalColor.g, m = finalColor.b;

        function updateParticleColorArray(attributeArray) {
            if (!attributeArray) return;
            for (let i = 0; i < attributeArray.length; i += 3) {
                attributeArray[i] = n;
                attributeArray[i + 1] = l;
                attributeArray[i + 2] = m;
            }
        }

        updateParticleColorArray(planeGeo.attributes.color.array);
        updateParticleColorArray(staticGeo.attributes.color.array);
        updateParticleColorArray(bottomGeo.attributes.color.array);
        if (staticBottomHeart) updateParticleColorArray(staticBottomHeart.geometry.attributes.color.array);
        if (staticTopHeart) updateParticleColorArray(staticTopHeart.geometry.attributes.color.array);
        updateParticleColorArray(vortexGeo.attributes.color.array);
        updateParticleColorArray(streamGeo.attributes.color.array);

        planeGeo.attributes.color.needsUpdate = true;
        staticGeo.attributes.color.needsUpdate = true;
        bottomGeo.attributes.color.needsUpdate = true;
        if (staticBottomHeart) staticBottomHeart.geometry.attributes.color.needsUpdate = true;
        if (staticTopHeart) staticTopHeart.geometry.attributes.color.needsUpdate = true;
        vortexGeo.attributes.color.needsUpdate = true;
        streamGeo.attributes.color.needsUpdate = true;

        ribbon.children.forEach(t => {
            t.material.color.setRGB(n, l, m);
        });

        // Đánh dấu là đã áp dụng màu ban đầu xong, để tối ưu cho các frame sau
        initialColorApplied = true;
    }
    // -- KẾT THÚC: HIỆU ỨNG TIM ĐẬP & PHẢN ỨNG MÀU SẮC --

    if (e >= nextShootTime) {
        for (let t = 0; t < SHOOT_MAX; t++)
            if (shootLife[t] <= 0) {
                const a = 3 * t;
                const SPAWN_RADIUS = 200; // Bán kính của vùng trời nơi sao băng sẽ xuất hiện

                // 1. Tạo vị trí bắt đầu ngẫu nhiên trên một mặt cầu lớn để đảm bảo nó luôn ở phía sau
                const startPos = new THREE.Vector3(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2
                ).normalize().multiplyScalar(SPAWN_RADIUS);

                shootPositions[a] = startPos.x;
                shootPositions[a + 1] = startPos.y;
                shootPositions[a + 2] = startPos.z;

                // 2. Tạo một vector vận tốc tiếp tuyến với mặt cầu, giúp sao băng bay ngang qua bầu trời một cách tự nhiên
                const randomVec = new THREE.Vector3(
                    (Math.random() - 0.5),
                    (Math.random() - 0.5),
                    (Math.random() - 0.5)
                ).normalize();
                const tangentVec = new THREE.Vector3().crossVectors(startPos, randomVec).normalize();

                const s = 40 + 30 * Math.random(); // Tăng tốc độ để phù hợp với không gian lớn hơn
                shootVel[a] = tangentVec.x * s;
                shootVel[a + 1] = tangentVec.y * s;
                shootVel[a + 2] = tangentVec.z * s;
                shootBirth[t] = e;

                // 3. Tính toán thời gian sống của sao băng dựa trên quãng đường nó bay
                shootLife[t] = (SHOOT_OUT_RADIUS - SPAWN_RADIUS) / s;
                shootAlpha[t] = .8 + .2 * Math.random();
                break; // Dừng lại sau khi tạo thành công một sao băng
            }
        nextShootTime = e + 0.1 + Math.random() * 0.4;// Điều chỉnh thời gian xuất hiện sao băng tiếp theo
    }
    for (let e = 0; e < SHOOT_MAX; e++)
        if (shootLife[e] > 0) {
            const a = 3 * e;
            shootPositions[a] += shootVel[a] * t, shootPositions[a + 1] += shootVel[a + 1] * t, shootPositions[a + 2] += shootVel[a + 2] * t;
            const o = Math.hypot(shootPositions[a], shootPositions[a + 1], shootPositions[a + 2]);
            if (shootBirth[e], shootLife[e], o > SHOOT_OUT_RADIUS) shootLife[e] = 0, shootAlpha[e] = 0;
            else {
                const t = .9,
                    a = o / SHOOT_OUT_RADIUS;
                shootAlpha[e] = a > t ? 1 - (a - t) / (1 - t) : 1
            }
            const s = e * (TAIL_SEGMENTS + 1),
                r = 3 * s;
            tailPositions[r] = shootPositions[a], tailPositions[r + 1] = shootPositions[a + 1], tailPositions[r + 2] = shootPositions[a + 2], tailAlphas[s] = shootAlpha[e];
            for (let t = 1; t <= TAIL_SEGMENTS; t++) {
                const o = e * (TAIL_SEGMENTS + 1) + t,
                    s = 3 * o;
                tailPositions[s] = shootPositions[a] - shootVel[a] * t * TAIL_SPACING, tailPositions[s + 1] = shootPositions[a + 1] - shootVel[a + 1] * t * TAIL_SPACING, tailPositions[s + 2] = shootPositions[a + 2] - shootVel[a + 2] * t * TAIL_SPACING;
                const r = 1 - t / TAIL_SEGMENTS;
                tailAlphas[o] = shootAlpha[e] * r
            }
        } if (tailGeo.attributes.position.needsUpdate = !0, tailGeo.attributes.alpha.needsUpdate = !0, heartbeatEnabled) {
            const t = 1 + .05 * Math.sin(.5 * e * Math.PI * 2);
            staticHeart && staticHeart.scale.set(t, t, t), bottomHeart && bottomHeart.scale.set(t, t, t), staticBottomHeart && staticBottomHeart.scale.set(t, t, t), staticTopHeart && staticTopHeart.scale.set(t, t, t)
        }
    if (null !== revealStart && (fadeObjects.forEach(t => {
        if (!t || t === ribbon) return;
        const a = t.userData.fadeStage ?? 0,
            o = THREE.MathUtils.clamp((e - revealStart - STAGE_DURATION * a) / STAGE_DURATION, 0, 1),
            s = o * o * (3 - 2 * o);
        t.traverse?.(child => {
            const material = child.material;
            if (!material) return;

            if (child.isSprite && child.userData.text && child.userData.active === false) {
                material.opacity = 0;
                return;
            }
            const baseOpacity = child.userData.baseOpacity ?? 1;
            material.opacity = baseOpacity * s
        }), a === STAGE.STREAM && s > .1 && (streamHeartStarted = !0, streamHeartActiveRatio = s)
    }), e - revealStart > STAGE_DURATION * (STAGE.HEART + 1) && (revealStart = null)), null !== cameraAnimationStart) {
        const t = e - cameraAnimationStart,
            a = THREE.MathUtils.clamp(t / CAMERA_ANIMATION_DURATION, 0, 1),
            o = a * a * (3 - 2 * a); // Đã sửa lỗi nhỏ ở đây từ 'o' thành 'a'
        camera.position.x = THREE.MathUtils.lerp(CAMERA_START_POSITION.x, CAMERA_END_POSITION.x, o), camera.position.y = THREE.MathUtils.lerp(CAMERA_START_POSITION.y, CAMERA_END_POSITION.y, o), camera.position.z = THREE.MathUtils.lerp(CAMERA_START_POSITION.z, CAMERA_END_POSITION.z, o), camera.lookAt(0, 0, 0), a >= 1 && (cameraAnimationStart = null, camera.position.set(CAMERA_END_POSITION.x, CAMERA_END_POSITION.y, CAMERA_END_POSITION.z), camera.lookAt(0, 0, 0))
    }
}
// Hàm kích hoạt hiệu ứng từ "hồ chứa"
function triggerCosmicRipple() {
    const pulseColor = new THREE.Color().setHSL((clock.getElapsedTime() * 0.05) % 1, 0.9, 0.7);
    // Kích hoạt một Sóng Năng Lượng
    const wave = effectPool.waves.find(w => !w.userData.active);
    if (wave) {
        wave.userData.active = true;
        wave.visible = true;
        wave.userData.creationTime = clock.getElapsedTime();
        wave.position.copy(HEART_CENTER_TARGET);
        wave.rotation.z = Math.PI;
        wave.scale.set(1, 1, 1);
        wave.material.color.copy(pulseColor);
    }

    // Kích hoạt một nhóm Bụi Sao
    const sparkles = effectPool.sparkles.find(s => !s.userData.active);
    if (sparkles) {
        sparkles.userData.active = true;
        sparkles.visible = true;
        sparkles.userData.creationTime = clock.getElapsedTime();
        sparkles.position.copy(HEART_CENTER_TARGET);
        sparkles.rotation.z = Math.PI;
        sparkles.material.color.copy(pulseColor);

        // Điền dữ liệu vào geometry đã có sẵn
        const positions = sparkles.geometry.attributes.position.array;
        for (let i = 0; i < 100; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 9;
            const speed = Math.random() * 20 + 20; // Tăng tốc độ lan tỏa
            const idx = i * 3;

            // Vị trí ban đầu
            positions[idx] = Math.cos(angle) * radius;
            positions[idx + 1] = Math.sin(angle) * radius;
            positions[idx + 2] = (Math.random() - 0.5) * 5;

            // Lưu vận tốc vào userData để dùng trong animation
            if (!sparkles.userData.velocities) sparkles.userData.velocities = [];
            sparkles.userData.velocities[idx] = Math.cos(angle) * speed;
            sparkles.userData.velocities[idx + 1] = Math.sin(angle) * speed;
            sparkles.userData.velocities[idx + 2] = (Math.random() - 0.5) * 5;
        }
        sparkles.geometry.attributes.position.needsUpdate = true;
    }
}
setupEffectPools();
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight, camera.updateProjectionMatrix(), renderer.setSize(window.innerWidth, window.innerHeight)
});
const refinedBottomPos = [],
    refinedBottomColors = [],
    refinedBottomSizes = [];
for (let t = 0; t < bottomPositions.length; t += 3) {
    const e = bottomPositions[t],
        a = bottomPositions[t + 1],
        o = bottomPositions[t + 2];
    (calculateMinimumDistanceToBorder(e, a) < BORDER_THRESHOLD || Math.random() < .9) && (refinedBottomPos.push(e, a, o), refinedBottomColors.push(heartInitialColor.r, heartInitialColor.g, heartInitialColor.b), refinedBottomSizes.push(bottomSizes[t / 3]))
}
bottomPositions = refinedBottomPos, bottomColors.length = 0, bottomColors.push(...refinedBottomColors), bottomSizes.length = 0, bottomSizes.push(...refinedBottomSizes);

const starLayers = [];
function createStarLayer({ count, radius, colors, minSize, maxSize, opacity = 1.2 }) {
    const positions = new Float32Array(count * 3);
    const colorsAttr = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alpha = new Float32Array(count);
    const phase = new Float32Array(count);
    const twinkleSpeed = new Float32Array(count);

    for (let i = 0; i < count; i++) {
        const i3 = i * 3;

        // Vị trí ngẫu nhiên trên một mặt cầu ảo để sao bao quanh toàn bộ cảnh
        const phi = Math.acos((2 * Math.random()) - 1);
        const theta = Math.random() * Math.PI * 2;

        positions[i3] = radius * Math.cos(theta) * Math.sin(phi);
        positions[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
        positions[i3 + 2] = radius * Math.cos(phi);

        // Chọn một màu ngẫu nhiên từ bảng màu được cung cấp. Điều này tạo ra sự đa dạng.
        const color = colors[Math.floor(Math.random() * colors.length)];
        colorsAttr[i3] = color.r;
        colorsAttr[i3 + 1] = color.g;
        colorsAttr[i3 + 2] = color.b;

        // Kích thước ngẫu nhiên trong một khoảng cho trước.
        sizes[i] = Math.random() * (maxSize - minSize) + minSize;

        // Lưu trữ các thuộc tính cho việc nhấp nháy: mỗi sao có một pha và tốc độ riêng.
        alpha[i] = 1;
        phase[i] = Math.random() * Math.PI * 2;
        twinkleSpeed[i] = 0.5 + Math.random() * 1.5;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colorsAttr, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));

    // Lưu trữ các giá trị phase và speed vào userData để dùng trong vòng lặp animation
    geo.userData.phase = phase;
    geo.userData.twinkleSpeed = twinkleSpeed;

    const mat = makeMat({
        map: circleTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        alphaSupport: true,
        opacity: opacity,
        sizeAttenuation: false, // Rất quan trọng: Giữ kích thước sao không đổi dù camera xa hay gần.
        vertexColors: true
    });

    // Đoạn mã shader này đảm bảo độ mờ (alpha) của mỗi sao có thể được điều khiển riêng lẻ.
    mat.onBeforeCompile = function (shader) {
        shader.vertexShader = shader.vertexShader.replace("uniform float size;", "attribute float size; attribute float alpha; varying float vAlpha;");
        shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  vAlpha = alpha;");
        shader.fragmentShader = shader.fragmentShader.replace("void main() {", "varying float vAlpha;\nvoid main(){");
        shader.fragmentShader = shader.fragmentShader.replace("gl_FragColor = vec4( outgoingLight, diffuseColor.a );", "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vAlpha );");
    };

    return new THREE.Points(geo, mat);
}

// Định nghĩa các bảng màu trông tự nhiên cho các vì sao
const starColors = [
    new THREE.Color(0xffffff), // Trắng tinh
    new THREE.Color(0xaadcff), // Trắng-xanh băng giá
    new THREE.Color(0xffffe0), // Trắng-vàng ấm
    new THREE.Color(0xffd8b1)  // Cam nhạt
];

// Bây giờ, chúng ta sử dụng "nhà máy" để tạo 3 lớp sao riêng biệt

// Lớp 1: Các ngôi sao xa nhất, nhỏ nhất, và mờ nhất. Đây là lớp nền sâu thẳm.
const farStars = createStarLayer({
    count: 6000,
    radius: 250,
    colors: [new THREE.Color(0xaadcff), new THREE.Color(0xffffff)],
    minSize: 0.5,
    maxSize: 1.5,
    opacity: 0.8
});

// Lớp 2: Các ngôi sao ở cự ly trung bình, đa dạng màu sắc hơn.
const midStars = createStarLayer({
    count: 3000,
    radius: 180,
    colors: starColors,
    minSize: 1.0,
    maxSize: 2.5,
    opacity: 1.0
});

// Lớp 3: Các ngôi sao gần nhất, lớn nhất, và sáng nhất. Chúng tạo điểm nhấn.
const nearStars = createStarLayer({
    count: 1000,
    radius: 120,
    colors: starColors,
    minSize: 1.5,
    maxSize: 4.0,
    opacity: 1.2
});

// Thêm tất cả các lớp vào scene và quản lý chúng cho hiệu ứng fade-in khi bắt đầu
starLayers.push(farStars, midStars, nearStars);
starLayers.forEach(layer => {
    scene.add(layer);
    layer.visible = false;
    fadeObjects.push(layer);
    layer.userData.fadeStage = STAGE.STAR;
});


// --- BẮT ĐẦU: KHỐI MÃ TẠO BỤI VŨ TRỤ ---

const dustParticlesCount = 15000; // Số lượng hạt bụi
const dustPositions = new Float32Array(dustParticlesCount * 3);
const dustColors = new Float32Array(dustParticlesCount * 3);
const dustColor = new THREE.Color(0x4a148c); // Màu tím sẫm huyền ảo

for (let i = 0; i < dustParticlesCount; i++) {
    const i3 = i * 3;
    // Phân bổ ngẫu nhiên trong một hình cầu lớn
    const phi = Math.acos((2 * Math.random()) - 1);
    const theta = Math.random() * Math.PI * 2;
    const radius = Math.random() * 200 + 50; // Phân bổ từ bán kính 50 đến 250

    dustPositions[i3] = radius * Math.cos(theta) * Math.sin(phi);
    dustPositions[i3 + 1] = radius * Math.sin(theta) * Math.sin(phi);
    dustPositions[i3 + 2] = radius * Math.cos(phi);

    // Thêm một chút biến thể về màu sắc
    const colorVariation = Math.random() * 0.5 + 0.5;
    dustColors[i3] = dustColor.r * colorVariation;
    dustColors[i3 + 1] = dustColor.g * colorVariation;
    dustColors[i3 + 2] = dustColor.b * colorVariation;
}

const dustGeometry = new THREE.BufferGeometry();
dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
dustGeometry.setAttribute('color', new THREE.BufferAttribute(dustColors, 3));

const dustMaterial = new THREE.PointsMaterial({
    size: 0.2,
    vertexColors: true,
    blending: THREE.AdditiveBlending, // Hiệu ứng phát sáng
    transparent: true,
    opacity: 0.7
});

const cosmicDust = new THREE.Points(dustGeometry, dustMaterial);
scene.add(cosmicDust);

// --- KẾT THÚC: KHỐI MÃ TẠO BỤI VŨ TRỤ ---



// Chúng ta không cần các biến cũ này nữa, đặt chúng về giá trị rỗng để tránh nhầm lẫn.
STAR_COUNT = 0;
starAlpha = null;
starPhase = null;
starGeo = null;

// --- KẾT THÚC: KHỐI MÃ NÂNG CẤP NỀN TRỜI SAO ---


const SHOOT_MAX = 50,
    TAIL_SEGMENTS = 260,
    TAIL_SPACING = .001,
    SHOOT_OUT_RADIUS = 350,
    SHOOT_POINTS = SHOOT_MAX * (1 + TAIL_SEGMENTS),
    shootPositions = new Float32Array(3 * SHOOT_MAX),
    shootVel = new Float32Array(3 * SHOOT_MAX),
    shootBirth = new Float32Array(SHOOT_MAX),
    shootLife = new Float32Array(SHOOT_MAX).fill(0),
    shootAlpha = new Float32Array(SHOOT_MAX).fill(0),
    shootSize = new Float32Array(SHOOT_MAX);
for (let t = 0; t < SHOOT_MAX; t++) shootSize[t] = 3;
const tailPositions = new Float32Array(3 * SHOOT_POINTS),
    tailColors = new Float32Array(3 * SHOOT_POINTS),
    tailSizes = new Float32Array(SHOOT_POINTS),
    tailAlphas = new Float32Array(SHOOT_POINTS).fill(0);
for (let t = 0; t < SHOOT_MAX; t++) {
    tailSizes[t * (TAIL_SEGMENTS + 1)] = 6;
    for (let e = 1; e <= TAIL_SEGMENTS; e++) {
        const a = t * (TAIL_SEGMENTS + 1) + e,
            o = 1 - e / TAIL_SEGMENTS;
        tailSizes[a] = 4 * o;
        const s = 3 * a;
        tailColors[s] = .7 * o, tailColors[s + 1] = .8 * o, tailColors[s + 2] = 1 * o
    }
}
for (let t = 0; t < SHOOT_MAX; t++) {
    const e = t * (TAIL_SEGMENTS + 1) * 3;
    tailColors[e] = 1, tailColors[e + 1] = 1, tailColors[e + 2] = 1
}
const tailGeo = new THREE.BufferGeometry;
tailGeo.setAttribute("position", new THREE.BufferAttribute(tailPositions, 3).setUsage(THREE.DynamicDrawUsage)), tailGeo.setAttribute("color", new THREE.BufferAttribute(tailColors, 3)), tailGeo.setAttribute("size", new THREE.BufferAttribute(tailSizes, 1)), tailGeo.setAttribute("alpha", new THREE.BufferAttribute(tailAlphas, 1).setUsage(THREE.DynamicDrawUsage));
const tailMat = makeMat({
    map: circleTexture,
    blending: THREE.AdditiveBlending,
    depthWrite: !1,
    alphaSupport: !0,
    vertexColors: !0,
    opacity: 2,
    sizeAttenuation: !1
});
tailMat.onBeforeCompile = function (t) {
    t.vertexShader = t.vertexShader.replace("uniform float size;", "attribute float size; attribute float alpha; varying float vAlpha;"), t.vertexShader = t.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\n  vAlpha = alpha;"), t.fragmentShader = t.fragmentShader.replace("void main() {", "varying float vAlpha;\nvoid main(){"), t.fragmentShader = t.fragmentShader.replace("gl_FragColor = vec4( outgoingLight, diffuseColor.a );", "gl_FragColor = vec4( outgoingLight, diffuseColor.a * vAlpha );")
};
const shootingStars = new THREE.Points(tailGeo, tailMat);
scene.add(shootingStars), shootingStars.userData.fadeStage = STAGE.SHOOT;
let nextShootTime = 0;

function triggerSceneActivation(t) {
    heartbeatEnabled || (heartbeatEnabled = !0, setupImageObjectPool(), lastImageSpawnTime = 0, imageSpawnQueue.length = 0, currentImageIndex = 0, lastStatusLogTime = 0, nextIndependentSpawnTime = 0, independentImageSprites.forEach(t => {
        t && t.parent && t.parent.remove(t)
    }), independentImageSprites.length = 0,

        fadeObjects.forEach(t => {
            t && (t.visible = !0, t.traverse?.(t => {
                const e = t.material;
                e && (t.material && void 0 === t.userData.baseOpacity && (t.userData.baseOpacity = t.material.opacity ?? 1), e.opacity = 0)
            }))
        }), revealStart = clock.getElapsedTime(), cameraAnimationStart = clock.getElapsedTime(), userHasMovedCamera && (CAMERA_START_POSITION = {
            x: camera.position.x,
            y: camera.position.y,
            z: camera.position.z
        }))
}

fadeObjects.push(streamHeart, shootingStars), [streamHeart, shootingStars].forEach(t => {
    t && (t.visible = !1, t.traverse?.(t => {
        t.material && void 0 === t.userData.baseOpacity && (t.userData.baseOpacity = t.material.opacity ?? 1)
    }))
}), renderer.domElement.addEventListener("pointerdown", (event) => {
    createHeartExplosion(event);
});

// Tự động kích hoạt hiệu ứng hình ảnh ngay khi tải xong
triggerSceneActivation();
let lastTouchEnd = 0;
document.addEventListener("touchend", function (t) {
    const e = (new Date).getTime();
    e - lastTouchEnd <= 300 && t.preventDefault(), lastTouchEnd = e
}, !1), document.addEventListener("gesturestart", function (t) {
    t.preventDefault()
}, {
    passive: !1
}), document.addEventListener("gesturechange", function (t) {
    t.preventDefault()
}, {
    passive: !1
}), document.addEventListener("gestureend", function (t) {
    t.preventDefault()
}, {
    passive: !1
}), mainAnimationLoop(), scene.add(staticBottomHeart), [staticTopHeart].forEach(t => {
    t && (t.visible = !1, t.userData.fadeStage = STAGE.HEART, fadeObjects.push(t))
}), controls.addEventListener("change", () => {
    userHasMovedCamera || (CAMERA_START_POSITION = {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z
    }, userHasMovedCamera = !0)
});