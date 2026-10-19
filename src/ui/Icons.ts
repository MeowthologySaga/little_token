/**
 * 플랫 인라인 SVG 아이콘(이모지 금지). 단색 currentColor, 작은 크기 가독성 유지.
 * 배낭/단어장/스탯 등 UI 아이콘을 모아 둔다.
 */

import { ITEM_ART } from '@/assets'
import statAttack from '@/assets/ui/stat-icons/stat_attack.webp'
import statHeal from '@/assets/ui/stat-icons/stat_heal.webp'
import statLuck from '@/assets/ui/stat-icons/stat_luck.webp'

const bakedStatIcon = (src: string): string =>
  `<img class="baked-stat-icon" src="${src}" alt="" aria-hidden="true" draggable="false">`

export const icon = (key: string): string => {
  switch (key) {
    case 'backpack':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M14 18c0-6 4-10 10-10s10 4 10 10v22a2 2 0 01-2 2H16a2 2 0 01-2-2z" fill="currentColor" fill-opacity="0.16"/>
        <path d="M18 18v-2a6 6 0 0112 0v2"/>
        <rect x="19" y="26" width="10" height="10" rx="2" fill="currentColor" fill-opacity="0.25"/>
        <path d="M14 24h-3a2 2 0 00-2 2v8M34 24h3a2 2 0 012 2v8"/></svg>`
    case 'book': // 단어장
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M8 10h13a5 5 0 015 5v25a4 4 0 00-4-4H8z" fill="currentColor" fill-opacity="0.14"/>
        <path d="M40 10H27a5 5 0 00-5 5v25a4 4 0 014-4h14z" fill="currentColor" fill-opacity="0.14"/>
        <path d="M22 15v25"/></svg>`
    case 'bond': // 유대 — 서로를 향해 기운 두 개의 빛
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M24 39s-13-7.6-13-16.4A7.6 7.6 0 0124 18a7.6 7.6 0 0113 4.6C37 31.4 24 39 24 39z" fill="currentColor" fill-opacity="0.16"/>
        <path d="M24 12.5l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-2-3.5 2 .8-3.9-2.9-2.7 3.9-.5z" fill="currentColor" fill-opacity="0.3"/></svg>`
    case 'collection': // 카드 도감
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M9 9h25a5 5 0 015 5v25H14a5 5 0 01-5-5z" fill="currentColor" fill-opacity="0.14"/>
        <path d="M14 9v30M20 17h12M20 24h12M20 31h7"/>
        <path d="M37 5v8M33 9h8"/></svg>`
    case 'jar': // 관용구 채집통
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M15 10h18M17 10v7c-4 3-6 7-6 13 0 8 5 12 13 12s13-4 13-12c0-6-2-10-6-13v-7" fill="currentColor" fill-opacity="0.14"/>
        <path d="M16 25c5 3 11-3 16 0M20 32l3 3 6-7"/></svg>`
    case 'note': // 공략 쪽지 — 모서리를 접은 메모. 적의 능력 뱃지와 형태가 겹치면 안 된다.
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M11 8h18l8 8v24a2 2 0 01-2 2H11a2 2 0 01-2-2V10a2 2 0 012-2z" fill="currentColor" fill-opacity="0.16"/>
        <path d="M29 8v8h8"/><path d="M16 26h16M16 33h11"/></svg>`
    case 'initiative': // 선공 — 앞으로 먼저 내달리는 두 겹 화살
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round">
        <path d="M13 12l12 12-12 12" fill="currentColor" fill-opacity="0.16"/>
        <path d="M27 12l12 12-12 12" fill="currentColor" fill-opacity="0.16"/></svg>`
    case 'close':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M14 14l20 20M34 14L14 34"/></svg>`
    case 'audio':
    case 'audio-off':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M8 18h8l10-9v30L16 30H8z"/>${key === 'audio' ? '<path d="M33 16q9 8 0 16M38 9q15 15 0 30"/>' : '<path d="m33 18 10 12m0-12L33 30"/>'}</svg>`
    case 'settings':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round">
        <circle cx="24" cy="24" r="7" fill="currentColor" fill-opacity="0.16"/>
        <path d="M24 7v5M24 36v5M7 24h5M36 24h5M12 12l4 4M32 32l4 4M36 12l-4 4M16 32l-4 4"/>
        <circle cx="24" cy="24" r="14"/></svg>`
    case 'home':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M7 23 24 8l17 15"/><path d="M12 20v20h24V20" fill="currentColor" fill-opacity="0.14"/><path d="M20 40V28h8v12"/></svg>`
    case 'sword':
      return bakedStatIcon(statAttack)
    case 'shield':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round">
        <path d="M24 6l14 5v10c0 9-6 16-14 21-8-5-14-12-14-21V11z" fill="currentColor" fill-opacity="0.18"/></svg>`
    case 'heart':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round">
        <path d="M24 40S8 30 8 18a8 8 0 0116-4 8 8 0 0116 4c0 12-16 22-16 22z" fill="currentColor" fill-opacity="0.18"/></svg>`
    case 'skull':
      return `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
        <path d="M10 23C10 14.7 16.3 8 24 8s14 6.7 14 15c0 5.1-2.4 9.6-6.1 12.3V41H16.1v-5.7C12.4 32.6 10 28.1 10 23z" fill="currentColor" fill-opacity="0.16"/>
        <circle cx="18.5" cy="23" r="3.5" fill="currentColor" stroke="none"/>
        <circle cx="29.5" cy="23" r="3.5" fill="currentColor" stroke="none"/>
        <path d="M24 28l-2.5 4h5z" fill="currentColor" stroke="none"/>
        <path d="M20 36v5M24 36v5M28 36v5"/>
      </svg>`
    case 'cross': // 회복
      return bakedStatIcon(statHeal)
    case 'clover': // 행운
      return bakedStatIcon(statLuck)
    default:
      return ''
  }
}

/**
 * 아이템/보상 일러스트. 그려 둔 일러스트가 있으면 그걸 쓰고,
 * 없는 키(일반 아이템·보상 단어 아이콘)는 아래 SVG로 떨어진다.
 */
export const itemArt = (key: string): string => {
  const illus = ITEM_ART[key]
  if (illus) return `<img class="item-illus" src="${illus}" alt="" aria-hidden="true">`
  if (key === 'candle')
    return `<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="4">
      <rect x="36" y="40" width="28" height="46" rx="4" fill="currentColor" fill-opacity="0.15"/>
      <path d="M50 40v-8" /><path d="M50 20c6 6 6 12 0 16-6-4-6-10 0-16z" fill="currentColor"/></svg>`
  if (key === 'ribbon')
    return `<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="4">
      <circle cx="50" cy="46" r="8" fill="currentColor" fill-opacity="0.2"/>
      <path d="M42 42L18 30l6 20-6 8 28-6M58 42l24-12-6 20 6 8-28-6"/></svg>`
  if (key === 'word')
    return `<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="4">
      <path d="M26 20h48v60H26z" fill="currentColor" fill-opacity="0.12"/>
      <path d="M36 38h28M36 50h28M36 62h18"/></svg>`
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="4">
    <rect x="22" y="42" width="56" height="40" rx="4" fill="currentColor" fill-opacity="0.12"/>
    <path d="M18 42h64v10H18zM50 42v40"/><path d="M50 42c-8-16-24-12-16 0M50 42c8-16 24-12 16 0"/></svg>`
}
