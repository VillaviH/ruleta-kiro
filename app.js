(() => {
'use strict';

const STORE_KEY = 'ruleta-kiro-state-v1';
const TAU = Math.PI * 2;
const COLORS = ['#8845f4', '#5b2bc2', '#b18cff', '#3d1d94', '#7a3be8', '#9f6bff', '#4a23a8', '#c4a6ff'];

const $ = (id) => document.getElementById(id);
const canvas = $('wheel');
const ctx = canvas.getContext('2d');
const kiroImg = new Image();
kiroImg.src = 'kiro.svg';
kiroImg.onload = () => draw();

// ---------- Estado ----------
let state = { participants: [], winners: [], absent: [], source: '' };
let rotation = 0;          // radianes, sentido horario, 0 = segmento 0 arrancando arriba
let spinning = false;
let pool = [];             // participantes que siguen en la ruleta
let pendingWinner = null;

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ }
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && Array.isArray(s.participants)) state = s;
  } catch (e) { /* estado corrupto: se ignora */ }
}

function computePool() {
  const out = new Set([...state.winners.map(w => w.id), ...state.absent]);
  pool = state.participants.filter(p => !out.has(p.id));
}

// ---------- Utilidades ----------
function randInt(n) {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;   // evita sesgo de módulo
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % n;
}
function randFloat() { return randInt(1 << 30) / (1 << 30); }
const mod = (a, n) => ((a % n) + n) % n;
const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// ---------- Lectura del Excel ----------
function parseRows(rows) {
  rows = rows.filter(r => r.some(c => norm(c) !== ''));
  if (!rows.length) return [];
  const header = rows[0].map(c => norm(c).toLowerCase());
  const find = (re, skip) => header.findIndex((h, i) => re.test(h) && !(skip && skip.test(h)));

  const lastIdx = find(/apellido|last ?name|surname/);
  let nameIdx = find(/nombre|name|participante/, /apellido|empresa|company|usuario|archivo/);
  const numIdx = find(/manilla|pulsera|n[uú]mero|n[°º]|^num|^#|ticket|boleto|c[oó]digo/);
  const mailIdx = find(/correo|e-?mail/);
  const orgIdx = find(/empresa|instituci[oó]n|company|organizaci[oó]n/);

  const hasHeader = nameIdx !== -1;
  if (!hasHeader) nameIdx = 0;
  const data = hasHeader ? rows.slice(1) : rows;

  const seen = new Set();
  const out = [];
  for (const r of data) {
    let name = norm(r[nameIdx]);
    if (hasHeader && lastIdx !== -1 && lastIdx !== nameIdx) name = norm(name + ' ' + norm(r[lastIdx]));
    if (!name) continue;
    const num = numIdx !== -1 ? norm(r[numIdx]) : '';
    const email = mailIdx !== -1 ? norm(r[mailIdx]).toLowerCase() : '';
    const org = orgIdx !== -1 ? norm(r[orgIdx]) : '';
    const key = email || name.toLowerCase();         // evita duplicados de la encuesta
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: out.length + 1, name, num, email, org });
  }
  return out;
}

async function loadFile(file) {
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    setParticipants(parseRows(rows), file.name);
  } catch (e) {
    alert('No pude leer el archivo: ' + e.message);
  }
}

function setParticipants(list, source) {
  if (!list.length) { alert('No encontré nombres en el archivo. Revisa que haya una columna "Nombre".'); return; }
  if (state.winners.length && !confirm('Ya hay ganadores. Cargar otra lista reinicia el sorteo. ¿Continuar?')) return;
  state = { participants: list, winners: [], absent: [], source };
  save();
  refresh();
}

// ---------- Dibujo ----------
function fitText(text, maxPx, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxPx) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxPx) t = t.slice(0, -1);
  return t + '…';
}

