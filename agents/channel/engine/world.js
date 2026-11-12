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

      // ─── materials ───
      const M = {
        glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0d12, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }),
        titanium: new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.28, metalness: 0.95 }),
        alu: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, roughness: 0.32, metalness: 0.9 }),
        darkMetal: new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.35, metalness: 0.85 }),
        white: new THREE.MeshPhysicalMaterial({ color: 0xf7f7f5, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
        black: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.4, metalness: 0.2 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xd4a23a, roughness: 0.3, metalness: 1 }),
        chrome: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.08, metalness: 1 }),
        pcb: new THREE.MeshStandardMaterial({ color: 0x0f6b3a, roughness: 0.6, metalness: 0.1 }),
        lens: new THREE.MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.02, metalness: 0.4, clearcoat: 1 }),
      };
      const plastic = (c) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.15 });
      const glow = (c, i = 2) => new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(c), emissiveIntensity: i });
      const screenMat = (t) => new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.85, roughness: 0.15 });
      const mesh = (geo, mat, at = [0, 0, 0], rot = [0, 0, 0]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...at); m.rotation.set(...rot); m.castShadow = true; m.receiveShadow = true; return m; };
      const rbox = (w, h, d, r, mat, at, rot) => mesh(new RoundedBoxGeometry(w, h, d, 4, Math.min(r, w / 2, h / 2, d / 2)), mat, at, rot);
      const cyl = (r1, r2, h, mat, at, rot, n = 32) => mesh(new THREE.CylinderGeometry(r1, r2, h, n), mat, at, rot);
      const sph = (r, mat, at) => mesh(new THREE.SphereGeometry(r, 32, 24), mat, at);
      const group = (...parts) => { const g = new THREE.Group(); parts.forEach(p => g.add(p)); return g; };
      const plane = (w, h, mat, at, rot) => mesh(new THREE.PlaneGeometry(w, h), mat, at, rot);

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
      function neonize(root, c) {
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
          if (m.material.emissiveMap) { m.material = new THREE.MeshBasicMaterial(Object.assign({ map: m.material.emissiveMap, opacity: 0.45 }, ADD)); continue; }   // screens keep their picture
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
      const APP = ['#34c759', '#0a84ff', '#ff9f0a', '#ff375f', '#5e5ce6', '#64d2ff', '#ffd60a', '#bf5af2', '#ff453a', '#30d158', '#0a84ff', '#ff9f0a'];
      const phoneScreen = tex(512, 1060, (x, w, h) => {
        const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, PAL.accent[0]); g.addColorStop(1, PAL.accent[1]); x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(255,255,255,0.95)'; x.font = '600 44px Rubik'; x.textAlign = 'center'; x.fillText('9:41', 110, 72);
        x.fillStyle = '#000'; roundRect(x, w / 2 - 70, 26, 140, 42, 21);                       // the camera pill
        for (let k = 0; k < 16; k++) { x.fillStyle = APP[k % APP.length]; roundRect(x, 46 + (k % 4) * 112, 170 + Math.floor(k / 4) * 132, 84, 84, 22); }
        x.fillStyle = 'rgba(255,255,255,0.3)'; roundRect(x, 28, h - 170, w - 56, 130, 44);   // dock
        for (let k = 0; k < 4; k++) { x.fillStyle = APP[(k * 3 + 1) % APP.length]; roundRect(x, 56 + k * 112, h - 147, 84, 84, 22); }
      });
      const laptopScreen = tex(1024, 640, (x, w, h) => {
        x.fillStyle = '#f2f4f8'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#d9dde5'; x.fillRect(0, 0, w, 54); ['#ff5f57', '#febc2e', '#28c840'].forEach((c, k) => { x.fillStyle = c; x.beginPath(); x.arc(30 + k * 32, 27, 10, 0, 7); x.fill(); });
        x.fillStyle = '#fff'; roundRect(x, 160, 12, 700, 30, 15);
        x.fillStyle = PAL.accent[0]; roundRect(x, 60, 100, 560, 70, 14);
        x.fillStyle = '#c9ced8'; for (let k = 0; k < 6; k++) roundRect(x, 60, 200 + k * 50, 300 + 200 * hash(k), 22, 11);
        x.fillStyle = PAL.accent[1]; roundRect(x, 680, 100, 280, 280, 20);
      });
      const watchFace = tex(256, 300, (x, w, h) => {
        x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
        [[PAL.accent[1], 100], [PAL.accent[3], 78], [PAL.accent[0], 56]].forEach(([c, r], k) => { x.strokeStyle = c; x.lineWidth = 18; x.lineCap = 'round'; x.beginPath(); x.arc(w / 2, h / 2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * (1.2 + 0.25 * k)); x.stroke(); });
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
      const keysTex = tex(512, 200, (x, w, h) => { x.fillStyle = '#2a2d33'; x.fillRect(0, 0, w, h); x.fillStyle = '#111317'; for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) roundRect(x, 6 + c * 36, 8 + r * 38, 30, 32, 5); });
      const bayTex = tex(256, 512, (x, w, h) => { x.fillStyle = '#1f232a'; x.fillRect(0, 0, w, h); for (let k = 0; k < 10; k++) { x.fillStyle = '#2c313a'; roundRect(x, 14, 14 + k * 50, w - 28, 40, 6); x.fillStyle = k % 3 ? '#22d36b' : '#2f7bff'; x.beginPath(); x.arc(w - 36, 34 + k * 50, 6, 0, 7); x.fill(); } });
      const panelTex = tex(256, 256, (x, w, h) => { x.fillStyle = '#1f3e9a'; x.fillRect(0, 0, w, h); x.strokeStyle = '#7fa6ff'; x.lineWidth = 3; for (let k = 0; k <= 8; k++) { x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32, h); x.stroke(); x.beginPath(); x.moveTo(0, k * 32); x.lineTo(w, k * 32); x.stroke(); } });

      // ─── the object library. Each builder returns a group sitting on y = 0, about 1-2 units tall ───
      const OBJ = {
        phone: () => {
          const g = group(rbox(0.78, 1.6, 0.085, 0.11, M.titanium), rbox(0.74, 1.56, 0.02, 0.1, M.glass, [0, 0, 0.034]),
            plane(0.68, 1.48, screenMat(phoneScreen), [0, 0, 0.0451]), rbox(0.34, 0.34, 0.03, 0.07, M.glass, [-0.17, 0.55, -0.055]));
          [[-0.25, 0.63], [-0.1, 0.63], [-0.25, 0.48]].forEach(([x, y]) => g.add(cyl(0.055, 0.055, 0.03, M.lens, [x, y, -0.075], [Math.PI / 2, 0, 0]), cyl(0.065, 0.065, 0.02, M.chrome, [x, y, -0.066], [Math.PI / 2, 0, 0])));
          g.rotation.x = -0.12; g.position.y = 0.83; return group(g);
        },
        laptop: () => {
          const lid = group(rbox(1.9, 1.2, 0.04, 0.04, M.alu, [0, 0.6, 0]), plane(1.78, 1.08, M.black, [0, 0.6, 0.021]), plane(1.7, 1.0, screenMat(laptopScreen), [0, 0.6, 0.022]));
          lid.position.set(0, 0.05, -0.65); lid.rotation.x = -0.25;
          return group(rbox(1.9, 0.06, 1.3, 0.03, M.alu, [0, 0.03, 0]), plane(1.6, 0.6, new THREE.MeshStandardMaterial({ map: keysTex, roughness: 0.6 }), [0, 0.061, -0.2], [-Math.PI / 2, 0, 0]),
            rbox(0.6, 0.005, 0.36, 0.02, M.titanium, [0, 0.061, 0.36]), lid);
        },
        router: () => {
          const g = group(rbox(1.5, 0.32, 1.0, 0.12, M.white, [0, 0.16, 0]));
          [-0.55, -0.18, 0.18, 0.55].forEach((x, k) => g.add(rbox(0.09, 1.0, 0.09, 0.04, M.black, [x, 0.75, -0.42], [0.08 * (k - 1.5), 0, -0.12 * (k - 1.5)])));
          [-0.4, -0.2, 0, 0.2, 0.4].forEach((x, k) => g.add(sph(0.025, glow(k === 2 ? '#2f7bff' : '#22d36b', 3), [x, 0.22, 0.5])));
          return g;
        },
        earbuds: () => {
          const bud = (x) => group(sph(0.16, M.white, [0, 0.1, 0]), cyl(0.045, 0.04, 0.38, M.white, [0, -0.15, 0.02]), sph(0.06, M.black, [0, 0.1, 0.15]));
          const l = bud(-0.32), r = bud(0.32); l.position.set(-0.32, 1.25, 0); r.position.set(0.32, 1.25, 0); r.rotation.z = -0.25; l.rotation.z = 0.25;
          return group(rbox(1.0, 0.75, 0.42, 0.2, M.white, [0, 0.375, 0]), cyl(0.025, 0.025, 0.02, glow('#22d36b'), [0, 0.45, 0.215], [Math.PI / 2, 0, 0]), l, r);
        },
        watch: () => group(rbox(0.42, 1.7, 0.06, 0.03, plastic(PAL.accent[3]), [0, 0.85, -0.02]), rbox(0.78, 0.9, 0.22, 0.2, M.titanium, [0, 0.85, 0.06]),
          rbox(0.7, 0.82, 0.02, 0.17, M.glass, [0, 0.85, 0.17]), plane(0.6, 0.72, screenMat(watchFace), [0, 0.85, 0.181]), cyl(0.06, 0.06, 0.1, M.chrome, [0.42, 1.0, 0.06], [0, 0, Math.PI / 2])),
        tv: () => group(rbox(2.4, 1.4, 0.06, 0.03, M.black, [0, 1.1, 0]), plane(2.32, 1.32, screenMat(tvScreen), [0, 1.1, 0.031]), cyl(0.08, 0.08, 0.4, M.darkMetal, [0, 0.2, -0.05]), rbox(0.9, 0.04, 0.4, 0.02, M.darkMetal, [0, 0.02, -0.05])),
        server: () => group(rbox(1.0, 2.2, 0.9, 0.04, M.darkMetal, [0, 1.1, 0]), plane(0.88, 2.0, new THREE.MeshStandardMaterial({ map: bayTex, emissive: 0xffffff, emissiveMap: bayTex, emissiveIntensity: 0.35, roughness: 0.5 }), [0, 1.1, 0.451])),
        chip: () => {
          const g = group(rbox(1.6, 0.08, 1.6, 0.03, M.pcb, [0, 0.04, 0]), rbox(0.8, 0.1, 0.8, 0.03, M.black, [0, 0.13, 0]), rbox(0.5, 0.012, 0.5, 0.02, M.titanium, [0, 0.185, 0]));
          for (let k = 0; k < 8; k++) { const o = -0.33 + k * 0.094; g.add(rbox(0.04, 0.02, 0.14, 0.005, M.gold, [o, 0.09, 0.47]), rbox(0.04, 0.02, 0.14, 0.005, M.gold, [o, 0.09, -0.47]), rbox(0.14, 0.02, 0.04, 0.005, M.gold, [0.47, 0.09, o]), rbox(0.14, 0.02, 0.04, 0.005, M.gold, [-0.47, 0.09, o])); }
          return g;
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
        globe: () => { const e = sph(0.8, new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.5 }), [0, 1.0, 0]); e.rotation.z = 0.4; return group(e, cyl(0.3, 0.4, 0.12, M.darkMetal, [0, 0.06, 0])); },
        lock: () => group(rbox(0.9, 0.75, 0.32, 0.1, new THREE.MeshPhysicalMaterial({ color: 0xf2b632, roughness: 0.3, metalness: 0.45, clearcoat: 1, emissive: 0x4a3000, emissiveIntensity: 0.3 }), [0, 0.4, 0]), mesh(new THREE.TorusGeometry(0.28, 0.06, 16, 32, Math.PI), M.chrome, [0, 0.78, 0]),
          cyl(0.06, 0.06, 0.2, M.chrome, [-0.28, 0.82, 0]), cyl(0.06, 0.06, 0.2, M.chrome, [0.28, 0.82, 0]), cyl(0.06, 0.06, 0.04, M.black, [0, 0.42, 0.165], [Math.PI / 2, 0, 0])),
        charger: () => group(cyl(0.6, 0.62, 0.08, M.white, [0, 0.04, 0], [0, 0, 0], 64), mesh(new THREE.TorusGeometry(0.42, 0.015, 8, 64), glow('#22d3ee', 3), [0, 0.082, 0], [Math.PI / 2, 0, 0]),
          rbox(0.08, 0.04, 0.6, 0.02, M.white, [0, 0.02, 0.85])),
        controller: () => {
          const body = plastic(PAL.accent[0]);
          const g = group(rbox(1.3, 0.25, 0.6, 0.12, body, [0, 0.2, 0]), sph(0.32, body, [-0.55, 0.15, 0.15]), sph(0.32, body, [0.55, 0.15, 0.15]),
            cyl(0.1, 0.1, 0.08, M.black, [-0.35, 0.35, 0.02]), cyl(0.1, 0.1, 0.08, M.black, [0.15, 0.35, 0.15]));
          ['#ff453a', '#34c759', '#0a84ff', '#ffd60a'].forEach((c, k) => g.add(sph(0.045, plastic(c), [0.42 + 0.1 * Math.cos(k * Math.PI / 2), 0.36, -0.05 + 0.1 * Math.sin(k * Math.PI / 2)])));
          g.rotation.x = -0.5; g.position.y = 0.2; return group(g);
        },
        car: () => {
          const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(PAL.accent[1]), metalness: 0.5, roughness: 0.25, clearcoat: 1 });
          const g = group(rbox(2.2, 0.5, 1.0, 0.18, paint, [0, 0.45, 0]), rbox(1.2, 0.45, 0.9, 0.2, M.glass, [-0.1, 0.85, 0]));
          [[-0.7, 0.5], [0.7, 0.5], [-0.7, -0.5], [0.7, -0.5]].forEach(([x, z]) => g.add(cyl(0.24, 0.24, 0.16, M.black, [x, 0.24, z], [Math.PI / 2, 0, 0]), cyl(0.13, 0.13, 0.17, M.chrome, [x, 0.24, z], [Math.PI / 2, 0, 0])));
          g.add(sph(0.07, glow('#fff7cc', 2.5), [1.1, 0.5, 0.32]), sph(0.07, glow('#fff7cc', 2.5), [1.1, 0.5, -0.32]));
          return g;
        },
        house: () => {
          const roof = mesh(new THREE.CylinderGeometry(0.01, 1.25, 0.8, 4), plastic(PAL.accent[1]), [0, 1.6, 0], [0, Math.PI / 4, 0]);
          return group(rbox(1.6, 1.2, 1.4, 0.04, M.white, [0, 0.6, 0]), roof, rbox(0.34, 0.6, 0.04, 0.02, plastic(PAL.accent[0]), [0.35, 0.3, 0.71]),
            rbox(0.4, 0.34, 0.04, 0.02, glow('#ffe08a', 1.2), [-0.4, 0.75, 0.71]));
        },
      };

      // ─── glossy 3D symbols (Wi-Fi, Bluetooth, lock...): extruded shapes and tubes, floating above their pedestal ───
      const ext = (shape, mat, depth = 0.14) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03, bevelSegments: 4, curveSegments: 32 }); g.center(); return mesh(g, mat); };
      const tube = (pts, r, mat) => mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y]) => V(x, y, 0)), false, 'catmullrom', 0), 64, r, 16), mat);
      const arc = (r1, r2, a0, a1) => { const s = new THREE.Shape(); s.absarc(0, 0, r2, a0, a1, false); s.absarc(0, 0, r1, a1, a0, true); return s; };
      const sym = (c) => new THREE.MeshPhysicalMaterial({ color: new THREE.Color(c), roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08, emissive: new THREE.Color(c), emissiveIntensity: 0.18 });
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
        neonize(obj, c);
        const holder = new THREE.Group(); holder.add(obj); holder.position.copy(at).add(V(0, isSym ? 1.35 : 0.22, 0)); world.add(holder);
        const box = new THREE.Box3().setFromObject(holder), size = box.getSize(V()), h = Math.max(size.y, size.x * 0.8);
        const fit = isSym ? 1.3 / Math.max(size.x, size.y) : Math.min(1, 2.2 / Math.max(size.x, size.y));
        obj.scale.setScalar(fit);
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
        explode: (s, sp) => {
          const kids = sp.obj.children.flatMap(c => c.isGroup ? c.children : [c]).map((c, k) => ({ c, o: c.position.clone(), d: V(Math.cos(k * 2.4), 0.6 + 0.4 * hash(k), Math.sin(k * 2.4)).multiplyScalar(0.35) }));
          sfx(s.a + 0.3, 'whoosh', 0.5);
          return (u) => { const f = E.io3(seg(u, 0.2, 0.9)) * (1 - E.io3(seg(u, (s.end - s.a) - 0.7, (s.end - s.a) - 0.1))); kids.forEach(({ c, o, d }) => c.position.copy(o).addScaledVector(d, f)); };
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
      // fast whip cuts between lines (viewers left a slow glide), a spring overshoot on arrival, a constant drift
      const camAt = t => {
        let i = 0; while (i + 1 < SEGS.length && t >= SEGS[i + 1].a - 0.22) i++;
        const k = keys[i], pv = keys[Math.max(0, i - 1)], f = i === 0 ? 1 : E.io3(seg(t, SEGS[i].a - 0.22, SEGS[i].a + 0.2));
        const u = t - SEGS[i].a, len = SEGS[i].end - SEGS[i].a;
        const look = pv.look.clone().lerp(k.look, f), az = lerp(pv.az, k.az, f) + 0.1 * u, el = lerp(pv.el, k.el, f);
        let dist = lerp(pv.dist, k.dist, f) * (1 - 0.12 * clamp(u / Math.max(1, len), 0, 1));
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
        const m = OBJ[name](); neonize(m, PAL.accent[0]);
        const mats = new Set(); m.traverse(o => { if (o.material) mats.add(o.material); });   // parts share materials: dim each one once
        for (const mt of mats) { if (mt.uniforms && mt.uniforms.c) mt.uniforms.c.value.multiplyScalar(0.6); if (mt.isLineBasicMaterial) mt.opacity *= 0.55; }
        const box = new THREE.Box3().setFromObject(m), size = box.getSize(V());
        m.scale.setScalar(height / Math.max(size.y, 1e-6)); m.position.set(x, 0, z); m.rotation.y = rot; world.add(m); return m;
      };
      const pathEnd = -SEGS.length * 4.6 - 12;
      if (ENV === 'city') {
        // a main avenue the camera travels down (the spots stand on it), blocks of buildings on both sides, cross streets,
        // parked cars and traffic lights at the corners: the Grouper city
        const towers = ['city_building', 'apartment_building', 'skyscraper', 'glass_skyscraper', 'office_building', 'tower_building', 'city_building_color'].filter(n => OBJ[n]);
        const cars = ['sports_car', 'police_car', 'delivery_truck'].filter(n => OBJ[n]);
        const road = [];
        for (let z = 14; z > pathEnd; z -= 12) {
          for (const side of [-1, 1]) for (let col = 0; col < 3; col++) {
            const k = Math.round(z * 7 + side * 3 + col * 11);
            if (towers.length) dress(towers[Math.floor(hash(k) * towers.length)], side * (8 + col * 6 + 1.5 * hash(k + 1)), z - 2 - 6 * hash(k + 2), 4 + 9 * hash(k + 3) + col * 3, hash(k + 4) * 6.28);
          }
          road.push(-40, 0.01, z - 9, 40, 0.01, z - 9, -40, 0.01, z - 11, 40, 0.01, z - 11);                 // a cross street
          if (cars.length) dress(cars[Math.floor(hash(z) * cars.length)], (hash(z + 5) > 0.5 ? 1 : -1) * 5.6, z - 5, 0.9, Math.PI / 2 * (hash(z + 6) > 0.5 ? 1 : -1));
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
    };
  });
})();
