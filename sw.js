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
        './html5-qrcode.min.js', // Local file
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
        'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js',
        'https://cdn.tailwindcss.com',
        'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
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