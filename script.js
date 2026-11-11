/* =========================================================
   Sistema de Nebulizaci\u00f3n Espacial 2026 - script.js
   Cualquier modificaci\u00f3n del sistema se hace en este archivo.
   ========================================================= */
var CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbw5HRsZ8K6bxObGZMmQbbmDPla5xqmxhcRYJN9SZyzewfi2qK1gcQtZ9Vz7xQSZMB49/exec'
};

var MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
var CAMPOS = ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA', 'VIV_PRO', 'VIV_NEB', 'VIV_CER', 'VIV_REN', 'VIV_DESH',
  'MZ_PRO', 'MZ_NEB', 'EQ_PORT_FRIO', 'EQ_PORT_CALIENTE', 'EQ_PESADO_FRIO', 'EQ_PESADO_CALIENTE',
  'INSECTICIDA_ML', 'INSECTICIDA_L', 'PETROLEO_GAL', 'GASOLINA_GAL', 'FECHA_INICIO', 'FECHA_TERMINO', 'OBSERVACIONES'];
var NUMERICOS = ['VIV_PRO', 'VIV_NEB', 'VIV_CER', 'VIV_REN', 'VIV_DESH', 'MZ_PRO', 'MZ_NEB', 'EQ_PORT_FRIO', 'EQ_PORT_CALIENTE',
  'EQ_PESADO_FRIO', 'EQ_PESADO_CALIENTE', 'INSECTICIDA_ML', 'INSECTICIDA_L', 'PETROLEO_GAL', 'GASOLINA_GAL'];
// D\u00edas m\u00e1ximos entre dos registros diarios de la misma zona y vuelta para sumarlos en una sola intervenci\u00f3n
var DIAS_CORTE = 7;
var TASAS_DEFECTO = { ML_INSECTICIDA_POR_VIV: 5.26, GAL_PETROLEO_POR_VIV: 0.02642, GAL_GASOLINA_POR_VIV: 0.021136 };
var COLORES = { neb: '#2f7d4f', cer: '#e0a526', ren: '#b23b2e', desh: '#8a9a92', novis: '#cfdad3', pro: '#14352a' };

var ESTADO = { token: null, registros: [], cfg: {}, charts: {}, editandoId: null, gastoManual: false, proManual: false, mzManual: false, vueltas: [], sel: {}, ultimoSel: null };

function $(id) { return document.getElementById(id); }
function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function fmt(v, d) { return n(v).toLocaleString('es-PE', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function pct(a, b) { return b > 0 ? a / b : null; }
function fmtPct(p) { return p === null ? '-' : (p * 100).toFixed(1) + '%'; }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function mesDe(f) { return f ? Number(f.slice(5, 7)) - 1 : -1; }
function fechaCorta(f) { return f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''; }
function claseCob(p) { return p === null ? '' : p < 0.6 ? 'baja' : p < 0.8 ? 'media' : 'alta'; }

/* ---------- Comunicaci\u00f3n con Apps Script ---------- */
/* Llamada al servidor sin cerrar la sesi\u00f3n (la usa la sincronizaci\u00f3n). Si no hay se\u00f1al lanza un error de red. */
async function apiRaw(accion, datos) {
  var cuerpo = Object.assign({ accion: accion, token: ESTADO.token }, datos || {});
  var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var tm = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
  try {
    var r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(cuerpo), signal: ctrl ? ctrl.signal : undefined });
    var j = await r.json();
  } finally { if (tm) clearTimeout(tm); }
  if (!j.ok && j.error === 'SESION') { var e = new Error('La sesi\u00f3n venci\u00f3. Ingresa de nuevo.'); e.code = 'SESION'; throw e; }
  if (!j.ok) throw new Error(j.error || 'Error desconocido');
  return j;
}
async function api(accion, datos) {
  try { return await apiRaw(accion, datos); }
  catch (e) { if (e.code === 'SESION') cerrarSesion(); throw e; }
}
function errRed(e) { return !!e && !e.code && (e.name === 'TypeError' || e.name === 'AbortError' || /fetch|network|load failed/i.test(e.message || '')); }

/* ---------- Trabajo sin internet ---------- */
/* Los registros se guardan primero en el equipo (cola) y se env\u00edan al servidor cuando hay internet. */
var COLA_KEY = 'neb_cola', DATOS_KEY = 'neb_datos', CLAVE_H = 'neb_clave_h', TOKEN_KEY = 'neb_token';
function leerCola() { try { return JSON.parse(localStorage.getItem(COLA_KEY)) || []; } catch (e) { return []; } }
function guardarCola(c) { try { localStorage.setItem(COLA_KEY, JSON.stringify(c)); } catch (e) {} pintarSync(); }
function guardarCache() { try { localStorage.setItem(DATOS_KEY, JSON.stringify({ registros: ESTADO.registros, cfg: ESTADO.cfg, fecha: new Date().toISOString() })); } catch (e) {} }
function leerCache() { try { return JSON.parse(localStorage.getItem(DATOS_KEY)); } catch (e) { return null; } }
function esTmp(id) { return /^TMP-/.test(String(id || '')); }
async function hashClave(c) {
  try { var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('neb|' + c)); return Array.from(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  catch (e) { return ''; }
}
function normalizarNum(r) { NUMERICOS.forEach(function (c) { r[c] = r[c] === '' || r[c] === null || r[c] === undefined ? null : n(r[c]); }); return r; }

function aplicarLocal(e) {
  if (e.op === 'guardar') {
    var r = normalizarNum(Object.assign({}, e.registro, { PEND: true, ERR: e.err || '' }));
    var i = ESTADO.registros.findIndex(function (x) { return x.ID === r.ID; });
    if (i >= 0) ESTADO.registros[i] = r; else ESTADO.registros.push(r);
  } else ESTADO.registros = ESTADO.registros.filter(function (x) { return x.ID !== e.id; });
}
function encolar(e) {
  var c = leerCola(), id = e.op === 'guardar' ? e.registro.ID : e.id;
  c = c.filter(function (x) { return !(x.op === 'guardar' && x.registro.ID === id); });
  if (!(e.op === 'eliminar' && esTmp(id))) c.push(e);
  guardarCola(c);
}

/* Guarda un registro: queda en el equipo y se intenta enviar al momento. Devuelve true si ya lleg\u00f3 al servidor. */
async function guardarRegistro(o) {
  o = Object.assign({}, o);
  if (!o.ID) o.ID = 'TMP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  var tmp = o.ID, e = { op: 'guardar', registro: o, t: Date.now() };
  encolar(e); aplicarLocal(e); guardarCache(); refrescarTodo();
  await sincronizar(true);
  return !leerCola().some(function (x) { return x.op === 'guardar' && x.registro.ID === tmp; });
}

var sincronizando = false;
async function sincronizar(silencioso) {
  var c = leerCola();
  if (sincronizando || !c.length) { pintarSync(); return; }
  if (!navigator.onLine) { pintarSync(); return; }
  if (!ESTADO.token || ESTADO.token === 'offline') { ESTADO.necesitaLogin = true; pintarSync(); return; }
  sincronizando = true; pintarSync();
  var enviados = 0, borrados = 0;
  try {
    while ((c = leerCola()).length) {
      var e = c[0];
      try {
        if (e.op === 'guardar') {
          var reg = Object.assign({}, e.registro), tmp = reg.ID;
          delete reg.PEND; delete reg.ERR;
          if (esTmp(reg.ID)) reg.ID = '';
          var j = await apiRaw('guardar', { registro: reg });
          var nuevo = normalizarNum(j.registro);
          var i = ESTADO.registros.findIndex(function (x) { return x.ID === tmp; });
          if (i >= 0) ESTADO.registros[i] = nuevo; else ESTADO.registros.push(nuevo);
          if (ESTADO.editandoId === tmp) ESTADO.editandoId = nuevo.ID;
        } else {
          // Si hay varios borrados en cola se env\u00edan juntos en una sola llamada
          var lote = e.err ? [] : leerCola().filter(function (y) { return y.op === 'eliminar' && !y.err; });
          if (lote.length > 1) {
            var hecho = true;
            try { await apiRaw('eliminarVarios', { ids: lote.map(function (y) { return y.id; }) }); }
            catch (er) { if (er.code || errRed(er) || !/no reconocida/i.test(er.message || '')) throw er; hecho = false; } // servidor sin actualizar: uno por uno
            if (hecho) {
              var ts = lote.map(function (y) { return y.t; });
              guardarCola(leerCola().filter(function (y) { return ts.indexOf(y.t) < 0; })); borrados += lote.length;
              continue;
            }
          }
          try { await apiRaw('eliminar', { id: e.id }); } catch (er) { if (!/No se encontr/.test(er.message || '') || er.code) throw er; }
        }
        guardarCola(leerCola().filter(function (y) { return y.t !== e.t; })); enviados++;
      } catch (err) {
        if (errRed(err)) break;
        if (err.code === 'SESION') { ESTADO.necesitaLogin = true; break; }
        // El servidor rechaz\u00f3 el dato: se marca con el error y se pasa al final para no trabar los dem\u00e1s
        c = leerCola(); var x = c.find(function (y) { return y.t === e.t; }); if (!x) continue; c = c.filter(function (y) { return y !== x; }); x.err = err.message; c.push(x); guardarCola(c);
        if (x.op === 'guardar') aplicarLocal(x);
        if (c.every(function (y) { return y.err; })) break;
      }
    }
  } finally { sincronizando = false; }
  if (borrados && !enviados) { ESTADO.necesitaLogin = false; guardarCache(); }
  if (enviados) { ESTADO.necesitaLogin = false; guardarCache(); refrescarTodo(); if (!silencioso || leerCola().length === 0) avisar(enviados + ' registro' + (enviados === 1 ? '' : 's') + ' enviado' + (enviados === 1 ? '' : 's') + ' al servidor.'); }
  pintarSync();
}

async function loginSincronizar() {
  var clave = prompt('Ingresa la contrase\u00f1a del sistema para enviar los registros guardados en este equipo:');
  if (!clave) return;
  try {
    var j = await apiRaw('login', { clave: clave });
    ESTADO.token = j.token; localStorage.setItem(TOKEN_KEY, j.token); localStorage.setItem(CLAVE_H, await hashClave(clave));
    ESTADO.necesitaLogin = false;
    await sincronizar(); await recargar();
  } catch (e) { avisar(errRed(e) ? 'Sin conexi\u00f3n. Intenta cuando haya internet.' : e.message, true); }
}

function pintarSync() {
  var el = $('estadoSync');
  if (!el) {
    var ref = $('btnSalir'); if (!ref) return;
    el = document.createElement('span'); el.id = 'estadoSync';
    el.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-right:10px;padding:5px 10px;border-radius:999px;font-size:.8rem;font-weight:600;background:rgba(255,255,255,.16);color:#fff;white-space:nowrap';
    ref.parentElement.insertBefore(el, ref);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.acc === 'login') loginSincronizar(); else sincronizar();
    });
  }
  var c = leerCola(), np = c.length, nErr = c.filter(function (x) { return x.err; }).length;
  var btn = 'style="border:0;border-radius:999px;padding:2px 9px;font:inherit;font-size:.75rem;cursor:pointer;background:#fff;color:#14352a"';
  var txt;
  if (!navigator.onLine) txt = '\ud83d\udcf4 Sin internet' + (np ? ' \u00b7 ' + np + ' por enviar' : ' \u00b7 puedes registrar');
  else if (sincronizando) txt = '\ud83d\udd04 Enviando ' + np + '\u2026';
  else if (np && ESTADO.necesitaLogin) txt = '\ud83d\udd11 ' + np + ' por enviar <button type="button" data-acc="login" ' + btn + '>Ingresar y enviar</button>';
  else if (np) txt = (nErr ? '\u26a0\ufe0f ' + nErr + ' con error \u00b7 ' : '\u23f3 ') + np + ' por enviar <button type="button" data-acc="sync" ' + btn + '>Enviar ahora</button>';
  else txt = '\u2705 Sincronizado';
  el.innerHTML = txt;
  el.title = nErr ? c.filter(function (x) { return x.err; }).map(function (x) { return (x.registro ? x.registro.ESTABLECIMIENTO : '') + ': ' + x.err; }).join('\n') : '';
}

