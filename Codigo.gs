/**
 * Sistema de Nebulizaci\u00f3n Espacial 2026 - Backend (Google Apps Script)
 * Hoja: "BD Nebulizaci\u00f3n Espacial" con hojas REGISTROS y CONFIG.
 *
 * Instalaci\u00f3n:
 *  1. Crea la hoja de c\u00e1lculo en Google Drive y \u00e1brela.
 *  2. Extensiones > Apps Script, pega este c\u00f3digo y guarda.
 *  3. Ejecuta la funci\u00f3n "instalar" (acepta los permisos).
 *  4. Implementar > Nueva implementaci\u00f3n > Aplicaci\u00f3n web
 *     Ejecutar como: Yo   |   Qui\u00e9n tiene acceso: Cualquier usuario
 *  5. Copia la URL que termina en /exec y p\u00e9gala en CONFIG.API_URL de script.js
 * Al cambiar este c\u00f3digo: p\u00e9galo, ejecuta "instalar" y publica Nueva versi\u00f3n en
 * Implementar > Administrar implementaciones (la URL no cambia).
 */

var HOJA_REG = 'REGISTROS';
var HOJA_CFG = 'CONFIG';
var DURACION_SESION = 21600; // 6 horas

var COLS = ['ID', 'PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA',
  'VIV_PRO', 'VIV_NEB', 'VIV_CER', 'VIV_REN', 'VIV_DESH', 'MZ_PRO', 'MZ_NEB',
  'EQ_PORT_FRIO', 'EQ_PORT_CALIENTE', 'EQ_PESADO_FRIO', 'EQ_PESADO_CALIENTE',
  'INSECTICIDA_ML', 'INSECTICIDA_L', 'PETROLEO_GAL', 'GASOLINA_GAL',
  'FECHA_INICIO', 'FECHA_TERMINO', 'OBSERVACIONES', 'CREADO', 'MODIFICADO'];

var NUMERICAS = ['VIV_PRO', 'VIV_NEB', 'VIV_CER', 'VIV_REN', 'VIV_DESH', 'MZ_PRO', 'MZ_NEB',
  'EQ_PORT_FRIO', 'EQ_PORT_CALIENTE', 'EQ_PESADO_FRIO', 'EQ_PESADO_CALIENTE',
  'INSECTICIDA_ML', 'INSECTICIDA_L', 'PETROLEO_GAL', 'GASOLINA_GAL'];

var CFG_DEFECTO = [
  ['CLAVE', 'nebulizacion2026', 'Contrase\u00f1a para entrar al sistema. C\u00e1mbiala.'],
  ['ML_INSECTICIDA_POR_VIV', 5.26, 'ml de insecticida por vivienda programada'],
  ['GAL_PETROLEO_POR_VIV', 0.02642, 'galones de petr\u00f3leo por vivienda programada'],
  ['GAL_GASOLINA_POR_VIV', 0.021136, 'galones de gasolina por vivienda programada'],
  ['PROVINCIA_DEFECTO', 'SAN MARTIN', 'Provincia que aparece por defecto en el formulario'],
  ['UNGETS_DEFECTO', 'SAN MARTIN', 'UNGETS que aparece por defecto en el formulario']
];

function instalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reg = ss.getSheetByName(HOJA_REG) || ss.insertSheet(HOJA_REG);
  reg.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold')
    .setBackground('#1f4e3d').setFontColor('#ffffff');
  reg.setFrozenRows(1);
  // Fechas e ID como texto para evitar cambios de zona horaria
  ['ID', 'FECHA_INICIO', 'FECHA_TERMINO', 'CREADO', 'MODIFICADO', 'VUELTA'].forEach(function (c) {
    reg.getRange(2, COLS.indexOf(c) + 1, reg.getMaxRows() - 1, 1).setNumberFormat('@');
  });

  var cfg = ss.getSheetByName(HOJA_CFG) || ss.insertSheet(HOJA_CFG);
  if (cfg.getLastRow() === 0) {
    cfg.getRange(1, 1, 1, 3).setValues([['CLAVE_CONFIG', 'VALOR', 'DESCRIPCION']]).setFontWeight('bold');
  }
  var existentes = cfg.getLastRow() > 1 ? cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  CFG_DEFECTO.forEach(function (f) {
    if (existentes.indexOf(f[0]) < 0) cfg.appendRow(f);
  });
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 2) ss.deleteSheet(hoja1);
  return 'Instalado';
}

function doGet() {
  return json({ ok: true, mensaje: 'API de nebulizaci\u00f3n activa' });
}

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.accion === 'login') return json(login(p));
    if (!sesionValida(p.token)) return json({ ok: false, error: 'SESION' });
    switch (p.accion) {
      case 'listar': return json(listar());
      case 'guardar': return json(conBloqueo(function () { return guardar(p.registro); }));
      case 'eliminar': return json(conBloqueo(function () { return eliminar(p.id); }));
      case 'importar': return json(conBloqueo(function () { return importar(p.registros); }));
      case 'salir': CacheService.getScriptCache().remove('t_' + p.token); return json({ ok: true });
      default: return json({ ok: false, error: 'Acci\u00f3n no reconocida: ' + p.accion });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function conBloqueo(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- Configuraci\u00f3n y sesi\u00f3n ---------- */
function leerConfig() {
  var cfg = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_CFG);
  var o = {};
  if (!cfg || cfg.getLastRow() < 2) return o;
  cfg.getRange(2, 1, cfg.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) o[r[0]] = r[1]; });
  return o;
}

