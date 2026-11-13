// world.js: the channel's neon hologram studio. Every narration line gets its own spot in a dark glowing world: a
// pedestal ring with a detailed object (phone, router, earbuds...) or a 3D symbol (Wi-Fi, Bluetooth, lock...), and the
// camera glides from spot to spot as the lines are spoken. Objects are modelled in code, then drawn as holograms
// (rim glow + glowing edges + bloom); screens and LEDs keep their own light.
// window.VIDEO: {lang: he|en, palette, title, segments: [{text, focus, action, target?, label?, value?, suffix?}]};
// window.TIMING says when each line is spoken.
(() => {
  'use strict';
  // dark neon studio (the look Inbar liked): sky gradient, floor/grid colour, and the accents objects take in turn
  const PALETTES = {
    // Grouper look (12.11): ONE hue family, indigo to lavender, on deep navy; red only for the key word in captions
    grouper: { top: '#0d0b33', bottom: '#04031a', grid: 0x2c2a78, accent: ['#9a96ff', '#b3adff', '#8582f2', '#a7a1ff', '#9590ff'], hot: '#FF3B5C', glass: true },
    indigo: { top: '#140c45', bottom: '#04030f', grid: 0x3d5bff, accent: ['#5ad8ff', '#ff5ccf', '#9d8bff', '#4dffb0', '#ffb347'], hot: '#FF3B5C' },
    teal:   { top: '#062e3a', bottom: '#02090d', grid: 0x26e0b0, accent: ['#4fe0ef', '#ff6fae', '#ffd166', '#8c9bff', '#6dffb3'], hot: '#FF3B5C' },
    violet: { top: '#2a0b4a', bottom: '#07020d', grid: 0xb15cff, accent: ['#d27dff', '#5ad8ff', '#ff8a5c', '#ffe066', '#6dffb3'], hot: '#FF3B5C' },
  };
  const PAL = PALETTES[VIDEO.palette] || PALETTES.grouper;
  const DIR = VIDEO.lang === 'en' ? 'ltr' : 'rtl';
  const ENV = ['city', 'home', 'space', 'studio'].includes(VIDEO.env) ? VIDEO.env : 'studio';   // the world (writer.py ENVS)   // English videos read left to right
  const SEGS = VIDEO.segments.map((s, i) => Object.assign({}, s, TIMING[i], { i, end: i + 1 < TIMING.length ? TIMING[i + 1].a : DUR }));

  scene('main', 0, DUR, { bg: PAL.bottom }, (root) => {
    let frame = null;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px`;
    root.appendChild(canvas);

    PRELOAD.push((async () => {
      const THREE = await import('three');
      const { RoundedBoxGeometry } = await import('./vendor/jsm/geometries/RoundedBoxGeometry.js');
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.setSize(W, H, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      
      const world = new THREE.Scene();
      // ─── lighting (13.11): real materials lit by a studio environment (a big top softbox, a lavender key, an accent rim
      // and a dark floor), baked once with PMREM, so metal reflects, plastic has soft highlights and everything sits in
      // the palette's light ───
      {
        const env = new THREE.Scene(), box = new THREE.BoxGeometry(1, 1, 1);
        const panel = (c, k, at, sc) => { const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.BackSide })); m.position.set(...at); m.scale.set(...sc); env.add(m); };
        panel('#0b0a24', 1, [0, 0, 0], [30, 30, 30]);                       // the room: deep navy
        panel('#ffffff', 2.0, [0, 9, 0], [10, 0.1, 10]);                     // top softbox
        panel(PAL.accent[2] || '#c9c5ff', 2.2, [-9, 3, 6], [0.1, 6, 8]);     // key from the front left
        panel(PAL.accent[0], 2.6, [9, 2, -6], [0.1, 6, 6]);                  // rim from behind right
        panel('#05040f', 1, [0, -6, 0], [30, 0.1, 30]);                      // dark floor
        const pm = new THREE.PMREMGenerator(renderer); world.environment = pm.fromScene(env, 0.04).texture; pm.dispose();
        const key = new THREE.DirectionalLight(0xffffff, 0.7); key.position.set(-3, 6, 5); world.add(key);
      }
      const cam = new THREE.PerspectiveCamera(36, W / H, 0.05, 200);

      // ─── the studio: a curved gradient backdrop, a soft floor, a key light with shadows ───
      const tex = (w, h, paint, srgb = true) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
        const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
      };
      world.background = tex(16, 512, (x, w, h) => { const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, PAL.top); g.addColorStop(0.75, PAL.bottom); g.addColorStop(1, PAL.bottom); x.fillStyle = g; x.fillRect(0, 0, w, h); });
      world.fog = new THREE.FogExp2(new THREE.Color(PAL.bottom), 0.028);
      const ADD = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };
      const gridPts = [];
      for (let k = -40; k <= 40; k += 2) gridPts.push(k, 0, 20, k, 0, -SEGS.length * 4.2 - 40);
      for (let z = 20; z >= -SEGS.length * 4.2 - 40; z -= 2) gridPts.push(-40, 0, z, 40, 0, z);
      const gridGeo = new THREE.BufferGeometry(); gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
      const floorGrid = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial(Object.assign({ color: PAL.grid, opacity: 0.22 }, ADD))); world.add(floorGrid);

      // ─── materials: every part keeps its real colour (13.11, see REAL below); glass is a see-through shell ───
      const real = (hex, shell = false, pbr = {}) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: pbr.rough ?? 0.45, metalness: pbr.metal ?? 0.05, transparent: !!shell, opacity: shell ? 0.25 : 1 }); m.userData.real = hex; m.userData.shell = shell; m.userData.pbr = pbr; return m; };
      const M = {
        glass: real('#1d2330', true), titanium: real('#8e9097', false, { metal: 0.9, rough: 0.3 }), alu: real('#c3c7cd', false, { metal: 0.85, rough: 0.3 }),
        darkMetal: real('#3b4048', false, { metal: 0.8, rough: 0.38 }), white: real('#eceef1', false, { rough: 0.35, coat: 0.5 }),
        black: real('#17191d', false, { rough: 0.45 }), gold: real('#c9962f', false, { metal: 1, rough: 0.3 }), chrome: real('#dfe3e8', false, { metal: 1, rough: 0.1 }),
        pcb: real('#0d6b35', false, { rough: 0.6 }), lens: real('#0b0d11', false, { metal: 0.3, rough: 0.05, coat: 1 }),
        tint: real('#0f1724', 0.58),   // tinted car glass: you see the seats, but it still reads as glass
      };
      const plastic = (c) => real(new THREE.Color(c).getHex());
      const glow = (c, i = 2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(c), emissiveIntensity: i });
      const screenMat = (t) => Object.assign(new THREE.MeshBasicMaterial({ map: t, color: 0xc8c8c8 }), { userData: { decal: true } });   // a lit, opaque picture (a touch under full white, or the bloom turns it into a lamp)
      const mesh = (geo, mat, at = [0, 0, 0], rot = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...at); m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; return m; };
      const rbox = (w, h, d, r, mat, at, rot) => mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), mat, at, rot);
      const cyl = (r1, r2, h, mat, at, rot, n = 32) => mesh(new THREE.CylinderGeometry(r1, r2, h, n), mat, at, rot);
      const sph = (r, mat, at) => mesh(new THREE.SphereGeometry(r, 32, 24), mat, at);
      const group = (...parts) => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); return g; };
      const plane = (w, h, mat, at, rot) => mesh(new THREE.PlaneGeometry(w, h), mat, at, rot);
      // a rounded rectangle with true corner radii (a phone's outline), and a flat plate extruded from it with a small
      // bevel: real devices are flat slabs with round corners, not the puffy pill a RoundedBox makes
      const rrShape = (w, h, r) => { const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r; s.moveTo(-w / 2 + r, -h / 2); s.lineTo(x, -h / 2); s.absarc(x, -y, r, -Math.PI / 2, 0); s.lineTo(w / 2, y); s.absarc(x, y, r, 0, Math.PI / 2); s.lineTo(-x, h / 2); s.absarc(-x, y, r, Math.PI / 2, Math.PI); s.lineTo(-w / 2, -y); s.absarc(-x, -y, r, Math.PI, Math.PI * 1.5); return s; };
      const slab = (w, h, d, r, bev, mat, at, rot) => {
        const geo = new THREE.ExtrudeGeometry(rrShape(w - 2 * bev, h - 2 * bev, Math.max(0.002, r - bev)), { depth: Math.max(0.001, d - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 14 });
        geo.translate(0, 0, -Math.max(0.001, d - 2 * bev) / 2); return mesh(geo, mat, at, rot);
      };
      const fitUV = (geo, w, h) => { const p = geo.attributes.position, uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k) / w + 0.5, p.getY(k) / h + 0.5); uv.needsUpdate = true; };

      const GLASS = (c) => new THREE.ShaderMaterial({
        uniforms: { c: { value: new THREE.Color(c) }, body: { value: new THREE.Color('#0c0a2a') } }, side: THREE.DoubleSide, transparent: true, depthWrite: false,
        vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 c; uniform vec3 body; varying vec3 n; varying vec3 v; void main(){ float r = pow(1.0 - abs(dot(normalize(n), normalize(v))), 2.5); vec3 col = mix(body, c * 0.55, r); gl_FragColor = vec4(col, 0.42 + 0.33 * r); }',
      });
      const RIM = (c) => new THREE.ShaderMaterial({
        uniforms: { c: { value: new THREE.Color(c) } }, side: THREE.DoubleSide, ...ADD,
        vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform vec3 c; varying vec3 n; varying vec3 v; void main(){ float r = pow(1.0 - abs(dot(normalize(n), normalize(v))), 2.2); gl_FragColor = vec4(c * (0.11 + 1.25 * r), 1.0); }',
      });
      // real colours inside the Grouper look (13.11, pilot): a part made with real(hex) keeps its colour, lit by a soft key
      // light with the palette's rim on its edges; real(hex, true) is a see-through shell (a truck's body, a phone's back
      // glass) so what's inside shows. Everything else stays the one-hue glass.
      const VSN = 'varying vec3 n; varying vec3 v; varying vec3 vc; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-mv.xyz); \n#ifdef USE_COLOR\n vc = color; \n#else\n vc = vec3(1.0); \n#endif\n gl_Position = projectionMatrix * mv; }';
      const REAL = (c, shell, vcol = false) => new THREE.ShaderMaterial({ vertexColors: vcol,
        uniforms: { c: { value: new THREE.Color(c) }, rim: { value: new THREE.Color(PAL.accent[1]) }, a: { value: typeof shell === 'number' ? shell : 0.1 } },
        transparent: !!shell, depthWrite: !shell, side: shell ? THREE.DoubleSide : THREE.FrontSide, vertexShader: VSN,
        fragmentShader: shell
          ? 'uniform vec3 c; uniform vec3 rim; uniform float a; varying vec3 n; varying vec3 v; varying vec3 vc; void main(){ float r = pow(1.0 - abs(dot(normalize(n), normalize(v))), 2.4); gl_FragColor = vec4(mix(c * 0.45, mix(c, rim, 0.3), r), a + 0.5 * r); }'
          : 'uniform vec3 c; uniform vec3 rim; varying vec3 n; varying vec3 v; varying vec3 vc; void main(){ vec3 N = normalize(n); float d = abs(dot(N, normalize(v))); float key = max(dot(N, normalize(vec3(0.35, 0.85, 0.4))), 0.0); float r = pow(1.0 - d, 3.0); gl_FragColor = vec4(c * vc * (0.3 + 0.55 * key + 0.2 * d) + rim * 0.3 * r, 1.0); }',
      });
      // printed text, silkscreen and labels: drawn on a transparent canvas and laid on a part as a decal (normal blending,
      // so dark ink on a silver lid stays dark)
      const ink = (w, h, paint) => { const m = new THREE.MeshBasicMaterial({ map: tex(w, h, paint), transparent: true, depthWrite: false }); m.userData.decal = true; m.userData.ink = true; return m; };
      // the Grouper edge light on real materials: a thin fresnel rim in the palette's accent
      const PBR_RIM = (sh) => {
        sh.uniforms.rimC = { value: new THREE.Color(PAL.accent[1]) };
        sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'uniform vec3 rimC;\nvoid main() {')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb += rimC * 0.22 * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);');
      };
      // real colour only where the colour is the object (a red car, a gold gas bottle, a soda can, the Earth); every other
      // object, phones and boards and speakers included, stays the one-hue glass so the video keeps the palette (13.11)
      const COLOUR = new Set(['car', 'police_car', 'sports_car', 'pickup_truck', 'delivery_truck', 'semi_truck', 'motorcycle', 'helicopter',
        'chip', 'soda_can', 'globe', 'earth', 'planet', 'saturn', 'lock', 'padlock', 'cardboard_box', 'gas_tank', 'burger', 'pizza', 'pizza_slice',
        'pizza_box', 'controller', 'controller_ps', 'console_ps', 'console_xbox', 'pc_tower', 'milk_carton', 'coin', 'gold_bars', 'money_bag', 'gift', 'key', 'pine_tree', 'trees', 'mountain', 'campfire', 'water_bottle', 'sofa_red']);
      function neonize(root, c, keep = true) {
        // additive glow stacks up: a dense model with many overlapping parts (a NASA rover) burns out to white, so dim it
        let tris = 0; root.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
        const col = new THREE.Color(c).multiplyScalar(tris > 30000 ? Math.max(0.3, Math.sqrt(30000 / tris)) : 1), white = new THREE.Color(0xffffff);
        const edge = PAL.glass ? new THREE.LineBasicMaterial({ color: col.clone().lerp(white, 0.55), transparent: true, opacity: 0.7, depthWrite: false })
          : new THREE.LineBasicMaterial(Object.assign({ color: col.clone().lerp(white, 0.35), opacity: 0.95 }, ADD)), rim = PAL.glass ? GLASS(col) : RIM(c);
        const edgeLight = PAL.glass ? new THREE.LineBasicMaterial({ color: white, transparent: true, opacity: 0.85, depthWrite: false })
          : new THREE.LineBasicMaterial(Object.assign({ color: col.clone().lerp(white, 0.55), opacity: 0.9 }, ADD)), rimLight = PAL.glass ? GLASS(col.clone().lerp(white, 0.4)) : RIM(col.clone().lerp(white, 0.3));
        const meshes = []; root.traverse(o => { if (o.isMesh) meshes.push(o); });
        for (const m of meshes) {
          m.castShadow = m.receiveShadow = false;
          if (m.material.userData.ink && !keep) { m.visible = false; continue; }   // printed labels belong to the real-colour look
          if (m.material.userData.decal) continue;
          if (m.material.userData.real && keep) {
            const sh = m.material.userData.shell;
            if (!sh) {
              const pb = m.material.userData.pbr || {};
              m.material = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(m.material.userData.real), metalness: pb.metal ?? 0.05, roughness: pb.rough ?? 0.45,
                clearcoat: pb.coat ?? 0.15, clearcoatRoughness: 0.2, vertexColors: !!m.material.userData.vcol });
              m.material.onBeforeCompile = PBR_RIM;
              m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false })));
              continue;
            }
            m.material = REAL(m.material.userData.real, sh, !!m.material.userData.vcol);
            if (!sh) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18, depthWrite: false })));
            else m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), edge));
            continue;
          }
          if (m.material.emissiveMap) { m.material = new THREE.MeshBasicMaterial(Object.assign({ map: m.material.emissiveMap, color: new THREE.Color(m.material.userData.tint || 0xffffff), opacity: m.material.userData.tint ? 0.85 : 0.45 }, ADD)); continue; }   // screens keep their picture
          if (m.material.emissive && m.material.emissive.getHex() !== 0 && m.material.emissiveIntensity >= 1) { m.material = new THREE.MeshBasicMaterial(Object.assign({ color: m.material.emissive }, ADD)); continue; }   // LEDs
          const light = m.material === M.white || m.material === M.chrome;   // white/chrome details (a rune, a shackle) read as the bright part
          m.material = light ? rimLight : rim;
          // glowing edges, except on very dense meshes (big NASA models): there they'd be a solid blur and cost render time
          const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
          if (tris < 40000) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, PAL.glass ? 25 : 15), light ? edgeLight : edge));
        }
      }

      // ─── screens drawn on canvases (a phone home screen, a laptop window, a watch face, a TV picture) ───
      const roundRect = (x, X, Y, w, h, r) => { x.beginPath(); x.roundRect(X, Y, w, h, r); x.fill(); };
      // screens in the Grouper look stay inside the one palette (lavender UI), the old palettes keep app colours
      const APPS = PAL.glass ? ['#c9c5ff', '#9d97ff', '#b7b1ff', '#8e88f5', '#d8d5ff', '#a9a3ff'] : ['#34c759', '#0a84ff', '#ff9f0a', '#ff375f', '#5e5ce6', '#64d2ff', '#ffd60a', '#bf5af2', '#ff453a', '#30d158', '#0a84ff', '#ff9f0a'];
      const VIVID = ['#34c759', '#0a84ff', '#ff9f0a', '#ff375f', '#5e5ce6', '#64d2ff', '#ffd60a', '#bf5af2', '#ff453a', '#30d158', '#0a84ff', '#ff9f0a'];
      // vivid: the real-colour models' screen (real app colours on a deep wallpaper); otherwise the palette's UI
      const phoneScreenOf = (hole, vivid = false) => tex(512, 1060, (x, w, h) => {
        const APP = vivid ? VIVID : APPS;
        const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, vivid ? '#1d3b8f' : PAL.accent[0]); g.addColorStop(1, vivid ? '#6d28d9' : PAL.accent[1]); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(255,255,255,0.95)'; x.font = '600 44px Rubik'; x.textAlign = 'center'; x.fillText('9:41', 110, 72);
        x.fillStyle = '#000'; if (hole) { x.beginPath(); x.arc(w / 2, 46, 20, 0, 7); x.fill(); } else roundRect(x, w / 2 - 54, 26, 108, 38, 19);   // punch hole or (25% smaller) island
        for (let k = 0; k < 16; k++) { x.fillStyle = APP[k % APP.length]; roundRect(x, 46 + (k % 4) * 112, 170 + Math.floor(k / 4) * 132, 84, 84, 22); }
        x.fillStyle = 'rgba(255,255,255,0.3)'; roundRect(x, 28, h - 170, w - 56, 130, 44);   // dock
        for (let k = 0; k < 4; k++) { x.fillStyle = APP[(k * 3 + 1) % APP.length]; roundRect(x, 56 + k * 112, h - 147, 84, 84, 22); }
      });
      // app icons drawn the way the real ones look (shapes and colours only, no logos): a gradient tile with a white glyph
      const appIcon = (x, X, Y, S, kind, rad) => {
        const T = { phone: ['#5df06f', '#26c43c'], msg: ['#5df06f', '#26c43c'], mail: ['#4fb4ff', '#1667f2'], camera: ['#d9dbe0', '#8e9199'], photos: ['#ffffff', '#f1f1f4'],
          maps: ['#c9f0c1', '#7cd38a'], weather: ['#4aa8ff', '#1756d6'], clock: ['#1c1c1e', '#000000'], settings: ['#a7aab3', '#6b6f78'], music: ['#ff5f7a', '#f2213f'],
          calendar: ['#ffffff', '#f3f3f5'], notes: ['#fff7d1', '#ffe17a'], calc: ['#3a3a3c', '#1c1c1e'], store: ['#36c1ff', '#1268f2'], health: ['#ffffff', '#f3f3f5'],
          wallet: ['#1c1c1e', '#000000'], browser: ['#ffffff', '#e9f2ff'], gallery: ['#ff7aa8', '#c13cff'], contacts: ['#ff9f43', '#f26b1d'], play: ['#ffffff', '#f2f2f2'],
          video: ['#ff4b4b', '#d21a1a'], chat: ['#5cd6ff', '#7b5cff'] }[kind];
        const g = x.createLinearGradient(0, Y, 0, Y + S); g.addColorStop(0, T[0]); g.addColorStop(1, T[1]); x.fillStyle = g; roundRect(x, X, Y, S, S, rad);
        const cx = X + S / 2, cy = Y + S / 2, u = S / 100, W = '#ffffff';
        x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
        const dot = (px, py, r, c) => { x.fillStyle = c; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill(); };
        if (kind === 'phone') { x.strokeStyle = W; x.lineWidth = 13 * u; x.beginPath(); x.arc(cx, cy, 22 * u, 2.3, 5.4); x.stroke(); }
        else if (kind === 'msg' || kind === 'chat') { x.fillStyle = W; x.beginPath(); x.ellipse(cx, cy - 3 * u, 30 * u, 24 * u, 0, 0, 7); x.fill(); x.beginPath(); x.moveTo(cx - 22 * u, cy + 12 * u); x.lineTo(cx - 28 * u, cy + 28 * u); x.lineTo(cx - 8 * u, cy + 18 * u); x.fill(); }
        else if (kind === 'mail') { x.fillStyle = W; roundRect(x, cx - 30 * u, cy - 20 * u, 60 * u, 40 * u, 5 * u); x.strokeStyle = T[1]; x.lineWidth = 4 * u; x.beginPath(); x.moveTo(cx - 28 * u, cy - 18 * u); x.lineTo(cx, cy + 4 * u); x.lineTo(cx + 28 * u, cy - 18 * u); x.stroke(); }
        else if (kind === 'camera') { x.fillStyle = '#2c2c2e'; roundRect(x, cx - 30 * u, cy - 18 * u, 60 * u, 40 * u, 8 * u); dot(cx, cy + 2 * u, 14 * u, '#d9dbe0'); dot(cx, cy + 2 * u, 9 * u, '#1c1c1e'); }
        else if (kind === 'photos') { ['#ff9500', '#ffcc00', '#34c759', '#5ac8fa', '#007aff', '#af52de', '#ff2d55', '#ff3b30'].forEach((c, k) => { x.fillStyle = c; x.globalAlpha = 0.85; x.beginPath(); const a = k / 8 * Math.PI * 2; x.ellipse(cx + Math.cos(a) * 14 * u, cy + Math.sin(a) * 14 * u, 15 * u, 8 * u, a, 0, 7); x.fill(); }); x.globalAlpha = 1; }
        else if (kind === 'maps') { x.strokeStyle = '#ffffff'; x.lineWidth = 9 * u; x.beginPath(); x.moveTo(X + 10 * u, Y + 75 * u); x.lineTo(X + 90 * u, Y + 30 * u); x.stroke(); x.strokeStyle = '#f7d046'; x.lineWidth = 6 * u; x.beginPath(); x.moveTo(X + 40 * u, Y + 5 * u); x.lineTo(X + 55 * u, Y + 95 * u); x.stroke(); dot(cx + 10 * u, cy - 6 * u, 10 * u, '#ff3b30'); }
        else if (kind === 'weather') { dot(cx - 8 * u, cy - 8 * u, 15 * u, '#ffd60a'); x.fillStyle = W; x.beginPath(); x.ellipse(cx + 6 * u, cy + 12 * u, 26 * u, 13 * u, 0, 0, 7); x.ellipse(cx + 12 * u, cy + 2 * u, 14 * u, 13 * u, 0, 0, 7); x.fill(); }
        else if (kind === 'clock') { dot(cx, cy, 36 * u, W); x.strokeStyle = '#000'; x.lineWidth = 4 * u; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx, cy - 26 * u); x.moveTo(cx, cy); x.lineTo(cx + 16 * u, cy + 8 * u); x.stroke(); x.strokeStyle = '#ff9500'; x.lineWidth = 2 * u; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx - 12 * u, cy + 28 * u); x.stroke(); }
        else if (kind === 'settings') { x.fillStyle = '#e5e5ea'; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; x.save(); x.translate(cx, cy); x.rotate(a); x.fillRect(-4 * u, -34 * u, 8 * u, 12 * u); x.restore(); } dot(cx, cy, 25 * u, '#e5e5ea'); dot(cx, cy, 12 * u, '#6b6f78'); }
        else if (kind === 'music') { x.fillStyle = W; x.fillRect(cx + 6 * u, cy - 26 * u, 6 * u, 40 * u); x.fillRect(cx - 18 * u, cy - 20 * u, 6 * u, 40 * u); x.beginPath(); x.moveTo(cx - 18 * u, cy - 20 * u); x.lineTo(cx + 12 * u, cy - 28 * u); x.lineTo(cx + 12 * u, cy - 18 * u); x.lineTo(cx - 18 * u, cy - 10 * u); x.fill(); dot(cx - 22 * u, cy + 20 * u, 9 * u, W); dot(cx + 2 * u, cy + 14 * u, 9 * u, W); }
        else if (kind === 'calendar') { x.fillStyle = '#ff3b30'; x.font = `700 ${16 * u}px Rubik`; x.textAlign = 'center'; x.fillText('FRIDAY', cx, Y + 26 * u); x.fillStyle = '#1c1c1e'; x.font = `400 ${52 * u}px Rubik`; x.fillText('13', cx, Y + 80 * u); }
        else if (kind === 'notes') { x.fillStyle = '#ffd60a'; x.fillRect(X, Y + 8 * u, S, 18 * u); x.strokeStyle = '#d6d0b8'; x.lineWidth = 2 * u; for (let k = 0; k < 4; k++) { x.beginPath(); x.moveTo(X + 12 * u, Y + (42 + k * 15) * u); x.lineTo(X + 88 * u, Y + (42 + k * 15) * u); x.stroke(); } }
        else if (kind === 'calc') { [['#a5a5a5', -1, -1], ['#a5a5a5', 1, -1], ['#ff9f0a', 1, 1], ['#505050', -1, 1]].forEach(([c, i, j]) => dot(cx + i * 15 * u, cy + j * 15 * u, 11 * u, c)); }
        else if (kind === 'store') { x.strokeStyle = W; x.lineWidth = 8 * u; x.beginPath(); x.moveTo(cx - 6 * u, cy - 28 * u); x.lineTo(cx - 24 * u, cy + 20 * u); x.moveTo(cx + 6 * u, cy - 28 * u); x.lineTo(cx + 24 * u, cy + 20 * u); x.moveTo(cx - 28 * u, cy + 6 * u); x.lineTo(cx + 28 * u, cy + 6 * u); x.stroke(); }
        else if (kind === 'health') { x.fillStyle = '#ff2d55'; x.beginPath(); x.moveTo(cx, cy + 26 * u); x.bezierCurveTo(cx - 40 * u, cy, cx - 22 * u, cy - 32 * u, cx, cy - 12 * u); x.bezierCurveTo(cx + 22 * u, cy - 32 * u, cx + 40 * u, cy, cx, cy + 26 * u); x.fill(); }
        else if (kind === 'wallet') { [['#34c759', -14], ['#ff9f0a', -4], ['#007aff', 6], ['#ff3b30', 16]].forEach(([c, dy]) => { x.fillStyle = c; roundRect(x, cx - 30 * u, cy + dy * u - 10 * u, 60 * u, 20 * u, 4 * u); }); }
        else if (kind === 'browser') { dot(cx, cy, 34 * u, '#1a8cff'); dot(cx, cy, 30 * u, '#ffffff'); x.fillStyle = '#ff3b30'; x.beginPath(); x.moveTo(cx + 20 * u, cy - 20 * u); x.lineTo(cx + 5 * u, cy + 5 * u); x.lineTo(cx - 5 * u, cy - 5 * u); x.fill(); x.fillStyle = '#c7c7cc'; x.beginPath(); x.moveTo(cx - 20 * u, cy + 20 * u); x.lineTo(cx + 5 * u, cy + 5 * u); x.lineTo(cx - 5 * u, cy - 5 * u); x.fill(); }
        else if (kind === 'gallery') { x.fillStyle = W; x.beginPath(); x.ellipse(cx, cy - 4 * u, 22 * u, 22 * u, 0, 0, 7); x.fill(); x.fillStyle = T[1]; x.beginPath(); x.moveTo(cx - 16 * u, cy + 8 * u); x.lineTo(cx - 2 * u, cy - 10 * u); x.lineTo(cx + 16 * u, cy + 8 * u); x.fill(); }
        else if (kind === 'contacts') { dot(cx, cy - 10 * u, 13 * u, W); x.fillStyle = W; x.beginPath(); x.ellipse(cx, cy + 22 * u, 24 * u, 14 * u, 0, Math.PI, 0); x.fill(); }
        else if (kind === 'play') { [['#00d26a', 0], ['#ffc800', 1], ['#ff3a44', 2], ['#00a2ff', 3]].forEach(([c, k]) => { x.fillStyle = c; x.beginPath(); x.moveTo(cx - 20 * u, cy - 28 * u); x.lineTo(cx + 28 * u, cy); x.lineTo(cx - 20 * u, cy + 28 * u); x.globalAlpha = 1 - k * 0.2; x.fill(); }); x.globalAlpha = 1; }
        else if (kind === 'video') { x.fillStyle = W; x.beginPath(); x.moveTo(cx - 12 * u, cy - 18 * u); x.lineTo(cx + 20 * u, cy); x.lineTo(cx - 12 * u, cy + 18 * u); x.fill(); }
        x.restore();
      };
      const statusIcons = (x, R, y, s = 1) => {   // signal bars, Wi-Fi and battery, right-aligned at R
        x.fillStyle = '#fff'; for (let k = 0; k < 4; k++) x.fillRect(R - 150 * s + k * 9 * s, y - (6 + k * 5) * s, 6 * s, (6 + k * 5) * s);
        x.strokeStyle = '#fff'; x.lineWidth = 4 * s; for (let k = 0; k < 3; k++) { x.beginPath(); x.arc(R - 86 * s, y, (6 + k * 7) * s, -2.4, -0.75); x.stroke(); }
        x.lineWidth = 2.5 * s; x.strokeStyle = 'rgba(255,255,255,0.6)'; x.beginPath(); x.roundRect(R - 56 * s, y - 20 * s, 46 * s, 22 * s, 6 * s); x.stroke(); x.fillRect(R - 8 * s, y - 13 * s, 3 * s, 8 * s);
        x.fillStyle = '#fff'; roundRect(x, R - 53 * s, y - 17 * s, 34 * s, 16 * s, 4 * s);
      };
      // an iPhone-style home screen: dark wallpaper, Dynamic Island, two widgets, the 4-column grid with labels, the glass dock
      const iosScreen = tex(512, 1060, (x, w, h) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
        let g = x.createRadialGradient(140, 300, 20, 140, 300, 520); g.addColorStop(0, '#2b3f8f'); g.addColorStop(0.55, '#141a3d'); g.addColorStop(1, '#05060d'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        g = x.createRadialGradient(420, 860, 10, 420, 860, 360); g.addColorStop(0, 'rgba(160,70,200,0.55)'); g.addColorStop(1, 'rgba(160,70,200,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = '#fff'; x.font = '600 30px Rubik'; x.textAlign = 'center'; x.fillText('9:41', 82, 60); statusIcons(x, w - 22, 58, 0.75);
        x.fillStyle = '#000'; roundRect(x, w / 2 - 70, 24, 140, 42, 21);
        // widgets: weather and calendar
        g = x.createLinearGradient(0, 100, 0, 300); g.addColorStop(0, '#3a8cff'); g.addColorStop(1, '#1d4fc4'); x.fillStyle = g; roundRect(x, 34, 104, 210, 210, 40);
        x.fillStyle = '#fff'; x.textAlign = 'left'; x.font = '600 24px Rubik'; x.fillText('Tel Aviv', 56, 148); x.font = '300 74px Rubik'; x.fillText('24°', 52, 228);
        x.font = '500 20px Rubik'; x.fillText('Mostly Sunny', 56, 270); x.fillText('H:27°  L:19°', 56, 296);
        x.fillStyle = 'rgba(28,28,30,0.92)'; roundRect(x, 268, 104, 210, 210, 40);
        x.fillStyle = '#ff453a'; x.font = '700 20px Rubik'; x.fillText('FRIDAY', 292, 146); x.fillStyle = '#fff'; x.font = '300 66px Rubik'; x.fillText('13', 290, 212);
        x.fillStyle = '#5e5ce6'; roundRect(x, 290, 232, 6, 50, 3); x.fillStyle = '#fff'; x.font = '600 18px Rubik'; x.fillText('Math exam', 306, 252); x.fillStyle = 'rgba(255,255,255,0.6)'; x.fillText('08:15 – 09:45', 306, 276);
        x.fillStyle = 'rgba(255,255,255,0.75)'; x.font = '500 16px Rubik'; x.textAlign = 'center'; x.fillText('Weather', 139, 338); x.fillText('Calendar', 373, 338);
        const grid = [['mail', 'Mail'], ['calendar', 'Calendar'], ['photos', 'Photos'], ['camera', 'Camera'], ['maps', 'Maps'], ['clock', 'Clock'], ['weather', 'Weather'], ['notes', 'Notes'],
          ['store', 'Store'], ['health', 'Health'], ['wallet', 'Wallet'], ['settings', 'Settings'], ['calc', 'Calculator'], ['video', 'TV'], ['contacts', 'Contacts'], ['chat', 'Chat']];
        grid.forEach(([k, label], i) => { const X = 40 + (i % 4) * 114, Y = 372 + Math.floor(i / 4) * 126; appIcon(x, X, Y, 90, k, 22); x.fillStyle = '#fff'; x.font = '500 17px Rubik'; x.fillText(label, X + 45, Y + 112); });
        x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.arc(w / 2 - 10, 888, 5, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.35)'; x.beginPath(); x.arc(w / 2 + 10, 888, 5, 0, 7); x.fill();
        x.fillStyle = 'rgba(255,255,255,0.22)'; roundRect(x, 22, 912, w - 44, 120, 46);   // glass dock
        ['phone', 'browser', 'msg', 'music'].forEach((k, i) => appIcon(x, 40 + i * 114, 927, 90, k, 22));
        x.fillStyle = '#fff'; roundRect(x, w / 2 - 70, h - 18, 140, 7, 4);   // home indicator
      });
      // a Galaxy-style home screen (One UI): punch-hole camera, the big clock and date widget, a search bar, rounder icons
      // with labels, the dock and the three navigation buttons
      const androidScreen = tex(512, 1060, (x, w, h) => {
        let g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#0b1f2e'); g.addColorStop(0.5, '#0d3b4a'); g.addColorStop(1, '#2a0f3d'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        for (let k = 0; k < 3; k++) { g = x.createRadialGradient(w * [0.85, 0.1, 0.6][k], h * [0.18, 0.55, 0.9][k], 0, w * [0.85, 0.1, 0.6][k], h * [0.18, 0.55, 0.9][k], 260); g.addColorStop(0, ['rgba(0,200,180,0.45)', 'rgba(70,90,255,0.4)', 'rgba(220,60,160,0.4)'][k]); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, h); }
        x.fillStyle = '#fff'; x.font = '500 24px Rubik'; x.textAlign = 'left'; x.fillText('12:45', 26, 52); statusIcons(x, w - 20, 50, 0.65);
        x.fillStyle = '#000'; x.beginPath(); x.arc(w / 2, 40, 15, 0, 7); x.fill(); x.fillStyle = '#1b1d24'; x.beginPath(); x.arc(w / 2, 40, 7, 0, 7); x.fill();
        x.textAlign = 'center'; x.fillStyle = '#fff'; x.font = '200 120px Rubik'; x.fillText('12:45', w / 2, 230);
        x.font = '500 26px Rubik'; x.fillText('Fri, 13 November', w / 2, 278); x.font = '400 22px Rubik'; x.fillStyle = 'rgba(255,255,255,0.8)'; x.fillText('☀  24°  Tel Aviv', w / 2, 314);
        x.fillStyle = 'rgba(255,255,255,0.92)'; roundRect(x, 34, 360, w - 68, 70, 35);   // search bar
        x.fillStyle = '#5f6368'; x.font = '400 24px Rubik'; x.textAlign = 'left'; x.fillText('Search', 96, 404);
        x.strokeStyle = '#5f6368'; x.lineWidth = 4; x.beginPath(); x.arc(70, 393, 11, 0, 7); x.moveTo(78, 401); x.lineTo(86, 409); x.stroke();
        x.fillStyle = '#4285f4'; roundRect(x, w - 82, 380, 12, 22, 6); x.strokeStyle = '#4285f4'; x.lineWidth = 3; x.beginPath(); x.arc(w - 76, 395, 12, 0.2, Math.PI - 0.2); x.stroke();
        const grid = [['gallery', 'Gallery'], ['calendar', 'Calendar'], ['weather', 'Weather'], ['clock', 'Clock'], ['play', 'Play Store'], ['camera', 'Camera'], ['contacts', 'Contacts'], ['settings', 'Settings'],
          ['notes', 'Notes'], ['calc', 'Calculator'], ['video', 'Videos'], ['mail', 'Email']];
        x.textAlign = 'center';
        grid.forEach(([k, label], i) => { const X = 44 + (i % 4) * 112, Y = 490 + Math.floor(i / 4) * 128; appIcon(x, X, Y, 86, k, 30); x.fillStyle = '#fff'; x.font = '500 17px Rubik'; x.fillText(label, X + 43, Y + 110); });
        ['phone', 'chat', 'browser', 'camera'].forEach((k, i) => appIcon(x, 44 + i * 112, 900, 86, k, 30));
        x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 4;   // navigation: recents, home, back
        [0, 1, 2].forEach(k => { x.beginPath(); x.moveTo(w * 0.27 - 8 + k * 8, h - 42); x.lineTo(w * 0.27 - 8 + k * 8, h - 22); x.stroke(); });
        x.beginPath(); x.roundRect(w / 2 - 13, h - 45, 26, 26, 8); x.stroke();
        x.beginPath(); x.moveTo(w * 0.73 + 6, h - 44); x.lineTo(w * 0.73 - 6, h - 32); x.lineTo(w * 0.73 + 6, h - 20); x.stroke();
      });
      const blackGlass = Object.assign(new THREE.MeshBasicMaterial({ color: 0x050608 }), { userData: { decal: true } });   // the screen's black glass and bezel
      const phoneScreen = phoneScreenOf(false), phoneScreenUltra = androidScreen, phoneScreenReal = iosScreen;
      // a laptop desktop: dark wallpaper, the menu bar, a code editor and a browser window, the dock (drawn after the icons)
      const laptopScreen = tex(1024, 640, (x, w, h) => {
        let g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#16224f'); g.addColorStop(0.6, '#2a1650'); g.addColorStop(1, '#0b0d1c'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(20,20,28,0.75)'; x.fillRect(0, 0, w, 24); x.fillStyle = '#fff'; x.font = '600 13px Rubik'; x.textAlign = 'left';
        ['File', 'Edit', 'View', 'Window', 'Help'].forEach((t, k) => x.fillText(t, 40 + k * 52, 17)); x.textAlign = 'right'; x.fillText('Fri 13 Nov  12:45', w - 14, 17);
        const win = (X, Y, W, H, bar) => { x.fillStyle = 'rgba(0,0,0,0.35)'; roundRect(x, X + 4, Y + 8, W, H, 12); x.fillStyle = bar; roundRect(x, X, Y, W, H, 12); ['#ff5f57', '#febc2e', '#28c840'].forEach((c, k) => { x.fillStyle = c; x.beginPath(); x.arc(X + 18 + k * 20, Y + 16, 6, 0, 7); x.fill(); }); };
        win(40, 50, 560, 470, '#1e1f29');   // code editor
        x.fillStyle = '#16171f'; x.fillRect(40, 34 + 36, 130, 450); x.fillStyle = '#6b7089'; x.font = '500 12px Rubik'; x.textAlign = 'left';
        ['src', '  app.ts', '  router.ts', '  db.ts', 'tests', 'package.json'].forEach((t, k) => x.fillText(t, 54, 96 + k * 22));
        const C = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#ffcb6b', '#eeffff'];
        for (let r = 0; r < 19; r++) { let X = 200 + (hash(r + 5) * 3 | 0) * 18; x.fillStyle = '#4b5068'; x.fillText(String(r + 1), 178, 96 + r * 22); for (let k = 0; k < 1 + (hash(r) * 4 | 0); k++) { const L = 30 + hash(r * 7 + k) * 110; x.fillStyle = C[(r + k * 3) % C.length]; roundRect(x, X, 86 + r * 22, L, 10, 4); X += L + 10; } }
        win(520, 120, 460, 400, '#f4f5f8');   // browser
        x.fillStyle = '#ffffff'; roundRect(x, 600, 132, 300, 22, 11); x.fillStyle = '#0a84ff'; roundRect(x, 545, 180, 410, 120, 12);
        x.fillStyle = '#fff'; x.font = '800 30px Rubik'; x.textAlign = 'left'; x.fillText('How it really works', 565, 235); x.font = '500 16px Rubik'; x.fillText('The secret inside every device', 565, 268);
        x.fillStyle = '#d5d8e0'; for (let k = 0; k < 5; k++) roundRect(x, 545, 320 + k * 30, 220 + 160 * hash(k + 3), 14, 7);
        x.fillStyle = '#ff9f0a'; roundRect(x, 800, 320, 155, 130, 12);
      });
      { const c = laptopScreen.image, x = c.getContext('2d'); x.fillStyle = 'rgba(255,255,255,0.2)'; roundRect(x, 262, 566, 500, 64, 18);
        ['browser', 'mail', 'msg', 'music', 'photos', 'calendar', 'notes', 'settings'].forEach((k, i) => appIcon(x, 274 + i * 61, 574, 48, k, 12)); laptopScreen.needsUpdate = true; }
      const watchFace = tex(256, 300, (x, w, h) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
        [['#fa114f', 100], ['#a6ff00', 78], ['#00d8ff', 56]].forEach(([c, r], k) => { x.strokeStyle = c; x.lineWidth = 18; x.lineCap = 'round'; x.beginPath(); x.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * (1.2 + 0.25 * k)); x.stroke(); });
        x.fillStyle = '#fff'; x.font = '700 40px Rubik'; x.textAlign = 'center'; x.fillText('10:09', w / 2, h / 2 + 14);
      });
      const tvScreen = tex(1024, 576, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#5ac8fa'); g.addColorStop(1, '#ffe29a'); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = '#ffcc00'; x.beginPath(); x.arc(780, 160, 70, 0, 7); x.fill();
        x.fillStyle = '#34c759'; x.beginPath(); x.moveTo(0, h); x.lineTo(300, 300); x.lineTo(560, h); x.fill(); x.fillStyle = '#30a14e'; x.beginPath(); x.moveTo(360, h); x.lineTo(700, 260); x.lineTo(1024, h); x.fill();
      });
      const earthTex = tex(1024, 512, (x, w, h) => {
        x.fillStyle = '#1e6fd9'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#3fbf6b'; for (let k = 0; k < 26; k++) { x.beginPath(); x.ellipse(hash(k) * w, 80 + hash(k + 40) * (h - 160), 40 + 90 * hash(k + 9), 25 + 60 * hash(k + 3), hash(k + 7) * 3, 0, 7); x.fill(); }
        x.fillStyle = '#f5f7fa'; x.fillRect(0, 0, w, 26); x.fillRect(0, h - 26, w, 26);
      });
      const bayTex = tex(256, 512, (x, w, h) => { x.fillStyle = '#1f232a'; x.fillRect(0, 0, w, h); for (let k = 0; k < 10; k++) { x.fillStyle = '#2c313a'; roundRect(x, 14, 14 + k * 50, w - 28, 40, 6); x.fillStyle = k % 3 ? '#22d36b' : '#2f7bff'; x.beginPath(); x.arc(w - 36, 34 + k * 50, 6, 0, 7); x.fill(); } });
      const panelTex = tex(256, 256, (x, w, h) => { x.fillStyle = '#1f3e9a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#7fa6ff'; x.lineWidth = 3; for (let k = 0; k <= 8; k++) { x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 32); x.lineTo(w, k * 32); x.stroke(); } });
      const rackTex = tex(512, 1760, (x, w, h) => {
        x.fillStyle = '#0d0f14'; x.fillRect(0, 0, w, h);
        let y = 8;
        for (let k = 0; y < h - 40; k++) {
          const u = k % 5 === 2 ? 2 : 1, hh = 38 * u;                                   // 1U and 2U servers
          x.fillStyle = '#22262e'; roundRect(x, 10, y, w - 20, hh - 4, 4);
          for (let b = 0; b < (u === 2 ? 12 : 8); b++) { x.fillStyle = '#353b46'; roundRect(x, 22 + b * (u === 2 ? 30 : 42), y + 5, u === 2 ? 24 : 34, hh - 14, 3); }   // drive bays
          x.fillStyle = hash(k) > 0.25 ? '#3fd06b' : '#ffb340'; x.beginPath(); x.arc(w - 40, y + hh / 2, 5, 0, 7); x.fill();
          x.fillStyle = '#3d7bff'; x.beginPath(); x.arc(w - 24, y + hh / 2, 5, 0, 7); x.fill();
          y += hh;
        }
      });
      const boardTex = tex(1024, 1024, (x, w, h) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h); x.strokeStyle = '#7a8a7f'; x.lineWidth = 3;
        for (let k = 0; k < 90; k++) {                                                    // traces running to the socket
          const sx = hash(k) * w, sy = hash(k + 50) * h, mx = sx + (hash(k + 7) - 0.5) * 300;
          x.beginPath(); x.moveTo(sx, sy); x.lineTo(mx, sy); x.lineTo(w / 2 + (hash(k + 9) - 0.5) * 380, h / 2 + (hash(k + 11) - 0.5) * 380); x.stroke();
        }
        x.fillStyle = '#9aa69e'; for (let k = 0; k < 140; k++) { x.beginPath(); x.arc(hash(k + 300) * w, hash(k + 400) * h, 4, 0, 7); x.fill(); }   // vias
      });
      const earthMask = await new THREE.TextureLoader().loadAsync('textures/earth.jpg');   // NASA land mask (via three.js examples)
      earthMask.colorSpace = THREE.SRGBColorSpace;
      // ─── vehicles and buildings: a vehicle is its side profile (wheel arches cut in) extruded across its width, a building
      // is a volume with its facades drawn on canvases (dark and lit windows, the same every frame) ───
      const prof = (cmds) => {
        const s = new THREE.Shape();
        cmds.forEach((c, k) => {
          if (c[0] === 'q') s.quadraticCurveTo(c[1], c[2], c[3], c[4]);
          else if (c[0] === 'a') { const [, cx, cy, r, yb] = c; s.lineTo(cx - r, yb); s.lineTo(cx - r, cy); s.absarc(cx, cy, r, Math.PI, 0, true); s.lineTo(cx + r, yb); }
          else if (k === 0) s.moveTo(c[0], c[1]); else s.lineTo(c[0], c[1]);
        });
        return s;
      };
      const extrudeZ = (shape, width, bev, mat) => {
        const d = Math.max(0.002, width - 2 * bev);
        const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 4, curveSegments: 20 });
        g.translate(0, 0, -d / 2); return mesh(g, mat);
      };
      const sideFlat = (cmds, z, mat) => { const m = mesh(new THREE.ShapeGeometry(prof(cmds), 12), mat, [0, 0, z]); if (z < 0) m.scale.z = -1; return m; };   // a side window
      const seam = (x, y, h, z) => rbox(0.004, h, 0.004, 0.001, M.black, [x, y, z]);                                                   // a door gap
      // mats: [tyre, rim, hub, spoke]; the real-colour models pass real() ones
      const wheel = (R, w, at, spokes = 5, mats = [M.black, M.darkMetal, M.chrome, M.alu]) => {
        const g = group(cyl(R, R, w, mats[0], [0, 0, 0], [Math.PI / 2, 0, 0], 40), cyl(R * 0.68, R * 0.68, w + 0.004, mats[1], [0, 0, 0], [Math.PI / 2, 0, 0], 32),
          cyl(R * 0.16, R * 0.16, w + 0.012, mats[2], [0, 0, 0], [Math.PI / 2, 0, 0], 16));
        for (let k = 0; k < spokes; k++) { const a = k * Math.PI * 2 / spokes; g.add(rbox(R * 0.13, R * 0.5, 0.01, 0.004, mats[3], [Math.sin(a) * R * 0.38, Math.cos(a) * R * 0.38, w / 2 + 0.004], [0, 0, -a])); }
        g.position.set(...at); if (at[2] < 0) g.scale.z = -1; return g;
      };
      // vehicles stand three-quarter on, nose to the camera, a little smaller than their 2 m length so they fit the 9:16 frame;
      // dress() turns them back square for parking along a street
      const hero = (g) => { g.rotation.y = -0.6; g.scale.setScalar(0.85); const o = group(g); o.userData.yawed = true; return o; };
      const carPaint = (hex = '#1f4e9c') => real(hex, false, { metal: 0.45, rough: 0.3, coat: 1 });   // metallic paint under clearcoat
      const LAMP = '#f4f1ff', TAIL = '#ff3b4e';
      const FT = {};   // facade textures are shared: a city street dresses the same building many times
      const ftex = (key, cols, rows, kind, seed) => FT[key] || (FT[key] = tex(cols * 40, rows * 40, (x, w, h) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
        const cw = w / cols, rh = h / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          x.fillStyle = hash(seed + r * 31 + c * 7) > 0.74 ? 'rgba(236,233,255,1)' : 'rgba(150,142,255,0.55)';   // about a quarter lit
          if (kind === 'curtain') x.fillRect(c * cw + 2, r * rh + 3, cw - 4, rh - 9);                // glass mullion to mullion, a spandrel per floor
          else if (kind === 'ribbon') x.fillRect(c * cw, r * rh + rh * 0.3, cw - 1, rh * 0.5);        // strip windows
          else x.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.2, cw * 0.56, rh * 0.58);               // punched windows
        }
      }));
      const facadeMat = t => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t });
      const block = (w, h, d, y0, front, side) => {
        const g = group(mesh(new THREE.BoxGeometry(w, h, d), M.glass, [0, y0 + h / 2, 0]));
        [[0, 0, d / 2 + 0.003, w, front], [Math.PI, 0, -d / 2 - 0.003, w, front], [Math.PI / 2, w / 2 + 0.003, 0, d, side || front], [-Math.PI / 2, -w / 2 - 0.003, 0, d, side || front]]
          .forEach(([ry, x, z, pw, t]) => g.add(plane(pw * 0.98, h * 0.98, facadeMat(t), [x, y0 + h / 2, z], [0, ry, 0])));
        return g;
      };
      const winFrame = (x, y, z, w, h, lit) => group(rbox(w + 0.03, h + 0.03, 0.012, 0.004, M.white, [x, y, z]), rbox(w, h, 0.016, 0.003, lit ? glow('#e2deff', 1.1) : M.lens, [x, y, z + 0.003]),
        rbox(0.01, h, 0.02, 0.002, M.white, [x, y, z + 0.005]), rbox(w, 0.01, 0.02, 0.002, M.white, [x, y, z + 0.005]));
      // what you see through a vehicle's windows: seats with headrests (front pair, rear bench or none), the steering wheel
      // on its column, the dashboard with a lit centre screen
      const interior = (g, { seatY, front, rear = null, steer, dash, width, seat = '#2b2f36' }) => {
        const sm = real(seat), dark = real('#1c1f24');
        for (const z of [width * 0.24, -width * 0.24]) g.add(rbox(0.15, 0.04, 0.15, 0.015, sm, [front, seatY, z]), rbox(0.04, 0.17, 0.15, 0.015, sm, [front - 0.08, seatY + 0.09, z], [0, 0, 0.15]), rbox(0.03, 0.05, 0.09, 0.012, sm, [front - 0.1, seatY + 0.2, z]));
        if (rear !== null) g.add(rbox(0.15, 0.04, width * 0.75, 0.015, sm, [rear, seatY, 0]), rbox(0.04, 0.16, width * 0.75, 0.015, sm, [rear - 0.08, seatY + 0.09, 0], [0, 0, 0.18]));
        const ring = mesh(new THREE.TorusGeometry(0.05, 0.008, 8, 28), dark, [steer[0], steer[1], width * 0.24], [0, Math.PI / 2, 0]); ring.rotation.z = 0.45; g.add(ring);
        g.add(cyl(0.007, 0.007, 0.1, dark, [steer[0] + 0.05, steer[1] - 0.03, width * 0.24], [0, 0, 1.1], 8));
        g.add(rbox(0.07, 0.045, width * 0.9, 0.015, dark, [dash[0], dash[1], 0]), plane(0.13, 0.08, screenMat(tvScreen), [dash[0] - 0.036, dash[1] + 0.035, 0], [0, -Math.PI / 2, 0]));
      };
      // a sedan in the proportions of a Model 3 class car (4720 x 1850 x 1441 mm, 1 unit = 2.4 m): fastback roof, flush
      // handles, a full-width tail light bar. No logos.
      const sedan = () => {
        const R = 0.142, paint = carPaint('#1f4e9c');
        const g = group(
          extrudeZ(prof([[-0.93, 0.10], ['a', -0.58, R, 0.21, 0.10], ['a', 0.62, R, 0.21, 0.10], [0.92, 0.10], ['q', 0.95, 0.12, 0.95, 0.20], ['q', 0.95, 0.27, 0.90, 0.29],
            ['q', 0.62, 0.33, 0.32, 0.385], [-0.62, 0.40], ['q', -0.86, 0.405, -0.93, 0.36], ['q', -0.955, 0.30, -0.945, 0.20], ['q', -0.945, 0.12, -0.93, 0.10]]), 0.77, 0.04, paint),
          extrudeZ(prof([[0.30, 0.37], ['q', 0.17, 0.50, 0.04, 0.55], ['q', -0.15, 0.565, -0.34, 0.545], ['q', -0.62, 0.48, -0.80, 0.39], [-0.80, 0.37]]), 0.64, 0.05, M.tint));
        for (const s of [1, -1]) {
          g.add(sideFlat([[0.25, 0.40], ['q', 0.15, 0.49, 0.04, 0.525], [-0.13, 0.53], [-0.13, 0.40]], s * 0.322, M.lens),
            sideFlat([[-0.16, 0.40], [-0.16, 0.53], ['q', -0.36, 0.53, -0.50, 0.49], ['q', -0.62, 0.44, -0.68, 0.40]], s * 0.322, M.lens));
          for (const x of [0.32, -0.13, -0.52]) g.add(seam(x, 0.25, 0.26, s * 0.386));
          for (const x of [0.12, -0.27]) g.add(rbox(0.06, 0.012, 0.006, 0.003, M.chrome, [x, 0.37, s * 0.387]));
          g.add(rbox(0.06, 0.022, 0.2, 0.01, glow(LAMP, 2.5), [0.925, 0.305, s * 0.25], [0, 0, -0.35]), rbox(0.06, 0.04, 0.08, 0.015, M.black, [0.27, 0.45, s * 0.42]));
          g.add(wheel(R, 0.09, [0.62, R, s * 0.33]), wheel(R, 0.09, [-0.58, R, s * 0.33]));
        }
        g.add(rbox(0.02, 0.05, 0.42, 0.01, M.black, [0.985, 0.15, 0]), rbox(0.02, 0.025, 0.68, 0.01, glow(TAIL, 2), [-0.975, 0.335, 0]));
        interior(g, { seatY: 0.33, front: 0.04, rear: -0.36, steer: [0.2, 0.45], dash: [0.3, 0.41], width: 0.62, seat: '#cdbfa6' });
        return g;
      };
      // a 3- to 4-storey city block of the classic kind: a lit shop floor with awnings, punched windows with sills, a cornice
      const cityBlock = (w, d, floors, cols, seed) => {
        const fh = 0.24, top = 0.3 + floors * fh;
        const g = group(mesh(new THREE.BoxGeometry(w - 0.04, 0.3, d - 0.04), M.glass, [0, 0.15, 0]), plane(w * 0.9, 0.2, facadeMat(ftex('shop', 6, 1, 'curtain', 5)), [0, 0.13, d / 2 - 0.015]),
          block(w, floors * fh, d, 0.3, ftex('cbF' + seed, cols, floors, 'punched', seed), ftex('cbS' + seed, Math.max(2, Math.round(cols * d / w)), floors, 'punched', seed + 5)),
          rbox(w + 0.03, 0.02, d + 0.03, 0.005, M.white, [0, 0.3, 0]), rbox(w + 0.07, 0.045, d + 0.07, 0.01, M.white, [0, top + 0.022, 0]));
        for (let k = 0; k < 3; k++) g.add(rbox(w * 0.26, 0.01, 0.13, 0.004, M.white, [(k - 1) * w * 0.32, 0.27, d / 2 + 0.055], [0.4, 0, 0]));   // awnings
        for (let r = 0; r < floors; r++) for (let c = 0; c < cols; c++) g.add(rbox(w / cols * 0.62, 0.008, 0.025, 0.003, M.white, [-w / 2 + (c + 0.5) * w / cols, top - r * fh - 0.78 * fh, d / 2 + 0.012]));   // sills
        return g;
      };

      // ─── the object library. Each builder returns a group sitting on y = 0, about 1-2 units tall ───
      const OBJ = {
        // Phones built from the real devices' measurements (1 unit = 100 mm), no logos (trademarks).
        // phone: iPhone 18 Pro Max style (163.4 x 78.0 x 8.75 mm, full-width camera plateau, 3 big lenses, Dynamic Island).
        // Real colours and see-through (13.11 pilot): a natural-titanium frame and clear glass, and inside them the L-shaped
        // battery, the stacked logic board with SoC, RAM and modem, the camera modules, the copper charging coil and its
        // magnet ring, the haptic motor, speaker, USB-C port and the flex cables between them. No logos.
        phone: () => {
          const W = 0.78, H = 1.634, D = 0.0875, R = 0.115;
          const ti = real('#8e9097', true), tiSolid = real('#9a9ca3'), glassS = real('#1b1f27', true), lens = real('#0b0d11'), black = real('#16181d'),
            board = real('#16324f'), chip = real('#a8adb5'), copper = real('#c47a3a'), flex = real('#c98a2c'), steel = real('#8d939c');
          const g = group(slab(W, H, D, R, 0.012, ti), slab(W - 0.01, H - 0.01, 0.012, R - 0.005, 0.004, glassS, [0, 0, D / 2 - 0.004]),
            mesh(new THREE.ShapeGeometry(rrShape(W - 0.05, H - 0.05, R - 0.025), 16), Object.assign(new THREE.MeshBasicMaterial({ map: phoneScreenReal }), { userData: { decal: true } }), [0, 0, D / 2 + 0.0035]));
          fitUV(g.children[2].geometry, W - 0.05, H - 0.05);
          g.add(mesh(new THREE.ShapeGeometry(rrShape(W - 0.012, H - 0.012, R - 0.006), 16), blackGlass, [0, 0, D / 2 + 0.0026]));   // the screen is lit and opaque: the parts show through the back glass
          // inside: battery (an L around the board) with its printed label
          g.add(rbox(0.6, 0.86, 0.034, 0.02, black, [0.02, -0.28, -0.006]), rbox(0.3, 0.3, 0.034, 0.02, black, [-0.13, 0.33, -0.006]));
          g.add(plane(0.5, 0.3, ink(400, 240, (x) => { x.fillStyle = 'rgba(235,235,235,0.9)'; x.font = '700 34px Rubik'; x.fillText('Li-ion Polymer', 20, 60); x.font = '400 26px Rubik'; x.fillText('4685 mAh · 3.86 V · 18.1 Wh', 20, 110); x.fillText('Do not puncture or heat', 20, 160); }), [0.02, -0.28, 0.0115]));
          // the logic board, stacked, with the SoC, RAM, modem, storage and small parts
          g.add(rbox(0.26, 0.62, 0.012, 0.01, board, [0.22, 0.38, 0.0]), rbox(0.26, 0.62, 0.012, 0.01, board, [0.22, 0.38, -0.02]));
          g.add(rbox(0.13, 0.13, 0.008, 0.01, chip, [0.22, 0.52, 0.009]), rbox(0.1, 0.06, 0.008, 0.005, black, [0.22, 0.4, 0.009]), rbox(0.08, 0.08, 0.008, 0.005, chip, [0.2, 0.28, 0.009]),
            rbox(0.09, 0.07, 0.008, 0.005, black, [0.24, 0.16, 0.009]));
          g.add(plane(0.12, 0.12, ink(128, 128, (x) => { x.fillStyle = '#2a2f38'; x.textAlign = 'center'; x.font = '800 30px Rubik'; x.fillText('N9 PRO', 64, 60); x.font = '500 18px Rubik'; x.fillText('2nm · 2611', 64, 90); }), [0.22, 0.52, 0.0135]));
          for (let k = 0; k < 18; k++) g.add(rbox(0.018, 0.012, 0.006, 0.002, k % 3 ? black : chip, [0.12 + hash(k) * 0.2, 0.1 + hash(k + 40) * 0.56, 0.008]));
          // cameras behind the plateau, Face ID / front camera at the top, flex cables
          [[-0.255, H / 2 - 0.165], [-0.085, H / 2 - 0.25], [-0.255, H / 2 - 0.335]].forEach(([x, y]) => g.add(rbox(0.13, 0.13, 0.05, 0.01, black, [x, y, -0.01]), cyl(0.045, 0.045, 0.01, steel, [x, y, 0.017], [Math.PI / 2, 0, 0], 24)));
          g.add(rbox(0.26, 0.05, 0.02, 0.008, black, [0, H / 2 - 0.08, 0.02]));
          g.add(rbox(0.04, 0.3, 0.003, 0.001, flex, [0.05, 0.6, 0.012]), rbox(0.22, 0.03, 0.003, 0.001, flex, [0.0, -0.73, 0.012]), rbox(0.03, 0.5, 0.003, 0.001, flex, [-0.34, -0.2, 0.012]));
          // MagSafe-style coil and magnet ring on the back, the haptic motor, speaker and USB-C port at the bottom
          g.add(mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 48), copper, [0, -0.25, -0.032]), mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 48), copper, [0, -0.25, -0.032]));
          for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; g.add(rbox(0.035, 0.02, 0.008, 0.002, steel, [Math.cos(a) * 0.23, -0.25 + Math.sin(a) * 0.23, -0.034], [0, 0, a + Math.PI / 2])); }
          g.add(rbox(0.22, 0.07, 0.03, 0.01, steel, [-0.2, -0.74, 0]), rbox(0.16, 0.06, 0.03, 0.01, black, [0.22, -0.74, 0]), rbox(0.1, 0.012, 0.04, 0.005, tiSolid, [0, -H / 2 + 0.004, 0]));
          // the camera plateau: across the whole back, the top 30%, raised 2.8 mm
          g.add(slab(W - 0.04, 0.46, 0.028, 0.08, 0.006, ti, [0, H / 2 - 0.25, -D / 2 - 0.012]));
          g.add(slab(0.36, 0.36, 0.012, 0.075, 0.004, glassS, [-0.17, H / 2 - 0.25, -D / 2 - 0.028]));
          [[-0.255, H / 2 - 0.165], [-0.085, H / 2 - 0.25], [-0.255, H / 2 - 0.335]].forEach(([x, y]) => g.add(
            cyl(0.0825, 0.0825, 0.022, tiSolid, [x, y, -D / 2 - 0.04], [Math.PI / 2, 0, 0], 48), cyl(0.062, 0.062, 0.024, lens, [x, y, -D / 2 - 0.042], [Math.PI / 2, 0, 0], 48)));
          g.add(cyl(0.028, 0.028, 0.01, real('#f3e9cf'), [0.2, H / 2 - 0.19, -D / 2 - 0.03], [Math.PI / 2, 0, 0]), cyl(0.026, 0.026, 0.01, lens, [0.2, H / 2 - 0.31, -D / 2 - 0.03], [Math.PI / 2, 0, 0]));   // flash, LiDAR
          [[0.13, 0.17], [0.42, 0.1]].forEach(([y, h]) => g.add(rbox(0.01, h, 0.03, 0.005, tiSolid, [W / 2 + 0.003, H / 2 - y - h / 2, 0])));   // buttons
          g.add(rbox(0.012, 0.11, 0.025, 0.005, lens, [W / 2 + 0.002, -0.2, 0]));   // camera control
          g.rotation.x = -0.12; g.position.y = 0.84; return group(g);
        },
        // phone_ultra: Galaxy S26 Ultra style (163.6 x 78.1 x 7.9 mm, flat frame, rounder corners than the S25, raised camera island, S Pen)
        phone_ultra: () => {
          const W = 0.781, H = 1.636, D = 0.079, R = 0.075;
          const g = group(slab(W, H, D, R, 0.006, M.titanium), slab(W - 0.008, H - 0.008, 0.01, R - 0.004, 0.003, M.glass, [0, 0, D / 2 - 0.003]),
            mesh(new THREE.ShapeGeometry(rrShape(W - 0.035, H - 0.035, R - 0.02), 16), Object.assign(new THREE.MeshBasicMaterial({ map: phoneScreenUltra }), { userData: { decal: true } }), [0, 0, D / 2 + 0.0036]));
          fitUV(g.children[2].geometry, W - 0.035, H - 0.035);
          g.add(mesh(new THREE.ShapeGeometry(rrShape(W - 0.01, H - 0.01, R - 0.005), 16), blackGlass, [0, 0, D / 2 + 0.0026]));
          // camera island: a raised pill holding three big lenses in a column, with the periscope, flash and laser beside it
          g.add(slab(0.2, 0.62, 0.022, 0.1, 0.006, M.glass, [-0.24, H / 2 - 0.4, -D / 2 - 0.011]));
          [0.18, 0.4, 0.62].forEach(y => g.add(cyl(0.072, 0.072, 0.02, M.chrome, [-0.24, H / 2 - y, -D / 2 - 0.03], [Math.PI / 2, 0, 0], 48), cyl(0.055, 0.055, 0.022, M.lens, [-0.24, H / 2 - y, -D / 2 - 0.032], [Math.PI / 2, 0, 0], 48)));
          g.add(slab(0.11, 0.11, 0.016, 0.02, 0.004, M.lens, [-0.05, H / 2 - 0.2, -D / 2 - 0.012]));   // periscope window
          g.add(cyl(0.022, 0.022, 0.008, M.white, [-0.05, H / 2 - 0.33, -D / 2 - 0.006], [Math.PI / 2, 0, 0]), cyl(0.016, 0.016, 0.008, M.lens, [-0.05, H / 2 - 0.42, -D / 2 - 0.006], [Math.PI / 2, 0, 0]));
          g.add(rbox(0.05, 0.012, 0.03, 0.005, M.black, [-0.22, -H / 2 + 0.004, 0]));   // the S Pen tip at the bottom edge
          [[0.3, 0.2], [0.55, 0.09]].forEach(([y, h]) => g.add(rbox(0.009, h, 0.025, 0.004, M.titanium, [W / 2 + 0.003, H / 2 - y - h / 2, 0])));
          g.rotation.x = -0.12; g.position.y = 0.84; return group(g);
        },
        // MacBook Pro 14 style (312.6 x 221.2 x 15.5 mm, 1 unit = 160 mm): flat aluminium base, black keys in a well,
        // a big trackpad, thin bezels with the camera notch, lid open ~110 degrees. No logo.
        laptop: () => {
          const W = 1.954, Dp = 1.383, R = 0.075, flat = [-Math.PI / 2, 0, 0], T = 0.058;
          const g = group(slab(W, Dp, T, R, 0.012, M.alu, [0, T / 2, 0], flat));
          // the keyboard well and every key: a function row, the number row, three letter rows and the bottom row with the
          // space bar and the inverted-T arrows
          g.add(rbox(W * 0.88, 0.004, 0.66, 0.01, M.black, [0, T - 0.001, -0.29]));
          const u = 1.68 / 14.5, rows = [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5], [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
            [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.7], [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.2], [1, 1, 1, 1.25, 5, 1.25, 1]];
          for (let k = 0; k < 14; k++) g.add(rbox(u * (k === 13 ? 1.5 : 1) - 0.018, 0.008, 0.045, 0.006, M.white, [-0.84 + u * (k + 0.5) + (k === 13 ? u * 0.25 : 0), T + 0.003, -0.56]));
          rows.forEach((row, r) => { let at = -0.84; for (const kw of row) { g.add(rbox(kw * u - 0.018, 0.009, 0.082, 0.008, M.white, [at + kw * u / 2, T + 0.004, -0.48 + r * 0.1])); at += kw * u; } });
          [[-1, 0], [0, 0], [1, 0], [0, -1]].forEach(([i, j]) => g.add(rbox(u - 0.02, 0.009, j ? 0.036 : 0.036, 0.006, M.white, [0.84 - 1.5 * u + i * u, T + 0.004, -0.06 + j * 0.044 + 0.022])));
          g.add(rbox(u - 0.02, 0.009, 0.06, 0.02, M.white, [0.84 - u * 0.5 - 0.02, T + 0.004, -0.56]));   // the power key with Touch ID
          // speaker grilles either side of the keys, the trackpad, the thumb notch on the front edge
          for (const sx of [-1, 1]) for (let r = 0; r < 16; r++) for (let c = 0; c < 2; c++) g.add(cyl(0.006, 0.006, 0.004, M.black, [sx * (0.9 + c * 0.025), T + 0.001, -0.57 + r * 0.034], [0, 0, 0], 8));
          g.add(slab(0.94, 0.58, 0.004, 0.03, 0.001, M.titanium, [0, T + 0.001, 0.34], flat));
          g.add(rbox(0.2, 0.02, 0.03, 0.01, M.titanium, [0, T - 0.012, Dp / 2 - 0.005]));
          // ports: MagSafe, two USB-C and the headphone jack on the left; HDMI, USB-C and the SD slot on the right
          const port = (side, z, w, h) => g.add(rbox(0.012, h, w, Math.min(h, w) / 2.2, M.black, [side * (W / 2 + 0.001), T * 0.45, z]));
          port(-1, -0.42, 0.11, 0.022); port(-1, -0.24, 0.06, 0.02); port(-1, -0.14, 0.06, 0.02); g.add(cyl(0.013, 0.013, 0.014, M.black, [-W / 2 - 0.001, T * 0.45, 0.25], [0, 0, Math.PI / 2], 16));
          port(1, -0.36, 0.1, 0.022); port(1, -0.2, 0.06, 0.02); port(1, 0.1, 0.16, 0.012);
          for (const [x, z] of [[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]]) g.add(cyl(0.05, 0.05, 0.008, M.black, [x, -0.004, z], [0, 0, 0], 24));   // rubber feet
          // inside the base: the logic board with the SoC and memory, two fans with their heat pipe, six battery cells,
          // the speakers under the grilles and the haptic trackpad motor
          g.add(rbox(1.0, 0.008, 0.36, 0.01, M.pcb, [0, 0.03, -0.45]), rbox(0.2, 0.012, 0.18, 0.01, M.chrome, [0, 0.038, -0.45]));
          g.add(rbox(0.09, 0.01, 0.12, 0.005, M.black, [-0.17, 0.037, -0.45]), rbox(0.09, 0.01, 0.12, 0.005, M.black, [0.17, 0.037, -0.45]), rbox(0.16, 0.008, 0.06, 0.004, M.black, [0.36, 0.036, -0.5]), rbox(0.08, 0.008, 0.08, 0.004, M.black, [-0.36, 0.036, -0.4]));
          for (const fx of [-0.72, 0.72]) {
            g.add(cyl(0.13, 0.13, 0.03, M.darkMetal, [fx, 0.03, -0.42], [0, 0, 0], 36), cyl(0.035, 0.035, 0.034, M.black, [fx, 0.03, -0.42], [0, 0, 0], 20));
            for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; g.add(rbox(0.08, 0.026, 0.012, 0.003, M.chrome, [fx + Math.cos(a) * 0.075, 0.03, -0.42 + Math.sin(a) * 0.075], [0, -a + 0.5, 0])); }
            g.add(rbox(0.1, 0.03, 0.2, 0.01, M.darkMetal, [fx + Math.sign(fx) * 0.12, 0.03, -0.42]));   // fin stack at the vent
          }
          g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.62, 0.044, -0.38), V(-0.25, 0.046, -0.36), V(0, 0.046, -0.4), V(0.25, 0.046, -0.36), V(0.62, 0.044, -0.38)]), 40, 0.012, 8), M.gold));
          for (const bx of [-0.72, 0.72]) for (let k = 0; k < 3; k++) g.add(rbox(0.36, 0.03, 0.17, 0.01, M.darkMetal, [bx, 0.022, 0.02 + k * 0.2]));
          g.add(rbox(0.38, 0.03, 0.17, 0.01, M.darkMetal, [0, 0.022, 0.02]));
          for (const sx of [-0.92, 0.92]) g.add(rbox(0.08, 0.03, 0.5, 0.01, M.black, [sx, 0.026, -0.32]));
          g.add(rbox(0.3, 0.012, 0.08, 0.005, M.chrome, [0, 0.04, 0.36]));
          // the hinge and the lid: aluminium back, black glass front with thin bezels, the camera in its notch, the display
          g.add(cyl(0.03, 0.03, W * 0.78, M.darkMetal, [0, T, -Dp / 2 + 0.03], [0, 0, Math.PI / 2], 24));
          const lid = group(slab(W, Dp, 0.034, R, 0.008, M.alu, [0, Dp / 2, 0]),
            mesh(new THREE.ShapeGeometry(rrShape(W - 0.02, Dp - 0.02, R - 0.01), 12), blackGlass, [0, Dp / 2, 0.0175]),
            plane(W - 0.1, Dp - 0.12, screenMat(laptopScreen), [0, Dp / 2 - 0.02, 0.018]),
            rbox(0.2, 0.05, 0.004, 0.02, M.black, [0, Dp - 0.08, 0.0195]), cyl(0.012, 0.012, 0.004, M.chrome, [0, Dp - 0.075, 0.022], [Math.PI / 2, 0, 0], 16),
            rbox(W * 0.9, 0.012, 0.006, 0.003, M.black, [0, 0.03, 0.012]));   // the camera, the display flex at the hinge
          // inside the lid: the panel's backlight layer and its driver board
          lid.add(rbox(W - 0.14, Dp - 0.16, 0.006, 0.01, M.darkMetal, [0, Dp / 2 - 0.02, 0.006]), rbox(1.0, 0.06, 0.004, 0.005, M.pcb, [0, 0.1, 0.003]));
          lid.position.set(0, T, -Dp / 2 + 0.02); lid.rotation.x = -0.3;
          g.add(lid);
          return g;
        },
        router: () => {
          const g = group(rbox(1.5, 0.32, 1.0, 0.12, M.white, [0, 0.16, 0]));
          [-0.55, -0.18, 0.18, 0.55].forEach((x, k) => g.add(rbox(0.09, 1.0, 0.09, 0.04, M.black, [x, 0.75, -0.42], [0.08 * (k - 1.5), 0, -0.12 * (k - 1.5)])));
          [-0.4, -0.2, 0, 0.2, 0.4].forEach((x, k) => g.add(sph(0.025, glow(k === 2 ? '#2f7bff' : '#22d36b', 3), [x, 0.22, 0.5])));
          return g;
        },
        // AirPods Pro style (case 60.6 wide x 45.2 tall x 21.7 deep, 1 unit = 50 mm): the glossy white pebble open, its lid
        // tilted back on the hinge, and the two buds standing in their slots: an egg-shaped head with the silicone tip
        // facing out and the short stem going down into the case. No logo.
        earbuds: () => {
          const tip = new THREE.MeshPhysicalMaterial({ color: 0xe6e9ee, roughness: 0.8 });
          const bud = (side) => {
            const head = mesh(new THREE.SphereGeometry(0.2, 40, 28), M.white, [0, 0.16, 0]); head.scale.set(1, 0.85, 0.9);
            const b = group(head, mesh(new THREE.SphereGeometry(0.12, 32, 20), tip, [side * 0.14, 0.2, 0.08]),
              rbox(0.11, 0.48, 0.1, 0.05, M.white, [0, -0.12, 0]), mesh(new THREE.CircleGeometry(0.045, 24), M.black, [0, 0.24, -0.17], [0, Math.PI, 0]));
            b.rotation.z = -side * 0.12; return b;
          };
          const body = rbox(1.21, 0.62, 0.43, 0.2, M.white, [0, 0.31, 0]);
          const lid = group(rbox(1.21, 0.3, 0.43, 0.2, M.white, [0, 0.15, 0.215])); lid.position.set(0, 0.62, -0.215); lid.rotation.x = -1.9;
          const l = bud(-1), r = bud(1); l.position.set(-0.28, 0.72, 0.02); r.position.set(0.28, 0.72, 0.02);
          return group(body, lid, l, r, cyl(0.016, 0.016, 0.01, glow('#4dffb0', 2), [0, 0.42, 0.216], [Math.PI / 2, 0, 0]));
        },
        watch: () => group(rbox(0.42, 1.7, 0.06, 0.03, plastic(PAL.accent[3]), [0, 0.85, -0.02]), rbox(0.78, 0.9, 0.22, 0.2, M.titanium, [0, 0.85, 0.06]),
          rbox(0.7, 0.82, 0.02, 0.17, M.glass, [0, 0.85, 0.17]), plane(0.6, 0.72, screenMat(watchFace), [0, 0.85, 0.181]), cyl(0.06, 0.06, 0.1, M.chrome, [0.42, 1.0, 0.06], [0, 0, Math.PI / 2])),
        // 65" OLED style (1446 x 830 mm panel, 1 unit = 600 mm): a razor-thin glass panel with a deeper electronics box on
        // the lower back, thin bezels and a low centre pedestal.
        tv: () => group(slab(2.41, 1.385, 0.018, 0.012, 0.004, M.black, [0, 1.2, 0]), plane(2.38, 1.355, screenMat(tvScreen), [0, 1.2, 0.0095]),
          slab(1.9, 0.62, 0.07, 0.04, 0.01, M.darkMetal, [0, 0.86, -0.045]),
          slab(0.7, 0.36, 0.05, 0.03, 0.01, M.darkMetal, [0, 0.36, -0.09], [-0.1, 0, 0]), slab(0.86, 0.5, 0.03, 0.06, 0.008, M.darkMetal, [0, 0.015, -0.1], [-Math.PI / 2, 0, 0])),
        // a 42U data-centre rack (600 x 2000 x 1070 mm, 1 unit = 900 mm): steel frame and posts, the front full of 1U/2U
        // servers with drive bays and status lights (drawn on rackTex, which keeps its light in the glass look).
        server: () => {
          const g = group(rbox(0.67, 2.22, 1.19, 0.01, M.darkMetal, [0, 1.11, 0]));
          g.add(plane(0.6, 2.06, new THREE.MeshStandardMaterial({ map: rackTex, emissive: 0xffffff, emissiveMap: rackTex, emissiveIntensity: 0.5, roughness: 0.5 }), [0, 1.11, 0.6]));
          for (const x of [-0.31, 0.31]) g.add(rbox(0.03, 2.22, 0.03, 0.005, M.alu, [x, 1.11, 0.6]));   // front posts
          g.add(rbox(0.67, 0.06, 1.19, 0.01, M.darkMetal, [0, 2.22, 0]), rbox(0.7, 0.05, 1.22, 0.01, M.darkMetal, [0, 0.025, 0]));
          return g;
        },
        // a processor on its motherboard: the board's traces, the socket, the silver heat spreader with its chamfered
        // corner, capacitors and the power stages around it (boardTex keeps its light in the glass look).
        // a desktop processor on its motherboard, in real colours (13.11 pilot): green board with gold traces and white
        // silkscreen, the black socket and its steel retention frame, the silver heat spreader laser-etched with a made-up
        // brand (no real trademark), VRM chokes under a finned heatsink, solid capacitors, two DIMMs in their slots, an M.2
        // SSD and the chipset heatsink.
        chip: () => {
          const pcb = real('#0d6b35'), black = real('#16181c'), steel = real('#aab0b8'), silver = real('#b9bfc8'), grey = real('#5c636d'), fin = real('#3b414b'), gold = real('#c9962f');
          const g = group(slab(1.9, 1.9, 0.04, 0.03, 0.006, pcb, [0, 0.02, 0], [-Math.PI / 2, 0, 0]));
          g.add(plane(1.88, 1.88, ink(1024, 1024, (x, w, h) => {
            x.strokeStyle = 'rgba(214,170,70,0.45)'; x.lineWidth = 2.5;                                            // copper/gold traces
            for (let k = 0; k < 160; k++) { let px = hash(k) * w, py = hash(k + 50) * h; x.beginPath(); x.moveTo(px, py); for (let t = 0; t < 4; t++) { if ((k + t) % 2) px += (hash(k * 5 + t) - 0.5) * 300; else py += (hash(k * 7 + t) - 0.5) * 300; x.lineTo(px, py); } x.stroke(); }   // traces turn at right angles
            x.fillStyle = 'rgba(230,230,230,0.9)'; x.font = '600 22px Rubik';
            [['CPU1', 360, 300], ['DIMM_A1', 780, 160], ['DIMM_B1', 860, 160], ['VRM_12+2', 120, 120], ['M.2_1 (PCIe 5.0)', 300, 880], ['BIOS', 720, 900], ['CHA_FAN1', 40, 960]].forEach(([t, X, Y]) => x.fillText(t, X, Y));
            x.fillStyle = 'rgba(30,30,30,0.85)'; for (let k = 0; k < 260; k++) x.fillRect(hash(k + 900) * w, hash(k + 1300) * h, 5, 3);   // SMD parts
          }), [0, 0.042, 0], [-Math.PI / 2, 0, 0]));
          // socket, retention frame and lever
          g.add(slab(0.84, 0.84, 0.05, 0.02, 0.006, black, [-0.1, 0.065, 0.05], [-Math.PI / 2, 0, 0]));
          for (const [x, z, w, d] of [[-0.1, -0.38, 0.88, 0.04], [-0.1, 0.48, 0.88, 0.04], [-0.53, 0.05, 0.04, 0.9], [0.33, 0.05, 0.04, 0.9]]) g.add(rbox(w, 0.03, d, 0.008, steel, [x, 0.1, z]));
          g.add(cyl(0.012, 0.012, 0.86, steel, [0.38, 0.1, 0.05], [Math.PI / 2, 0, 0], 12));
          // the processor: substrate, heat spreader, etched markings
          g.add(slab(0.68, 0.68, 0.03, 0.02, 0.006, real('#11522c'), [-0.1, 0.105, 0.05], [-Math.PI / 2, 0, 0]));
          g.add(slab(0.56, 0.56, 0.05, 0.05, 0.012, silver, [-0.1, 0.145, 0.05], [-Math.PI / 2, 0, 0]));
          g.add(plane(0.5, 0.5, ink(512, 512, (x, w) => {
            x.fillStyle = '#2a2f38'; x.textAlign = 'center';
            x.font = '900 92px Rubik'; x.fillText('NEXA', w / 2, 150); x.font = '700 46px Rubik'; x.fillText('N9 · 7950', w / 2, 230);
            x.font = '500 30px Rubik'; x.fillText('3nm · 16C/32T · 5.7GHz', w / 2, 300); x.fillText('LOT 2611A · ENG SAMPLE', w / 2, 350);
            for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) if (hash(i * 13 + j * 7 + 3) > 0.5) x.fillRect(w / 2 - 48 + i * 8, 390 + j * 8, 8, 8);   // 2D code
          }), [-0.1, 0.171, 0.05], [-Math.PI / 2, 0, 0]));
          // VRM: chokes and power stages along two edges, under a finned heatsink
          for (let k = 0; k < 8; k++) g.add(rbox(0.09, 0.07, 0.09, 0.01, grey, [-0.66 + k * 0.11, 0.075, -0.6]), rbox(0.06, 0.02, 0.06, 0.006, black, [-0.66 + k * 0.11, 0.05, -0.49]));
          for (let k = 0; k < 6; k++) g.add(rbox(0.09, 0.07, 0.09, 0.01, grey, [-0.8, 0.075, -0.4 + k * 0.11]));
          g.add(rbox(0.92, 0.04, 0.16, 0.01, fin, [-0.28, 0.13, -0.6]));
          for (let k = 0; k < 10; k++) g.add(rbox(0.012, 0.09, 0.16, 0.003, fin, [-0.7 + k * 0.094, 0.195, -0.6]));
          for (let k = 0; k < 9; k++) g.add(cyl(0.028, 0.028, 0.08, gold, [-0.62 + k * 0.1, 0.08, -0.74], undefined, 20));   // solid caps
          // memory: four slots, two DIMMs standing in them (green boards, black DRAM chips, gold edge)
          for (let k = 0; k < 4; k++) {
            const x = 0.5 + k * 0.1;
            g.add(rbox(0.05, 0.05, 1.3, 0.008, k % 2 ? real('#2b2f36') : black, [x, 0.065, 0.0]));
            if (k % 2 === 0) {
              g.add(rbox(0.012, 0.32, 1.25, 0.004, real('#0c5a2e'), [x, 0.25, 0]), rbox(0.014, 0.03, 1.2, 0.002, gold, [x, 0.105, 0]));
              for (let j = 0; j < 8; j++) for (const sd of [-1, 1]) g.add(rbox(0.006, 0.09, 0.11, 0.002, black, [x + sd * 0.009, 0.26, -0.5 + j * 0.143]));
            }
          }
          // M.2 SSD with its controller, NAND and label; chipset heatsink
          g.add(slab(0.8, 0.22, 0.012, 0.01, 0.003, real('#0e1f4a'), [-0.15, 0.05, 0.75], [-Math.PI / 2, 0, 0]));
          g.add(rbox(0.12, 0.02, 0.12, 0.004, black, [-0.47, 0.065, 0.75]), rbox(0.16, 0.02, 0.14, 0.004, black, [-0.3, 0.065, 0.75]));
          g.add(plane(0.3, 0.12, ink(256, 100, (x, w) => { x.fillStyle = '#f2f2f2'; x.fillRect(0, 0, w, 100); x.fillStyle = '#000'; x.font = '700 30px Rubik'; x.fillText('2TB NVMe', 14, 44); x.font = '400 20px Rubik'; x.fillText('Gen5 x4', 14, 78); }), [0.02, 0.058, 0.75], [-Math.PI / 2, 0, 0]));
          g.add(rbox(0.36, 0.06, 0.36, 0.02, fin, [0.62, 0.07, 0.78]));
          for (let k = 0; k < 6; k++) g.add(rbox(0.36, 0.03, 0.012, 0.003, fin, [0.62, 0.11, 0.63 + k * 0.06]));
          g.rotation.x = 0.6; g.position.y = 0.7; return group(g);   // tilted up to the camera
        },
        tower: () => {
          const g = group(), steel = M.alu;
          for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; const leg = cyl(0.03, 0.03, 4.2, steel, [0.45 * Math.cos(a) * 0.6, 2.1, 0.45 * Math.sin(a) * 0.6], [0.11 * Math.sin(a), 0, -0.11 * Math.cos(a)], 8); g.add(leg); }
          for (let y = 0.4; y < 4; y += 0.5) g.add(mesh(new THREE.TorusGeometry(0.42 - y * 0.06, 0.012, 6, 4), steel, [0, y, 0], [Math.PI / 2, 0, Math.PI / 4]));
          [0, 1, 2].forEach(k => { const a = k * 2.1; g.add(rbox(0.16, 0.7, 0.08, 0.03, M.white, [0.28 * Math.cos(a), 3.8, 0.28 * Math.sin(a)], [0, -a + Math.PI / 2, 0])); });
          g.add(sph(0.05, glow('#ff3b30', 3), [0, 4.3, 0]));
          return g;
        },
        satellite: () => {
          const g = group(rbox(0.7, 0.7, 0.9, 0.05, M.gold, [0, 0, 0]), cyl(0.04, 0.04, 2.6, M.alu, [0, 0, 0], [0, 0, Math.PI / 2], 12),
            rbox(1.1, 0.02, 0.6, 0.01, new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.6, roughness: 0.3 }), [-1.0, 0, 0]),
            rbox(1.1, 0.02, 0.6, 0.01, new THREE.MeshStandardMaterial({ map: panelTex, metalness: 0.6, roughness: 0.3 }), [1.0, 0, 0]),
            mesh(new THREE.SphereGeometry(0.35, 32, 16, 0, Math.PI * 2, 0, 1.0), M.white, [0, -0.5, 0], [Math.PI, 0, 0]));
          g.position.y = 1.4; g.rotation.set(0.3, 0.4, 0.15); return group(g);
        },
        cloud: () => { const g = group(...[[0, 0, 0, 0.55], [-0.55, -0.12, 0, 0.4], [0.55, -0.1, 0.05, 0.42], [0.2, 0.3, -0.05, 0.4], [-0.25, 0.25, 0.05, 0.35]].map(([x, y, z, r]) => sph(r, M.white, [x, y, z]))); g.position.y = 1.2; return group(g); },
        // the Earth: a dark glass ball, the real continents (NASA land mask) glowing on it, a thin atmosphere and the
        // 23.4 degree tilt. No stand: it floats like the planets in the Grouper reels.
        globe: () => {
          const land = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: earthMask, transparent: true });
          land.userData.tint = '#4fbf5f';
          const e = group(sph(0.8, real('#1e4fa8'), [0, 0, 0]), mesh(new THREE.SphereGeometry(0.805, 64, 48), land), mesh(new THREE.SphereGeometry(0.86, 48, 32), RIM(PAL.accent[0])));
          e.rotation.z = 0.41; e.position.y = 1.0; return group(e);
        },
        lock: () => group(rbox(0.9, 0.75, 0.32, 0.1, real('#d9a52e'), [0, 0.4, 0]), mesh(new THREE.TorusGeometry(0.28, 0.06, 16, 32, Math.PI), M.chrome, [0, 0.78, 0]),
          cyl(0.06, 0.06, 0.2, M.chrome, [-0.28, 0.82, 0]), cyl(0.06, 0.06, 0.2, M.chrome, [0.28, 0.82, 0]), cyl(0.06, 0.06, 0.04, M.black, [0, 0.42, 0.165], [Math.PI / 2, 0, 0])),
        charger: () => group(cyl(0.6, 0.62, 0.08, M.white, [0, 0.04, 0], [0, 0, 0], 64), mesh(new THREE.TorusGeometry(0.42, 0.015, 8, 64), glow('#22d3ee', 3), [0, 0.082, 0], [Math.PI / 2, 0, 0]),
          rbox(0.08, 0.04, 0.6, 0.02, M.white, [0, 0.02, 0.85])),
        // a 330 ml drinks can (66 mm wide, 115 mm tall, 1 unit = 60 mm): the straight wall, the necked top and the rolled
        // rim, the lid with its pull tab, and the domed bottom. No brand.
        soda_can: () => {
          const pts = [[0, 0], [0.42, 0.02], [0.52, 0.1], [0.55, 0.2], [0.55, 1.72], [0.5, 1.84], [0.45, 1.9], [0.46, 1.92], [0.44, 1.93], [0, 1.9]].map(([x, y]) => new THREE.Vector2(x, y));
          const label = tex(1024, 512, (x, w, h) => {
            x.fillStyle = '#c8102e'; x.fillRect(0, 0, w, h); x.fillStyle = '#ffffff'; x.font = '900 150px Rubik'; x.textAlign = 'center'; x.fillText('FIZZ', w / 2, 270);
            x.font = '600 44px Rubik'; x.fillText('ORIGINAL · 330 ml', w / 2, 360); x.fillStyle = 'rgba(120,10,25,0.9)'; x.fillRect(0, 60, w, 8); x.fillRect(0, h - 68, w, 8);
          });
          const can = mesh(new THREE.LatheGeometry(pts, 64), M.alu);
          const wrap = mesh(new THREE.CylinderGeometry(0.556, 0.556, 1.4, 64, 1, true), Object.assign(new THREE.MeshBasicMaterial({ map: label }), { userData: { decal: true } }), [0, 0.95, 0], [0, Math.PI, 0]);   // the brand faces the camera
          return group(can, wrap, rbox(0.22, 0.012, 0.36, 0.05, M.chrome, [0, 1.925, 0.08]), cyl(0.06, 0.06, 0.01, M.darkMetal, [0, 1.92, -0.18]));
        },
        // a shipping box (40 x 30 x 30 cm, 1 unit = 25 cm): cardboard walls, the top flaps' seam and the tape across it.
        cardboard_box: () => {
          const card = real('#b98a55'), tape = real('#e0c48f');
          return group(rbox(1.6, 1.2, 1.2, 0.02, card, [0, 0.6, 0]), rbox(1.62, 0.006, 0.01, 0.002, M.black, [0, 1.201, 0]),
            rbox(0.24, 0.008, 1.22, 0.003, tape, [0, 1.204, 0]), rbox(0.24, 0.5, 0.008, 0.003, tape, [0, 0.95, 0.604]), rbox(0.24, 0.5, 0.008, 0.003, tape, [0, 0.95, -0.604]));
        },
        // Xbox Series style (153 x 104 x 61 mm, 1 unit = 100 mm) in carbon black: a slim pebble body with grips curving down,
        // the left stick high and the hybrid D-pad low on the left, the coloured face buttons high and the right stick low
        // on the right, the lit guide button, view / share / menu, textured bumpers and triggers. No logos or letters.
        controller: () => {
          const s = new THREE.Shape();
          s.moveTo(0, 0.42);
          s.bezierCurveTo(0.3, 0.45, 0.6, 0.45, 0.72, 0.3);
          s.bezierCurveTo(0.82, 0.17, 0.84, -0.06, 0.8, -0.3);
          s.bezierCurveTo(0.76, -0.52, 0.64, -0.64, 0.5, -0.6);
          s.bezierCurveTo(0.4, -0.57, 0.34, -0.42, 0.26, -0.32);
          s.bezierCurveTo(0.16, -0.22, -0.16, -0.22, -0.26, -0.32);
          s.bezierCurveTo(-0.34, -0.42, -0.4, -0.57, -0.5, -0.6);
          s.bezierCurveTo(-0.64, -0.64, -0.76, -0.52, -0.8, -0.3);
          s.bezierCurveTo(-0.84, -0.06, -0.82, 0.17, -0.72, 0.3);
          s.bezierCurveTo(-0.6, 0.45, -0.3, 0.45, 0, 0.42);
          const geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.055, bevelSize: 0.06, bevelSegments: 6, curveSegments: 28 });
          geo.translate(0, 0, -0.04);
          const body = real('#1d1e22', false, { rough: 0.55 }), grip = real('#121316', false, { rough: 0.9 }), dk = real('#0d0e10', false, { rough: 0.35, coat: 0.6 }), grey = real('#3a3c42', false, { rough: 0.4 }), Z = 0.095;
          const g = group(mesh(geo, body));
          // textured grips on the back of each handle
          for (const sx of [-1, 1]) for (let k = 0; k < 9; k++) g.add(rbox(0.012, 0.22, 0.012, 0.004, grip, [sx * (0.56 + k * 0.022), -0.36 + k * 0.012, -0.075], [0, 0, sx * 0.3]));
          const stick = (x, y) => g.add(cyl(0.1, 0.1, 0.012, dk, [x, y, Z], [Math.PI / 2, 0, 0], 40), cyl(0.04, 0.05, 0.05, grey, [x, y, Z + 0.03], [Math.PI / 2, 0, 0], 20),
            cyl(0.078, 0.074, 0.022, grey, [x, y, Z + 0.062], [Math.PI / 2, 0, 0], 40), mesh(new THREE.TorusGeometry(0.07, 0.01, 8, 40), dk, [x, y, Z + 0.075]));
          stick(-0.45, 0.16); stick(0.2, -0.1);
          // the hybrid D-pad: a faceted disc with the cross on it
          g.add(cyl(0.095, 0.095, 0.014, dk, [-0.2, -0.1, Z + 0.004], [Math.PI / 2, 0, 0], 16), rbox(0.16, 0.05, 0.022, 0.012, grey, [-0.2, -0.1, Z + 0.014]), rbox(0.05, 0.16, 0.022, 0.012, grey, [-0.2, -0.1, Z + 0.014]));
          // A green (bottom), B red (right), X blue (left), Y yellow (top): the colours the buttons are known by
          for (const [dx, dy, c] of [[0, -1, '#3fb83f'], [1, 0, '#e2312d'], [-1, 0, '#2d6fd6'], [0, 1, '#f2c21b']]) {
            g.add(cyl(0.042, 0.042, 0.028, real(c, false, { rough: 0.15, coat: 1 }), [0.46 + dx * 0.088, 0.16 + dy * 0.088, Z + 0.012], [Math.PI / 2, 0, 0], 28));
            g.add(cyl(0.05, 0.05, 0.008, dk, [0.46 + dx * 0.088, 0.16 + dy * 0.088, Z], [Math.PI / 2, 0, 0], 28));
          }
          // guide button glowing white, view and menu either side, share below
          g.add(cyl(0.068, 0.068, 0.02, dk, [0, 0.3, Z], [Math.PI / 2, 0, 0], 40), cyl(0.05, 0.05, 0.022, glow('#ffffff', 1.3), [0, 0.3, Z + 0.004], [Math.PI / 2, 0, 0], 40));
          g.add(cyl(0.026, 0.026, 0.016, grey, [-0.13, 0.15, Z], [Math.PI / 2, 0, 0], 20), cyl(0.026, 0.026, 0.016, grey, [0.13, 0.15, Z], [Math.PI / 2, 0, 0], 20), rbox(0.055, 0.028, 0.016, 0.012, grey, [0, 0.1, Z]));
          // bumpers along the top edge and the triggers behind them, the USB-C port and pairing button between them
          for (const sx of [-1, 1]) {
            g.add(rbox(0.42, 0.05, 0.12, 0.022, dk, [sx * 0.45, 0.405, 0.0], [0, 0, -sx * 0.22]));
            g.add(rbox(0.18, 0.13, 0.1, 0.035, grey, [sx * 0.48, 0.42, -0.1], [-0.4, 0, -sx * 0.2]));
            for (let k = 0; k < 5; k++) g.add(rbox(0.16, 0.006, 0.006, 0.002, dk, [sx * 0.48, 0.38 + k * 0.022, -0.05 - k * 0.012], [-0.4, 0, -sx * 0.2]));   // trigger grip lines
          }
          g.add(rbox(0.06, 0.02, 0.025, 0.008, dk, [0, 0.43, 0]), rbox(0.035, 0.018, 0.018, 0.007, grey, [0.1, 0.43, -0.02]));
          g.add(rbox(0.36, 0.22, 0.012, 0.04, grip, [0, -0.06, -0.1]));   // battery door
          g.rotation.x = -0.95; g.position.y = 0.42; return group(g);
        },
        // DualSense style (160 x 106 x 66 mm, 1 unit = 100 mm): a white two-tone shell, the black centre with both sticks
        // side by side, the white touchpad with the blue light bar, the D-pad and four face buttons, the PS-style home and
        // mic buttons. No logos and no button symbols.
        controller_ps: () => {
          const s = new THREE.Shape();
          s.moveTo(-0.32, 0.42); s.lineTo(0.32, 0.42);
          s.bezierCurveTo(0.6, 0.44, 0.78, 0.36, 0.8, 0.12);
          s.bezierCurveTo(0.84, -0.18, 0.82, -0.52, 0.66, -0.64);
          s.bezierCurveTo(0.54, -0.72, 0.42, -0.62, 0.36, -0.42);
          s.bezierCurveTo(0.3, -0.24, 0.16, -0.2, 0, -0.2);
          s.bezierCurveTo(-0.16, -0.2, -0.3, -0.24, -0.36, -0.42);
          s.bezierCurveTo(-0.42, -0.62, -0.54, -0.72, -0.66, -0.64);
          s.bezierCurveTo(-0.82, -0.52, -0.84, -0.18, -0.8, 0.12);
          s.bezierCurveTo(-0.78, 0.36, -0.6, 0.44, -0.32, 0.42);
          const geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.055, bevelSize: 0.06, bevelSegments: 6, curveSegments: 28 });
          geo.translate(0, 0, -0.04);
          const white = real('#c9ccd2', false, { rough: 0.55, coat: 0.2 }), black = real('#17181c', false, { rough: 0.5 }), grey = real('#2c2e33', false, { rough: 0.3, coat: 0.6 }), Z = 0.095;
          const g = group(mesh(geo, white));
          // the black centre: a moulded panel under the touchpad holding the sticks
          const c = new THREE.Shape(); c.moveTo(-0.42, 0.1); c.lineTo(0.42, 0.1); c.bezierCurveTo(0.44, -0.12, 0.3, -0.26, 0, -0.26); c.bezierCurveTo(-0.3, -0.26, -0.44, -0.12, -0.42, 0.1);
          g.add(mesh(new THREE.ExtrudeGeometry(c, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.012, bevelSegments: 2 }), black, [0, -0.02, Z - 0.004]));
          g.add(slab(0.56, 0.3, 0.03, 0.06, 0.01, white, [0, 0.22, Z + 0.005]), rbox(0.5, 0.012, 0.01, 0.004, real('#e2e3e6'), [0, 0.07, Z + 0.006]));   // touchpad and its seam
          g.add(slab(0.5, 0.025, 0.012, 0.012, 0.004, glow('#2f7dff', 1.8), [0, 0.055, Z + 0.004]));                                                      // light bar
          for (const x of [-0.24, 0.24]) g.add(cyl(0.09, 0.09, 0.012, grey, [x, -0.14, Z + 0.01], [Math.PI / 2, 0, 0], 36), cyl(0.04, 0.05, 0.05, grey, [x, -0.14, Z + 0.035], [Math.PI / 2, 0, 0], 20),
            cyl(0.075, 0.072, 0.022, black, [x, -0.14, Z + 0.065], [Math.PI / 2, 0, 0], 36), mesh(new THREE.TorusGeometry(0.066, 0.009, 8, 36), grey, [x, -0.14, Z + 0.077]));
          for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            g.add(rbox(0.068, 0.068, 0.022, 0.016, grey, [-0.52 + dx * 0.075, 0.12 + dy * 0.075, Z + 0.006], [0, 0, Math.PI / 4]));
            g.add(cyl(0.04, 0.04, 0.026, grey, [0.52 + dx * 0.085, 0.12 + dy * 0.085, Z + 0.008], [Math.PI / 2, 0, 0], 28));
          }
          g.add(cyl(0.03, 0.03, 0.018, black, [0, -0.08, Z + 0.012], [Math.PI / 2, 0, 0], 24), rbox(0.08, 0.018, 0.012, 0.008, glow('#ff7a3d', 1.1), [0, -0.15, Z + 0.012]));   // home, mic
          g.add(rbox(0.035, 0.06, 0.016, 0.01, black, [-0.36, 0.33, Z - 0.01]), rbox(0.035, 0.06, 0.016, 0.01, black, [0.36, 0.33, Z - 0.01]));                     // create, options
          for (const sx of [-1, 1]) g.add(rbox(0.34, 0.05, 0.12, 0.022, black, [sx * 0.5, 0.42, 0.0], [0, 0, -sx * 0.15]), rbox(0.2, 0.13, 0.1, 0.035, black, [sx * 0.52, 0.42, -0.1], [-0.4, 0, -sx * 0.15]));
          for (let k = 0; k < 16; k++) g.add(rbox(0.008, 0.008, 0.004, 0.002, grey, [-0.04 + (k % 4) * 0.027, -0.6 + 0.4 + Math.floor(k / 4) * 0.02, Z - 0.02]));   // speaker holes
          g.rotation.x = -0.95; g.position.y = 0.42; return group(g);
        },
        // PS5 style console standing up (390 x 104 x 260 mm, 1 unit = 200 mm): a gloss black core between two tall matte
        // white wings that flare out at the top, blue light strips where they meet, the disc slot, buttons and ports on the
        // front, vents along the top and back, the round stand. No logos.
        console_ps: () => {
          const core = real('#0f1013', false, { rough: 0.12, coat: 1 }), wing = real('#f4f5f7', false, { rough: 0.5, coat: 0.3 }), dark = real('#25272c', false, { rough: 0.6 });
          const blue = glow('#2f7dff', 1.8), g = group(rbox(0.32, 1.76, 1.06, 0.05, core, [0, 0.98, 0]));
          const w = new THREE.Shape();
          w.moveTo(-0.52, 0.08); w.lineTo(0.48, 0.08);
          w.bezierCurveTo(0.56, 0.7, 0.58, 1.4, 0.72, 1.98);
          w.bezierCurveTo(0.3, 2.0, -0.3, 2.0, -0.62, 1.96);
          w.bezierCurveTo(-0.6, 1.4, -0.56, 0.6, -0.52, 0.08);
          for (const sx of [-1, 1]) {
            const geo = new THREE.ExtrudeGeometry(w, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 24 });
            geo.rotateY(-Math.PI / 2); g.add(mesh(geo, wing, [sx * 0.2 + (sx > 0 ? 0.05 : 0), 0, 0]));
            g.add(rbox(0.014, 1.55, 0.014, 0.005, blue, [sx * 0.168, 1.0, 0.535]), rbox(0.014, 0.014, 1.0, 0.005, blue, [sx * 0.168, 1.865, 0.03]));
            // the fine dot pattern on the inside of each wing, seen through the gap
            for (let k = 0; k < 18; k++) g.add(rbox(0.006, 0.012, 0.012, 0.003, dark, [sx * 0.19, 0.3 + (k % 6) * 0.25, -0.3 + Math.floor(k / 6) * 0.3]));
          }
          // front: the disc slot with its chrome lip, eject and power buttons, USB-A and USB-C
          g.add(rbox(0.26, 0.03, 0.012, 0.008, dark, [0, 0.42, 0.535]), rbox(0.24, 0.006, 0.006, 0.002, M.chrome, [0, 0.405, 0.542]));
          g.add(rbox(0.06, 0.02, 0.012, 0.006, M.chrome, [-0.06, 0.62, 0.536]), rbox(0.06, 0.02, 0.012, 0.006, M.chrome, [0.06, 0.62, 0.536]));
          g.add(rbox(0.08, 0.035, 0.014, 0.004, dark, [-0.06, 0.78, 0.536]), rbox(0.045, 0.02, 0.014, 0.008, dark, [0.07, 0.78, 0.536]));
          for (let k = 0; k < 14; k++) g.add(rbox(0.26, 0.01, 0.04, 0.003, dark, [0, 1.866, -0.45 + k * 0.065]));            // top vent
          for (let k = 0; k < 12; k++) g.add(rbox(0.24, 0.035, 0.012, 0.003, dark, [0, 1.1 + k * 0.06, -0.535]));            // back vent
          for (let k = 0; k < 4; k++) g.add(rbox(0.06, 0.03, 0.014, 0.004, dark, [-0.08 + (k % 2) * 0.16, 0.4 + Math.floor(k / 2) * 0.08, -0.536]));   // HDMI, LAN, USB, power
          g.add(cyl(0.3, 0.32, 0.05, core, [0, 0.025, 0], [0, 0, 0], 48), cyl(0.06, 0.06, 0.08, dark, [0, 0.08, 0], [0, 0, 0], 20));
          g.rotation.y = 1.05;   // the wing side towards the camera, the front still in view
          return group(g);
        },
        // Xbox Series X style (151 x 301 x 151 mm, 1 unit = 200 mm): a matte black monolith on a small foot, the dished top
        // vent full of holes glowing green from inside, the lit power button, disc slot, USB port and pairing button on the
        // front, the big rear vent and ports. No logos.
        console_xbox: () => {
          const S = 0.755, H = 1.505, body = real('#26282c', false, { rough: 0.8 }), dish = real('#0d0e10', false, { rough: 0.6 }), dark = real('#2b2d32', false, { rough: 0.5 });
          const g = group(rbox(S, H - 0.06, S, 0.035, body, [0, 0.06 + (H - 0.06) / 2, 0]), rbox(S - 0.16, 0.06, S - 0.16, 0.02, dish, [0, 0.03, 0]));
          g.add(rbox(S + 0.004, 0.006, S + 0.004, 0.003, dark, [0, H - 0.12, 0]));   // the seam under the top
          g.add(mesh(new THREE.TorusGeometry(0.32, 0.025, 10, 64), dish, [0, H - 0.005, 0], [Math.PI / 2, 0, 0]), cyl(0.31, 0.31, 0.008, dish, [0, H + 0.004, 0], [0, 0, 0], 64));
          const xg = glow('#3cd070', 1.8); for (let r = 0.035; r < 0.3; r += 0.026) { const n = Math.max(6, Math.round(r * 62)); for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2 + r * 7; g.add(cyl(0.012, 0.012, 0.004, xg, [Math.cos(a) * r, H + 0.008, Math.sin(a) * r], [0, 0, 0], 6)); } }
          g.add(cyl(0.034, 0.034, 0.012, dark, [-0.27, H - 0.16, S / 2 + 0.003], [Math.PI / 2, 0, 0], 28), cyl(0.024, 0.024, 0.014, glow('#ffffff', 1.4), [-0.27, H - 0.16, S / 2 + 0.004], [Math.PI / 2, 0, 0], 28));   // power
          g.add(rbox(0.014, 0.62, 0.012, 0.005, dish, [-0.27, H - 0.66, S / 2 + 0.003]), rbox(0.04, 0.025, 0.012, 0.006, dark, [-0.27, H - 1.04, S / 2 + 0.003]));   // disc slot, eject
          g.add(rbox(0.07, 0.035, 0.014, 0.004, dish, [0.24, 0.24, S / 2 + 0.003]), cyl(0.018, 0.018, 0.012, dark, [0.3, 0.34, S / 2 + 0.003], [Math.PI / 2, 0, 0], 16));
          for (let k = 0; k < 6; k++) g.add(rbox(0.07, 0.032, 0.014, 0.004, dish, [-0.22 + k * 0.088, 0.3, -S / 2 - 0.003]));   // ports
          g.add(cyl(0.24, 0.24, 0.014, dish, [0, H - 0.45, -S / 2 - 0.003], [Math.PI / 2, 0, 0], 48));
          for (let k = 0; k < 7; k++) g.add(rbox(0.4, 0.012, 0.016, 0.004, body, [0, H - 0.63 + k * 0.06, -S / 2 - 0.006]));   // rear vent bars
          g.rotation.x = 0.18; g.position.z = -0.12; g.position.y = 0.07;   // tipped towards the camera so the green top shows
          return group(g);
        },
        // a gaming PC (450 x 470 x 220 mm mid tower, 1 unit = 240 mm), the glass side facing you: frame, motherboard with
        // CPU cooler, RAM and M.2 drive, a long three-fan graphics card, PSU under its shroud, three front fans and a rear
        // fan with light rings, the cables, front buttons and ports, the expansion slots on the back. No logos.
        pc_tower: () => {
          const L = 1.96, H = 1.88, D = 0.92, x0 = -L / 2, g = group();
          const bar = (w, h, d, at) => g.add(rbox(w, h, d, 0.01, M.darkMetal, at));
          for (const y of [0.04, H - 0.02]) for (const z of [-D / 2, D / 2]) bar(L, 0.04, 0.04, [0, y, z]);
          for (const x of [x0, -x0]) for (const z of [-D / 2, D / 2]) bar(0.04, H, 0.04, [x, H / 2, z]);
          for (const x of [x0, -x0]) for (const y of [0.04, H - 0.02]) bar(0.04, 0.04, D, [x, y, 0]);
          g.add(rbox(L, H, 0.012, 0.01, M.darkMetal, [0, H / 2, -D / 2]), rbox(L - 0.06, H - 0.06, 0.01, 0.01, M.glass, [0, H / 2, D / 2 + 0.01]));
          g.add(rbox(0.012, H, D, 0.01, M.glass, [-x0 + 0.02, H / 2, 0]), rbox(L, 0.012, D, 0.01, M.glass, [0, H, 0]));
          const fan = (at, axis, r = 0.2, ring = true) => {
            const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
            g.add(cyl(r * 0.28, r * 0.28, 0.05, M.black, at, rot, 20));
            for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, b = rbox(r * 0.7, 0.008, r * 0.32, 0.004, M.chrome, [0, 0, 0]);
              const p = new THREE.Group(); p.position.set(...at); p.rotation.set(...rot); b.position.set(Math.cos(a) * r * 0.55, 0, Math.sin(a) * r * 0.55); b.rotation.set(0.35, -a, 0); p.add(b); g.add(p); }
            if (ring) { const t = mesh(new THREE.TorusGeometry(r, 0.012, 8, 48), glow(PAL.accent[1], 1.5), at); t.rotation.set(...(axis === 'x' ? [0, Math.PI / 2, 0] : axis === 'z' ? [0, 0, 0] : [Math.PI / 2, 0, 0])); g.add(t); }
          };
          for (const y of [0.62, 1.06, 1.5]) fan([-x0 - 0.06, y, 0], 'x');
          fan([x0 + 0.06, 1.5, -0.05], 'x');
          // the motherboard and what sits on it
          g.add(rbox(1.1, 1.3, 0.02, 0.01, real('#1d2026', false, { rough: 0.5 }), [-0.3, 1.18, -D / 2 + 0.06]));
          g.add(rbox(0.4, 0.1, 0.08, 0.02, M.alu, [-0.35, 1.72, -D / 2 + 0.1]), rbox(0.1, 0.35, 0.08, 0.02, M.alu, [-0.62, 1.45, -D / 2 + 0.1]), rbox(0.22, 0.22, 0.04, 0.02, M.alu, [-0.1, 0.65, -D / 2 + 0.09]));   // VRM and chipset heat sinks
          g.add(rbox(0.04, 0.22, 0.05, 0.01, M.black, [0.21, 1.3, -D / 2 + 0.09]));   // 24-pin power plug
          for (const x of [-0.35, 0.15]) fan([x, H - 0.06, -0.05], 'y', 0.2);   // two exhaust fans in the roof
          g.add(rbox(0.16, 0.16, 0.03, 0.01, M.chrome, [-0.35, 1.45, -D / 2 + 0.09]));
          const fins = group(); for (let k = 0; k < 16; k++) fins.add(rbox(0.32, 0.5, 0.006, 0.002, M.chrome, [0, 0, -0.15 + k * 0.02])); fins.position.set(-0.35, 1.45, -0.1); g.add(fins);
          for (let k = 0; k < 4; k++) g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.42 + k * 0.05, 1.4, -D / 2 + 0.1), V(-0.42 + k * 0.05, 1.5, -0.3), V(-0.42 + k * 0.05, 1.68, -0.15)]), 12, 0.012, 6), M.gold));
          fan([-0.12, 1.45, -0.1], 'x', 0.22, false);
          for (let k = 0; k < 4; k++) g.add(rbox(0.025, 0.62, 0.14, 0.006, M.darkMetal, [0.0 + k * 0.05, 1.45, -D / 2 + 0.14]), rbox(0.026, 0.62, 0.02, 0.004, glow(PAL.accent[0], 1.3), [0.0 + k * 0.05, 1.45, -D / 2 + 0.22]));
          g.add(rbox(0.3, 0.012, 0.08, 0.004, M.black, [-0.45, 1.05, -D / 2 + 0.08]));   // M.2 drive
          g.add(rbox(0.2, 0.3, 0.06, 0.01, M.darkMetal, [-0.8, 1.6, -D / 2 + 0.08]));    // the I/O cover
          // the graphics card: shroud, three fans underneath, backplate, bracket
          g.add(rbox(1.2, 0.14, 0.4, 0.03, M.darkMetal, [-0.18, 0.86, -0.15]), rbox(1.2, 0.012, 0.4, 0.01, M.black, [-0.18, 0.94, -0.15]));
          for (const x of [-0.6, -0.18, 0.24]) fan([x, 0.78, -0.15], 'y', 0.17, false);
          g.add(rbox(0.02, 0.2, 0.42, 0.005, M.chrome, [x0 + 0.05, 0.86, -0.15]));
          for (let k = 0; k < 7; k++) g.add(rbox(0.012, 0.05, 0.4, 0.003, M.darkMetal, [x0 + 0.03, 0.55 + k * 0.08, -0.15]));
          // the shroud with the power supply under it, cables up to the board and the card, drive cage, feet
          g.add(rbox(L - 0.08, 0.36, D - 0.06, 0.02, M.darkMetal, [0, 0.22, 0]), rbox(0.6, 0.3, 0.6, 0.02, M.black, [-0.6, 0.2, -0.05]));
          g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.4, 0.4, 0.1), V(0.3, 0.6, 0.2), V(0.32, 1.2, -0.3)]), 24, 0.035, 8), M.black));
          g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.3, 0.4, 0.15), V(0.2, 0.75, 0.1), V(0.3, 0.9, -0.05)]), 24, 0.025, 8), M.black));
          g.add(rbox(0.3, 0.25, 0.5, 0.02, M.darkMetal, [0.6, 0.2, 0]));
          for (const [x, z] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) g.add(cyl(0.05, 0.05, 0.04, M.black, [x, -0.02, z], [0, 0, 0], 16));
          g.add(cyl(0.03, 0.03, 0.02, M.white, [-x0 - 0.1, H + 0.01, 0.2], [0, 0, 0], 20), rbox(0.06, 0.01, 0.03, 0.004, M.black, [-x0 - 0.1, H + 0.005, 0.05]), rbox(0.06, 0.01, 0.03, 0.004, M.black, [-x0 - 0.1, H + 0.005, -0.05]));
          g.add(rbox(L * 0.9, 0.012, 0.012, 0.004, glow(PAL.accent[1], 1.3), [0, H - 0.08, D / 2 - 0.04]));   // light strip under the top
          return group(g);
        },
        car: () => hero(sedan()),
        police_car: () => {
          const g = sedan();
          g.add(rbox(0.12, 0.03, 0.52, 0.01, M.black, [-0.12, 0.615, 0]), rbox(0.1, 0.03, 0.22, 0.01, glow(TAIL, 2.5), [-0.12, 0.64, 0.125]), rbox(0.1, 0.03, 0.22, 0.01, glow('#4d7bff', 2.5), [-0.12, 0.64, -0.125]),
            rbox(0.03, 0.17, 0.5, 0.01, M.black, [1.0, 0.19, 0]), cyl(0.004, 0.004, 0.3, M.black, [-0.82, 0.55, 0.2]));
          return hero(g);
        },
        // a rear-engined sports coupe (4519 x 1852 x 1298 mm, 1 unit = 2.3 m): long sloping roofline, oval lamps, big wheels, a
        // ducktail spoiler. No logos.
        sports_car: () => {
          const R = 0.152, paint = carPaint('#c81e1e');
          const g = group(
            extrudeZ(prof([[-0.90, 0.09], ['a', -0.515, R, 0.225, 0.09], ['a', 0.55, R, 0.225, 0.09], [0.90, 0.09], ['q', 0.94, 0.10, 0.94, 0.17], ['q', 0.93, 0.23, 0.85, 0.25],
              ['q', 0.55, 0.30, 0.25, 0.34], [-0.35, 0.35], ['q', -0.80, 0.33, -0.92, 0.24], ['q', -0.945, 0.15, -0.90, 0.09]]), 0.80, 0.05, paint),
            extrudeZ(prof([[0.27, 0.32], ['q', 0.10, 0.46, -0.05, 0.49], ['q', -0.25, 0.51, -0.42, 0.46], ['q', -0.70, 0.36, -0.86, 0.27], [-0.40, 0.30]]), 0.62, 0.05, M.tint),
            rbox(0.08, 0.012, 0.66, 0.004, paint, [-0.9, 0.335, 0], [0, 0, 0.25]), rbox(0.02, 0.025, 0.7, 0.01, glow(TAIL, 2), [-0.94, 0.27, 0]),
            rbox(0.02, 0.05, 0.5, 0.01, M.black, [0.94, 0.13, 0]));
          for (const s of [1, -1]) {
            g.add(sideFlat([[0.22, 0.36], ['q', 0.09, 0.45, -0.05, 0.46], ['q', -0.25, 0.47, -0.40, 0.43], ['q', -0.52, 0.38, -0.56, 0.36]], s * 0.312, M.lens));
            g.add(seam(0.26, 0.22, 0.22, s * 0.401), seam(-0.24, 0.22, 0.22, s * 0.401), rbox(0.12, 0.05, 0.01, 0.005, M.black, [-0.33, 0.25, s * 0.401]));
            const lamp = mesh(new THREE.SphereGeometry(0.06, 24, 16), glow(LAMP, 2.2), [0.86, 0.26, s * 0.27]); lamp.scale.set(0.6, 0.8, 1); g.add(lamp);
            g.add(rbox(0.05, 0.035, 0.07, 0.012, M.black, [0.2, 0.37, s * 0.41]), wheel(R, 0.1, [0.55, R, s * 0.34]), wheel(R, 0.11, [-0.515, R, s * 0.34]));
          }
          interior(g, { seatY: 0.27, front: -0.02, steer: [0.15, 0.37], dash: [0.24, 0.34], width: 0.6, seat: '#1f2126' });
          return hero(g);
        },
        // a full-size crew-cab pickup (5890 x 2030 x 1960 mm, 1 unit = 2.95 m): tall square nose, big grille, an open bed with
        // the wheel wells inside it, 33-inch tyres. No logos.
        pickup_truck: () => {
          const R = 0.142, paint = carPaint('#5b6573');
          const g = group(
            extrudeZ(prof([[-0.95, 0.16], ['a', -0.57, R, 0.185, 0.16], ['a', 0.68, R, 0.185, 0.16], [0.955, 0.16], [0.955, 0.43], ['q', 0.70, 0.445, 0.40, 0.445], [-0.27, 0.445], [-0.27, 0.35], [-0.95, 0.35]]), 0.69, 0.02, paint),
            extrudeZ(prof([[0.40, 0.42], [0.21, 0.635], [-0.25, 0.64], [-0.25, 0.42]]), 0.66, 0.03, M.tint),
            rbox(0.03, 0.12, 0.69, 0.01, paint, [-0.955, 0.42, 0]),
            rbox(0.02, 0.2, 0.56, 0.01, M.darkMetal, [0.98, 0.33, 0]), rbox(0.05, 0.07, 0.72, 0.02, M.chrome, [0.985, 0.19, 0]), rbox(0.05, 0.06, 0.7, 0.02, M.chrome, [-0.975, 0.2, 0]));
          for (const y of [0.27, 0.33, 0.39]) g.add(rbox(0.012, 0.012, 0.54, 0.004, M.chrome, [0.992, y, 0]));
          for (const s of [1, -1]) {
            g.add(rbox(0.66, 0.12, 0.03, 0.01, paint, [-0.62, 0.42, s * 0.33]), rbox(0.37, 0.05, 0.12, 0.02, paint, [-0.57, 0.39, s * 0.26]));   // bed walls, wheel wells
            g.add(sideFlat([[0.34, 0.47], [0.21, 0.61], [0.0, 0.61], [0.0, 0.47]], s * 0.331, M.lens), sideFlat([[-0.03, 0.47], [-0.03, 0.61], [-0.22, 0.61], [-0.22, 0.47]], s * 0.331, M.lens));
            for (const x of [0.40, 0.0, -0.27]) g.add(seam(x, 0.3, 0.24, s * 0.346));
            g.add(rbox(0.02, 0.05, 0.1, 0.01, glow(LAMP, 2.5), [0.985, 0.40, s * 0.27]), rbox(0.02, 0.1, 0.03, 0.008, glow(TAIL, 2), [-0.975, 0.41, s * 0.32]),
              rbox(0.05, 0.07, 0.06, 0.015, M.black, [0.33, 0.5, s * 0.38]), wheel(R, 0.1, [0.68, R, s * 0.30], 6), wheel(R, 0.1, [-0.57, R, s * 0.30], 6));
          }
          interior(g, { seatY: 0.45, front: 0.12, rear: -0.17, steer: [0.3, 0.54], dash: [0.36, 0.5], width: 0.6, seat: '#4a4f57' });
          return hero(g);
        },
        // a cab-over box truck (6600 x 2300 x 3400 mm, 1 unit = 3.4 m) in real colours, see-through (13.11 pilot): white
        // cab and box as clear shells, and inside them everything a real one has: seats, dash and steering wheel, the
        // diesel under the cab with its radiator, battery and exhaust, the ladder frame, driveshaft and rear axle, a fuel
        // tank, and the cargo: pallets of taped cartons on a wooden floor behind a roll-up door. No logos.
        delivery_truck: () => {
          const R = 0.118, white = real('#eef1f4', true), win = real('#a9cfee', true), charcoal = real('#2b2f36'), black = real('#17191d'), steel = real('#9aa1ab'),
            engine = real('#6b7280'), red = real('#b3261e'), wood = real('#a87b4f'), carton = real('#b9895a'), tyre = real('#1b1d21'), rim = real('#c3c8cf');
          const wm = [tyre, rim, steel, rim];
          const g = group(
            extrudeZ(prof([[0.42, 0.17], ['a', 0.62, R, 0.155, 0.17], [0.935, 0.17], [0.94, 0.40], ['q', 0.945, 0.44, 0.925, 0.46], [0.895, 0.655], ['q', 0.885, 0.685, 0.85, 0.685], [0.44, 0.685]]), 0.66, 0.03, white),
            extrudeZ(prof([[0.44, 0.71], [0.80, 0.71], [0.44, 0.90]]), 0.6, 0.01, white),
            rbox(1.30, 0.75, 0.68, 0.015, white, [-0.30, 0.625, 0]),
            rbox(0.01, 0.18, 0.56, 0.01, win, [0.942, 0.56, 0], [0, 0, 0.15]),
            rbox(0.012, 0.1, 0.36, 0.005, charcoal, [0.97, 0.30, 0]), rbox(0.07, 0.07, 0.7, 0.015, charcoal, [0.95, 0.17, 0]));
          for (let k = 0; k < 4; k++) g.add(rbox(0.014, 0.012, 0.34, 0.003, steel, [0.975, 0.27 + k * 0.022, 0]));   // grille bars
          // the cab inside: dashboard, steering wheel on its column, two seats, gear lever
          g.add(rbox(0.1, 0.06, 0.6, 0.02, charcoal, [0.86, 0.47, 0]));
          const ring = mesh(new THREE.TorusGeometry(0.075, 0.01, 10, 32), black, [0.8, 0.56, 0.15], [0, Math.PI / 2, 0]); ring.rotation.z = 0.5; g.add(ring);
          g.add(cyl(0.01, 0.01, 0.14, black, [0.84, 0.52, 0.15], [0, 0, 0.9], 8));
          for (const z of [0.15, -0.15]) g.add(rbox(0.2, 0.05, 0.22, 0.02, charcoal, [0.64, 0.42, z]), rbox(0.05, 0.24, 0.22, 0.02, charcoal, [0.53, 0.55, z], [0, 0, 0.12]), rbox(0.04, 0.07, 0.12, 0.015, charcoal, [0.51, 0.71, z]));
          g.add(cyl(0.006, 0.006, 0.08, black, [0.72, 0.45, 0], undefined, 8), sph(0.015, black, [0.72, 0.49, 0]));
          // under the cab: the engine block with its red valve cover, radiator, battery; exhaust and muffler along the frame
          g.add(rbox(0.28, 0.14, 0.26, 0.02, engine, [0.66, 0.27, 0]), rbox(0.24, 0.035, 0.18, 0.012, red, [0.66, 0.36, 0]));
          for (let k = 0; k < 4; k++) g.add(cyl(0.012, 0.012, 0.05, steel, [0.57 + k * 0.06, 0.39, 0.06], undefined, 8));   // injectors
          g.add(rbox(0.03, 0.2, 0.42, 0.006, charcoal, [0.9, 0.3, 0]), rbox(0.1, 0.08, 0.08, 0.01, black, [0.48, 0.22, 0.22]));
          g.add(cyl(0.018, 0.018, 1.2, steel, [-0.15, 0.17, -0.12], [0, 0, Math.PI / 2], 12), cyl(0.05, 0.05, 0.22, steel, [0.05, 0.17, -0.12], [0, 0, Math.PI / 2], 20));
          // ladder frame, crossmembers, driveshaft, axles and the differential
          for (const z of [0.2, -0.2]) g.add(rbox(1.85, 0.05, 0.05, 0.01, black, [-0.05, 0.20, z]));
          for (const x of [0.75, 0.3, -0.2, -0.7]) g.add(rbox(0.04, 0.04, 0.4, 0.008, black, [x, 0.2, 0]));
          g.add(cyl(0.02, 0.02, 0.9, steel, [0.03, 0.15, 0], [0, 0, Math.PI / 2 - 0.05], 12), cyl(0.022, 0.022, 0.6, steel, [-0.5, R, 0], [Math.PI / 2, 0, 0], 12), sph(0.06, engine, [-0.5, R, 0]));
          g.add(cyl(0.02, 0.02, 0.6, steel, [0.62, R, 0], [Math.PI / 2, 0, 0], 12));
          // the box inside: wooden floor, two pallets of taped cartons, a couple loose
          g.add(rbox(1.26, 0.02, 0.64, 0.004, wood, [-0.3, 0.26, 0]));
          const tape = ink(64, 64, (x) => { x.fillStyle = 'rgba(225,200,150,0.95)'; x.fillRect(26, 0, 12, 64); });
          for (const px of [-0.68, -0.2]) {
            g.add(rbox(0.42, 0.035, 0.52, 0.004, wood, [px, 0.29, 0]));
            const layers = px < -0.4 ? 3 : 2;
            for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < layers; k++) {
              const at = [px - 0.1 + i * 0.2, 0.385 + k * 0.152, -0.125 + j * 0.25];
              const c = rbox(0.19, 0.15, 0.24, 0.01, carton, at); c.rotation.y = (hash(i * 9 + j * 3 + k * 5 + layers) - 0.5) * 0.1; g.add(c);
              if (k === layers - 1) g.add(plane(0.19, 0.24, tape, [at[0], at[1] + 0.076, at[2]], [-Math.PI / 2, 0, 0]));
            }
          }
          g.add(rbox(0.16, 0.12, 0.2, 0.01, carton, [0.18, 0.33, 0.18]), rbox(0.14, 0.1, 0.16, 0.01, carton, [0.2, 0.44, 0.16]));
          // the roll-up rear door: aluminium slats
          for (let k = 0; k < 9; k++) g.add(rbox(0.014, 0.075, 0.62, 0.003, steel, [-0.955, 0.3 + k * 0.08, 0]));
          for (const s of [1, -1]) {
            g.add(sideFlat([[0.86, 0.47], [0.87, 0.64], [0.62, 0.64], [0.62, 0.47]], s * 0.331, win), seam(0.58, 0.43, 0.4, s * 0.331));
            g.add(rbox(0.012, 0.045, 0.11, 0.006, glow(LAMP, 2.5), [0.972, 0.36, s * 0.24]), rbox(0.01, 0.06, 0.04, 0.005, glow(TAIL, 2), [-0.955, 0.30, s * 0.3]));
            g.add(rbox(0.03, 0.11, 0.035, 0.008, black, [0.90, 0.56, s * 0.40]), rbox(0.01, 0.01, 0.08, 0.003, black, [0.90, 0.62, s * 0.36]));
            for (const x of [-0.8, -0.3, 0.2]) g.add(rbox(0.03, 0.015, 0.006, 0.002, glow('#ffb340', 1.5), [x, 0.28, s * 0.343]));
            g.add(cyl(0.06, 0.06, 0.24, steel, [0.18, 0.17, s * 0.27], [0, 0, Math.PI / 2]), rbox(0.01, 0.1, 0.1, 0.003, black, [-0.66, 0.1, s * 0.27]));
            g.add(wheel(R, 0.07, [0.62, R, s * 0.29], 6, wm), wheel(R, 0.065, [-0.50, R, s * 0.30], 6, wm), wheel(R, 0.065, [-0.50, R, s * 0.225], 6, wm));
          }
          return hero(g);
        },
        // a long-hood sleeper tractor (7500 x 2600 x 4100 mm, 1 unit = 3.9 m): sloped hood, raised-roof sleeper, chrome grille,
        // bumper, fuel tanks and exhaust stacks, tandem drive axles with duals, the fifth wheel. No logos.
        semi_truck: () => {
          const R = 0.133, paint = carPaint('#1d3f91');
          const g = group(
            extrudeZ(prof([[0.32, 0.22], [0.94, 0.22], [0.945, 0.40], ['q', 0.945, 0.43, 0.90, 0.44], [0.40, 0.52], [0.32, 0.52]]), 0.52, 0.03, paint),
            extrudeZ(prof([[0.34, 0.20], [0.34, 0.50], [0.22, 0.76], ['q', 0.15, 0.795, 0.04, 0.80], ['q', -0.08, 0.81, -0.17, 0.97], [-0.42, 0.99], [-0.43, 0.20]]), 0.67, 0.03, paint),
            rbox(0.012, 0.17, 0.30, 0.006, M.chrome, [0.977, 0.31, 0]), rbox(0.06, 0.09, 0.64, 0.02, M.chrome, [0.975, 0.17, 0]),
            cyl(0.12, 0.12, 0.03, M.darkMetal, [-0.63, 0.26, 0], undefined, 32));
          for (let k = 0; k < 5; k++) g.add(rbox(0.014, 0.008, 0.28, 0.003, M.black, [0.979, 0.25 + k * 0.03, 0]));
          for (const s of [1, -1]) {
            g.add(rbox(1.45, 0.05, 0.05, 0.01, M.black, [-0.25, 0.20, s * 0.17]));
            g.add(mesh(new THREE.CylinderGeometry(R + 0.035, R + 0.035, 0.11, 24, 1, true, Math.PI / 2, Math.PI), paint, [0.70, R, s * 0.29], [Math.PI / 2, 0, 0]));   // front fender
            g.add(sideFlat([[0.31, 0.53], [0.215, 0.74], [0.03, 0.74], [0.03, 0.53]], s * 0.336, M.lens), seam(0.0, 0.5, 0.5, s * 0.336), seam(-0.12, 0.55, 0.6, s * 0.336));
            g.add(rbox(0.02, 0.04, 0.09, 0.008, glow(LAMP, 2.5), [0.965, 0.40, s * 0.21]));
            g.add(rbox(0.03, 0.14, 0.05, 0.01, M.black, [0.37, 0.62, s * 0.40]), rbox(0.01, 0.01, 0.09, 0.003, M.black, [0.37, 0.66, s * 0.36]));
            g.add(cyl(0.075, 0.075, 0.32, M.chrome, [0.12, 0.17, s * 0.30], [0, 0, Math.PI / 2]), cyl(0.018, 0.018, 0.8, M.chrome, [-0.47, 0.62, s * 0.30], undefined, 16));
            g.add(rbox(0.01, 0.13, 0.12, 0.003, M.black, [-0.95, 0.12, s * 0.30]));
            g.add(wheel(R, 0.08, [0.70, R, s * 0.29], 8));
            for (const x of [-0.45, -0.78]) g.add(wheel(R, 0.06, [x, R, s * 0.30], 8), wheel(R, 0.06, [x, R, s * 0.235], 8));
          }
          interior(g, { seatY: 0.46, front: 0.12, steer: [0.25, 0.57], dash: [0.3, 0.52], width: 0.62, seat: '#3a3f47' });
          g.add(rbox(0.22, 0.05, 0.58, 0.02, real('#2f4a7a'), [-0.3, 0.42, 0]), rbox(0.22, 0.05, 0.58, 0.02, real('#2f4a7a'), [-0.3, 0.74, 0]), rbox(0.04, 0.02, 0.58, 0.005, real('#8d939c'), [-0.2, 0.77, 0]));   // sleeper bunks
          return hero(g);
        },
        // a ~300 m office supertall (1 unit = 150 m): podium, three setback tiers in a glass curtain wall, a crown and spire
        skyscraper: () => group(block(0.56, 0.12, 0.56, 0, ftex('skyP', 8, 2, 'ribbon', 3)), block(0.38, 0.95, 0.38, 0.12, ftex('sky1', 10, 32, 'curtain', 11)),
          rbox(0.40, 0.012, 0.40, 0.004, M.white, [0, 1.07, 0]), block(0.32, 0.5, 0.32, 1.07, ftex('sky2', 8, 17, 'curtain', 13)),
          rbox(0.34, 0.012, 0.34, 0.004, M.white, [0, 1.57, 0]), block(0.26, 0.25, 0.26, 1.57, ftex('sky3', 6, 8, 'curtain', 17)),
          rbox(0.28, 0.012, 0.28, 0.004, M.white, [0, 1.82, 0]), ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => rbox(0.012, 0.12, 0.012, 0.003, M.white, [a * 0.12, 1.88, b * 0.12])),
          cyl(0.006, 0.014, 0.22, M.chrome, [0, 2.0, 0], undefined, 12), sph(0.012, glow(TAIL, 3), [0, 2.12, 0])),
        // a twisting glass tower: 36 floor plates, each turned 1.4 degrees on the one below (90 degrees over the height)
        glass_skyscraper: () => {
          const g = group();
          const glassB = real('#3d6aa6', true), plate = real('#8f98a6');
          for (let k = 0; k < 36; k++) { const f = group(mesh(new THREE.BoxGeometry(0.44, 0.042, 0.30), glassB), rbox(0.46, 0.008, 0.32, 0.003, plate, [0, 0.025, 0])); f.position.y = 0.05 + k * 0.05; f.rotation.y = k * 0.025; g.add(f); }
          return g;
        },
        // an 11-storey office block (60 x 30 x 44 m, 1 unit = 40 m): ribbon windows, a glass lobby with a canopy, rooftop plant
        office_building: () => group(block(1.5, 1.0, 0.75, 0.1, ftex('offF', 14, 10, 'ribbon', 21), ftex('offS', 7, 10, 'ribbon', 23)),
          mesh(new THREE.BoxGeometry(1.46, 0.1, 0.71), M.glass, [0, 0.05, 0]), plane(1.4, 0.09, facadeMat(ftex('lobby', 10, 1, 'curtain', 9)), [0, 0.05, 0.357]),
          rbox(0.5, 0.015, 0.16, 0.004, M.white, [0, 0.11, 0.43]), rbox(1.52, 0.03, 0.77, 0.005, M.alu, [0, 1.115, 0]),
          rbox(0.3, 0.08, 0.2, 0.01, M.darkMetal, [-0.4, 1.17, -0.1]), rbox(0.2, 0.06, 0.2, 0.01, M.darkMetal, [0.3, 1.16, 0.1]), cyl(0.05, 0.05, 0.03, M.alu, [0.3, 1.205, 0.1])),
        // a 9-storey Israeli apartment block (24 x 14 x 30 m, 1 unit = 17 m): on columns (pilotis), a balcony pair per floor
        // with glass rails, solar water heaters and the lift room on the roof
        apartment_building: () => {
          const g = group(mesh(new THREE.BoxGeometry(0.4, 0.19, 0.3), M.glass, [0, 0.095, 0]), block(1.4, 1.53, 0.82, 0.19, ftex('aptF', 8, 9, 'punched', 31), ftex('aptS', 5, 9, 'punched', 33)),
            rbox(1.42, 0.03, 0.84, 0.005, M.alu, [0, 1.735, 0]), rbox(0.3, 0.12, 0.25, 0.01, M.glass, [0.4, 1.78, -0.15]));
          for (const x of [-0.6, -0.2, 0.2, 0.6]) for (const z of [-0.3, 0.3]) g.add(cyl(0.025, 0.025, 0.19, M.alu, [x, 0.095, z], undefined, 12));
          for (let k = 0; k < 9; k++) for (const x of [-0.4, 0.4]) { const y = 0.19 + k * 0.17; g.add(rbox(0.42, 0.012, 0.13, 0.003, M.white, [x, y + 0.006, 0.475]), rbox(0.42, 0.055, 0.006, 0.002, M.lens, [x, y + 0.04, 0.537])); }
          for (const x of [-0.5, -0.3, -0.1, 0.1]) g.add(rbox(0.16, 0.006, 0.12, 0.002, M.darkMetal, [x, 1.79, 0.12], [-0.6, 0, 0]), cyl(0.03, 0.03, 0.16, M.white, [x, 1.81, 0.0], [0, 0, Math.PI / 2], 16));
          return g;
        },
        city_building: () => cityBlock(1.5, 1.0, 5, 6, 41),
        city_building_color: () => { const g = cityBlock(0.95, 0.9, 6, 4, 61); g.add(rbox(0.3, 1.34, 0.1, 0.01, M.glass, [0, 1.0, 0.5])); return g; },
        // a 30-storey residential tower (30 x 25 x 100 m, 1 unit = 60 m): a balcony ring at every floor, a lit crown
        tower_building: () => {
          const g = group(mesh(new THREE.BoxGeometry(0.56, 0.08, 0.48), M.glass, [0, 0.04, 0]), block(0.52, 1.65, 0.44, 0.08, ftex('twF', 6, 30, 'punched', 71), ftex('twS', 5, 30, 'punched', 73)),
            rbox(0.5, 0.08, 0.42, 0.005, M.glass, [0, 1.77, 0]), rbox(0.56, 0.008, 0.48, 0.003, M.white, [0, 1.82, 0]));
          const conc = real('#7d8591');
          for (let k = 1; k < 30; k++) g.add(rbox(0.58, 0.006, 0.5, 0.003, conc, [0, 0.08 + k * 0.055, 0]));
          return g;
        },
        // a two-storey family house (12 x 9 m, 7.5 m to the ridge, 1 unit = 7 m): gable roof with overhangs, chimney, framed
        // windows (two lit), a porch over the door and an attached garage
        house: () => {
          const gable = extrudeZ(prof([[-0.625, 0.8], [0.625, 0.8], [0, 1.22]]), 1.7, 0, M.glass); gable.rotation.y = Math.PI / 2;
          const g = group(mesh(new THREE.BoxGeometry(1.7, 0.8, 1.25), M.glass, [0, 0.4, 0]), gable,
            rbox(1.84, 0.035, 0.85, 0.01, M.darkMetal, [0, 1.0, 0.3525], [0.592, 0, 0]), rbox(1.84, 0.035, 0.85, 0.01, M.darkMetal, [0, 1.0, -0.3525], [-0.592, 0, 0]),
            rbox(1.84, 0.02, 0.04, 0.005, M.darkMetal, [0, 1.235, 0]), rbox(0.14, 0.4, 0.14, 0.01, M.glass, [0.55, 1.15, -0.2]),
            rbox(0.2, 0.38, 0.02, 0.01, M.darkMetal, [-0.15, 0.19, 0.632]), rbox(0.42, 0.02, 0.2, 0.005, M.white, [-0.15, 0.44, 0.73], [0.12, 0, 0]),
            cyl(0.012, 0.012, 0.43, M.white, [-0.33, 0.215, 0.82], undefined, 8), cyl(0.012, 0.012, 0.43, M.white, [0.03, 0.215, 0.82], undefined, 8),
            rbox(0.32, 0.04, 0.12, 0.005, M.alu, [-0.15, 0.02, 0.69]),
            mesh(new THREE.BoxGeometry(0.6, 0.55, 0.9), M.glass, [1.15, 0.275, 0.175]), rbox(0.64, 0.03, 0.94, 0.005, M.darkMetal, [1.15, 0.565, 0.175]),
            rbox(0.48, 0.38, 0.02, 0.005, M.alu, [1.15, 0.19, 0.628]),
            ...[[0.35, 0.36, true], [-0.55, 0.36, false], [-0.55, 0.63, false], [-0.15, 0.63, true], [0.35, 0.63, false]].map(([x, y, lit]) => winFrame(x, y, 0.632, 0.24, 0.2, lit)));
          for (let k = 1; k < 5; k++) g.add(rbox(0.48, 0.006, 0.025, 0.002, M.white, [1.15, k * 0.076, 0.632]));
          g.scale.setScalar(0.85); g.position.x = -0.25; return group(g);
        },
      };

      // buildings stand three-quarter on too (a facade straight on reads as a flat card)
      for (const n of ['skyscraper', 'glass_skyscraper', 'office_building', 'apartment_building', 'city_building', 'city_building_color', 'tower_building', 'house']) {
        const make = OBJ[n]; OBJ[n] = () => { const g = make(); g.rotation.y = -0.5; return group(g); };
      }
      // ─── glossy 3D symbols (Wi-Fi, Bluetooth, lock...): extruded shapes and tubes, floating above their pedestal ───
      const ext = (shape, mat, depth = 0.14) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 4, curveSegments: 32 }); g.center(); return mesh(g, mat); };
      const tube = (pts, r, mat) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y]) => V(x, y, 0)), false, 'catmullrom', 0), 64, r, 16), mat);
      const arc = (r1, r2, a0, a1) => { const s = new THREE.Shape(); s.absarc(0, 0, r2, a0, a1, false); s.absarc(0, 0, r1, a1, a0, true); return s; };
      const sym = (c) => real(new THREE.Color(c).getHex());
      const SYM = {
        wifi: (c) => group(...[0.25, 0.55, 0.85].map(r => { const m = ext(arc(r, r + 0.17, Math.PI / 4, Math.PI * 3 / 4), sym(c)); m.position.y = r * 0.75 - 0.15; return m; }), mesh(new THREE.SphereGeometry(0.13, 24, 16), sym(c), [0, -0.38, 0])),
        bluetooth: (c) => group(ext((() => { const s = new THREE.Shape(); s.absarc(0, 0, 0.75, 0, Math.PI * 2); return s; })(), sym(c), 0.12),
          (() => { const t = tube([[-0.3, 0.24], [0.28, -0.24], [0, -0.52], [0, 0.52], [0.28, 0.24], [-0.3, -0.24]], 0.06, M.white); t.position.z = 0.12; return t; })()),
        signal: (c) => group(...[0, 1, 2, 3].map(k => rbox(0.26, 0.35 + k * 0.3, 0.2, 0.06, sym(k < 3 ? c : '#cbd5e1'), [-0.5 + k * 0.34, (0.35 + k * 0.3) / 2 - 0.5, 0]))),
        pin: (c) => { const s = new THREE.Shape(); s.moveTo(0, -0.8); s.bezierCurveTo(0.25, -0.35, 0.6, -0.1, 0.6, 0.25); s.absarc(0, 0.25, 0.6, 0, Math.PI, false); s.bezierCurveTo(-0.6, -0.1, -0.25, -0.35, 0, -0.8); const h = new THREE.Path(); h.absarc(0, 0.25, 0.25, 0, Math.PI * 2, true); s.holes.push(h); return group(ext(s, sym(c))); },
        battery: (c) => { const s = new THREE.Shape(); s.moveTo(-0.7, -0.35); s.lineTo(0.62, -0.35); s.lineTo(0.62, 0.35); s.lineTo(-0.7, 0.35); s.lineTo(-0.7, -0.35); const h = new THREE.Path(); h.moveTo(-0.6, -0.25); h.lineTo(-0.6, 0.25); h.lineTo(0.52, 0.25); h.lineTo(0.52, -0.25); h.lineTo(-0.6, -0.25); s.holes.push(h);
          return group(ext(s, sym('#334155')), rbox(0.1, 0.3, 0.16, 0.03, sym('#334155'), [0.72, 0, 0]), ...[0, 1, 2].map(k => rbox(0.3, 0.42, 0.16, 0.05, sym(c), [-0.42 + k * 0.36, 0, 0]))); },
        bell: (c) => { const pts = [[0, 0.75], [0.12, 0.7], [0.4, 0.45], [0.48, 0.05], [0.65, -0.35], [0.7, -0.42], [0, -0.42]].map(([x, y]) => new THREE.Vector2(x, y)); return group(mesh(new THREE.LatheGeometry(pts, 48), sym(c)), sph(0.13, sym(c), [0, -0.55, 0])); },
        heart: (c) => { const s = new THREE.Shape(); s.moveTo(0, -0.6); s.bezierCurveTo(-0.9, 0, -0.6, 0.8, 0, 0.35); s.bezierCurveTo(0.6, 0.8, 0.9, 0, 0, -0.6); return group(ext(s, sym(c), 0.2)); },
        check: (c) => group(tube([[-0.55, 0.02], [-0.15, -0.38], [0.6, 0.42]], 0.13, sym(c))),
        cross: (c) => group(tube([[-0.5, -0.5], [0.5, 0.5]], 0.13, sym(c)), tube([[-0.5, 0.5], [0.5, -0.5]], 0.13, sym(c))),
        bolt: (c) => { const s = new THREE.Shape(); [[0.15, 0.8], [-0.45, -0.05], [-0.02, -0.05], [-0.18, -0.8], [0.45, 0.1], [0.03, 0.1], [0.15, 0.8]].forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y))); return group(ext(s, sym(c), 0.18)); },
        eye: (c) => { const s = new THREE.Shape(); s.moveTo(-0.85, 0); s.quadraticCurveTo(0, 0.75, 0.85, 0); s.quadraticCurveTo(0, -0.75, -0.85, 0); return group(ext(s, M.white, 0.1), cyl(0.28, 0.28, 0.1, sym(c), [0, 0, 0.1], [Math.PI / 2, 0, 0]), cyl(0.12, 0.12, 0.1, M.black, [0, 0, 0.16], [Math.PI / 2, 0, 0])); },
        chat: (c) => { const s = new THREE.Shape(); s.moveTo(-0.7, 0.55); s.lineTo(0.7, 0.55); s.quadraticCurveTo(0.85, 0.55, 0.85, 0.4); s.lineTo(0.85, -0.2); s.quadraticCurveTo(0.85, -0.35, 0.7, -0.35); s.lineTo(-0.15, -0.35); s.lineTo(-0.5, -0.7); s.lineTo(-0.45, -0.35); s.lineTo(-0.7, -0.35); s.quadraticCurveTo(-0.85, -0.35, -0.85, -0.2); s.lineTo(-0.85, 0.4); s.quadraticCurveTo(-0.85, 0.55, -0.7, 0.55);
          return group(ext(s, sym(c)), ...[-0.35, 0, 0.35].map(x => sph(0.08, M.white, [x, 0.1, 0.12]))); },
        play: (c) => { const d = new THREE.Shape(); d.absarc(0, 0, 0.75, 0, Math.PI * 2); const t = new THREE.Shape(); t.moveTo(-0.2, 0.35); t.lineTo(0.38, 0); t.lineTo(-0.2, -0.35); t.lineTo(-0.2, 0.35); const tri = ext(t, M.white, 0.08); tri.position.z = 0.12; return group(ext(d, sym(c), 0.12), tri); },
        gear: (c) => { const s = new THREE.Shape(), n = 10; for (let k = 0; k < n * 2; k++) { const a = Math.PI * k / n, r = k % 2 ? 0.55 : 0.75; const p = [r * Math.cos(a - 0.12), r * Math.sin(a - 0.12)], q = [r * Math.cos(a + 0.12), r * Math.sin(a + 0.12)]; if (!k) s.moveTo(...p); else s.lineTo(...p); s.lineTo(...q); } const h = new THREE.Path(); h.absarc(0, 0, 0.25, 0, Math.PI * 2, true); s.holes.push(h); return group(ext(s, sym(c))); },
        shield: (c) => { const s = new THREE.Shape(); s.moveTo(0, 0.8); s.quadraticCurveTo(0.4, 0.62, 0.7, 0.62); s.quadraticCurveTo(0.72, -0.35, 0, -0.8); s.quadraticCurveTo(-0.72, -0.35, -0.7, 0.62); s.quadraticCurveTo(-0.4, 0.62, 0, 0.8); const ck = tube([[-0.3, 0.02], [-0.07, -0.22], [0.32, 0.25]], 0.07, M.white); ck.position.z = 0.14; return group(ext(s, sym(c)), ck); },
        fingerprint: (c) => group(...[0.18, 0.33, 0.48, 0.63, 0.78].map((r, k) => mesh(new THREE.TorusGeometry(r, 0.045, 12, 48, Math.PI * (1.25 - k * 0.05)), sym(c), [0, 0, 0], [0, 0, -0.1 + k * 0.15]))),
        sound: (c) => { const s = new THREE.Shape(); [[-0.7, -0.2], [-0.4, -0.2], [0, -0.55], [0, 0.55], [-0.4, 0.2], [-0.7, 0.2], [-0.7, -0.2]].forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y)));
          return group(ext(s, sym(c)), ...[0.3, 0.55].map(r => { const m = ext(arc(r, r + 0.1, -Math.PI / 4, Math.PI / 4), sym(c), 0.1); m.position.x = 0.12 + r * 0.6; return m; })); },
        camera_icon: (c) => group(rbox(1.4, 0.95, 0.3, 0.2, sym(c), [0, 0, 0]), cyl(0.3, 0.3, 0.12, M.lens, [0, 0, 0.18], [Math.PI / 2, 0, 0]), cyl(0.36, 0.36, 0.1, M.chrome, [0, 0, 0.15], [Math.PI / 2, 0, 0]), rbox(0.36, 0.16, 0.2, 0.06, sym(c), [-0.3, 0.52, 0])),
      };
      // ─── library models (engine/models, the ones this script uses packed into models.js by the agent): each is
      // centred, sits on y = 0 and is ~1.8 units at its largest side, then gets the same hologram skin as the code models ───
      const { GLTFLoader } = await import('./vendor/jsm/loaders/GLTFLoader.js');
      const gltfLoader = new GLTFLoader();
      for (const [name, b64] of Object.entries(window.MODEL_DATA || {})) {
        if (OBJ[name] || SYM[name]) continue;
        try {
          const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)).buffer;
          const model = (await gltfLoader.parseAsync(bin, './')).scene;
          model.traverse(o => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals(); });
          const cols = new Set(), vcolor = []; model.traverse(o => { if (o.isMesh) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(mt => mt.color && cols.add(mt.color.getHex())); if (o.geometry.attributes.color) vcolor.push(o); } });
          if (cols.size > 1 || vcolor.length) model.traverse(o => {
            if (!o.isMesh || Array.isArray(o.material) || !o.material.color) return;
            const hex = o.material.color.getHex(), mt = real(hex); if (o.geometry.attributes.color) mt.userData.vcol = true; o.material = mt;
          });
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(model), size = box.getSize(V()), mid = box.getCenter(V());
          model.position.sub(V(mid.x, box.min.y, mid.z));
          const inner = group(model); inner.scale.setScalar(1.8 / Math.max(size.x, size.y, size.z, 1e-6));
          OBJ[name] = () => group(inner.clone(true));   // a clone per use: the world can dress a street with the same building twice
        } catch (e) { console.warn(`model ${name}: ${e.message}`); }
      }
      const KINDS = { ...OBJ, ...SYM };

      // ─── one story world: each object the script names gets one place, and the story comes back to it (the router
      // stays the router, the phone stays the phone), so things can talk to each other across the scene ───
      const SHADOW = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, map: tex(256, 256, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(0.6, 'rgba(0,0,0,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }) });
      const RING = (c) => new THREE.MeshBasicMaterial(Object.assign({ color: new THREE.Color(c).multiplyScalar(PAL.glass ? 0.35 : 1) }, ADD));   // Grouper has no pedestals: just a faint floor ring
      const kindOf = k => (KINDS[k] ? k : 'phone');
      const kinds = [];
      for (const s of SEGS) for (const k of [s.focus, s.target]) if (k && !kinds.includes(kindOf(k))) kinds.push(kindOf(k));
      const spots = kinds.map((kind, i) => {
        const isSym = !!SYM[kind], c = PAL.accent[i % PAL.accent.length];
        const at = V((i % 2 ? 1 : -1) * (1.8 + 0.9 * (i % 3)), 0, -i * 4.6);
        const base = group(cyl(1.15, 1.2, 0.22, new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.bottom) }), [0, 0.11, 0], [0, 0, 0], 64), mesh(new THREE.TorusGeometry(1.17, 0.025, 8, 96), RING(c), [0, 0.22, 0], [Math.PI / 2, 0, 0]));
        base.position.copy(at); base.visible = ENV !== 'space'; world.add(base);   // nothing to stand on in orbit
        const obj = isSym ? SYM[kind](c) : OBJ[kind]();
        neonize(obj, c, isSym || COLOUR.has(kind));
        const holder = new THREE.Group(); holder.add(obj); holder.position.copy(at).add(V(0, isSym ? 1.35 : 0.226, 0)); world.add(holder);
        const box = new THREE.Box3().setFromObject(holder), size = box.getSize(V()), h = Math.max(size.y, size.x * 0.8);
        const fit = isSym ? 1.3 / Math.max(size.x, size.y) : Math.min(1, 2.2 / Math.max(size.x, size.y));
        obj.scale.setScalar(fit);
        if (!isSym && base.visible) {   // a soft contact shadow under the object, so it stands on the floor instead of floating
          const sh = plane(Math.min(2.3, size.x * fit * 1.25), Math.min(2.3, size.z * fit * 1.25 + 0.3), SHADOW, [0, 0.224, 0], [-Math.PI / 2, 0, 0]); sh.castShadow = sh.receiveShadow = false; base.add(sh);
        }
        holder.rotation.y = isSym ? 0 : (i % 2 ? -0.45 : 0.45);
        return { kind, isSym, holder, obj, at, c, fit, h: (isSym ? 1.3 : h * fit) + (isSym ? 1.35 : 0.22), base: holder.rotation.y };
      });
      const spotOf = SEGS.map(s => spots[kinds.indexOf(kindOf(s.focus))]);
      const centerOf = sp => sp.at.clone().add(V(0, sp.h * 0.55, 0));

      // a line's symbol (Wi-Fi over the router, a lock over the phone) pops up beside its object while it is spoken
      const badges = SEGS.map((s, i) => {
        if (!SYM[s.symbol] || SYM[s.focus] || i === 0) return null;   // line 1 keeps the frame clear for the hook headline
        const sp = spotOf[i], c = PAL.accent[(i + 2) % PAL.accent.length], m = SYM[s.symbol](c);
        neonize(m, c); m.scale.setScalar(0.55);
        const g = new THREE.Group(); g.add(m); g.position.copy(sp.at).add(V(sp.at.x > 0 ? -0.5 : 0.5, sp.h + 0.45, 0.3)); world.add(g);   // just above the object; the camera frames it too
        sfx(s.a + 0.35, 'popHi', 0.45);
        return g;
      });

      // ─── text sprites for labels and numbers ───
      function textSprite(text, size, color = '#FFFFFF', pill = true) {
        const c = document.createElement('canvas'), x = c.getContext('2d'), fs = 120;
        x.font = `900 ${fs}px Rubik`; const w = Math.ceil(x.measureText(text).width) + 120; c.width = w; c.height = fs * 1.7;
        x.font = `900 ${fs}px Rubik`; x.direction = DIR; x.textAlign = 'center'; x.textBaseline = 'middle';
        if (pill) { x.fillStyle = 'rgba(8,6,30,0.75)'; x.strokeStyle = 'rgba(220,215,255,0.9)'; x.lineWidth = 8; x.beginPath(); x.roundRect(6, 6, w - 12, c.height - 12, c.height / 2 - 6); x.fill(); x.stroke(); }
        x.fillStyle = color; x.fillText(text, w / 2, c.height / 2 + 6);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
        s.scale.set(size * w / c.height, size, 1); return s;
      }

      // ─── actions at a line's spot. update(u, on): u = seconds since the line started ───
      const ACT = {
        show: () => () => {},
        spin: (s, sp) => u => { sp.holder.rotation.y = sp.base + u * 1.3; },
        pulse: (s, sp) => { sfx(s.a + 0.2, 'popHi', 0.5); return u => sp.obj.scale.setScalar(sp.fit * (1 + 0.12 * Math.exp(-((u - 0.25) ** 2) * 20))); },
        waves: (s, sp) => {
          const rings = [0, 1, 2].map(() => { const r = mesh(new THREE.TorusGeometry(1, 0.02, 8, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(sp.c), transparent: true }), [0, 0, 0], [Math.PI / 2, 0, 0]); r.castShadow = false; r.position.copy(centerOf(sp)); world.add(r); return r; });
          sfx(s.a + 0.15, 'whoosh', 0.35);
          return (u, on) => rings.forEach((r, k) => { const f = (u * 0.55 + k / 3) % 1; r.visible = on; r.scale.setScalar(0.4 + 3.2 * f); r.material.opacity = (1 - f) * 0.85; });
        },
        beam: (s, sp, i) => {
          const tgt = (s.target && spots[kinds.indexOf(kindOf(s.target))] !== sp && spots[kinds.indexOf(kindOf(s.target))]) || spotOf[i + 1] || sp;
          const a = centerOf(sp), b = centerOf(tgt), mid = a.clone().add(b).multiplyScalar(0.5).add(V(0, 1.6, 0));
          const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
          const dots = Array.from({ length: 22 }, () => { const d = mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(sp.c), emissiveIntensity: 2 })); d.castShadow = false; world.add(d); return d; });
          for (let k = 0; k < 4; k++) sfx(s.a + 0.4 + k * 0.7, 'swish', 0.3);
          return (u, on) => dots.forEach((d, k) => { d.visible = on; d.position.copy(curve.getPoint((u * 0.45 + k / dots.length) % 1)); });
        },
        // the Grouper move: the object comes apart so you see how it's built. A flat thing (a phone, a board) separates
        // into layers along its thin axis, front to back; a bulky one (a truck, a car) flies apart from its centre. Parts
        // leave one after another, the object turns a little while it's open, and it closes again before the line ends.
        explode: (s, sp) => {
          let root = sp.obj; while (root.children.length === 1 && root.children[0].isGroup) root = root.children[0];
          const parts = root.children.filter(c => c.isMesh || c.isGroup);
          if (parts.length < 8) return ACT.spin(s, sp);   // the writer chose to open it, but a model with only a few parts has nothing inside to show
          root.updateMatrixWorld(true);
          const inv = root.matrixWorld.clone().invert(), all = new THREE.Box3();
          const info = parts.map(c => { const b = new THREE.Box3().setFromObject(c).applyMatrix4(inv); all.union(b); return { c, o: c.position.clone(), m: b.getCenter(V()) }; });
          const size = all.getSize(V()), mid = all.getCenter(V()), dims = [size.x, size.y, size.z], big = Math.max(...dims, 1e-6);
          const axis = dims.indexOf(Math.min(...dims)), flat = Math.min(...dims) / big < 0.3, unit = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)][axis];
          if (flat) {
            // layers: parts at (about) the same depth move together, the layers spread evenly over up to 1.1 units
            const depth = i => Math.round(info[i].m.getComponent(axis) / (big * 0.012));
            const levels = [...new Set(info.map((_, i) => depth(i)))].sort((x, y) => x - y);
            info.forEach((p, i) => {
              const L = levels.length > 1 ? levels.indexOf(depth(i)) / (levels.length - 1) - 0.5 : 0;
              const side = p.m.clone().sub(mid); side.setComponent(axis, 0);
              p.d = unit.clone().multiplyScalar(L * Math.min(big * 0.9, 1.1)).addScaledVector(side, 0.15); p.delay = (L + 0.5) * 0.3;
            });
          } else {
            info.forEach((p, i) => {
              const off = p.m.clone().sub(mid), r = off.length() / (big * 0.5);
              p.d = off.lengthSq() < 1e-6 ? V(0, 0.1 * big, 0) : off.normalize().multiplyScalar(big * (0.05 + 0.16 * r)).add(V(0, 0.04 * big * (i % 3), 0));
              p.delay = 0.3 * Math.min(1, r);
            });
          }
          const low = Math.min(...info.map(p => p.d.y));   // nothing sinks into the floor: the whole explosion lifts instead
          if (low < 0) info.forEach(p => { p.d.y -= low; });
          const turn = flat && axis === 2 ? 1.05 : 0.45;   // layers that stack toward the camera are seen from the side
          sfx(s.a + 0.3, 'whoosh', 0.5);
          const len = s.end - s.a;
          return (u) => {
            const close = E.io3(seg(u, len - 0.75, len - 0.1));
            let open = 0;
            info.forEach(p => { const f = E.io3(seg(u, 0.2 + p.delay, 1.1 + p.delay)) * (1 - close); open = Math.max(open, f); p.c.position.copy(p.o).addScaledVector(p.d, f); });
            sp.holder.rotation.y = sp.base + turn * open;
          };
        },
        count: (s, sp) => {
          const value = Number(s.value) || 0, fmt = v => (Math.abs(value) >= 100 ? Math.round(v).toLocaleString('en-US') : String(Math.round(v * 10) / 10)) + (s.suffix || '');
          let spr = null, shown = '';
          for (let k = 0; k < 8; k++) sfx(s.a + 0.2 + k * 0.1, 'count', 0.35);
          sfx(s.a + 1.05, 'impact', 0.6);
          return (u, on) => {
            const txt = fmt(value * E.o3(seg(u, 0.2, 1.0)));
            if (txt !== shown) { if (spr) world.remove(spr); spr = textSprite(txt, 0.75, sp.c, true); spr.position.copy(sp.at).add(V(0, sp.h + 0.55, 0)); world.add(spr); shown = txt; }
            spr.visible = on;
          };
        },
        yes: (s, sp) => { const m = SYM.check('#22c55e'); neonize(m, '#4dffb0'); m.position.copy(sp.at).add(V(0.9, sp.h + 0.2, 0.6)); world.add(m); sfx(s.a + 0.5, 'success', 0.7);
          return (u, on) => { m.visible = on && u > 0.5; m.scale.setScalar(0.6 * sp_(u, 0.5)); m.lookAt(cam.position); }; },
        // the spot is `spot` here: naming it `sp` hid the spring function sp() and crashed every "no" line
        no: (s, spot) => { const m = SYM.cross('#ef4444'); neonize(m, '#ff3b5c'); m.position.copy(centerOf(spot)).add(V(0, 0, 0.9)); world.add(m); sfx(s.a + 0.5, 'impact', 0.7);
          return (u, on) => { m.visible = on && u > 0.5; m.scale.setScalar(1.3 - 0.4 * sp(u, 0.5, 30, 0.5)); m.lookAt(cam.position); }; },
      };
      const sp_ = (u, a) => sp(u, a, 22, 0.45);
      const acts = SEGS.map((s, i) => (ACT[s.action] || ACT.show)(s, spotOf[i], i));
      const tags = SEGS.map((s, i) => { if (!s.label) return null; const t = textSprite(s.label, 0.32); t.position.copy(spotOf[i].at).add(V(0, spotOf[i].h + 0.25, 0)); world.add(t); return t; });

      // ─── camera: a key per line framing its object, glided between; a stream between two objects is seen along
      // its line from above, so both fit the tall frame ───
      let lastAz = 0.42;
      const keys = SEGS.map((s, i) => {
        const p = spotOf[i], tgt = s.action === 'beam' && s.target ? spots[kinds.indexOf(kindOf(s.target))] : null;
        let look = centerOf(p).add(V(0, SYM[s.symbol] && !SYM[s.focus] ? 0.1 : -0.35, 0)), az = i % 2 ? -0.42 : 0.42, el = 0.2 + 0.05 * Math.cos(i * 1.3), dist = Math.max(6.4, p.h * 3.2);
        if (tgt && tgt !== p) {
          const a = centerOf(p), b = centerOf(tgt);
          look = a.clone().lerp(b, 0.55); az = Math.atan2(a.x - b.x, a.z - b.z) + 0.15; el = 0.45; dist = a.distanceTo(b) + 6.5;
        }
        while (az - lastAz > Math.PI) az -= 2 * Math.PI;   // glide the short way round
        while (lastAz - az > Math.PI) az += 2 * Math.PI;
        lastAz = az;
        return { look, az, el, dist };
      });
      // the moment each line's *key word* is said (spread by characters): the camera punches in and the frame shakes
      const hits = SEGS.slice(1).map(s => { const plain = s.text.replace(/\*/g, ''), k = s.text.indexOf('*'); return k < 0 ? null : s.a + (s.b - s.a) * (k / Math.max(1, plain.length)) + 0.08; }).filter(x => x !== null);
      const kick = (t, at, rate) => (t >= at ? Math.exp(-(t - at) * rate) : 0);
      const SLAM = 0.2;   // the hook object lands at this second
      // the hook keeps its push-in; an exploding object is circled so its layers turn in depth; a spinning one stays put
      const MOVE = SEGS.map((s, i) => (i === 0 || s.action === 'spin' || s.action === 'beam' ? 'push' : s.action === 'explode' ? 'orbit' : ['dolly', 'orbit', 'crane'][i % 3]));
      // fast whip cuts between lines (viewers left a slow glide), a spring overshoot on arrival, a constant drift
      const camAt = t => {
        let i = 0; while (i + 1 < SEGS.length && t >= SEGS[i + 1].a - 0.22) i++;
        const k = keys[i], pv = keys[Math.max(0, i - 1)], f = i === 0 ? 1 : E.io3(seg(t, SEGS[i].a - 0.22, SEGS[i].a + 0.2));
        const u = t - SEGS[i].a, len = SEGS[i].end - SEGS[i].a;
        // each line gets its own move, like a camera operator: an orbit around the object, a dolly in, a crane up
        const pr = E.io3(clamp(u / Math.max(1, len), 0, 1)), mv = MOVE[i];
        const look = pv.look.clone().lerp(k.look, f), az = lerp(pv.az, k.az, f) + (mv === 'orbit' ? 0.55 * pr : 0.06 * u), el = lerp(pv.el, k.el, f) + (mv === 'crane' ? 0.24 * pr : 0);
        let dist = lerp(pv.dist, k.dist, f) * (1 - (mv === 'dolly' ? 0.24 : mv === 'push' ? 0.12 : 0.05) * pr);
        if (i === 0) dist *= lerp(2.1, 1, sp(t, 0, 15, 0.42));
        else dist *= lerp(1.18, 1, sp(u, -0.05, 18, 0.45));
        for (const h of hits) dist *= 1 - 0.07 * kick(t, h, 7) * Math.min(1, (t - h) * 25);
        const shake = 0.22 * kick(t, SLAM, 7) + hits.reduce((n, h) => n + 0.1 * kick(t, h, 10), 0);
        const pos = look.clone().add(V(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist));
        pos.add(V(Math.sin(t * 83), Math.cos(t * 71), 0).multiplyScalar(shake));
        return { look, pos };
      };
      const flashAt = t => 0.7 * kick(t, SLAM, 14) + SEGS.slice(1).reduce((n, s) => n + 0.18 * kick(t, s.a - 0.02, 14), 0);
      SEGS.forEach((s, i) => { if (i) sfx(s.a - 0.22, i % 2 ? 'whoosh' : 'swish', 0.55); });
      hits.forEach(h => sfx(h, 'impact', 0.45));
      sfx(0, 'whoosh', 0.7); sfx(SLAM, 'impact', 1); sfx(SLAM + 0.02, 'sub', 0.8);

      // ─── the hologram city on both sides and dust in the air (as in the hologram look) ───
      const len = SEGS.length * 4.2 + 20, cityMat = new THREE.LineBasicMaterial(Object.assign({ color: PAL.grid, opacity: 0.3 }, ADD)), win = [], winC = [];
      for (let k = 0; k < (ENV === 'studio' ? 50 : 0); k++) {   // the old hologram city: the studio only, the other worlds bring their own
        const h = 3 + 12 * hash(k + 3), side = k % 2 ? 1 : -1, w = 1.8 + 2 * hash(k), d = 1.8 + 2 * hash(k + 9);
        const x = side * (7 + 12 * hash(k + 5)), z = 10 - k * len / 50;
        const b = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), cityMat); b.position.set(x, h / 2, z); world.add(b);
        for (let y = 0.8; y < h - 0.4; y += 0.7) for (let u = -w / 2 + 0.35; u < w / 2 - 0.2; u += 0.45) if (hash(k * 131 + y * 17 + u * 7) > 0.5) {
          win.push(x + u, y, z + d / 2 + 0.01); const col = new THREE.Color(PAL.accent[(k + Math.floor(y)) % PAL.accent.length]); winC.push(col.r, col.g, col.b);
        }
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(win, 3)); wg.setAttribute('color', new THREE.Float32BufferAttribute(winC, 3));
      world.add(new THREE.Points(wg, new THREE.PointsMaterial(Object.assign({ vertexColors: true, size: 0.1, opacity: 0.7 }, ADD))));
      const ND = 700, dust = new Float32Array(ND * 3), dseed = Array.from({ length: ND }, (_, k) => [(hash(k) - 0.5) * 40, hash(k + 1) * 12, 12 - hash(k + 2) * len, hash(k + 3)]);
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
      world.add(new THREE.Points(dg, new THREE.PointsMaterial(Object.assign({ color: 0xdcd6ff, size: 0.04, opacity: 0.7 }, ADD))));

      // ─── the world the story happens in (VIDEO.env, picked by the writer), dressed with library models in the same
      // glass look but dimmer, so the objects the lines talk about stay the brightest things on screen ───
      const dress = (name, x, z, height, rot = 0) => {
        if (!OBJ[name]) return null;
        const m = OBJ[name](); neonize(m, PAL.accent[0], COLOUR.has(name));
        if (m.userData.yawed) m.children[0].rotation.y = 0;
        const mats = new Set(); m.traverse(o => { if (o.material) mats.add(o.material); });   // parts share materials: dim each one once
        for (const mt of mats) { if (mt.uniforms && mt.uniforms.c) mt.uniforms.c.value.multiplyScalar(0.6); if (mt.isMeshPhysicalMaterial) { mt.color.multiplyScalar(0.6); mt.envMapIntensity = 0.5; } if (mt.isLineBasicMaterial) mt.opacity *= 0.55; if (mt.isMeshBasicMaterial && mt.map) mt.opacity *= 0.5; }
        const box = new THREE.Box3().setFromObject(m), size = box.getSize(V());
        m.scale.setScalar(height / Math.max(size.y, 1e-6)); m.position.set(x, 0, z); m.rotation.y = rot; world.add(m); return m;
      };
      const pathEnd = -SEGS.length * 4.6 - 12;
      if (ENV === 'city') {
        // a main avenue the camera travels down (the spots stand on it), blocks of buildings on both sides, cross streets,
        // parked cars and traffic lights at the corners: the Grouper city
        const towers = ['city_building', 'apartment_building', 'skyscraper', 'glass_skyscraper', 'office_building', 'tower_building', 'city_building_color'].filter(n => OBJ[n]);
        const TH = { city_building: 4.5, city_building_color: 5, apartment_building: 6, office_building: 6, tower_building: 12, skyscraper: 16, glass_skyscraper: 14 };   // real heights: a 5-storey block is not a tower
        const cars = ['car', 'sports_car', 'police_car', 'pickup_truck', 'delivery_truck'].filter(n => OBJ[n]);
        const road = [];
        for (let z = 14; z > pathEnd; z -= 12) {
          for (const side of [-1, 1]) for (let col = 0; col < 3; col++) {
            const k = Math.round(z * 7 + side * 3 + col * 11);
            if (towers.length) { const t = towers[Math.floor(hash(k) * towers.length)]; dress(t, side * (8 + col * 6 + 1.5 * hash(k + 1)), z - 2 - 6 * hash(k + 2), (TH[t] || 8) * (0.8 + 0.4 * hash(k + 3)) + col * 2, hash(k + 4) * 6.28); }
          }
          road.push(-40, 0.01, z - 9, 40, 0.01, z - 9, -40, 0.01, z - 11, 40, 0.01, z - 11);                 // a cross street
          if (cars.length) { const c = cars[Math.floor(hash(z) * cars.length)]; dress(c, (hash(z + 5) > 0.5 ? 1 : -1) * 5.6, z - 5, { car: 0.75, sports_car: 0.65, police_car: 0.8, pickup_truck: 1.0, delivery_truck: 1.6 }[c] || 0.9, Math.PI / 2 * (hash(z + 6) > 0.5 ? 1 : -1)); }
          if (OBJ.traffic_light) dress('traffic_light', 6.2, z - 8.4, 2.6, -Math.PI / 2);
        }
        for (const x of [-6.5, 6.5]) road.push(x, 0.01, 20, x, 0.01, pathEnd - 20);                          // the avenue's curbs
        for (let z = 18; z > pathEnd - 20; z -= 3) road.push(0, 0.012, z, 0, 0.012, z - 1.4);                // dashed centre line
        const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(road, 3));
        world.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: new THREE.Color(PAL.accent[1]), transparent: true, opacity: 0.45 })));
      } else if (ENV === 'home') {
        // a long room: walls with windows and doors, furniture along both walls, a tiled floor (the grid)
        const furniture = ['sofa', 'fridge', 'floor_lamp', 'desk', 'bed', 'tv_flat', 'washing_machine', 'office_chair'].filter(n => OBJ[n]);
        const H = { sofa: 1.0, fridge: 2.0, floor_lamp: 1.9, desk: 0.9, bed: 0.8, tv_flat: 1.0, washing_machine: 1.0, office_chair: 1.1 };
        const wall = [];
        for (const x of [-7.5, 7.5]) {
          wall.push(x, 0, 16, x, 0, pathEnd - 10, x, 3.4, 16, x, 3.4, pathEnd - 10);
          for (let z = 16; z > pathEnd - 10; z -= 4) wall.push(x, 0, z, x, 3.4, z);
        }
        const wg2 = new THREE.BufferGeometry(); wg2.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3));
        world.add(new THREE.LineSegments(wg2, new THREE.LineBasicMaterial({ color: new THREE.Color(PAL.accent[1]), transparent: true, opacity: 0.35 })));
        let n = 0;
        for (let z = 10; z > pathEnd; z -= 5.5) for (const side of [-1, 1]) {
          const name = furniture[n++ % Math.max(1, furniture.length)];
          if (name) dress(name, side * 6.0, z - 2 * hash(n), H[name] || 1, side > 0 ? -Math.PI / 2 : Math.PI / 2);
          if (n % 3 === 0 && OBJ.window) dress('window', side * 7.45, z - 1, 1.6, side > 0 ? -Math.PI / 2 : Math.PI / 2)?.position.setY(1.1);
        }
      } else if (ENV === 'space') {
        // no floor: a planet curving below, a ringed planet far off, satellites on orbit lines, a deeper star field
        floorGrid.visible = false;
        const planet = OBJ.earth ? dress('earth', 0, pathEnd / 2, 60) : null;
        if (planet) planet.position.set(0, -64, pathEnd / 2);
        if (OBJ.saturn) dress('saturn', -26, pathEnd - 30, 14)?.position.setY(8);
        if (OBJ.comm_satellite) for (let k = 0; k < 4; k++) dress('comm_satellite', (k % 2 ? 1 : -1) * (13 + 5 * hash(k)), pathEnd * hash(k + 3), 1.4, hash(k) * 6)?.position.setY(5 + 3 * hash(k + 1));   // off the camera path
        const orbit = [];
        for (let r = 0; r < 3; r++) for (let a = 0; a < 128; a++) {
          const t0 = a / 128 * Math.PI * 2, t1 = (a + 1) / 128 * Math.PI * 2, R = 30 + r * 9;
          orbit.push(Math.cos(t0) * R, 2 + r * 1.5, pathEnd / 2 + Math.sin(t0) * R, Math.cos(t1) * R, 2 + r * 1.5, pathEnd / 2 + Math.sin(t1) * R);
        }
        const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(orbit, 3));
        world.add(new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: new THREE.Color(PAL.accent[1]), transparent: true, opacity: 0.25 })));
        const NS = 1600, stars = new Float32Array(NS * 3);
        for (let k = 0; k < NS; k++) stars.set([(hash(k + 900) - 0.5) * 160, (hash(k + 901) - 0.2) * 70, 30 - hash(k + 902) * (60 - pathEnd)], k * 3);
        const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(stars, 3));
        world.add(new THREE.Points(sg, new THREE.PointsMaterial(Object.assign({ color: 0xe8e4ff, size: 0.09, opacity: 0.85 }, ADD))));
      }

      // ─── bloom: bright parts blurred at quarter size and added back, so the lines glow ───
      const DPR = window.devicePixelRatio || 1, FW = Math.round(W * DPR), FH = Math.round(H * DPR), QW = Math.round(FW / 4), QH = Math.round(FH / 4);
      const rtScene = new THREE.WebGLRenderTarget(FW, FH, { samples: 4, type: THREE.HalfFloatType }), rtA = new THREE.WebGLRenderTarget(QW, QH, { type: THREE.HalfFloatType }), rtB = new THREE.WebGLRenderTarget(QW, QH, { type: THREE.HalfFloatType });
      const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quadScene = new THREE.Scene(), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); quadScene.add(quad);
      const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
      const bright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: VS, fragmentShader: `uniform sampler2D t; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv); float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(c.rgb * smoothstep(${PAL.glass ? '0.6, 1.0' : '0.25, 0.85'}, l), 1.0); }` });
      const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: VS,
        fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227; c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316; c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.070; gl_FragColor = vec4(c, 1.0); }' });
      const comp = new THREE.ShaderMaterial({ uniforms: { base: { value: null }, glow: { value: null }, fl: { value: 0 } }, vertexShader: VS,
        fragmentShader: `uniform sampler2D base; uniform sampler2D glow; uniform float fl; varying vec2 vUv; void main(){ vec3 c = texture2D(base, vUv).rgb + texture2D(glow, vUv).rgb * (${PAL.glass ? '0.45' : '1.3'} + 2.0 * fl); float v = 1.0 - smoothstep(0.35, 1.15, length(vUv - 0.5) * 1.6); c *= mix(0.6, 1.0, v); c = mix(c, vec3(1.0), clamp(fl, 0.0, 1.0) * 0.3); gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0); }` });
      const pass = (mat, target) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); };
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // the composite pass does the sRGB curve itself
      function draw() {
        renderer.setRenderTarget(rtScene); renderer.render(world, cam);
        bright.uniforms.t.value = rtScene.texture; pass(bright, rtA);
        for (const r of [1, 2.2]) { blur.uniforms.t.value = rtA.texture; blur.uniforms.d.value.set(r / QW, 0); pass(blur, rtB); blur.uniforms.t.value = rtB.texture; blur.uniforms.d.value.set(0, r / QH); pass(blur, rtA); }
        comp.uniforms.base.value = rtScene.texture; comp.uniforms.glow.value = rtA.texture; pass(comp, null);
      }

      const render = (t) => {
        for (let k = 0; k < ND; k++) { const [x, y, z, ph] = dseed[k]; dust.set([x + 0.4 * Math.sin(t * 0.3 + ph * 9), (y + t * 0.12 * (0.5 + ph)) % 12, z], k * 3); }
        dg.attributes.position.needsUpdate = true;
        const c = camAt(t);
        cam.position.copy(c.pos); cam.lookAt(c.look);
        comp.uniforms.fl.value = flashAt(t);
        spots.forEach((p, i) => { if (p.isSym) { p.holder.rotation.y = 0.35 * Math.sin(t * 0.9 + i); p.holder.position.y = p.at.y + 1.35 + 0.06 * Math.sin(t * 1.6 + i); } else p.holder.rotation.y = p.base + 0.1 * Math.sin(t * 0.5 + i); });
        SEGS.forEach((s, i) => {
          const on = t >= s.a - 0.3 && t < s.end + 0.4, u = Math.max(0, t - s.a);
          acts[i](u, on);
          if (tags[i]) tags[i].visible = on;
          if (badges[i]) { badges[i].visible = on && u > 0.3; badges[i].scale.setScalar(sp(u, 0.3, 22, 0.45)); badges[i].rotation.y = 0.4 * Math.sin(t * 1.2); badges[i].position.y += 0; }
        });
        draw();
      };
      // shaders compile asynchronously; render once before the first real frame, or that frame comes out empty
      renderer.compile(world, cam); render(0); render(0);
      return render;
    })().then(f => { frame = f; }));

    // ─── hook headline from frame 1, then caption chunks: dark text on white, the *highlighted* word in the hot colour ───
    const esc = x => x.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const hot = (s) => esc(s).replace(/\*([^*]+)\*/g, (_, h) => `<span style="color:${PAL.hot}">${h}</span>`).replace(/\*/g, '');
    const hook = SEGS[0];
    // longer formula hooks (up to 9 words) get a smaller size so they stay 3 lines, below Instagram's top bar
    const head = txt(root, '', { x: W / 2, y: 0.17 * H, size: hook.text.split(/ +/).length > 6 ? 78 : 92, font: F.RUBIK, weight: 900, color: '#FFFFFF', dir: DIR,
      css: { whiteSpace: 'normal', width: '940px', textAlign: 'center', lineHeight: 1.12, textShadow: `0 0 30px ${PAL.accent[0]}, 0 5px 0 #000, 0 0 4px #000` } });
    // the hook lands word by word, each one punching in, so the first second already moves
    const hw = hook.text.split(/ +/).filter(Boolean);
    head.inner.innerHTML = hw.map(w => `<span style="display:inline-block;margin:0 0.2em${w.includes('*') ? `;color:${PAL.hot}` : ''}">${esc(w.replace(/\*/g, ''))}</span>`).join(' ');
    const hspans = [...head.inner.querySelectorAll('span')], hstep = Math.min(0.22, Math.max(0.1, (hook.b - 0.1) * 0.6 / Math.max(1, hw.length)));
    const hwAt = hw.map((_, k) => 0.05 + k * hstep), hwHot = hw.map(w => w.includes('*'));
    const caps = [];
    for (const s of SEGS.slice(1)) {
      const words = s.text.split(/ +/).filter(Boolean), chunks = [];
      for (const w of words) { const l = chunks[chunks.length - 1]; if (l && l.length < 3 && l.join(' ').length + w.length < 16 && !/[.,?!]$/.test(l[l.length - 1])) l.push(w); else chunks.push([w]); }
      const total = chunks.reduce((n, c) => n + c.join(' ').length, 0) || 1;
      let a0 = s.a;
      for (const c of chunks) {
        const len = (s.b - s.a) * c.join(' ').length / total;
        const e = txt(root, '', { x: W / 2, y: 0.66 * H, size: 66, font: F.RUBIK, weight: 900, color: '#0F172A', dir: DIR,
          css: { background: '#FFFFFF', borderRadius: '18px', padding: '14px 32px', boxShadow: '0 10px 30px rgba(15,23,42,0.18)' } });
        e.inner.innerHTML = c.map(hot).join(' ');
        caps.push({ e, a: a0, b: a0 + len }); a0 += len;
      }
    }
    caps.forEach((c, i) => { c.b = i + 1 < caps.length && caps[i + 1].a - c.b < 0.5 ? caps[i + 1].a : c.b + 0.25; });
    // the follow moment: on the word "Follow" / "תעקבו" a profile card slides up, a hand taps its Follow button with a
    // click, and the button turns into "Followed ✓" with a success chime
    const last = SEGS[SEGS.length - 1], he = VIDEO.lang !== 'en';
    const fcap = caps.filter(c => c.a >= last.a - 0.01).find(c => /follow|תעקבו|עקבו/i.test(c.e.inner.textContent));
    // the card is up for the whole last line; the tap lands on the spoken word (its time from the transcript)
    // noFollow: model-library stills, where the card would sit on top of the model
    const NOFOLLOW = !!VIDEO.noFollow;
    const tapAt = NOFOLLOW ? 1e9 : Math.min(DUR - 0.9, last.f ?? (fcap ? fcap.a : last.a + (last.b - last.a) * 0.6)), cardAt = NOFOLLOW ? 1e9 : Math.max(0, Math.min(last.a - 0.15, tapAt - 0.8));
    const card = txt(root, '', { x: W / 2, y: 0.47 * H, size: 40, font: F.RUBIK, weight: 800, color: '#FFFFFF', dir: DIR,
      css: { background: 'rgba(18,18,28,0.92)', borderRadius: '36px', padding: '26px 30px', boxShadow: `0 20px 60px rgba(0,0,0,0.5), 0 0 40px ${PAL.accent[0]}55`, border: '2px solid rgba(255,255,255,0.12)', zoom: '1.3' } });
    card.inner.innerHTML = `<div style="display:flex;align-items:center;gap:26px;direction:ltr">
      <div style="width:104px;height:104px;border-radius:50%;padding:5px;background:linear-gradient(45deg,#f9ce34,#ee2a7b,#6228d7)"><div style="width:100%;height:100%;border-radius:50%;background:#0b0a24;border:4px solid #12121c;display:flex;align-items:center;justify-content:center;font-size:30px;color:${PAL.accent[1]}">${he ? 'MTK' : 'MTK'}</div></div>
      <div style="text-align:left"><div style="font-size:38px">${he ? 'mortoknow' : 'moretoknow1'}</div><div style="font-size:26px;font-weight:500;opacity:0.65">${he ? 'טכנולוגיה מבפנים' : 'Tech, from the inside'}</div></div>
      <div class="fb" style="position:relative;min-width:250px;text-align:center;padding:18px 34px;border-radius:18px;background:#0095f6;font-size:40px">
        <span class="f0">${he ? 'עקבו' : 'Follow'}</span><span class="f1" style="display:none">${he ? 'במעקב ✓' : 'Following ✓'}</span></div></div>`;
    const fbtn = card.inner.querySelector('.fb'), f0 = card.inner.querySelector('.f0'), f1 = card.inner.querySelector('.f1');
    const hand = txt(root, '', { x: W / 2, y: 0.47 * H, size: 150, font: F.RUBIK, weight: 400, color: '#FFFFFF', css: { filter: 'drop-shadow(0 10px 18px rgba(0,0,0,0.6))' } });
    // a tap cursor (drawn, so it needs no emoji font on the render machine) with the ripple of the tap
    hand.inner.innerHTML = '<svg width="110" height="140" viewBox="0 0 22 28"><path d="M2 1 L2 21 L7 16.5 L10.5 25 L14 23.5 L10.6 15.2 L17 15.2 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const ripple = txt(root, '', { x: W / 2, y: 0.47 * H, size: 10, css: { width: '120px', height: '120px', borderRadius: '50%', border: '6px solid rgba(255,255,255,0.9)' } });
    let bx = null;   // the button's centre from the card's centre, measured once the card is laid out
    if (!NOFOLLOW) { sfx(cardAt, 'whoosh', 0.6); sfx(tapAt, 'click', 1.2); sfx(tapAt + 0.05, 'pop', 0.8); sfx(tapAt + 0.12, 'success', 0.9); }
    const COVER = !!window.COVER;
    const title = COVER ? txt(root, '', { x: W / 2, y: 0.68 * H, size: 120, font: F.RUBIK, weight: 900, color: '#FFFFFF', dir: DIR,
      css: { whiteSpace: 'normal', width: '900px', textAlign: 'center', lineHeight: 1.08, textShadow: `0 0 40px ${PAL.accent[0]}, 0 6px 0 #000` } }) : null;
    if (title) { const ws = (VIDEO.title || '').split(/ +/), h = ws.reduce((a, w, i) => w.length > ws[a].length ? i : a, 0); title.inner.innerHTML = ws.map((w, i) => i === h ? `<span style="color:${PAL.hot}">${esc(w)}</span>` : esc(w)).join(' '); }

    return t => {
      if (frame) frame(t);
      if (COVER) { tf(head, { o: 0 }); caps.forEach(cp => tf(cp.e, { o: 0 })); return; }
      tf(head, { o: 1 - seg(t, hook.end - 0.15, hook.end + 0.1), s: 1 });
      hspans.forEach((e, k) => { const on = t >= hwAt[k], big = hwHot[k] ? 1.22 : 1;
        e.style.opacity = on ? 1 : 0; e.style.transform = `scale(${on ? lerp(2.2, big, sp(t, hwAt[k], 26, 0.45)) : 2.2})`; });
      for (const cp of caps) { const on = t >= cp.a && t < cp.b, hit = cp.e.inner.innerHTML.includes(PAL.hot);
        tf(cp.e, { o: on ? 1 : 0, s: on ? lerp(hit ? 0.45 : 0.75, hit ? 1.12 : 1, sp(t, cp.a, 30, hit ? 0.35 : 0.5)) : 1 }); }
      const ci = E.o3(seg(t, cardAt, cardAt + 0.4));
      tf(card, { o: ci, y: (1 - ci) * 160, s: lerp(0.85, 1, ci) });
      const done = t >= tapAt;
      f0.style.display = done ? 'none' : ''; f1.style.display = done ? '' : 'none';
      fbtn.style.background = done ? '#363645' : '#0095f6';
      fbtn.style.transform = `scale(${t < tapAt - 0.08 ? 1 : t < tapAt + 0.06 ? 0.88 : lerp(0.88, 1, sp(t, tapAt + 0.06, 24, 0.4))})`;
      const hi = seg(t, tapAt - 0.55, tapAt - 0.08), press = t > tapAt - 0.08 && t < tapAt + 0.08 ? 1 : 0, out = seg(t, tapAt + 0.35, tapAt + 0.8);
      if (bx === null && ci > 0) { const a = fbtn.getBoundingClientRect(), b = card.inner.getBoundingClientRect(), k = W / root.getBoundingClientRect().width; bx = ((a.left + a.right) - (b.left + b.right)) / 2 * k; }
      const rp = seg(t, tapAt, tapAt + 0.45); tf(ripple, { o: rp > 0 && rp < 1 ? 1 - rp : 0, x: bx || 0, s: lerp(0.3, 1.6, rp) });
      tf(hand, { o: Math.min(hi * 3, 1 - out), x: (bx || 0) + 55 + (1 - E.o3(hi)) * 220 + out * 120, y: 70 + (1 - E.o3(hi)) * 260 + out * 200, s: press ? 0.88 : 1 });
    };
  });
})();
