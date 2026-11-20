/* =========================================================
   Nebulización espacial 2026 - Módulo del jefe: fumigadores (fumigadores-jefe.js)
   - Da de alta a los fumigadores (usuario + PIN).
   - Crea tareas (zona, vuelta, viviendas programadas) y las asigna.
   - Revisa las planillas casa por casa y aprueba: pasa al consolidado (REGISTROS).
   Usa las funciones de script.js: api, $, esc, avisar, cargando, fmt, fechaCorta, recargar.
   ========================================================= */
var JF = { listas: { insecticidas: ['MALATHION 57 EC'], motivos: ['CONTROL DE BROTE', 'CERCO'] }, fumigadores: [], tareas: [], planillas: [], cargado: false, sub: 'revisar', editTarea: null, editFum: null, proManual: false, mzManual: false };
var JF_COND = { NEB_FRIO: 'En frío', NEB_CALIENTE: 'Caliente', CERRADA: 'Cerrada', RENUENTE: 'Renuente', DESHABITADA: 'Deshabitada' };
var JF_EST = { BORRADOR: 'En proceso', ENVIADA: 'Enviada', APROBADA: 'Aprobada', DEVUELTA: 'Devuelta' };

function jfNum(v) { var x = Number(v); return isFinite(x) ? x : 0; }
function jfPlanillasDe(tid) { return JF.planillas.filter(function (p) { return p.TAREA_ID === tid; }); }
function jfFumNombre(id) { var f = JF.fumigadores.filter(function (x) { return x.ID === id; })[0]; return f ? f.NOMBRE : id; }
function jfSuma(plas) {
  var s = { viv: 0, neb: 0, frio: 0, cal: 0, cer: 0, ren: 0, desh: 0, res: 0 }, mz = {};
  plas.forEach(function (p) {
    (p.VIVIENDAS || []).forEach(function (v) {
      s.viv++; s.res += jfNum(v.RESIDENTES);
      if (v.CONDICION === 'NEB_FRIO') { s.frio++; s.neb++; } else if (v.CONDICION === 'NEB_CALIENTE') { s.cal++; s.neb++; }
      else if (v.CONDICION === 'CERRADA') s.cer++; else if (v.CONDICION === 'RENUENTE') s.ren++; else if (v.CONDICION === 'DESHABITADA') s.desh++;
      if (/^NEB_/.test(v.CONDICION) && v.MANZANA) mz[(v.SECTOR || '') + '|' + v.MANZANA] = 1;
    });
  });
  s.mz = Object.keys(mz).length;
  return s;
}

/* ---------- carga ---------- */
async function jfCargar(silencioso) {
  if (!navigator.onLine) { $('fumSinRed').hidden = false; return; }
  $('fumSinRed').hidden = true;
  if (!silencioso) cargando(true);
  try {
    var j = await api('jfListar');
    JF.fumigadores = j.fumigadores || []; JF.tareas = j.tareas || []; JF.planillas = j.planillas || [];
    if (j.listas) JF.listas = j.listas;
    JF.cargado = true;
    jfPintar();
  } catch (e) {
    if (/no reconocida/i.test(e.message || '')) avisar('Falta actualizar Codigo.gs en Apps Script (módulo de fumigadores). Revisa el LEEME.', true);
    else if (!silencioso) avisar(e.message, true);
  }
  if (!silencioso) cargando(false);
}

function jfPintar() {
  var porRevisar = JF.planillas.filter(function (p) { return p.ESTADO === 'ENVIADA'; }).length;
  $('badgeFum').textContent = porRevisar; $('badgeFum').hidden = !porRevisar;
  $('cuentaRevisar').textContent = porRevisar ? '(' + porRevisar + ')' : '';
  jfPintarRevisar(); jfPintarTareas(); jfPintarFum(); jfPintarChecks(); jfPintarListas(); jfOpcionesMotivo();
}

function jfSub(s) {
  JF.sub = s;
  document.querySelectorAll('#subFum .sub').forEach(function (b) { b.classList.toggle('activa', b.dataset.sub === s); });
  ['revisar', 'tareas', 'personal', 'listas'].forEach(function (x) { $('sub-' + x).hidden = x !== s; });
}

