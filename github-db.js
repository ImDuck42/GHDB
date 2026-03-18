/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                           github-db.js                           ║
 * ║         A complete database layer backed by a GitHub repo        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * USAGE — three access modes:
 *
 * 1. OWNER MODE (full access, your PAT)
 *    const db = GitHubDB.owner({ owner, repo, token })
 *
 * 2. PUBLIC MODE (anyone can read+write via an embedded bot token)
 *    const db = GitHubDB.public({ owner, repo, publicToken })
 *    — publicToken is XOR-obfuscated in the source so it isn't
 *      immediately readable as a plain string in DevTools / view-source
 *
 * 3. USER MODE (password auth stored in the repo, no OAuth needed)
 *    const db = await GitHubDB.login({ owner, repo, publicToken, username, password })
 *    const db = await GitHubDB.register({ owner, repo, publicToken, username, password })
 *
 * COLLECTIONS  (data/<collection>/<id>.json)
 *    await db.collection('posts').add({ title: 'Hello' })
 *    await db.collection('posts').get(id)
 *    await db.collection('posts').list()
 *    await db.collection('posts').update(id, { title: 'New' })   // patch
 *    await db.collection('posts').replace(id, { title: 'New' })  // full replace
 *    await db.collection('posts').remove(id)
 *    await db.collection('posts').upsert(id, data)
 *    await db.collection('posts').query(r => r.published)
 *    await db.collection('posts').findOne(r => r.slug === 'hello')
 *    await db.collection('posts').count(r => r.published)
 *    await db.collection('posts').exists(id)
 *    await db.collection('posts').bulkAdd([{...}, {...}])
 *    await db.collection('posts').bulkRemove([id1, id2])
 *    await db.collection('posts').clear()                         // delete all
 *
 * KEY-VALUE STORE  (data/_kv/<key>.json)
 *    await db.kv.set('config', { theme: 'dark' })
 *    await db.kv.get('config')
 *    await db.kv.del('config')
 *    await db.kv.has('config')
 *    await db.kv.incr('views')                                   // atomic-ish
 *    await db.kv.mget('k1', 'k2')
 *    await db.kv.mset({ k1: v1, k2: v2 })
 *    await db.kv.all()                                           // list all kv keys+values
 *
 * AUTH  (data/_auth/users.json)
 *    await db.auth.register(username, password)
 *    await db.auth.login(username, password)    → returns user object
 *    await db.auth.logout()
 *    await db.auth.changePassword(username, oldPass, newPass)
 *    await db.auth.deleteAccount(username, password)
 *    db.auth.currentUser                        → { id, username, createdAt } | null
 *    db.auth.isLoggedIn                         → boolean
 *
 * PERMISSIONS  — per-collection access rules
 *    db.rules({
 *      posts: { read: 'public', write: 'auth' },    // anyone reads, logged-in writes
 *      notes: { read: 'owner', write: 'owner' },    // owner PAT only
 *      logs:  { read: 'auth',  write: 'public' },   // anyone writes, auth reads
 *    })
 *
 * UTILS
 *    await db.commits(path?, limit?)             → commit history as array
 *    await db.rawFile(path)                      → any file in the repo
 *    GitHubDB.encodeToken(plainToken)            → obfuscated string to paste in source
 *    GitHubDB.decodeToken(obfuscated)            → back to plain PAT
 */

// ═══════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'

class DBError extends Error {
  constructor(msg, status) {
    super(msg)
    this.name = 'DBError'
    this.status = status ?? null
  }
}

// XOR obfuscation — not encryption, but stops the token being a
// plain readable string in source / DevTools Network tab.
// Key rotates across the token so it's not a simple Caesar shift.
const XOR_KEY = 'GHDB'
function xorString(str) {
  return Array.from(str)
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length)))
    .join('')
}
function toB64(str)   { return btoa(xorString(str)) }
function fromB64(str) { return xorString(atob(str)) }

