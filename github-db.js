/**
 * ╔══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╗
 * ║                                                             github-db.js                                                             ║
 * ║                                   A JSON / GitHub based database where every write is a git commit                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════╝
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * QUICK START
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * 1. OWNER MODE — your own PAT, full control
 *    const db = await GitHubDB.owner({ owner, repo, token })
 *
 * 2. PUBLIC MODE — embedded bot token, visitors can interact without their own PAT
 *    const db = await GitHubDB.public({ owner, repo, publicToken, branch, basePath, useCDN, enrollToken })
 *
 * 3. CDN MODE (recommended for public read-heavy apps — reads bypass the API rate limit)
 *    const db = await GitHubDB.public({ ..., useCDN: true })
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * PERMISSIONS  (default: admin-only for everything unless explicitly overridden)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    // Call db.permissions() after init to set access levels per collection or KV key.
 *    // Any collection or KV key not listed defaults to { read: 'admin', write: 'admin' }.
 *    // Permission levels: 'public' (anyone), 'auth' (logged-in users), 'admin' (admin role only — the first user is automatically admin)
 *    // Custom roles: any string or array of strings — e.g. 'moderator' or ['editor', 'moderator']
 *    // Admins always pass any permission check regardless of the required level.
 *
 *    db.permissions({
 *      posts:          { read: 'public',                             write: 'auth'                    }, // anyone reads, login to write
 *      settings:       { read: 'admin',                              write: 'admin'                   }, // admin only
 *      comments:       { read: 'auth',                               write: 'auth'                    }, // login required for both
 *      drafts:         { read: 'editor',                             write: 'editor'                  }, // single custom role
 *      reports:        { read: ['moderator', 'analyst', 'auditor'],  write: ['moderator', 'admin']    }, // multiple roles can read
 *      'posts.abc123': { read: 'admin',                              write: 'admin'                   }, // lock a specific record
 *      _kv:            { read: 'auth',                               write: 'admin'                   }, // all KV keys default
 *      '_kv.theme':    { read: 'public',                             write: ['moderator', 'designer'] }, // per-key override
 *    })
 *
 *    // Lookup priority per operation:
 *    //   collection.recordId  ->  collection  ->  default 'admin'
 *    //   _kv.keyName          ->  _kv         ->  default 'admin'
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * COLLECTIONS  (stored at `<basePath>/<collection>/<id>.json`)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    const posts = db.collection('posts')
 *
 *    await posts.add({ title: 'Hello' })                                                   // create
 *    await posts.get(id)                                                                   // fetch one -> record | null
 *    await posts.list()                                                                    // fetch all
 *    await posts.update(id, { title: 'New' })                                              // partial patch
 *    await posts.replace(id, { title: 'New' })                                             // full replace
 *    await posts.remove(id)                                                                // delete
 *    await posts.upsert(id, data)                                                          // create-or-patch
 *    await posts.query(record => record.published)                                         // filter in memory
 *    await posts.query(fn, { sort, limit, offset })                                        // with options
 *    await posts.findOne(record => record.slug === 'hello')                                // first match | null
 *    await posts.count()                                                                   // total count
 *    await posts.count(record => record.published)                                         // filtered count
 *    await posts.exists(id)                                                                // boolean
 *    await posts.bulkAdd([{ ... }, { ... }])                                               // add many
 *    await posts.bulkRemove([id1, id2])                                                    // remove many
 *    await posts.clear()                                                                   // delete all (irreversible)
 *    const stop = posts.subscribe(({ records, added, changed, removed }) => { ... }, 5000) // poll for changes
 *    stop()                                                                                // cancel subscription
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * SUBCOLLECTIONS  (nested collections inside a collection)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    // Nesting can go as deep as needed:
 *    const nest = db.collection('orgs', 'acme', 'teams', 'eng', 'members')
 *    await nest.add({ title: 'My first post' })
 *    await nest.list()
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * KEY-VALUE STORE  (stored at `<basePath>/_kv/<key>.json`)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    await db.kv.set('theme', 'dark')
 *    await db.kv.get('theme')                    // value | null
 *    await db.kv.delete('theme')
 *    await db.kv.has('theme')                    // boolean
 *    await db.kv.increment('views')              // atomic-ish counter
 *    await db.kv.increment('score', 5)           // increment by N
 *    await db.kv.getMany('key1', 'key2')         // { key1: v1, key2: v2 }
 *    await db.kv.getMany(['key1', 'key2'])       // array form also accepted
 *    await db.kv.setMany({ key1: v1, key2: v2 })
 *    await db.kv.getAll()                        // { key: value } for all KV entries
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * AUTH  (stored at `<basePath>/_auth/<username>.json` per user)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    await db.auth.register(username, password)               // -> safe user object { id, username, roles, createdAt }
 *    await db.auth.login(username, password)                  // -> safe user object
 *    await db.auth.verifySession()                            // -> boolean
 *    await db.auth.changePassword(username, oldPass, newPass)
 *    await db.auth.deleteAccount(username, password)
 *    await db.auth.listUsers()                                // safe fields only
 *    await db.auth.setRoles(username, roles)                  // admin only — e.g. 'moderator' or ['editor', 'moderator']
 *    db.auth.currentUser                                      // { id, username, roles, createdAt } | null
 *    db.auth.isLoggedIn                                       // boolean
 *    db.auth.logout()
 *
 *    // Roles: first registered user gets ['admin']. All others default to ['user'].
 *    // Users can have multiple roles — e.g. ['editor', 'moderator']
 *    // Admins always pass any permission check regardless of required level.
 *    // 'public' and 'auth' are reserved and cannot be used as a role.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * HASHING ALGORITHM  (PBKDF2)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    // Hash a password or PAT for safe storage
 *    const hash = await GitHubDB.hashSecret('my-password', 'optional-salt')
 *
 *    // Verify a plaintext value against a stored hash
 *    const ok = await GitHubDB.verifySecret('my-password', hash, 'optional-salt')
 *
 *    // PBKDF2 with 200,000 SHA-256 iterations.
 *    // Even with full source code, reversing is computationally expensive.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * TOKEN ENCODING  (obfuscate your PAT before embedding in client-side code)
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    const encoded = GitHubDB.encodeToken('ghp_myRealToken')                           // run once, paste result into your source
 *    // Pass the encoded string as publicToken — the library decodes it automatically.
 *    // Note: obfuscation only deters casual scraping.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 * UTILITIES
 * ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *    await db.getCommitHistory(path?, limit?) // git audit log
 *    await db.validateConnection()            // throws if token/repo unreachable
 *    GitHubDB.encodeToken(plainToken)         // obfuscate PAT for embedding
 */

'use strict'

// ─── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API_BASE     = 'https://api.github.com'
const JSDELIVR_RAW_BASE   = 'https://cdn.jsdelivr.net/gh'
const GITHUB_API_VERSION  = '2022-11-28'

const SESSION_STORAGE_KEY = '__githubdb_session__'
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000 // 8 hours
const MIN_PASSWORD_LENGTH = 8
const MAX_WRITE_RETRIES   = 5

// changing anything here invalidates all registered users
const PASSWORD_PEPPER     = 'ghdb-pepper-4269'
const PBKDF2_ITERATIONS   = 200_000
const ENCODE_PREFIX       = 'ghdb_enc_'
const TOKEN_XOR_KEY       = 'GHDB'

