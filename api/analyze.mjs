// Serverless can't clone arbitrary repos (no git binary, read-only FS, short
// timeouts) — the hosted demo ships pre-baked example cities instead. The dev
// server's real /analyze lives in vite.config.js; run locally to drive any repo.
export default function handler(req, res) {
  res.status(503).json({
    error: 'this hosted demo only serves the example cities below — to drive YOUR repo, run CodeCity locally: github.com/FirasLatrech/codecity',
  });
}