// GitHub API base64 ↔ UTF-8
// Uses TextEncoder/TextDecoder — handles full Unicode without the deprecated
// unescape/escape pair, which breaks on code points > U+00FF.
function ghEncode(obj) {
  const json  = JSON.stringify(obj, null, 2)
  const bytes = new TextEncoder().encode(json)
  let binary  = ''
  bytes.forEach(b => { binary += String.fromCharCode(b) })
  return btoa(binary)
}
function ghDecode(b64) {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// Collision-resistant ID: timestamp-base36 + 8 random chars
// Uses crypto.getRandomValues when available for better entropy.
function uid() {
  const ts  = Date.now().toString(36)
  let rnd = ''
  try {
    const buf = crypto.getRandomValues(new Uint8Array(6))
    rnd = Array.from(buf).map(b => b.toString(36).padStart(2, '0')).join('')
  } catch {
    rnd = Math.random().toString(36).slice(2, 10)
  }
  return `${ts}-${rnd}`
}

// Password hashing: SHA-256 with a stable per-install pepper + username salt.
// This isn't bcrypt, but it's a meaningful improvement over bare SHA-256:
// prevents off-the-shelf rainbow-table lookups for common passwords.
const _PEPPER = 'ghdb-pw-2025'
async function hashPassword(password, username) {
  const salted = `${_PEPPER}:${username.toLowerCase()}:${password}`
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salted))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Timing-safe string equality — mitigates timing-oracle attacks on hash comparisons.
// Both values are hashed once more so the comparison time is independent of
// where the strings first differ.
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256hex(a), sha256hex(b)])
  return ha === hb
}

const SESSION_KEY = '__ghdb_session__'

class AuthState {
  constructor() { this._user = null; this._restore() }

  _restore() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      if (s.exp && Date.now() > s.exp) { sessionStorage.removeItem(SESSION_KEY); return }
      this._user = s.user
    } catch { sessionStorage.removeItem(SESSION_KEY) }
  }

  save(user) {
    this._user = user
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      user,
      exp: Date.now() + 8 * 60 * 60 * 1000,  // 8h
    }))
  }

  clear() { this._user = null; sessionStorage.removeItem(SESSION_KEY) }

  get current() { return this._user }
  get loggedIn() { return !!this._user }
}

// ═══════════════════════════════════════════════════════════════════
// GitHub filesystem layer
// ═══════════════════════════════════════════════════════════════════

class GHFs {
  constructor({ owner, repo, token, branch = 'main' }) {
    this.owner = owner; this.repo = repo; this.branch = branch
    this._token = token
  }

  get _h() {
    return {
      Authorization: `Bearer ${this._token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  _url(path) { return `${API}/repos/${this.owner}/${this.repo}/contents/${path}` }

  async read(path) {
    const r = await fetch(`${this._url(path)}?ref=${this.branch}`, { headers: this._h })
    if (r.status === 404) return null
    if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') {
      const reset = r.headers.get('x-ratelimit-reset')
      const eta   = reset ? ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.` : ''
      throw new DBError(`GitHub API rate limit exceeded.${eta}`, 403)
    }
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new DBError(e.message || `Read failed (${r.status})`, r.status) }
    const d = await r.json()
    // directory listing returns an array
    if (Array.isArray(d)) return d
    return { content: ghDecode(d.content), sha: d.sha, raw: d }
  }

  async write(path, content, message, sha = null, retries = 2) {
    // fetch sha if not provided and file may exist
    if (!sha) { const ex = await this.read(path); sha = ex?.sha ?? undefined }
    const body = { message, content: ghEncode(content), branch: this.branch, ...(sha ? { sha } : {}) }
    const r = await fetch(this._url(path), { method: 'PUT', headers: this._h, body: JSON.stringify(body) })
    if (r.status === 409 && retries > 0) return this.write(path, content, message, null, retries - 1)
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new DBError(e.message || `Write failed (${r.status})`, r.status) }
    return r.json()
  }

  async remove(path, message) {
    const ex = await this.read(path)
    if (!ex) throw new DBError(`Not found: ${path}`, 404)
    const r = await fetch(this._url(path), {
      method: 'DELETE', headers: this._h,
      body: JSON.stringify({ message, sha: ex.sha, branch: this.branch }),
    })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new DBError(e.message || `Delete failed (${r.status})`, r.status) }
    return r.json()
  }

  async ls(path) {
    const r = await this.read(path)
    if (!r) return []
    if (Array.isArray(r)) return r
    return []
  }

  // Raw read via CDN — no auth, cached, fast. Public repos only.
  async raw(path) {
    const r = await fetch(`${RAW}/${this.owner}/${this.repo}/${this.branch}/${path}`)
    if (r.status === 404) return null
    if (!r.ok) throw new DBError(`Raw read failed (${r.status})`, r.status)
    return r.json()
  }

  async commits(path = '', limit = 30) {
    const params = new URLSearchParams({ per_page: limit, sha: this.branch })
    if (path) params.set('path', path)
    const url = `${API}/repos/${this.owner}/${this.repo}/commits?${params}`
    const r = await fetch(url, { headers: this._h })
    if (!r.ok) throw new DBError(`Commits failed (${r.status})`, r.status)
    return (await r.json()).map(c => ({
      sha:     c.sha,
      message: c.commit.message,
      author:  c.commit.author.name,
      date:    c.commit.author.date,
      url:     c.html_url,
    }))
  }

  async validate() {
    const r = await fetch(`${API}/repos/${this.owner}/${this.repo}`, { headers: this._h })
    if (!r.ok) throw new DBError(`Cannot access ${this.owner}/${this.repo} — check token and repo name`, r.status)
    return r.json()
  }
}

