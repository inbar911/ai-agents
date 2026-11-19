// The whiteboard: a 1600×1000 dry-erase board drawn live with the whiteboard engine (wb.js, MIT, Lemo-Opuscar).
// It is laid out from script.json: panels of items (icons, text, big words, arrows, crosses, checks) placed in fixed
// slots, each drawn on a spoken word. Between panels the eraser wipes the board; the title strip stays.
import * as W from './wb.js';
import { mulberry } from './lib.js';

export const BW = 1600, BH = 1000, BQ = 1.5;   // the board texture is drawn at 1.5x for sharp ink
export const SLOTS = { L: [300, 500], C: [800, 500], R: [1300, 500], BL: [300, 770], BC: [800, 770], BR: [1300, 770], TOP: [800, 290], BOTTOM: [800, 935] };

// ───────── doodle icons, drawn in a ~220 px box around (x, y)
let CX = 0, CY = 0;
const ICONS = (() => {
  // every icon is drawn around (x, y); ICON_SCALE grows it about that centre
  const S = 1.4, X = v => CX + (v - CX) * S, Y = v => CY + (v - CY) * S, pts = p => p.map(([x, y]) => [X(x), Y(y)]);
  const L = (x0, y0, x1, y1, o) => W.line(X(x0), Y(y0), X(x1), Y(y1), o), C = (x, y, r, o) => W.circle(X(x), Y(y), r * S, o);
  const R = (x, y, w, h, r, o) => W.roundRect(X(x), Y(y), w * S, h * S, r * S, o), RC = (x, y, w, h, o) => W.rect(X(x), Y(y), w * S, h * S, o);
  const A = (x, y, r, a0, a1, o) => W.arc(X(x), Y(y), r * S, a0, a1, o), P = (p, o) => W.poly(pts(p), o), CU = (p, o) => W.curve(pts(p), o);
  const TX = (str, x, y, o) => W.text(str, X(x), Y(y), { ...o, h: (o.h || 60) * S });
  const o = { w: 9 }, t = { w: 7 };
  const at = f => (x, y) => { CX = x; CY = y; return f(x, y); };
  return Object.fromEntries(Object.entries({
    phone: (x, y) => [R(x - 55, y - 100, 110, 200, 18, o), L(x - 18, y - 80, x + 18, y - 80, t), C(x, y + 78, 8, t)],
    card: (x, y) => [R(x - 100, y - 62, 200, 124, 14, o), L(x - 100, y - 25, x + 100, y - 25, { w: 14 }), L(x - 75, y + 30, x - 15, y + 30, t)],
    reader: (x, y) => [R(x - 70, y - 100, 140, 200, 20, o), ...RC(x - 45, y - 75, 90, 60, { w: 6, over: 3 }), ...[0, 1, 2].map(k => L(x - 40 + k * 30, y + 40, x - 25 + k * 30, y + 40, { w: 8 }))],
    cup: (x, y) => [P([[x - 60, y - 70], [x - 45, y + 90], [x + 45, y + 90], [x + 60, y - 70]], o), L(x - 70, y - 70, x + 70, y - 70, { w: 9 }), CU([[x - 15, y - 95], [x - 28, y - 125], [x - 10, y - 155]], { w: 5 }), CU([[x + 18, y - 95], [x + 5, y - 125], [x + 22, y - 155]], { w: 5 })],
    bank: (x, y) => [P([[x - 110, y - 40], [x, y - 100], [x + 110, y - 40], [x - 110, y - 40]], o), ...[-75, -25, 25, 75].map(d => L(x + d, y - 25, x + d, y + 60, o)), L(x - 120, y + 78, x + 120, y + 78, { w: 9 })],
    cloud: (x, y) => [CU([[x - 110, y + 40], [x - 125, y - 10], [x - 70, y - 50], [x - 20, y - 75], [x + 45, y - 60], [x + 95, y - 55], [x + 125, y - 5], [x + 105, y + 40], [x - 110, y + 40]], o)],
    server: (x, y) => [0, 1, 2].flatMap(k => [R(x - 90, y - 95 + k * 65, 180, 55, 10, o), C(x + 60, y - 68 + k * 65, 7, t)]),
    database: (x, y) => [A(x, y - 70, 80, 0, Math.PI * 2.1, o), L(x - 80, y - 70, x - 80, y + 70, o), L(x + 80, y - 70, x + 80, y + 70, o), A(x, y + 70, 80, 0, Math.PI, o), A(x, y, 80, 0, Math.PI, t)],
    lock: (x, y) => [R(x - 70, y - 20, 140, 110, 14, o), A(x, y - 20, 48, Math.PI, Math.PI * 2, o), C(x, y + 30, 12, t)],
    key: (x, y) => [C(x - 60, y, 38, o), L(x - 22, y, x + 95, y, o), L(x + 60, y, x + 60, y + 30, o), L(x + 85, y, x + 85, y + 25, o)],
    person: (x, y) => [C(x, y - 70, 32, o), L(x, y - 38, x, y + 40, o), L(x, y - 10, x - 45, y + 20, o), L(x, y - 10, x + 45, y + 20, o), L(x, y + 40, x - 35, y + 100, o), L(x, y + 40, x + 35, y + 100, o)],
    laptop: (x, y) => [R(x - 90, y - 80, 180, 115, 10, o), P([[x - 120, y + 45], [x + 120, y + 45], [x + 105, y + 70], [x - 105, y + 70], [x - 120, y + 45]], o)],
    wifi: (x, y) => [0, 1, 2].map(k => A(x, y + 50, 40 + k * 40, Math.PI * 1.2, Math.PI * 1.8, o)).concat([C(x, y + 50, 7, { w: 9 })]),
    globe: (x, y) => [C(x, y, 90, o), L(x - 90, y, x + 90, y, t), A(x, y, 90, Math.PI * .5, Math.PI * 1.5, t), CU([[x, y - 90], [x + 40, y], [x, y + 90]], t)],
    mail: (x, y) => [R(x - 100, y - 65, 200, 130, 10, o), P([[x - 100, y - 60], [x, y + 10], [x + 100, y - 60]], o)],
    clock: (x, y) => [C(x, y, 85, o), L(x, y, x, y - 55, o), L(x, y, x + 40, y + 15, o)],
    coin: (x, y) => [C(x, y, 75, o), ...TX('$', x, y + 30, { h: 90, w: 9, align: 'center' })],
    ticket: (x, y) => [P([[x - 110, y - 55], [x + 110, y - 55], [x + 110, y - 15], [x + 95, y], [x + 110, y + 15], [x + 110, y + 55], [x - 110, y + 55], [x - 110, y + 15], [x - 95, y], [x - 110, y - 15], [x - 110, y - 55]], o)],
    shield: (x, y) => [P([[x, y - 95], [x + 80, y - 65], [x + 70, y + 30], [x, y + 95], [x - 70, y + 30], [x - 80, y - 65], [x, y - 95]], o)],
    chip: (x, y) => [R(x - 65, y - 65, 130, 130, 10, o), ...[-35, 0, 35].flatMap(d => [L(x + d, y - 65, x + d, y - 95, t), L(x + d, y + 65, x + d, y + 95, t), L(x - 65, y + d, x - 95, y + d, t), L(x + 65, y + d, x + 95, y + d, t)])],
    house: (x, y) => [P([[x - 90, y - 10], [x, y - 95], [x + 90, y - 10]], o), R(x - 70, y - 20, 140, 110, 6, o), R(x - 20, y + 30, 40, 60, 4, t)],
    car: (x, y) => [P([[x - 110, y + 20], [x - 100, y - 20], [x - 50, y - 25], [x - 25, y - 65], [x + 45, y - 65], [x + 70, y - 25], [x + 110, y - 15], [x + 110, y + 20], [x - 110, y + 20]], o), C(x - 55, y + 30, 25, o), C(x + 60, y + 30, 25, o)],
    battery: (x, y) => [R(x - 100, y - 45, 190, 90, 12, o), R(x + 92, y - 18, 18, 36, 4, t), L(x - 75, y - 20, x - 75, y + 20, { w: 14 }), L(x - 45, y - 20, x - 45, y + 20, { w: 14 })],
    bulb: (x, y) => [A(x, y - 30, 60, Math.PI * .75, Math.PI * 2.25, o), L(x - 25, y + 30, x + 25, y + 30, o), L(x - 20, y + 55, x + 20, y + 55, o)],
    gear: (x, y) => [C(x, y, 60, o), C(x, y, 22, t), ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => { const a = k * Math.PI / 4; return L(x + Math.cos(a) * 60, y + Math.sin(a) * 60, x + Math.cos(a) * 88, y + Math.sin(a) * 88, { w: 12 }); })],
    cart: (x, y) => [P([[x - 110, y - 70], [x - 75, y - 70], [x - 45, y + 30], [x + 80, y + 30], [x + 100, y - 40], [x - 65, y - 40]], o), C(x - 35, y + 65, 15, o), C(x + 65, y + 65, 15, o)],
    chat: (x, y) => [P([[x - 100, y - 65], [x + 100, y - 65], [x + 100, y + 40], [x - 30, y + 40], [x - 65, y + 80], [x - 60, y + 40], [x - 100, y + 40], [x - 100, y - 65]], o)],
    eye: (x, y) => [CU([[x - 110, y], [x, y - 65], [x + 110, y]], o), CU([[x - 110, y], [x, y + 65], [x + 110, y]], o), C(x, y, 30, o)],
    document: (x, y) => [P([[x - 65, y - 95], [x + 35, y - 95], [x + 65, y - 65], [x + 65, y + 95], [x - 65, y + 95], [x - 65, y - 95]], o), ...[0, 1, 2].map(k => L(x - 40, y - 40 + k * 40, x + 40, y - 40 + k * 40, t))],
    robot: (x, y) => [R(x - 75, y - 60, 150, 120, 20, o), C(x - 30, y - 10, 14, o), C(x + 30, y - 10, 14, o), L(x, y - 60, x, y - 95, t), C(x, y - 102, 8, t), L(x - 30, y + 30, x + 30, y + 30, t)],
    magnet: (x, y) => [A(x, y, 70, Math.PI, Math.PI * 2, { w: 14 }), L(x - 70, y, x - 70, y + 70, { w: 14 }), L(x + 70, y, x + 70, y + 70, { w: 14 })],
    star: (x, y) => [P([...Array(11)].map((_, i) => { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 38 : 90; return [x + Math.cos(a) * r, y + Math.sin(a) * r]; }), o)],
    heart: (x, y) => [P([[x, y + 70], [x - 85, y - 10], [x - 60, y - 70], [x, y - 40], [x + 60, y - 70], [x + 85, y - 10], [x, y + 70]], o)],
    fire: (x, y) => [CU([[x, y + 80], [x - 70, y + 20], [x - 30, y - 40], [x - 10, y - 95], [x + 30, y - 30], [x + 65, y + 10], [x, y + 80]], o)],
    satellite: (x, y) => [R(x - 30, y - 30, 60, 60, 8, o), ...RC(x - 120, y - 22, 75, 44, { w: 6, over: 3 }), ...RC(x + 45, y - 22, 75, 44, { w: 6, over: 3 })],
    signal: (x, y) => [0, 1, 2, 3].map(k => L(x - 70 + k * 45, y + 70, x - 70 + k * 45, y + 50 - k * 35, { w: 16 })),
    cash: (x, y) => [R(x - 105, y - 55, 210, 110, 10, o), C(x, y, 30, t)],
    box: (x, y) => [R(x - 90, y - 70, 180, 140, 14, o)],
  }).map(([k, f]) => [k, at(f)]));
})();
export const ICON_NAMES = Object.keys(ICONS);
const INK = { black: W.INK.black, blue: W.INK.blue, orange: W.INK.orange };