// Internal KV keys written by the auth system — excluded from kv.getAll().
const INTERNAL_KV_KEYS    = new Set(['admin-exists', 'public'])

// ─── Custom error class ───────────────────────────────────────────────────────

/** All library errors are instances of DatabaseError. */
class DatabaseError extends Error {
  /**
   * @param {string} message        Human-readable description of the error.
   * @param {number} [httpStatus=0] The HTTP status code that triggered this.
   */
  constructor(message, httpStatus = 0) {
    super(message)
    this.name       = 'DatabaseError'
    this.httpStatus = httpStatus
  }
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validates IDs and keys — prevents path traversal.  
 * Only letters, numbers, hyphens, and underscores are allowed.
 */
function assertValidId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
    throw new DatabaseError(`Invalid ID or key format: "${id}". Use letters, numbers, hyphens, and underscores only.`)
  }
}

// ─── Concurrency helpers ──────────────────────────────────────────────────────

/** Run async tasks over `items` with at most `limit` in flight at once. */
async function runWithConcurrency(items, taskFn, limit = 10) {
  const results   = []
  const executing = new Set()
  for (const item of items) {
    const promise = Promise.resolve().then(() => taskFn(item))
    results.push(promise)
    executing.add(promise)
    // Remove from the tracking set when settled (either way).
    const cleanup = () => executing.delete(promise)
    promise.then(cleanup, cleanup)
    if (executing.size >= limit) { await Promise.race(executing) }
  }
  return Promise.all(results)
}

/** Retry an async operation on HTTP 409 conflicts (SHA races), up to maxRetries times. */
async function retryOnConflict(operation, maxRetries = MAX_WRITE_RETRIES) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (error.httpStatus === 409 && attempt < maxRetries) { continue }
      throw error
    }
  }
}

// ─── Token obfuscation (XOR + base64) ────────────────────────────────────────

/** XOR-rotate each character against TOKEN_XOR_KEY. */
function xorRotate(text) {
  return Array.from(text)
    .map((char, i) => String.fromCharCode(char.charCodeAt(0) ^ TOKEN_XOR_KEY.charCodeAt(i % TOKEN_XOR_KEY.length)))
    .join('')
}

/** Obfuscate a plain token to a base64+XOR string for safe embedding. */
function encodeToken(plainToken) {
  return ENCODE_PREFIX + encodeBase64(xorRotate(plainToken))
}

// ─── Base64 <-> string helpers ────────────────────────────────────────────────

/**
 * Encode a UTF-8 string to base64.  
 * Works in both Node (Buffer) and browser (btoa).
 */
function encodeBase64(string) {
  if (typeof Buffer !== 'undefined') { return Buffer.from(string, 'utf-8').toString('base64') }
  const bytes  = new TextEncoder().encode(string)
  const chunks = []
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192)))
  }
  return btoa(chunks.join(''))
}

/**
 * Decode a base64 string to UTF-8.  
 * Works in both Node (Buffer) and browser (atob).
 */
function decodeBase64(base64) {
  if (typeof Buffer !== 'undefined') { return Buffer.from(base64, 'base64').toString('utf-8') }
  const binaryString = atob(base64.replace(/\n/g, ''))
  const bytes        = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) { bytes[i] = binaryString.charCodeAt(i) }
  return new TextDecoder().decode(bytes)
}

/** Serialize a value to base64 JSON for the GitHub Contents API. */
const encodeContent = value => encodeBase64(JSON.stringify(value, null, 2))

/** Deserialize a base64 string returned by the GitHub Contents API. */
const decodeContent = base64 => JSON.parse(decodeBase64(base64))

// ─── ID generation ────────────────────────────────────────────────────────────

/** Generate a collision-resistant record ID: `<timestamp-base36>-<random-base36>`. */
function generateId() {
  const timestamp  = Date.now().toString(36)
  let   randomPart = ''
  try {
    randomPart = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(byte => byte.toString(36).padStart(2, '0')).join('')
  } catch {
    randomPart = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36).slice(0, 12)
  }
  return `${timestamp}-${randomPart}`
}

// ─── Cryptographic helpers (PBKDF2) ──────────────────────────────────────────

