// Serves the web app the way the end-to-end tests need it: a production export (`expo export`)
// with the end-to-end seams on (EXPO_PUBLIC_E2E=1: the "Use test photo" button), against the
// local Supabase stack in apps/app/.env. Playwright starts it (see playwright.config.ts).
//
// An export rather than `expo start --web`: it is the artifact that ships (the same minified
// bundle EAS Hosting serves), it is built once up front instead of on the first request (a dev
// server's first bundle can outlast a test's timeout), and it has no dev overlay, hot reload
// socket or development-mode warnings to get in a test's way.
//
// The export goes to node_modules/.cache/e2e-web, not under dist/, which is what gets deployed: a
// hosted web build must never carry this one. EXPO_PUBLIC_E2E is set only for this child process;
// no script or file sets it for a production build.
//
// Node runs this file directly (type stripping), so it uses only erasable syntax.
import { execFileSync } from 'node:child_process'
import { createReadStream, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = fileURLToPath(new URL('../..', import.meta.url))
const exportDir = 'node_modules/.cache/e2e-web'
const outputDir = join(appRoot, exportDir)
const port = Number(process.env.E2E_WEB_PORT ?? 8099)

execFileSync('pnpm', ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', exportDir], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_E2E: '1' },
})

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

/**
 * The file for a URL path, the way a static host picks it: the file itself, else the route's own
 * page (`/sign-in` is `sign-in.html`; the export is static, one page per route). A route with no
 * page of its own, such as a pet's profile (its id is not known at build time), gets the app's
 * first page, which carries the whole app and takes over on the client.
 */
function fileFor(urlPath: string): string {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^[/\\]+/, '')
  const candidate = join(outputDir, relative)
  // Never leave the export folder, however the path is written.
  if (candidate !== outputDir && !candidate.startsWith(outputDir + sep)) {
    return join(outputDir, 'index.html')
  }
  const page = extname(relative) === '' ? `${candidate}.html` : candidate
  for (const file of [candidate, page]) {
    try {
      if (statSync(file).isFile()) return file
    } catch {
      // Not a file: try the next.
    }
  }
  return extname(relative) === '' ? join(outputDir, 'index.html') : candidate
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const file = fileFor(url.pathname)
  const stream = createReadStream(file)
  stream.on('open', () => {
    response.writeHead(200, {
      'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    if (request.method === 'HEAD') {
      response.end()
      stream.destroy()
    } else {
      stream.pipe(response)
    }
  })
  stream.on('error', () => {
    response.writeHead(404)
    response.end()
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`e2e web build on http://127.0.0.1:${port}`)
})