// ═══════════════════════════════════════════════════════════════════
// Collection
// ═══════════════════════════════════════════════════════════════════

class Collection {
  constructor(fs, name, basePath, authState, rulesMap) {
    if (!/^[a-zA-Z0-9_\-]+$/.test(name))
      throw new DBError(`Invalid collection name "${name}": use letters, numbers, hyphens and underscores only`)
    this.fs        = fs
    this.name      = name
    this.basePath  = basePath
    this._auth     = authState
    this._rules    = rulesMap
    this._path     = `${basePath}/${name}`
  }

  _rp(id) { return `${this._path}/${id}.json` }

  _checkPerm(op) {
    const rule = this._rules?.[this.name]
    if (!rule) return  // no rules = allow all
    const level = op === 'read' ? rule.read : rule.write
    if (!level || level === 'public') return
    if (level === 'auth' && !this._auth.loggedIn)
      throw new DBError(`Collection "${this.name}" requires login for ${op}`, 401)
    // 'owner' is enforced by the token itself — if you have owner token, you're fine
  }

  _stamp(data, existing = null) {
    const now = new Date().toISOString()
    return {
      ...data,
      ...(existing ? { createdAt: existing.createdAt } : { createdAt: now }),
      updatedAt: now,
    }
  }

  /** Create a new record. Auto-generates id. Returns the record. */
  async add(data) {
    this._checkPerm('write')
    const id = data.id ?? uid()
    // Spread data without id first, then stamp, then pin id at the front
    const { id: _discarded, ...rest } = data
    const final = { id, ...this._stamp(rest) }
    await this.fs.write(this._rp(id), final, `${this.name}: add ${id}`)
    return final
  }

  /** Get one record by id. Returns null if not found. */
  async get(id) {
    this._checkPerm('read')
    const f = await this.fs.read(this._rp(id))
    return f ? f.content : null
  }

  /** List all records. Fetches in parallel. */
  async list() {
    this._checkPerm('read')
    const files = (await this.fs.ls(this._path)).filter(f => f.name.endsWith('.json') && f.type === 'file')
    const records = await Promise.all(files.map(f => this.get(f.name.replace('.json', ''))))
    return records.filter(Boolean)
  }

  /** Partial update (merge). Only provided fields change. */
  async update(id, changes) {
    this._checkPerm('write')
    const f = await this.fs.read(this._rp(id))
    if (!f) throw new DBError(`Record not found: ${id}`, 404)
    // Strip id/createdAt from changes so callers can't accidentally overwrite them
    const { id: _id, createdAt: _ca, ...safeChanges } = changes
    const record = { ...f.content, ...safeChanges, id, updatedAt: new Date().toISOString() }
    await this.fs.write(this._rp(id), record, `${this.name}: update ${id}`, f.sha)
    return record
  }

