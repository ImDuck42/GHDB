[2.8.1]
# Added update checker that checks for updates on GitHub and logs changelog entries if a newer version is available.
- The update checker is imported from the raw GitHub URL of the updater.js file in the refs/heads/main branch of the GHDB repository.

[2.8.2]
# Fixed the update checker.
- Now uses a working URL for the updater.js file, which is the GitHub Pages URL instead of the raw GitHub URL.
- Small changes to the changelog formatting in the dev console.

[2.9.1]
# Removed `findOne` function to query records by predicate.
- The `search` (Modified `findOne` function) and `query` functions where almost identical in what they do but the `query` function had additional features.

#  Adds per db auth.
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
 - The error message on a non configured _origins kv will show the files current origin for convenient copy-pasting into it.
- EDIT: Edited the 2nd example origin in [3.0.0]

# Small changes for consistency.
- Small internal refactors and fixed some inconsistencies.

[3.0.0]
# README.md changes and disabling of db _index.json updates.
- Refactored the readme and added some clarifications and missing features
- Now the db will seed a workflow which will rebuild all _index.json files when a .json file is edited.
  - Therefore disabled (commented out) the manual _index.json editing functions

[3.0.1]
# Worflow fix and GH api version update:
- If you are using GHDB version [3.0.0] PLEASE UPDATE:
  - Every refresh of the page will re-add the indexer workflow, which is fixed in this version
- changed the `X-GitHub-Api-Version` from `2022-11-28` to `2026-03-10`
  - This was a huge overhaul of line 134-ghdb & 101-wokflow respectively (I changed the numbers)
- Changed line 761 of the README.md towards clarifications:
  - Only the first listed token NEEDS workflows scope