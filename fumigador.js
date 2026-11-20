/* =========================================================
   Nebulización espacial 2026 - Planilla del fumigador (fumigador.js)
   Cada fumigador registra casa por casa, igual que el formato físico.
   Todo se guarda primero en el celular y se envía cuando hay internet.
   ========================================================= */
var COND = {
  NEB_FRIO: { txt: 'En frío', clase: 'c-neb' },
  NEB_CALIENTE: { txt: 'Caliente', clase: 'c-neb' },
  CERRADA: { txt: 'Cerrada', clase: 'c-cer' },
  RENUENTE: { txt: 'Renuente', clase: 'c-ren' },
  DESHABITADA: { txt: 'Deshabitada', clase: 'c-desh' }
};
var ESTADOS_TXT = { BORRADOR: 'En proceso', ENVIADA: 'Enviada al jefe', APROBADA: 'Aprobada', DEVUELTA: 'Devuelta para corregir' };

var F = { token: null, fum: null, tareas: [], planillas: {}, actual: null, editIdx: null, necesitaLogin: false, sinRed: false };

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function fechaCorta(f) { return f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''; }
function hora() { var d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function hoyISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

/* ---------- avisos ---------- */
var tAviso;
function avisar(msg, error) {
  var a = $('aviso'); a.textContent = msg; a.className = 'aviso' + (error ? ' error' : ''); a.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(function () { a.hidden = true; }, error ? 6000 : 2500);
}
function cargando(si) { $('cargando').hidden = !si; }

/* ---------- servidor ---------- */
function errRed(e) { return !!e && !e.code && (e.name === 'TypeError' || e.name === 'AbortError' || /fetch|network|load failed/i.test(e.message || '')); }
async function api(accion, datos) {
  var cuerpo = Object.assign({ accion: accion, token: F.token }, datos || {});
  var ctrl = new AbortController(), tm = setTimeout(function () { ctrl.abort(); }, 30000);
  var j;
  try {
    var r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(cuerpo), signal: ctrl.signal });
    j = await r.json();
  } finally { clearTimeout(tm); }
  if (!j.ok && j.error === 'SESION') { var e = new Error('Tu sesión venció. Ingresa de nuevo.'); e.code = 'SESION'; throw e; }
  if (!j.ok) { var e2 = new Error(j.error || 'Error'); e2.datos = j; throw e2; }
  return j;
}

/* ---------- guardado en el celular ---------- */
var K_SES = 'fum_sesion';
function kDatos() { return 'fum_datos_' + (F.fum ? F.fum.ID : 'x'); }
function guardarLocal() {
  try { localStorage.setItem(kDatos(), JSON.stringify({ tareas: F.tareas, planillas: F.planillas, fecha: new Date().toISOString() })); } catch (e) { avisar('El celular no tiene espacio para guardar.', true); }
}
function leerLocal() { try { return JSON.parse(localStorage.getItem(kDatos())) || null; } catch (e) { return null; } }
async function hashTxt(t) {
  try { var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fum|' + t)); return Array.from(new Uint8Array(b)).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
  catch (e) { return ''; }
}
function pendientes() { return Object.keys(F.planillas).map(function (k) { return F.planillas[k]; }).filter(function (p) { return p._sucio; }); }

/* ---------- sesión ---------- */
async function ingresar(ev) {
  ev.preventDefault();
  $('loginError').textContent = '';
  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('http') !== 0) { $('loginError').textContent = 'Falta configurar la URL del sistema (config.js).'; return; }
  var usuario = $('usuario').value.trim().toUpperCase().replace(/\s/g, ''), pin = $('pin').value.trim();
  cargando(true);
  try {
    var j = await api('fumLogin', { usuario: usuario, pin: pin });
    F.token = j.token; F.fum = j.fumigador;
    localStorage.setItem(K_SES, JSON.stringify({ token: j.token, fum: j.fumigador, usuario: usuario, h: await hashTxt(usuario + '|' + pin) }));
    F.necesitaLogin = false;
    await iniciar();
  } catch (e) {
    var s = leerSesion();
    if (errRed(e) && s && s.usuario === usuario && s.h && s.h === await hashTxt(usuario + '|' + pin)) {
      F.token = s.token; F.fum = s.fum; await iniciar();
      avisar('Sin internet: trabajas en tu celular. Se enviará todo cuando vuelva la señal.');
    } else {
      $('loginError').textContent = errRed(e) ? (s ? 'Sin internet. Escribe el mismo usuario y PIN de la última vez para entrar sin señal.' : 'Sin internet. La primera vez debes ingresar con señal.') : e.message;
    }
  }
  cargando(false);
}
function leerSesion() { try { return JSON.parse(localStorage.getItem(K_SES)); } catch (e) { return null; } }