/* ---------- POR REVISAR ---------- */
function jfPintarRevisar() {
  var tareas = JF.tareas.filter(function (t) { return t.ESTADO !== 'APROBADA' && jfPlanillasDe(t.ID).length; })
    .sort(function (a, b) {
      var ea = jfPlanillasDe(a.ID).some(function (p) { return p.ESTADO === 'ENVIADA'; }) ? 0 : 1;
      var eb = jfPlanillasDe(b.ID).some(function (p) { return p.ESTADO === 'ENVIADA'; }) ? 0 : 1;
      return ea - eb || (b.FECHA || '').localeCompare(a.FECHA || '');
    });
  if (!tareas.length) {
    $('listaRevisar').innerHTML = '<div class="bloque vacio-fum">No hay planillas pendientes. Cuando un fumigador env&#237;e su planilla aparecer&#225; aqu&#237;.</div>';
    return;
  }
  $('listaRevisar').innerHTML = tareas.map(function (t) {
    var plas = jfPlanillasDe(t.ID), listas = plas.filter(function (p) { return p.ESTADO === 'ENVIADA' || p.ESTADO === 'APROBADA'; });
    var s = jfSuma(listas), pro = jfNum(t.VIV_PRO), cob = pro ? (s.neb / pro * 100).toFixed(1) + '%' : '-';
    var asign = String(t.FUMIGADORES || '').split(',').filter(String);
    var sinEmpezar = asign.filter(function (id) { return !plas.some(function (p) { return p.FUMIGADOR_ID === id; }); }).map(jfFumNombre);
    var filas = plas.map(function (p) {
      var x = jfSuma([p]);
      return '<tr><td><b>' + esc(p.FUMIGADOR) + '</b>' + (p.FUMIGADOR_2 ? '<br><span class="nota">con ' + esc(p.FUMIGADOR_2) + '</span>' : '') + '</td>' +
        '<td><span class="est-fum e-' + p.ESTADO + '">' + (JF_EST[p.ESTADO] || p.ESTADO) + '</span>' + (p.NOTA_JEFE && p.ESTADO === 'DEVUELTA' ? '<br><span class="nota">' + esc(p.NOTA_JEFE) + '</span>' : '') + '</td>' +
        '<td class="num">' + x.viv + '</td><td class="num">' + x.frio + '</td><td class="num">' + x.cal + '</td><td class="num">' + x.cer + '</td><td class="num">' + x.ren + '</td><td class="num">' + x.desh + '</td><td class="num">' + x.res + '</td>' +
        '<td>' + esc(p.INSECTICIDA || '-') + (p.CONCENTRACION ? ' ' + esc(p.CONCENTRACION) : '') + '</td>' +
        '<td class="acc"><button class="btn btn-claro btn-mini" data-ver="' + esc(p.ID) + '">Ver</button>' +
        (p.ESTADO === 'ENVIADA' ? ' <button class="btn btn-peligro btn-mini" data-devolver="' + esc(p.ID) + '">Devolver</button>' : '') + '</td></tr>';
    }).join('');
    var hayEnviadas = listas.length > 0;
    return '<section class="bloque tarea-rev">' +
      '<div class="bloque-cab"><div><h2>' + esc(t.ZONA) + ' &#183; Vuelta ' + esc(t.VUELTA) + '</h2>' +
      '<span class="nota">' + (t.MOTIVO ? '<b>' + esc(t.MOTIVO) + '</b> &#183; ' : '') + fechaCorta(t.FECHA) + ' &#183; ' + esc(t.ESTABLECIMIENTO) + ' &#183; ' + esc(t.DISTRITO) + (t.JEFE_BRIGADA ? ' &#183; J. brigada: ' + esc(t.JEFE_BRIGADA) : '') + '</span></div>' +
      '<button class="btn btn-primario" data-aprobar="' + esc(t.ID) + '"' + (hayEnviadas ? '' : ' disabled title="Ning&#250;n fumigador ha enviado su planilla"') + '>&#10004; Aprobar y pasar al consolidado</button></div>' +
      '<div class="resumen-tarea">' +
      '<span>Programadas <b>' + fmt(pro) + '</b></span><span>Nebulizadas <b>' + fmt(s.neb) + '</b> (' + cob + ')</span>' +
      '<span>Cerradas <b>' + s.cer + '</b></span><span>Renuentes <b>' + s.ren + '</b></span><span>Deshabitadas <b>' + s.desh + '</b></span>' +
      '<span>Manzanas neb. <b>' + s.mz + '</b>' + (t.MZ_PRO !== '' ? ' de ' + esc(t.MZ_PRO) : '') + '</span>' +
      (s.neb + s.cer + s.ren + s.desh > pro ? '<span class="mal">Las visitadas superan las programadas</span>' : '') +
      '</div>' +
      (sinEmpezar.length ? '<p class="nota">Sin planilla todav&#237;a: ' + sinEmpezar.map(esc).join(', ') + '</p>' : '') +
      '<div class="tabla-envoltura"><table><thead><tr><th>Fumigador</th><th>Estado</th><th class="num">Viv.</th><th class="num">Fr&#237;o</th><th class="num">Caliente</th><th class="num">Cerr.</th><th class="num">Ren.</th><th class="num">Desh.</th><th class="num">Resid.</th><th>Insecticida</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>' +
      '<p class="nota">Solo se suman las planillas <b>enviadas</b>. Las que est&#225;n en proceso o devueltas no entran hasta que el fumigador las env&#237;e.</p>' +
      '</section>';
  }).join('');
}

