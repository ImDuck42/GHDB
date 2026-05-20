[2.8.1]
# Added update checker that checks for updates on GitHub and logs changelog entries if a newer version is available:
- The update checker is imported from the raw GitHub URL of the updater.js file in the refs/heads/main branch of the GHDB repository

[2.8.2]
# Fixed the update checker:
- Now uses a working URL for the updater.js file, which is the GitHub Pages URL instead of the raw GitHub URL
- Small changes to the changelog formatting in the dev console

[2.9.1]
# Removed `findOne` function to query records by predicate:
- The `search` (Modified `findOne` function) and `query` functions where almost identical in what they do but the `query` function had additional features

#  Adds per db auth:
- After the first db connection an *EMPTY* _origins kv is created. Before you can connect to the db, you need to manually add your origin to it!!!
- Example of the _origins kv value (use * to accept anything):
	```json
		{
			"key": "_origins",
			"value": [
				"? | ? | ?",
				"http://localhost:3000 | SimpleHTTP/0.6 Python/3.*.* | W/\"35a-618d3b8c\""
			],
			"updatedAt": "Timestamp"
		}
	```
 - The error message on a non configured _origins kv will show the files current origin for convenient copy-pasting into it
- EDIT: Edited the 2nd example origin in [3.0.0]

# Small changes for consistency:
- Small internal refactors and fixed some inconsistencies

[3.0.0]
# README.md changes and disabling of db _index.json updates:
- Refactored the readme and added some clarifications and missing features
- Now the db will seed a workflow which will rebuild all _index.json files when a .json file is edited
  - Therefore disabled (commented out) the manual _index.json editing functions

[3.0.1]
# Worflow fix and GH api version update:
- If you are using GHDB version [3.0.0] PLEASE UPDATE:
  - Every refresh of the page will re-add the indexer workflow, which is fixed in this version
- changed the `X-GitHub-Api-Version` from `2022-11-28` to `2026-03-10`
  - This was a huge overhaul of line 134-ghdb & 101-wokflow respectively (I changed the numbers)
- Changed line 761 of the README.md towards clarifications:
  - Only the first listed token NEEDS workflows scope

[3.0.2]
# worflow fix and ETag-caching:
- Fixed the encoded token being fed to the GitHub API on worflow updates
- Now uses ETag-Caching for get opperation via direct API requests to reduce quota usage

[3.1.0]
# Functional additions:
- Added functionality to upload, get, and list uploaded files
- Files can be uploaded via 
	```js
		await db.collection('db').uploadFile(fileBlob, 'fileName') // lands in that collection's `_uploads` subfolder
	```

# Addon changes:
- The workflow indexer now indexes any file in any folder containing a `_index.json` file; if it does not exist, it creates one
- It also now lists folders in its directory — used to skip directory listing via the API when using raw mode
- Updater now strips suffixes after version numbers (e.g. `3.2.0-alpha-1` becomes `3.2.0`) so version comparisons don't error out
- The update checker 'Don't show again' button now only works per version, so users will be notified of new versions until they click it for that version

# Security and auth improvements:
- Added input sanitization to strip prototype-pollution keys from all user data
- Added config validation (`assertValidConfig`) and stricter ID checks
- Added custom `pepper` support for password hashing
- Admins can now bypass password checks when changing passwords or deleting accounts
- User lookups are now case-insensitive
- All files and folders starting with an `_` are now reserved for internal use and cannot be created, edited, or deleted by users

# API fixes and behavior changes:
- `checkOrigins()` now auto-registers the current origin on first run instead of throwing with an empty list
- All GitHub and raw URLs now properly encode path segments
- `remove()`, `bulkRemove()`, and `clear()` now block deletion of internal files (`_origins`, `_public`, `_index`, `_admin-exists`)
- `kv.subscribe()` callback argument renamed from `records` to `entries`
- `kv.increment()` now validates that the current value is a finite number
- `basePath` is now normalized and `generateId()` uses `crypto.getRandomValues` exclusively