/** Internal PBKDF2 driver — returns a hex-encoded derived key. */
async function pbkdf2(secret, context, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret + PASSWORD_PEPPER + context),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    256
  )
  return Array.from(new Uint8Array(bits)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Hash a secret using PBKDF2-SHA256.  
 * Output format: `<hex-salt>:<hex-derived-key>`.
 * @param {string} secret
 * @param {string} [context=''] Extra binding context (e.g. username).
 * @returns {Promise<string>}
 */
async function hashSecret(secret, context = '') {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const saltHex   = Array.from(saltBytes).map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${saltHex}:${await pbkdf2(secret, context, saltBytes)}`
}

/**
 * Verify a plaintext secret against a hash produced by {@link hashSecret}.
 * @param {string} secret
 * @param {string} storedHash   Value returned by `hashSecret`.
 * @param {string} [context=''] Must match the context used during hashing.
 * @returns {Promise<boolean>}
 */
async function verifySecret(secret, storedHash, context = '') {
  const [saltHex, expected] = storedHash.split(':')
  if (!saltHex || !expected) { return false }
  const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(pair => parseInt(pair, 16)))
  const candidate = await pbkdf2(secret, context, saltBytes)
  // Constant-time comparison to prevent timing attacks.
  if (candidate.length !== expected.length) { return false }
  let bitDiff = 0
  for (let i = 0; i < candidate.length; i++) {
    bitDiff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return bitDiff === 0
}

// ─── Session state ────────────────────────────────────────────────────────────

/**
 * Manages in-memory and sessionStorage login state.  
 * Session expires after SESSION_LIFETIME_MS (8 hours).
 */
class SessionState {
  constructor() {
    this.activeUser = null
    this.store      = typeof globalThis !== 'undefined' && globalThis.sessionStorage
      ? globalThis.sessionStorage
      : new Map()
    this.restoreSession()
  }

  storageGet(key) {
    try {
      return typeof this.store.getItem === 'function'
        ? this.store.getItem(key)
        : (this.store.get(key) ?? null)
    } catch { return null }
  }

  storageSet(key, value) {
    try {
      if (typeof this.store.setItem === 'function') { this.store.setItem(key, value) }
      else { this.store.set(key, value) }
    } catch {}
  }

  storageDelete(key) {
    try {
      if (typeof this.store.removeItem === 'function') { this.store.removeItem(key) }
      else { this.store.delete(key) }
    } catch {}
  }

  restoreSession() {
    try {
      const raw = this.storageGet(SESSION_STORAGE_KEY)
      if (!raw) { return }
      const session = JSON.parse(raw)
      if (session.expiresAt && Date.now() > session.expiresAt) {
        this.storageDelete(SESSION_STORAGE_KEY)
        return
      }
      this.activeUser = session.user
    } catch {
      this.storageDelete(SESSION_STORAGE_KEY)
    }
  }

  /**
   * Persist a user object to session storage and memory.
   * @param {{ id: string, username: string, roles: string[], createdAt: string }} user
   */
  persistUser(user) {
    this.activeUser = user
    this.storageSet(SESSION_STORAGE_KEY, JSON.stringify({ user, expiresAt: Date.now() + SESSION_LIFETIME_MS }))
  }

  /** Remove all session data. */
  clearSession() {
    this.activeUser = null
    this.storageDelete(SESSION_STORAGE_KEY)
  }

  /** The currently logged-in user, or null. */
  get currentUser() { return this.activeUser }

  /** True if a user is currently logged in. */
  get isLoggedIn()  { return !!this.activeUser }
}

// ─── GitHub filesystem layer ──────────────────────────────────────────────────

/** Low-level wrapper around the GitHub Contents API. */
class GitHubFilesystem {
  /**
   * @param {object} config
   * @param {string} config.owner
   * @param {string} config.repo
   * @param {string} config.token           Personal Access Token with repo scope.
   * @param {string} [config.branch='main']
   */
  constructor({ owner, repo, token, branch = 'main' }) {
    this.owner     = owner
    this.repo      = repo
    this.branch    = branch
    this.token     = token
    /** ETag cache for directory listings: path -> { etag, data } */
    this.etagCache = new Map()
  }

  get authHeaders() {
    return {
      Authorization:          `Bearer ${this.token}`,
      Accept:                 'application/vnd.github+json',
      'Content-Type':         'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    }
  }

  contentsUrl(path) {
    return `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/contents/${path}`
  }

  async throwApiError(response, fallbackMessage) {
    const body = await response.json().catch(() => ({}))
    throw new DatabaseError(body.message || fallbackMessage, response.status)
  }

  throwRateLimit(response) {
    const reset = response.headers.get('x-ratelimit-reset')
    const when  = reset ? ` Resets at ${new Date(Number(reset) * 1000).toISOString()}.` : ''
    throw new DatabaseError(`GitHub API rate limit exceeded.${when}`, 429)
  }

  /** Read any JSON file via the jsDelivr CDN. Returns null for 404. */
  async readCDNFile(path) {
    const url      = `${JSDELIVR_RAW_BASE}/${this.owner}/${this.repo}@${this.branch}/${path}`
    const response = await fetch(url)
    if (response.status === 404) { return null }
    if (!response.ok) { throw new DatabaseError(`CDN read failed (${response.status})`, response.status) }
    return response.json()
  }

  /**
   * Read a file from the repo.  
   * Returns `null` for 404, or `{ content, sha }` for an existing file.
   */
  async readFile(path) {
    const response = await fetch(`${this.contentsUrl(path)}?ref=${this.branch}`, { headers: this.authHeaders })
    if (response.status === 404) { return null }
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      this.throwRateLimit(response)
    }
    if (!response.ok) { await this.throwApiError(response, `Read failed (${response.status})`) }
    const data = await response.json()
    // The Contents API returns an array when the path is a directory.
    if (Array.isArray(data)) { return null }
    return { content: decodeContent(data.content), sha: data.sha }
  }

  /** Write (create or update) a JSON file in the repo. */
  async writeFile(path, content, commitMessage, fileSha) {
    const body = { message: commitMessage, content: encodeContent(content), branch: this.branch }
    if (fileSha) { body.sha = fileSha }
    const response = await fetch(this.contentsUrl(path), {
      method: 'PUT',
      headers: this.authHeaders,
      body: JSON.stringify(body),
    })
    if (!response.ok) { await this.throwApiError(response, `Write failed (${response.status})`) }
    return response.json()
  }

  /**
   * Delete a file from the repo.  
   * Returns `false` if the file did not exist.
   */
  async deleteFile(path, commitMessage) {
    const existing = await this.readFile(path)
    if (!existing) { return false }
    const response = await fetch(this.contentsUrl(path), {
      method: 'DELETE',
      headers: this.authHeaders,
      body: JSON.stringify({ message: commitMessage, sha: existing.sha, branch: this.branch }),
    })
    if (!response.ok) { await this.throwApiError(response, `Delete failed (${response.status})`) }
    return true
  }

  /**
   * List direct children of a directory.  
   * Uses ETags to avoid redundant API calls.  
   * Returns an empty array if the directory does not exist.
   */
  async listDirectory(dirPath) {
    const url            = `${this.contentsUrl(dirPath)}?ref=${this.branch}`
    const cached         = this.etagCache.get(dirPath)
    const requestHeaders = { ...this.authHeaders }
    if (cached?.etag) { requestHeaders['If-None-Match'] = cached.etag }

    const response = await fetch(url, { headers: requestHeaders })

    if (response.status === 304) { return cached.data }
    if (response.status === 404) { return [] }
    if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
      this.throwRateLimit(response)
    }
    if (!response.ok) { await this.throwApiError(response, `List failed (${response.status})`) }

    const data = await response.json()
    if (!Array.isArray(data)) { return [] }

    const etag = response.headers.get('etag')
    if (etag) { this.etagCache.set(dirPath, { etag, data }) }
    return data
  }

  /**
   * Fetch the git commit history for a path.
   * @param   {string} [path='']
   * @param   {number} [limit=30]
   * @returns {Promise<Array<{ sha, message, author, date, url }>>}
   */
  async getCommitHistory(path = '', limit = 30) {
    const params = new URLSearchParams({ per_page: limit.toString(), sha: this.branch })
    if (path) { params.set('path', path) }
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}/commits?${params}`,
      { headers: this.authHeaders }
    )
    if (!response.ok) { throw new DatabaseError(`Could not fetch commits (${response.status})`, response.status) }
    return (await response.json()).map(commit => ({
      sha:     commit.sha,
      message: commit.commit.message,
      author:  commit.commit.author.name,
      date:    commit.commit.author.date,
      url:     commit.html_url,
    }))
  }

  /**
   * Verify that the token has access to the repository.
   * @returns {Promise<object>} GitHub repo metadata.
   */
  async validateConnection() {
    const response = await fetch(
      `${GITHUB_API_BASE}/repos/${this.owner}/${this.repo}`,
      { headers: this.authHeaders }
    )
    if (!response.ok) {
      throw new DatabaseError(
        `Cannot access ${this.owner}/${this.repo} — check your token and repo name`,
        response.status
      )
    }
    return response.json()
  }
}

// ─── Permission helpers ───────────────────────────────────────────────────────

/**
 * Returns true if `userRoles` satisfies `requiredLevel`.  
 * Supported levels: 'public', 'auth', 'admin', or any custom role string / array of strings.  
 */
function hasRequiredRole(requiredLevel, userRoles) {
  if (userRoles.includes('admin')) { return true }
  if (requiredLevel === 'auth')    { return userRoles.length > 0 }
  const required = Array.isArray(requiredLevel) ? requiredLevel : [requiredLevel]
  return required.some(role => userRoles.includes(role))
}

/**
 * Shared permission gate used by Collection and KeyValueStore.
 * @param {string}       subject   Human-readable subject name for error messages.
 * @param {string}       operation 'read' or 'write'.
 * @param {object|null}  rule      The matched `{ read, write }` rule, or null.
 * @param {SessionState} session
 */