async function jfAprobar(id) {
  var t = JF.tareas.filter(function (x) { return x.ID === id; })[0];
  var listas = jfPlanillasDe(id).filter(function (p) { return p.ESTADO === 'ENVIADA' || p.ESTADO === 'APROBADA'; }), s = jfSuma(listas);
  if (!confirm('¿Aprobar y pasar al consolidado?\n\n' + t.ZONA + ' · Vuelta ' + t.VUELTA + ' · ' + fechaCorta(t.FECHA) +
    '\nProgramadas: ' + t.VIV_PRO + '\nNebulizadas: ' + s.neb + ' · Cerradas: ' + s.cer + ' · Renuentes: ' + s.ren + ' · Deshabitadas: ' + s.desh +
    '\n\nSe creará (o actualizará) la fila en Registros.')) return;
  cargando(true);
  try {
    var j;
    try { j = await api('jfAprobar', { id: id }); }
    catch (e) {
      if (!/sin enviar/i.test(e.message || '')) throw e;
      cargando(false);
      if (!confirm(e.message + '.\n\n¿Aprobar solo con las planillas enviadas?')) return;
      cargando(true);
      j = await api('jfAprobar', { id: id, forzar: true });
    }
    avisar('Aprobado: ya está en el consolidado (Registros).');
    await recargar();          // actualiza Panel y Registros
    await jfCargar(true);
  } catch (e) { avisar(e.message, true); }
  cargando(false);
}

async function jfDevolver(id) {
  var p = JF.planillas.filter(function (x) { return x.ID === id; })[0];
  var nota = prompt('Devolver la planilla de ' + p.FUMIGADOR + ' para que la corrija.\n\n¿Qué debe corregir?', '');
  if (nota === null) return;
  cargando(true);
  try { await api('jfDevolver', { id: id, nota: nota }); avisar('Planilla devuelta a ' + p.FUMIGADOR + '.'); await jfCargar(true); }
  catch (e) { avisar(e.message, true); }
  cargando(false);
}

/* Detalle casa por casa, con el mismo orden de columnas del formato físico */
function jfVerPlanilla(id) {
  var p = JF.planillas.filter(function (x) { return x.ID === id; })[0]; if (!p) return;
  var t = JF.tareas.filter(function (x) { return x.ID === p.TAREA_ID; })[0] || {};
  var vv = p.VIVIENDAS || [], s = jfSuma([p]);
  function x(v, c) { return v.CONDICION === c ? '&#10005;' : ''; }
  $('contenidoPlanilla').innerHTML =
    '<div class="formato">' +
    '<h3>FORMATO DE NEBULIZACI&#211;N ESPACIAL DE VIVIENDAS CON EQUIPO PORT&#193;TIL</h3>' +
    '<div class="formato-cab">' +
    '<span><b>Provincia:</b> ' + esc(t.PROVINCIA) + '</span><span><b>Microred:</b> ' + esc(t.MICRORED || '-') + '</span>' +
    '<span><b>Distrito:</b> ' + esc(t.DISTRITO) + '</span><span><b>Establecimiento:</b> ' + esc(t.ESTABLECIMIENTO) + '</span>' +
    '<span><b>Localidad:</b> ' + esc(t.ZONA) + '</span><span><b>Fecha:</b> ' + fechaCorta(t.FECHA) + '</span>' +
    '<span><b>Control de:</b> ' + esc(t.MOTIVO || '-') + '</span><span><b>Vuelta:</b> ' + esc(t.VUELTA) + '</span><span><b>Estado:</b> ' + (JF_EST[p.ESTADO] || p.ESTADO) + (p.ENVIADO ? ' (' + esc(p.ENVIADO) + ')' : '') + '</span>' +
    '</div>' +
    '<div class="tabla-envoltura"><table class="tabla-formato"><thead>' +
    '<tr><th rowspan="2">N&#176;</th><th rowspan="2">Sector</th><th rowspan="2">N&#176; Mz</th><th rowspan="2">Direcci&#243;n / Jefe de familia</th><th rowspan="2" class="num">Resid.</th><th colspan="2">Nebulizada</th><th rowspan="2">Cerrada</th><th rowspan="2">Renuente</th><th rowspan="2">Deshab.</th><th rowspan="2">Hora</th></tr>' +
    '<tr><th>En fr&#237;o</th><th>Caliente</th></tr></thead><tbody>' +
    vv.map(function (v, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + esc(v.SECTOR) + '</td><td>' + esc(v.MANZANA) + '</td><td>' + esc(v.DIRECCION) + '</td><td class="num">' + esc(v.RESIDENTES) + '</td>' +
        '<td class="marca">' + x(v, 'NEB_FRIO') + '</td><td class="marca">' + x(v, 'NEB_CALIENTE') + '</td><td class="marca">' + x(v, 'CERRADA') + '</td><td class="marca">' + x(v, 'RENUENTE') + '</td><td class="marca">' + x(v, 'DESHABITADA') + '</td><td>' + esc(v.HORA || '') + '</td></tr>';
    }).join('') +
    '</tbody><tfoot><tr><td colspan="4"><b>Total (' + s.viv + ' viviendas)</b></td><td class="num"><b>' + s.res + '</b></td><td class="marca"><b>' + s.frio + '</b></td><td class="marca"><b>' + s.cal + '</b></td><td class="marca"><b>' + s.cer + '</b></td><td class="marca"><b>' + s.ren + '</b></td><td class="marca"><b>' + s.desh + '</b></td><td></td></tr></tfoot></table></div>' +
    '<div class="formato-pie">' +
    '<span><b>J. de brigada:</b> ' + esc(t.JEFE_BRIGADA || '-') + '</span><span><b>Fumigador 1:</b> ' + esc(p.FUMIGADOR) + '</span><span><b>Fumigador 2:</b> ' + esc(p.FUMIGADOR_2 || '-') + '</span>' +
    '<span><b>Insecticida:</b> ' + esc(p.INSECTICIDA || '-') + '</span><span><b>Tipo:</b> ' + esc(p.TIPO_INSECTICIDA || '-') + '</span><span><b>Concentraci&#243;n final:</b> ' + esc(p.CONCENTRACION || '-') + '</span>' +
    '</div></div>';
  $('modalPlanilla').hidden = false;
}