/* Guarda en el equipo la p\u00e1gina y las librer\u00edas para poder abrirla sin internet */
function prepararSinInternet() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(function () {});
  if (!window.caches) return;
  var urls = [location.href.split('#')[0], 'index.html', 'dashboard.html', 'script.js'];
  document.querySelectorAll('script[src],link[rel="stylesheet"][href],link[rel="icon"][href],img[src]').forEach(function (x) { urls.push(x.src || x.href); });
  caches.open('neb-recursos').then(function (cache) {
    urls.forEach(function (u) {
      var abs = new URL(u, location.href);
      var mismo = abs.origin === location.origin;
      fetch(abs.href, mismo ? { cache: 'no-cache' } : { mode: 'no-cors' }).then(function (r) { if (r.ok || r.type === 'opaque') cache.put(abs.href, r); }).catch(function () {});
    });
  });
}

function cargando(si) { $('cargando').hidden = !si; }
var tAviso;
function avisar(msg, esError) {
  var a = $('aviso'); a.textContent = msg; a.className = 'aviso' + (esError ? ' error-aviso' : ''); a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(function () { a.hidden = true; }, esError ? 6000 : 3500);
}

/* ---------- Sesi\u00f3n ---------- */
async function ingresar(ev) {
  ev.preventDefault();
  $('loginError').textContent = '';
  if (CONFIG.API_URL.indexOf('http') !== 0) { $('loginError').textContent = 'Falta pegar la URL /exec en CONFIG.API_URL de script.js.'; return; }
  cargando(true);
  var clave = $('clave').value;
  try {
    var j = await api('login', { clave: clave });
    ESTADO.token = j.token;
    localStorage.setItem(TOKEN_KEY, j.token);
    localStorage.setItem(CLAVE_H, await hashClave(clave));
    await iniciarApp();
  } catch (e) {
    // Sin internet: entra con los datos guardados en este equipo si la contrase\u00f1a coincide con la \u00faltima usada
    var h = localStorage.getItem(CLAVE_H);
    if (errRed(e) && leerCache() && h && (await hashClave(clave)) === h) {
      ESTADO.token = localStorage.getItem(TOKEN_KEY) || 'offline';
      try { await iniciarApp(); avisar('Sin internet: trabajas con los datos guardados en este equipo. Se enviar\u00e1 todo cuando vuelva la conexi\u00f3n.'); }
      catch (e2) { $('loginError').textContent = e2.message; }
    } else $('loginError').textContent = errRed(e) ? (leerCache() ? 'Sin internet. Escribe la misma contrase\u00f1a de la \u00faltima vez para entrar sin conexi\u00f3n.' : 'Sin internet. La primera vez debes ingresar con conexi\u00f3n para descargar los datos.') : e.message;
  }
  cargando(false);
}

function cerrarSesion() {
  if (ESTADO.token) { fetch(CONFIG.API_URL, { method: 'POST', keepalive: true, body: JSON.stringify({ accion: 'salir', token: ESTADO.token }) }).catch(function () {}); }
  ESTADO.token = null; localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem('neb_token');
  $('app').hidden = true; $('pantallaLogin').hidden = false; $('clave').value = '';
}

async function iniciarApp() {
  await recargar();
  $('pantallaLogin').hidden = true; $('app').hidden = false;
  mostrarVista('panel');
}

async function recargar() {
  try {
    if (navigator.onLine) await sincronizar(true);
    var j = await api('listar');
    ESTADO.registros = j.registros.map(function (r) { NUMERICOS.forEach(function (c) { r[c] = r[c] === null ? null : n(r[c]); }); return r; });
    ESTADO.cfg = Object.assign({}, TASAS_DEFECTO, j.config || {});
    leerCola().forEach(aplicarLocal); // lo que a\u00fan no se envi\u00f3 sigue visible
    ESTADO.sinInternet = false; guardarCache();
  } catch (e) {
    if (!errRed(e)) throw e;
    var cache = leerCache();
    if (!cache) throw new Error('Sin internet y sin datos guardados en este equipo. Ingresa una vez con conexi\u00f3n.');
    ESTADO.registros = cache.registros || []; ESTADO.cfg = Object.assign({}, TASAS_DEFECTO, cache.cfg || {});
    leerCola().forEach(aplicarLocal);
    ESTADO.sinInternet = true;
  }
  pintarSync();
  llenarFiltros(); llenarListas(); dibujarPanel(); dibujarRegistros();
}

/* ---------- C\u00e1lculos ---------- */
function calc(r) {
  var pro = n(r.VIV_PRO), neb = n(r.VIV_NEB), cer = n(r.VIV_CER), ren = n(r.VIV_REN), desh = n(r.VIV_DESH);
  var vis = neb + cer + ren + desh;
  return { pro: pro, neb: neb, cer: cer, ren: ren, desh: desh, vis: vis, novis: pro - vis,
    pNeb: pct(neb, pro), pCer: pct(cer, pro), pRen: pct(ren, pro), pDesh: pct(desh, pro), pNovis: pct(pro - vis, pro),
    pMz: pct(n(r.MZ_NEB), n(r.MZ_PRO)) };
}