function enforcePermission(subject, operation, rule, session) {
  const requiredLevel = operation === 'read' ? (rule?.read ?? 'admin') : (rule?.write ?? 'admin')
  // An empty-array requiredLevel or 'public' means anyone may proceed.
  if (!requiredLevel || requiredLevel === 'public' || (Array.isArray(requiredLevel) && !requiredLevel.length)) { return }
  if (!session.isLoggedIn) {
    throw new DatabaseError(`${subject} requires a logged-in user for ${operation} operations`, 401)
  }
  const userRoles = session.currentUser?.roles ?? []
  if (!hasRequiredRole(requiredLevel, userRoles)) {
    const required = Array.isArray(requiredLevel) ? requiredLevel.join(' or ') : requiredLevel
    throw new DatabaseError(`${subject} requires "${required}" role for ${operation} operations`, 403)
  }
}

// ─── Collection ───────────────────────────────────────────────────────────────

/**
 * A named collection of JSON records.  
 * Each record is stored as `<collectionPath>/<id>.json`.
 *
 * Obtain via `db.collection('name')`.
 */
class Collection {
  /**
   * @param {GitHubFilesystem}        filesystem
   * @param {string}                  collectionPath Full path within the repo (e.g. `data/posts`).
   * @param {string}                  collectionName Leaf collection name, used in permission lookups.
   * @param {SessionState}            sessionState
   * @param {function(): object|null} getPermissions Returns the current permissions map.
   * @param {boolean}                 [useCDN=false]
   */
  constructor(filesystem, collectionPath, collectionName, sessionState, getPermissions, useCDN = false) {
    this.filesystem     = filesystem
    this.name           = collectionName
    this.collectionPath = collectionPath
    this.session        = sessionState
    this.getPermissions = typeof getPermissions === 'function' ? getPermissions : () => getPermissions
    this.useCDN         = useCDN
  }

  /** Returns the full file path for a given record ID. */
  filePath(id) {
    assertValidId(id)
    return `${this.collectionPath}/${id}.json`
  }

  /**
   * Check that the current session has the given permission on this collection.  
   * Pass a `recordId` to also consider per-record permission overrides.
   */
  checkPermission(operation, recordId = null) {
    const perms = this.getPermissions()
    const rule  = (recordId ? perms?.[`${this.name}.${recordId}`] : null) ?? perms?.[this.name]
    const label = `Collection "${this.name}"${recordId ? ` record "${recordId}"` : ''}`
    enforcePermission(label, operation, rule, this.session)
  }