/* ---------- TAREAS ---------- */
function jfPintarChecks() {
  var marcados = JF.editTarea ? String(JF.editTarea.FUMIGADORES || '').split(',') : [];
  var activos = JF.fumigadores.filter(function (f) { return f.ACTIVO !== 'NO' || marcados.indexOf(f.ID) >= 0; });
  $('checksFum').innerHTML = activos.length ? activos.map(function (f) {
    return '<label class="check-fum"><input type="checkbox" value="' + esc(f.ID) + '"' + (marcados.indexOf(f.ID) >= 0 ? ' checked' : '') + '> ' + esc(f.NOMBRE) + '</label>';
  }).join('') : '<span class="nota">A&#250;n no registras fumigadores (pesta&#241;a Fumigadores).</span>';
}

function jfLimpiarTarea() {
  JF.editTarea = null;
  $('formTarea').reset(); $('tareaError').textContent = '';
  $('tFECHA').value = hoyISO();
  $('tJEFE_BRIGADA').value = localStorage.getItem('jf_jefe') || '';
  jfOpcionesMotivo(); $('tMOTIVO').value = localStorage.getItem('jf_motivo') || '';
  $('tituloTarea').textContent = 'Nueva tarea para fumigadores'; $('idTarea').textContent = '';
  $('btnTareaGuardar').textContent = 'Crear tarea';
  JF.proManual = false; JF.mzManual = false;
  jfPintarChecks(); jfRevisarVueltaTarea();
}

function jfEditarTarea(id) {
  var t = JF.tareas.filter(function (x) { return x.ID === id; })[0]; if (!t) return;
  JF.editTarea = t;
  ['FECHA', 'DISTRITO', 'ESTABLECIMIENTO', 'MICRORED', 'ZONA', 'VUELTA', 'MOTIVO', 'VIV_PRO', 'MZ_PRO', 'JEFE_BRIGADA', 'OBSERVACIONES'].forEach(function (c) { $('t' + c).value = t[c] || ''; });
  $('tituloTarea').textContent = 'Editar tarea'; $('idTarea').textContent = t.ESTADO === 'APROBADA' ? 'Ya aprobada: al guardar se actualiza el consolidado' : '';
  $('btnTareaGuardar').textContent = 'Guardar cambios';
  JF.proManual = true; JF.mzManual = true;
  jfPintarChecks(); jfRevisarVueltaTarea(); jfSub('tareas'); $('formTarea').scrollIntoView({ behavior: 'smooth' });
}

async function jfGuardarTarea(ev) {
  ev.preventDefault();
  var o = { ID: JF.editTarea ? JF.editTarea.ID : '' };
  ['FECHA', 'DISTRITO', 'ESTABLECIMIENTO', 'MICRORED', 'ZONA', 'VUELTA', 'MOTIVO', 'VIV_PRO', 'MZ_PRO', 'JEFE_BRIGADA', 'OBSERVACIONES'].forEach(function (c) { o[c] = $('t' + c).value.trim(); });
  o.FUMIGADORES = Array.prototype.map.call(document.querySelectorAll('#checksFum input:checked'), function (c) { return c.value; });
  var falta = ['FECHA', 'DISTRITO', 'ESTABLECIMIENTO', 'ZONA', 'VUELTA', 'MOTIVO'].filter(function (c) { return !o[c]; });
  if (falta.length || !(Number(o.VIV_PRO) > 0)) { $('tareaError').textContent = 'Completa fecha, distrito, establecimiento, zona, vuelta, "control de" y viviendas programadas.'; return; }
  $('tareaError').textContent = '';
  var eraAprobada = JF.editTarea && JF.editTarea.ESTADO === 'APROBADA';
  cargando(true);
  try {
    var j = await api('jfGuardarTarea', { tarea: o });
    if (o.JEFE_BRIGADA) localStorage.setItem('jf_jefe', o.JEFE_BRIGADA);
    localStorage.setItem('jf_motivo', o.MOTIVO);
    if (eraAprobada) { await api('jfAprobar', { id: j.tarea.ID, forzar: true }); await recargar(); }
    avisar(o.ID ? 'Tarea actualizada.' : 'Tarea creada. Los fumigadores ya la ven en su celular.');
    jfLimpiarTarea();
    await jfCargar(true);
  } catch (e) { $('tareaError').textContent = e.message; }
  cargando(false);
}

