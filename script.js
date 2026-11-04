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

var ESTADO = { token: null, registros: [], cfg: {}, charts: {}, editandoId: null, gastoManual: false };

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
async function api(accion, datos) {
  var cuerpo = Object.assign({ accion: accion, token: ESTADO.token }, datos || {});
  var r = await fetch(CONFIG.API_URL, { method: 'POST', body: JSON.stringify(cuerpo) });
  var j = await r.json();
  if (!j.ok && j.error === 'SESION') { cerrarSesion(); throw new Error('La sesi\u00f3n venci\u00f3. Ingresa de nuevo.'); }
  if (!j.ok) throw new Error(j.error || 'Error desconocido');
  return j;
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
  try {
    var j = await api('login', { clave: $('clave').value });
    ESTADO.token = j.token;
    sessionStorage.setItem('neb_token', j.token);
    await iniciarApp();
  } catch (e) { $('loginError').textContent = e.message; }
  cargando(false);
}

function cerrarSesion() {
  if (ESTADO.token) { fetch(CONFIG.API_URL, { method: 'POST', keepalive: true, body: JSON.stringify({ accion: 'salir', token: ESTADO.token }) }).catch(function () {}); }
  ESTADO.token = null; sessionStorage.removeItem('neb_token');
  $('app').hidden = true; $('pantallaLogin').hidden = false; $('clave').value = '';
}

async function iniciarApp() {
  await recargar();
  $('pantallaLogin').hidden = true; $('app').hidden = false;
  mostrarVista('panel');
}

