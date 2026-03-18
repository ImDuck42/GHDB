# github-db.js

> A complete serverless database module backed by a GitHub repository. One JS file, zero dependencies, zero backend.

Every record is a JSON file committed directly to your repo. Every write is a git commit. You get CRUD, key-value storage, user authentication, access rules, and a free audit log — all from a single `import`.

---

## How it works

```
your site  →  GitHub Contents API  →  commits JSON files  →  your repo
your site  ←  raw.githubusercontent.com  ←  cached reads  ←  your repo
```

- **Writes** go through `api.github.com` using a Personal Access Token
- **Reads** are served by `raw.githubusercontent.com` — CDN-cached, fast, no auth needed for public repos
- **Every write** is a real git commit — message, author, timestamp, diff — stored forever
- **Auth** is stored as a salted SHA-256-hashed user list in `data/_auth/users.json`
- **No server**, no database, no build step, no config files

---

## Installation

No package manager needed. Just copy the file.

```html
<!-- In your HTML -->
<script type="module">
  import GitHubDB from './github-db.js'
</script>
```

```js
// Or in any ES module
import GitHubDB, { DBError } from './github-db.js'
```

The module targets modern browsers and any runtime that supports ES modules, `fetch`, and `crypto.subtle` (Chrome 60+, Firefox 57+, Safari 11+, Deno, Bun).

---

## Setup

### 1. Create a GitHub repo

This repo is your database. It can be public or private.

```
your-db-repo/
└── data/              ← created automatically on first write
    ├── _auth/
    │   └── users.json
    ├── _kv/
    │   └── *.json
    └── <collection>/
        └── <id>.json
```

### 2. Create a Personal Access Token (PAT)