async function jfEliminarTarea(id) {
  var t = JF.tareas.filter(function (x) { return x.ID === id; })[0];
  if (!confirm('¿Eliminar la tarea ' + t.ZONA + ' · Vuelta ' + t.VUELTA + ' del ' + fechaCorta(t.FECHA) + '?')) return;
  cargando(true);
  try { await api('jfEliminarTarea', { id: id }); avisar('Tarea eliminada.'); await jfCargar(true); }
  catch (e) { avisar(e.message, true); }
  cargando(false);
}

function jfPintarTareas() {
  var filtro = $('filtroTareas').value;
  var lista = JF.tareas.filter(function (t) { return !filtro || (filtro === 'APROBADA' ? t.ESTADO === 'APROBADA' : t.ESTADO !== 'APROBADA'); })
    .sort(function (a, b) { return (b.FECHA || '').localeCompare(a.FECHA || ''); });
  if (!lista.length) { $('tablaTareas').innerHTML = '<tr><td class="nota">No hay tareas.</td></tr>'; return; }
  $('tablaTareas').innerHTML = '<thead><tr><th>Fecha</th><th>Zona</th><th>Vuelta</th><th>Establecimiento</th><th class="num">Prog.</th><th>Fumigadores</th><th>Planillas</th><th class="num">Visitadas</th><th>Estado</th><th></th></tr></thead><tbody>' +
    lista.map(function (t) {
      var plas = jfPlanillasDe(t.ID), s = jfSuma(plas), env = plas.filter(function (p) { return p.ESTADO === 'ENVIADA' || p.ESTADO === 'APROBADA'; }).length;
      var asign = String(t.FUMIGADORES || '').split(',').filter(String);
      var vis = s.neb + s.cer + s.ren + s.desh, pro = jfNum(t.VIV_PRO);
      var borrable = !plas.some(function (p) { return (p.VIVIENDAS || []).length; });
      return '<tr><td>' + fechaCorta(t.FECHA) + '</td><td><b>' + esc(t.ZONA) + '</b>' + (t.MOTIVO ? '<br><span class="nota">' + esc(t.MOTIVO) + '</span>' : '') + '</td><td>' + esc(t.VUELTA) + '</td><td>' + esc(t.ESTABLECIMIENTO) + '<br><span class="nota">' + esc(t.DISTRITO) + '</span></td>' +
        '<td class="num">' + fmt(pro) + '</td><td>' + (asign.length ? asign.map(jfFumNombre).map(esc).join('<br>') : '<span class="nota">Todos</span>') + '</td>' +
        '<td>' + env + ' enviada' + (env === 1 ? '' : 's') + ' de ' + plas.length + '</td>' +
        '<td class="num">' + vis + (pro ? ' <span class="nota">(' + Math.round(vis / pro * 100) + '%)</span>' : '') + '</td>' +
        '<td><span class="est-fum e-' + (t.ESTADO === 'APROBADA' ? 'APROBADA' : 'BORRADOR') + '">' + (t.ESTADO === 'APROBADA' ? 'Aprobada' : 'Abierta') + '</span></td>' +
        '<td class="acc"><button class="btn btn-claro btn-mini" data-editar-tarea="' + esc(t.ID) + '">Editar</button>' +
        (borrable ? ' <button class="btn btn-peligro btn-mini" data-eliminar-tarea="' + esc(t.ID) + '">Eliminar</button>' : '') + '</td></tr>';
    }).join('') + '</tbody>';
}

/* ---------- Aviso de vuelta en la tarea (igual que en "Nuevo registro") ----------
   Usa avanceVuelta() de script.js: si la zona ya tiene avance en esta vuelta muestra las pendientes;
   si es una vuelta nueva, muestra las programadas de la vuelta anterior y las pone en la tarea. */
