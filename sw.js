/* Nebulizacion espacial 2026 - sw.js
   Guarda la pagina y las librerias en el equipo para que el sistema abra sin internet.
   Los datos NO pasan por aqui: se guardan con script.js y se envian al volver la conexion.
   Si cambias este archivo, sube el numero de VERSION. */
var VERSION = 'neb-v1';
var GUARDAR = ['neb-recursos']; // cache que llena script.js
var BASE = ['./', 'index.html', 'dashboard.html', 'script.js'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(BASE.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSION && GUARDAR.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (/script\.google|googleusercontent/.test(url.hostname)) return; // el servidor de datos nunca se guarda
  if (url.origin === self.location.origin) {
    // Archivos del sistema: primero internet (para tener siempre la ultima version), si no hay, lo guardado
    e.respondWith(fetch(req).then(function (r) {
      if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); }
      return r;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) {
        if (r) return r;
        if (req.mode !== 'navigate') return Response.error();
        return caches.match('dashboard.html', { ignoreSearch: true }).then(function (d) { return d || Response.error(); });
      });
    }));
  } else {
    // Librerias (Chart.js, Excel, fuentes): primero lo guardado
    e.respondWith(caches.match(req).then(function (r) {
      return r || fetch(req).then(function (res) {
        if (res.ok || res.type === 'opaque') { var cp = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, cp); }); }
        return res;
      });
    }));
  }
});
