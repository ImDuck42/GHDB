export async function generateIndexerWorkflow(owner, repo, token, basePath) {
  const api  = 'https://api.github.com'
  const base = basePath.replace(/^\/+|\/+$/g, '')
  const path = '.github/workflows/indexer.yml'
  const yaml = `name: Merge Index Updates

on:
  push:
    paths:
      - '${path}'
      - '${base}/**.json'

concurrency:
  group: merge-index-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  merge-index:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - name: Rebuild _index.json files
        run: |
          INTERNAL="^_index\\.json$"
          TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%S).$(printf '%03d' $(( 10#$(date -u +%N | cut -c1-3) )))Z"

          find ${base} \\
            -name '*.json' -not -name '_index.json' -print \\
          | sed 's|/[^/]*$||' \\
          | sort -u \\
          | while IFS= read -r DIR; do

              mapfile -t FILES < <(
                find "$DIR" -maxdepth 1 -name '*.json' -not -name '_index.json' -printf '%f\\n' \\
                | sort
              )

              INDEX="$DIR/_index.json"

              if [ \${#FILES[@]} -eq 0 ]; then
                printf '{\\n  "files": [],\\n  "updatedAt": "%s"\\n}\\n' "$TIMESTAMP" > "$INDEX"
                echo "reset $INDEX (empty)"
                continue
              fi

              FILES_JSON="$(printf '%s\\n' "\${FILES[@]}" | awk '
                BEGIN { printf "  \\"files\\": [\\n" }
                {
                  gsub(/\\\\/, "\\\\\\\\"); gsub(/"/, "\\\\\\"")
                  lines[NR] = "    \\"" $0 "\\""
                  count = NR
                }
                END {
                  for (i = 1; i <= count; i++) {
                    if (i < count) printf "%s,\\n", lines[i]
                    else           printf "%s\\n",  lines[i]
                  }
                  printf "  ]"
                }
              ')"

              NEW_CONTENT="$(printf '{\\n%s,\\n  "updatedAt": "%s"\\n}\\n' "$FILES_JSON" "$TIMESTAMP")"

              if [ -f "$INDEX" ]; then
                OLD_CONTENT=$(cat "$INDEX")
                if [ "$OLD_CONTENT" = "$NEW_CONTENT" ]; then
                  echo "unchanged $INDEX"
                  continue
                fi
              fi

              TMP="$(mktemp "$DIR/.index_tmp_XXXXXX")"
              printf '%s' "$NEW_CONTENT" > "$TMP"
              mv -f "$TMP" "$INDEX"
              echo "updated $INDEX (\${#FILES[@]} file(s))"
            done

      - name: Commit updated indexes
        run: |
          git config user.name  "GHDB-Bot"
          git config user.email "bot@ghdb.local"

          git add .
          git diff --cached --quiet && echo "No index changes to commit." && exit 0

          git commit -m "workflow: rebuild _index.json files [skip ci]"
          git push
`;

  const apiUrl = `${api}/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github+json',
    'Content-Type':         'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let sha;
  const existing = await fetch(apiUrl, { headers });
  
  if (existing.ok) {
    sha = (await existing.json()).sha;
  } else if (existing.status !== 404) {
    throw new Error(`GitHub API error ${existing.status}: ${await existing.text()}`);
  }

  const res = await fetch(apiUrl, {
    method:  'PUT',
    headers,
    body:    JSON.stringify({
      message: 'workflow: add indexer workflow',
      content: btoa(unescape(encodeURIComponent(yaml))),
      ...(sha ? { sha } : {}),
    }),
  });

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);

  const result = await res.json();
  return {
    created: !sha,
    url:     result.content.html_url,
  };
}