function normTxt(s) { return String(s === null || s === undefined ? '' : s).trim().toUpperCase().replace(/\s+/g, ' '); }
/* Sector = misma localidad y zona (sin la vuelta); clave = sector + vuelta */
function claveSector(r) { return [r.DISTRITO, r.ESTABLECIMIENTO, r.ZONA].map(normTxt).join('|'); }
function clave(r) { return claveSector(r) + '|' + normTxt(r.VUELTA); }
var ORDEN_VUELTA = ['I', 'II', 'III', 'IV', 'V', 'VI'];
var VUELTAS_META = 3; // se espera que cada sector tenga 3 vueltas
function ordV(v) { var i = ORDEN_VUELTA.indexOf(normTxt(v)); return i < 0 ? 99 : i; }
function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
function noRealizada(r) { return normTxt(r.TIPO) === 'NO_REALIZADA'; }
function esHistorico(r) { return r.CREADO === 'importado'; }
function diasEntre(a, b) { return (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000; }
function mismoDia(r) {
  if (esHistorico(r) || !r.FECHA_INICIO) return false;
  var k = clave(r);
  return ESTADO.registros.some(function (o) { return o.ID !== r.ID && !esHistorico(o) && clave(o) === k && o.FECHA_INICIO === r.FECHA_INICIO; });
}

function alertas(r) {
  if (noRealizada(r)) return [];
  var a = [], c = calc(r);
  if (c.vis > c.pro) a.push('Nebulizadas + cerradas + renuentes + deshabitadas (' + c.vis + ') superan las programadas (' + c.pro + ')');
  if (!r.VUELTA) a.push('Falta la vuelta');
  if (!r.FECHA_INICIO || !r.FECHA_TERMINO) a.push('Falta una fecha');
  else if (r.FECHA_TERMINO < r.FECHA_INICIO) a.push('La fecha de t\u00e9rmino es anterior a la de inicio');
  if (mismoDia(r)) a.push('Hay otro registro de la misma zona y vuelta en el mismo d\u00eda');
  if (/^REVISAR/.test(r.OBSERVACIONES || '') || /; REVISAR/.test(r.OBSERVACIONES || '')) { if (!a.length) a.push('Marcado para revisar en el hist\u00f3rico'); }
  return a;
}

/* Une los registros diarios de la misma zona y vuelta en una sola intervenci\u00f3n:
   suma nebulizadas, cerradas, renuentes, deshabitadas y gasto (las programadas no se duplican); inicio = primer d\u00eda, t\u00e9rmino = \u00faltimo d\u00eda.
   Los registros del hist\u00f3rico ya vienen consolidados y no se unen. */
function consolidar(lista) {
  var orden = lista.filter(function (r) { return !noRealizada(r); }).sort(function (a, b) { return (a.FECHA_INICIO || '').localeCompare(b.FECHA_INICIO || ''); });
  var grupos = [], abiertos = {};
  orden.forEach(function (r) {
    var k = esHistorico(r) ? 'H|' + r.ID : clave(r);
    var g = abiertos[k];
    if (g && r.FECHA_INICIO && g.FECHA_TERMINO && diasEntre(g.FECHA_TERMINO, r.FECHA_INICIO) <= DIAS_CORTE) {
      // Programadas: cada d\u00eda siguiente trae las pendientes; el total del sector es
      // lo programado ese d\u00eda + lo ya visitado antes (se toma el mayor). As\u00ed no se duplican.
      var cr = calc(r);
      g.VIV_PRO = Math.max(n(g.VIV_PRO), n(r.VIV_PRO) + g.VIS_ACUM); g.VIS_ACUM += cr.vis;
      if (r.MZ_PRO !== null && r.MZ_PRO !== '' && r.MZ_PRO !== undefined) g.MZ_PRO = Math.max(n(g.MZ_PRO), n(r.MZ_PRO) + g.MZN_ACUM);
      g.MZN_ACUM += n(r.MZ_NEB);
      NUMERICOS.forEach(function (c) {
        if (c === 'VIV_PRO' || c === 'MZ_PRO') return;
        if (r[c] === null || r[c] === '' || r[c] === undefined) return;
        // Los equipos no se suman: se toma el mayor numero usado en un dia
        g[c] = c.indexOf('EQ_') === 0 ? Math.max(n(g[c]), n(r[c])) : n(g[c]) + n(r[c]);
      });
      if (r.FECHA_TERMINO > g.FECHA_TERMINO) g.FECHA_TERMINO = r.FECHA_TERMINO;
      if (r.OBSERVACIONES && g.OBSERVACIONES.indexOf(r.OBSERVACIONES) < 0) g.OBSERVACIONES += (g.OBSERVACIONES ? '; ' : '') + r.OBSERVACIONES;
      g.DIAS++; g.IDS.push(r.ID);
    } else {
      g = Object.assign({}, r, { DIAS: 1, IDS: [r.ID], OBSERVACIONES: r.OBSERVACIONES || '', VIS_ACUM: calc(r).vis, MZN_ACUM: n(r.MZ_NEB) });
      abiertos[k] = g; grupos.push(g);
    }
  });
  return grupos;
}

function agrupar(lista, fnClave) {
  var m = {};
  lista.forEach(function (r) {
    var k = fnClave(r);
    if (!m[k]) m[k] = { pro: 0, neb: 0, cer: 0, ren: 0, desh: 0, mzp: 0, mzn: 0, lt: 0, ml: 0, pet: 0, gas: 0, n: 0, dias: 0, ini: '', fin: '', muestra: r };
    var g = m[k], c = calc(r);
    g.pro += c.pro; g.neb += c.neb; g.cer += c.cer; g.ren += c.ren; g.desh += c.desh; g.n++; g.dias += r.DIAS || 1;
    g.mzp += n(r.MZ_PRO); g.mzn += n(r.MZ_NEB); g.lt += n(r.INSECTICIDA_L); g.ml += n(r.INSECTICIDA_ML); g.pet += n(r.PETROLEO_GAL); g.gas += n(r.GASOLINA_GAL);
    if (r.FECHA_INICIO && (!g.ini || r.FECHA_INICIO < g.ini)) g.ini = r.FECHA_INICIO;
    if (r.FECHA_TERMINO && (!g.fin || r.FECHA_TERMINO > g.fin)) g.fin = r.FECHA_TERMINO;
  });
  Object.keys(m).forEach(function (k) { var g = m[k]; g.vis = g.neb + g.cer + g.ren + g.desh; g.novis = g.pro - g.vis; });
  return m;
}

/* ---------- Filtros ---------- */
function unicos(campo, lista) {
  var s = {}; (lista || ESTADO.registros).forEach(function (r) { if (r[campo]) s[r[campo]] = 1; });
  return Object.keys(s).sort();
}

function opciones(sel, valores, todos, etiquetas) {
  var actual = sel.value;
  sel.innerHTML = '<option value="">' + todos + '</option>' + valores.map(function (v, i) {
    return '<option value="' + esc(v) + '">' + esc(etiquetas ? etiquetas[i] : v) + '</option>';
  }).join('');
  if (valores.map(String).indexOf(actual) >= 0) sel.value = actual;
}

function llenarFiltros() {
  var meses = unicos('FECHA_INICIO').map(mesDe).filter(function (m, i, a) { return m >= 0 && a.indexOf(m) === i; }).sort(function (a, b) { return a - b; });
  opciones($('fMes'), meses, 'Todos', meses.map(function (m) { return MESES[m]; }));
  opciones($('fDistrito'), unicos('DISTRITO'), 'Todos');
  var base = $('fDistrito').value ? ESTADO.registros.filter(function (r) { return r.DISTRITO === $('fDistrito').value; }) : null;
  opciones($('fEess'), unicos('ESTABLECIMIENTO', base), 'Todos');
  opciones($('fVuelta'), unicos('VUELTA'), 'Todas');
}

function filtrados() {
  var d = $('fDesde').value, h = $('fHasta').value, m = $('fMes').value, dis = $('fDistrito').value, e = $('fEess').value, v = $('fVuelta').value;
  var base = ESTADO.registros.filter(function (r) {
    if (dis && r.DISTRITO !== dis) return false;
    if (e && r.ESTABLECIMIENTO !== e) return false;
    if (v && r.VUELTA !== v) return false;
    return true;
  });
  // Las fechas se filtran por el inicio de la intervenci\u00f3n ya consolidada
  return consolidar(base).filter(function (g) {
    if (d && g.FECHA_INICIO < d) return false;
    if (h && g.FECHA_INICIO > h) return false;
    if (m !== '' && mesDe(g.FECHA_INICIO) !== Number(m)) return false;
    return true;
  });
}

/* ---------- Panel ---------- */
function dibujarPanel() {
  var lista = filtrados();
  var t = agrupar(lista, function () { return 'T'; }).T || { pro: 0, neb: 0, cer: 0, ren: 0, desh: 0, vis: 0, novis: 0, lt: 0, pet: 0, gas: 0, n: 0, dias: 0 };
  var eess = unicos('ESTABLECIMIENTO', lista).length;
  $('tarjetas').innerHTML =
    tarjeta(fmtPct(pct(t.neb, t.pro)), 'Cobertura de nebulizaci\u00f3n', fmt(t.neb) + ' de ' + fmt(t.pro) + ' viviendas programadas', true) +
    tarjeta(fmt(t.n), 'Intervenciones', eess + ' establecimientos, ' + fmt(t.dias) + ' d\u00edas de trabajo') +
    tarjeta(fmt(t.neb), 'Viviendas nebulizadas', fmt(t.vis) + ' visitadas') +
    tarjeta(fmt(t.cer + t.ren), 'Cerradas y renuentes', fmt(t.cer) + ' cerradas, ' + fmt(t.ren) + ' renuentes') +
    tarjeta(fmt(t.lt), 'Insecticida (litros)', fmt(t.pet, 1) + ' gal petr\u00f3leo, ' + fmt(t.gas, 1) + ' gal gasolina');
  graficoMes(lista); graficoCondicion(t); graficoEess(lista); tablaConsolidado(lista); tablaVueltas(lista);
}

function tarjeta(valor, etiqueta, detalle, destacada) {
  return '<div class="tarjeta' + (destacada ? ' destacada' : '') + '"><div class="valor">' + valor + '</div><div class="etiqueta">' + etiqueta + '</div><div class="detalle">' + detalle + '</div></div>';
}

function grafico(id, cfg) {
  if (typeof Chart === 'undefined') return;
  if (ESTADO.charts[id]) ESTADO.charts[id].destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }, cfg.options || {});
  ESTADO.charts[id] = new Chart($(id), cfg);
}

function graficoMes(lista) {
  var g = agrupar(lista, function (r) { return mesDe(r.FECHA_INICIO); });
  var meses = Object.keys(g).map(Number).filter(function (m) { return m >= 0; }).sort(function (a, b) { return a - b; });
  grafico('gMes', {
    data: {
      labels: meses.map(function (m) { return MESES[m]; }),
      datasets: [
        { type: 'bar', label: 'Programadas', data: meses.map(function (m) { return g[m].pro; }), backgroundColor: '#cfdad3', yAxisID: 'y' },
        { type: 'bar', label: 'Nebulizadas', data: meses.map(function (m) { return g[m].neb; }), backgroundColor: COLORES.neb, yAxisID: 'y' },
        { type: 'line', label: 'Cobertura %', data: meses.map(function (m) { return +(pct(g[m].neb, g[m].pro) * 100).toFixed(1); }), borderColor: COLORES.cer, backgroundColor: COLORES.cer, yAxisID: 'y1', tension: .25 }
      ]
    },
    options: { scales: { y: { beginAtZero: true, title: { display: true, text: 'Viviendas' } }, y1: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: 'Cobertura %' } } } }
  });
}

function graficoCondicion(t) {
  grafico('gCondicion', {
    type: 'doughnut',
    data: {
      labels: ['Nebulizadas', 'Cerradas', 'Renuentes', 'Deshabitadas', 'No visitadas'],
      datasets: [{ data: [t.neb, t.cer, t.ren, t.desh, Math.max(t.novis, 0)], backgroundColor: [COLORES.neb, COLORES.cer, COLORES.ren, COLORES.desh, COLORES.novis] }]
    },
    options: { cutout: '58%', plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: function (c) { return c.label + ': ' + fmt(c.raw) + ' (' + fmtPct(pct(c.raw, t.pro)) + ')'; } } } } }
  });
}