  /**
   * Attach `createdAt` and `updatedAt` timestamps to `data`.  
   * Preserves `createdAt` from `existing` when updating.
   */
  withTimestamps(data, existing = null) {
    const now = new Date().toISOString()
    return { ...data, createdAt: existing ? existing.createdAt : now, updatedAt: now }
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  /**
   * Create a new record. `id`, `createdAt`, and `updatedAt` are added automatically.  
   * Supply `data.id` to use a specific ID; otherwise one is generated.
   * @param   {object} data
   * @returns {Promise<object>}
   */
  async add(data) {
    this.checkPermission('write')
    const id = data.id ?? generateId()
    assertValidId(id)
    const copy = { ...data }
    delete copy.id
    const record = { id, ...this.withTimestamps(copy) }
    await this.filesystem.writeFile(this.filePath(id), record, `${this.name}: add ${id}`)
    return record
  }

  /**
   * Fetch a single record by ID. Returns `null` if not found.
   * @param   {string} id
   * @returns {Promise<object|null>}
   */
  async get(id) {
    this.checkPermission('read', id)
    if (this.useCDN) { return this.filesystem.readCDNFile(this.filePath(id)) }
    const file = await this.filesystem.readFile(this.filePath(id))
    return file ? file.content : null
  }

  /**
   * Fetch all records in the collection.
   * @returns {Promise<object[]>}
   */
  async list() {
    this.checkPermission('read')
    const entries = (await this.filesystem.listDirectory(this.collectionPath))
      .filter(entry => entry.name.endsWith('.json') && entry.type === 'file')
    const records = await runWithConcurrency(entries, async entry => {
      if (this.useCDN) { return this.filesystem.readCDNFile(`${this.collectionPath}/${entry.name}`) }
      const file = await this.filesystem.readFile(`${this.collectionPath}/${entry.name}`)
      return file ? file.content : null
    }, 10)
    return records.filter(Boolean)
  }

  /**
   * Partially update a record — only the provided fields are changed.  
   * `id` and `createdAt` in `changes` are ignored.
   * @param   {string} id
   * @param   {object} changes
   * @returns {Promise<object>}
   */
  async update(id, changes) {
    this.checkPermission('write', id)
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new DatabaseError('Changes must be a plain object', 400)
    }
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.filePath(id))
      if (!file) { throw new DatabaseError(`Record not found: ${id}`, 404) }
      const safeChanges = { ...changes }
      delete safeChanges.id
      delete safeChanges.createdAt
      const updated = { ...file.content, ...safeChanges, id, updatedAt: new Date().toISOString() }
      await this.filesystem.writeFile(this.filePath(id), updated, `${this.name}: update ${id}`, file.sha)
      return updated
    })
  }

  /**
   * Fully replace a record — all fields are overwritten.  
   * `id` and `createdAt` are preserved regardless of what `data` contains.
   * @param   {string} id
   * @param   {object} data
   * @returns {Promise<object>}
   */
  async replace(id, data) {
    this.checkPermission('write', id)
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.filePath(id))
      if (!file) { throw new DatabaseError(`Record not found: ${id}`, 404) }
      const record = { id, ...this.withTimestamps(data, file.content) }
      await this.filesystem.writeFile(this.filePath(id), record, `${this.name}: replace ${id}`, file.sha)
      return record
    })
  }

  /**
   * Delete a record by ID.
   * @param   {string} id
   * @returns {Promise<{ id: string, deleted: boolean }>}
   */
  async remove(id) {
    this.checkPermission('write', id)
    const deleted = await this.filesystem.deleteFile(this.filePath(id), `${this.name}: remove ${id}`)
    return { id, deleted }
  }

  /**
   * Update the record if it exists; create it with the given `id` if not.
   * @param   {string} id
   * @param   {object} data
   * @returns {Promise<object>}
   */
  async upsert(id, data) {
    this.checkPermission('write', id)
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.filePath(id))
      if (file) {
        const safeChanges = { ...data }
        delete safeChanges.id
        delete safeChanges.createdAt
        const updated = { ...file.content, ...safeChanges, id, updatedAt: new Date().toISOString() }
        await this.filesystem.writeFile(this.filePath(id), updated, `${this.name}: upsert ${id}`, file.sha)
        return updated
      }
      const copy = { ...data }
      delete copy.id
      const record = { id, ...this.withTimestamps(copy) }
      await this.filesystem.writeFile(this.filePath(id), record, `${this.name}: upsert (create) ${id}`)
      return record
    })
  }

  // ── Query helpers ─────────────────────────────────────────────────

  /**
   * Filter all records in memory using a predicate function.
   * @param   {function(object): boolean}  filterFn
   * @param   {{ sort?, limit?, offset? }} [options]
   * @returns {Promise<object[]>}
   */
  async query(filterFn, { sort, limit, offset = 0 } = {}) {
    let results = (await this.list()).filter(filterFn)
    if (sort)                                 { results = results.sort(sort) }
    if (offset)                               { results = results.slice(offset) }
    if (Number.isInteger(limit) && limit > 0) { results = results.slice(0, limit) }
    return results
  }

  /**
   * Return the first record matching the predicate, or `null`.
   * @param   {function(object): boolean} filterFn
   * @returns {Promise<object|null>}
   */
  async findOne(filterFn) {
    return (await this.list()).find(filterFn) ?? null
  }

  /**
   * Count records. If `filterFn` is provided, only matching records are counted.
   * @param   {function(object): boolean} [filterFn]
   * @returns {Promise<number>}
   */
  async count(filterFn = null) {
    const allRecords = await this.list()
    return filterFn ? allRecords.filter(filterFn).length : allRecords.length
  }

  /**
   * Check whether a record with the given ID exists.
   * @param   {string} id
   * @returns {Promise<boolean>}
   */
  async exists(id) {
    this.checkPermission('read', id)
    return !!(await this.filesystem.readFile(this.filePath(id)))
  }

  // ── Bulk operations ───────────────────────────────────────────────

  /**
   * Add multiple records in parallel.
   * @param   {object[]} items
   * @returns {Promise<object[]>}
   */
  async bulkAdd(items) {
    this.checkPermission('write')
    return runWithConcurrency(items, async item => {
      const id = item.id ?? generateId()
      assertValidId(id)
      const copy = { ...item }
      delete copy.id
      const record = { id, ...this.withTimestamps(copy) }
      return this.filesystem.writeFile(this.filePath(id), record, `${this.name}: add ${id}`)
        .then(() => record)
    }, 10)
  }

  /**
   * Delete multiple records by ID in parallel.
   * @param   {string[]} ids
   * @returns {Promise<Array<{ id: string, deleted: boolean }>>}
   */
  async bulkRemove(ids) {
    this.checkPermission('write')
    return runWithConcurrency(ids, async id => {
      const deleted = await this.filesystem.deleteFile(this.filePath(id), `${this.name}: remove ${id}`)
      return { id, deleted }
    }, 10)
  }

  /**
   * Delete every record in the collection. Irreversible.
   * @returns {Promise<Array<{ id: string, deleted: boolean }>>}
   */
  async clear() {
    this.checkPermission('write')
    const allRecords = await this.list()
    return runWithConcurrency(allRecords.map(r => r.id), async id => {
      const deleted = await this.filesystem.deleteFile(this.filePath(id), `${this.name}: remove ${id}`)
      return { id, deleted }
    }, 10)
  }

  // ── Real-time polling ─────────────────────────────────────────────

  /**
   * Poll the collection for changes and invoke `callback` with a diff when data changes.
   * The callback is invoked immediately on the first successful poll and whenever a change is detected.
   *
   * @param   {function({ records, added, changed, removed }): void} callback  
   *   - `records`  — full current record array  
   *   - `added`    — records that are new this tick  
   *   - `changed`  — records that existed but were modified  
   *   - `removed`  — IDs of records that were deleted
   * @param   {number}                [intervalMs=5000] Polling interval in milliseconds.
   * @param   {function(Error): void} [onError]         Called on fetch errors (polling continues).
   * @returns {function(): void}                        Call to stop polling.
   *
   * @example
   * const stop = db.collection('messages').subscribe(({ records, added, removed }) => {
   *   console.log('current:', records)
   *   console.log('new:',     added)
   *   console.log('deleted:', removed)
   * })
   * stop() // cancel
   */
  subscribe(callback, intervalMs = 5000, onError = null) {
    const knownShas   = new Map() // id -> sha from last successful poll
    const recordCache = new Map() // id -> record object
    let   isPolling   = false
    let   initialized = false

    const poll = async () => {
      if (isPolling) { return }
      isPolling = true
      try {
        const dirEntries  = await this.filesystem.listDirectory(this.collectionPath)
        const entries     = dirEntries.filter(e => e.name.endsWith('.json') && e.type === 'file')
        const currentShas = new Map(entries.map(e => [e.name.replace(/\.json$/, ''), e.sha]))

        const toFetch = []
        for (const [id, sha] of currentShas) {
          if (knownShas.get(id) !== sha) { toFetch.push(id) }
        }
        const deletedIds = [...knownShas.keys()].filter(id => !currentShas.has(id))

        const hasChanges = toFetch.length > 0 || deletedIds.length > 0 || !initialized

        if (hasChanges) {
          const added   = []
          const changed = []

          if (toFetch.length > 0) {
            const fetched = await runWithConcurrency(toFetch, id => this.get(id), 10)
            fetched.forEach((record, index) => {
              if (!record) { return }
              const id = toFetch[index]
              if (!knownShas.has(id)) { added.push(record) }
              else                    { changed.push(record) }
              recordCache.set(id, record)
            })
          }

          const removedIds = deletedIds.filter(id => recordCache.has(id))
          removedIds.forEach(id => recordCache.delete(id))

          knownShas.clear()
          currentShas.forEach((sha, id) => knownShas.set(id, sha))

          callback({ records: Array.from(recordCache.values()), added, changed, removed: removedIds })
        }
      } catch (error) {
        if (onError) { onError(error) }
      } finally {
        initialized = true
        isPolling   = false
      }
    }

    poll()
    const intervalId = setInterval(poll, intervalMs)
    return () => clearInterval(intervalId)
  }
}

// ─── Key-Value Store ──────────────────────────────────────────────────────────

/**
 * A simple key-value store backed by files at `<basePath>/_kv/<key>.json`.  
 * Access via `db.kv`.
 */
class KeyValueStore {
  /**
   * @param {GitHubFilesystem}           filesystem
   * @param {string}                     basePath
   * @param {boolean}                    [useCDN=false]
   * @param {SessionState|null}          [session=null]
   * @param {function(): object|null}    [getPermissions=null]
   */
  constructor(filesystem, basePath, useCDN = false, session = null, getPermissions = null) {
    this.filesystem     = filesystem
    this.useCDN         = useCDN
    this.kvPath         = `${basePath}/_kv`
    this.session        = session
    this.getPermissions = getPermissions
  }

  filePath(key) {
    assertValidId(key)
    return `${this.kvPath}/${key}.json`
  }

  checkPermission(operation, key = null) {
    if (!this.session || !this.getPermissions) { return }
    const perms = this.getPermissions()
    const rule  = (key ? perms?.[`_kv.${key}`] : null) ?? perms?.['_kv']
    const label = `KV${key ? ` key "${key}"` : ' store'}`
    enforcePermission(label, operation, rule, this.session)
  }

