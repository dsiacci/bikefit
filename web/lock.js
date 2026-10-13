// Once the model is in memory the page has no reason to talk to any server.
// lockNetwork() adds a Content-Security-Policy with connect-src 'none': from
// then on the browser itself refuses every fetch, XHR, WebSocket and beacon
// from this page, to any address, this site included.

const PROBE = './lock-probe.txt';

export function lockNetwork() {
  const meta = document.createElement('meta');
  meta.httpEquiv = 'Content-Security-Policy';
  meta.content = "connect-src 'none'";
  document.head.appendChild(meta);
}

/** True when a request to this very site is refused, i.e. the lock holds in this browser. */
export async function lockHolds() {
  try {
    await fetch(`${PROBE}?t=${Date.now()}`, { cache: 'no-store' });
    return false;
  } catch {
    return true;
  }
}
