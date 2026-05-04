[2.8.1]
# Added update checker that checks for updates on GitHub and logs changelog entries if a newer version is available.
- The update checker is imported from the raw GitHub URL of the updater.js file in the refs/heads/main branch of the GHDB repository.

[2.8.2]
# Fixed the update checker.
- Now uses a working URL for the updater.js file, which is the GitHub Pages URL instead of the raw GitHub URL.
- Small changes to the changelog formatting in the dev console.