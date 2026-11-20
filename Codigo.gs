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
  'FECHA_INICIO', 'FECHA_TERMINO', 'OBSERVACIONES', 'CREADO', 'MODIFICADO', 'TIPO'];
// TIPO: vac\u00edo = d\u00eda de trabajo normal; NO_REALIZADA = vuelta que no se hizo (el motivo va en OBSERVACIONES)

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
  if (reg.getMaxColumns() < COLS.length) reg.insertColumnsAfter(reg.getMaxColumns(), COLS.length - reg.getMaxColumns());
  reg.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold')
    .setBackground('#1f4e3d').setFontColor('#ffffff');
  reg.setFrozenRows(1);
  // Fechas e ID como texto para evitar cambios de zona horaria
  ['ID', 'FECHA_INICIO', 'FECHA_TERMINO', 'CREADO', 'MODIFICADO', 'VUELTA', 'TIPO'].forEach(function (c) {
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
  instalarFumigadores();
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
    if (String(p.accion || '').indexOf('fum') === 0) return json(rutaFumigador(p)); // fumigadores (su propia sesion)
    if (!sesionValida(p.token)) return json({ ok: false, error: 'SESION' });
    if (String(p.accion || '').indexOf('jf') === 0) return json(rutaJefe(p));      // jefe: fumigadores, tareas y planillas
    switch (p.accion) {
      case 'listar': return json(listar());
      case 'guardar': return json(conBloqueo(function () { return guardar(p.registro); }));
      case 'eliminar': return json(conBloqueo(function () { return eliminar(p.id); }));
      case 'eliminarVarios': return json(conBloqueo(function () { return eliminarVarios(p.ids); }));
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
  ['PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA', 'TIPO'].forEach(function (c) { o[c] = o[c].toUpperCase(); });
  return o;
}

function validar(o) {
  if (o.TIPO === 'NO_REALIZADA') {
    var f2 = ['DISTRITO', 'ESTABLECIMIENTO', 'VUELTA', 'OBSERVACIONES'].filter(function (c) { return !o[c]; });
    return f2.length ? 'Faltan datos: ' + f2.join(', ') + ' (el motivo va en observaciones)' : '';
  }
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

/* Borra varios registros de una sola vez. Las filas se eliminan de abajo hacia arriba
   (agrupando las consecutivas) para que no se desfasen los n\u00fameros de fila. */
function eliminarVarios(ids) {
  ids = (ids || []).map(String);
  if (!ids.length) return { ok: false, error: 'No se seleccion\u00f3 ning\u00fan registro.' };
  var h = hojaReg();
  if (h.getLastRow() < 2) return { ok: true, eliminados: 0, noEncontrados: ids };
  var buscar = {};
  ids.forEach(function (id) { buscar[id] = 1; });
  var filas = [];
  h.getRange(2, 1, h.getLastRow() - 1, 1).getValues().forEach(function (r, i) {
    var id = String(r[0]);
    if (buscar[id]) { filas.push(i + 2); delete buscar[id]; }
  });
  filas.sort(function (a, b) { return b - a; });
  var k = 0;
  while (k < filas.length) {
    var fin = filas[k], ini = fin;
    while (k + 1 < filas.length && filas[k + 1] === ini - 1) { k++; ini--; }
    h.deleteRows(ini, fin - ini + 1);
    k++;
  }
  return { ok: true, eliminados: filas.length, noEncontrados: Object.keys(buscar) };
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


/* =====================================================================
   MÓDULO DE FUMIGADORES
   - El jefe crea TAREAS (zona, vuelta, viviendas programadas) y da de alta a los FUMIGADORES.
   - Cada fumigador entra con su usuario y PIN y llena su PLANILLA casa por casa
     (igual que el formato físico de nebulización con equipo portátil).
   - Al terminar la envía; el jefe la revisa y APRUEBA la tarea: ahí se crea
     (o actualiza) la fila del consolidado en REGISTROS.
   ===================================================================== */
var HOJA_FUM = 'FUMIGADORES', HOJA_TAR = 'TAREAS', HOJA_PLA = 'PLANILLAS', HOJA_VIV = 'VIVIENDAS';
var COLS_FUM = ['ID', 'USUARIO', 'NOMBRE', 'PIN_HASH', 'ACTIVO', 'CREADO'];
var COLS_TAR = ['ID', 'FECHA', 'PROVINCIA', 'DISTRITO', 'UNGETS', 'ESTABLECIMIENTO', 'MICRORED', 'ZONA', 'VUELTA',
  'VIV_PRO', 'MZ_PRO', 'JEFE_BRIGADA', 'FUMIGADORES', 'ESTADO', 'REGISTRO_ID', 'OBSERVACIONES', 'CREADO', 'MODIFICADO'];
var COLS_PLA = ['ID', 'TAREA_ID', 'FUMIGADOR_ID', 'FUMIGADOR', 'FUMIGADOR_2', 'INSECTICIDA', 'TIPO_INSECTICIDA', 'CONCENTRACION',
  'ESTADO', 'NOTA_JEFE', 'TOTAL_VIV', 'NEB_FRIO', 'NEB_CALIENTE', 'CERRADAS', 'RENUENTES', 'DESHABITADAS', 'RESIDENTES',
  'MANZANAS', 'VIVIENDAS_JSON', 'CREADO', 'ENVIADO', 'MODIFICADO'];
var COLS_VIV = ['PLANILLA_ID', 'TAREA_ID', 'FECHA', 'FUMIGADOR', 'ZONA', 'VUELTA', 'ORDEN', 'SECTOR', 'MANZANA',
  'DIRECCION', 'RESIDENTES', 'CONDICION', 'HORA'];
// Condición de cada vivienda (columnas del formato físico + renuente, que pide el consolidado)
var CONDICIONES = ['NEB_FRIO', 'NEB_CALIENTE', 'CERRADA', 'RENUENTE', 'DESHABITADA'];
var MAX_VIVIENDAS = 400;

function instalarFumigadores() {
  [[HOJA_FUM, COLS_FUM], [HOJA_TAR, COLS_TAR], [HOJA_PLA, COLS_PLA], [HOJA_VIV, COLS_VIV]].forEach(function (x) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var h = ss.getSheetByName(x[0]) || ss.insertSheet(x[0]);
    if (h.getMaxColumns() < x[1].length) h.insertColumnsAfter(h.getMaxColumns(), x[1].length - h.getMaxColumns());
    h.getRange(1, 1, 1, x[1].length).setValues([x[1]]).setFontWeight('bold').setBackground('#1f4e3d').setFontColor('#ffffff');
    h.setFrozenRows(1);
    h.getRange(2, 1, Math.max(h.getMaxRows() - 1, 1), x[1].length).setNumberFormat('@'); // todo como texto
  });
}

/* ---------- utilidades de hojas ---------- */
function hojaF(nombre) {
  var h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre);
  if (!h) { instalarFumigadores(); h = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nombre); }
  return h;
}
function leerTabla(nombre, cols) {
  var h = hojaF(nombre);
  if (h.getLastRow() < 2) return [];
  return h.getRange(2, 1, h.getLastRow() - 1, cols.length).getValues()
    .map(function (f, i) { var o = { _fila: i + 2 }; cols.forEach(function (c, j) { o[c] = texto(f[j]); }); return o; })
    .filter(function (o) { return o[cols[0]]; });
}
function escribirFila(nombre, cols, o) {
  var h = hojaF(nombre), fila = cols.map(function (c) { return o[c] === undefined || o[c] === null ? '' : String(o[c]); });
  if (o._fila) h.getRange(o._fila, 1, 1, cols.length).setValues([fila]);
  else { h.appendRow(fila); o._fila = h.getLastRow(); }
  return o;
}
function sinFila(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_fila') c[k] = o[k]; }); return c; }
function idF(prefijo) { return prefijo + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') + Math.floor(Math.random() * 900 + 100); }
function hashPin(usuario, pin) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'fum|' + String(usuario).toUpperCase() + '|' + pin, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function txtF(v, max) { return String(v === null || v === undefined ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max || 120); }
function asignado(tarea, fumId) {
  var lista = String(tarea.FUMIGADORES || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  return !lista.length || lista.indexOf(fumId) >= 0;
}

/* ---------- RUTAS DEL FUMIGADOR ---------- */
function rutaFumigador(p) {
  if (p.accion === 'fumLogin') return fumLogin(p);
  var c = CacheService.getScriptCache(), fid = c.get('f_' + p.token);
  if (!fid) return { ok: false, error: 'SESION' };
  c.put('f_' + p.token, fid, 43200); // 12 h, se renueva con el uso
  var fum = leerTabla(HOJA_FUM, COLS_FUM).filter(function (f) { return f.ID === fid; })[0];
  if (!fum || fum.ACTIVO === 'NO') return { ok: false, error: 'SESION' };
  switch (p.accion) {
    case 'fumDatos': return fumDatos(fum);
    case 'fumGuardar': return conBloqueo(function () { return fumGuardar(fum, p.planilla, !!p.enviar); });
    case 'fumSalir': c.remove('f_' + p.token); return { ok: true };
    default: return { ok: false, error: 'Acción no reconocida: ' + p.accion };
  }
}

function fumLogin(p) {
  var usuario = txtF(p.usuario, 30).toUpperCase(), pin = String(p.pin || '');
  if (!usuario || !pin) return { ok: false, error: 'Escribe tu usuario y tu PIN.' };
  var c = CacheService.getScriptCache(), k = 'fi_' + usuario, intentos = Number(c.get(k) || 0);
  if (intentos >= 6) return { ok: false, error: 'Demasiados intentos. Espera 10 minutos o pide a tu jefe que revise tu PIN.' };
  var fum = leerTabla(HOJA_FUM, COLS_FUM).filter(function (f) { return f.USUARIO.toUpperCase() === usuario; })[0];
  if (!fum || fum.PIN_HASH !== hashPin(usuario, pin)) { c.put(k, String(intentos + 1), 600); return { ok: false, error: 'Usuario o PIN incorrecto.' }; }
  if (fum.ACTIVO === 'NO') return { ok: false, error: 'Tu usuario está desactivado. Habla con tu jefe de brigada.' };
  c.remove(k);
  var token = Utilities.getUuid();
  c.put('f_' + token, fum.ID, 43200);
  return { ok: true, token: token, fumigador: { ID: fum.ID, NOMBRE: fum.NOMBRE, USUARIO: fum.USUARIO } };
}

function fumDatos(fum) {
  var tareas = leerTabla(HOJA_TAR, COLS_TAR);
  var planillas = leerTabla(HOJA_PLA, COLS_PLA).filter(function (pl) { return pl.FUMIGADOR_ID === fum.ID; });
  var conPlanilla = {};
  planillas.forEach(function (pl) { conPlanilla[pl.TAREA_ID] = 1; });
  var limite = Utilities.formatDate(new Date(Date.now() - 30 * 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var visibles = tareas.filter(function (t) {
    return (t.ESTADO !== 'APROBADA' && asignado(t, fum.ID)) || (conPlanilla[t.ID] && t.FECHA >= limite);
  }).map(sinFila);
  var ids = {}; visibles.forEach(function (t) { ids[t.ID] = 1; });
  return {
    ok: true,
    fumigador: { ID: fum.ID, NOMBRE: fum.NOMBRE, USUARIO: fum.USUARIO },
    tareas: visibles,
    planillas: planillas.filter(function (pl) { return ids[pl.TAREA_ID]; }).map(function (pl) {
      var o = sinFila(pl); o.VIVIENDAS = JSON.parse(pl.VIVIENDAS_JSON || '[]'); delete o.VIVIENDAS_JSON; return o;
    })
  };
}

/* Resume las viviendas de una planilla (lo que va en la fila "Total" del formato) */
function resumirViviendas(lista) {
  var r = { TOTAL_VIV: lista.length, NEB_FRIO: 0, NEB_CALIENTE: 0, CERRADAS: 0, RENUENTES: 0, DESHABITADAS: 0, RESIDENTES: 0, MANZANAS: 0 };
  var mz = {};
  lista.forEach(function (v) {
    if (v.CONDICION === 'NEB_FRIO') r.NEB_FRIO++;
    else if (v.CONDICION === 'NEB_CALIENTE') r.NEB_CALIENTE++;
    else if (v.CONDICION === 'CERRADA') r.CERRADAS++;
    else if (v.CONDICION === 'RENUENTE') r.RENUENTES++;
    else if (v.CONDICION === 'DESHABITADA') r.DESHABITADAS++;
    r.RESIDENTES += Number(v.RESIDENTES) || 0;
    if (/^NEB_/.test(v.CONDICION) && v.MANZANA) mz[(v.SECTOR || '') + '|' + v.MANZANA] = 1;
  });
  r.MANZANAS = Object.keys(mz).length; // manzanas con al menos una vivienda nebulizada
  return r;
}

function fumGuardar(fum, pl, enviar) {
  pl = pl || {};
  var tarea = leerTabla(HOJA_TAR, COLS_TAR).filter(function (t) { return t.ID === pl.TAREA_ID; })[0];
  if (!tarea) return { ok: false, error: 'La tarea ya no existe. Pide a tu jefe que la vuelva a crear.' };
  var existentes = leerTabla(HOJA_PLA, COLS_PLA);
  var previa = existentes.filter(function (x) { return x.ID === pl.ID; })[0];
  if (previa && previa.FUMIGADOR_ID !== fum.ID) return { ok: false, error: 'Esta planilla es de otro fumigador.' };
  if (previa && (previa.ESTADO === 'ENVIADA' || previa.ESTADO === 'APROBADA')) {
    return { ok: false, error: 'Esta planilla ya fue ' + previa.ESTADO.toLowerCase() + '. Si necesitas corregirla, pide a tu jefe que te la devuelva.', planilla: fumDatosPlanilla(previa) };
  }
  if (!previa && tarea.ESTADO === 'APROBADA') return { ok: false, error: 'Esta tarea ya fue aprobada y cerrada por el jefe.' };
  if (!previa && !asignado(tarea, fum.ID)) return { ok: false, error: 'Esta tarea no está asignada a ti.' };

  var viviendas = (pl.VIVIENDAS || []).slice(0, MAX_VIVIENDAS).map(function (v, i) {
    var cond = String(v.CONDICION || '').toUpperCase();
    if (CONDICIONES.indexOf(cond) < 0) throw new Error('Vivienda N° ' + (i + 1) + ': falta marcar la condición.');
    return {
      ORDEN: i + 1, SECTOR: txtF(v.SECTOR, 30).toUpperCase(), MANZANA: txtF(v.MANZANA, 20).toUpperCase(),
      DIRECCION: txtF(v.DIRECCION, 150), RESIDENTES: Math.max(0, Math.min(99, Math.round(Number(v.RESIDENTES) || 0))),
      CONDICION: cond, HORA: txtF(v.HORA, 5)
    };
  });
  if (enviar && !viviendas.length) return { ok: false, error: 'No puedes enviar una planilla sin viviendas.' };

  var o = previa || { ID: txtF(pl.ID, 40) || idF('P'), TAREA_ID: tarea.ID, FUMIGADOR_ID: fum.ID, CREADO: ahora() };
  if (!/^[A-Za-z0-9-]+$/.test(o.ID)) o.ID = idF('P');
  o.FUMIGADOR = fum.NOMBRE;
  o.FUMIGADOR_2 = txtF(pl.FUMIGADOR_2, 80).toUpperCase();
  o.INSECTICIDA = txtF(pl.INSECTICIDA, 60).toUpperCase();
  o.TIPO_INSECTICIDA = txtF(pl.TIPO_INSECTICIDA, 30).toUpperCase();
  o.CONCENTRACION = txtF(pl.CONCENTRACION, 30);
  o.ESTADO = enviar ? 'ENVIADA' : 'BORRADOR';
  if (enviar) o.ENVIADO = ahora();
  o.MODIFICADO = ahora();
  var res = resumirViviendas(viviendas);
  Object.keys(res).forEach(function (k) { o[k] = res[k]; });
  o.VIVIENDAS_JSON = JSON.stringify(viviendas);
  escribirFila(HOJA_PLA, COLS_PLA, o);
  return { ok: true, planilla: fumDatosPlanilla(o) };
}
function fumDatosPlanilla(pl) { var o = sinFila(pl); o.VIVIENDAS = JSON.parse(pl.VIVIENDAS_JSON || '[]'); delete o.VIVIENDAS_JSON; return o; }

/* ---------- RUTAS DEL JEFE (usa la sesión del sistema) ---------- */
function rutaJefe(p) {
  switch (p.accion) {
    case 'jfListar': return jfListar();
    case 'jfGuardarFumigador': return conBloqueo(function () { return jfGuardarFumigador(p.fumigador || {}); });
    case 'jfGuardarTarea': return conBloqueo(function () { return jfGuardarTarea(p.tarea || {}); });
    case 'jfEliminarTarea': return conBloqueo(function () { return jfEliminarTarea(p.id); });
    case 'jfDevolver': return conBloqueo(function () { return jfDevolver(p.id, p.nota); });
    case 'jfAprobar': return conBloqueo(function () { return jfAprobar(p.id, !!p.forzar); });
    default: return { ok: false, error: 'Acción no reconocida: ' + p.accion };
  }
}

function jfListar() {
  return {
    ok: true,
    fumigadores: leerTabla(HOJA_FUM, COLS_FUM).map(function (f) { var o = sinFila(f); o.TIENE_PIN = !!f.PIN_HASH; delete o.PIN_HASH; return o; }),
    tareas: leerTabla(HOJA_TAR, COLS_TAR).map(sinFila),
    planillas: leerTabla(HOJA_PLA, COLS_PLA).map(fumDatosPlanilla)
  };
}

function jfGuardarFumigador(f) {
  var usuario = txtF(f.USUARIO, 30).toUpperCase().replace(/\s/g, ''), nombre = txtF(f.NOMBRE, 80).toUpperCase();
  if (!usuario || !nombre) return { ok: false, error: 'Escribe el usuario (ej. su DNI) y el nombre completo.' };
  var todos = leerTabla(HOJA_FUM, COLS_FUM);
  if (todos.some(function (x) { return x.USUARIO.toUpperCase() === usuario && x.ID !== f.ID; })) return { ok: false, error: 'Ya existe otro fumigador con el usuario ' + usuario + '.' };
  var o = f.ID ? todos.filter(function (x) { return x.ID === f.ID; })[0] : null;
  if (f.ID && !o) return { ok: false, error: 'No se encontró el fumigador.' };
  var pin = String(f.PIN || '');
  if (pin && !/^\d{4,6}$/.test(pin)) return { ok: false, error: 'El PIN debe tener de 4 a 6 números.' };
  if (!o && !pin) return { ok: false, error: 'Asigna un PIN de 4 a 6 números.' };
  if (o && o.USUARIO !== usuario && !pin) return { ok: false, error: 'Si cambias el usuario, asigna también un PIN nuevo.' };
  o = o || { ID: idF('F'), CREADO: ahora() };
  o.USUARIO = usuario; o.NOMBRE = nombre; o.ACTIVO = f.ACTIVO === 'NO' ? 'NO' : 'SI';
  if (pin) o.PIN_HASH = hashPin(usuario, pin);
  escribirFila(HOJA_FUM, COLS_FUM, o);
  // Si se renombra, se actualiza el nombre en sus planillas
  var plas = leerTabla(HOJA_PLA, COLS_PLA).filter(function (pl) { return pl.FUMIGADOR_ID === o.ID && pl.FUMIGADOR !== o.NOMBRE; });
  plas.forEach(function (pl) { pl.FUMIGADOR = o.NOMBRE; escribirFila(HOJA_PLA, COLS_PLA, pl); });
  var r = sinFila(o); r.TIENE_PIN = true; delete r.PIN_HASH;
  return { ok: true, fumigador: r };
}

function jfGuardarTarea(t) {
  var cfg = leerConfig();
  var o = t.ID ? leerTabla(HOJA_TAR, COLS_TAR).filter(function (x) { return x.ID === t.ID; })[0] : null;
  if (t.ID && !o) return { ok: false, error: 'No se encontró la tarea.' };
  o = o || { ID: idF('T'), ESTADO: 'ABIERTA', CREADO: ahora() };
  o.FECHA = txtF(t.FECHA, 10);
  o.PROVINCIA = txtF(t.PROVINCIA || cfg.PROVINCIA_DEFECTO, 60).toUpperCase();
  o.DISTRITO = txtF(t.DISTRITO, 60).toUpperCase();
  o.UNGETS = txtF(t.UNGETS || cfg.UNGETS_DEFECTO, 60).toUpperCase();
  o.ESTABLECIMIENTO = txtF(t.ESTABLECIMIENTO, 100).toUpperCase();
  o.MICRORED = txtF(t.MICRORED, 60).toUpperCase();
  o.ZONA = txtF(t.ZONA, 150).toUpperCase();
  o.VUELTA = txtF(t.VUELTA, 5).toUpperCase();
  o.VIV_PRO = Math.round(Number(t.VIV_PRO) || 0);
  o.MZ_PRO = t.MZ_PRO === '' || t.MZ_PRO === null || t.MZ_PRO === undefined ? '' : Math.round(Number(t.MZ_PRO) || 0);
  o.JEFE_BRIGADA = txtF(t.JEFE_BRIGADA, 80).toUpperCase();
  o.FUMIGADORES = (t.FUMIGADORES || []).map(String).join(',');
  o.OBSERVACIONES = txtF(t.OBSERVACIONES, 300);
  o.MODIFICADO = ahora();
  var falta = ['FECHA', 'DISTRITO', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA'].filter(function (c) { return !o[c]; });
  if (falta.length) return { ok: false, error: 'Faltan datos: ' + falta.join(', ') };
  if (!(o.VIV_PRO > 0)) return { ok: false, error: 'Las viviendas programadas deben ser mayores que 0.' };
  escribirFila(HOJA_TAR, COLS_TAR, o);
  return { ok: true, tarea: sinFila(o) };
}

function jfEliminarTarea(id) {
  var t = leerTabla(HOJA_TAR, COLS_TAR).filter(function (x) { return x.ID === id; })[0];
  if (!t) return { ok: false, error: 'No se encontró la tarea.' };
  var plas = leerTabla(HOJA_PLA, COLS_PLA).filter(function (pl) { return pl.TAREA_ID === id; });
  if (plas.some(function (pl) { return Number(pl.TOTAL_VIV) > 0; })) return { ok: false, error: 'No se puede eliminar: ya tiene planillas con viviendas registradas.' };
  borrarFilas(HOJA_PLA, plas.map(function (pl) { return pl._fila; }));
  hojaF(HOJA_TAR).deleteRow(t._fila);
  return { ok: true };
}

function borrarFilas(nombre, filas) {
  var h = hojaF(nombre);
  filas.sort(function (a, b) { return b - a; });
  var k = 0;
  while (k < filas.length) {
    var fin = filas[k], ini = fin;
    while (k + 1 < filas.length && filas[k + 1] === ini - 1) { k++; ini--; }
    h.deleteRows(ini, fin - ini + 1);
    k++;
  }
}

/* El jefe devuelve una planilla al fumigador para que la corrija */
function jfDevolver(id, nota) {
  var pl = leerTabla(HOJA_PLA, COLS_PLA).filter(function (x) { return x.ID === id; })[0];
  if (!pl) return { ok: false, error: 'No se encontró la planilla.' };
  pl.ESTADO = 'DEVUELTA'; pl.NOTA_JEFE = txtF(nota, 200); pl.MODIFICADO = ahora();
  escribirFila(HOJA_PLA, COLS_PLA, pl);
  var t = leerTabla(HOJA_TAR, COLS_TAR).filter(function (x) { return x.ID === pl.TAREA_ID; })[0];
  if (t && t.ESTADO === 'APROBADA') { t.ESTADO = 'ABIERTA'; t.MODIFICADO = ahora(); escribirFila(HOJA_TAR, COLS_TAR, t); }
  return { ok: true };
}

/* Aprueba la tarea: suma las planillas enviadas y crea/actualiza su fila en REGISTROS (el consolidado) */
function jfAprobar(id, forzar) {
  var t = leerTabla(HOJA_TAR, COLS_TAR).filter(function (x) { return x.ID === id; })[0];
  if (!t) return { ok: false, error: 'No se encontró la tarea.' };
  var plas = leerTabla(HOJA_PLA, COLS_PLA).filter(function (pl) { return pl.TAREA_ID === id; });
  var listas = plas.filter(function (pl) { return pl.ESTADO === 'ENVIADA' || pl.ESTADO === 'APROBADA'; });
  var pendientes = plas.filter(function (pl) { return pl.ESTADO === 'BORRADOR' || pl.ESTADO === 'DEVUELTA'; });
  if (!listas.length) return { ok: false, error: 'Ningún fumigador ha enviado su planilla para esta tarea.' };
  if (pendientes.length && !forzar) {
    return { ok: false, pendientes: pendientes.map(function (pl) { return pl.FUMIGADOR + ' (' + pl.ESTADO.toLowerCase() + ')'; }),
      error: 'Hay planillas sin enviar: ' + pendientes.map(function (pl) { return pl.FUMIGADOR; }).join(', ') };
  }

  var s = { NEB: 0, CER: 0, REN: 0, DESH: 0, FRIO: 0, CAL: 0 }, mz = {}, nombres = [];
  listas.forEach(function (pl) {
    var vv = JSON.parse(pl.VIVIENDAS_JSON || '[]'), r = resumirViviendas(vv);
    s.NEB += r.NEB_FRIO + r.NEB_CALIENTE; s.CER += r.CERRADAS; s.REN += r.RENUENTES; s.DESH += r.DESHABITADAS;
    if (r.NEB_FRIO) s.FRIO++;          // equipos portátiles usados en frío (uno por planilla)
    if (r.NEB_CALIENTE) s.CAL++;       // equipos portátiles usados en caliente
    vv.forEach(function (v) { if (/^NEB_/.test(v.CONDICION) && v.MANZANA) mz[(v.SECTOR || '') + '|' + v.MANZANA] = 1; });
    nombres.push(pl.FUMIGADOR + (pl.FUMIGADOR_2 ? ' y ' + pl.FUMIGADOR_2 : ''));
  });

  var cfg = leerConfig(), pro = Number(t.VIV_PRO) || 0;
  var ml = pro * (Number(cfg.ML_INSECTICIDA_POR_VIV) || 0);
  var reg = {
    ID: t.REGISTRO_ID && filaDe(t.REGISTRO_ID) > 0 ? t.REGISTRO_ID : '',
    PROVINCIA: t.PROVINCIA, DISTRITO: t.DISTRITO, UNGETS: t.UNGETS, ESTABLECIMIENTO: t.ESTABLECIMIENTO,
    ZONA: t.ZONA, VUELTA: t.VUELTA, VIV_PRO: pro, VIV_NEB: s.NEB, VIV_CER: s.CER, VIV_REN: s.REN, VIV_DESH: s.DESH,
    MZ_PRO: t.MZ_PRO, MZ_NEB: Object.keys(mz).length,
    EQ_PORT_FRIO: s.FRIO, EQ_PORT_CALIENTE: s.CAL, EQ_PESADO_FRIO: 0, EQ_PESADO_CALIENTE: 0,
    INSECTICIDA_ML: pro ? Number(ml.toFixed(2)) : '', INSECTICIDA_L: pro ? Number((ml / 1000).toFixed(2)) : '',
    PETROLEO_GAL: pro ? Number((pro * (Number(cfg.GAL_PETROLEO_POR_VIV) || 0)).toFixed(5)) : '',
    GASOLINA_GAL: pro ? Number((pro * (Number(cfg.GAL_GASOLINA_POR_VIV) || 0)).toFixed(6)) : '',
    FECHA_INICIO: t.FECHA, FECHA_TERMINO: t.FECHA,
    OBSERVACIONES: ('Planillas de fumigadores: ' + nombres.join('; ') + (t.OBSERVACIONES ? '. ' + t.OBSERVACIONES : '')).slice(0, 480),
    TIPO: ''
  };
  var res = guardar(reg);
  if (!res.ok) return res;

  listas.forEach(function (pl) { pl.ESTADO = 'APROBADA'; pl.MODIFICADO = ahora(); escribirFila(HOJA_PLA, COLS_PLA, pl); });
  t.ESTADO = 'APROBADA'; t.REGISTRO_ID = res.registro.ID; t.MODIFICADO = ahora();
  escribirFila(HOJA_TAR, COLS_TAR, t);
  escribirDetalleViviendas(t, listas);
  return { ok: true, registro: res.registro, tarea: sinFila(t) };
}

/* Copia casa por casa a la hoja VIVIENDAS (para consultas en Excel). Reemplaza lo anterior de esa tarea. */
function escribirDetalleViviendas(t, planillas) {
  var h = hojaF(HOJA_VIV);
  if (h.getLastRow() > 1) {
    var filas = [];
    h.getRange(2, 2, h.getLastRow() - 1, 1).getValues().forEach(function (r, i) { if (String(r[0]) === t.ID) filas.push(i + 2); });
    borrarFilas(HOJA_VIV, filas);
  }
  var nuevas = [];
  planillas.forEach(function (pl) {
    JSON.parse(pl.VIVIENDAS_JSON || '[]').forEach(function (v) {
      nuevas.push([pl.ID, t.ID, t.FECHA, pl.FUMIGADOR, t.ZONA, t.VUELTA, v.ORDEN, v.SECTOR, v.MANZANA, v.DIRECCION, v.RESIDENTES, v.CONDICION, v.HORA].map(String));
    });
  });
  if (nuevas.length) h.getRange(h.getLastRow() + 1, 1, nuevas.length, COLS_VIV.length).setValues(nuevas);
}
