const mod = await import('./film.js');
await document.fonts.load('500 60px Fredoka');
await document.fonts.load('46px AD');
const F = await mod.build(document.getElementById('gl'), document.getElementById('ui'));
window.DUR = F.dur; window.EV = [...F.ev, { t: 0, type: 'cues', ...F.cues }]; window.SUBS = F.subs;
window.render = t => F.render(t);
window.READY = true;