function graficoEess(lista) {
  var g = agrupar(lista, function (r) { return r.ESTABLECIMIENTO; });
  var ks = Object.keys(g).sort(function (a, b) { return pct(g[b].neb, g[b].pro) - pct(g[a].neb, g[a].pro); });
  grafico('gEess', {
    type: 'bar',
    data: { labels: ks, datasets: [{ label: 'Cobertura %', data: ks.map(function (k) { return +(pct(g[k].neb, g[k].pro) * 100).toFixed(1); }),
      backgroundColor: ks.map(function (k) { var p = pct(g[k].neb, g[k].pro); return p < .6 ? COLORES.ren : p < .8 ? COLORES.cer : COLORES.neb; }) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { min: 0, max: 100 } } }
  });
}

function tablaConsolidado(lista) {
  var g = agrupar(lista, function (r) { return [String(mesDe(r.FECHA_INICIO) + 100), r.DISTRITO, r.ESTABLECIMIENTO, r.VUELTA].join('|'); });
  var ks = Object.keys(g).sort();
  var cab = '<thead><tr><th>Mes</th><th>Distrito</th><th>Establecimiento</th><th>Vuelta</th><th class="num">Interv.</th><th class="num">Programadas</th><th class="num">Nebulizadas</th><th class="num">Cerradas</th><th class="num">Renuentes</th><th class="num">No visitadas</th><th class="num">% Nebulizadas</th><th class="num">% Cerradas</th><th class="num">% Renuentes</th><th class="num">Insect. (L)</th></tr></thead>';
  var t = { pro: 0, neb: 0, cer: 0, ren: 0, novis: 0, n: 0, lt: 0 };
  var filas = ks.map(function (k) {
    var x = g[k], p = k.split('|');
    ['pro', 'neb', 'cer', 'ren', 'novis', 'n', 'lt'].forEach(function (c) { t[c] += x[c]; });
    return '<tr><td>' + (MESES[Number(p[0]) - 100] || '-') + '</td><td>' + esc(p[1]) + '</td><td>' + esc(p[2]) + '</td><td>' + esc(p[3] || '-') + '</td>' +
      '<td class="num">' + x.n + '</td><td class="num">' + fmt(x.pro) + '</td><td class="num">' + fmt(x.neb) + '</td><td class="num">' + fmt(x.cer) + '</td><td class="num">' + fmt(x.ren) + '</td><td class="num">' + fmt(x.novis) + '</td>' +
      '<td class="num"><span class="cob ' + claseCob(pct(x.neb, x.pro)) + '">' + fmtPct(pct(x.neb, x.pro)) + '</span></td><td class="num">' + fmtPct(pct(x.cer, x.pro)) + '</td><td class="num">' + fmtPct(pct(x.ren, x.pro)) + '</td><td class="num">' + fmt(x.lt) + '</td></tr>';
  }).join('');
  var tot = ks.length ? '<tr class="total"><td colspan="4">Total</td><td class="num">' + t.n + '</td><td class="num">' + fmt(t.pro) + '</td><td class="num">' + fmt(t.neb) + '</td><td class="num">' + fmt(t.cer) + '</td><td class="num">' + fmt(t.ren) + '</td><td class="num">' + fmt(t.novis) + '</td><td class="num">' + fmtPct(pct(t.neb, t.pro)) + '</td><td class="num">' + fmtPct(pct(t.cer, t.pro)) + '</td><td class="num">' + fmtPct(pct(t.ren, t.pro)) + '</td><td class="num">' + fmt(t.lt) + '</td></tr>' :
    '<tr><td colspan="14">No hay intervenciones con estos filtros. Cambia los filtros o registra una nueva intervenci\u00f3n.</td></tr>';
  $('tablaConsolidado').innerHTML = cab + '<tbody>' + filas + tot + '</tbody>';
}

/* ---------- Control de vueltas por localidad y zona ---------- */
/* Para cada sector (localidad + zona) mira todas sus vueltas en todos los registros:
   realizada, en avance (faltan viviendas), no realizada (con motivo) o pendiente. */
function estadoSectores(lista) {
  var orden = [], vistos = {};
  lista.forEach(function (g) {
    var k = claveSector(g);
    if (!vistos[k]) { vistos[k] = { k: k, muestra: g, ini: g.FECHA_INICIO || '' }; orden.push(vistos[k]); }
    else if (g.FECHA_INICIO && (!vistos[k].ini || g.FECHA_INICIO < vistos[k].ini)) vistos[k].ini = g.FECHA_INICIO;
  });
  var todos = consolidar(ESTADO.registros), motivos = ESTADO.registros.filter(noRealizada);
  return orden.map(function (s) {
    var porV = {};
    todos.forEach(function (g) { if (claveSector(g) === s.k) { var v = normTxt(g.VUELTA); (porV[v] = porV[v] || []).push(g); } });
    var mot = {};
    motivos.forEach(function (m) { if (claveSector(m) === s.k) mot[normTxt(m.VUELTA)] = m; });
    var hechas = Object.keys(porV).map(ordV).filter(function (i) { return i < 99; });
    var ultimaHecha = hechas.length ? Math.max.apply(null, hechas) : -1;
    var maxI = Math.max.apply(null, [VUELTAS_META - 1, ultimaHecha].concat(Object.keys(mot).map(ordV).filter(function (i) { return i < 99; })));
    var celdas = [], pro = 0, faltan = [];
    for (var i = 0; i <= maxI; i++) {
      var v = ORDEN_VUELTA[i], gs = porV[v];
      if (gs) {
        var t = agrupar(gs, function () { return 'T'; }).T;
        pro = t.pro || pro;
        var est = t.vis >= t.pro || i < ultimaHecha || !t.fin || diasEntre(t.fin, hoyISO()) > DIAS_CORTE ? 'ok' : 'avance';
        celdas.push({ v: v, est: est, t: t });
      } else if (mot[v]) celdas.push({ v: v, est: 'no', m: mot[v] });
      else celdas.push({ v: v, est: 'pend' });
    }
    celdas.forEach(function (c) { if (c.est === 'pend') faltan.push(c.v); if (c.est === 'avance') faltan.push(c.v + ' (en avance)'); });
    return { k: s.k, muestra: s.muestra, ini: s.ini, celdas: celdas, pro: pro, faltan: faltan };
  });
}

function asegurarSeccionVueltas() {
  if ($('tablaVueltas')) return true;
  var t = $('tablaConsolidado'); if (!t) return false;
  var cont = t, panel = $('vista-panel');
  while (cont.parentElement && cont.parentElement !== panel) cont = cont.parentElement;
  var sec = document.createElement(cont.tagName === 'TABLE' ? 'div' : cont.tagName);
  sec.className = cont === t ? '' : cont.className;
  var tit = cont.querySelector('h1,h2,h3,h4');
  var tag = tit ? tit.tagName.toLowerCase() : 'h2';
  var envoltura = t.parentElement !== cont && t.parentElement ? t.parentElement.className : '';
  sec.innerHTML = '<' + tag + (tit && tit.className ? ' class="' + tit.className + '"' : '') + '>Control de vueltas por localidad y zona</' + tag + '>' +
    '<p style="margin:2px 0 10px;font-size:.85rem;color:#4b5b53">Cada localidad + zona debe tener ' + VUELTAS_META + ' vueltas. Si una vuelta no se pudo hacer, registra el motivo y saldr\u00e1 as\u00ed en el consolidado.</p>' +
    '<div class="' + envoltura + '" style="overflow-x:auto"><table id="tablaVueltas" class="' + (t.className || '') + '"></table></div>';
  (cont === t ? t : cont).after(sec);
  $('tablaVueltas').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.motivo) registrarMotivo(+b.dataset.motivo, b.dataset.v);
    if (b.dataset.quitar) eliminarRegistro(b.dataset.quitar);
  });
  return true;
}

function tablaVueltas(lista) {
  if (!asegurarSeccionVueltas()) return;
  var ss = estadoSectores(lista).sort(function (a, b) { return (a.ini || '9').localeCompare(b.ini || '9') || a.k.localeCompare(b.k); });
  ESTADO.vueltas = ss;
  var nV = ss.reduce(function (m, s) { return Math.max(m, s.celdas.length); }, VUELTAS_META);
  var cab = '<thead><tr><th>Distrito</th><th>Localidad (EESS)</th><th>Zona</th><th class="num">Programadas</th>';
  for (var i = 0; i < nV; i++) cab += '<th style="text-align:center">Vuelta ' + ORDEN_VUELTA[i] + '</th>';
  cab += '<th>Estado</th></tr></thead>';
  var completos = 0;
  var filas = ss.map(function (s, idx) {
    var r = s.muestra, td = '';
    for (var i = 0; i < nV; i++) {
      var c = s.celdas[i];
      if (!c) { td += '<td></td>'; continue; }
      if (c.est === 'ok') td += '<td style="text-align:center;background:#e8f5ec">\u2705<br><small>' + fechaCorta(c.t.ini).slice(0, 5) + (c.t.fin && c.t.fin !== c.t.ini ? ' al ' + fechaCorta(c.t.fin).slice(0, 5) : '') + ' \u00b7 ' + fmtPct(pct(c.t.neb, c.t.pro)) + '</small></td>';
      else if (c.est === 'avance') td += '<td style="text-align:center;background:#fff7e0">\u23f3 En avance<br><small>faltan ' + fmt(c.t.novis) + ' de ' + fmt(c.t.pro) + '</small></td>';
      else if (c.est === 'no') td += '<td style="text-align:center;background:#fdecea">\u26a0\ufe0f No realizada<br><small title="' + esc(c.m.OBSERVACIONES) + '">' + esc(String(c.m.OBSERVACIONES || '').slice(0, 60)) + '</small><br><button class="btn btn-claro btn-mini" type="button" data-quitar="' + esc(c.m.ID) + '">Quitar motivo</button></td>';
      else td += '<td style="text-align:center">Pendiente<br><button class="btn btn-claro btn-mini" type="button" data-motivo="' + idx + '" data-v="' + c.v + '">Registrar motivo</button></td>';
    }
    var ok = !s.faltan.length; if (ok) completos++;
    return '<tr><td>' + esc(r.DISTRITO) + '</td><td>' + esc(r.ESTABLECIMIENTO) + '</td><td>' + esc(r.ZONA) + '</td><td class="num">' + fmt(s.pro) + '</td>' + td +
      '<td>' + (ok ? '<b style="color:#2f7d4f">Completo</b>' : 'Falta: ' + esc(s.faltan.join(', '))) + '</td></tr>';
  }).join('');
  $('tablaVueltas').innerHTML = cab + '<tbody>' + (filas || '<tr><td colspan="' + (nV + 5) + '">No hay intervenciones con estos filtros.</td></tr>') +
    (ss.length ? '<tr class="total"><td colspan="' + (nV + 5) + '">' + completos + ' de ' + ss.length + ' localidades/zonas con sus vueltas completas</td></tr>' : '') + '</tbody>';
}

async function registrarMotivo(idx, v) {
  var s = ESTADO.vueltas[idx]; if (!s) return;
  var r = s.muestra;
  var motivo = prompt('Vuelta ' + v + ' de ' + r.ESTABLECIMIENTO + ' \u00b7 ' + (r.ZONA || 'sin zona') + '\n\n\u00bfPor qu\u00e9 no se realiz\u00f3 esta vuelta?');
  if (motivo === null) return;
  motivo = motivo.trim();
  if (!motivo) { avisar('Escribe el motivo para registrarlo.', true); return; }
  var o = { ID: '', TIPO: 'NO_REALIZADA', VUELTA: v, OBSERVACIONES: motivo, VIV_PRO: s.pro || '', FECHA_INICIO: '', FECHA_TERMINO: '' };
  ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA'].forEach(function (c) { o[c] = r[c] || ''; });
  NUMERICOS.forEach(function (c) { if (c !== 'VIV_PRO') o[c] = ''; });
  cargando(true);
  try {
    var ok = await guardarRegistro(o);
    avisar('Motivo registrado: vuelta ' + v + ' no realizada' + (ok ? '.' : ' (guardado en el equipo; se enviar\u00e1 cuando haya internet).'));
  } catch (e) { avisar(e.message, true); }
  cargando(false);
}

/* ---------- Avance de la vuelta en el formulario ---------- */
function avanceVuelta(o) {
  if (!o.ESTABLECIMIENTO || !o.VUELTA) return null;
  var k = clave(o), ks = claveSector(o);
  var otros = ESTADO.registros.filter(function (r) { return !noRealizada(r) && r.ID !== o.ID && claveSector(r) === ks; });
  var g = null;
  consolidar(otros.filter(function (r) { return clave(r) === k; })).forEach(function (x) {
    if (!o.FECHA_INICIO || !x.FECHA_TERMINO) { g = x; return; }
    var d = diasEntre(x.FECHA_TERMINO, o.FECHA_INICIO);
    if (d <= DIAS_CORTE && d >= -DIAS_CORTE) g = x;
  });
  var prev = null, vi = ordV(o.VUELTA);
  consolidar(otros).forEach(function (x) {
    var i = ordV(x.VUELTA);
    if (i < vi && (!prev || i > ordV(prev.VUELTA) || (i === ordV(prev.VUELTA) && x.FECHA_INICIO > prev.FECHA_INICIO))) prev = x;
  });
  if (prev) prev = Object.assign({}, prev, agrupar(consolidar(otros.filter(function (r) { return clave(r) === clave(prev); })), function () { return 'T'; }).T);
  var sig = ORDEN_VUELTA[vi + 1] || null;
  return { g: g, c: g ? calc(g) : null, mzPend: g ? n(g.MZ_PRO) - n(g.MZ_NEB) : 0, prev: prev, sig: sig };
}