  /**
   * Store a value under `key`.
   * @param   {string}  key
   * @param   {unknown} value
   * @returns {Promise<unknown>} The stored value.
   */
  async set(key, value) {
    this.checkPermission('write', key)
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.filePath(key))
      await this.filesystem.writeFile(
        this.filePath(key),
        { key, value, updatedAt: new Date().toISOString() },
        `kv: set ${key}`,
        file?.sha
      )
      return value
    })
  }

  /**
   * Retrieve the value stored under `key`, or `null` if not found.
   * @param   {string} key
   * @returns {Promise<unknown|null>}
   */
  async get(key) {
    this.checkPermission('read', key)
    if (this.useCDN) {
      const file = await this.filesystem.readCDNFile(this.filePath(key))
      return file ? file.value : null
    }
    const file = await this.filesystem.readFile(this.filePath(key))
    return file ? file.content.value : null
  }

  /**
   * Delete the entry for `key`.
   * @param   {string} key
   * @returns {Promise<{ key: string, deleted: boolean }>}
   */
  async delete(key) {
    this.checkPermission('write', key)
    const deleted = await this.filesystem.deleteFile(this.filePath(key), `kv: delete ${key}`)
    return { key, deleted }
  }

  /**
   * Check whether a key exists.
   * @param   {string} key
   * @returns {Promise<boolean>}
   */
  async has(key) {
    this.checkPermission('read', key)
    return !!(await this.filesystem.readFile(this.filePath(key)))
  }

  /**
   * Atomically increment a numeric counter (optimistic lock via SHA).  
   * Creates the key with value `by` if it does not yet exist.
   * @param   {string} key
   * @param   {number} [by=1]
   * @returns {Promise<number>} The new value.
   */
  async increment(key, by = 1) {
    this.checkPermission('write', key)
    return retryOnConflict(async () => {
      const file     = await this.filesystem.readFile(this.filePath(key))
      const newValue = (file ? Number(file.content.value) : 0) + by
      await this.filesystem.writeFile(
        this.filePath(key),
        { key, value: newValue, updatedAt: new Date().toISOString() },
        `kv: increment ${key}`,
        file?.sha
      )
      return newValue
    })
  }

  /**
   * Get multiple keys in one call.  
   * Accepts spread args — `getMany('a', 'b')` — or a single array — `getMany(['a', 'b'])`.
   * @param   {...string|string[]} args
   * @returns {Promise<{ [key: string]: unknown }>}
   */
  async getMany(...args) {
    const keys  = args.length === 1 && Array.isArray(args[0]) ? args[0] : args
    this.checkPermission('read')
    const pairs = await runWithConcurrency(keys, async key => [key, await this.get(key)])
    return Object.fromEntries(pairs)
  }

  /**
   * Set multiple keys at once (parallel writes).
   * @param   {{ [key: string]: unknown }} entries
   * @returns {Promise<unknown[]>} Array of stored values in insertion order.
   */
  async setMany(entries) {
    this.checkPermission('write')
    return runWithConcurrency(Object.entries(entries), ([key, value]) => this.set(key, value))
  }

  /**
   * List all user-facing KV entries as a `{ key -> value }` map.  
   * Internal keys used by the auth system are excluded.
   * @returns {Promise<{ [key: string]: unknown }>}
   */
  async getAll() {
    this.checkPermission('read')
    const jsonFiles = (await this.filesystem.listDirectory(this.kvPath))
      .filter(entry => {
        if (!entry.name.endsWith('.json')) { return false }
        const key = entry.name.replace(/\.json$/, '')
        return !INTERNAL_KV_KEYS.has(key)
      })
    const pairs = await runWithConcurrency(jsonFiles, async entry => {
      const key = entry.name.replace(/\.json$/, '')
      return [key, await this.get(key)]
    })
    return Object.fromEntries(pairs)
  }
}

// ─── Auth Manager ─────────────────────────────────────────────────────────────

/**
 * Username/password authentication using JSON files in the repo.  
 * Passwords are stored as PBKDF2-SHA256 hashes (200,000 iterations + per-user salt + global pepper).  
 * Access via `db.auth`.
 */
class AuthManager {
  constructor(filesystem, sessionState, basePath = 'data') {
    this.filesystem = filesystem
    this.session    = sessionState
    this.kvPath     = `${basePath}/_kv`
    this.authPath   = `${basePath}/_auth`
  }

  /** Full file path for a user by their username (lowercased). */
  userPath(username) { return `${this.authPath}/${username.toLowerCase()}.json` }

  /**
   * Fetch a single user record by username.  
   * Returns `{ user, sha }` or `null` if not found.
   */
  async fetchUser(username) {
    const file = await this.filesystem.readFile(this.userPath(username))
    return file ? { user: file.content, sha: file.sha } : null
  }

  /** Fetch all user records from the _auth directory. */
  async fetchAllUsers() {
    const entries = (await this.filesystem.listDirectory(this.authPath))
      .filter(entry => entry.name.endsWith('.json'))
    const records = await runWithConcurrency(entries, async entry => {
      const record = await this.fetchUser(entry.name.replace(/\.json$/, ''))
      return record ? record.user : null
    })
    return records.filter(Boolean)
  }

  /**
   * Strip sensitive fields (passwordHash) for public exposure.  
   * Also normalises legacy single-role records that stored `role` instead of `roles`.
   */
  toSafeUser(user) {
    const roles = Array.isArray(user.roles) ? user.roles : [user.role ?? 'user']
    return { id: user.id, username: user.username, roles, createdAt: user.createdAt }
  }

  /** The currently logged-in user, or `null`. */
  get currentUser() { return this.session.currentUser }

  /** `true` if a user is logged in. */
  get isLoggedIn() { return this.session.isLoggedIn }

  /**
   * Validate the active session against live repository data.  
   * If the user's roles have changed since login the session is refreshed automatically.
   * @returns {Promise<boolean>}
   */
  async verifySession() {
    if (!this.session.isLoggedIn) { return false }
    const record = await this.fetchUser(this.session.currentUser.username)
    if (!record) { this.logout(); return false }
    const storedRoles  = [...(record.user.roles ?? [record.user.role ?? 'user'])].sort().join(',')
    const sessionRoles = [...(this.session.currentUser.roles ?? [])].sort().join(',')
    if (storedRoles !== sessionRoles) {
      this.session.persistUser(this.toSafeUser(record.user))
    }
    return true
  }

  /**
   * Create a new user account.  
   * The first account is automatically an admin.
   * @param   {string} username  2–32 alphanumeric characters, hyphens, or underscores.
   * @param   {string} password  Minimum 8 characters.
   * @returns {Promise<{ id: string, username: string, roles: string[], createdAt: string }>}
   */
  async register(username, password) {
    if (!username || !password) { throw new DatabaseError('Username and password are required', 400) }
    if (!/^[a-zA-Z0-9_\-]{2,32}$/.test(username)) {
      throw new DatabaseError('Username must be 2–32 characters: letters, numbers, hyphens, and underscores only', 400)
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new DatabaseError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400)
    }

    const existing = await this.filesystem.readFile(this.userPath(username))
    if (existing) { throw new DatabaseError('That username is already taken', 409) }

    const newUser = await retryOnConflict(async () => {
      const sentinelPath = `${this.kvPath}/admin-exists.json`
      const sentinel     = await this.filesystem.readFile(sentinelPath)
      const isFirstAdmin = !sentinel

      const user = {
        id:           generateId(),
        username,
        passwordHash: await hashSecret(password, username.toLowerCase()),
        createdAt:    new Date().toISOString(),
        roles:        isFirstAdmin ? ['admin'] : ['user'],
      }

      try {
        await this.filesystem.writeFile(this.userPath(username), user, `auth: register ${username}`)
      } catch (writeError) {
        // 422 or 409 means the file already exists — race condition with another register.
        if (writeError.httpStatus === 422 || writeError.httpStatus === 409) {
          throw new DatabaseError('That username is already taken', 409)
        }
        throw writeError
      }

      if (isFirstAdmin) {
        await this.filesystem.writeFile(sentinelPath, { createdAt: user.createdAt }, 'auth: mark first admin')
      }

      return user
    })

