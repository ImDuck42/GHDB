export async function checkForUpdate(DATABASE_VERSION) {
  const isNewerVersion = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
    }

    return false;
  };

  const isOutdated = (latest, current) =>
    isNewerVersion(latest, current);

  try {
    const scriptText = await fetch(
      new URL('./github-db.js', import.meta.url)
    ).then(r => r.text());

    const latestVersion = scriptText.match(
      /DATABASE_VERSION\s*=\s*['"]([^'"]+)/
    )?.[1];

    if (!latestVersion || !isOutdated(latestVersion, DATABASE_VERSION))
      return console.log(`GHDB up to date (${DATABASE_VERSION})`);

    const changelogText = await fetch(
      new URL('./CHANGELOG.md', import.meta.url)
    ).then(r => r.text());

    const relevantEntries = changelogText
      .split(/^(?=\[[\d.]+\])/m)
      .map(chunk => {
        const match = chunk.match(/^\[([\d.]+)\]([\s\S]*)/);
        return match
          ? { version: match[1], body: match[2].trim() }
          : null;
      })
      .filter(entry =>
        entry && isOutdated(entry.version, DATABASE_VERSION)
      )
      .map(({ version, body }) => `[${version}]\n${body}`)
      .join('\n\n');

    if (!relevantEntries)
      return console.log(`GHDB up to date (${DATABASE_VERSION})`);

    const formattedEntries = relevantEntries.replace(
      /(\[[\d.]+\])/g,
      '%c$1%c'
    );

    const versionTags =
      relevantEntries.match(/\[[\d.]+\]/g) ?? [];

    console.log(
      `%cGHDB Update available! %c${DATABASE_VERSION} >> ${latestVersion}%c\n=> https://github.com/ImDuck42/GHDB\n\n${formattedEntries}`,

      'font-weight: bold', 'color: #888;',
      'color: inherit; font-weight: normal;',
      ...versionTags.flatMap(() => [
        'font-weight: bold; color: #ddd;',
        'color: inherit; font-weight: normal;',
      ]),
    );

    if (localStorage.getItem('suppressUpdatePopup') === 'true')
      return;

    const popup = Object.assign(document.createElement('div'), {
      innerHTML: `
        <strong>GHDB Update available: v${latestVersion}</strong>
        <p>Check the console for changes.</p>
        <button id="update-popup-close">Close</button>
        <button id="update-popup-suppress">Don't show again</button>
      `
    });

    Object.assign(popup.style, {
      position:     'fixed',
      inset:        'auto 10px 10px auto',
      background:   '#f9e2af',
      border:       '1px solid',
      padding:      '10px',
      borderRadius: '5px',
      zIndex:       '99999',
      fontFamily:   'monospace',
      lineHeight:   '0.5',
    });

    document.body.appendChild(popup);

    const closeBtn = popup.querySelector('#update-popup-close');
    const suppressBtn = popup.querySelector('#update-popup-suppress');

    closeBtn.addEventListener('click', () => popup.remove());

    suppressBtn.addEventListener('click', () => {
      localStorage.setItem('suppressUpdatePopup', 'true');
      popup.remove();
    });

  } catch (err) {
    console.error('Update check failed:', err);
  }
}