function draw() {
  const W = canvas.width, c = W / 2, R = c - 18;
  ctx.clearRect(0, 0, W, W);

  // aro exterior
  ctx.beginPath(); ctx.arc(c, c, R + 12, 0, TAU);
  ctx.fillStyle = '#2a1766'; ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = '#b18cff'; ctx.stroke();

  const n = pool.length;
  if (n === 0) {
    ctx.beginPath(); ctx.arc(c, c, R, 0, TAU);
    ctx.fillStyle = '#1a1233'; ctx.fill();
  } else {
    const seg = TAU / n;
    for (let i = 0; i < n; i++) {
      const a0 = -Math.PI / 2 + rotation + i * seg;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a0 + seg); ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      if (n > 1 && n % COLORS.length === 1 && i === n - 1) ctx.fillStyle = '#6a2fe0';
      ctx.fill();
      if (n > 1) { ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.stroke(); }
    }
    // etiquetas
    const arcAtText = seg * R * 0.6;                       // alto disponible por etiqueta
    const fs = Math.max(8, Math.min(30, Math.floor(arcAtText * 0.8)));
    if (fs >= 9) {
      for (let i = 0; i < n; i++) {
        const mid = -Math.PI / 2 + rotation + (i + 0.5) * seg;
        ctx.save();
        ctx.translate(c, c); ctx.rotate(mid);
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        const font = `600 ${fs}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        ctx.fillText(fitText(pool[i].name, R * 0.62, font), R - 18, 0);
        ctx.restore();
      }
    }
  }

  // centro con logo
  const hub = R * 0.2;
  ctx.beginPath(); ctx.arc(c, c, hub + 8, 0, TAU); ctx.fillStyle = '#2a1766'; ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(c, c, hub, 0, TAU); ctx.clip();
  if (kiroImg.complete && kiroImg.naturalWidth) ctx.drawImage(kiroImg, c - hub, c - hub, hub * 2, hub * 2);
  else { ctx.fillStyle = '#fff'; ctx.fill(); }
  ctx.restore();
  ctx.beginPath(); ctx.arc(c, c, hub, 0, TAU); ctx.lineWidth = 5; ctx.strokeStyle = '#b18cff'; ctx.stroke();

  // puntero (arriba, apuntando hacia el centro)
  ctx.beginPath();
  ctx.moveTo(c - 26, 2); ctx.lineTo(c + 26, 2); ctx.lineTo(c, 66); ctx.closePath();
  ctx.fillStyle = '#ffd34d'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#1a1233'; ctx.stroke();
}

function indexAtPointer() {
  const n = pool.length;
  if (!n) return -1;
  return Math.floor(mod(-rotation, TAU) / (TAU / n)) % n;
}

// ---------- Sonido ----------
let audio = null;
function tick(freq = 700, dur = 0.04, vol = 0.05) {
  if ($('mute').checked) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + dur);
  } catch (e) { /* sin audio */ }
}
function fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tick(f, 0.25, 0.08), i * 140)); }

// ---------- Giro ----------
function spin() {
  if (spinning || !pool.length || pendingWinner) return;
  spinning = true;
  $('spinBtn').disabled = true;

  const n = pool.length;
  const seg = TAU / n;
  const winIdx = randInt(n);                              // ganador decidido con aleatoriedad criptográfica
  const jitter = (randFloat() - 0.5) * seg * 0.7;         // cae en cualquier punto del segmento
  const turns = 6 + randInt(3);
  const start = rotation;
  const target = mod(-(winIdx + 0.5) * seg + jitter, TAU);
  const delta = turns * TAU + mod(target - mod(start, TAU), TAU);
  const dur = 7000;
  const t0 = performance.now();
  let lastIdx = indexAtPointer();

  function frame(now) {
    const t = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - t, 4);
    rotation = start + delta * ease;
    const idx = indexAtPointer();
    if (idx !== lastIdx) {
      lastIdx = idx;
      tick(600 + 300 * (1 - t));
      $('ticker').textContent = pool[idx].name;
    }
    draw();
    if (t < 1) { requestAnimationFrame(frame); return; }
    spinning = false;
    rotation = mod(rotation, TAU);
    pendingWinner = pool[winIdx];
    showWinner(pendingWinner);
  }
  requestAnimationFrame(frame);
}

// ---------- Ganador ----------
function showWinner(p) {
  $('ticker').textContent = p.name;
  $('mName').textContent = p.name;
  $('mNum').textContent = [p.org, p.num ? 'Manilla #' + p.num : ''].filter(Boolean).join(' · ');
  $('overlay').hidden = false;
  fanfare();
  startConfetti();
}
function closeModal() {
  $('overlay').hidden = true;
  stopConfetti();
  pendingWinner = null;
}
function confirmWinner() {
  if (!pendingWinner) return;
  state.winners.push({ id: pendingWinner.id, name: pendingWinner.name, num: pendingWinner.num, email: pendingWinner.email, org: pendingWinner.org, at: new Date().toISOString() });
  save(); closeModal(); refresh();
}
function markAbsent() {
  if (!pendingWinner) return;
  state.absent.push(pendingWinner.id);
  save(); closeModal(); refresh();
}

// ---------- Confeti ----------
const cv = $('confetti'), cx = cv.getContext('2d');
let parts = [], confettiOn = false;
function startConfetti() {
  cv.width = innerWidth; cv.height = innerHeight;
  parts = Array.from({ length: 220 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
    vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 5,
    s: 6 + Math.random() * 8, r: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3,
    c: COLORS.concat(['#ffd34d', '#ffffff'])[Math.floor(Math.random() * 10)],
  }));
  confettiOn = true;
  (function loop() {
    if (!confettiOn) return;
    cx.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      if (p.y > cv.height + 20) { p.y = -20; p.x = Math.random() * cv.width; }
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r);
      cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
    }
    requestAnimationFrame(loop);
  })();
}
function stopConfetti() { confettiOn = false; cx.clearRect(0, 0, cv.width, cv.height); }

// ---------- UI ----------
function refresh() {
  computePool();
  $('stTotal').textContent = state.participants.length;
  $('stLeft').textContent = pool.length;
  $('stWin').textContent = state.winners.length;

  $('fileInfo').textContent = state.participants.length
    ? `${state.participants.length} participantes cargados (${state.source || 'lista'})`
    : 'Arrastra aquí el Excel (.xlsx / .xls / .csv) o usa el botón.';

  const ol = $('winners');
  ol.replaceChildren();
  state.winners.forEach((w, i) => {
    const li = document.createElement('li');
    const n = document.createElement('span'); n.className = 'n'; n.textContent = i + 1;
    const nm = document.createElement('span'); nm.className = 'w'; nm.textContent = w.name; nm.title = w.name;
    li.append(n, nm);
    const extra = [w.org, w.num ? '#' + w.num : ''].filter(Boolean).join(' · ');
    if (extra) { const b = document.createElement('span'); b.className = 'b'; b.textContent = extra; b.title = extra; li.append(b); }
    ol.append(li);
  });
  ol.scrollTop = ol.scrollHeight;

  const abs = state.absent.map(id => state.participants.find(p => p.id === id)?.name).filter(Boolean);
  $('absentWrap').hidden = !abs.length;
  $('absentList').textContent = abs.join(', ');

  $('spinBtn').disabled = spinning || !pool.length;
  $('ticker').textContent = !state.participants.length ? 'Carga el Excel para comenzar'
    : !pool.length ? '¡Ya salieron todos!' : '¿Quién será el próximo?';
  draw();
}

function downloadCsv() {
  const esc = (v) => {
    v = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;            // evita inyección de fórmulas en Excel
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const lines = [['Orden', 'Nombre', 'Empresa/Institución', 'Manilla', 'Correo', 'Hora'].map(esc).join(',')];
  state.winners.forEach((w, i) => lines.push([i + 1, w.name, w.org, w.num, w.email, w.at].map(esc).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'ganadores.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Descarga el CSV y abre el cliente de correo con el resumen. No hay servidor: nada sale del navegador.
function sendByMail() {
  if (!state.winners.length) { alert('Aún no hay ganadores.'); return; }
  const last = localStorage.getItem('ruleta-kiro-mail') || '';
  const to = (prompt('¿A qué correo envías los resultados?', last) || '').trim();
  if (!to) return;
  if (!/^[^\s@,;?&=]+@[^\s@,;?&=]+\.[^\s@,;?&=]+$/.test(to)) { alert('Correo no válido.'); return; }
  try { localStorage.setItem('ruleta-kiro-mail', to); } catch (e) { /* sin almacenamiento */ }

  downloadCsv();
  const MAX = 1500;                                     // los clientes de correo limitan el largo del enlace
  let body = 'Resultados del sorteo (' + state.winners.length + ' ganadores):\n\n';
  let cut = false;
  for (let i = 0; i < state.winners.length; i++) {
    const w = state.winners[i];
    const line = `${i + 1}. ${w.name}${w.org ? ' - ' + w.org : ''}${w.num ? ' (manilla ' + w.num + ')' : ''}\n`;
    if (encodeURIComponent(body + line).length > MAX) { cut = true; break; }
    body += line;
  }
  if (cut) body += '...\n';
  body += '\nAdjunta el archivo ganadores.csv que se acaba de descargar con la lista completa.';
  location.href = 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') +
    '?subject=' + encodeURIComponent('Resultados del sorteo') + '&body=' + encodeURIComponent(body);
}

function demoData() {
  const nombres = ['Ana', 'Luis', 'María', 'Carlos', 'Sofía', 'Diego', 'Valeria', 'Andrés', 'Camila', 'Mateo'];
  const apellidos = ['Pérez', 'Gómez', 'Rodríguez', 'Vera', 'Mora', 'Salazar', 'Cedeño', 'Zambrano', 'Loor', 'Intriago'];
  return Array.from({ length: 100 }, (_, i) => ({
    id: i + 1, name: `${nombres[i % 10]} ${apellidos[Math.floor(i / 10)]}`, num: '', email: '',
    org: ['AWS User Group', 'Universidad', 'Startup', 'Consultora', 'Banco'][i % 5],
  }));
}

// ---------- Eventos ----------
$('spinBtn').addEventListener('click', spin);
$('okBtn').addEventListener('click', confirmWinner);
$('absentBtn').addEventListener('click', markAbsent);
$('csvBtn').addEventListener('click', () => state.winners.length ? downloadCsv() : alert('Aún no hay ganadores.'));
$('mailBtn').addEventListener('click', sendByMail);
$('demoBtn').addEventListener('click', () => setParticipants(demoData(), 'datos de prueba'));
$('resetBtn').addEventListener('click', () => {
  if (!state.participants.length) return;
  if (confirm('¿Reiniciar el sorteo? Todos vuelven a la ruleta.')) {
    state.winners = []; state.absent = []; save(); refresh();
  }
});
$('file').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });

const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' && e.code !== 'Enter') return;
  if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
  e.preventDefault();
  if (!$('overlay').hidden) confirmWinner(); else spin();
});

// ---------- Inicio ----------
load();
refresh();
// Si hay un participantes.xlsx junto a la página (servidor local) y no hay lista guardada, lo carga solo.
if (!state.participants.length && location.protocol.startsWith('http')) {
  fetch('participantes.xlsx').then(r => r.ok ? r.blob() : null).then(b => {
    if (b) loadFile(new File([b], 'participantes.xlsx'));
  }).catch(() => {});
}
})();