async function recargar() {
  var j = await api('listar');
  ESTADO.registros = j.registros.map(function (r) { NUMERICOS.forEach(function (c) { r[c] = r[c] === null ? null : n(r[c]); }); return r; });
  ESTADO.cfg = Object.assign({}, TASAS_DEFECTO, j.config || {});
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

function clave(r) { return [r.PROVINCIA, r.DISTRITO, r.UNGETS, r.ESTABLECIMIENTO, r.ZONA, r.VUELTA].join('|'); }
function esHistorico(r) { return r.CREADO === 'importado'; }
function diasEntre(a, b) { return (new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000; }
function mismoDia(r) {
  if (esHistorico(r) || !r.FECHA_INICIO) return false;
  var k = clave(r);
  return ESTADO.registros.some(function (o) { return o.ID !== r.ID && !esHistorico(o) && clave(o) === k && o.FECHA_INICIO === r.FECHA_INICIO; });
}

function alertas(r) {
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
   suma viviendas, manzanas y gasto; inicio = primer d\u00eda, t\u00e9rmino = \u00faltimo d\u00eda.
   Los registros del hist\u00f3rico ya vienen consolidados y no se unen. */
function consolidar(lista) {
  var orden = lista.slice().sort(function (a, b) { return (a.FECHA_INICIO || '').localeCompare(b.FECHA_INICIO || ''); });
  var grupos = [], abiertos = {};
  orden.forEach(function (r) {
    var k = esHistorico(r) ? 'H|' + r.ID : clave(r);
    var g = abiertos[k];
    if (g && r.FECHA_INICIO && g.FECHA_TERMINO && diasEntre(g.FECHA_TERMINO, r.FECHA_INICIO) <= DIAS_CORTE) {
      NUMERICOS.forEach(function (c) {
        if (r[c] === null || r[c] === '' || r[c] === undefined) return;
        // Los equipos no se suman: se toma el mayor numero usado en un dia
        g[c] = c.indexOf('EQ_') === 0 ? Math.max(n(g[c]), n(r[c])) : n(g[c]) + n(r[c]);
      });
      if (r.FECHA_TERMINO > g.FECHA_TERMINO) g.FECHA_TERMINO = r.FECHA_TERMINO;
      if (r.OBSERVACIONES && g.OBSERVACIONES.indexOf(r.OBSERVACIONES) < 0) g.OBSERVACIONES += (g.OBSERVACIONES ? '; ' : '') + r.OBSERVACIONES;
      g.DIAS++; g.IDS.push(r.ID);
    } else {
      g = Object.assign({}, r, { DIAS: 1, IDS: [r.ID], OBSERVACIONES: r.OBSERVACIONES || '' });
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
  graficoMes(lista); graficoCondicion(t); graficoEess(lista); tablaConsolidado(lista);
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

/* ---------- Exportar consolidado (formato del Excel original) ---------- */
async function exportar() {
  if (typeof ExcelJS === 'undefined') { avisar('No se pudo cargar la librer\u00eda de Excel. Revisa tu conexi\u00f3n.', true); return; }
  var lista = filtrados().slice().sort(function (a, b) { return (a.FECHA_INICIO || '').localeCompare(b.FECHA_INICIO || ''); });
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('Base de datos', { views: [{ state: 'frozen', ySplit: 5 }] });
  var NC = 32;
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:5' };
  var ancho = [12, 16, 12, 24, 26, 4, 6, 6, 6, 6, 6, 6, 7, 8, 8, 8, 8, 8, 6, 6, 8, 9, 9, 9, 9, 10, 6, 7, 8, 11, 11, 11];
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
    'Gasto de insecticida en litros', 'Gasto de petr\u00f3leo en galones', 'Gasto de gasolina en galones', 'Mes', 'Fecha de intervenci\u00f3n (inicio)', 'Fecha de intervenci\u00f3n (t\u00e9rmino)'];
  var fila4 = ['', '', '', '', '', '', 'Programadas', 'Nebulizadas', 'Cerradas', 'Renuentes', 'Deshabitadas', 'No visitadas', '', '', '', '', '', '',
    'Programadas', 'Nebulizadas', '', 'Equipo port\u00e1til frio', 'Equipo port\u00e1til caliente', 'Equipo pesado frio', 'Equipo pesado caliente', '', '', '', '', '', '', ''];
  var fila5 = ['Provincia', 'Distrito', 'UNGETS', 'Localidad', 'zonas', 'Vuelta', 'viv_pro', 'viv_neb', 'viv_cer', 'viv_ren', 'viv_desh', 'viv_no_vis',
    'visitadas', '% viv_neb', '% viv_cerr', '% viv_ren', '% viv_desh', '% viv_no_visitada', 'mz_pro', 'mz_neb', '% mz_neb',
    'N\u00b0_eq_por_frio', 'N\u00b0_eq_por_cali', 'N\u00b0_eq_pesado_frio', 'N\u00b0_eq_pesado_cali', '', 'insec_litros', 'petr_galones', 'gasolina_galones', 'mes', 'inicio', 't\u00e9rmino'];
  ws.getRow(3).values = fila3; ws.getRow(4).values = fila4; ws.getRow(5).values = fila5;
  // Combinar: grupos en fila 3 y columnas simples en filas 3-4
  ws.mergeCells(3, 7, 3, 12); ws.mergeCells(3, 19, 3, 20); ws.mergeCells(3, 22, 3, 25);
  [1, 2, 3, 4, 5, 6, 13, 14, 15, 16, 17, 18, 21, 26, 27, 28, 29, 30, 31, 32].forEach(function (c) { ws.mergeCells(3, c, 4, c); });
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
    fila.values = [r.PROVINCIA, r.DISTRITO, r.UNGETS, r.ESTABLECIMIENTO, r.ZONA, r.VUELTA, c.pro, c.neb, c.cer, c.ren, c.desh, c.novis, c.vis,
      c.pNeb, c.pCer, c.pRen, c.pDesh, c.pNovis, v(r.MZ_PRO), v(r.MZ_NEB), c.pMz === null ? null : c.pMz * 100,
      eq(r.EQ_PORT_FRIO), eq(r.EQ_PORT_CALIENTE), eq(r.EQ_PESADO_FRIO), eq(r.EQ_PESADO_CALIENTE),
      v(r.INSECTICIDA_ML), v(r.INSECTICIDA_L), v(r.PETROLEO_GAL), v(r.GASOLINA_GAL), (MESES[mesDe(r.FECHA_INICIO)] || '').toUpperCase(),
      fecha(r.FECHA_INICIO), fecha(r.FECHA_TERMINO)];
    for (var col = 1; col <= NC; col++) {
      var cel = fila.getCell(col);
      cel.border = borde; cel.font = { name: 'Arial', size: 9 };
      cel.alignment = { horizontal: col <= 5 ? 'left' : col === 6 || col === 30 ? 'center' : col >= 31 ? 'center' : 'right', vertical: 'middle' };
      if (col >= 14 && col <= 18) cel.numFmt = '0.00%';
      if (col === 21 || col === 26) cel.numFmt = '0.00';
      if (col === 28 || col === 29) cel.numFmt = '0.0';
      if (col >= 31) cel.numFmt = 'dd/mm/yyyy';
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
  var conAlerta = 0;
  var filas = lista.map(function (r) {
    var al = alertas(r);
    if (al.length) conAlerta++;
    if (soloRev && !al.length) return '';
    if (q && [r.ESTABLECIMIENTO, r.ZONA, r.DISTRITO, r.OBSERVACIONES, r.VUELTA].join(' ').toUpperCase().indexOf(q) < 0) return '';
    var c = calc(r);
    return '<tr' + (al.length ? ' class="revisar"' : '') + '>' +
      '<td>' + fechaCorta(r.FECHA_INICIO) + (r.FECHA_TERMINO && r.FECHA_TERMINO !== r.FECHA_INICIO ? ' al ' + fechaCorta(r.FECHA_TERMINO) : '') + '</td>' +
      '<td>' + esc(r.DISTRITO) + '</td><td>' + esc(r.ESTABLECIMIENTO) + '</td><td>' + esc(r.ZONA) + '</td><td>' + esc(r.VUELTA || '-') + '</td>' +
      '<td class="num">' + fmt(c.pro) + '</td><td class="num">' + fmt(c.neb) + '</td><td class="num">' + fmt(c.cer) + '</td><td class="num">' + fmt(c.ren) + '</td><td class="num">' + fmt(c.novis) + '</td>' +
      '<td class="num"><span class="cob ' + claseCob(c.pNeb) + '">' + fmtPct(c.pNeb) + '</span></td>' +
      '<td>' + (al.length ? '<span class="marca-rev" title="' + esc(al.join('. ')) + '">Revisar</span> ' : '') + esc(r.OBSERVACIONES) + '</td>' +
      '<td><div class="celda-acc"><button class="btn btn-claro btn-mini" data-editar="' + esc(r.ID) + '">Editar</button><button class="btn btn-peligro btn-mini" data-eliminar="' + esc(r.ID) + '">Eliminar</button></div></td></tr>';
  }).join('');
  $('resumenRegistros').textContent = 'Cada fila es un d\u00eda de trabajo; en el panel y el consolidado los d\u00edas seguidos de la misma zona y vuelta se suman en una sola intervenci\u00f3n. ' + ESTADO.registros.length + ' registros en total' + (conAlerta ? ', ' + conAlerta + ' por revisar (en amarillo; pasa el cursor sobre "Revisar" para ver el motivo).' : '.');
  $('tablaRegistros').innerHTML = '<thead><tr><th>Fecha</th><th>Distrito</th><th>Establecimiento</th><th>Zona</th><th>Vuelta</th><th class="num">Program.</th><th class="num">Nebuliz.</th><th class="num">Cerradas</th><th class="num">Renuentes</th><th class="num">No visit.</th><th class="num">Cobertura</th><th>Observaciones</th><th></th></tr></thead><tbody>' +
    (filas || '<tr><td colspan="13">No hay registros que coincidan. Registra una intervenci\u00f3n o importa el Excel hist\u00f3rico.</td></tr>') + '</tbody>';
}

async function eliminarRegistro(id) {
  var r = ESTADO.registros.find(function (x) { return x.ID === id; });
  if (!r || !confirm('\u00bfEliminar el registro de ' + r.ESTABLECIMIENTO + ' (' + (r.ZONA || 'sin zona') + ', vuelta ' + (r.VUELTA || '-') + ')? No se puede deshacer.')) return;
  cargando(true);
  try { await api('eliminar', { id: id }); ESTADO.registros = ESTADO.registros.filter(function (x) { return x.ID !== id; }); refrescarTodo(); avisar('Registro eliminado.'); }
  catch (e) { avisar(e.message, true); }
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

async function importarExcel(ev) {
  var f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (typeof XLSX === 'undefined') { avisar('No se pudo cargar la librer\u00eda de Excel. Revisa tu conexi\u00f3n.', true); return; }
  cargando(true);
  try {
    var wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    var hoja = wb.Sheets['REGISTROS'] || wb.Sheets[wb.SheetNames[0]];
    var filas = XLSX.utils.sheet_to_json(hoja, { defval: '' });
    if (!filas.length || !('ESTABLECIMIENTO' in filas[0]) || !('VIV_PRO' in filas[0])) throw new Error('El archivo no tiene las columnas del sistema (ESTABLECIMIENTO, VIV_PRO...). Usa el Excel hist\u00f3rico limpio o uno con la misma hoja REGISTROS.');
    var regs = filas.filter(function (r) { return r.ESTABLECIMIENTO; }).map(function (r) {
      var o = { ID: r.ID ? String(r.ID) : '', CREADO: r.CREADO || '' };
      CAMPOS.forEach(function (c) { o[c] = r[c] === undefined ? '' : r[c]; });
      o.FECHA_INICIO = leerFecha(r.FECHA_INICIO); o.FECHA_TERMINO = leerFecha(r.FECHA_TERMINO);
      return o;
    });
    var imp = 0, omi = 0;
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
  ESTADO.gastoManual = !!r;
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
  llenarListas(); actualizarCalculos();
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
    var j = await api('guardar', { registro: o });
    var nuevo = j.registro;
    NUMERICOS.forEach(function (c) { nuevo[c] = nuevo[c] === '' ? null : n(nuevo[c]); });
    var i = ESTADO.registros.findIndex(function (r) { return r.ID === nuevo.ID; });
    if (i >= 0) ESTADO.registros[i] = nuevo; else ESTADO.registros.push(nuevo);
    refrescarTodo();
    avisar(o.ID ? 'Cambios guardados.' : 'Registro guardado.');
    if (o.ID) mostrarVista('registros'); else abrirFormulario(null);
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
  $('btnSalir').addEventListener('click', function () { cerrarSesion(); window.location.href = 'index.html'; });
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
  $('formReg').addEventListener('submit', guardarFormulario);
  $('formReg').addEventListener('input', function (e) {
    if (e.target.classList.contains('gasto')) ESTADO.gastoManual = true;
    if (e.target.id === 'VIV_PRO' && !ESTADO.gastoManual) recalcularGasto();
    if (e.target.id === 'DISTRITO') llenarListas();
    actualizarCalculos();
  });
  $('btnRecalcGasto').addEventListener('click', function () { ESTADO.gastoManual = false; recalcularGasto(); });
  $('btnCancelar').addEventListener('click', function () { ESTADO.editandoId = null; mostrarVista('registros'); });

  var t = sessionStorage.getItem('neb_token');
  if (t && CONFIG.API_URL.indexOf('http') === 0) {
    ESTADO.token = t; cargando(true);
    iniciarApp().catch(function () { cerrarSesion(); }).finally(function () { cargando(false); });
  }
});