function salir() {
  var p = pendientes().length;
  if (p && !confirm('Tienes ' + p + ' planilla(s) sin enviar. Quedarán guardadas en este celular y se enviarán cuando vuelvas a ingresar. ¿Salir?')) return;
  if (F.token && navigator.onLine) fetch(CONFIG.API_URL, { method: 'POST', keepalive: true, body: JSON.stringify({ accion: 'fumSalir', token: F.token }) }).catch(function () {});
  var s = leerSesion(); if (s) { delete s.token; localStorage.setItem(K_SES, JSON.stringify(s)); }
  F.token = null;
  $('app').hidden = true; $('vLogin').hidden = false; $('pin').value = '';
}

async function iniciar() {
  var loc = leerLocal();
  if (loc) { F.tareas = loc.tareas || []; F.planillas = loc.planillas || {}; }
  $('vLogin').hidden = true; $('app').hidden = false;
  $('nombreFum').textContent = F.fum.NOMBRE;
  mostrarTareas();
  await refrescar(true);
}

/* Trae del servidor las tareas y planillas (sin pisar lo que aún no se envió) */
async function refrescar(silencioso) {
  await sincronizar(true);
  if (!navigator.onLine) { F.sinRed = true; pintarSync(); return; }
  try {
    var j = await api('fumDatos');
    F.sinRed = false;
    F.tareas = j.tareas || [];
    var nuevas = {};
    (j.planillas || []).forEach(function (p) { nuevas[p.ID] = p; });
    Object.keys(F.planillas).forEach(function (id) { var p = F.planillas[id]; if (p._sucio) nuevas[id] = p; });
    F.planillas = nuevas;
    guardarLocal();
    if (!silencioso) avisar('Tareas actualizadas.');
  } catch (e) {
    if (e.code === 'SESION') F.necesitaLogin = true;
    else if (errRed(e)) F.sinRed = true;
    else if (!silencioso) avisar(e.message, true);
  }
  pintarSync();
  if (F.actual) abrirTarea(F.actual, true); else mostrarTareas();
}

/* Envía al servidor las planillas guardadas en el celular */
var sincronizando = false, tSync;
function limpiaPlanilla(p) {
  var c = JSON.parse(JSON.stringify(p));
  ['_sucio', '_enviar', '_err', '_estadoPrevio'].forEach(function (k) { delete c[k]; });
  return c;
}
function programarSync() { clearTimeout(tSync); tSync = setTimeout(function () { sincronizar(true); }, 2500); }
async function sincronizar(silencioso) {
  var lista = pendientes();
  if (sincronizando || !lista.length || !navigator.onLine || F.necesitaLogin || !F.token) { pintarSync(); return; }
  sincronizando = true; pintarSync();
  var enviados = 0;
  try {
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i], enviar = !!p._enviar, copia = limpiaPlanilla(p), foto = JSON.stringify(copia);
      try {
        var j = await api('fumGuardar', { planilla: copia, enviar: enviar });
        // Si mientras se enviaba se siguió editando, se conserva lo local
        var actual = F.planillas[p.ID];
        if (JSON.stringify(limpiaPlanilla(actual)) === foto && !!actual._enviar === enviar) F.planillas[p.ID] = j.planilla;
        enviados++;
        if (enviar) avisar('✔ Planilla enviada al jefe de brigada.');
      } catch (e) {
        if (errRed(e)) { F.sinRed = true; break; }
        if (e.code === 'SESION') { F.necesitaLogin = true; break; }
        if (e.datos && e.datos.planilla) { F.planillas[p.ID] = e.datos.planilla; avisar(e.message, true); continue; }
        var x = F.planillas[p.ID];
        x._err = e.message;
        if (x._enviar) { x._enviar = false; x.ESTADO = x._estadoPrevio || 'BORRADOR'; }
        avisar('No se pudo guardar la planilla: ' + e.message, true);
      }
    }
  } finally { sincronizando = false; }
  guardarLocal(); pintarSync();
  if (enviados) { if (F.actual) abrirTarea(F.actual, true); else mostrarTareas(); }
}

