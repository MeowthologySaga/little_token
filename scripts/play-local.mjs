/** 더블클릭 진입점. dist만 localhost에 제공하며 외부에 노출하지 않는다. */
import { createServer } from 'node:http'
import { createReadStream, existsSync, openSync, statSync, writeFileSync } from 'node:fs'
import { resolve, dirname, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const marker = 'name="little-token-fork" content="random-blanks-v1"'
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.webm': 'video/webm' }
if (process.argv.includes('--serve')) {
  const port = Number(process.argv[process.argv.indexOf('--serve') + 1])
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    let pathname
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname) } catch { res.writeHead(400); res.end(); return }
    const path = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(dist + sep) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404); res.end(); return }
    const size = statSync(path).size, headers = { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' }
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    let start = 0, end = size - 1
    if (range) {
      start = Number(range[1]); end = range[2] ? Math.min(size - 1, Number(range[2])) : end
      if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = end - start + 1
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD') res.end()
    else createReadStream(path, { start, end }).on('error', () => res.destroy()).pipe(res)
  })
  server.listen(port, '127.0.0.1', () => {
    writeFileSync(resolve(root, 'steering-player-server.json'), JSON.stringify({ pid: process.pid, port, root }))
    console.log(`Little Token: http://127.0.0.1:${port}`)
  })
} else {
  if (!existsSync(resolve(dist, 'index.html'))) throw new Error('실행 빌드가 없습니다. 먼저 npm run build를 실행해 주세요.')
  let chosen = 0
  for (let port = 3027; port <= 3037; port++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) })
      if ((await response.text()).includes(marker)) { chosen = port; break }
    } catch {
      const log = openSync(resolve(root, 'steering-player-server.log'), 'a')
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve', String(port)], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log] })
      child.unref()
      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 200))
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(600) })
          if ((await response.text()).includes(marker)) { chosen = port; break }
        } catch { /* 서버 준비 중 */ }
      }
      if (chosen) break
    }
  }
  if (!chosen) throw new Error('로컬 서버를 시작하지 못했습니다. steering-player-server.log를 확인해 주세요.')
  const url = `http://127.0.0.1:${chosen}/`
  console.log(url)
  if (!process.argv.includes('--no-open')) {
    if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).unref()
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' }).unref()
  }
}