    const safeUser = this.toSafeUser(newUser)
    this.session.persistUser(safeUser)
    return safeUser
  }

  /**
   * Verify credentials and start a session.
   * @param   {string} username
   * @param   {string} password
   * @returns {Promise<{ id: string, username: string, roles: string[], createdAt: string }>}
   */
  async login(username, password) {
    if (!username || !password) { throw new DatabaseError('Username and password are required', 400) }
    const file    = await this.filesystem.readFile(this.userPath(username))
    const user    = file ? file.content : null
    const matches = user ? await verifySecret(password, user.passwordHash, username.toLowerCase()) : false
    if (!user || !matches) { throw new DatabaseError('Invalid username or password', 401) }
    const safeUser = this.toSafeUser(user)
    this.session.persistUser(safeUser)
    return safeUser
  }

  /** End the current session. */
  logout() { this.session.clearSession() }

  /**
   * Change the password for an account if the current password is correct.
   * @param   {string} username
   * @param   {string} currentPassword
   * @param   {string} newPassword
   * @returns {Promise<{ ok: true }>}
   */
  async changePassword(username, currentPassword, newPassword) {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new DatabaseError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`, 400)
    }
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.userPath(username))
      if (!file) { throw new DatabaseError('User not found', 404) }
      const user = file.content
      if (!await verifySecret(currentPassword, user.passwordHash, username.toLowerCase())) {
        throw new DatabaseError('Incorrect current password', 401)
      }
      const updated = {
        ...user,
        passwordHash: await hashSecret(newPassword, username.toLowerCase()),
        updatedAt:    new Date().toISOString(),
      }
      await this.filesystem.writeFile(this.userPath(username), updated, `auth: change password ${username}`, file.sha)
      return { ok: true }
    })
  }

  /**
   * Permanently delete an account.  
   * If the currently logged-in user deletes their own account they are automatically logged out.
   * @param   {string} username
   * @param   {string} password
   * @returns {Promise<{ deleted: true }>}
   */
  async deleteAccount(username, password) {
    const file = await this.filesystem.readFile(this.userPath(username))
    if (!file) { throw new DatabaseError('User not found', 404) }
    const user = file.content
    if (!await verifySecret(password, user.passwordHash, username.toLowerCase())) {
      throw new DatabaseError('Incorrect password', 401)
    }
    await retryOnConflict(() =>
      this.filesystem.deleteFile(this.userPath(username), `auth: delete account ${username}`)
    )
    if (this.session.currentUser?.username === username) { this.session.clearSession() }
    return { deleted: true }
  }

  /**
   * List all registered users — no password hashes exposed.
   * @returns {Promise<Array<{ id: string, username: string, roles: string[], createdAt: string }>>}
   */
  async listUsers() {
    return (await this.fetchAllUsers()).map(user => this.toSafeUser(user))
  }

  /**
   * Assign one or more roles to a user. Only admins can call this.  
   * Pass a single string or an array of strings.  
   * @param   {string}          username
   * @param   {string|string[]} roles    E.g. `'moderator'` or `['editor', 'moderator']`
   * @returns {Promise<{ id: string, username: string, roles: string[], createdAt: string }>}
   */
  async setRoles(username, roles) {
    if (!this.session.isLoggedIn || !this.session.currentUser?.roles?.includes('admin')) {
      throw new DatabaseError('Only admins can assign roles', 403)
    }
    const rolesArray = Array.isArray(roles) ? roles : [roles]
    if (!rolesArray.length || rolesArray.some(r => typeof r !== 'string' || !r)) {
      throw new DatabaseError('Roles must be one or more non-empty strings', 400)
    }
    if (rolesArray.includes('public') || rolesArray.includes('auth')) {
      throw new DatabaseError('"public" and "auth" are reserved permission levels and cannot be used as roles', 400)
    }
    return retryOnConflict(async () => {
      const file = await this.filesystem.readFile(this.userPath(username))
      if (!file) { throw new DatabaseError('User not found', 404) }
      const updated = { ...file.content, roles: rolesArray, updatedAt: new Date().toISOString() }
      await this.filesystem.writeFile(
        this.userPath(username),
        updated,
        `auth: set roles ${username} -> ${rolesArray.join(', ')}`,
        file.sha
      )
      const safeUser = this.toSafeUser(updated)
      // Keep the session in sync if the calling user changed their own roles.
      if (this.session.currentUser?.username === username) { this.session.persistUser(safeUser) }
      return safeUser
    })
  }
}

// ─── GitHubDB ─────────────────────────────────────────────────────────────────

/**
 * The main entry point.  
 * Use the static factory methods to create instances:  
 * `GitHubDB.owner()`, `GitHubDB.public()`, `GitHubDB.login()`, `GitHubDB.register()`
 *
 * @example
 * const db = await GitHubDB.owner({ owner: 'you', repo: 'my-db', token: 'ghp_...' })
 * const db = await GitHubDB.public({ owner: 'you', repo: 'my-db', publicToken: 'ghdb_enc_...' })
 * const db = await GitHubDB.login({ owner, repo, publicToken, username, password })
 */
class GitHubDB {
  /**
   * @param {GitHubFilesystem} filesystem
   * @param {object}  [options]
   * @param {string}  [options.basePath='data']
   * @param {boolean} [options.useCDN=false]
   * @param {boolean} [options.enrollToken=true] Set `false` to skip public-token registration (owner mode).
   */
  constructor(filesystem, { basePath = 'data', useCDN = false, enrollToken = true } = {}) {
    this.filesystem     = filesystem
    this.basePath       = basePath
    this.useCDN         = useCDN
    this.enrollToken    = enrollToken
    this.session        = new SessionState()
    this.permissionsMap = null
    /** @type {KeyValueStore} */
    this.kv             = new KeyValueStore(filesystem, basePath, useCDN, this.session, () => this.permissionsMap)
    /** @type {AuthManager} */
    this.auth           = new AuthManager(filesystem, this.session, basePath)
  }

  // ── Public-token registry ─────────────────────────────────────────

  /**
   * Register `passedToken` in the `_kv/public` list if not already present.  
   * Called automatically by `GitHubDB.public()`.
   * @param {string} passedToken The token as passed by the caller.
   */
  async enrollPublicToken(passedToken) {
    if (!this.enrollToken) { return }
    const file        = await this.filesystem.readFile(`${this.basePath}/_kv/public.json`)
    const list        = file ? (file.content?.value ?? []) : []
    const encodedForm = passedToken.startsWith(ENCODE_PREFIX) ? passedToken : encodeToken(passedToken)
    if (!list.includes(encodedForm)) {
      await this.filesystem.writeFile(
        `${this.basePath}/_kv/public.json`,
        { key: 'public', value: [...list, encodedForm], updatedAt: new Date().toISOString() },
        'kv: set public',
        file?.sha
      )
    }
  }

  /**
   * Throw if `passedToken` matches any entry in the `_kv/public` list.  
   * Prevents public tokens from being used for owner-mode login.
   * @param {string} passedToken
   */
  async assertNotPublicToken(passedToken) {
    const file      = await this.filesystem.readFile(`${this.basePath}/_kv/public.json`)
    const list      = file ? (file.content?.value ?? []) : []
    const plainForm = passedToken.startsWith(ENCODE_PREFIX)
      ? xorRotate(decodeBase64(passedToken.slice(ENCODE_PREFIX.length)))
      : passedToken
    for (const entry of list) {
      const entryPlain = entry.startsWith(ENCODE_PREFIX)
        ? xorRotate(decodeBase64(entry.slice(ENCODE_PREFIX.length)))
        : entry
      if (entryPlain === plainForm) {
        throw new DatabaseError('Public tokens cannot be used for admin login', 403)
      }
    }
  }

  // ── Static factory methods ────────────────────────────────────────

  /**
   * **Owner mode** — use your personal PAT. Full access to the repo.  
   * Rejects if the supplied token matches a known public token.
   * @param   {{ owner: string, repo: string, token: string, branch?: string, basePath?: string, useCDN?: boolean }} config
   * @returns {Promise<GitHubDB>}
   */
  static async owner({ owner, repo, token, branch = 'main', basePath = 'data', useCDN = false }) {
    const db = new GitHubDB(new GitHubFilesystem({ owner, repo, token, branch }), { basePath, useCDN, enrollToken: false })
    await db.assertNotPublicToken(token)
    return db
  }

  /**
   * **Public mode** — embed a bot token so any visitor can read/write without their own PAT.  
   * On first use the token is registered in the `_kv/public` list (unless `enrollToken` is `false`).
   * @param   {{ owner: string, repo: string, publicToken: string, branch?: string, basePath?: string, useCDN?: boolean, enrollToken?: boolean }} config
   * @returns {Promise<GitHubDB>}
   */
  static async public({ owner, repo, publicToken, branch = 'main', basePath = 'data', useCDN = false, enrollToken = true }) {
    const token = publicToken.startsWith(ENCODE_PREFIX)
      ? xorRotate(decodeBase64(publicToken.slice(ENCODE_PREFIX.length)))
      : publicToken
    const db    = new GitHubDB(new GitHubFilesystem({ owner, repo, token, branch }), { basePath, useCDN, enrollToken })
    await db.enrollPublicToken(publicToken).catch(error => {
      console.warn('[GitHubDB] Could not enroll public token:', error)
    })
    return db
  }

	/**
	 * **Login mode** — authenticate an existing user account, then return an authenticated `GitHubDB` instance.
	 * @param   {{ owner: string, repo: string, publicToken: string, username: string, password: string, branch?: string, basePath?: string, useCDN?: boolean }} config
	 * @returns {Promise<GitHubDB>}
	 */
  static async login({ owner, repo, publicToken, username, password, branch = 'main', basePath = 'data', useCDN = false }) {
    const db = await GitHubDB.public({ owner, repo, publicToken, branch, basePath, useCDN })
    await db.auth.login(username, password)
    return db
  }

	/**
	 * **Register mode** — create a new user account, then return an authenticated `GitHubDB` instance.
	 * @param   {{ owner: string, repo: string, publicToken: string, username: string, password: string, branch?: string, basePath?: string, useCDN?: boolean }} config
	 * @returns {Promise<GitHubDB>}
	 */
	static async register({ owner, repo, publicToken, username, password, branch = 'main', basePath = 'data', useCDN = false }) {
    const db = await GitHubDB.public({ owner, repo, publicToken, branch, basePath, useCDN })
    await db.auth.register(username, password)
    return db
  }

  // ── Token helpers ─────────────────────────────────────────────────

  /**
   * Obfuscate a PAT for embedding in public code.
   * @param   {string} plainToken
   * @returns {string}
   */
  static encodeToken(plainToken) { return encodeToken(plainToken) }

  // ── Secure hashing (public API) ───────────────────────────────────

  /**
   * Hash a secret using PBKDF2-SHA256.
   * @param   {string} secret
   * @param   {string} [context=''] Optional binding context (e.g. username).
   * @returns {Promise<string>}     `<salt>:<derivedKey>`
   *
   * @example
   * const storedHash = await GitHubDB.hashSecret('ghp_myToken')
   * await db.kv.set('pat_hash', storedHash)
   * const ok = await GitHubDB.verifySecret('ghp_myToken', storedHash)
   */
  static hashSecret(secret, context = '') { return hashSecret(secret, context) }

  /**
   * Verify a plaintext secret against a hash produced by {@link GitHubDB.hashSecret}.
   * @param   {string} secret
   * @param   {string} storedHash   Value returned by `hashSecret`.
   * @param   {string} [context=''] Must match the context used during hashing.
   * @returns {Promise<boolean>}
   */
  static verifySecret(secret, storedHash, context = '') { return verifySecret(secret, storedHash, context) }

  // ── Core API ──────────────────────────────────────────────────────

  /**
   * Get a handle on a named collection.  
   * Supports arbitrarily deep nesting via `(collection, recordId, collection, recordId, ...)` pairs.
   * @param   {string}    name     Root collection name.
   * @param   {...string} segments Alternating `recordId, collectionName` pairs for nesting.
   * @returns {Collection}
   *
   * @example
   * const posts   = db.collection('posts')
   * const members = db.collection('orgs', 'acme', 'teams', 'eng', 'members')
   */
  collection(name, ...segments) {
    assertValidId(name)
    if (segments.length % 2 !== 0) {
      throw new DatabaseError('collection() requires an even number of extra segments: (recordId, collectionName) pairs')
    }
    let path     = `${this.basePath}/${name}`
    let leafName = name
    for (let i = 0; i < segments.length; i += 2) {
      const recordId  = segments[i]
      const childName = segments[i + 1]
      assertValidId(recordId)
      assertValidId(childName)
      path     = `${path}/${recordId}/${childName}`
      leafName = childName
    }
    return new Collection(this.filesystem, path, leafName, this.session, () => this.permissionsMap, this.useCDN)
  }

  /**
   * Set per-collection (and per-KV-key) access permissions. Chainable.  
   * Use the special key `'_kv'` to restrict the key-value store.
   * @param   {{ [name: string]: { read: string | string[], write: string | string[] } }} map
   * @returns {this}
   *
   * @example
   * db.permissions({
   *   posts:    { read: 'public', write: 'auth' },
   *   settings: { read: 'admin',  write: 'admin' },
   *   _kv:      { read: 'auth',   write: 'admin' },
   * })
   */
  permissions(map) {
    this.permissionsMap = map
    return this
  }

  // ── Utilities ─────────────────────────────────────────────────────

  /**
   * Fetch the git commit history for a path.  
   * Every write through this library creates a commit you can inspect here.
   * @param   {string} [path='']
   * @param   {number} [limit=30]
   * @returns {Promise<Array<{ sha: string, message: string, author: string, date: string, url: string }>>}
   */
  getCommitHistory(path = '', limit = 30) { return this.filesystem.getCommitHistory(path, limit) }

  /**
   * Verify that the configured token and repo are accessible.  
   * Throws a {@link DatabaseError} if not.
   * @returns {Promise<object>} GitHub repo metadata.
   */
  validateConnection() { return this.filesystem.validateConnection() }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { GitHubDB, DatabaseError }
export default GitHubDB