Go to [github.com/settings/tokens/new](https://github.com/settings/tokens/new) and create a token with **`repo`** scope.

> For open/public platforms, create a dedicated GitHub account (e.g. `myapp-bot`) and add it as a collaborator on the repo. Give it write access. Use that account's PAT as the bot token.

### 3. Connect

Pick the access mode that fits your use case — details in the next section.

---

## Access modes

There are three ways to connect, depending on who should be able to read and write.

### Owner mode

You, full access. Use your own PAT. Best for private tools, admin scripts, or server-side usage.

```js
const db = GitHubDB.owner({
  owner:  'your-github-username',
  repo:   'your-db-repo',
  token:  'ghp_yourPersonalAccessToken',
  branch: 'main',      // optional, default: 'main'
  basePath: 'data',    // optional, default: 'data'
})
```

### Public mode

Embed a bot token so anyone visiting your site can read and write — no login required. The token is XOR-obfuscated so it isn't a plain readable string in view-source or a quick DevTools glance.

**Step 1** — encode your bot token (run once in any browser console or Deno):

```js
import GitHubDB from './github-db.js'
GitHubDB.encodeToken('ghp_yourBotToken')
// → 'R3h4Q3....'  (paste this into your source)
```

**Step 2** — use the encoded string in your site:

```js
const db = GitHubDB.public({
  owner:       'your-github-username',
  repo:        'your-db-repo',
  publicToken: 'R3h4Q3....',   // encoded string from step 1
})
```

> **Security note:** XOR obfuscation is not encryption. A determined person can reverse it. It prevents casual inspection — not deliberate extraction. For anything sensitive, keep the repo private and use user auth instead.

### User auth mode

Users register with a username and password. Credentials are stored as SHA-256 hashes in the repo. The bot token handles all writes underneath — users never see or need a PAT.

```js
// Register a new account (returns authenticated db)
const db = await GitHubDB.register({
  owner:       'your-github-username',
  repo:        'your-db-repo',
  publicToken: 'R3h4Q3....',
  username:    'alice',
  password:    'hunter2',
})

// Log in to an existing account (returns authenticated db)
const db = await GitHubDB.login({
  owner:       'your-github-username',
  repo:        'your-db-repo',
  publicToken: 'R3h4Q3....',
  username:    'alice',
  password:    'hunter2',
})
```

Both return a `GitHubDB` instance with `db.auth.currentUser` populated and a session saved to `sessionStorage` (expires after 8 hours, cleared on tab close).

---

## Collections

A collection is a named folder of JSON records. Each record is one file: `data/<collection>/<id>.json`.

```js
const posts = db.collection('posts')
```

### add(data)

Create a new record. An `id`, `createdAt`, and `updatedAt` are added automatically.

```js
const post = await posts.add({
  title:     'Hello world',
  body:      'My first post.',
  published: true,
})
// → { id: 'lf3k2-a8x9z', title: 'Hello world', ..., createdAt: '...', updatedAt: '...' }
```

You can supply your own `id` inside `data` to use a specific identifier instead of the auto-generated one.

### get(id)

Fetch a single record by id. Returns `null` if not found.

```js
const post = await posts.get('lf3k2-a8x9z')
```

### list()

Fetch all records in the collection. Requests are made in parallel.

```js
const allPosts = await posts.list()
```

### update(id, changes)

Partial update (patch). Only the provided fields are changed — everything else is preserved. Returns the full updated record. The `id` and `createdAt` fields are always protected and cannot be overwritten via `changes`.

```js
const updated = await posts.update('lf3k2-a8x9z', { title: 'Updated title' })
```

### replace(id, data)

Full replacement. All fields are overwritten with `data`. The `id` and `createdAt` are preserved regardless. Returns the new record. Throws a `404` error if the record does not exist (use `upsert` if you want create-or-replace behaviour).

```js
const replaced = await posts.replace('lf3k2-a8x9z', { title: 'New', body: 'New body.' })
```

### remove(id)

Delete a record. Returns `{ id, deleted: true }`.

```js
await posts.remove('lf3k2-a8x9z')
```

### upsert(id, data)

Update if the record exists, create it if not. Useful for syncing external data.

```js
await posts.upsert('my-custom-id', { title: 'Either way this exists now' })
```

### query(filterFn, options?)

Filter all records in memory using a predicate function. Supports optional `sort`, `limit`, and `offset`.

```js
// Simple filter
const published = await posts.query(r => r.published === true)

// With sort and limit
const recent = await posts.query(
  r => r.published,
  {
    sort:   (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    limit:  10,
    offset: 0,
  }
)
```

### findOne(filterFn)

Returns the first record matching the predicate, or `null`.

```js
const post = await posts.findOne(r => r.slug === 'hello-world')
```

### count(filterFn?)

Return the total number of records, or the count of those matching a filter.

```js
const total     = await posts.count()
const published = await posts.count(r => r.published)
```

### exists(id)

Check whether a record exists. Single API call, no data returned.

```js
const alreadyThere = await posts.exists('lf3k2-a8x9z')
```

### bulkAdd(items)

Add multiple records at once. Requests run in parallel. Returns array of created records.

```js
const created = await posts.bulkAdd([
  { title: 'Post one' },
  { title: 'Post two' },
])
```

### bulkRemove(ids)

Delete multiple records by id. Requests run in parallel.

```js
await posts.bulkRemove(['id1', 'id2', 'id3'])
```

### clear()

Delete every record in the collection. Cannot be undone.

```js
await posts.clear()
```

### subscribe(callback, intervalMs?)

Poll the collection for changes and call `callback` with the full record list whenever something changes. Returns an unsubscribe function. Default interval is 5000ms. An optional `onError` callback receives any errors that occur during polling — without it, errors are suppressed silently.

```js
const stop = posts.subscribe(
  records => { console.log('posts changed:', records) },
  3000,
  err => { console.error('poll error:', err) },
)

// Later:
stop()
```

---

## Key-value store

The KV store is for singletons — site config, counters, feature flags, anything that's one value per key. Each key maps to one file: `data/_kv/<key>.json`.

```js
// Set a value (any JSON-serializable type)
await db.kv.set('site-config', { theme: 'dark', lang: 'en' })

// Get a value (returns null if not set)
const config = await db.kv.get('site-config')

// Delete
await db.kv.del('site-config')

// Check existence
const exists = await db.kv.has('site-config')

// Increment a counter (atomic-ish — built-in SHA retry on conflict)
const views = await db.kv.incr('page-views')       // +1
const score = await db.kv.incr('high-score', 50)   // +50

// Get multiple keys at once → { key: value } map
// Accepts spread args or a single array
const { theme, lang } = await db.kv.mget('theme', 'lang')
const vals = await db.kv.mget(['theme', 'lang', 'page-views'])

// Set multiple keys at once
await db.kv.mset({ theme: 'light', lang: 'de' })

// List all keys and values in the KV store
const all = await db.kv.all()
// → { 'site-config': { theme: 'dark' }, 'page-views': 42, ... }
```

---

## Auth

User accounts are stored in `data/_auth/users.json`. Passwords are hashed using SHA-256 with a username-derived salt and a pepper before being stored — plaintext passwords never leave the client and are never committed to the repo. Password comparisons use a timing-safe equality check to mitigate timing-oracle attacks.

The first user to register is automatically assigned the `admin` role. All subsequent users get the `user` role.

Sessions are stored in `sessionStorage` and expire after 8 hours. They are cleared when the tab is closed.

### register(username, password)

Create a new account. Returns the user object and creates a session.

```js
const user = await db.auth.register('alice', 'hunter2')
// → { id: 'lf3...', username: 'alice', role: 'user', createdAt: '...' }
```

Validation rules:
- Username: 2–32 characters, letters/numbers/underscore/hyphen only
- Password: minimum 6 characters
- Usernames are case-insensitive and must be unique

### login(username, password)

Authenticate an existing user. Returns the user object and creates a session.

```js
const user = await db.auth.login('alice', 'hunter2')
```

### logout()

Destroy the current session. Synchronous.

```js
db.auth.logout()
```

### currentUser

The currently logged-in user, or `null`. Available immediately on page load if a valid session exists.

```js
if (db.auth.isLoggedIn) {
  console.log(`Hello, ${db.auth.currentUser.username}`)
  // → { id, username, role, createdAt }
}
```

### changePassword(username, oldPassword, newPassword)

Update a user's password. The old password must be correct.

```js
await db.auth.changePassword('alice', 'hunter2', 'correct-horse')
```

### deleteAccount(username, password)

Permanently delete an account. Logs the user out. The password must be confirmed.

```js
await db.auth.deleteAccount('alice', 'correct-horse')
// → { deleted: true }
```

### listUsers()

Return all registered users (safe fields only — no password hashes).

```js
const users = await db.auth.listUsers()
// → [{ id, username, role, createdAt }, ...]
```

---

## Access rules

Define per-collection read/write permissions. Call `db.rules()` once after connecting.

```js
db.rules({
  posts:    { read: 'public', write: 'auth'   },  // anyone reads, logged-in users write
  drafts:   { read: 'auth',   write: 'auth'   },  // logged-in users only
  settings: { read: 'owner',  write: 'owner'  },  // owner PAT only
  logs:     { read: 'auth',   write: 'public' },  // anyone writes, logged-in users read
})
```

`rules()` returns the `db` instance so you can chain it:

```js
const db = GitHubDB.public({ owner, repo, publicToken }).rules({
  posts: { read: 'public', write: 'auth' },
})
```

**Permission levels:**

| Level | Who can access |
|---|---|
| `'public'` | Anyone — no login required |
| `'auth'` | Any logged-in user |
| `'owner'` | Enforced by the token — only the owner PAT bypasses this |

If no rule is defined for a collection, all operations are allowed.

---

## Utilities

### db.commits(path?, limit?)

Fetch the git commit history for any path in the repo. Returns the last `limit` commits (default 30). This is your free, immutable audit log.

```js
// Commit history for the entire data folder
const history = await db.commits('data', 50)

// History for a specific collection
const postHistory = await db.commits('data/posts')

// History for one record
const recordHistory = await db.commits('data/posts/lf3k2-a8x9z.json')
```

Each commit object:

```js
{
  sha:     'a3f8c2...',
  message: 'posts: add lf3k2-a8x9z',
  author:  'myapp-bot',
  date:    '2025-03-18T14:22:01Z',
  url:     'https://github.com/owner/repo/commit/a3f8c2...',
}
```

### db.rawFile(path)

Read any JSON file from the repo via the CDN — fast, cached, no auth required (public repos only).

```js
const readme = await db.rawFile('README.md')
const config = await db.rawFile('data/_kv/site-config.json')
```

### db.validate()

Check that the token and repo are accessible. Throws a descriptive `DBError` if not. Useful for showing an error state on startup.

```js
try {
  await db.validate()
} catch (err) {
  console.error('DB connection failed:', err.message)
}
```

### GitHubDB.encodeToken(plainToken)

Obfuscate a PAT for embedding in public source code.

```js
const encoded = GitHubDB.encodeToken('ghp_xxxxxxxxxxxx')
// → 'R3h4Q3....'
```

### GitHubDB.decodeToken(encoded)

Reverse the obfuscation. Useful for debugging.

```js
const plain = GitHubDB.decodeToken('R3h4Q3....')
// → 'ghp_xxxxxxxxxxxx'
```

---

## Error handling

All async methods throw `DBError` on failure. Catch it to handle gracefully.

```js
import GitHubDB, { DBError } from './github-db.js'

try {
  const post = await db.collection('posts').get('nonexistent-id')
  // returns null — not an error
} catch (err) {
  if (err instanceof DBError) {
    console.error(err.message)  // human-readable message
    console.error(err.status)   // HTTP status code, or null
  }
}
```

Common status codes:

| Status | Meaning |
|---|---|
| `401` | Bad token, or permission rule blocked the request |
| `403` | Token valid but lacks repo write scope, or API rate limit exceeded (message includes reset time) |
| `404` | File or collection not found (also returned as `null` from `.get()`) |
| `409` | SHA conflict on concurrent write — retried automatically (up to 2 times) |
| `422` | Validation error from GitHub API |

---

## File layout

Everything lives under `basePath` (default `data/`).

```
data/
├── _auth/
│   └── users.json            ← all user accounts (hashed passwords)
├── _kv/
│   ├── site-config.json      ← kv: set('site-config', ...)
│   └── page-views.json       ← kv: set('page-views', ...)
├── posts/
│   ├── lf3k2-a8x9z.json     ← one file per record
│   └── lf3k3-b7y8w.json
└── comments/
    └── lf3k4-c6x7v.json
```

A record file looks like this:

```json
{
  "id": "lf3k2-a8x9z",
  "title": "Hello world",
  "body": "My first post.",
  "published": true,
  "createdAt": "2025-03-18T14:22:01.000Z",
  "updatedAt": "2025-03-18T14:22:01.000Z"
}
```

---

## Rate limits

The GitHub API allows **5,000 authenticated requests per hour** per token. Each operation costs:

| Operation | API calls |
|---|---|
| `get(id)` | 1 |
| `add(data)` | 1 read (SHA) + 1 write = 2 |
| `update(id, changes)` | 1 read + 1 write = 2 |
| `list()` | 1 (dir listing) + N (one per record, parallel) |
| `query(fn)` | same as `list()` |
| `remove(id)` | 1 read + 1 delete = 2 |
| `bulkAdd(N items)` | 2N |
| `subscribe(cb, 5000)` | `list()` cost every 5 seconds |

For a personal blog or small community, you'll never hit the limit. For high-traffic apps, cache `list()` results locally and only re-fetch when you know data has changed.

Unauthenticated reads via `rawFile()` are served by the CDN and don't count against the API rate limit.

---

## Security model

| Concern | How it's handled |
|---|---|
| Password storage | SHA-256 hashed with a username salt + pepper. Timing-safe comparison. Plaintext never leaves the browser. |
| Bot token in source | XOR + base64 obfuscated. Prevents casual inspection, not determined extraction. |
| Session persistence | `sessionStorage` only. Cleared on tab close. 8-hour expiry. |
| Concurrent writes | GitHub's SHA requirement is used as an optimistic lock. Conflicts retry automatically up to 2 times. |
| `_auth/` visibility | On a public repo, `users.json` is world-readable. It contains only usernames and hashes — no emails, no plaintext passwords. |
| Access rules | Enforced client-side. A user with direct API access can bypass them. For real enforcement, keep the repo private. |

**Recommendations by use case:**

- **Personal tool / admin script:** owner mode, PAT never in source
- **Community platform:** public repo + encoded bot token + user auth + `rules()`
- **Sensitive data:** private repo + user auth — reads require auth token too
- **Fully locked down:** private repo + owner mode only

---

## Complete example — a public guestbook

```html
<script type="module">
import GitHubDB from './github-db.js'

const db = GitHubDB.public({
  owner:       'myname',
  repo:        'my-guestbook',
  publicToken: 'R3h4Q3....',   // GitHubDB.encodeToken('ghp_...')
}).rules({
  messages: { read: 'public', write: 'public' },
})

// Show all messages
const messages = await db.collection('messages').list()
messages
  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  .forEach(m => {
    console.log(`[${m.createdAt}] ${m.name}: ${m.text}`)
  })

// Post a new message
await db.collection('messages').add({
  name: 'Alice',
  text: 'Great site!',
})
</script>
```

---

## Complete example — a blog with auth

```js
import GitHubDB from './github-db.js'

const CONFIG = {
  owner:       'myname',
  repo:        'my-blog',
  publicToken: 'R3h4Q3....',
}

// Set up rules once
const db = GitHubDB.public(CONFIG).rules({
  posts: { read: 'public', write: 'auth' },
})

// Register
const user = await db.auth.register('alice', 'hunter2')

// Log in (on next visit)
const user = await db.auth.login('alice', 'hunter2')
console.log(db.auth.currentUser)  // { id, username, role, createdAt }

// Write a post (requires auth)
const post = await db.collection('posts').add({
  title:     'My first post',
  body:      'Hello world.',
  author:    db.auth.currentUser.username,
  published: true,
})

// Read all posts (anyone)
const posts = await db.collection('posts').query(
  r => r.published,
  { sort: (a, b) => new Date(b.createdAt) - new Date(a.createdAt) }
)

// Edit (auth required by rules)
await db.collection('posts').update(post.id, { title: 'Updated title' })

// Delete
await db.collection('posts').remove(post.id)

// Full commit audit log
const history = await db.commits('data/posts', 20)

// Log out
db.auth.logout()
```

---

## Limitations

- **No real-time push.** Changes are pulled via polling (`subscribe`) or manual `list()`. There is no WebSocket or Server-Sent Events support — GitHub's API doesn't offer it.
- **No transactions.** Two concurrent writes to the same file will race. The SHA retry handles most conflicts, but there's no multi-record atomicity.
- **No server-side filtering.** `query()` and `count()` fetch all records and filter in memory. This is fine up to a few hundred records per collection. Beyond that, consider a different tool.
- **5MB per file.** GitHub's API limit for file content. A single record or KV value cannot exceed this.
- **5,000 API calls/hour.** Per token. Shared across all users in public mode.
- **Public repos expose `_auth/`.** `users.json` is world-readable on a public repo. It contains only hashed passwords, but if you want the user list to be private, use a private repo.
- **Browser only.** Relies on `sessionStorage`, `crypto.subtle`, and `fetch`. Works in Deno/Bun if you polyfill `sessionStorage`.

---

## License

MIT. Do whatever you want with it.