function jfRevisarVueltaTarea() {
  var box = $('avisoVueltaTarea'); if (!box) return;
  var o = {
    ID: JF.editTarea && JF.editTarea.REGISTRO_ID ? JF.editTarea.REGISTRO_ID : '',
    DISTRITO: $('tDISTRITO').value.trim().toUpperCase(), ESTABLECIMIENTO: $('tESTABLECIMIENTO').value.trim().toUpperCase(),
    ZONA: $('tZONA').value.trim().toUpperCase(), VUELTA: $('tVUELTA').value, FECHA_INICIO: $('tFECHA').value
  };
  var a = (o.ESTABLECIMIENTO && o.VUELTA) ? avanceVuelta(o) : null, html = '', tono = 'info', sug = null, sugMz = null;
  if (a && a.g) {
    var c = a.c;
    if (c.novis > 0) {
      sug = c.novis; sugMz = a.mzPend > 0 ? a.mzPend : null;
      html = '<b>Esta zona ya tiene avance en la vuelta ' + esc(o.VUELTA) + '</b>: ' + fmt(c.pro) + ' programadas y ' + fmt(c.vis) + ' visitadas (' + fmt(c.neb) + ' nebulizadas).<br>' +
        '<b style="font-size:1.05rem">Pendientes: ' + fmt(c.novis) + ' viviendas</b>' + (sugMz ? ' &#183; ' + fmt(sugMz) + ' manzanas' : '') +
        '. Al aprobar, este d&#237;a se suma a la misma fila del consolidado.' +
        (n($('tVIV_PRO').value) === c.novis ? '' : ' <button class="btn btn-claro btn-mini" type="button" data-usar="' + c.novis + '">Usar ' + c.novis + ' como programadas</button>');
    } else {
      tono = 'ok';
      html = '<b>La vuelta ' + esc(o.VUELTA) + ' de esta zona ya est&#225; completa</b>: ' + fmt(c.pro) + ' programadas y ' + fmt(c.vis) + ' visitadas.' +
        (a.sig ? ' <button class="btn btn-claro btn-mini" type="button" data-vuelta="' + a.sig + '">Pasar a la vuelta ' + a.sig + '</button>' : '');
    }
  } else if (a && a.prev) {
    sug = a.prev.pro || null; sugMz = n(a.prev.mzp) || null;
    html = '<b>Vuelta ' + esc(o.VUELTA) + ' nueva en esta zona.</b> En la vuelta ' + esc(normTxt(a.prev.VUELTA)) + ' se programaron <b>' + fmt(a.prev.pro) + ' viviendas</b>' + (sugMz ? ' y ' + fmt(sugMz) + ' manzanas' : '') + '; las vueltas llevan las mismas programadas.' +
      (n($('tVIV_PRO').value) === a.prev.pro ? '' : ' <button class="btn btn-claro btn-mini" type="button" data-usar="' + a.prev.pro + '"' + (sugMz ? ' data-mz="' + sugMz + '"' : '') + '>Usar ' + a.prev.pro + '</button>');
  }
  if (!html) { box.hidden = true; box.innerHTML = ''; return; }
  box.className = 'aviso-vuelta ' + tono; box.innerHTML = html; box.hidden = false;
  if (sug !== null && !JF.proManual) $('tVIV_PRO').value = sug;
  if (sugMz !== null && !JF.mzManual) $('tMZ_PRO').value = sugMz;
}

function jfListaZonas() {
  var dis = $('tDISTRITO').value.trim().toUpperCase(), ee = $('tESTABLECIMIENTO').value.trim().toUpperCase(), vistos = {};
  var zonas = ESTADO.registros.concat(JF.tareas).filter(function (r) {
    return r.ZONA && (!dis || normTxt(r.DISTRITO) === dis) && (!ee || normTxt(r.ESTABLECIMIENTO) === ee);
  }).map(function (r) { return normTxt(r.ZONA); }).filter(function (z) { if (vistos[z]) return false; vistos[z] = 1; return true; }).sort();
  $('lZonaTarea').innerHTML = zonas.map(function (z) { return '<option value="' + esc(z) + '">'; }).join('');
}

/* ---------- LISTAS: insecticidas y "Control de" ---------- */
function jfOpcionesMotivo() {
  var sel = $('tMOTIVO'), actual = sel.value || (JF.editTarea ? JF.editTarea.MOTIVO : '');
  var ops = JF.listas.motivos.slice();
  if (actual && ops.indexOf(actual) < 0) ops.push(actual);
  sel.innerHTML = '<option value="">Elegir</option>' + ops.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('');
  sel.value = actual;
}
function jfPintarListas() {
  function pinta(id, arr, tipo) {
    $(id).innerHTML = arr.map(function (x, i) {
      return '<li><span>' + (i === 0 && tipo === 'insecticidas' ? '&#11088; ' : '') + esc(x) + '</span>' +
        (i > 0 && tipo === 'insecticidas' ? '<button type="button" class="btn btn-claro btn-mini" data-principal="' + i + '">Poner primero</button>' : '') +
        '<button type="button" class="btn btn-peligro btn-mini" data-quitar="' + tipo + '|' + i + '">Quitar</button></li>';
    }).join('');
  }
  pinta('listaInsect', JF.listas.insecticidas, 'insecticidas');
  pinta('listaMotivos', JF.listas.motivos, 'motivos');
}
async function jfGuardarListas(nuevas) {
  cargando(true);
  try { var j = await api('jfGuardarListas', { listas: nuevas }); JF.listas = j.listas; jfPintarListas(); jfOpcionesMotivo(); avisar('Lista guardada. Los fumigadores la ven al actualizar.'); }
  catch (e) { avisar(e.message, true); }
  cargando(false);
}

