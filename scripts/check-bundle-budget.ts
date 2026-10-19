import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const distArg = process.argv.find((arg) => arg.startsWith('--dist='))?.slice('--dist='.length)
const dist = resolve(distArg || 'dist')
const edition = process.argv.find((arg) => arg.startsWith('--edition='))?.slice('--edition='.length)
const demoForbiddenAssets = ['enemy_worker_bee', 'boss_queen_bee', 'boss_elder_spider', 'boss-queen-bee', 'boss-elder-spider']
const limits: Record<string, { raw: number; gzip: number }> = {
  '.js': { raw: 700 * 1024, gzip: 190 * 1024 },
  // 원본 CSS는 gzip 예산 안에 있지만 구성상 270KB를 조금 넘는다. 압축 예산은 유지하고
  // 현재 원본 크기와 출시 직전 오류 복구 UI를 정직하게 포함하도록 원본 한도만 올린다.
  // 포크의 분리된 기본 진입점에서 공용 CSS가 274.3KiB다. 전송(gzip) 예산은 유지한다.
  '.css': { raw: 275 * 1024, gzip: 60 * 1024 },
}

const files: string[] = []
const allFiles: string[] = []
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else {
      allFiles.push(path)
      if (limits[extname(path)]) files.push(path)
    }
  }
}
walk(dist)

const violations: string[] = []
if (edition) {
  const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8')
  if (!indexHtml.includes(`name="little-token-edition" content="${edition}"`)) {
    violations.push(`index.html: 기대 에디션 ${edition} 표식이 없음`)
  }
}
const editionBudgets = edition === 'demo'
  ? { total: 76, '.glb': 38, '.webm': 16, '.mp3': 11, '.woff2': 1.1 }
  : edition === 'full'
    ? { total: 102, '.glb': 58, '.webm': 16, '.mp3': 16, '.woff2': 1.1 }
    : null
if (editionBudgets) {
  const bytesByExtension = new Map<string, number>()
  let totalBytes = 0
  for (const path of allFiles) {
    const bytes = statSync(path).size
    totalBytes += bytes
    const ext = extname(path)
    bytesByExtension.set(ext, (bytesByExtension.get(ext) ?? 0) + bytes)
  }
  const totalMb = totalBytes / (1024 * 1024)
  if (totalMb > editionBudgets.total) violations.push(`전체 ${totalMb.toFixed(2)}MB > ${editionBudgets.total}MB`)
  for (const [ext, maxMb] of Object.entries(editionBudgets)) {
    if (ext === 'total') continue
    const mb = (bytesByExtension.get(ext) ?? 0) / (1024 * 1024)
    if (mb > maxMb) violations.push(`${ext} 합계 ${mb.toFixed(2)}MB > ${maxMb}MB`)
  }
  if (edition === 'demo') {
    for (const path of allFiles) {
      const name = relative(dist, path).replaceAll('\\', '/')
      if (demoForbiddenAssets.some((stem) => name.includes(stem))) violations.push(`${name}: 데모 후반 전용 자원 포함`)
    }
  }
}
const forbiddenProductionMarkers = ['DEV CHEAT', '개발 치트 열기', 'data-stage-jump']
let largestJs = { name: '', raw: 0, gzip: 0 }
for (const path of files) {
  const data = readFileSync(path)
  const gzip = gzipSync(data).byteLength
  const raw = data.byteLength
  const ext = extname(path)
  const limit = limits[ext]
  const name = relative(dist, path).replaceAll('\\', '/')
  if (ext === '.js' && gzip > largestJs.gzip) largestJs = { name, raw, gzip }
  if (ext === '.js') {
    const source = data.toString('utf8')
    for (const marker of forbiddenProductionMarkers) {
      if (source.includes(marker)) violations.push(`${name}: 프로덕션 금지 표식 포함 (${marker})`)
    }
    if (edition === 'demo') {
      for (const stem of demoForbiddenAssets) {
        if (source.includes(`/assets/${stem}-`)) violations.push(`${name}: 제거된 후반 자원 URL이 남음 (${stem})`)
      }
    }
  }
  if (raw > limit.raw) violations.push(`${name}: 원본 ${(raw / 1024).toFixed(1)}KB > ${limit.raw / 1024}KB`)
  if (gzip > limit.gzip) violations.push(`${name}: gzip ${(gzip / 1024).toFixed(1)}KB > ${limit.gzip / 1024}KB`)
}

if (violations.length) {
  console.error(`번들 예산 위반 ${violations.length}건:\n- ${violations.join('\n- ')}`)
  process.exit(1)
}
console.log(
  `번들 예산·치트 비활성 검사 통과 — 최대 JS ${largestJs.name} · 원본 ${(largestJs.raw / 1024).toFixed(1)}KB · gzip ${(largestJs.gzip / 1024).toFixed(1)}KB`,
)
