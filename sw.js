/**
 * PosThaiban - Service Worker V11.2.4 (The Ultimate Masterpiece)
 * ระบบเชื่อมโยงการอัปเดต + ทนทานต่อการโหลดไฟล์พลาด + ออฟไลน์สมบูรณ์แบบ
 */

const CACHE_NAME = 'posthaiban-v11-2-7-stable'; 

const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/html5-qrcode',
  'https://unpkg.com/dexie/dist/dexie.js',
  'https://fonts.googleapis.com/css2?family=Kanit:wght@300;400;500;600;800;900&display=swap'
];

// 🟢 1. รอรับคำสั่ง "ผลัดใบ" จากหน้า index.html 
// (พอลูกค้ากด OK ยืนยันอัปเดต ค่อยสั่ง skipWaiting จะได้ไม่รีเฟรชผีหลอก)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 🛠️ 2. Install - สั่งดาวน์โหลดไฟล์
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('📦 SW: กำลังสูบไฟล์ลงเครื่อง (PosThaiban V11.2.4)...');
      // ใช้ลอจิกเก็บทีละไฟล์ ป้องกันบั๊ก "ขาด 1 ตายหมู่"
      return Promise.allSettled(
        CORE_ASSETS.map(url => cache.add(url).catch(err => console.error(`SW: โหลดไฟล์ ${url} ไม่สำเร็จ`, err)))
      );
    })
  );
});

// 🛠️ 3. Activate - ล้างโกดังเก่าทิ้ง
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('🗑️ SW: ลบแคชเวอร์ชันเก่าทิ้งแล้ว ->', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim(); 
});

// 🛠️ 4. Fetch - กลยุทธ์ Cache-First
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      // 🛡️ ด่าน 1: เจอในแคช ส่งให้เลย
      if (cachedResponse) return cachedResponse;

      // 🌐 ด่าน 2: ไม่เจอในแคช ไปดึงจากเน็ต
      return fetch(event.request).then(networkResponse => {
        // ห้ามเก็บไฟล์ที่โหลดไม่สมบูรณ์
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // 💾 ด่าน 3: ถ่ายเอกสารเก็บลงแคช
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // 🆘 ด่าน 4: ไม่มีเน็ต และไม่มีในแคช ให้โหลด index.html แทนเพื่อกันจอขาว
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
