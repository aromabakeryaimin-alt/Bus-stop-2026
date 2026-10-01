// 九巴報站 Lite · Service Worker（需與 kmb-eta.html 放在同一目錄，並以 https 開啟）
const TD2 = 'https://www.td.gov.hk/tc/special_news/trafficnews.xml';          // 特別交通消息（第二代）
const TD1 = 'https://resource.data.one.gov.hk/td/en/specialtrafficnews.xml';  // 第一代（第二代失敗時備用）
const BUS_RE = /巴士|九巴|\bbus(es)?\b|KMB/i;
const FIELDS = ['INCIDENT_HEADING', 'INCIDENT_DETAIL', 'LOCATION', 'DIRECTION', 'CONTENT']; // 與網頁的巴士判斷範圍一致

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

// Service Worker 沒有 DOMParser，只能用正則解析 XML
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const dec = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos);/g, (_, k) => ENT[k]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const tag = (b, t) => { const m = b.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? dec(m[1]).trim() : ''; };
const blocks = x => [...x.matchAll(/<message>([\s\S]*?)<\/message>/g)].map(m => m[1]);
async function getText(u) {
  const r = await fetch(u, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
}

async function loadItems() {
  // 第一代、第二代同時讀取並合併；其中一代失敗不影響另一代。id 加上代數前綴，與網頁一致
  const [r2, r1] = await Promise.allSettled([getText(TD2), getText(TD1)]);
  const items = [];
  if (r2.status === 'fulfilled') for (const b of blocks(r2.value)) {
    const id = tag(b, 'ID'); if (!id) continue;
    items.push({
      id: '2:' + id,
      brief: [[tag(b, 'INCIDENT_HEADING_CN'), tag(b, 'INCIDENT_DETAIL_CN')].filter(Boolean).join(' · '),
        [tag(b, 'LOCATION_CN'), tag(b, 'DIRECTION_CN')].filter(Boolean).join(' → ')].filter(Boolean).join('：'),
      all: FIELDS.map(k => tag(b, k + '_CN') + ' ' + tag(b, k + '_EN')).join(' ')
    });
  }
  if (r1.status === 'fulfilled') for (const b of blocks(r1.value)) {
    const id = tag(b, 'msgID'), t = tag(b, 'ChinText'); if (!id) continue;
    items.push({ id: '1:' + id, brief: t.split('\n')[0].trim(), all: t + ' ' + tag(b, 'EngText') });
  }
  if (r2.status === 'rejected' && r1.status === 'rejected') throw new Error('both failed');
  return items;
}

async function checkNews() {
  try {
    const items = await loadItems();
    const bus = items.filter(i => BUS_RE.test(i.all));
    const c = await caches.open('kmb-seen'), key = 'seen-tn';
    const old = await c.match(key), seen = old ? await old.json() : null;
    // 第一次只記錄，不會一次過彈出舊消息；tag 與網頁一致，同一則消息不會重複彈出
    if (seen) for (const i of bus) if (!seen.includes(i.id))
      await self.registration.showNotification('特別交通消息', { body: i.brief.slice(0, 80), tag: 'tn|' + i.id, data: { url: './' } });
    // 合併而非覆蓋：消息暫時消失或資料短暫為空時，不會令舊消息被當成新消息
    await c.put(key, new Response(JSON.stringify([...new Set([...(seen || []), ...bus.map(i => i.id)])].slice(-300))));
  } catch { /* 下次再試 */ }
}
