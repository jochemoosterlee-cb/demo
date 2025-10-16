self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('v1').then((cache) => {
      return cache.addAll([
        './',
        './index.html',
        './portal.html',
        './manifest.json',
        './icon.svg',
        './line.svg',
        './eidas.svg',
        './checkmark.svg',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
        'https://cdn.tailwindcss.com',
        'https://unpkg.com/html5-qrcode@2.3.8/dist/html5-qrcode.min.js',
        'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
      ]);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});