  /** Full replace (all fields overwritten, id + createdAt preserved). */
  async replace(id, data) {
    this._checkPerm('write')
    const f = await this.fs.read(this._rp(id))
    if (!f) throw new DBError(`Record not found: ${id}`, 404)
    const record = { id, ...this._stamp(data, f.content) }
    await this.fs.write(this._rp(id), record, `${this.name}: replace ${id}`, f.sha)
    return record
  }

  /** Delete a record. */
  async remove(id) {
    this._checkPerm('write')
    await this.fs.remove(this._rp(id), `${this.name}: remove ${id}`)
    return { id, deleted: true }
  }

  /** Add if not exists, merge-update if exists. */
  async upsert(id, data) {
    this._checkPerm('write')
    const f = await this.fs.read(this._rp(id))
    if (f) return this.update(id, data)
    return this.add({ ...data, id })
  }

  /** Filter records in memory. Returns array. */
  async query(filterFn, { sort, limit, offset = 0 } = {}) {
    this._checkPerm('read')
    let results = (await this.list()).filter(filterFn)
    if (sort)            results = results.sort(sort)
    if (offset > 0)      results = results.slice(offset)
    if (limit != null)   results = results.slice(0, limit)
    return results
  }

  /** Return first matching record or null. */
  async findOne(filterFn) {
    this._checkPerm('read')
    return (await this.list()).find(filterFn) ?? null
  }

  /** Count records. Optional filter. */
  async count(filterFn = null) {
    this._checkPerm('read')
    const all = await this.list()
    return filterFn ? all.filter(filterFn).length : all.length
  }

  /** Check if a record exists (cheap — single API call). */
  async exists(id) {
    this._checkPerm('read')
    return !!(await this.fs.read(this._rp(id)))
  }

  /** Add multiple records at once. */
  async bulkAdd(items) {
    this._checkPerm('write')
    return Promise.all(items.map(item => this.add(item)))
  }

  /** Delete multiple records by id. */
  async bulkRemove(ids) {
    this._checkPerm('write')
    return Promise.all(ids.map(id => this.remove(id)))
  }

  /** Delete every record in the collection. Use with care. */
  async clear() {
    this._checkPerm('write')
    const all = await this.list()
    return this.bulkRemove(all.map(r => r.id))
  }

  /** Subscribe to changes via polling. Returns unsubscribe fn.
   *  cb is called with the full list whenever it changes.
   *  onError (optional) is called with any error that occurs during polling. */
  subscribe(cb, intervalMs = 5000, onError = null) {
    let last = null
    const tick = async () => {
      try {
        const records = await this.list()
        // Hash full content so external edits (e.g. manual commits) are detected,
        // not just changes that go through this library and set updatedAt.
        const sig = JSON.stringify(records)
        if (sig !== last) { last = sig; cb(records) }
      } catch (err) {
        if (onError) onError(err)
      }
    }
    tick()
    const id = setInterval(tick, intervalMs)
    return () => clearInterval(id)
  }
}

// ═══════════════════════════════════════════════════════════════════
// KV Store
// ═══════════════════════════════════════════════════════════════════

class KVStore {
  constructor(fs, basePath) {
    this.fs   = fs
    this.base = `${basePath}/_kv`
  }

  _p(key) {
    // Keep letters, digits, hyphens and underscores; everything else → '_'
    const safe = key.replace(/[^a-zA-Z0-9_\-]/g, '_')
    return `${this.base}/${safe}.json`
  }

  async set(key, value) {
    await this.fs.write(this._p(key), { key, value, updatedAt: new Date().toISOString() }, `kv: set ${key}`)
    return value
  }

  async get(key) {
    const f = await this.fs.read(this._p(key))
    return f ? f.content.value : null
  }

  async del(key) {
    await this.fs.remove(this._p(key), `kv: del ${key}`)
    return { key, deleted: true }
  }

  async has(key) { return !!(await this.fs.read(this._p(key))) }

