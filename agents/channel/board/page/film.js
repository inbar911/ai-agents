// "Tap to Pay" in 3D: a cosy study, a whiteboard drawn live, Claude (a little faceted orange blob with a pointer)
// answers Noa's question. Vertical 1080×1920. Everything is a function of t.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makePost } from './post.js';
import { clamp, lerp, mulberry, ss } from './lib.js';
import { buildBoard, BW, BH, BQ } from './board.js';

const SW = 1080, SH = 1920;
const eio = u => u < .5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;

export async function build(glCanvas, uiCanvas) {
  const get = async f => (await fetch(f)).json();
  const script = await get('script.json'), words = await get('voices/words.json'), VO = await get('voices/vo.json');
  const lines = script.lines;
  const LITE = new URLSearchParams(location.search).has('lite');
  const B = await buildBoard(script, words, VO);
  const lastId = lines[lines.length - 1].id;
  const END = Math.ceil((B.voEnd(lastId) + 1.6) * 10) / 10;

  // ───────── renderer
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
  const Q = +(new URLSearchParams(location.search).get('q') || 1.5);   // supersampling (the capture downscales)
  renderer.setSize(SW, SH, false); renderer.setPixelRatio(Q);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .92;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#9cc3e6');
  const camera = new THREE.PerspectiveCamera(38, SW / SH, .05, 60);
  const post = makePost(renderer, scene, camera, SW, SH, { ssaa: Q, ao: true, aoRadius: .2 });
  post.bloom.strength = .12;

  const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .75, metalness: 0, flatShading: true, ...o });
  const add = (geo, m, x, y, z, parent = scene, cast = true) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = cast; me.receiveShadow = true; parent.add(me); return me; };
  const rbox = (w, h, d, r = .02) => new RoundedBoxGeometry(w, h, d, 3, r);

  // ───────── lights
  scene.add(new THREE.HemisphereLight('#cfe0ff', '#5a4636', .42));
  const sun = new THREE.DirectionalLight('#ffe2bd', 3.6); sun.position.set(-3.2, 4.2, 2.2); sun.castShadow = true;
  sun.shadow.mapSize.set(Q > 1 ? 4096 : 2048, Q > 1 ? 4096 : 2048); Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 4, bottom: -1, near: .5, far: 15 }); sun.shadow.bias = -.0004; sun.shadow.radius = 4;
  scene.add(sun);
  const fill = new THREE.PointLight('#ffd7a8', 2.2, 6, 1.6); fill.position.set(1.4, 2.0, 1.6); scene.add(fill);
  const rim = new THREE.DirectionalLight('#9cc2ff', 2.2); rim.position.set(2.6, 2.6, -3.2); scene.add(rim);     // cool window light from behind: edges glow
  const lamp = new THREE.PointLight('#ffad66', 2.2, 3.5, 1.8); lamp.position.set(1.35, 1.7, -1.9); scene.add(lamp);  // a warm practical by the shelf

  // ───────── room: floor, back wall with a big window onto a city, a bookshelf
  add(new THREE.PlaneGeometry(14, 10), mat('#8a6a52', { flatShading: false }), 0, 0, 0).rotation.x = -Math.PI / 2;
  const wallM = mat('#8fa1b6', { flatShading: false });
  const wall = new THREE.Group(); scene.add(wall);
  const WZ = -3.2;
  add(new THREE.BoxGeometry(14, .9, .1), wallM, 0, .45, WZ, wall);            // below the window
  add(new THREE.BoxGeometry(14, 1.2, .1), wallM, 0, 4.0, WZ, wall);           // above
  add(new THREE.BoxGeometry(4.5, 2.6, .1), wallM, -4.75, 2.2, WZ, wall);      // sides
  add(new THREE.BoxGeometry(4.5, 2.6, .1), wallM, 4.75, 2.2, WZ, wall);
  const frameM = mat('#2d3038');
  for (const x of [-2.5, -1.25, 0, 1.25, 2.5]) add(new THREE.BoxGeometry(.07, 2.6, .12), frameM, x, 2.2, WZ + .02, wall);
  for (const y of [.92, 2.15, 3.42]) add(new THREE.BoxGeometry(5.1, .07, .12), frameM, 0, y, WZ + .02, wall);
  // sky and city outside (soft, far, out of focus)
  const sky = document.createElement('canvas'); sky.width = 64; sky.height = 256; { const g = sky.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#6fa5dd'); gr.addColorStop(.7, '#bcd8ef'); gr.addColorStop(1, '#f1e4cf'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); }
  const skyT = new THREE.CanvasTexture(sky); skyT.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.PlaneGeometry(30, 14), new THREE.MeshBasicMaterial({ map: skyT }), 0, 4, -14, scene, false);
  const cR = mulberry(12);
  for (let i = 0; i < 26; i++) {
    const w = .8 + cR() * 1.4, h = 1.5 + cR() * 4.5, x = -9 + i * .72 + cR() * .3, z = -7 - cR() * 4;
    add(new THREE.BoxGeometry(w, h, w), mat(['#7d8fa6', '#8c9bb0', '#6f7f96', '#a3afbf'][i % 4]), x, h / 2 - .3, z, scene, false);
  }
  // bookshelf on the right
  const shelf = new THREE.Group(); shelf.position.set(1.55, 0, -2.5); scene.add(shelf);
  const woodD = mat('#6b4a33');
  add(rbox(.9, 2.6, .4, .03), woodD, 0, 1.3, 0, shelf);
  const bR = mulberry(3), bookCols = ['#c9503e', '#3f7a5a', '#e0b44b', '#4a6aa8', '#8a5aa0', '#d98a5a', '#2f5d6b'];
  for (const y of [.35, .95, 1.55, 2.15]) {
    add(new THREE.BoxGeometry(.84, .03, .38), mat('#8a6446'), 0, y - .02, .02, shelf);
    let x = -.38; while (x < .36) { const w = .05 + bR() * .05, h = .3 + bR() * .18; add(new THREE.BoxGeometry(w, h, .26), mat(bookCols[Math.floor(bR() * 7)]), x + w / 2, y + h / 2, .06, shelf); x += w + .008; }
  }
  // a plant on the left
  const pot = add(new THREE.CylinderGeometry(.16, .12, .3, 8), mat('#c46b4b'), -1.6, .15, -2.4);
  for (let i = 0; i < 9; i++) { const l = add(new THREE.IcosahedronGeometry(.16, 0), mat('#5c9a5a'), -1.6 + Math.sin(i * 2.3) * .14, .45 + i * .09, -2.4 + Math.cos(i * 2.3) * .1); l.scale.set(1, 1.4, .6); }

  // ───────── the whiteboard on its stand (texture = the live 2D board)
  const wbCanvas = document.createElement('canvas'); wbCanvas.width = BW * BQ; wbCanvas.height = BH * BQ;
  const wbCtx = wbCanvas.getContext('2d');
  const wbTex = new THREE.CanvasTexture(wbCanvas); wbTex.colorSpace = THREE.SRGBColorSpace; wbTex.anisotropy = 16; wbTex.generateMipmaps = true; wbTex.minFilter = THREE.LinearMipmapLinearFilter;
  const WBW = 1.6, WBH = 1.0, WBY = 2.0, WBZ = -1.6;
  const wb = new THREE.Group(); wb.position.set(0, WBY, WBZ); scene.add(wb);
  add(new THREE.PlaneGeometry(WBW, WBH), new THREE.MeshStandardMaterial({ map: wbTex, roughness: .35, metalness: 0 }), 0, 0, .021, wb, false);
  const alu = mat('#c9ced6', { metalness: .6, roughness: .35, flatShading: false });
  add(rbox(WBW + .08, WBH + .08, .04, .015), alu, 0, 0, 0, wb);
  add(rbox(WBW * .7, .04, .1, .01), alu, 0, -WBH / 2 - .06, .05, wb);              // tray
  for (const [c, x] of [['#2a5cb3', -.2], ['#23262c', -.05], ['#d97757', .12]]) { const m = add(new THREE.CylinderGeometry(.012, .012, .13, 8), mat(c), x, -WBH / 2 - .03, .07, wb); m.rotation.z = Math.PI / 2; }
  for (const x of [-.62, .62]) { const leg = add(new THREE.CylinderGeometry(.02, .02, 2.2, 8), mat('#3a3d44'), x, -.6, -.06, wb); leg.rotation.x = .04; }

  // ───────── desk + props (front of frame)
  const desk = new THREE.Group(); desk.position.set(0, 0, .1); scene.add(desk);
  const wood = mat('#c08a5a', { flatShading: false, roughness: .6 });
  add(rbox(2.2, .07, 1.0, .02), wood, 0, .76, 0, desk);
  for (const [x, z] of [[-1.0, -.4], [1.0, -.4], [-1.0, .4], [1.0, .4]]) add(new THREE.BoxGeometry(.07, .74, .07), mat('#8c5f3d'), x, .37, z, desk);
  // book stack Claude stands on
  const books = [['#3f8a5a', .26, .05], ['#7b4fa0', .25, .045], ['#e0b44b', .27, .05], ['#3f8a5a', .23, .04]];
  let by = .795;
  books.forEach(([c, w, h], i) => { const b = add(rbox(w, h, .2, .008), mat(c), -.36 + (i % 2 ? .01 : -.01), by + h / 2, .1, desk); b.rotation.y = (i % 2 ? .06 : -.05); by += h; });
  const mug = add(new THREE.CylinderGeometry(.045, .04, .1, 14), mat('#f2efe8', { flatShading: false }), .25, .845, .15, desk);
  add(new THREE.TorusGeometry(.03, .008, 6, 12), mat('#f2efe8'), .295, .85, .15, desk).rotation.y = Math.PI / 2;
  add(new THREE.CylinderGeometry(.04, .04, .11, 10), mat('#2f6b7a'), -.15, .85, .32, desk);
  for (let i = 0; i < 3; i++) { const p = add(new THREE.CylinderGeometry(.006, .006, .16, 6), mat(['#d97757', '#2a5cb3', '#e0b44b'][i]), -.15 + (i - 1) * .015, .93, .32, desk); p.rotation.z = (i - 1) * .2; }
  add(rbox(.24, .025, .17, .006), mat('#d8556a'), 0, .79, .3, desk).rotation.y = .3;

  // foreground layers: a succulent and sticky notes near the lens, so the room has depth
  add(new THREE.CylinderGeometry(.06, .045, .08, 8), mat('#d9a066'), -.92, .83, .48, desk);
  for (let i = 0; i < 7; i++) { const l = add(new THREE.ConeGeometry(.025, .11, 5), mat('#6aa86a'), -.92 + Math.cos(i * .9) * .03, .9 + (i % 2) * .02, .48 + Math.sin(i * .9) * .03, desk); l.rotation.set(Math.sin(i) * .5, 0, Math.cos(i * .9) * .6); }
  add(rbox(.09, .02, .09, .004), mat('#ffd75e'), .72, .8, .42, desk).rotation.y = -.4;

  // ───────── Claude: a faceted orange blob with dot eyes and a pointer
  const claude = new THREE.Group(); scene.add(claude);
  const CL = new THREE.Vector3(-.36, by + .1, .2);
  const body = new THREE.IcosahedronGeometry(.13, 1), jR = mulberry(21), pos = body.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!seen.has(k)) seen.set(k, .92 + jR() * .16);
    const s = seen.get(k); pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * .92, pos.getZ(i) * s);
  }
  body.computeVertexNormals();
  const orange = mat('#e2774e', { roughness: .65 });
  const cBody = add(body, orange, 0, 0, 0, claude);
  const eyeM = new THREE.MeshStandardMaterial({ color: '#1b1b1f', roughness: .3 });
  const eyes = [-.042, .042].map(x => { const e = add(new THREE.CapsuleGeometry(.012, .022, 4, 8), eyeM, x, .02, .118, claude); return e; });
  const cMouth = add(new THREE.SphereGeometry(.016, 12, 8), eyeM, 0, -.035, .121, claude); cMouth.scale.set(1.3, .15, .5);
  const tuft = []; for (let i = 0; i < 5; i++) { const sp = add(new THREE.ConeGeometry(.018, .06, 4), orange, (i - 2) * .02, .125, -.01, claude); sp.rotation.z = (i - 2) * .35; tuft.push(sp); }
  const armLRef = null; const armL = add(new THREE.CapsuleGeometry(.018, .05, 4, 6), orange, -.13, -.03, .02, claude); armL.rotation.z = -.9;
  const armR = new THREE.Group(); armR.position.set(.12, -.01, .03); claude.add(armR);
  add(new THREE.CapsuleGeometry(.018, .05, 4, 6), orange, .02, .02, 0, armR).rotation.z = .9;
  const pointer = new THREE.Group(); pointer.position.set(.05, .04, 0); armR.add(pointer);
  const stick = add(new THREE.CylinderGeometry(.006, .009, .75, 8), mat('#f3ead8', { flatShading: false }), 0, .375, 0, pointer); stick.castShadow = true;
  const nibM = mat('#ffffff', { flatShading: false }); const nibMesh = add(new THREE.ConeGeometry(.014, .045, 10), nibM, 0, .75, 0, pointer);
  for (const x of [-.05, .05]) add(new THREE.CapsuleGeometry(.02, .02, 4, 6), orange, x, -.12, .02, claude);

  // ───────── Noa: a new character — curly hair, green hoodie, headphones round the neck, phone in hand
  const noa = new THREE.Group(); noa.position.set(.5, 0, -.62); noa.rotation.y = -.45; scene.add(noa);
  const skin = mat('#d9a27c'), hoodie = mat('#4f9a7c'), dark = mat('#2a2522');
  add(new THREE.CylinderGeometry(.2, .2, .45, 10), mat('#3b4c66'), 0, .25, .1, noa);                         // chair seat area / legs mass
  add(rbox(.5, .08, .45, .03), mat('#38404f'), 0, .5, .05, noa);                                                // chair
  add(rbox(.5, .55, .07, .03), mat('#38404f'), 0, .82, -.28, noa);
  const torso = add(new THREE.CapsuleGeometry(.17, .28, 6, 12), hoodie, 0, .86, .02, noa); torso.scale.set(1.1, 1, .8);
  add(new THREE.TorusGeometry(.16, .025, 8, 20), mat('#30343c'), 0, 1.09, .02, noa).rotation.x = Math.PI / 2.2;   // headphones on the neck
  for (const x of [-.15, .15]) add(new THREE.CylinderGeometry(.045, .045, .03, 12), mat('#30343c'), x, 1.07, .06, noa).rotation.z = Math.PI / 2;
  const head = new THREE.Group(); head.position.set(0, 1.27, 0); noa.add(head);
  add(new THREE.SphereGeometry(.16, 18, 14), skin, 0, 0, 0, head).scale.set(1, 1.05, .95);
  const hR = mulberry(8);
  for (let i = 0; i < 26; i++) {
    const a = hR() * Math.PI * 2, el = hR() * 1.15, r = .158;
    const x = Math.cos(a) * Math.sin(el) * r, y = Math.cos(el) * r + .02, z = Math.sin(a) * Math.sin(el) * r - .01;
    if (z > .1 && y < .1) continue;
    add(new THREE.IcosahedronGeometry(.055 + hR() * .02, 0), dark, x, y, z, head);
  }
  for (const x of [-.165, .165]) add(new THREE.SphereGeometry(.035, 8, 6), skin, x, -.01, -.01, head);
  const eyeW = mat('#ffffff', { flatShading: false, roughness: .3 });
  const nEyes = [-.055, .055].map(x => { const g = new THREE.Group(); g.position.set(x, .01, .135); head.add(g); add(new THREE.SphereGeometry(.033, 14, 10), eyeW, 0, 0, 0, g); const p = add(new THREE.SphereGeometry(.018, 10, 8), eyeM, 0, 0, .022, g); return { g, p }; });
  const brows = [-.058, .058].map(x => { const b = add(rbox(.06, .012, .015, .005), dark, x, .065, .14, head); return b; });
  add(new THREE.SphereGeometry(.022, 8, 6), mat('#c98d68'), 0, -.03, .155, head);
  const mouth = add(new THREE.SphereGeometry(.03, 12, 8), mat('#5a2a2a'), 0, -.085, .135, head); mouth.scale.set(1.2, .25, .5);
  // arms: one resting, one holding a phone
  const armA = add(new THREE.CapsuleGeometry(.05, .3, 4, 8), hoodie, -.2, .82, .15, noa); armA.rotation.set(-1.1, 0, .3);
  const armB = new THREE.Group(); armB.position.set(.21, 1.0, .02); noa.add(armB);
  add(new THREE.CapsuleGeometry(.05, .26, 4, 8), hoodie, 0, -.15, .05, armB).rotation.x = -.4;
  const fore = new THREE.Group(); fore.position.set(0, -.28, .12); armB.add(fore);
  add(new THREE.CapsuleGeometry(.045, .2, 4, 8), hoodie, 0, .02, .1, fore).rotation.x = -1.3;
  add(new THREE.SphereGeometry(.045, 8, 6), skin, 0, .04, .22, fore);
  const phone = add(rbox(.07, .13, .012, .01), mat('#1d1f24', { roughness: .3 }), 0, .1, .23, fore);
  add(new THREE.PlaneGeometry(.06, .115), new THREE.MeshBasicMaterial({ color: '#9fd0ff' }), 0, 0, .007, phone, false);

  // ───────── who is speaking, and how open the mouth is
  const vo = lines.filter(L => words[L.id]?.length).map(L => ({ id: L.id, who: L.speaker === 'noa' ? 'noa' : 'claude', t0: VO[L.id], w: words[L.id].map(w => [VO[L.id] + Math.max(0, w[1]), VO[L.id] + w[2]]) }));
  // lip sync: the mouth follows the loudness of the real voice (10 ms steps, fast attack, slower release)
  const ac = new OfflineAudioContext(1, 1, 24000);
  for (const v of vo) {
    try {
      const buf = await ac.decodeAudioData(await (await fetch(`voices/${v.id}.wav`)).arrayBuffer()), x = buf.getChannelData(0), hop = Math.round(buf.sampleRate / 100);
      const raw = new Float32Array(Math.ceil(x.length / hop));
      for (let i = 0; i < raw.length; i++) { let q = 0, n = 0; for (let j = i * hop - hop; j < i * hop + hop; j++) if (j >= 0 && j < x.length) { q += x[j] * x[j]; n++; } raw[i] = Math.sqrt(q / Math.max(1, n)); }
      const sorted = Array.from(raw).sort((a, b) => a - b), top = sorted[Math.floor(sorted.length * .95)] || 1;
      const env = new Float32Array(raw.length); let e = 0;
      for (let i = 0; i < raw.length; i++) { const g = clamp((raw[i] / top - .08) / .92); e += (g - e) * (g > e ? .7 : .35); env[i] = e; }
      v.env = env;
      // a small bounce only on strong syllables after a quiet moment, at most one every 0.8 s
      v.beats = []; let last = -9, low = true;
      for (let i = 0; i < env.length; i++) { if (env[i] < .25) low = true; if (low && env[i] > .75 && i / 100 - last > .8) { v.beats.push(v.t0 + i / 100); last = i / 100; low = false; } }
    } catch (err) { v.env = null; v.beats = []; }
  }
  const talk = (who, t) => {
    for (const v of vo) if (v.who === who && v.env) { const i = Math.round((t + .04 - v.t0) * 100); if (i >= 0 && i < v.env.length) return v.env[i]; }
    return 0;
  };
  const bounce = (who, t) => { let b = 0; for (const v of vo) if (v.who === who) for (const bt of v.beats) { const u = (t - bt) / .32; if (u > 0 && u < 1) b = Math.max(b, Math.sin(Math.PI * u)); } return b; };
  const speaking = (who, t) => vo.some(v => v.who === who && t >= v.w[0][0] - .1 && t <= v.w[v.w.length - 1][1] + .1);
  const QN = lines.filter(L => L.speaker === 'noa' && /\?\s*$/.test(L.text)).map(L => VO[L.id]);
  const amt = (who, t) => { let m = 0; for (const v of vo) if (v.who === who) { const a = v.w[0][0], b = v.w[v.w.length - 1][1]; m = Math.max(m, Math.min(ss(clamp((t - a + .3) / .3)), ss(clamp((b + .4 - t) / .4)))); } return m; };
  const blink = (t, seed) => { const p = 3.1 + (seed % 7) * .3, u = ((t + seed) % p) / p; return u > .97 ? .15 : 1; };

  // board px → world point on the board surface
  const bw = (px, py) => new THREE.Vector3((px / BW - .5) * WBW, WBY + (.5 - py / BH) * WBH, WBZ + .03);

  // ───────── shots: [t, cam pos, target, fov, focusDist?, cut?]
  const P = (x, y, z) => new THREE.Vector3(x, y, z);
  // every shot is angled and keeps drifting, with something near the lens: no straight-on slides
  const S = (kind, fov, a0, at, b0, bt = at) => ({ kind, fov, a: [a0, at], b: [b0, bt] });
  const wideL = () => S('wide', 40, P(-.95, 1.25, 2.75), P(.05, 1.5, -1), P(-.68, 1.3, 2.5));
  const wideR = () => S('wide', 40, P(1.0, 1.3, 2.6), P(-.1, 1.5, -1), P(1.3, 1.36, 2.95));
  const boardL = () => S('board', 42, P(-1.0, 1.55, 2.4), P(.1, 1.8, -1.6), P(-.78, 1.6, 2.2));
  const boardR = () => S('board', 42, P(1.0, 1.6, 2.4), P(-.1, 1.8, -1.6), P(.8, 1.65, 2.2));
  const claudeHero = () => S('claude', 36, P(.12, 1.02, 1.12), P(-.36, 1.18, .1), P(-.02, 1.05, .98));
  const noaCU = () => S('noa', 36, P(-.08, 1.3, .72), P(.5, 1.3, -.6), P(.04, 1.33, .6));
  const nfcCU = () => S('board', 36, P(.95, 1.95, .95), P(.4, 1.95, -1.6), P(.8, 1.95, .82));
  const bigCU = (x, y) => { const p = bw(x, y); return S('board', 38, P(p.x + .3, p.y + .04, 1.25), p, P(p.x + .22, p.y + .03, 1.1)); };
  const SHOTS = [{ t: 0, ...wideL() }];
  let side = 0, lastKind = 'wide';
  lines.forEach((L, i) => {
    if (i === 0) return;
    const items = B.lineItems[L.id] || [], t = VO[L.id] - .12;
    const big = B.bigs.find(g => g.t >= t - .2 && g.t < B.voEnd(L.id));
    let shot;
    if (i === lines.length - 1 && !items.length) shot = wideR();
    else if (items.length) shot = (side++ % 2 ? boardR : boardL)();
    else if (L.speaker === 'noa') shot = noaCU();
    else shot = lastKind === 'claude' ? (side++ % 2 ? boardR : boardL)() : claudeHero();
    if (shot.kind === 'board' && lastKind === 'board' && SHOTS.length && t - SHOTS[SHOTS.length - 1].t < 2.6) { /* keep the running board shot */ }
    else { SHOTS.push({ t, ...shot }); lastKind = shot.kind; }
    if (big) { SHOTS.push({ t: big.t - .25, ...bigCU(big.x, big.y) }); SHOTS.push({ t: big.t + 1.6, ...(side++ % 2 ? boardR : boardL)() }); lastKind = 'board'; }
  });
  SHOTS.sort((a, b) => a.t - b.t);
  const shotAt = t => { let i = 0; while (i < SHOTS.length - 1 && t >= SHOTS[i + 1].t) i++; const s = SHOTS[i], e = (SHOTS[i + 1]?.t ?? END) - s.t; return { s, u: clamp((t - s.t) / e) }; };

  // ───────── captions: dark rounded chips at the top, like the reference reels
  const ui = uiCanvas.getContext('2d');
  const subs = [];
  for (const L of lines) {
    const sw = L.text.split(/\s+/).filter(Boolean), aw = words[L.id] || [];
    const ws = aw.map((w, i) => [sw.length === aw.length ? sw[i] : w[0], VO[L.id] + Math.max(0, w[1]), VO[L.id] + w[2]]);
    let cur = [], len = 0;
    const flush = () => { if (!cur.length) return; subs.push({ t0: cur[0][1] - .05, t1: cur[cur.length - 1][2] + .25, text: cur.map(w => w[0]).join(' '), who: L.speaker === 'noa' ? 'h' : 'v' }); cur = []; len = 0; };
    for (const w of ws) { if (len + w[0].length > 34) flush(); cur.push(w); len += w[0].length + 1; if (/[.?!]$/.test(w[0]) && len > 16) flush(); }
    flush();
  }
  // show the script's own words (punctuation, NFC, Steal) rather than the recogniser's
  const fixWords = {};
  for (const s of subs) for (const [a, b] of Object.entries(fixWords)) s.text = s.text.replace(a, b);
  for (const s of subs) s.text = s.text.replace(/ -/g, '-');
  for (let i = 0; i < subs.length - 1; i++) subs[i].t1 = Math.min(Math.max(subs[i].t1, subs[i].t0 + 1.2), subs[i + 1].t0 - .03);
  function drawCaption(t) {
    ui.clearRect(0, 0, SW, SH);
    const s = subs.find(s => t >= s.t0 && t < s.t1); if (!s) return;
    const a = Math.min(1, (t - s.t0) / .1, (s.t1 - t) / .1);
    ui.font = '500 58px Fredoka';
    const wordsArr = s.text.split(' '); let rows = [s.text];
    if (ui.measureText(s.text).width > 820) { let best = 1, bd = 1e9; for (let i = 1; i < wordsArr.length; i++) { const d = Math.abs(ui.measureText(wordsArr.slice(0, i).join(' ')).width - ui.measureText(wordsArr.slice(i).join(' ')).width); if (d < bd) { bd = d; best = i; } } rows = [wordsArr.slice(0, best).join(' '), wordsArr.slice(best).join(' ')]; }
    const w = Math.max(...rows.map(r => ui.measureText(r).width)) + 70, h = 50 + rows.length * 66, x0 = SW / 2 - w / 2, y0 = 190;
    const pop = 1 + .06 * Math.max(0, 1 - (t - s.t0) / .12);
    ui.save(); ui.translate(SW / 2, y0 + h / 2); ui.scale(pop, pop); ui.translate(-SW / 2, -(y0 + h / 2));
    ui.globalAlpha = a * .88; ui.fillStyle = s.who === 'h' ? '#2b3a4a' : '#262a33';
    ui.shadowColor = 'rgba(0,0,0,.25)'; ui.shadowBlur = 24; ui.shadowOffsetY = 6;
    ui.beginPath(); ui.roundRect(x0, y0, w, h, 28); ui.fill(); ui.shadowColor = 'transparent';
    ui.globalAlpha = a; ui.fillStyle = '#ffffff'; ui.textAlign = 'center'; ui.textBaseline = 'middle';
    rows.forEach((r, i) => ui.fillText(r, SW / 2, y0 + 25 + 33 + i * 66));
    if (s.who !== 'h') { ui.fillStyle = '#e2774e'; ui.beginPath(); ui.arc(x0 + 26, y0 + 26, 7, 0, Math.PI * 2); ui.fill(); }
    ui.restore();
  }

  // ───────── per-frame animation
  const tmpV = new THREE.Vector3();
  let boardT = null;
  const CHANGES = [...B.tl.strokes.map(k => [k.t0, k.t1]), ...B.tl.erasers.map(e => [e.t0, e.t1 + .05])];
  function render(t) {
    // camera first: the characters play to it
    const { s, u } = shotAt(t), e = ss(u);
    camera.position.lerpVectors(s.a[0], s.b[0], e);
    const tg = tmpV.lerpVectors(s.a[1], s.b[1], e);
    camera.fov = s.fov; camera.updateProjectionMatrix(); camera.lookAt(tg);
    const isClaude = s.kind === 'claude', isNoa = s.kind === 'noa', isWide = s.kind === 'wide';
    post.dof.focus = isClaude || isWide ? camera.position.distanceTo(CL) : isNoa ? camera.position.distanceTo(P(.5, 1.27, -.62)) : camera.position.distanceTo(P(0, WBY, WBZ));
    post.dof.aper = isClaude || isNoa ? 11 : 7; post.dof.maxCoc = 18; post.dof.aoAmt = .7;

    // the board
    // the board only changes while ink is moving: redraw it only when a stroke, a wipe or a hide happened since the last frame
    if (boardT === null || CHANGES.some(([a, b]) => b >= Math.min(boardT, t) && a <= Math.max(boardT, t))) {
      B.board.render(wbCtx, t, B.cam); wbTex.needsUpdate = true;
    }
    boardT = t;

    // Claude: bounce while talking, lean toward the board, point at the pen
    const ct = talk('claude', t), cs = speaking('claude', t);
    const ca = amt('claude', t), na = amt('noa', t);
    const hop = bounce('claude', t) * .012 + Math.sin(t * 1.6) * .002;
    claude.position.set(CL.x, CL.y + hop, CL.z);
    const sq = 1 + .025 * ct + .03 * bounce('claude', t); cBody.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    const yawCam = Math.atan2(camera.position.x - CL.x, camera.position.z - CL.z), yawNoa = Math.atan2(noa.position.x - CL.x, noa.position.z - CL.z);
    claude.rotation.y = lerp(lerp(.45, Math.min(yawNoa, 1.0), na * .6), yawCam, ca * .8) + Math.sin(t * .7) * .06;
    claude.rotation.z = Math.sin(t * 1.1) * .025; claude.rotation.x = -.04 * bounce('claude', t);
    const bl = blink(t, 1.3); eyes.forEach(e => e.scale.y = bl * (ct > .8 ? 1.1 : 1));
    tuft.forEach((s, i) => s.rotation.x = Math.sin(t * 3 + i) * .06 + .1 * bounce('claude', t));
    claude.updateMatrixWorld(true);
    const pen = B.tip(t), origin = pointer.getWorldPosition(new THREE.Vector3());
    let target, nib = '#ffffff';
    if (pen && pen.lift < .95) { target = bw(pen.x, pen.y); target.z += pen.lift * .08; nib = pen.color; }
    else { const f = B.focus(t); const aim = f ? bw(f[0], f[1]) : bw(BW / 2, BH * .45); target = origin.clone().add(aim.sub(origin).setLength(.55)); }
    const dir = target.clone().sub(origin), len = dir.length();
    const pq = armR.getWorldQuaternion(new THREE.Quaternion()).invert();
    pointer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize().applyQuaternion(pq));
    stick.scale.y = len / .75; stick.position.y = len / 2;
    nibM.color.set(nib); nibMesh.position.y = len;

    // Noa: breathe, look at whoever matters, talk, react
    const nt = talk('noa', t), ns = speaking('noa', t);
    torso.scale.y = 1 + Math.sin(t * 2.2) * .01;
    noa.rotation.y = -.45 + .25 * ca * (1 - na) + Math.sin(t * .6) * .04;           // turns toward Claude while he explains
    noa.rotation.x = 0; torso.rotation.x = -.12 * na + .05 * Math.sin(t * 1.4) * ca;   // leans in when he talks
    torso.rotation.z = .012 * Math.sin(t * 2) * na;
    const pen0 = B.tip(t), lookBoard = !ns && pen0 && pen0.lift < .5;
    const lookTarget = ns ? camera.position : (lookBoard ? bw(BW / 2, BH * .5) : claude.position);
    const hl = head.parent.worldToLocal(tmpV.copy(lookTarget)).sub(head.position);
    const hy = clamp(Math.atan2(hl.x, hl.z), -1.1, 1.1), hp = clamp(Math.atan2(hl.y, Math.hypot(hl.x, hl.z)), -.4, .5);
    const k = .15; head.rotation.y = lerp(head.rotation.y, hy, 1) * (1 - k) + hy * k; head.rotation.x = -hp * .7 + Math.sin(t * 1.7) * .02;
    head.rotation.z = Math.sin(t * .9) * .04 + (QN.some(h => t > h - .2 && t < h + 1.4) ? .12 : 0);
    const surprise = QN.some(h => t > h - .2 && t < h + 1.6) ? 1 : (t > VO[lastId] - .1 ? .5 : 0);
    brows.forEach((b, i) => { b.position.y = .065 + surprise * .02; b.rotation.z = (i ? -1 : 1) * (.08 + surprise * .1); });
    nEyes.forEach(e => { e.g.scale.y = blink(t, 2.7); e.g.scale.x = 1 + surprise * .08; });
    mouth.scale.set(1.2 - nt * .35, .2 + nt * 1.1 + (t > B.voEnd(lastId) + .2 ? .35 : 0) * (nt > .05 ? 0 : 1), .5);
    cMouth.scale.set(1.3 - ct * .3, .15 + ct * 1.2, .5);
    // nod while Claude explains
    if (cs && !ns) head.rotation.x += Math.max(0, Math.sin(t * 1.3)) * .025;
    armB.rotation.x = -.15 + (t < VO[lines[1].id] ? Math.sin(Math.min(1, t / .5) * Math.PI / 2) * -.35 : 0) - .25 * na * Math.max(0, Math.sin(t * 3));
    fore.rotation.x = -.2 + Math.sin(t * 1.1) * .03;

    if (LITE) renderer.render(scene, camera); else post.composer.render();
    drawCaption(t);
    if (new URLSearchParams(location.search).has('board')) { ui.clearRect(0, 0, SW, SH); ui.drawImage(wbCanvas, 0, 0, SW, SW * BH / BW); }
  }

  // ───────── events for the mixer
  const ev = [...B.tl.ev, ...Object.entries(VO).map(([id, t]) => ({ t, type: 'vo', id }))].sort((a, b) => a.t - b.t);
  for (const e of ev) if (e.x != null) { e.pan = +clamp((e.x / BW - .5) * .6, -.4, .4).toFixed(2); e.z = .7; e.on = 1; }
  const cuts = SHOTS.slice(1).map(s => +s.t.toFixed(2));
  return { dur: END, render, ev, subs, cues: { cuts, lines: lines.map(L => ({ id: L.id, speaker: L.speaker, t: VO[L.id] })) } };
}
