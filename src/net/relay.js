// Online link between two browsers through a free public MQTT message relay (over a secure websocket).
// Direct browser-to-browser WebRTC often can't connect between two home networks without a paid relay
// (TURN) server; plain websockets to a public broker get through any normal network. Moves are tiny,
// so a relay adds no noticeable delay to a turn-based game.
//   const net = new RelayLink({ onOpen, onMessage, onClose, onError });
//   const code = await net.host();   // share the code with your friend
//   await net.join(code);            // the friend types it in
//   net.send({ ... });  net.close();
// Messages are plain JSON objects, delivered in order without duplicates (sequence numbers).
// Topics (per room code): <ROOT>/<code>/h  → the host;  <ROOT>/<code>/g/<guestId>  → that guest.
const ROOT = 'hexclash/r2';
// The code's first letter says which broker the host used, so both players meet on the same one.
const BROKERS = { E: 'wss://broker.emqx.io:8084/mqtt', H: 'wss://broker.hivemq.com:8884/mqtt' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I to misread
const LIB_PATHS = ['../../vendor/mqtt.esm.js', '../../node_modules/mqtt/dist/mqtt.esm.js']; // web build, dev server
const PING_EVERY = 4000, PARTNER_TIMEOUT = 16000, JOIN_TIMEOUT = 9000, CONNECT_TIMEOUT = 8000;

let lib = null;
async function loadLib() {
  if (lib) return lib;
  for (const p of LIB_PATHS) {
    try { const m = await import(new URL(p, import.meta.url).href); lib = m.default ?? m; return lib; } catch { /* next path */ }
  }
  throw new Error('Could not load the online-play library.');
}

const randomId = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const normalizeCode = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

export class RelayLink {
  constructor(handlers) {
    this.h = handlers;
    this.client = null;
    this.reset();
  }

  reset() {
    clearInterval(this.pinger);
    Object.assign(this, { role: null, code: null, id: randomId(8), partner: null, open: false, sendSeq: 0, recvSeq: 0, lastHeard: 0, pinger: null });
  }

  get connected() { return this.open; }

  async host() {
    const mqtt = await loadLib();
    let lastError;
    for (const b of Object.keys(BROKERS)) {
      try {
        await this.connect(mqtt, BROKERS[b]);
        this.role = 'host';
        this.code = b + randomId(4);
        await this.subscribe(this.topic('h'));
        return this.code;
      } catch (e) { lastError = e; this.endClient(); }
    }
    throw new Error(`Could not reach the online relay (${lastError?.message ?? 'no connection'}). Check your internet and try again.`);
  }

  async join(rawCode) {
    const code = normalizeCode(rawCode);
    const broker = BROKERS[code[0]];
    if (!broker || code.length !== 5) throw new Error('That code doesn\'t look right: it\'s 5 letters/numbers, like E7KQ2.');
    const mqtt = await loadLib();
    try { await this.connect(mqtt, broker); } catch (e) { this.endClient(); throw new Error(`Could not reach the online relay (${e.message}). Check your internet and try again.`); }
    Object.assign(this, { role: 'guest', code });
    await this.subscribe(this.topic('g', this.id));
    const answer = new Promise((resolve, reject) => {
      this.joinWait = { resolve, reject };
      setTimeout(() => reject(new Error('No game found with that code. Check it, and make sure your friend\'s page is open on the "Send your friend this code" screen.')), JOIN_TIMEOUT);
    });
    this.publish(this.topic('h'), { k: 'join', from: this.id });
    try { await answer; } finally { this.joinWait = null; }
    this.partner = 'host';
    this.becomeOpen();
  }

  topic(...parts) { return [ROOT, this.code, ...parts].join('/'); }

  connect(mqtt, url) {
    return new Promise((resolve, reject) => {
      const c = mqtt.connect(url, { clientId: `hexclash_${this.id}`, clean: true, keepalive: 20, reconnectPeriod: 2000, connectTimeout: CONNECT_TIMEOUT });
      this.client = c;
      const timer = setTimeout(() => reject(new Error('timed out')), CONNECT_TIMEOUT + 1000);
      c.once('connect', () => { clearTimeout(timer); resolve(); });
      c.on('error', e => { if (!this.open) { clearTimeout(timer); reject(e); } else this.h.onError?.(e); });
      c.on('message', (topic, payload) => { try { this.receive(JSON.parse(payload.toString())); } catch { /* not ours */ } });
    });
  }

  subscribe(topic) {
    return new Promise((resolve, reject) => this.client.subscribe(topic, { qos: 1 }, err => (err ? reject(err) : resolve())));
  }

  publish(topic, obj) { this.client?.publish(topic, JSON.stringify(obj), { qos: 1 }); }

  // where my messages go: the host writes to its guest's topic, the guest to the host's
  partnerTopic() { return this.role === 'host' ? this.topic('g', this.partner) : this.topic('h'); }

  receive(m) {
    if (this.role === 'host' && m.k === 'join') {
      if (this.partner && this.partner !== m.from) { this.publish(this.topic('g', m.from), { k: 'full' }); return; }
      if (!this.partner) { this.partner = m.from; this.becomeOpen(); }
      this.publish(this.topic('g', m.from), { k: 'welcome' });
      return;
    }
    if (this.role === 'guest' && this.joinWait) {
      if (m.k === 'welcome') this.joinWait.resolve();
      if (m.k === 'full') this.joinWait.reject(new Error('That game already has two players.'));
      return;
    }
    if (!this.open || (this.role === 'host' && m.from !== this.partner)) return;
    this.lastHeard = Date.now();
    if (m.k === 'bye') { this.lost(); return; }
    if (m.k === 'msg' && m.s > this.recvSeq) { this.recvSeq = m.s; this.h.onMessage?.(m.b); }
  }

  becomeOpen() {
    this.open = true;
    this.lastHeard = Date.now();
    this.pinger = setInterval(() => {
      this.publish(this.partnerTopic(), { k: 'ping', from: this.id });
      if (Date.now() - this.lastHeard > PARTNER_TIMEOUT) this.lost();
    }, PING_EVERY);
    this.h.onOpen?.();
  }

  send(body) {
    if (!this.open) return;
    this.publish(this.partnerTopic(), { k: 'msg', from: this.id, s: ++this.sendSeq, b: body });
  }

  // the friend went quiet or said goodbye
  lost() {
    if (!this.open) return;
    this.endClient();
    this.reset();
    this.h.onClose?.();
  }

  endClient() {
    try { this.client?.end(true); } catch { /* already closed */ }
    this.client = null;
  }

  // leaving on purpose: tell the friend, no onClose here
  close() {
    if (this.open) this.publish(this.partnerTopic(), { k: 'bye', from: this.id });
    const c = this.client;
    this.client = null;
    setTimeout(() => { try { c?.end(); } catch { /* already closed */ } }, 300); // let the goodbye go out
    this.reset();
  }
}
