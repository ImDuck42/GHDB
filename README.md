# github-db.js

> **[WARNING]** **Proof of concept — not for production.**  
> GitHub is not a database. Every write consumes API rate limit quota and creates a permanent commit.  
> Data is stored as plain JSON files — anyone with repository access can read or modify it directly.  
> There is no server-side access control, no protection against force pushes, and no transaction support.  
>
> [See an example project using this library](https://github.com/ImDuck42/Quotipedia)

---

A JSON/GitHub-based database where every write is a git commit.  
Built on the GitHub Contents API with no server, no external database, and no infrastructure beyond a GitHub repo.  
All data is stored as individual JSON files. Every record's full history is preserved as native git commits.

---

## Table of Contents

- [How it works](#how-it-works)
- [Requirements](#requirements)
- [Installation](#installation)
- [Repo layout tip](#repo-layout-tip)
- [Initialization](#initialization)
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
- [Rate limits, ETags, and raw reads](#rate-limits-etags-and-raw-reads)
- [Index files](#index-files)
- [Indexer workflow](#indexer-workflow)
- [Built-in update checker](#built-in-update-checker)
- [Security considerations](#security-considerations)
- [Limitations](#limitations)

---

## How it works

Every record, KV entry, and user account is an individual JSON file committed directly to a GitHub repository.

- Reads go through the GitHub Contents API, or optionally through `raw.githubusercontent.com` (faster, no rate limits).
- Writes commit the new file content to the branch via the GitHub API.
- Every write produces a permanent, human-readable git commit — full history of any record is recoverable at any time.
- The database can be browsed, cloned, or forked like any other repository.
- No separate database process. No infrastructure to run or maintain.

This design is optimized for low-to-moderate write frequency.  
It is not a drop-in replacement for a relational or document database under sustained write load.

---

## Requirements

- A GitHub repository (public or private).
- A GitHub PAT with `repo` scope, or a fine-grained token with write access to repository contents and workflows, plus read access to commits and metadata.
- A runtime with the Fetch API and Web Crypto API (`crypto.subtle`). This covers all modern browsers and Node.js 18+.

---

## Installation

Copy `github-db.js` into your project and import directly.

```js
import { GitHubDB, DatabaseError } from './github-db.js'
```

The module exports two values: the `GitHubDB` class and `DatabaseError`.

In the browser, `GitHubDB` is also attached to `window` for DevTools access (useful for token encoding and debugging).

---

## Repo layout tip

**Keep your database and your frontend in separate repositories.**

If your frontend is deployed via GitHub Pages or another GitHub Actions-based host, every database write triggers a commit.  
This triggers a full site rebuild. The result:

- Visitors wait for a deployment pipeline before data is live.
- Every write burns Actions minutes on a rebuild unrelated to your code.
- Deployments queue up and block each other under write load.

The fix is straightforward:

```bash
https://github.com/user/my-app-frontend/ # GitHub Pages lives here — deploys only on code changes
https://github.com/user/my-app-db/       # All data commits land here — no Pages deployment on data updates
```

Point `GitHubDB` at the database repository and deploy your frontend separately.  

---

## Initialization

`GitHubDB` is never constructed directly. Use one of the two static factory methods below.  
Both return a `Promise<GitHubDB>`.

### Owner mode

For server-side scripts, CI pipelines, or any context where your PAT is not exposed to end users.  
Has full read/write access to the repository. Accepts an array of tokens for pooling.

```js
const db = await GitHubDB.owner({
  owner:       'your-github-username',
  repo:        'your-repo-name',
  tokens:      ['ghp_yourPersonalAccessToken'], // array of PATs
  branch:      'main',                          // optional, default: 'main'
  rawBranches: ['main', 'master'],              // optional, defaults to [branch]
  basePath:    'data',                          // optional, default: 'data'
  useRaw:      true,                            // optional, default: true
  storage:     null,                            // optional, custom session storage for SSR
})
```

Owner mode rejects any token that has been previously registered as a public token in the same repository, preventing accidental privilege escalation.

**Token pooling.** When multiple tokens are provided, each request selects one at random.  
If a token hits a rate limit or returns a 401, the request automatically retries with a different token until the pool is exhausted.

### Public mode

For client-side apps where a bot token is embedded in source code.  
Any visitor can interact with the database without supplying their own PAT.  
Tokens may be plain PATs or pre-encoded strings (see [Token encoding](#token-encoding)).

```js
const db = await GitHubDB.public({
  owner:        'your-github-username',
  repo:         'your-repo-name',
  publicTokens: ['ghdb_enc_yourEncodedToken'], // array of tokens
  branch:       'main',                        // optional, default: 'main'
  rawBranches:  ['main', 'master'],            // optional
  basePath:     'data',                        // optional, default: 'data'
  useRaw:       true,                          // optional, default: true
  enrollToken:  true,                          // optional, default: true
  storage:      null,                          // optional, custom session storage for SSR
})
```

On first use, each token is registered in `_kv/_public.json` so owner mode can detect and refuse it.  
Set `enrollToken: false` to skip registration — useful for read-only deployments.

---

## File layout

Given `basePath: 'data'` (the default):

```bash
data/
├── posts/
│   ├── _index.json              # auto-maintained directory index
│   ├── lv2k3x-a1b2c3d4e5f6.json # collection record
│   └── lv2k3y-a1b2c3d4e5f7.json
├── comments/
│   ├── _index.json
│   └── lv2k3z-a1b2c3d4e5f8.json
├── _kv/
│   ├── _index.json
│   ├── _admin-exists.json       # internal auth sentinel
│   ├── _origins.json            # internal allowed origins registry
│   ├── _public.json             # internal public-token registry
│   ├── theme.json
│   └── views.json
└── _auth/
    ├── _index.json
    ├── alice.json               # user account (password hash stored here)
    └── bob.json
```

Collection records automatically include `id`, `createdAt`, and `updatedAt`.  
KV files wrap values as `{ key, value, updatedAt }`.  
Auth files store the password hash and roles, and never expose them through any public API method.

---

## Collections

Get a collection handle with `db.collection(name)`. All methods are async.

```js
const posts = db.collection('posts')
```

### add

Create a new record. A unique ID and timestamps are added automatically.  
Supply `data.id` to use a specific ID instead.

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

Update the record if it exists; create it with the given ID if it does not.

```js
const record = await posts.upsert('my-custom-id', { title: 'Either way', published: true })
```

### query

Filter all records in memory using a predicate.  
Supports optional sorting, limiting, and offsetting.  
Without a `sort`, the query exits early once `limit` is satisfied — only the records needed are fetched.

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

Records are fetched internally in batches of 50.  
For large collections, prefer direct `get` calls where the ID is known.

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

Add multiple records in parallel (up to 10 concurrent writes).

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

Delete every record in the collection.  
Irreversible in the live tree — git history retains them.

```js
await posts.clear()
```

### subscribe

Poll for changes at a configurable interval.  
The callback fires immediately on the first poll, then again whenever a change is detected. Returns a stop function.

```js
const stop = posts.subscribe(
  ({ records, added, changed, removed }) => {
    console.log('all records:',        records)
    console.log('new this tick:',      added  )
    console.log('modified this tick:', changed)
    console.log('deleted IDs:',        removed)
  },
  5000,                           // optional interval in ms, default: 5000
  (error) => console.error(error) // optional error handler
)

stop() // cancel polling
```

`subscribe` uses directory listing SHAs to detect changes without fetching every file on every tick.  
Only changed or new files are re-fetched.

---

## Subcollections

Nest collections by passing alternating `recordId, collectionName` pairs after the root collection name.

```js
// Resolves to: data/orgs/acme/teams/eng/members/<id>.json
const members = db.collection('orgs', 'acme', 'teams', 'eng', 'members')

await members.add({ name: 'Alice' })
await members.list()
```

Passing an odd number of extra segments throws immediately.  
Base collection: `orgs` => Extra segments: `acme, teams, eng, members` -> 4 (even).

---

## Key-value store

Flat key-value storage backed by individual files at `<basePath>/_kv/<key>.json`.  
Accessed via `db.kv`. Keys must contain only letters, numbers, hyphens, and underscores.

```js
await db.kv.set('theme', 'dark')
await db.kv.get('theme')              // -> 'dark'
await db.kv.has('theme')              // -> true
await db.kv.delete('theme')           // -> { key: 'theme', deleted: true }

// Atomic-ish counter (optimistic lock via SHA retry)
await db.kv.increment('views')        // -> 1
await db.kv.increment('score', 5)     // increment by a specific amount

// Batch operations
await db.kv.getMany('key1', 'key2')   // -> { key1: val1, key2: val2 }
await db.kv.getMany(['key1', 'key2']) // array form also accepted
await db.kv.setMany({ key1: 'a', key2: 'b' })

// Dump all user-facing KV entries
await db.kv.getAll()                  // -> { theme: 'dark', ... }

// Poll for changes
const stop = db.kv.subscribe(({ records, added, changed, removed }) => {
  console.log('all:', records)
}, 5000)

stop() // cancel polling
```

`kv.getAll()` excludes internal keys used by the auth system (`_admin-exists`, `_public` etc.).

---

## Authentication

Username/password authentication stored entirely in the repository.  
User records live at `<basePath>/_auth/<username>.json`.  
Passwords are never stored in plaintext. Accessed via `db.auth`.

### register

Create a new account.  
The first account to register is automatically assigned the `admin` role; all subsequent accounts receive `user`.

Username: 2–32 characters, letters/numbers/hyphens/underscores only.  
Password: minimum 8 characters.

```js
const user = await db.auth.register('alice', 'super-secure-password-123')
// -> { id: '...', username: 'alice', roles: ['admin'], createdAt: '...' }
```

Password hashes are never returned from any auth method.

### login

Verify credentials and start a session. Sessions expire after 8 hours.

```js
const user = await db.auth.login('alice', 'super-secure-password-123')
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

Confirm the active session corresponds to a user that still exists in the repository.  
If roles have changed since login, the session is refreshed automatically.

```js
const valid = await db.auth.verifySession() // -> true or false
```

### changePassword

Change a user's password. The current password must be provided.

```js
await db.auth.changePassword('alice', 'old-password', 'new-password')
// -> { ok: true }
```

### deleteAccount

Permanently delete a user account.  
The account's password must be supplied.  
If the currently logged-in user deletes their own account, the session is cleared automatically.

```js
await db.auth.deleteAccount('alice', 'super-secure-password-123')
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

Call `db.permissions(map)` after initialization to configure access rules.  
Returns `this` for chaining. Any collection or KV key not listed defaults to `{ read: 'admin', write: 'admin' }`.

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

| Level                          | Who passes                                                          |
|--------------------------------|---------------------------------------------------------------------|
| `'public'`                     | Anyone, including unauthenticated visitors                          |
| `'auth'`                       | Any logged-in user, regardless of role                              |
| `'admin'`                      | Users whose roles array contains `'admin'`                          |
| `'custom string'`              | Users whose roles array contains that exact string                  |
| `['array'] ['of'] ['strings']` | Users whose roles array contains at least one of the listed strings |

Admins always pass any permission check unconditionally.  
`'public'` and `'auth'` are reserved and cannot be used as role names.  

### Custom roles

Any non-reserved string is a valid role.  
Assign roles via `db.auth.setRoles()`.  
A user can hold multiple roles simultaneously.

```js
// A user with roles ['editor', 'moderator'] passes checks for 'editor', 'moderator', or either in an array
```

### Per-record overrides

Lock down a specific record using a `collection.recordId` key in the permissions map.

```js
db.permissions({
  posts:          { read: 'public', write: 'auth'  },
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

`github-db.js` provides an XOR+base64 obfuscation scheme for embedding a bot PAT in client-side code.  
This deters casual automated scrapers but is not encryption.

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
Anyone with access to the source and the library can reverse the encoding — treat the bot token accordingly.

---

## Cryptographic utilities

The internal PBKDF2 hashing functions are exposed as public static methods, useful for safely storing a PAT hash for later verification.

### GitHubDB.hashSecret(secret, context?)

Hashes a value with PBKDF2-SHA256 at 200,000 iterations with a random 128-bit salt.  
Returns `<hex-salt>:<hex-derived-key>`. An optional `context` string binds the hash to a specific use (e.g. a username).

```js
const hash = await GitHubDB.hashSecret('ghp_myToken', 'optional-context')
await db.kv.set('pat_hash', hash)
```

### GitHubDB.verifySecret(secret, storedHash, context?)

Verify a plaintext value against a hash produced by `hashSecret`.  
Uses constant-time comparison to prevent timing attacks. `context` must match the one used during hashing.

```js
const ok = await GitHubDB.verifySecret('ghp_myToken', hash)
// -> true or false
```

---

## Commit history

Every write commits to the repository with a human-readable message.  
Collections use the format `<collectionName>: <operation> <id>`. KV uses `kv: set <key>`.

```js
// History for the whole repo (default limit: 30)
const commits = await db.getCommitHistory()

// History for a specific file
const history = await db.getCommitHistory('data/posts/lv2k3x-a1b2c3d4e5f6.json', 50)

// Each entry: { sha, message, author, date, url }
```

---

## Connection validation

Verify the configured token and repository are reachable.  
Throws a `DatabaseError` if not.

```js
const repoMeta = await db.validateConnection()
```

---

## Error handling

All library errors are instances of `DatabaseError`, which extends `Error`.  
It carries an `httpStatus` property matching the GitHub API status code, or `0` for non-HTTP errors.

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

| Code | Cause                                                                |
|-----|-----------------------------------------------------------------------|
| 400 | Invalid arguments — bad ID format, empty username, password too short |
| 401 | Not logged in, or wrong credentials                                   |
| 403 | Insufficient role for the required permission level                   |
| 404 | Record or user not found                                              |
| 409 | Username already taken, or write conflict after exhausting retries    |
| 429 | GitHub API rate limit exceeded                                        |

---

## Concurrency and conflict resolution

The GitHub Contents API uses per-file SHA checksums for optimistic concurrency control.  
If two writes target the same file simultaneously, one receives HTTP 409.  
`github-db.js` retries automatically on conflict up to 5 times before propagating the error.

Bulk operations and `list()` fetch up to 10 files concurrently.  
ID generation uses `<timestamp-base36>-<crypto-random-base36>` to minimize collision probability.

---

## Session management

Sessions are stored in `sessionStorage` in the browser, and in an in-memory Map in Node.js.  
Sessions expire 8 hours after creation.

In the browser, the session is restored from `sessionStorage` on page reload as long as it hasn't expired.  
There is no server-side session — all session state is client-side.

Call `verifySession()` at startup to confirm the session is still valid and pick up any role changes since the last login.

---

## Rate limits, ETags, and raw reads

Directory listing reads use `If-None-Match` / `ETag` caching.  
If contents haven't changed, GitHub returns HTTP 304 and the cached listing is reused without consuming quota.

The GitHub API allows 5,000 authenticated requests per hour.  
For read-heavy public apps, set `useRaw: true` (the default) to route reads through `raw.githubusercontent.com`, which bypasses API rate limits entirely.  
Writes always go through the API.

When `rawBranches` is configured with more than one branch, the library compares `Last-Modified` headers across all listed branches.  
Then reads from the one with the most recently updated file which is useful for failover or multi-branch setups.

---

## Index files

Every directory automatically maintains an `_index.json` file listing its JSON children.  
This allows directory listings to avoid API calls entirely when `useRaw: true`, falling back to the API only when the index is missing.

Index updates happen asynchronously after every write or delete and are retried on conflict.  
You do not need to manage `_index.json` manually.

---

## Indexer workflow

When initializing a database, `github-db.js` automatically installs a GitHub Actions workflow at `.github/workflows/indexer.yml` in your database repository.  
This workflow keeps all `_index.json` files in sync by rebuilding them whenever a `.json` file is pushed — covering any writes made directly to the repository.

The workflow requires that your PAT has the **workflows** scope for only the first token in the array if multiple are provided.

An example of the installed workflow is provided at [`github/workflows/indexer.yml`](github/workflows/indexer.yml) for reference.  
It runs on any push that touches a `.json` file under your configured `basePath`, rebuilds the `_index.json` for every affected directory, and commits the result.

Under normal use you do not need to touch this file.  
If the workflow fails to install (e.g. due to a missing `workflow` scope), an error is thrown.

---

## Built-in update checker

On load, the library checks whether a newer version of `github-db.js` exists upstream.  
If an update is available, a summary is logged to the console and a small popup is shown in the browser.

To suppress the popup permanently:

```js
localStorage.setItem('suppressUpdatePopup', 'true')
```

The checker requires network access to `raw.githubusercontent.com` and does not block initialization.

---

## Security considerations

**Password storage.**
Passwords are hashed with PBKDF2-SHA256 at 200,000 iterations with a per-user random 128-bit salt and a global pepper.  
Reversing a stored hash is computationally expensive even with full repository access.

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
Owner mode checks this list on initialization and refuses to proceed if the token appears in it, preventing a public token from being used for owner-mode access.

**Role escalation.**
Only a logged-in admin can assign roles. `'public'` and `'auth'` are reserved and cannot be assigned as role names.

---

## Limitations

**Write throughput.**
Each write is an individual HTTP PUT.  
High-frequency writes will exhaust the rate limit quickly.  
This library is suited to apps where writes happen at human-interaction pace.

**No transactions.**
There is no multi-document transaction support.  
Operations across multiple files are not atomic.

**No server-side queries.**
`query` and `count` load the entire collection before filtering in memory.  
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