function pintarSync() {
  var el = $('estadoSync'), n = pendientes().length;
  if (!navigator.onLine) el.innerHTML = '📴 Sin señal' + (n ? ' · ' + n + ' por enviar' : '');
  else if (sincronizando) el.innerHTML = '🔄 Enviando…';
  else if (F.necesitaLogin) el.innerHTML = '<button type="button" id="btnRelogin">🔑 Ingresar de nuevo</button>';
  else if (n) el.innerHTML = '<button type="button" id="btnSyncAhora">⏳ ' + n + ' por enviar</button>';
  else el.innerHTML = '✅ Al día';
  var b = $('btnRelogin'); if (b) b.onclick = function () { salir(); $('loginError').textContent = 'Tu sesión venció. Ingresa de nuevo para enviar lo pendiente.'; };
  var b2 = $('btnSyncAhora'); if (b2) b2.onclick = function () { sincronizar(); };
}

/* ---------- lista de tareas ---------- */
function planillaDe(tareaId) {
  var ids = Object.keys(F.planillas);
  for (var i = 0; i < ids.length; i++) if (F.planillas[ids[i]].TAREA_ID === tareaId) return F.planillas[ids[i]];
  return null;
}

function mostrarTareas() {
  F.actual = null; F.editIdx = null;
  $('vTareas').hidden = false; $('vPlanilla').hidden = true; $('totales').hidden = true;
  $('btnAtras').hidden = true; $('tituloBarra').textContent = 'Mis tareas';
  var lista = F.tareas.slice().sort(function (a, b) { return (b.FECHA || '').localeCompare(a.FECHA || ''); });
  if (!lista.length) {
    $('listaTareas').innerHTML = '<div class="vacio">No tienes tareas asignadas por ahora.<br>Pide a tu jefe de brigada que te asigne una zona.</div>';
    return;
  }
  $('listaTareas').innerHTML = lista.map(function (t) {
    var p = planillaDe(t.ID), est = p ? p.ESTADO : (t.ESTADO === 'APROBADA' ? 'CERRADA' : 'NUEVA');
    var chip = p ? '<span class="chip e-' + est + '">' + (ESTADOS_TXT[est] || est) + '</span>' : (t.ESTADO === 'APROBADA' ? '<span class="chip e-APROBADA">Cerrada</span>' : '<span class="chip e-NUEVA">Sin empezar</span>');
    var n = p ? (p.VIVIENDAS || []).length : 0;
    var hoy = t.FECHA === hoyISO() ? '<span class="chip hoy">HOY</span>' : '';
    return '<button class="tarea" data-tarea="' + esc(t.ID) + '">' +
      '<div class="tarea-fila"><b>' + fechaCorta(t.FECHA) + '</b>' + hoy + chip + (p && p._sucio ? '<span class="chip e-SYNC">Por enviar</span>' : '') + '</div>' +
      '<div class="tarea-zona">' + esc(t.ZONA) + '</div>' +
      '<div class="tarea-det">Vuelta ' + esc(t.VUELTA) + ' · ' + esc(t.ESTABLECIMIENTO) + ' · ' + esc(t.DISTRITO) + '</div>' +
      '<div class="tarea-det">' + (n ? '<b>' + n + '</b> vivienda' + (n === 1 ? '' : 's') + ' registrada' + (n === 1 ? '' : 's') : 'Ninguna vivienda registrada') + '</div>' +
      '</button>';
  }).join('');
}

