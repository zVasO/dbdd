export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) {
    console.log('Browser notifications are not supported');
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

export async function sendNotification(title: string, body: string): Promise<void> {
  if (!('Notification' in window)) {
    console.log(`[Notification] ${title}: ${body}`);
    return;
  }

  if (Notification.permission !== 'granted') {
    const granted = await requestNotificationPermission();
    if (!granted) {
      console.log(`[Notification] ${title}: ${body}`);
      return;
    }
  }

  try {
    new Notification(title, {
      body,
      icon: '/icon.png',
      tag: `dataforge-${Date.now()}`,
    });
  } catch {
    console.log(`[Notification] ${title}: ${body}`);
  }
}
