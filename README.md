# github-db.js

> **[WARNING]**
> This project is a proof of concept. It is **not suitable for production use**.  
> GitHub is not a database. Every write consumes API rate limit quota and creates a permanent commit.  
> Data is stored in plain JSON files in a public or private repo — anyone with repo access can read or modify it directly.  
> There is no real authentication security, no access control enforcement at the GitHub level, and no protection against data loss from force pushes or repo deletion.

---

A JSON/GitHub-based database where every write is a git commit.  
Built on the GitHub Contents API with no server, no external database, and no infrastructure beyond a GitHub repo.  
All data is stored as individual JSON files. Every record's full history is preserved as native git commits.  

---

## Table of Contents  

- [How it works](#how-it-works)  
- [Requirements](#requirements)  
- [Installation](#installation)  
- [Initialization modes](#initialization-modes)  
  - [Owner mode](#owner-mode)  
  - [Public mode](#public-mode)  
- [File layout](#file-layout)  
- [Collections](#collections)  
  - [add](#add)  
  - [get](#get)  
  - [list](#list)  
  - [update](#update)  
  - [replace](#replace)  
  - [remove](#remove)  
  - [upsert](#upsert)  
  - [query](#query)  
  - [findOne](#findone)  
  - [count](#count)  
  - [exists](#exists)  
  - [bulkAdd](#bulkadd)  
  - [bulkRemove](#bulkremove)  
  - [clear](#clear)  
  - [subscribe](#subscribe)  
- [Subcollections](#subcollections)  
- [Key-value store](#key-value-store)  
- [Authentication](#authentication)  
  - [register](#register)  
  - [login](#login)  
  - [logout](#logout)  
  - [verifySession](#verifysession)  
  - [changePassword](#changepassword)  
  - [deleteAccount](#deleteaccount)  
  - [listUsers](#listusers)  
  - [setRoles](#setroles)  
- [Permissions](#permissions)  
  - [Permission levels](#permission-levels)  
  - [Custom roles](#custom-roles)  
  - [Per-record overrides](#per-record-overrides)  
  - [Key-value permissions](#key-value-permissions)  
  - [Lookup priority](#lookup-priority)  
- [Token encoding](#token-encoding)  
- [Cryptographic utilities](#cryptographic-utilities)  
- [Commit history](#commit-history)  
- [Connection validation](#connection-validation)  
- [Error handling](#error-handling)  
- [Concurrency and conflict resolution](#concurrency-and-conflict-resolution)  
- [Session management](#session-management)  
- [Rate limits and ETags](#rate-limits-and-etags)  
- [Security considerations](#security-considerations)  
- [Limitations](#limitations)  

---

## How it works  

Every record, KV entry, and user account is a single JSON file in a GitHub repository.  
Reads call the GitHub Contents API or raw.githubusercontent.com (configurable).  
Writes commit the new file content directly to the branch.  

- Every write produces a permanent, auditable git commit.  
- The database can be browsed, forked, or cloned like any other repo.  
- No separate database process to run or maintain.  
- Full history of any record is recoverable via git.  

This design is optimized for low-to-moderate write frequency.  
It is not a replacement for a relational or document database under high write load.  

---

## Requirements  

- A GitHub repository (public or private).  
- A GitHub PAT with `repo` scope, or a fine-grained token with read/write access to repository contents and write to commits/metadata.  
- A runtime with the Fetch API and Web Crypto API (`crypto.subtle`). Covers all modern browsers and Node.js 18+.  

---

## Installation  

Copy `github-db.js` into your project and import directly.

```js  
import { GitHubDB, DatabaseError } from './github-db.js'  
```

The module exports two values: the `GitHubDB` class and `DatabaseError`.  

---

## Initialization modes  

`GitHubDB` is never constructed directly.  
Use one of the static factory methods below. All return a `Promise<GitHubDB>`.  

### Owner mode  

For server-side scripts, CI pipelines, or any context where your PAT is not exposed to end users.  
Has full read/write access to the repository. Accepts an array of tokens for token pooling.

```js  
const db = await GitHubDB.owner({  
  owner:     'your-github-username',  
  repo:      'your-repo-name',  
  tokens:    ['ghp_yourPersonalAccessToken'], // array of PATs
  branch:    'main',                          // optional, default: 'main'  
  rawBranch: 'master',                        // optional, branch for raw reads (defaults to branch)
  basePath:  'data',                          // optional, default: 'data'  
  useRaw:    true,                            // optional, default: true - use raw.githubusercontent.com for reads
  storage:   null,                            // optional, custom session storage for SSR
})  
```

Owner mode rejects any token previously registered as a public token in the same repo.  
This prevents accidental privilege escalation.  

### Public mode  

For client-side apps where a bot token is embedded in source code.  
Any visitor can interact with the database without their own PAT.  
`publicTokens` can be plain PATs or pre-encoded strings (see [Token encoding](#token-encoding)).  

```js  
const db = await GitHubDB.public({  
  owner:        'your-github-username',  
  repo:         'your-repo-name',  
  publicTokens: ['ghdb_enc_yourEncodedToken'], // array of tokens
  branch:       'main',                        // optional, default: 'main'
  rawBranch:    'master',                      // optional, branch for raw reads
  basePath:     'data',                        // optional, default: 'data'  
  useRaw:       true,                          // optional, default: true
  enrollToken:  true,                          // optional, default: true — set false to skip token registration  
  storage:      null,                          // optional, custom session storage for SSR
})  
```

On first use each token is registered in `_kv/_public.json` so owner mode can detect and reject it.  

---

## File layout  

Given `basePath: 'data'` (the default):  

```
data/  
  posts/  
    lv2k3x-a1b2c3d4e5f6.json   <- collection record  
    lv2k3y-a1b2c3d4e5f7.json  
  comments/  
    lv2k3z-a1b2c3d4e5f8.json  
  _kv/  
    theme.json                  <- key-value entry  
    views.json  
    _admin-exists.json          <- internal auth sentinel  
    _public.json                <- internal public-token registry  
  _auth/  
    alice.json                  <- user account (password hash stored here)  
    bob.json  
```

Collection records include `id`, `createdAt`, and `updatedAt` added automatically.  
KV files wrap values in `{ key, value, updatedAt }`.  
Auth files store the password hash and roles but never expose them through public API methods.  

---

## Collections  

Get a collection handle with `db.collection(name)`. All methods are async.  

```js  
const posts = db.collection('posts')  
```

### add  

Create a new record. A unique ID and timestamps are added automatically.  
Supply `data.id` to use a specific ID.  

```js  
const post = await posts.add({ title: 'Hello World', published: true })  
// -> { id: 'lv2k3x-...', title: 'Hello World', published: true, createdAt: '...', updatedAt: '...' }  
```

### get  

Fetch a single record by ID. Returns `null` if not found.  

```js  
const post = await posts.get('lv2k3x-a1b2c3d4e5f6')  
```

### list  

Fetch all records in the collection, with optional pagination.  

```js  
const allPosts = await posts.list()  
// With pagination
const page = await posts.list({ limit: 10, offset: 20 })  
```

### update  

Partially update a record. Only provided fields are changed; all others are preserved.  
`id` and `createdAt` cannot be altered. `updatedAt` is refreshed automatically.  

```js  
const updated = await posts.update('lv2k3x-a1b2c3d4e5f6', { title: 'Updated Title' })  
```

Throws a 404 `DatabaseError` if the record does not exist.  

### replace  

Fully replace a record. All fields are overwritten except `id` and `createdAt`, which are always preserved.  

```js  
const replaced = await posts.replace('lv2k3x-a1b2c3d4e5f6', { title: 'Replaced', published: false })  
```

### remove  

Delete a record by ID. Returns `{ id, deleted: boolean }`.  

```js  
const result = await posts.remove('lv2k3x-a1b2c3d4e5f6')  
// -> { id: 'lv2k3x-...', deleted: true }  
```

### upsert  

Update the record if it exists; create it with the given `id` if it does not.  

```js  
const record = await posts.upsert('my-custom-id', { title: 'Either way', published: true })  
```

### query  

Filter all records in memory with a predicate. Supports optional sorting, limiting, and offsetting.  

```js  
const published = await posts.query(r => r.published)  

const paginated = await posts.query(  
  r => r.published,  
  {  
    sort:   (a, b) => new Date(b.createdAt) - new Date(a.createdAt),  
    limit:  10,  
    offset: 20,  
  }  
)  
```

`query` always loads the full collection first. For large collections, prefer direct `get` calls where the ID is known.  

### findOne  

Return the first record matching a predicate, or `null`.  

```js  
const post = await posts.findOne(r => r.slug === 'hello-world')  
```

### count  

Count all records, or only those matching a predicate.  

```js  
const total     = await posts.count()  
const published = await posts.count(r => r.published)  
```

### exists  

Check whether a record with the given ID exists.  

```js  
const exists = await posts.exists('lv2k3x-a1b2c3d4e5f6')  
// -> true or false  
```

### bulkAdd  

Add multiple records in parallel (up to 10 concurrent).  

```js  
const newRecords = await posts.bulkAdd([  
  { title: 'First' },  
  { title: 'Second' },  
])  
```

### bulkRemove  

Delete multiple records by ID in parallel.  

```js  
await posts.bulkRemove(['id-one', 'id-two', 'id-three'])  
```

### clear  

Delete every record in the collection. Irreversible in the live tree (git history retains them).  

```js  
await posts.clear()  
```

### subscribe  

Poll for changes at a configurable interval.  
The callback fires immediately on the first poll, then again whenever a change is detected.  
Returns a stop function.  

```js  
const stop = posts.subscribe(  
  ({ records, added, changed, removed }) => {  
    console.log('all records:', records)  
    console.log('new this tick:', added)  
    console.log('modified this tick:', changed)  
    console.log('deleted IDs:', removed)  
  },  
  5000,                                         // optional interval in ms, default: 5000  
  (error) => console.error(error)               // optional error handler  
)  

stop() // cancel polling  
```

`subscribe` uses directory listing SHAs to detect changes without fetching every file on every tick.  
Only changed or new files are re-fetched.  

---

## Subcollections  

Nest collections by passing alternating `recordId, collectionName` pairs after the root name.  

```js  
// -> data/orgs/acme/teams/eng/members/<id>.json  
const members = db.collection('orgs', 'acme', 'teams', 'eng', 'members')  

await members.add({ name: 'Alice' })  
await members.list()  
```

Passing an odd number of extra segments throws immediately.  

---

## Key-value store  

Flat key-value storage backed by files at `<basePath>/_kv/<key>.json`. Access via `db.kv`.  
Keys must contain only letters, numbers, hyphens, and underscores.  

```js  
await db.kv.set('theme', 'dark')  
await db.kv.get('theme')                      // -> 'dark'  
await db.kv.has('theme')                      // -> true  
await db.kv.delete('theme')                   // -> { key: 'theme', deleted: true }  

// Atomic-ish counter (optimistic lock via SHA retry)  
await db.kv.increment('views')                // -> 1  
await db.kv.increment('score', 5)             // increment by N  

// Batch operations  
await db.kv.getMany('key1', 'key2')           // -> { key1: val1, key2: val2 }  
await db.kv.getMany(['key1', 'key2'])         // array form also accepted  
await db.kv.setMany({ key1: 'a', key2: 'b' })  

// Dump all user-facing KV entries  
await db.kv.getAll()                          // -> { theme: 'dark', ... }  

// Poll for changes  
const stop = db.kv.subscribe(({ records, added, changed, removed }) => {
  console.log('all:', records)
}, 5000)
stop() // cancel polling
```

`kv.getAll()` excludes internal keys used by the auth system (`_admin-exists`, `_public`).  

---

## Authentication  

Username/password auth stored entirely in the repository.  
User records live at `<basePath>/_auth/<username>.json`. Passwords are never stored in plaintext.  
Access via `db.auth`.  

### register  

Create a new account. The first account to register is automatically assigned the `admin` role.  
All subsequent accounts receive the `user` role.  

Username: 2–32 characters, letters/numbers/hyphens/underscores only.  
Password: minimum 8 characters.  

```js  
const user = await db.auth.register('alice', 'correct-horse-battery-staple')  
// -> { id: '...', username: 'alice', roles: ['admin'], createdAt: '...' }  
```

Password hashes are never returned from any auth method.  

### login  

Verify credentials and start a session. Sessions expire after 8 hours.  

```js  
const user = await db.auth.login('alice', 'correct-horse-battery-staple')  
// -> { id: '...', username: 'alice', roles: ['admin'], createdAt: '...' }  
```

Returns a 401 `DatabaseError` on invalid credentials.  
The error message is intentionally generic to prevent username enumeration.  

### logout  

End the current session.  

```js  
db.auth.logout()  
```

### verifySession  

Confirm the active session corresponds to a user that still exists in the repo.  
If roles have changed since login, the session is refreshed automatically.  

```js  
const valid = await db.auth.verifySession() // -> true or false  
```

### changePassword  

Change a user's password. The current password must be supplied.  

```js  
await db.auth.changePassword('alice', 'old-password', 'new-password')  
// -> { ok: true }  
```

### deleteAccount  

Permanently delete a user account. The account password must be supplied.  
If the currently logged-in user deletes their own account, the session is cleared automatically.  

```js  
await db.auth.deleteAccount('alice', 'correct-horse-battery-staple')  
// -> { deleted: true }  
```

### listUsers  

Return all registered users. Password hashes are never included.  

```js  
const users = await db.auth.listUsers()  
// -> [{ id, username, roles, createdAt }, ...]  
```

### setRoles  

Assign one or more roles to a user. Only a logged-in admin can call this.  

```js  
await db.auth.setRoles('alice', ['moderator'])  
await db.auth.setRoles('alice', ['editor', 'moderator'])  
```

### Session properties  

```js  
db.auth.currentUser // { id, username, roles, createdAt } | null  
db.auth.isLoggedIn  // boolean  
```

---

## Permissions  

Call `db.permissions(map)` after initialization to configure access rules. Chainable.  
Any collection or KV key not listed defaults to `{ read: 'admin', write: 'admin' }`.  

```js  
db.permissions({  
  posts:          { read: 'public',                            write: 'auth'                    },  
  settings:       { read: 'admin',                             write: 'admin'                   },  
  comments:       { read: 'auth',                              write: 'auth'                    },  
  drafts:         { read: 'editor',                            write: 'editor'                  },  
  reports:        { read: ['moderator', 'analyst', 'auditor'], write: ['moderator', 'admin']    },  
  'posts.abc123': { read: 'admin',                             write: 'admin'                   },  
  _kv:            { read: 'auth',                              write: 'admin'                   },  
  '_kv.theme':    { read: 'public',                            write: ['moderator', 'designer'] },  
})  
```

### Permission levels  

| Level | Who passes |
|---|---|
| `'public'` | Anyone, including unauthenticated visitors |
| `'auth'` | Any logged-in user, regardless of role |
| `'admin'` | Users whose roles array contains `'admin'` |
| custom string | Users whose roles array contains that exact string |
| array of strings | Users whose roles array contains at least one listed string |

Admins always pass any permission check unconditionally.  
`'public'` and `'auth'` are reserved and cannot be used as role names.  

### Custom roles  

Any non-reserved string is a valid role. Assign roles via `db.auth.setRoles()`.  
A user can hold multiple roles simultaneously.  

```js  
// A user with roles ['editor', 'moderator'] passes checks for 'editor', 'moderator', or either in an array  
```

### Per-record overrides  

Lock down a specific record using a `collection.recordId` key in the permissions map.  

```js  
db.permissions({  
  posts:          { read: 'public', write: 'auth' },  
  'posts.abc123': { read: 'admin',  write: 'admin' }, // this record is admin-only  
})  
```

### Key-value permissions  

Use `'_kv'` to restrict the entire KV store, or `'_kv.keyname'` to override a specific key.  

```js  
db.permissions({  
  _kv:         { read: 'auth',   write: 'admin' },  
  '_kv.theme': { read: 'public', write: 'admin' },  
})  
```

### Lookup priority  

For collections: `collection.recordId` > `collection` > default `'admin'`.  
For KV: `_kv.keyName` > `_kv` > default `'admin'`.  

---

## Token encoding  

`github-db.js` provides a XOR+base64 obfuscation scheme for embedding a bot PAT in client-side code.  
This deters casual scrapers but is not encryption.  

```js  
// Run once in a trusted environment  
const encoded = GitHubDB.encodeToken('ghp_myRealToken')  
// -> 'ghdb_enc_...'  

// Paste the encoded string into your source  
const db = await GitHubDB.public({  
  publicTokens: ['ghdb_enc_...'],  
})  
```

The library detects the `ghdb_enc_` prefix and decodes automatically before use.  
Anyone with access to the source and the library can reverse the encoding. Treat the bot token accordingly.  

---

## Cryptographic utilities  

The internal PBKDF2 hashing functions are exposed as public static methods.  
Useful for safely storing a PAT hash for later verification.  

### GitHubDB.hashSecret(secret, context?)  

Hashes a value with PBKDF2-SHA256, 200,000 iterations, and a random 128-bit salt.  
Returns `<hex-salt>:<hex-derived-key>`.  
An optional `context` string binds the hash to a specific use (e.g. a username).  

```js  
const hash = await GitHubDB.hashSecret('ghp_myToken', 'optional-context')  
await db.kv.set('pat_hash', hash)  
```

### GitHubDB.verifySecret(secret, storedHash, context?)  

Verify a plaintext value against a hash from `hashSecret`.  
Uses constant-time comparison to prevent timing attacks.  
`context` must match the one used during hashing.  

```js  
const ok = await GitHubDB.verifySecret('ghp_myToken', hash)  
// -> true or false  
```

---

## Commit history  

Every write commits to the repo with a human-readable message.  
Collections use `<collectionName>: <operation> <id>`. KV uses `kv: set <key>`.  

```js  
// History for the whole repo (default limit: 30)  
const commits = await db.getCommitHistory()  

// History for a specific file  
const history = await db.getCommitHistory('data/posts/lv2k3x-a1b2c3d4e5f6.json', 50)  

// Each entry: { sha, message, author, date, url }  
```

---

## Connection validation  

Verify the configured token and repository are reachable. Throws a `DatabaseError` if not.  

```js  
const repoMeta = await db.validateConnection()  
```

---

## Error handling  

All library errors are instances of `DatabaseError`, which extends `Error`.  
It carries an `httpStatus` property matching the GitHub API status code (or `0` for non-HTTP errors).  

```js  
import { DatabaseError } from './github-db.js'  

try {  
  await posts.get('nonexistent-id')  
} catch (err) {  
  if (err instanceof DatabaseError) {  
    console.log(err.message)    // human-readable description  
    console.log(err.httpStatus) // e.g. 404, 401, 403, 409, 429  
  }  
}  
```

| Code | Cause |
|---|---|
| 400 | Invalid arguments (bad ID format, empty username, password too short) |
| 401 | Not logged in, or wrong credentials |
| 403 | Insufficient role for the required permission level |
| 404 | Record or user not found |
| 409 | Username already taken, or write conflict after exhausting retries |
| 429 | GitHub API rate limit exceeded |

---

## Concurrency and conflict resolution  

The GitHub Contents API uses per-file SHA checksums for optimistic concurrency control.  
If two writes target the same file simultaneously, one receives HTTP 409.  
`github-db.js` retries automatically on 409 up to 5 times before propagating the error.  

Bulk operations and `list()` fetch up to 10 files concurrently.  
ID generation uses `<timestamp-base36>-<crypto-random-base36>` to minimize collision probability.  

---

## Session management  

Sessions are stored in `sessionStorage` in the browser and in an in-memory Map in Node.js.  
Sessions expire 8 hours after creation.  

In the browser, the session is restored from `sessionStorage` on page reload as long as it hasn't expired.  
There is no server-side session. All session state is client-side.  

Call `verifySession()` at startup to confirm the session is still valid and pick up any role changes since last login.  

---

## Rate limits and ETags  

Directory listing reads use `If-None-Match` / `ETag` caching.  
If contents haven't changed, GitHub returns HTTP 304 and the cached listing is reused without consuming quota.  
Individual file reads and writes always hit the API directly.  

The GitHub API allows 5,000 authenticated requests per hour.  
For read-heavy public apps, set `useRaw: true` (the default) to route reads through raw.githubusercontent.com,  
which bypasses API rate limits entirely. Writes still go through the API.  

---

## Security considerations  

**Password storage.**  
Passwords are hashed with PBKDF2-SHA256 at 200,000 iterations with a per-user random 128-bit salt and a global pepper.  
Reversing a stored hash is computationally expensive even with full repo access.  

**Token exposure.**  
In public mode, the embedded token is the credential for all writes.  
Limit its permissions to read/write on this repository's contents only.  
Do not reuse a token with broader access.  

**Token encoding.**  
The XOR+base64 encoding deters automated scrapers but not manual inspection.  
Treat the bot token as a shared secret with known limited scope, not a private credential.  

**Path traversal.**  
All collection names, record IDs, and KV keys are validated against `^[a-zA-Z0-9_\-]+$` before constructing file paths.  
Values outside this set throw immediately.  

**Public token registry.**  
Tokens used in public mode are registered in `_kv/_public.json`.  
Owner mode checks this list on init and refuses to proceed if the token appears in it.  
This prevents a public token from being used for owner-mode access.  

**Role escalation.**  
Only a logged-in admin can assign roles.  
`'public'` and `'auth'` are reserved and cannot be assigned as role names.  

---

## Limitations  

**Write throughput.**  
Each write is an individual HTTP PUT. High-frequency writes will exhaust the rate limit quickly.  
This library suits apps where writes happen at human-interaction pace.  

**No transactions.**  
There is no multi-document transaction support. Operations across multiple files are not atomic.  

**No server-side queries.**  
`query`, `findOne`, and `count` load the entire collection before filtering in memory.  
Large collections are slow and expensive to query.  

**Raw propagation delay.**  
When using `useRaw: true`, freshly committed data may not be immediately visible due to GitHub's CDN caching.  

**Session storage.**  
In Node.js, sessions are in-memory and do not survive process restarts.  
In the browser, sessions are limited to the tab's `sessionStorage` lifetime.  

**No binary data.**  
All storage is JSON. Binary content must be base64-encoded manually before storing.  

**Repository size.**  
GitHub has soft limits on repository size.  
A database with millions of small files would approach those limits over time.