/* ---------- planilla ---------- */
function tareaActual() { return F.tareas.filter(function (t) { return t.ID === F.actual; })[0]; }
function editable(t, p) {
  if (p) return p.ESTADO === 'BORRADOR' || p.ESTADO === 'DEVUELTA' || !p.ESTADO;
  return t && t.ESTADO !== 'APROBADA';
}
function asegurarPlanilla() {
  var p = planillaDe(F.actual);
  if (p) return p;
  var ult = {}; try { ult = JSON.parse(localStorage.getItem('fum_ultimo_equipo')) || {}; } catch (e) {}
  p = { ID: 'P' + Date.now() + Math.floor(Math.random() * 900 + 100), TAREA_ID: F.actual, ESTADO: 'BORRADOR', VIVIENDAS: [],
    FUMIGADOR: F.fum.NOMBRE, FUMIGADOR_2: ult.FUMIGADOR_2 || '', INSECTICIDA: ult.INSECTICIDA || '', TIPO_INSECTICIDA: ult.TIPO_INSECTICIDA || '', CONCENTRACION: ult.CONCENTRACION || '' };
  F.planillas[p.ID] = p;
  return p;
}
function marcarCambio(p) { p._sucio = true; delete p._err; guardarLocal(); pintarSync(); programarSync(); }

function abrirTarea(id, refresco) {
  var t = F.tareas.filter(function (x) { return x.ID === id; })[0];
  if (!t) { mostrarTareas(); return; }
  if (!refresco || F.actual !== id) F.editIdx = null;
  F.actual = id;
  var p = planillaDe(id), ed = editable(t, p);
  $('vTareas').hidden = true; $('vPlanilla').hidden = false; $('totales').hidden = false;
  $('btnAtras').hidden = false; $('tituloBarra').textContent = 'Vuelta ' + t.VUELTA + ' · ' + fechaCorta(t.FECHA).slice(0, 5);

  $('cabTarea').innerHTML =
    '<div class="cab-zona">' + esc(t.ZONA) + '</div>' +
    '<dl>' +
    '<div><dt>Fecha</dt><dd>' + fechaCorta(t.FECHA) + '</dd></div>' +
    '<div><dt>Vuelta</dt><dd>' + esc(t.VUELTA) + '</dd></div>' +
    '<div><dt>Distrito</dt><dd>' + esc(t.DISTRITO) + '</dd></div>' +
    '<div><dt>Establecimiento</dt><dd>' + esc(t.ESTABLECIMIENTO) + '</dd></div>' +
    (t.MICRORED ? '<div><dt>Microred</dt><dd>' + esc(t.MICRORED) + '</dd></div>' : '') +
    (t.JEFE_BRIGADA ? '<div><dt>J. de brigada</dt><dd>' + esc(t.JEFE_BRIGADA) + '</dd></div>' : '') +
    '</dl>' + (t.OBSERVACIONES ? '<p class="cab-obs">📝 ' + esc(t.OBSERVACIONES) + '</p>' : '');

  $('avisoDevuelta').hidden = !(p && p.ESTADO === 'DEVUELTA');
  if (p && p.ESTADO === 'DEVUELTA') $('avisoDevuelta').innerHTML = '↩ Tu jefe te devolvió esta planilla para corregir' + (p.NOTA_JEFE ? ': <b>' + esc(p.NOTA_JEFE) + '</b>' : '.') + ' Corrige y vuelve a enviarla.';
  $('avisoCerrada').hidden = ed;
  if (!ed) $('avisoCerrada').innerHTML = p && p.ESTADO === 'APROBADA' ? '✅ Planilla aprobada por el jefe. Ya está en el consolidado.' :
    p && p.ESTADO === 'ENVIADA' ? (p._sucio ? '⏳ Lista para enviar: se mandará al jefe en cuanto haya señal.' : '📨 Enviada al jefe de brigada. Si necesitas corregir algo, pídele que te la devuelva.') :
    '🔒 Esta tarea ya fue cerrada por el jefe.';
  if (p && p._err) { $('avisoCerrada').hidden = false; $('avisoCerrada').innerHTML = '⚠️ ' + esc(p._err); }

  // datos del equipo
  var d = p || asegurarPlanillaVista();
  $('pFum2').value = d.FUMIGADOR_2 || ''; $('pInsecticida').value = d.INSECTICIDA || '';
  $('pTipo').value = d.TIPO_INSECTICIDA || ''; $('pConc').value = d.CONCENTRACION || '';
  ['pFum2', 'pInsecticida', 'pTipo', 'pConc'].forEach(function (k) { $(k).disabled = !ed; });
  $('resumenDatos').textContent = d.INSECTICIDA ? '· ' + d.INSECTICIDA + (d.CONCENTRACION ? ' ' + d.CONCENTRACION : '') : '· sin completar';
  if (!d.INSECTICIDA && ed) $('bloqueDatos').open = true;

  $('bloqueNueva').hidden = !ed;
  $('btnEnviar').hidden = !ed;
  pintarViviendas();
  prepararNueva();
}
// Valores para mostrar cuando aún no existe planilla (sin crearla)
function asegurarPlanillaVista() {
  var ult = {}; try { ult = JSON.parse(localStorage.getItem('fum_ultimo_equipo')) || {}; } catch (e) {}
  return { FUMIGADOR_2: ult.FUMIGADOR_2 || '', INSECTICIDA: ult.INSECTICIDA || '', TIPO_INSECTICIDA: ult.TIPO_INSECTICIDA || '', CONCENTRACION: ult.CONCENTRACION || '' };
}