/* ---------- FUMIGADORES ---------- */
function jfPintarFum() {
  var lista = JF.fumigadores.slice().sort(function (a, b) { return a.NOMBRE.localeCompare(b.NOMBRE); });
  if (!lista.length) { $('tablaFum').innerHTML = '<tr><td class="nota">A&#250;n no hay fumigadores registrados.</td></tr>'; return; }
  $('tablaFum').innerHTML = '<thead><tr><th>Nombre</th><th>DNI (usuario)</th><th>Estado</th><th class="num">Planillas</th><th class="num">Viviendas registradas</th><th></th></tr></thead><tbody>' +
    lista.map(function (f) {
      var plas = JF.planillas.filter(function (p) { return p.FUMIGADOR_ID === f.ID; }), s = jfSuma(plas);
      return '<tr><td><b>' + esc(f.NOMBRE) + '</b></td><td><code>' + esc(f.USUARIO) + '</code></td>' +
        '<td><span class="est-fum ' + (f.ACTIVO === 'NO' ? 'e-DEVUELTA">Desactivado' : 'e-APROBADA">Activo') + '</span>' +
        (f.CAMBIAR_CLAVE === 'SI' ? '<br><span class="nota">A&#250;n no cambia su contrase&#241;a</span>' : '') + '</td>' +
        '<td class="num">' + plas.length + '</td><td class="num">' + s.viv + '</td>' +
        '<td class="acc"><button class="btn btn-claro btn-mini" data-editar-fum="' + esc(f.ID) + '">Editar</button></td></tr>';
    }).join('') + '</tbody>';
}

function jfLimpiarFum() {
  JF.editFum = null; $('formFum').reset(); $('fumError').textContent = '';
  $('tituloFum').textContent = 'Nuevo fumigador'; $('cajaRestablecer').hidden = true;
  $('notaPin').textContent = 'Su usuario será el DNI y su contraseña inicial también el DNI. En el primer ingreso el sistema le pedirá crear su propia contraseña.';
}
function jfEditarFum(id) {
  var f = JF.fumigadores.filter(function (x) { return x.ID === id; })[0]; if (!f) return;
  JF.editFum = f;
  $('fNOMBRE').value = f.NOMBRE; $('fUSUARIO').value = f.USUARIO; $('fACTIVO').value = f.ACTIVO === 'NO' ? 'NO' : 'SI';
  $('fRESTABLECER').checked = false; $('cajaRestablecer').hidden = false;
  $('tituloFum').textContent = 'Editar fumigador';
  $('notaPin').textContent = 'Si olvidó su contraseña, marca "Restablecer contraseña". Si cambias el DNI, la contraseña vuelve a ser el nuevo DNI.';
  $('formFum').scrollIntoView({ behavior: 'smooth' });
}
async function jfGuardarFum(ev) {
  ev.preventDefault();
  var o = { ID: JF.editFum ? JF.editFum.ID : '', NOMBRE: $('fNOMBRE').value.trim(), USUARIO: $('fUSUARIO').value.replace(/\D/g, ''), ACTIVO: $('fACTIVO').value, RESTABLECER: $('fRESTABLECER').checked };
  if (!o.NOMBRE) { $('fumError').textContent = 'Escribe los nombres y apellidos.'; return; }
  if (!/^\d{8}$/.test(o.USUARIO)) { $('fumError').textContent = 'El DNI debe tener 8 números.'; return; }
  cargando(true);
  try {
    var j = await api('jfGuardarFumigador', { fumigador: o });
    avisar(!o.ID ? 'Fumigador registrado. Usuario y contraseña inicial: ' + o.USUARIO :
      j.restablecida ? 'Contraseña restablecida: ahora es su DNI (' + o.USUARIO + ').' : 'Fumigador actualizado.', false);
    jfLimpiarFum(); await jfCargar(true);
  } catch (e) { $('fumError').textContent = e.message; }
  cargando(false);
}

/* ---------- conexión con script.js ---------- */
(function () {
  var mostrarOriginal = mostrarVista;
  mostrarVista = function (v) {
    mostrarOriginal(v);
    if (v === 'fumigadores') { if (!$('tFECHA').value) $('tFECHA').value = hoyISO(); jfCargar(JF.cargado); }
  };
  var iniciarOriginal = iniciarApp;
  iniciarApp = async function () {
    await iniciarOriginal();
    jfCargar(true); // para el contador de planillas por revisar
  };
})();