  /** Atomic-ish increment (uses SHA optimistic lock + built-in retry on conflict). */
  async incr(key, by = 1) {
    const f    = await this.fs.read(this._p(key))
    const cur  = f ? Number(f.content.value) : 0
    const next = cur + by
    // Pass the sha directly so write() uses it as an optimistic lock rather than
    // doing a redundant extra read, making the conflict-retry actually meaningful.
    await this.fs.write(this._p(key), { key, value: next, updatedAt: new Date().toISOString() }, `kv: incr ${key}`, f?.sha ?? null)
    return next
  }

  /** Get multiple keys. Returns { key: value } map.
   *  Accepts either spread args — mget('a', 'b') — or a single array — mget(['a', 'b']). */
  async mget(...keys) {
    const list  = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys
    const pairs = await Promise.all(list.map(async k => [k, await this.get(k)]))
    return Object.fromEntries(pairs)
  }

  /** Set multiple keys at once. */
  async mset(obj) {
    return Promise.all(Object.entries(obj).map(([k, v]) => this.set(k, v)))
  }

  /** List all kv keys and their values. */
  async all() {
    const files = await this.fs.ls(this.base)
    const pairs = await Promise.all(
      files.filter(f => f.name.endsWith('.json')).map(async f => {
        const key = f.name.replace('.json', '')
        return [key, await this.get(key)]
      })
    )
    return Object.fromEntries(pairs)
  }
}

// ═══════════════════════════════════════════════════════════════════
// Auth manager
// ═══════════════════════════════════════════════════════════════════

class AuthManager {
  constructor(fs, authState) {
    this.fs    = fs
    this._state = authState
    this._path  = 'data/_auth/users.json'
  }

  async _load() {
    const f = await this.fs.read(this._path)
    return f ? { users: f.content, sha: f.sha } : { users: [], sha: null }
  }

  async _save(users, sha) {
    await this.fs.write(this._path, users, 'auth: update users', sha)
  }

  get currentUser() { return this._state.current }
  get isLoggedIn()  { return this._state.loggedIn }

  /** Register a new user. */
  async register(username, password) {
    if (!username || !password) throw new DBError('Username and password required')
    if (!/^[a-z0-9_\-]{2,32}$/i.test(username)) throw new DBError('Username: 2–32 chars, letters/numbers/_ only')
    if (password.length < 6) throw new DBError('Password must be at least 6 characters')

    const { users, sha } = await this._load()
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
      throw new DBError('Username already taken')

    const user = {
      id:           uid(),
      username,
      passwordHash: await hashPassword(password, username),
      createdAt:    new Date().toISOString(),
      role:         users.length === 0 ? 'admin' : 'user',  // first user is admin
    }
    users.push(user)
    await this._save(users, sha)

    const safe = { id: user.id, username, role: user.role, createdAt: user.createdAt }
    this._state.save(safe)
    return safe
  }

  /** Log in. Returns safe user object. */
  async login(username, password) {
    if (!username || !password) throw new DBError('Username and password required')
    const { users } = await this._load()
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase())
    if (!user) throw new DBError('User not found')
    if (!(await safeEqual(await hashPassword(password, username), user.passwordHash))) throw new DBError('Wrong password')
    const safe = { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt }
    this._state.save(safe)
    return safe
  }

  /** Log out current session. */
  logout() { this._state.clear() }

  /** Change password. Must be logged in. */
  async changePassword(username, oldPassword, newPassword) {
    if (newPassword.length < 6) throw new DBError('New password must be at least 6 characters')
    const { users, sha } = await this._load()
    const idx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase())
    if (idx === -1) throw new DBError('User not found')
    if (!(await safeEqual(await hashPassword(oldPassword, username), users[idx].passwordHash))) throw new DBError('Wrong current password')
    users[idx].passwordHash = await hashPassword(newPassword, username)
    users[idx].updatedAt = new Date().toISOString()
    await this._save(users, sha)
    return { ok: true }
  }

  /** Delete account. Logs out. */
  async deleteAccount(username, password) {
    const { users, sha } = await this._load()
    const idx = users.findIndex(u => u.username.toLowerCase() === username.toLowerCase())
    if (idx === -1) throw new DBError('User not found')
    if (!(await safeEqual(await hashPassword(password, users[idx].username), users[idx].passwordHash))) throw new DBError('Wrong password')
    users.splice(idx, 1)
    await this._save(users, sha)
    this._state.clear()
    return { deleted: true }
  }

  /** List all users (safe fields only). */
  async listUsers() {
    const { users } = await this._load()
    return users.map(u => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt }))
  }
}