function cajaAvance() {
  var box = $('avisoVuelta');
  if (box) return box;
  var ref = $('VIV_PRO'); if (!ref) return null;
  var fs = ref.closest('fieldset') || ref.parentElement;
  box = document.createElement('div');
  box.id = 'avisoVuelta'; box.hidden = true;
  box.style.cssText = 'margin:0 0 14px;padding:10px 14px;border-radius:8px;font-size:.9rem;line-height:1.45;border:1px solid';
  fs.parentElement.insertBefore(box, fs);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.usar) { $('VIV_PRO').value = b.dataset.usar; ESTADO.proManual = false; if (!ESTADO.gastoManual) recalcularGasto(); actualizarCalculos(); }
    if (b.dataset.vuelta) {
      var sel = $('VUELTA');
      if (![].some.call(sel.options || [], function (op) { return op.value === b.dataset.vuelta; }) && sel.tagName === 'SELECT') sel.add(new Option(b.dataset.vuelta, b.dataset.vuelta));
      sel.value = b.dataset.vuelta; ESTADO.proManual = false; ESTADO.mzManual = false; revisarVuelta();
    }
  });
  return box;
}

function revisarVuelta() {
  var box = cajaAvance(); if (!box) return;
  var o = leerFormulario(), a = avanceVuelta(o);
  var nuevo = !ESTADO.editandoId, sugerido = null, sugMz = null, html = '', tono = 'info';
  if (a && a.g) {
    var c = a.c, dias = a.g.DIAS + ' d\u00eda' + (a.g.DIAS === 1 ? '' : 's') + ' (' + fechaCorta(a.g.FECHA_INICIO) + (a.g.FECHA_TERMINO !== a.g.FECHA_INICIO ? ' al ' + fechaCorta(a.g.FECHA_TERMINO) : '') + ')';
    if (c.novis > 0) {
      sugerido = c.novis; sugMz = a.mzPend > 0 ? a.mzPend : null;
      html = '<b>Esta zona ya tiene avance en la vuelta ' + esc(normTxt(o.VUELTA)) + '</b>: ' + dias + ', ' + fmt(c.pro) + ' programadas y ' + fmt(c.vis) + ' visitadas (' + fmt(c.neb) + ' nebulizadas).<br>' +
        '<b style="font-size:1.05rem">Pendientes: ' + fmt(c.novis) + ' viviendas</b>' + (sugMz ? ' \u00b7 ' + fmt(sugMz) + ' manzanas' : '') +
        '. En el consolidado este d\u00eda se suma a la misma fila.' + (n($('VIV_PRO').value) === c.novis ? '' : ' <button class="btn btn-claro btn-mini" type="button" data-usar="' + c.novis + '">Usar ' + c.novis + ' como programadas</button>');
    } else {
      tono = 'ok';
      html = '<b>La vuelta ' + esc(normTxt(o.VUELTA)) + ' de esta zona ya est\u00e1 completa</b>: ' + dias + ', ' + fmt(c.pro) + ' programadas y ' + fmt(c.vis) + ' visitadas.' +
        (a.sig ? ' <button class="btn btn-claro btn-mini" type="button" data-vuelta="' + a.sig + '">Pasar a la vuelta ' + a.sig + '</button>' : '');
    }
  } else if (a && a.prev) {
    sugerido = a.prev.pro || null; sugMz = n(a.prev.mzp) || null;
    html = '<b>Vuelta ' + esc(normTxt(o.VUELTA)) + ' nueva en esta zona.</b> En la vuelta ' + esc(normTxt(a.prev.VUELTA)) + ' se programaron ' + fmt(a.prev.pro) + ' viviendas' + (sugMz ? ' y ' + fmt(sugMz) + ' manzanas' : '') + '; las vueltas llevan las mismas programadas.';
  }
  if (!html) { box.hidden = true; box.innerHTML = ''; return; }
  var col = tono === 'ok' ? ['#e8f5ec', '#9fd1b0', '#14532d'] : ['#fff7e0', '#f0d48a', '#5c4300'];
  box.style.background = col[0]; box.style.borderColor = col[1]; box.style.color = col[2];
  box.innerHTML = html; box.hidden = false;
  if (nuevo && sugerido !== null) {
    if (!ESTADO.proManual) { $('VIV_PRO').value = sugerido; if (!ESTADO.gastoManual) recalcularGasto(); }
    if (!ESTADO.mzManual && sugMz !== null && $('MZ_PRO')) $('MZ_PRO').value = sugMz;
    actualizarCalculos();
  }
}

/* ---------- Exportar consolidado (formato del Excel original) ---------- */
async function exportar() {
  if (typeof ExcelJS === 'undefined') { avisar('No se pudo cargar la librer\u00eda de Excel. Revisa tu conexi\u00f3n.', true); return; }
  // Filas agrupadas por localidad + zona (en el orden en que se empez\u00f3), y dentro por vuelta I, II, III
  var sect = {}, ordenS = [];
  filtrados().forEach(function (g) {
    var k = claveSector(g);
    if (!sect[k]) { sect[k] = { ini: g.FECHA_INICIO || '9999', filas: [], vs: {} }; ordenS.push(k); }
    sect[k].filas.push(g); sect[k].vs[normTxt(g.VUELTA)] = 1;
    if (g.FECHA_INICIO && g.FECHA_INICIO < sect[k].ini) sect[k].ini = g.FECHA_INICIO;
  });
  var fV = $('fVuelta').value;
  ESTADO.registros.filter(noRealizada).forEach(function (m) {
    var s = sect[claveSector(m)], v = normTxt(m.VUELTA);
    if (s && !s.vs[v] && (!fV || normTxt(fV) === v)) { s.filas.push(Object.assign({}, m, { NOREAL: true })); s.vs[v] = 1; }
  });
  ordenS.sort(function (a, b) { return sect[a].ini.localeCompare(sect[b].ini) || a.localeCompare(b); });
  var lista = [], grupoDe = [];
  ordenS.forEach(function (k, gi) {
    sect[k].filas.sort(function (a, b) { return ordV(a.VUELTA) - ordV(b.VUELTA) || (a.FECHA_INICIO || '').localeCompare(b.FECHA_INICIO || ''); })
      .forEach(function (r) { lista.push(r); grupoDe.push(gi); });
  });
  var PALETA = ['FFE6B8A2', 'FFBDD7EE', 'FFA9D08E', 'FFFFF2A8', 'FFFFC000', 'FFFCE4D6', 'FFD9A6C4', 'FFC6EFCE', 'FFDDEBF7', 'FFFFE699', 'FFD0CECE', 'FFF4B183'];
  function limpiaObs(t) { return String(t || '').split('; ').filter(function (x) { return x && !/^REVISAR/.test(x); }).join('; '); }
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('Base de datos', { views: [{ state: 'frozen', ySplit: 5 }] });
  var NC = 33;
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:5' };
  var ancho = [12, 16, 12, 24, 26, 4, 6, 6, 6, 6, 6, 6, 7, 8, 8, 8, 8, 8, 6, 6, 8, 9, 9, 9, 9, 10, 6, 7, 8, 11, 11, 11, 40];
  ancho.forEach(function (w, i) { ws.getColumn(i + 1).width = w; });

  // Fila 1: t\u00edtulo
  ws.mergeCells(1, 1, 1, NC);
  var t = ws.getCell(1, 1);
  t.value = 'CONSOLIDADO MENSUAL DE NEBULIZACI\u00d3N ESPACIAL';
  t.font = { name: 'Arial', size: 14, bold: true }; t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  // Filas 3 y 4: encabezados
  var fila3 = ['Provincia', 'Distrito', 'UNGETS', 'Localidad (EESS)', 'ZONA - SECTOR - MZ - otra descripci\u00f3n', 'Vuelta',
    'Viviendas', '', '', '', '', '', 'Visitadas', 'Cobertura viv. nebulizadas', 'Cobertura viv. Cerradas', 'Cobertura viv. Renuentes',
    'Cobertura viv. Deshabitadas', 'Cobertura viv. No_visitadas', 'Manzanas', '', 'Cobertura mz. nebulizadas', 'N\u00famero de', '', '', '', '',
    'Gasto de insecticida en litros', 'Gasto de petr\u00f3leo en galones', 'Gasto de gasolina en galones', 'Mes', 'Fecha de intervenci\u00f3n (inicio)', 'Fecha de intervenci\u00f3n (t\u00e9rmino)', 'Observaciones'];
  var fila4 = ['', '', '', '', '', '', 'Programadas', 'Nebulizadas', 'Cerradas', 'Renuentes', 'Deshabitadas', 'No visitadas', '', '', '', '', '', '',
    'Programadas', 'Nebulizadas', '', 'Equipo port\u00e1til frio', 'Equipo port\u00e1til caliente', 'Equipo pesado frio', 'Equipo pesado caliente', '', '', '', '', '', '', '', ''];
  var fila5 = ['Provincia', 'Distrito', 'UNGETS', 'Localidad', 'zonas', 'Vuelta', 'viv_pro', 'viv_neb', 'viv_cer', 'viv_ren', 'viv_desh', 'viv_no_vis',
    'visitadas', '% viv_neb', '% viv_cerr', '% viv_ren', '% viv_desh', '% viv_no_visitada', 'mz_pro', 'mz_neb', '% mz_neb',
    'N\u00b0_eq_por_frio', 'N\u00b0_eq_por_cali', 'N\u00b0_eq_pesado_frio', 'N\u00b0_eq_pesado_cali', '', 'insec_litros', 'petr_galones', 'gasolina_galones', 'mes', 'inicio', 't\u00e9rmino', 'observaciones'];
  ws.getRow(3).values = fila3; ws.getRow(4).values = fila4; ws.getRow(5).values = fila5;
  // Combinar: grupos en fila 3 y columnas simples en filas 3-4
  ws.mergeCells(3, 7, 3, 12); ws.mergeCells(3, 19, 3, 20); ws.mergeCells(3, 22, 3, 25);
  [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18, 21, 26, 27, 28, 29, 30, 31, 32, 33].forEach(function (c) { ws.mergeCells(3, c, 4, c); });
  var vertical = [6, 13, 14, 15, 16, 17, 18, 21, 27, 28, 29];
  var amarillo = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  var borde = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  [3, 4, 5].forEach(function (r) {
    for (var c = 1; c <= NC; c++) {
      var cel = ws.getCell(r, c);
      cel.fill = amarillo; cel.border = borde;
      cel.font = { name: 'Arial', size: 9, bold: true };
      var rot = (r === 4 && ((c >= 7 && c <= 12) || (c >= 19 && c <= 20) || (c >= 22 && c <= 25))) || (r === 3 && vertical.indexOf(c) >= 0);
      cel.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, textRotation: rot ? 90 : 0 };
    }
  });
  ws.getRow(3).height = 30; ws.getRow(4).height = 70; ws.getRow(5).height = 26;
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: NC } };

  // Datos desde la fila 6
  function v(x) { return x === null || x === undefined || x === '' ? null : n(x); }
  function eq(x) { return n(x) > 0 ? n(x) : null; }
  function fecha(f) { return f ? new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10))) : null; }
  lista.forEach(function (r, i) {
    var c = calc(r);
    var fila = ws.getRow(6 + i);
    if (r.NOREAL) fila.values = [r.PROVINCIA, r.DISTRITO, r.UNGETS, r.ESTABLECIMIENTO, r.ZONA, r.VUELTA, v(r.VIV_PRO)].concat(new Array(25).fill(null), ['VUELTA NO REALIZADA: ' + (r.OBSERVACIONES || '')]);
    else fila.values = [r.PROVINCIA, r.DISTRITO, r.UNGETS, r.ESTABLECIMIENTO, r.ZONA, r.VUELTA, c.pro, c.neb, c.cer, c.ren, c.desh, c.novis, c.vis,
      c.pNeb, c.pCer, c.pRen, c.pDesh, c.pNovis, v(r.MZ_PRO), v(r.MZ_NEB), c.pMz === null ? null : c.pMz * 100,
      eq(r.EQ_PORT_FRIO), eq(r.EQ_PORT_CALIENTE), eq(r.EQ_PESADO_FRIO), eq(r.EQ_PESADO_CALIENTE),
      v(r.INSECTICIDA_ML), v(r.INSECTICIDA_L), v(r.PETROLEO_GAL), v(r.GASOLINA_GAL), (MESES[mesDe(r.FECHA_INICIO)] || '').toUpperCase(),
      fecha(r.FECHA_INICIO), fecha(r.FECHA_TERMINO), limpiaObs(r.OBSERVACIONES) || null];
    for (var col = 1; col <= NC; col++) {
      var cel = fila.getCell(col);
      cel.border = borde; cel.font = { name: 'Arial', size: 9, color: r.NOREAL ? { argb: 'FF9C0006' } : undefined, italic: !!r.NOREAL };
      cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALETA[grupoDe[i] % PALETA.length] } };
      cel.alignment = { horizontal: col <= 5 ? 'left' : col === 6 || col === 30 ? 'center' : col >= 31 ? 'center' : 'right', vertical: 'middle' };
      if (col >= 14 && col <= 18) cel.numFmt = '0.00%';
      if (col === 21 || col === 26) cel.numFmt = '0.00';
      if (col === 28 || col === 29) cel.numFmt = '0.0';
      if (col === 31 || col === 32) cel.numFmt = 'dd/mm/yyyy';
      if (col === 33) cel.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    }
  });

  var buf = await wb.xlsx.writeBuffer();
  var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Consolidado_Nebulizacion_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
}