function login(p) {
  var cfg = leerConfig();
  if (!cfg.CLAVE) return { ok: false, error: 'Falta ejecutar "instalar" en Apps Script.' };
  if (String(p.clave || '') !== String(cfg.CLAVE)) return { ok: false, error: 'Contrase\u00f1a incorrecta.' };
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('t_' + token, '1', DURACION_SESION);
  return { ok: true, token: token };
}

function sesionValida(token) {
  if (!token) return false;
  var c = CacheService.getScriptCache();
  if (c.get('t_' + token)) { c.put('t_' + token, '1', DURACION_SESION); return true; }
  return false;
}

/* ---------- Datos ---------- */
function hojaReg() { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA_REG); }

function texto(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

function listar() {
  var h = hojaReg();
  var regs = [];
  if (h.getLastRow() > 1) {
    var datos = h.getRange(2, 1, h.getLastRow() - 1, COLS.length).getValues();
    datos.forEach(function (fila) {
      if (!fila[0]) return;
      var o = {};
      COLS.forEach(function (c, i) {
        o[c] = NUMERICAS.indexOf(c) >= 0 ? (fila[i] === '' ? null : Number(fila[i])) : texto(fila[i]);
      });
      regs.push(o);
    });
  }
  var cfg = leerConfig();
  delete cfg.CLAVE;
  return { ok: true, registros: regs, config: cfg };
}

function limpiar(r) {
  var o = {};
  COLS.forEach(function (c) {
    var v = r[c];
    if (NUMERICAS.indexOf(c) >= 0) {
      o[c] = (v === '' || v === null || v === undefined || isNaN(Number(v))) ? '' : Number(v);
    } else {
      o[c] = v === null || v === undefined ? '' : String(v).trim();
    }
  });
  ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA'].forEach(function (c) { o[c] = o[c].toUpperCase(); });
  return o;
}

function validar(o) {
  var falta = ['DISTRITO', 'ESTABLECIMIENTO', 'VUELTA', 'FECHA_INICIO', 'FECHA_TERMINO'].filter(function (c) { return !o[c]; });
  if (falta.length) return 'Faltan datos: ' + falta.join(', ');
  if (o.VIV_PRO === '' || o.VIV_PRO <= 0) return 'Las viviendas programadas deben ser mayores que 0.';
  if (o.FECHA_TERMINO < o.FECHA_INICIO) return 'La fecha de t\u00e9rmino es anterior a la de inicio.';
  return '';
}

function ahora() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }

function filaDe(id) {
  var h = hojaReg();
  if (h.getLastRow() < 2) return -1;
  var ids = h.getRange(2, 1, h.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

function nuevoId() {
  return 'N' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') +
    Math.floor(Math.random() * 90 + 10);
}

function guardar(r) {
  var o = limpiar(r || {});
  var err = validar(o);
  if (err) return { ok: false, error: err };
  var h = hojaReg();
  var fila = o.ID ? filaDe(o.ID) : -1;
  if (fila > 0) {
    o.CREADO = texto(h.getRange(fila, COLS.indexOf('CREADO') + 1).getValue());
    o.MODIFICADO = ahora();
    h.getRange(fila, 1, 1, COLS.length).setValues([COLS.map(function (c) { return o[c]; })]);
  } else {
    o.ID = nuevoId();
    o.CREADO = ahora();
    o.MODIFICADO = '';
    h.appendRow(COLS.map(function (c) { return o[c]; }));
  }
  return { ok: true, registro: o };
}

function eliminar(id) {
  var fila = filaDe(id);
  if (fila < 0) return { ok: false, error: 'No se encontr\u00f3 el registro.' };
  hojaReg().deleteRow(fila);
  return { ok: true };
}

function importar(lista) {
  var h = hojaReg();
  var existentes = {};
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function (r) { existentes[String(r[0])] = 1; });
  var nuevas = [], omitidos = 0;
  (lista || []).forEach(function (r) {
    var o = limpiar(r);
    if (o.ID && existentes[o.ID]) { omitidos++; return; }
    if (!o.ID) o.ID = nuevoId() + nuevas.length;
    if (!o.CREADO) o.CREADO = 'importado';
    existentes[o.ID] = 1;
    nuevas.push(COLS.map(function (c) { return o[c]; }));
  });
  if (nuevas.length) h.getRange(h.getLastRow() + 1, 1, nuevas.length, COLS.length).setValues(nuevas);
  return { ok: true, importados: nuevas.length, omitidos: omitidos };
}