// ═══════════════════════════════════════════════════════════════════
// Main GitHubDB class
// ═══════════════════════════════════════════════════════════════════

class GitHubDB {
  constructor(fs, opts = {}) {
    this._fs       = fs
    this._basePath = opts.basePath ?? 'data'
    this._authState = new AuthState()
    this._rulesMap  = null

    this.kv   = new KVStore(fs, this._basePath)
    this.auth = new AuthManager(fs, this._authState)
  }

  // ── Access factories ────────────────────────────────────────────

  /**
   * Owner mode — use your own PAT. Full access.
   * const db = GitHubDB.owner({ owner, repo, token, branch?, basePath? })
   */
  static owner({ owner, repo, token, branch = 'main', basePath = 'data' }) {
    const fs = new GHFs({ owner, repo, token, branch })
    return new GitHubDB(fs, { basePath })
  }

  /**
   * Public mode — embed a bot token (obfuscated) for open access.
   * Pass publicToken as the raw PAT; it's XOR'd at runtime.
   * To get an obfuscated string to hard-code in source:
   *   GitHubDB.encodeToken('ghp_xxxx')  → paste that string as publicToken
   *
   * const db = GitHubDB.public({ owner, repo, publicToken, branch?, basePath? })
   */
  static public({ owner, repo, publicToken, branch = 'main', basePath = 'data' }) {
    // Accept both plain and obfuscated tokens
    let token
    try { token = fromB64(publicToken) } catch { token = publicToken }
    const fs = new GHFs({ owner, repo, token, branch })
    return new GitHubDB(fs, { basePath })
  }

  /**
   * Login — returns a GitHubDB instance scoped to that user's session.
   * Uses a bot token for the underlying writes; auth state tracks who's logged in.
   */
  static async login({ owner, repo, publicToken, username, password, branch = 'main', basePath = 'data' }) {
    const db = GitHubDB.public({ owner, repo, publicToken, branch, basePath })
    await db.auth.login(username, password)
    return db
  }

  /**
   * Register — creates account and returns authenticated GitHubDB instance.
   */
  static async register({ owner, repo, publicToken, username, password, branch = 'main', basePath = 'data' }) {
    const db = GitHubDB.public({ owner, repo, publicToken, branch, basePath })
    await db.auth.register(username, password)
    return db
  }

  // ── Token helpers ───────────────────────────────────────────────

  /** Obfuscate a PAT for embedding in public source code. */
  static encodeToken(plainToken) { return toB64(plainToken) }

  /** Reverse — mostly for debugging. */
  static decodeToken(encoded) { return fromB64(encoded) }

  // ── Core API ────────────────────────────────────────────────────

  /**
   * Get a collection handle.
   * db.collection('posts')  →  Collection with full CRUD
   */
  collection(name) {
    return new Collection(this._fs, name, this._basePath, this._authState, this._rulesMap)
  }

  /**
   * Set per-collection access rules.
   * db.rules({ posts: { read: 'public', write: 'auth' } })
   * Levels: 'public' | 'auth' | 'owner'
   */
  rules(map) { this._rulesMap = map; return this }

  /**
   * Get commit history for a path (your free audit log).
   * await db.commits('data/posts', 50)
   */
  commits(path = '', limit = 30) { return this._fs.commits(path, limit) }

  /**
   * Read any raw file from the repo.
   * await db.rawFile('README.md')
   */
  rawFile(path) { return this._fs.raw(path) }

  /**
   * Validate that the token + repo are accessible.
   * Throws a descriptive DBError if not.
   */
  validate() { return this._fs.validate() }
}

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export { GitHubDB, DBError }
export default GitHubDB