function textoFiltros() {
  var p = [];
  if ($('fDesde').value) p.push('desde ' + fechaCorta($('fDesde').value));
  if ($('fHasta').value) p.push('hasta ' + fechaCorta($('fHasta').value));
  if ($('fMes').value !== '') p.push('mes ' + MESES[Number($('fMes').value)]);
  if ($('fDistrito').value) p.push('distrito ' + $('fDistrito').value);
  if ($('fEess').value) p.push($('fEess').value);
  if ($('fVuelta').value) p.push('vuelta ' + $('fVuelta').value);
  return p.length ? 'Filtros: ' + p.join(', ') : 'Todas las intervenciones registradas';
}

/* ---------- Registros ---------- */
function dibujarRegistros() {
  var q = $('buscar').value.trim().toUpperCase(), soloRev = $('soloRevisar').checked;
  var lista = ESTADO.registros.slice().sort(function (a, b) { return (b.FECHA_INICIO || '').localeCompare(a.FECHA_INICIO || ''); });
  var conAlerta = 0, visibles = [];
  var filas = lista.map(function (r) {
    var al = alertas(r);
    if (al.length) conAlerta++;
    if (soloRev && !al.length) return '';
    if (q && [r.ESTABLECIMIENTO, r.ZONA, r.DISTRITO, r.OBSERVACIONES, r.VUELTA].join(' ').toUpperCase().indexOf(q) < 0) return '';
    visibles.push(r.ID);
    var marcado = !!ESTADO.sel[r.ID];
    var chk = '<td class="col-sel"><input type="checkbox" class="sel-reg" data-id="' + esc(r.ID) + '"' + (marcado ? ' checked' : '') + ' aria-label="Seleccionar registro"></td>';
    var marcaP = r.PEND ? '<span class="marca-rev" style="background:' + (r.ERR ? '#fde2e1;color:#9c0006' : '#fff3c4;color:#5c4300') + '" title="' + esc(r.ERR || 'Guardado en este equipo; se enviar\u00e1 cuando haya internet') + '">' + (r.ERR ? '\u26a0\ufe0f No se pudo enviar' : '\u23f3 Por enviar') + '</span> ' : '';
    if (noRealizada(r)) return '<tr style="background:#fdecea"' + (marcado ? ' class="sel"' : '') + '>' + chk + '<td>-</td><td>' + esc(r.DISTRITO) + '</td><td>' + esc(r.ESTABLECIMIENTO) + '</td><td>' + esc(r.ZONA) + '</td><td>' + esc(r.VUELTA || '-') + '</td>' +
      '<td class="num">' + fmt(r.VIV_PRO) + '</td><td colspan="5" style="text-align:center"><b>\u26a0\ufe0f Vuelta no realizada</b></td><td>' + marcaP + esc(r.OBSERVACIONES) + '</td>' +
      '<td><div class="celda-acc"><button class="btn btn-peligro btn-mini" data-eliminar="' + esc(r.ID) + '">Quitar</button></div></td></tr>';
    var c = calc(r);
    var cls = ((al.length ? 'revisar ' : '') + (marcado ? 'sel' : '')).trim();
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + chk +
      '<td>' + fechaCorta(r.FECHA_INICIO) + (r.FECHA_TERMINO && r.FECHA_TERMINO !== r.FECHA_INICIO ? ' al ' + fechaCorta(r.FECHA_TERMINO) : '') + '</td>' +
      '<td>' + esc(r.DISTRITO) + '</td><td>' + esc(r.ESTABLECIMIENTO) + '</td><td>' + esc(r.ZONA) + '</td><td>' + esc(r.VUELTA || '-') + '</td>' +
      '<td class="num">' + fmt(c.pro) + '</td><td class="num">' + fmt(c.neb) + '</td><td class="num">' + fmt(c.cer) + '</td><td class="num">' + fmt(c.ren) + '</td><td class="num">' + fmt(c.novis) + '</td>' +
      '<td class="num"><span class="cob ' + claseCob(c.pNeb) + '">' + fmtPct(c.pNeb) + '</span></td>' +
      '<td>' + marcaP + (al.length ? '<span class="marca-rev" title="' + esc(al.join('. ')) + '">Revisar</span> ' : '') + esc(r.OBSERVACIONES) + '</td>' +
      '<td><div class="celda-acc"><button class="btn btn-claro btn-mini" data-editar="' + esc(r.ID) + '">Editar</button><button class="btn btn-peligro btn-mini" data-eliminar="' + esc(r.ID) + '">Eliminar</button></div></td></tr>';
  }).join('');
  $('resumenRegistros').textContent = 'Cada fila es un d\u00eda de trabajo; en el panel y el consolidado los d\u00edas seguidos de la misma zona y vuelta se suman en una sola intervenci\u00f3n (las programadas de cada d\u00eda son las pendientes, as\u00ed la suma da el total del sector). ' + ESTADO.registros.length + ' registros en total' + (conAlerta ? ', ' + conAlerta + ' por revisar (en amarillo; pasa el cursor sobre "Revisar" para ver el motivo).' : '.');
  // Solo quedan seleccionados los registros que se ven con el filtro actual
  var nuevaSel = {}; visibles.forEach(function (id) { if (ESTADO.sel[id]) nuevaSel[id] = 1; }); ESTADO.sel = nuevaSel;
  ESTADO.visibles = visibles;
  var todosMarcados = visibles.length > 0 && visibles.every(function (id) { return ESTADO.sel[id]; });
  $('tablaRegistros').innerHTML = '<thead><tr><th class="col-sel"><input type="checkbox" id="selTodos" title="Seleccionar todos los que se ven"' + (todosMarcados ? ' checked' : '') + (visibles.length ? '' : ' disabled') + ' aria-label="Seleccionar todos"></th><th>Fecha</th><th>Distrito</th><th>Establecimiento</th><th>Zona</th><th>Vuelta</th><th class="num">Program.</th><th class="num">Nebuliz.</th><th class="num">Cerradas</th><th class="num">Renuentes</th><th class="num">No visit.</th><th class="num">Cobertura</th><th>Observaciones</th><th></th></tr></thead><tbody>' +
    (filas || '<tr><td colspan="14">No hay registros que coincidan. Registra una intervenci\u00f3n o importa el Excel hist\u00f3rico.</td></tr>') + '</tbody>';
  actualizarSelTodos();
}

