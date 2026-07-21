// /raw on Vercel: the repo isn't on disk, so whitelist the path against the
// baked city (same rule as the dev server) and proxy raw.githubusercontent.com.
export default async function handler(req, res) {
  try {
    const { repo, p } = req.query;
    if (typeof repo !== 'string' || typeof p !== 'string' || !/^[\w.-]+$/.test(repo)) throw 0;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const r = await fetch(`${proto}://${host}/cities/${repo}.json`);
    // a missing city falls through the SPA rewrite and returns HTML — check the type
    const city = r.ok && r.headers.get('content-type')?.includes('json') ? await r.json() : null;
    if (!city?.gh || !city.buildings.some(b => b.path === p)) throw 0;
    const raw = await fetch(`https://raw.githubusercontent.com/${city.gh}/HEAD/${p}`);
    if (!raw.ok) throw 0;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.status(200).send(await raw.text());
  } catch {
    res.status(404).send('unknown file');
  }
}
