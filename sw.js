// 九巴報站 Lite · Service Worker（需與 kmb-eta.html 放在同一目錄，並以 https 開啟）
const TD = 'https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml';
const BUS_RE = /巴士|九巴|\bbus(es)?\b|KMB/i;
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
  }));
});
// 若日後接上 Web Push 伺服器，這裡會顯示推送內容
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { /* 略過 */ }
  e.waitUntil(self.registration.showNotification(d.title || '九巴報站', { body: d.body || '', tag: d.tag, data: { url: d.url } }));
});
// 背景定期檢查運輸署消息（只有 Chromium 已安裝的 PWA 支援，間隔由瀏覽器決定）
self.addEventListener('periodicsync', e => { if (e.tag === 'kmb-news') e.waitUntil(checkNews()); });
async function checkNews() {
  try {
    const x = await (await fetch(TD, { cache: 'no-store' })).text();
    const items = [...x.matchAll(/<msgID>(\d+)<\/msgID>[\s\S]*?<ChinText>([\s\S]*?)<\/ChinText>[\s\S]*?<EngText>([\s\S]*?)<\/EngText>/g)]
      .map(m => ({ id: m[1], t: m[2].trim(), e: m[3] })).filter(i => BUS_RE.test(i.t + i.e));
    const c = await caches.open('kmb-seen'), old = await c.match('seen'), seen = old ? await old.json() : null;
    if (seen) for (const i of items) if (!seen.includes(i.id))
      await self.registration.showNotification('運輸署緊急消息', { body: i.t.split('\n')[0].slice(0, 80), tag: 'urg|' + i.id, data: { url: './' } });
    await c.put('seen', new Response(JSON.stringify(items.map(i => i.id))));
  } catch { /* 下次再試 */ }
}