export async function buildBoard(script, words, VO) {
  W.setScreen(BW * BQ, BH * BQ);
  await W.loadFont('tech', 'fonts/EMSTech.json');
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const ids = script.lines.map(l => l.id);
  const voEnd = id => VO[id] + (words[id]?.length ? words[id][words[id].length - 1][2] : 1.5);
  // the time a word is spoken; an unknown word falls back to the start of its line (never a crash)
  const at = (a, which = 1) => {
    const id = ids.includes(a?.line) ? a.line : ids[0], want = norm(a?.word || '');
    const ws = words[id] || [];
    if (want) { const x = ws.find(x => norm(x[0]).startsWith(want) || (want.length > 3 && norm(x[0]).includes(want.slice(0, 4)))); if (x) return VO[id] + Math.max(0, x[which]); }
    return VO[id] + (which === 1 ? .1 : .6);
  };

  const tl = new W.Timeline();
  const K = new W.Pen('black', INK.black, { park: [1750 * BQ, 1150 * BQ] });
  const O = new W.Pen('orange', INK.orange, { park: [1780 * BQ, 80 * BQ] });
  const Bl = new W.Pen('blue', INK.blue, { park: [-180 * BQ, 1100 * BQ] });
  const PEN = { black: K, orange: O, blue: Bl }, PENS = [K, O, Bl], T = W.text;
  const D = (pen, shapes, a, b, o = {}) => tl.draw(pen, shapes, a, { by: Math.max(b, a + .12), ...o });

  const ghosts = [], gR = mulberry(5);
  for (let i = 0; i < 12; i++) {
    const x = gR() * 1400 + 100, y = gR() * 800 + 150, o = { w: 9, alpha: .05 + gR() * .04, color: '#9aa0a8' };
    if (gR() < .5) ghosts.push(...T(['x = 3', 'mon', 'q.2', 'ok', 'HW'][i % 5], x, y, { h: 40, ...o })); else ghosts.push(W.circle(x, y, 30 + gR() * 60, o));
  }

  // the title strip, written first, stays for the whole film
  const first = script.panels?.[0]?.items?.[0];
  const t0 = Math.max(.9, Math.min(2.2, (first ? at(first.at) : 2.4) - .15));
  const title = String(script.board_title || script.title || '').slice(0, 34);
  D(O, T(title, BW / 2, 118, { h: 70, w: 9, align: 'center' }), .05, t0 - .3, { minGap: .015, maxGap: .03 });
  D(O, W.curve([[300, 150], [800, 142], [1300, 152]], { w: 10, over: 14 }), t0 - .28, t0);
  const TITLE_N = tl.strokes.length;
  let mark = TITLE_N;
  const wipe = (a, b) => {
    tl.erase(W.zigzag(40, 280, BW - 80, BH - 330, 8), a, b - a, { width: 220, strength: .97 });
    for (let i = mark; i < tl.strokes.length; i++) tl.strokes[i].hide = t => t >= b;
    mark = tl.strokes.length;
  };

  const boxes = {}, bigs = [], lineItems = {};
  const panels = (script.panels || []).filter(p => p.items?.length);
  // items in time order inside each panel, so one pen never has to go back in time
  panels.forEach(p => p.items.sort((a, b) => at(a.at) - at(b.at)));
  const BELOW = { L: 'BL', C: 'BC', R: 'BR' };
  panels.forEach((p, pi) => {
    const used = new Set(p.items.map(it => it.slot));   // 19.11: labels and long texts ran into their neighbours
    for (const it of p.items) {
      const t = at(it.at) - .1, slot = SLOTS[it.slot] || SLOTS.C;
      const color = INK[it.color] ? it.color : null;
      (lineItems[it.at?.line] ||= []).push(it);
      if (it.type === 'icon') {
        const f = ICONS[it.icon] || ICONS.box, [x, y] = slot;
        D(K, f(x, y), t, t + .85, { minGap: .02, maxGap: .05 });
        boxes[it.id] = [x - 160, y - 150, x + 160, y + 150];
        if (it.label && !used.has(BELOW[it.slot])) { const lab = String(it.label).slice(0, 18); D(K, T(lab, x, y + 205, { h: 46, w: 6, align: 'center' }), t + .9, t + .9 + Math.min(1.1, .25 + lab.length * .05)); }
        if (it.icon === 'box' && it.text) D(K, T(String(it.text).slice(0, 8), x, y + 18, { h: 50, w: 6, align: 'center' }), t + .9, t + 1.4);
      } else if (it.type === 'text' || it.type === 'big') {
        const big = it.type === 'big', s = String(it.text || '').slice(0, big ? 10 : 24), h = big ? 170 : (it.slot === 'TOP' || it.slot === 'BOTTOM' ? 56 : 52);
        const pen = big ? O : PEN[color || 'black'], [x, y] = slot;
        let strokes = T(s, x, y + h * .35, { h, w: big ? 18 : 7, align: 'center' });
        const room = it.slot === 'TOP' || it.slot === 'BOTTOM' ? 1400 : 460;   // a cell is 500 px wide
        if (strokes.width > room) strokes = T(s, x, y + h * .35 * room / strokes.width, { h: h * room / strokes.width, w: big ? 18 : 7, align: 'center' });
        D(pen, strokes, t, t + Math.min(big ? 1.0 : 1.6, .3 + s.length * (big ? .12 : .055)), { minGap: .015, maxGap: .04 });
        boxes[it.id] = [x - strokes.width / 2 - 20, y - h * .7, x + strokes.width / 2 + 20, y + h * .5];
        if (big) { bigs.push({ t, x, y }); tl.cue(t, 'pop'); }
      } else if (it.type === 'arrow') {
        const a = boxes[it.from], b = boxes[it.to];
        if (!a || !b) continue;
        const ca = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2], cb = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
        const dx = cb[0] - ca[0], dy = cb[1] - ca[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const ra = Math.min(Math.abs((a[2] - a[0]) / 2 / (ux || 1e-6)), Math.abs((a[3] - a[1]) / 2 / (uy || 1e-6))), rb = Math.min(Math.abs((b[2] - b[0]) / 2 / (ux || 1e-6)), Math.abs((b[3] - b[1]) / 2 / (uy || 1e-6)));
        const p0 = [ca[0] + ux * (ra + 15), ca[1] + uy * (ra + 15)], p1 = [cb[0] - ux * (rb + 15), cb[1] - uy * (rb + 15)];
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 40) continue;
        D(Bl, W.arrow(p0[0], p0[1], p1[0], p1[1], { w: 7, head: 22 }), t, t + .45);
        tl.cue(t, 'ping', { k: pi });
        if (it.label) D(Bl, T(String(it.label).slice(0, 14), (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 - 22, { h: 34, w: 5, align: 'center' }), t + .5, t + 1.1);
      } else if (it.type === 'cross' && boxes[it.target]) {
        const [x0, y0, x1, y1] = boxes[it.target];
        D(K, [W.line(x0, y0, x1, y1, { w: 11 }), W.line(x1, y0, x0, y1, { w: 11 })], t, t + .4);
      } else if (it.type === 'check' && boxes[it.target]) {
        const [, y0, x1] = boxes[it.target];
        D(O, T('✓', x1 + 10, y0 + 90, { h: 100, w: 12 }), t, t + .35);
        tl.cue(t, 'yes');
      } else if (it.type === 'circle' && boxes[it.target]) {
        const [x0, y0, x1, y1] = boxes[it.target];
        D(O, W.circle((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * .62, { w: 9, lap: .4 }), t, t + .6);
      }
    }
    const next = panels[pi + 1];
    if (next) {
      const lastEnd = Math.max(...PENS.map(pn => pn.segs.length ? pn.segs[pn.segs.length - 1].t1 : 0));
      const nextT = Math.min(...next.items.map(it => at(it.at))) - .2;
      const a = Math.max(lastEnd + .15, nextT - .8), b = Math.max(a + .35, Math.min(a + .7, nextT));
      wipe(a, b);
    }
  });
  tl.end();

  const board = new W.Board(tl, { ghosts, W: BW, H: BH });
  const cam = new W.Camera([[0, BW / 2, BH / 2, BQ]]);
  board.objs.push({ draw: (ctx, t, c) => { for (const e of tl.erasers) W.drawEraser(ctx, e, t, c); } });
  const tip = t => {
    let best = null;
    for (const p of PENS) { const q = W.penPose(p, t, cam); if (!q) continue; if (q.on) return { x: q.x, y: q.y, lift: 0, color: p.color }; if (!best || q.lift < best.lift) best = { x: q.x, y: q.y, lift: q.lift, color: p.color }; }
    return best;
  };
  const focus = t => { for (const e of tl.erasers) if (t >= e.t0 && t <= e.t1) return e.path.at((t - e.t0) / (e.t1 - e.t0) * e.path.len); return null; };
  return { board, cam, tl, tip, focus, at, voEnd, bigs, lineItems };
}