function guardarDatosEquipo() {
  var t = tareaActual(), p0 = planillaDe(F.actual);
  if (!editable(t, p0)) return;
  var p = asegurarPlanilla();
  p.FUMIGADOR_2 = $('pFum2').value.trim().toUpperCase();
  p.INSECTICIDA = $('pInsecticida').value.trim().toUpperCase();
  p.TIPO_INSECTICIDA = $('pTipo').value.trim().toUpperCase();
  p.CONCENTRACION = $('pConc').value.trim();
  try { localStorage.setItem('fum_ultimo_equipo', JSON.stringify({ FUMIGADOR_2: p.FUMIGADOR_2, INSECTICIDA: p.INSECTICIDA, TIPO_INSECTICIDA: p.TIPO_INSECTICIDA, CONCENTRACION: p.CONCENTRACION })); } catch (e) {}
  $('resumenDatos').textContent = p.INSECTICIDA ? '· ' + p.INSECTICIDA + (p.CONCENTRACION ? ' ' + p.CONCENTRACION : '') : '· sin completar';
  marcarCambio(p);
}

function prepararNueva() {
  var p = planillaDe(F.actual), vv = p ? p.VIVIENDAS || [] : [];
  if (F.editIdx !== null && vv[F.editIdx]) {
    var v = vv[F.editIdx];
    $('tituloNueva').innerHTML = '✏️ Editando vivienda N° ' + (F.editIdx + 1);
    $('vSector').value = v.SECTOR || ''; $('vManzana').value = v.MANZANA || '';
    $('vDireccion').value = v.DIRECCION || ''; $('vResidentes').value = v.RESIDENTES || 0;
    $('btnCancelarEdicion').hidden = false;
    document.querySelectorAll('#condiciones button').forEach(function (b) { b.classList.toggle('marcada', b.dataset.cond === v.CONDICION); });
  } else {
    F.editIdx = null;
    $('tituloNueva').innerHTML = 'Vivienda N° <span id="numNueva">' + (vv.length + 1) + '</span>';
    var ult = vv[vv.length - 1];
    if (ult) { $('vSector').value = ult.SECTOR || ''; $('vManzana').value = ult.MANZANA || ''; }
    $('vDireccion').value = ''; $('vResidentes').value = 0;
    $('btnCancelarEdicion').hidden = true;
    document.querySelectorAll('#condiciones button').forEach(function (b) { b.classList.remove('marcada'); });
  }
}

function registrarVivienda(cond) {
  var dir = $('vDireccion').value.trim();
  if (!dir) { avisar('Escribe la dirección o el nombre del jefe de familia.', true); $('vDireccion').focus(); return; }
  var p = asegurarPlanilla();
  p.VIVIENDAS = p.VIVIENDAS || [];
  var v = {
    SECTOR: $('vSector').value.trim().toUpperCase(), MANZANA: $('vManzana').value.trim().toUpperCase(),
    DIRECCION: dir, RESIDENTES: Math.max(0, Math.min(99, parseInt($('vResidentes').value, 10) || 0)), CONDICION: cond
  };
  var msg;
  if (F.editIdx !== null && p.VIVIENDAS[F.editIdx]) {
    v.HORA = p.VIVIENDAS[F.editIdx].HORA || hora();
    p.VIVIENDAS[F.editIdx] = v; msg = 'Vivienda N° ' + (F.editIdx + 1) + ' corregida.';
    F.editIdx = null;
  } else {
    v.HORA = hora(); p.VIVIENDAS.push(v); msg = 'Vivienda N° ' + p.VIVIENDAS.length + ' · ' + COND[cond].txt;
  }
  if (navigator.vibrate) navigator.vibrate(40);
  marcarCambio(p);
  avisar('✔ ' + msg);
  pintarViviendas(); prepararNueva();
  $('vDireccion').focus();
}

