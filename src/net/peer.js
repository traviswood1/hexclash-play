// Peer-to-peer link between two browsers (WebRTC via PeerJS). No game server: PeerJS's free public broker
// only introduces the two players, then messages go directly between them.
//   const net = new PeerLink({ onOpen, onMessage, onClose, onError });
//   const code = await net.host();   // share the code with your friend
//   await net.join(code);            // the friend types it in
//   net.send({ ... });  net.close();
// Messages are plain JSON-able objects, delivered reliably and in order.
const PREFIX = 'hexclash-v1-';                    // keeps our room codes apart from other PeerJS apps
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const LIB_PATHS = ['vendor/peerjs.min.js', 'node_modules/peerjs/dist/peerjs.min.js']; // web build, dev server

let libLoading = null;
function loadLib() {
  if (window.Peer) return Promise.resolve(window.Peer);
  libLoading ??= (async () => {
    for (const src of LIB_PATHS) {
      try {
        await new Promise((resolve, reject) => {
          const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
          document.head.append(s);
        });
        if (window.Peer) return window.Peer;
      } catch { /* try the next path */ }
    }
    libLoading = null;
    throw new Error('Could not load the online-play library.');
  })();
  return libLoading;
}

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const normalizeCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

export class PeerLink {
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
  }

  get connected() { return !!this.conn?.open; }

  // Opens a room; resolves with its code once the broker has registered it.
  async host() {
    const Peer = await loadLib();
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = randomCode();
      try {
        await this.openPeer(Peer, PREFIX + code);
        this.peer.on('connection', conn => {
          if (this.conn) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
          this.attach(conn);
        });
        return code;
      } catch (e) {
        this.destroyPeer();
        if (e.type !== 'unavailable-id') throw e; // code already taken: roll another
      }
    }
    throw new Error('Could not open a room. Try again.');
  }

  async join(code) {
    const Peer = await loadLib();
    await this.openPeer(Peer, undefined);
    const conn = this.peer.connect(PREFIX + normalizeCode(code), { reliable: true });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No game found with that code.')), 15000);
      conn.on('open', () => { clearTimeout(timer); resolve(); });
      this.peer.once('error', e => { clearTimeout(timer); reject(e.type === 'peer-unavailable' ? new Error('No game found with that code.') : e); });
    });
    this.attach(conn);
  }

  openPeer(Peer, id) {
    return new Promise((resolve, reject) => {
      this.peer = new Peer(id, { debug: 0 });
      this.peer.once('open', resolve);
      this.peer.once('error', reject);
      // after the room is open, broker errors (e.g. losing the broker) are reported but don't end a game in progress
      this.peer.on('error', e => { if (this.peer?.open) this.h.onError?.(e); });
    });
  }

  attach(conn) {
    this.conn = conn;
    const opened = () => this.h.onOpen?.();
    if (conn.open) opened(); else conn.on('open', opened);
    conn.on('data', msg => this.h.onMessage?.(msg));
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.h.onClose?.(); } });
    conn.on('error', e => this.h.onError?.(e));
  }

  send(msg) { if (this.conn?.open) this.conn.send(msg); }

  destroyPeer() { try { this.peer?.destroy(); } catch { /* already gone */ } this.peer = null; }

  close() {
    const conn = this.conn;
    this.conn = null; // a deliberate close doesn't fire onClose
    try { conn?.close(); } catch { /* already closed */ }
    this.destroyPeer();
  }
}