/* ---------- Selecci\u00f3n m\u00faltiple para eliminar ---------- */
function pintarSeleccion() {
  var nSel = Object.keys(ESTADO.sel).length, barra = $('barraSel');
  if (!barra) return;
  barra.hidden = !nSel;
  $('cuentaSel').textContent = nSel + ' registro' + (nSel === 1 ? '' : 's') + ' seleccionado' + (nSel === 1 ? '' : 's');
  $('btnEliminarSel').textContent = 'Eliminar seleccionados (' + nSel + ')';
}
function marcarFila(id, si) {
  if (si) ESTADO.sel[id] = 1; else delete ESTADO.sel[id];
  var cb = [].find.call(document.querySelectorAll('#tablaRegistros .sel-reg'), function (x) { return x.dataset.id === id; });
  if (cb) { cb.checked = si; cb.closest('tr').classList.toggle('sel', si); }
}
function actualizarSelTodos() {
  var v = ESTADO.visibles || [], st = $('selTodos'), nSel = Object.keys(ESTADO.sel).length;
  if (st) { st.checked = v.length > 0 && v.every(function (id) { return ESTADO.sel[id]; }); st.indeterminate = !st.checked && nSel > 0; }
  pintarSeleccion();
}
function clicSeleccion(e) {
  var cb = e.target;
  if (!cb || cb.type !== 'checkbox') return;
  if (cb.id === 'selTodos') {
    (ESTADO.visibles || []).forEach(function (id) { marcarFila(id, cb.checked); });
    ESTADO.ultimoSel = null;
  } else if (cb.classList.contains('sel-reg')) {
    var id = cb.dataset.id, v = ESTADO.visibles || [];
    // Con Shift se marca o desmarca todo el tramo desde la \u00faltima casilla tocada
    if (e.shiftKey && ESTADO.ultimoSel && v.indexOf(ESTADO.ultimoSel) >= 0) {
      var a = v.indexOf(ESTADO.ultimoSel), b = v.indexOf(id);
      v.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(function (x) { marcarFila(x, cb.checked); });
    } else marcarFila(id, cb.checked);
    ESTADO.ultimoSel = id;
  } else return;
  actualizarSelTodos();
}
async function eliminarSeleccionados() {
  var regs = ESTADO.registros.filter(function (x) { return ESTADO.sel[x.ID]; });
  if (!regs.length) return;
  var ids = regs.map(function (r) { return r.ID; });
  var muestra = regs.slice(0, 5).map(function (r) { return '- ' + (r.FECHA_INICIO ? fechaCorta(r.FECHA_INICIO) + ' ' : '') + r.ESTABLECIMIENTO + ' (' + (r.ZONA || 'sin zona') + ', vuelta ' + (r.VUELTA || '-') + ')'; }).join('\n');
  if (regs.length > 5) muestra += '\n... y ' + (regs.length - 5) + ' m\u00e1s';
  if (!confirm('\u00bfEliminar ' + regs.length + ' registro' + (regs.length === 1 ? '' : 's') + '?\n\n' + muestra + '\n\nNo se puede deshacer.')) return;
  cargando(true);
  try {
    var t0 = Date.now();
    regs.forEach(function (r, i) { var e = { op: 'eliminar', id: r.ID, t: t0 + i }; encolar(e); aplicarLocal(e); });
    ESTADO.sel = {}; ESTADO.ultimoSel = null;
    guardarCache(); refrescarTodo();
    await sincronizar(true);
    var quedan = leerCola().filter(function (x) { return x.op === 'eliminar' && ids.indexOf(x.id) >= 0; }).length;
    avisar(quedan ? regs.length + ' registros eliminados en el equipo; ' + quedan + ' se borrar\u00e1n del servidor cuando haya internet.'
      : regs.length + ' registro' + (regs.length === 1 ? '' : 's') + ' eliminado' + (regs.length === 1 ? '' : 's') + '.');
  } catch (e2) { avisar(e2.message, true); }
  cargando(false);
}

async function eliminarRegistro(id) {
  var r = ESTADO.registros.find(function (x) { return x.ID === id; });
  if (!r || !confirm((noRealizada(r) ? '\u00bfQuitar el motivo de vuelta no realizada? ' : '') + '\u00bfEliminar el registro de ' + r.ESTABLECIMIENTO + ' (' + (r.ZONA || 'sin zona') + ', vuelta ' + (r.VUELTA || '-') + ')? No se puede deshacer.')) return;
  cargando(true);
  try {
    var e = { op: 'eliminar', id: id, t: Date.now() };
    encolar(e); aplicarLocal(e); guardarCache(); refrescarTodo();
    await sincronizar(true);
    avisar(esTmp(id) || !leerCola().some(function (x) { return x.op === 'eliminar' && x.id === id; }) ? 'Registro eliminado.' : 'Registro eliminado en el equipo; se borrar\u00e1 del servidor cuando haya internet.');
  } catch (e2) { avisar(e2.message, true); }
  cargando(false);
}

function refrescarTodo() { llenarFiltros(); llenarListas(); dibujarPanel(); dibujarRegistros(); }

/* ---------- Importar Excel ---------- */
function leerFecha(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.getFullYear() + '-' + ('0' + (v.getMonth() + 1)).slice(-2) + '-' + ('0' + v.getDate()).slice(-2);
  if (typeof v === 'number') { var d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  var s = String(v).trim(), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

/* Excel con la hoja REGISTROS del sistema (columnas ESTABLECIMIENTO, VIV_PRO...) */
function leerFormatoSistema(wb) {
  var hoja = wb.Sheets['REGISTROS'] || wb.Sheets[wb.SheetNames[0]];
  var filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
  if (!filas.length || !('ESTABLECIMIENTO' in filas[0]) || !('VIV_PRO' in filas[0])) return null;
  return filas.map(function (r) {
    var o = { ID: r.ID ? String(r.ID) : '', CREADO: r.CREADO || '' };
    CAMPOS.forEach(function (c) { o[c] = r[c] === undefined ? '' : r[c]; });
    o.FECHA_INICIO = leerFecha(r.FECHA_INICIO); o.FECHA_TERMINO = leerFecha(r.FECHA_TERMINO);
    return o;
  });
}

/* Excel original del consolidado (Formato_Nebulizaci\u00f3n_2026): t\u00edtulo, encabezados agrupados y
   una fila de c\u00f3digos (Provincia, Distrito, UNGETS, Localidad, zonas, Vuelta, viv_pro, viv_neb...). */
function leerFormatoOriginal(wb) {
  function norm(v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\u00b0\u00ba]/g, '').replace(/\s+/g, '_'); }
  var MAPA = { provincia: 'PROVINCIA', distrito: 'DISTRITO', ungets: 'UNGETS', localidad: 'ESTABLECIMIENTO', zonas: 'ZONA', zona: 'ZONA', vuelta: 'VUELTA',
    viv_pro: 'VIV_PRO', viv_neb: 'VIV_NEB', viv_cer: 'VIV_CER', viv_ren: 'VIV_REN', viv_desh: 'VIV_DESH', mz_pro: 'MZ_PRO', mz_neb: 'MZ_NEB',
    n_eq_por_frio: 'EQ_PORT_FRIO', n_eq_por_cali: 'EQ_PORT_CALIENTE', n_eq_pesado_frio: 'EQ_PESADO_FRIO', n_eq_pesado_cali: 'EQ_PESADO_CALIENTE',
    insec_ml: 'INSECTICIDA_ML', insec_litros: 'INSECTICIDA_L', petr_galones: 'PETROLEO_GAL', gasolina_galones: 'GASOLINA_GAL',
    inicio: 'FECHA_INICIO', termino: 'FECHA_TERMINO', observaciones: 'OBSERVACIONES' };
  var nombres = wb.SheetNames.slice().sort(function (a, b) { return (/base/i.test(b) ? 1 : 0) - (/base/i.test(a) ? 1 : 0); });
  for (var h = 0; h < nombres.length; h++) {
    var filas = XLSX.utils.sheet_to_json(wb.Sheets[nombres[h]], { header: 1, defval: '', raw: true });
    var fc = -1;
    for (var i = 0; i < Math.min(filas.length, 30); i++) if (filas[i].map(norm).indexOf('viv_pro') >= 0) { fc = i; break; }
    if (fc < 0) continue;
    var col = {};
    filas[fc].forEach(function (v, j) { var c = MAPA[norm(v)]; if (c && !(c in col)) col[c] = j; });
    if (!('ESTABLECIMIENTO' in col)) continue;
    // En el formato la columna del insecticida en ml no tiene c\u00f3digo: es la que est\u00e1 justo antes de insec_litros
    if (!('INSECTICIDA_ML' in col) && 'INSECTICIDA_L' in col && !norm(filas[fc][col.INSECTICIDA_L - 1])) col.INSECTICIDA_ML = col.INSECTICIDA_L - 1;
    var regs = filas.slice(fc + 1).map(function (f) {
      var o = { ID: '', CREADO: '' };
      CAMPOS.forEach(function (c) {
        var v = c in col ? f[col[c]] : '';
        if (NUMERICOS.indexOf(c) >= 0) o[c] = v === '' || v === null || isNaN(Number(v)) ? '' : Number(v);
        else o[c] = String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ');
      });
      ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA'].forEach(function (c) { o[c] = o[c].toUpperCase(); });
      o.FECHA_INICIO = leerFecha(f[col.FECHA_INICIO]); o.FECHA_TERMINO = leerFecha(f[col.FECHA_TERMINO]) || o.FECHA_INICIO;
      if (o.INSECTICIDA_ML === '' && o.INSECTICIDA_L !== '') o.INSECTICIDA_ML = +(o.INSECTICIDA_L * 1000).toFixed(2);
      return o;
    }).filter(function (o) { return o.ESTABLECIMIENTO && o.VIV_PRO !== ''; });
    return { hoja: nombres[h], regs: regs };
  }
  return null;
}
function claveImport(r) { return [r.DISTRITO, r.ESTABLECIMIENTO, r.ZONA, r.VUELTA, r.FECHA_INICIO].map(normTxt).join('|') + '|' + n(r.VIV_PRO); }

async function importarExcel(ev) {
  var f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (typeof XLSX === 'undefined') { avisar('No se pudo cargar la librer\u00eda de Excel. Revisa tu conexi\u00f3n.', true); return; }
  if (!navigator.onLine) { avisar('Para importar el Excel necesitas internet.', true); return; }
  cargando(true);
  try {
    var wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    var regs = leerFormatoSistema(wb), origen = 'REGISTROS';
    if (!regs) { var fo = leerFormatoOriginal(wb); if (fo) { regs = fo.regs; origen = fo.hoja; } }
    if (!regs) throw new Error('No se reconoci\u00f3 el archivo. Debe ser el Excel del consolidado (hoja con la fila de c\u00f3digos viv_pro, viv_neb...) o uno con la hoja REGISTROS del sistema.');
    regs = regs.filter(function (r) { return r.ESTABLECIMIENTO; });
    // Evita duplicar filas que ya est\u00e1n en el sistema (mismo lugar, vuelta, fecha y programadas)
    var hay = {}, nuevos = [], repetidos = 0;
    ESTADO.registros.forEach(function (r) { hay[claveImport(r)] = 1; });
    regs.forEach(function (r) { var k = claveImport(r); if (!r.ID && hay[k]) { repetidos++; return; } hay[k] = 1; nuevos.push(r); });
    if (!nuevos.length) { cargando(false); avisar('Las ' + regs.length + ' filas de la hoja "' + origen + '" ya est\u00e1n en el sistema; no hay nada nuevo que importar.'); return; }
    cargando(false);
    if (!confirm('Hoja "' + origen + '": ' + regs.length + ' filas encontradas' + (repetidos ? ', ' + repetidos + ' ya est\u00e1n en el sistema' : '') + '.\n\n\u00bfImportar ' + nuevos.length + ' registro' + (nuevos.length === 1 ? '' : 's') + '?')) return;
    cargando(true);
    regs = nuevos;
    var imp = 0, omi = repetidos;
    for (var i = 0; i < regs.length; i += 150) {
      var j = await api('importar', { registros: regs.slice(i, i + 150) });
      imp += j.importados; omi += j.omitidos;
    }
    await recargar();
    avisar(imp + ' registros importados' + (omi ? ', ' + omi + ' ya exist\u00edan y se omitieron' : '') + '.');
  } catch (e) { avisar(e.message, true); }
  cargando(false);
}

/* ---------- Formulario ---------- */
function llenarListas() {
  function lista(id, valores) { $(id).innerHTML = valores.map(function (v) { return '<option value="' + esc(v) + '">'; }).join(''); }
  lista('lProvincia', unicos('PROVINCIA')); lista('lDistrito', unicos('DISTRITO')); lista('lUngets', unicos('UNGETS'));
  var dis = $('DISTRITO').value.trim().toUpperCase();
  var base = dis ? ESTADO.registros.filter(function (r) { return r.DISTRITO === dis; }) : null;
  lista('lEess', unicos('ESTABLECIMIENTO', base && base.length ? base : null));
}