function pintarViviendas() {
  var t = tareaActual(), p = planillaDe(F.actual), vv = p ? p.VIVIENDAS || [] : [], ed = editable(t, p);
  if (!vv.length) $('listaViviendas').innerHTML = '<div class="vacio">Aún no registras viviendas.</div>';
  else {
    var html = '';
    for (var i = vv.length - 1; i >= 0; i--) {
      var v = vv[i], c = COND[v.CONDICION] || { txt: v.CONDICION, clase: '' };
      html += '<div class="viv' + (F.editIdx === i ? ' editando' : '') + '">' +
        '<span class="viv-n">' + (i + 1) + '</span>' +
        '<div class="viv-txt"><b>' + esc(v.DIRECCION) + '</b><small>' + (v.SECTOR ? 'Sector ' + esc(v.SECTOR) + ' · ' : '') + (v.MANZANA ? 'Mz ' + esc(v.MANZANA) + ' · ' : '') + v.RESIDENTES + ' resid.' + (v.HORA ? ' · ' + esc(v.HORA) : '') + '</small></div>' +
        '<span class="chip ' + c.clase + '">' + c.txt + '</span>' +
        (ed ? '<span class="viv-acc"><button data-editar="' + i + '" aria-label="Editar">✏️</button><button data-borrar="' + i + '" aria-label="Borrar">🗑</button></span>' : '') +
        '</div>';
    }
    $('listaViviendas').innerHTML = html;
  }
  pintarTotales(vv);
}

function pintarTotales(vv) {
  var s = { NEB_FRIO: 0, NEB_CALIENTE: 0, CERRADA: 0, RENUENTE: 0, DESHABITADA: 0 }, res = 0;
  vv.forEach(function (v) { s[v.CONDICION] = (s[v.CONDICION] || 0) + 1; res += Number(v.RESIDENTES) || 0; });
  $('totales').innerHTML =
    '<div><b>' + vv.length + '</b><small>Total</small></div>' +
    '<div class="t-neb"><b>' + s.NEB_FRIO + '</b><small>Frío</small></div>' +
    '<div class="t-neb"><b>' + s.NEB_CALIENTE + '</b><small>Caliente</small></div>' +
    '<div class="t-cer"><b>' + s.CERRADA + '</b><small>Cerrada</small></div>' +
    '<div class="t-ren"><b>' + s.RENUENTE + '</b><small>Renuente</small></div>' +
    '<div class="t-desh"><b>' + s.DESHABITADA + '</b><small>Deshab.</small></div>' +
    '<div><b>' + res + '</b><small>Resid.</small></div>';
}

function borrarVivienda(i) {
  var p = planillaDe(F.actual); if (!p) return;
  var v = p.VIVIENDAS[i];
  if (!confirm('¿Borrar la vivienda N° ' + (i + 1) + ' (' + v.DIRECCION + ')? Las siguientes se vuelven a numerar.')) return;
  p.VIVIENDAS.splice(i, 1);
  if (F.editIdx === i) F.editIdx = null; else if (F.editIdx !== null && F.editIdx > i) F.editIdx--;
  marcarCambio(p); pintarViviendas(); prepararNueva();
}

function enviarPlanilla() {
  var p = planillaDe(F.actual), t = tareaActual();
  if (!p || !(p.VIVIENDAS || []).length) { avisar('Registra al menos una vivienda antes de enviar.', true); return; }
  if (!p.INSECTICIDA) { $('bloqueDatos').open = true; avisar('Completa el nombre del insecticida.', true); $('pInsecticida').focus(); return; }
  var vv = p.VIVIENDAS, neb = vv.filter(function (v) { return /^NEB_/.test(v.CONDICION); }).length;
  if (!confirm('¿Terminar y enviar tu planilla al jefe?\n\n' + t.ZONA + ' · Vuelta ' + t.VUELTA + '\nViviendas: ' + vv.length + ' (nebulizadas ' + neb + ')\n\nDespués ya no podrás modificarla, salvo que el jefe te la devuelva.')) return;
  p._estadoPrevio = p.ESTADO; p.ESTADO = 'ENVIADA'; p._enviar = true;
  marcarCambio(p); clearTimeout(tSync);
  abrirTarea(F.actual, true);
  if (!navigator.onLine) avisar('Sin señal: la planilla se enviará sola cuando vuelva el internet.');
  sincronizar();
}

