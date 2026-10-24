// Shows phone alerts sent by Rent Portal and opens the site when one is tapped.
self.addEventListener('push', (event) => {
  let data = { title: 'Rent Portal', body: '', url: '/' };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch (e) {
    data.body = event.data ? event.data.text() : '';
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
