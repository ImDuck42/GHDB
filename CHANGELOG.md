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
- Example of the _origins kv value:
	```json
		{
			"key": "_origins",
			"value": [
				"? | ? | ?",
				" lorem | ipsum | dolor"
			],
			"updatedAt": "Timestamp"
		}
	```
 - The error message on a non configured _origins kv will show the files current origin for convenient copy-pasting into it.

# Small changes for consistency.
- Small internal refactors and fixed some inconsistencies.