/* ---------- arranque ---------- */
document.addEventListener('DOMContentLoaded', function () {
  $('formLogin').addEventListener('submit', ingresar);
  $('pin').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 6); });
  $('btnMenu').addEventListener('click', salir);
  $('btnAtras').addEventListener('click', mostrarTareas);
  $('btnRefrescar').addEventListener('click', function () { cargando(true); refrescar(false).finally(function () { cargando(false); }); });
  $('listaTareas').addEventListener('click', function (e) { var b = e.target.closest('[data-tarea]'); if (b) { abrirTarea(b.dataset.tarea); window.scrollTo(0, 0); } });
  $('condiciones').addEventListener('click', function (e) { var b = e.target.closest('[data-cond]'); if (b) registrarVivienda(b.dataset.cond); });
  document.querySelector('.contador').addEventListener('click', function (e) {
    var b = e.target.closest('[data-res]'); if (!b) return;
    var x = $('vResidentes'); x.value = Math.max(0, Math.min(99, (parseInt(x.value, 10) || 0) + Number(b.dataset.res)));
  });
  $('listaViviendas').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editar !== undefined) { F.editIdx = Number(b.dataset.editar); prepararNueva(); pintarViviendas(); $('bloqueNueva').scrollIntoView({ behavior: 'smooth' }); }
    if (b.dataset.borrar !== undefined) borrarVivienda(Number(b.dataset.borrar));
  });
  $('btnCancelarEdicion').addEventListener('click', function () { F.editIdx = null; prepararNueva(); pintarViviendas(); });
  ['pFum2', 'pInsecticida', 'pTipo', 'pConc'].forEach(function (k) { $(k).addEventListener('change', guardarDatosEquipo); });
  $('btnEnviar').addEventListener('click', enviarPlanilla);

  window.addEventListener('online', function () { F.sinRed = false; pintarSync(); refrescar(true); });
  window.addEventListener('offline', pintarSync);
  setInterval(function () { if (navigator.onLine && pendientes().length) sincronizar(true); }, 60000);

  // Para abrir sin internet y poder instalarla como aplicación
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  prepararInstalacion();

  var s = leerSesion();
  if (s && s.usuario) $('usuario').value = s.usuario;
  if (s && s.token && s.fum) { F.token = s.token; F.fum = s.fum; iniciar(); }
});

/* ---------- Instalar como aplicación ----------
   Android (Chrome): aparece el botón "Instalar".  iPhone (Safari): se explica cómo agregarla. */
var promptInstalar = null;
function yaInstalada() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }
function mostrarBotonInstalar(si) { $('cajaInstalar').hidden = !si; $('btnInstalar2').hidden = !si; }
function prepararInstalacion() {
  if (yaInstalada()) return;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (ios) {
    $('cajaInstalar').hidden = false; $('btnInstalar').hidden = true;
    $('ayudaInstalar').innerHTML = '&#128242; Para instalarla: abre esta p&#225;gina en <b>Safari</b>, toca <b>Compartir</b> (&#9633;&#8593;) y luego <b>Agregar a pantalla de inicio</b>.';
    return;
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); promptInstalar = e; mostrarBotonInstalar(true);
    $('ayudaInstalar').textContent = 'Queda un ícono en tu pantalla y se abre aunque no tengas señal.';
  });
  window.addEventListener('appinstalled', function () { mostrarBotonInstalar(false); avisar('✔ Aplicación instalada. Búscala en tu pantalla de inicio.'); });
  function instalar() {
    if (!promptInstalar) { avisar('En el menú de Chrome (⋮) elige "Instalar aplicación" o "Agregar a pantalla principal".'); return; }
    promptInstalar.prompt();
    promptInstalar.userChoice.then(function () { promptInstalar = null; mostrarBotonInstalar(false); });
  }
  $('btnInstalar').addEventListener('click', instalar);
  $('btnInstalar2').addEventListener('click', instalar);
}