document.addEventListener('DOMContentLoaded', function () {
  $('subFum').addEventListener('click', function (e) { var b = e.target.closest('[data-sub]'); if (b) jfSub(b.dataset.sub); });
  $('btnFumActualizar').addEventListener('click', function () { jfCargar(false); });
  $('listaRevisar').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.aprobar) jfAprobar(b.dataset.aprobar);
    if (b.dataset.ver) jfVerPlanilla(b.dataset.ver);
    if (b.dataset.devolver) jfDevolver(b.dataset.devolver);
  });
  $('tablaTareas').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.editarTarea) jfEditarTarea(b.dataset.editarTarea);
    if (b.dataset.eliminarTarea) jfEliminarTarea(b.dataset.eliminarTarea);
  });
  $('tablaFum').addEventListener('click', function (e) { var b = e.target.closest('[data-editar-fum]'); if (b) jfEditarFum(b.dataset.editarFum); });
  $('formTarea').addEventListener('submit', jfGuardarTarea);
  $('btnTareaCancelar').addEventListener('click', jfLimpiarTarea);
  $('tDISTRITO').addEventListener('input', function () { $('DISTRITO').value = this.value; llenarListas(); });
  $('formTarea').addEventListener('input', function (e) {
    if (e.target.id === 'tVIV_PRO') JF.proManual = true;
    if (e.target.id === 'tMZ_PRO') JF.mzManual = true;
    if (['tDISTRITO', 'tESTABLECIMIENTO'].indexOf(e.target.id) >= 0) jfListaZonas();
    if (['tDISTRITO', 'tESTABLECIMIENTO', 'tZONA', 'tVUELTA', 'tFECHA'].indexOf(e.target.id) >= 0) jfRevisarVueltaTarea();
  });
  $('formTarea').addEventListener('change', function (e) {
    if (['tESTABLECIMIENTO', 'tZONA', 'tVUELTA', 'tFECHA'].indexOf(e.target.id) >= 0) { jfListaZonas(); jfRevisarVueltaTarea(); }
  });
  $('avisoVueltaTarea').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.usar) { $('tVIV_PRO').value = b.dataset.usar; JF.proManual = false; if (b.dataset.mz) $('tMZ_PRO').value = b.dataset.mz; }
    if (b.dataset.vuelta) { var sel = $('tVUELTA'); if (![].some.call(sel.options, function (op) { return op.value === b.dataset.vuelta; })) sel.add(new Option(b.dataset.vuelta, b.dataset.vuelta)); sel.value = b.dataset.vuelta; JF.proManual = false; JF.mzManual = false; }
    jfRevisarVueltaTarea();
  });
  $('filtroTareas').addEventListener('change', jfPintarTareas);
  $('formFum').addEventListener('submit', jfGuardarFum);
  $('btnFumCancelar').addEventListener('click', jfLimpiarFum);
  $('fUSUARIO').addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 8); });
  $('btnCerrarModal').addEventListener('click', function () { $('modalPlanilla').hidden = true; });
  $('modalPlanilla').addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
  $('btnImprimirPlanilla').addEventListener('click', function () { document.body.classList.add('imprimiendo-planilla'); window.print(); document.body.classList.remove('imprimiendo-planilla'); });

  var enlace = location.href.split('#')[0].split('?')[0].replace(/dashboard\.html$/, '') ;
  enlace = enlace.replace(/\/?$/, '/') + 'fumigador.html';
  $('enlaceFum').textContent = enlace;
  $('btnCopiarEnlace').addEventListener('click', function () {
    (navigator.clipboard ? navigator.clipboard.writeText(enlace) : Promise.reject()).then(function () { avisar('Enlace copiado.'); }, function () { prompt('Copia este enlace:', enlace); });
  });
  $('sub-listas').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var l = { insecticidas: JF.listas.insecticidas.slice(), motivos: JF.listas.motivos.slice() };
    if (b.dataset.agregar) {
      var inp = b.dataset.agregar === 'insecticidas' ? $('nuevoInsect') : $('nuevoMotivo'), v = inp.value.trim().toUpperCase();
      if (!v) { inp.focus(); return; }
      if (l[b.dataset.agregar].indexOf(v) >= 0) { avisar('Ya est\u00e1 en la lista.', true); return; }
      l[b.dataset.agregar].push(v); inp.value = '';
    }
    if (b.dataset.quitar) {
      var x = b.dataset.quitar.split('|');
      if (!confirm('\u00bfQuitar ' + l[x[0]][x[1]] + ' de la lista? Lo ya registrado no cambia.')) return;
      l[x[0]].splice(Number(x[1]), 1);
    }
    if (b.dataset.principal) { var i = Number(b.dataset.principal); l.insecticidas.unshift(l.insecticidas.splice(i, 1)[0]); }
    jfGuardarListas(l);
  });
  ['nuevoInsect', 'nuevoMotivo'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); this.nextElementSibling.click(); } });
  });
  jfLimpiarFum(); jfLimpiarTarea(); jfPintarListas();
});