function abrirFormulario(id) {
  var r = id ? ESTADO.registros.find(function (x) { return x.ID === id; }) : null;
  ESTADO.editandoId = r ? r.ID : null;
  ESTADO.gastoManual = !!r; ESTADO.proManual = !!r; ESTADO.mzManual = !!r;
  $('formReg').reset(); $('formError').textContent = '';
  document.querySelectorAll('#formReg .invalido').forEach(function (e) { e.classList.remove('invalido'); });
  if (r) {
    CAMPOS.forEach(function (c) { $(c).value = r[c] === null || r[c] === undefined ? '' : r[c]; });
    $('cajaTermino').hidden = !(r.FECHA_TERMINO && r.FECHA_TERMINO !== r.FECHA_INICIO);
    $('tituloForm').textContent = 'Editar registro de nebulizaci\u00f3n';
    $('idEdicion').textContent = 'ID ' + r.ID + (r.MODIFICADO ? ', modificado ' + r.MODIFICADO : '');
    $('btnGuardar').textContent = 'Guardar cambios';
  } else {
    $('cajaTermino').hidden = true;
    $('PROVINCIA').value = ESTADO.cfg.PROVINCIA_DEFECTO || '';
    $('UNGETS').value = ESTADO.cfg.UNGETS_DEFECTO || '';
    ['VIV_NEB', 'VIV_CER', 'VIV_REN', 'VIV_DESH', 'EQ_PORT_FRIO', 'EQ_PORT_CALIENTE', 'EQ_PESADO_FRIO', 'EQ_PESADO_CALIENTE'].forEach(function (c) { $(c).value = 0; });
    $('tituloForm').textContent = 'Nuevo registro de nebulizaci\u00f3n';
    $('idEdicion').textContent = '';
    $('btnGuardar').textContent = 'Guardar registro';
  }
  llenarListas(); actualizarCalculos(); revisarVuelta();
  mostrarVista('formulario');
  $('DISTRITO').focus();
}

function leerFormulario() {
  var o = { ID: ESTADO.editandoId || '' };
  CAMPOS.forEach(function (c) {
    var v = $(c).value;
    o[c] = NUMERICOS.indexOf(c) >= 0 ? (v === '' ? '' : Number(v)) : v.trim();
  });
  if ($('cajaTermino').hidden) o.FECHA_TERMINO = o.FECHA_INICIO;
  ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA'].forEach(function (c) { o[c] = o[c].toUpperCase(); });
  return o;
}

function recalcularGasto() {
  var pro = n($('VIV_PRO').value), cfg = ESTADO.cfg;
  var ml = pro * n(cfg.ML_INSECTICIDA_POR_VIV);
  $('INSECTICIDA_ML').value = pro ? ml.toFixed(2) : '';
  $('INSECTICIDA_L').value = pro ? (ml / 1000).toFixed(2) : '';
  $('PETROLEO_GAL').value = pro ? (pro * n(cfg.GAL_PETROLEO_POR_VIV)).toFixed(5) : '';
  $('GASOLINA_GAL').value = pro ? (pro * n(cfg.GAL_GASOLINA_POR_VIV)).toFixed(6) : '';
}

function actualizarCalculos() {
  var o = leerFormulario(), c = calc(o);
  var mal = c.vis > c.pro && c.pro > 0;
  $('calcViv').innerHTML =
    '<span>Visitadas: <b>' + fmt(c.vis) + '</b></span>' +
    '<span' + (mal ? ' class="mal"' : '') + '>No visitadas: <b>' + fmt(c.novis) + '</b></span>' +
    '<span>Nebulizadas: <b>' + fmtPct(c.pNeb) + '</b></span>' +
    '<span>Cerradas: <b>' + fmtPct(c.pCer) + '</b></span>' +
    '<span>Renuentes: <b>' + fmtPct(c.pRen) + '</b></span>' +
    (mal ? '<span class="mal">La suma de viviendas supera las programadas</span>' : '');
}

function validarFormulario(o) {
  var errores = [], marcar = [];
  ['DISTRITO', 'ESTABLECIMIENTO', 'VUELTA', 'FECHA_INICIO', 'FECHA_TERMINO'].forEach(function (c) { if (!o[c]) marcar.push(c); });
  if (marcar.length) errores.push('Completa los campos marcados.');
  if (!(o.VIV_PRO > 0)) { marcar.push('VIV_PRO'); errores.push('Las viviendas programadas deben ser mayores que 0.'); }
  var c = calc(o);
  if (o.FECHA_INICIO && o.FECHA_TERMINO && o.FECHA_TERMINO < o.FECHA_INICIO) { marcar.push('FECHA_TERMINO'); errores.push('La fecha de t\u00e9rmino es anterior a la de inicio.'); }
  document.querySelectorAll('#formReg .invalido').forEach(function (e) { e.classList.remove('invalido'); });
  marcar.forEach(function (c) { $(c).classList.add('invalido'); });
  return errores;
}

async function guardarFormulario(ev) {
  ev.preventDefault();
  var o = leerFormulario();
  var err = validarFormulario(o);
  $('formError').textContent = err.join(' ');
  if (err.length) return;
  var cc = calc(o);
  if (cc.vis > cc.pro && !confirm('Nebulizadas + cerradas + renuentes + deshabitadas (' + cc.vis + ') superan las programadas (' + cc.pro + '). \u00bfGuardar de todos modos?')) return;
  var dup = mismoDia(o);
  if (dup && !confirm('Ya hay un registro de ' + o.ESTABLECIMIENTO + ', zona ' + (o.ZONA || '-') + ', vuelta ' + o.VUELTA + ' el ' + fechaCorta(o.FECHA_INICIO) + '. \u00bfGuardar de todos modos?')) return;
  cargando(true);
  try {
    var editando = !!o.ID;
    var ok = await guardarRegistro(o);
    avisar((editando ? 'Cambios guardados' : 'Registro guardado') + (ok ? '.' : ' en el equipo. Se enviar\u00e1 al servidor cuando haya internet.'));
    if (editando) mostrarVista('registros'); else abrirFormulario(null);
  } catch (e) { $('formError').textContent = e.message; }
  cargando(false);
}

/* ---------- Navegaci\u00f3n ---------- */
function mostrarVista(v) {
  ['panel', 'registros', 'formulario'].forEach(function (x) { $('vista-' + x).hidden = x !== v; });
  document.querySelectorAll('.pestana').forEach(function (b) { b.classList.toggle('activa', b.dataset.vista === v); });
  $('tabForm').textContent = ESTADO.editandoId && v === 'formulario' ? 'Editando registro' : 'Nuevo registro';
  if (v === 'panel') Object.keys(ESTADO.charts).forEach(function (k) { ESTADO.charts[k].resize(); });
  window.scrollTo(0, 0);
}

document.addEventListener('DOMContentLoaded', function () {
  $('formLogin').addEventListener('submit', ingresar);
  $('btnSalir').addEventListener('click', function () {
    if (leerCola().length && !confirm('Hay ' + leerCola().length + ' registro(s) que a\u00fan no se env\u00edan. Quedar\u00e1n guardados en este equipo y se enviar\u00e1n cuando vuelvas a ingresar con internet. \u00bfSalir?')) return;
    cerrarSesion(); window.location.href = 'index.html';
  });
  document.querySelectorAll('.pestana').forEach(function (b) {
    b.addEventListener('click', function () { if (b.dataset.vista === 'formulario') abrirFormulario(null); else mostrarVista(b.dataset.vista); });
  });
  ['fDesde', 'fHasta', 'fMes', 'fEess', 'fVuelta'].forEach(function (id) { $(id).addEventListener('change', dibujarPanel); });
  $('fDistrito').addEventListener('change', function () { $('fEess').value = ''; llenarFiltros(); dibujarPanel(); });
  $('btnLimpiar').addEventListener('click', function () { ['fDesde', 'fHasta', 'fMes', 'fDistrito', 'fEess', 'fVuelta'].forEach(function (id) { $(id).value = ''; }); llenarFiltros(); dibujarPanel(); });
  $('btnExportar').addEventListener('click', exportar);
  $('buscar').addEventListener('input', dibujarRegistros);
  $('soloRevisar').addEventListener('change', dibujarRegistros);
  $('btnNuevo2').addEventListener('click', function () { abrirFormulario(null); });
  $('archivoImport').addEventListener('change', importarExcel);
  $('tablaRegistros').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editar) abrirFormulario(b.dataset.editar);
    if (b.dataset.eliminar) eliminarRegistro(b.dataset.eliminar);
  });
  $('tablaRegistros').addEventListener('click', clicSeleccion);
  $('btnEliminarSel').addEventListener('click', eliminarSeleccionados);
  $('btnQuitarSel').addEventListener('click', function () { Object.keys(ESTADO.sel).forEach(function (id) { marcarFila(id, false); }); ESTADO.ultimoSel = null; actualizarSelTodos(); });
  $('formReg').addEventListener('submit', guardarFormulario);
  $('formReg').addEventListener('input', function (e) {
    if (e.target.classList.contains('gasto')) ESTADO.gastoManual = true;
    if (e.target.id === 'VIV_PRO' && !ESTADO.gastoManual) recalcularGasto();
    if (e.target.id === 'DISTRITO') llenarListas();
    if (e.target.id === 'VIV_PRO') ESTADO.proManual = true;
    if (e.target.id === 'MZ_PRO') ESTADO.mzManual = true;
    actualizarCalculos();
    if (['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA', 'FECHA_INICIO'].indexOf(e.target.id) >= 0) revisarVuelta();
  });
  $('formReg').addEventListener('change', function (e) { if (['ESTABLECIMIENTO', 'ZONA', 'VUELTA', 'FECHA_INICIO'].indexOf(e.target.id) >= 0) revisarVuelta(); });
  $('btnRecalcGasto').addEventListener('click', function () { ESTADO.gastoManual = false; recalcularGasto(); });
  $('btnCancelar').addEventListener('click', function () { ESTADO.editandoId = null; mostrarVista('registros'); });

  prepararSinInternet();
  window.addEventListener('online', function () { pintarSync(); sincronizar().then(function () { if (!leerCola().length && ESTADO.sinInternet) recargar().catch(function () {}); }); });
  window.addEventListener('offline', pintarSync);
  setInterval(function () { if (navigator.onLine && leerCola().length) sincronizar(true); }, 60000);

  var t = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem('neb_token');
  if (t && CONFIG.API_URL.indexOf('http') === 0) {
    ESTADO.token = t; cargando(true);
    iniciarApp().catch(function () { cerrarSesion(); }).finally(function () { cargando(false); });
  }
});
