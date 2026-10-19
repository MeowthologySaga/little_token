/**
 * 단어 카드 앞면의 유일한 마크업.
 *
 * 손패(`ui/CardHand.ts`)와 손패 밖 화면(도움말 등)이 같은 함수를 쓴다 —
 * 설명서에 그려지는 카드가 전투에서 집는 카드와 한 글자도 다르지 않게 한다.
 */

import { INK_UI, SKILL_ART } from '@/assets'
import { currentLocale, t, type LocaleCode } from '@/localization'
import { emotionIconBadge } from '@/ui/EmotionBadge'
import { icon } from '@/ui/Icons'
import { emotionOrNeutral, type Word } from '@core/types'
import { wordNoteText } from '@core/wordText'
import { wordInkCost } from '@core/ink'
import { wordKeywords } from '@core/wordKeywords'

/** 제목을 한 줄에 온전히 남기되, 카드 폭을 넘는 경우에만 글자를 줄인다. */
export function cardTitleStyle(text: string, illustrated = false): string {
  const maxSize = illustrated ? 27 : 24
  const availableWidth = illustrated ? 140 : 126
  const widthUnits = Array.from(text).reduce((sum, char) => {
    if (/\s/.test(char)) return sum + 0.35
    if (/[\u0000-\u00ff]/.test(char)) return sum + 0.62
    return sum + 1
  }, 0)
  const fittedSize = Math.max(12, Math.min(maxSize, (availableWidth * 0.92) / Math.max(1, widthUnits)))
  return `style="--card-title-size:${fittedSize.toFixed(1)}px"`
}

/** 카드 색감(--wglow): 공격=붉음 · 방어=파랑 · 회복=초록 · 도박=보라. */
export function wordMood(word: Word): string {
  if (word.variance) return 'gamble'
  if (word.kind === 'heal' || word.effects?.heal) return 'heal'
  if (word.kind === 'guard' || word.effects?.guard) return 'guard'
  if (word.kind === 'attack' || (word.power ?? 0) > 0) return 'attack'
  if (word.effects?.recoil) return 'sacrifice'
  return 'buff'
}

/** 일러스트가 없는 카드의 대체 문양. */
export function wordArtGlyph(word: Word): string {
  if (word.variance) return '✧'
  if (word.kind === 'heal' || word.effects?.heal) return '✚'
  if (word.kind === 'guard' || word.effects?.guard) return '◇'
  if (word.kind === 'attack' || word.power) return '↗'
  if (word.effects?.recoil) return '※'
  return '✦'
}

/** 동사는 카드 문구를 읽기 전에도 공격·방어·회복 역할을 알아볼 수 있게 한다. */
const ACTION_LABELS: Record<LocaleCode, Record<'attack' | 'guard' | 'heal', string>> = {
  ko: { attack: '공격', guard: '방어', heal: '회복' },
  en: { attack: 'Attack', guard: 'Guard', heal: 'Heal' },
  ja: { attack: '攻撃', guard: '防御', heal: '回復' },
  ru: { attack: 'Атака', guard: 'Защита', heal: 'Лечение' },
  'zh-Hans': { attack: '攻击', guard: '防御', heal: '恢复' },
  'zh-Hant': { attack: '攻擊', guard: '防禦', heal: '恢復' },
}

type CardActionKind = 'attack' | 'guard' | 'heal'

function wordActionKind(word: Word): CardActionKind | null {
  if (word.slot !== 'verb' && word.slot !== 'verb2') return null
  return word.kind === 'heal' || word.effects?.heal
    ? 'heal'
    : word.kind === 'guard' || word.effects?.guard
      ? 'guard'
      : 'attack'
}

function actionGlyph(kind: CardActionKind): 'sword' | 'shield' | 'cross' {
  return kind === 'heal' ? 'cross' : kind === 'guard' ? 'shield' : 'sword'
}

export function wordCardDisplayNote(word: Word, note = wordNoteText(word)): string {
  const actionKind = wordActionKind(word)
  if (!actionKind) return note
  const label = ACTION_LABELS[currentLocale][actionKind]
  const parts = note.split(' · ')
  const first = parts[0]?.trim()
  if (!first?.startsWith(label)) return note
  const compact = first.slice(label.length).trim().replace(/^\+\s*/, '')
  return [compact, ...parts.slice(1)].filter(Boolean).join(' · ')
}

/** 카드 앞면의 주행동 수치. 키워드는 바로 아래 전용 칩에서 한 번만 보여 준다. */
export function wordCardPrimaryNote(word: Word, note = wordNoteText(word)): string {
  const keywords = wordKeywords(word)
  if (!keywords.length) return wordCardDisplayNote(word, note)
  if (word.statMult != null) return `×${word.statMult}`
  if (word.variance) return wordCardDisplayNote(word, note).split(' · ')[0]
  if (word.bonus) return `×${(1 + word.bonus).toFixed(2)}`
  return ''
}

export function wordActionInline(word: Word): string {
  const actionKind = wordActionKind(word)
  if (!actionKind) return ''
  const label = ACTION_LABELS[currentLocale][actionKind]
  return `<span class="card-action-inline action-${actionKind}">${icon(actionGlyph(actionKind))}<b>${label}</b></span>`
}

const escapeCardText = (value: string) => value
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function wordKeywordChipsHtml(word: Word): string {
  const keywords = wordKeywords(word)
  return keywords.length
    ? `<span class="card-keywords">${keywords.map((keyword) => `<span class="card-keyword keyword-${keyword.id}" tabindex="0" role="definition" aria-label="${escapeCardText(`${keyword.label}. ${keyword.detail}`)}" data-tip-title="${escapeCardText(keyword.label)}" data-tip-kind="keyword" data-tip-place="above" data-tooltip="${escapeCardText(keyword.detail)}">${keyword.label}</span>`).join('')}</span>`
    : ''
}

export function wordKeywordDetailsHtml(word: Word): string {
  const keywords = wordKeywords(word)
  if (!keywords.length) return ''
  const heading = t('wordKeywords', '키워드')
  return `<section class="word-keyword-details" aria-label="${heading}">
    <h3>${heading}</h3>
    <div class="word-keyword-list">${keywords.map((keyword) => `
      <div class="word-keyword-detail keyword-${keyword.id}">
        <b>${keyword.label}</b>
        <span>${keyword.detail}</span>
      </div>`).join('')}</div>
  </section>`
}

function wordCardNoteHtml(word: Word, note: string): string {
  const action = wordActionInline(word)
  // 선택 불가 사유처럼 호출부가 갈아 끼운 문구는 그대로 보여 주고, 정상 카드만
  // 주행동과 키워드를 분리한다. 키워드 이름을 요약 줄과 칩에 두 번 쓰지 않는다.
  const displayNote = note === wordNoteText(word) ? wordCardPrimaryNote(word, note) : note
  const keywordHtml = wordKeywordChipsHtml(word)
  return `<span class="card-note${action ? ' has-action' : ''}">${action}${displayNote ? `<span class="card-note-text">${displayNote}</span>` : ''}${keywordHtml}</span>`
}

export interface WordCardFaceOpts {
  /** 포크 개념 카드: 성분/잉크 대신 현재 위치의 활용을 표시한다. */
  concept?: { glyph: string; badge: string }
  /** 선택 불가 사유처럼 카드 문구를 갈아 끼울 때 쓴다. 기본은 단어의 note. */
  note?: string
  /** 일러스트 없는 카드 하단의 작은 글자. */
  footer?: string
  /** 거미줄 봉인처럼 앞면 위에 덮는 겹. */
  overlay?: string
  /** 스킬 카드 외의 화면에서 공용 앞면에 넣을 별도 일러스트 URL. */
  artUrl?: string
  /** 튜토리얼 대사처럼 감정과 잉크 정보가 의미 없는 카드에서 메타 배지를 숨긴다. */
  hideMeta?: boolean
  /** 잉크 비용은 남기되 감정 아이콘만 의미 없는 화면에서 숨긴다. */
  hideEmotion?: boolean
}

/** 카드 앞면 한 겹. 일러스트가 있으면 원화 카드, 없으면 문양 카드로 그린다. */
export function wordCardFrontHtml(word: Word, opts: WordCardFaceOpts = {}): string {
  const { note = wordNoteText(word), footer = 'WORD CARD', overlay = '', hideMeta = false, hideEmotion = false } = opts
  const artUrl = opts.artUrl ?? (word.art ? SKILL_ART[word.art] : undefined)
  if (opts.concept) {
    return `<span class="card-face card-front concept-front">
      ${artUrl ? `<img class="concept-illustration" src="${artUrl}" alt="" />` : ''}
      <span class="concept-glyph" aria-hidden="true">${opts.concept.glyph}</span>
      <span class="concept-badge">${opts.concept.badge}</span>
      <strong class="concept-name">${word.text}</strong>
      <span class="concept-note" title="${escapeCardText(note)}">${note}</span>
      ${overlay}
    </span>`
  }
  const emotion = emotionOrNeutral(word.emotion)
  const inkCost = wordInkCost(word)
  const inkCostStyle = `style="--ink-cost-badge-image:url('${INK_UI.costBadge}')"`
  const emotionBadge = hideMeta || hideEmotion ? '' : emotionIconBadge(emotion, 'card-emotion')
  const costBadge = hideMeta ? '' : `<span class="card-cost" ${inkCostStyle} title="잉크 비용" aria-label="잉크 ${inkCost}">${inkCost}</span>`
  const resourceBadge = hideMeta
    ? ''
    : `<span class="card-resource-meta${hideEmotion ? ' without-emotion' : ''}">${emotionBadge}${costBadge}</span>`
  const badges = resourceBadge
  if (artUrl) {
    // 이름과 효과는 한 덩이로 아래에 붙인다. 둘을 따로 바닥에 못 박아 두면 효과가 세 줄로
    // 늘어난 카드에서 글자가 이름 위로 올라타 서로를 지운다.
    return `<span class="card-face card-front art">
          <img class="card-illus" src="${artUrl}" alt="" aria-hidden="true" />
          <span class="card-tint" aria-hidden="true"></span>
          <span class="card-veil" aria-hidden="true"></span>
          <span class="card-foil" aria-hidden="true"></span>
          ${badges}
          <span class="card-caption">
            <strong class="card-title" ${cardTitleStyle(word.text, true)}>${word.text}</strong>
            ${wordCardNoteHtml(word, note)}
          </span>
          ${overlay}
        </span>`
  }
  return `<span class="card-face card-front">
          <span class="card-foil" aria-hidden="true"></span>
          ${badges}
          <span class="card-art" aria-hidden="true"><i></i><b>${wordArtGlyph(word)}</b></span>
          <strong class="card-title" ${cardTitleStyle(word.text)}>${word.text}</strong>
          ${wordCardNoteHtml(word, note)}
          <small>${footer}</small>
          ${overlay}
        </span>`
}

/** 버튼·도움말처럼 손패 밖에서 카드를 쓸 때도 앞면과 내부 구조를 그대로 공유한다. */
export function wordCardInnerHtml(word: Word, opts: WordCardFaceOpts = {}): string {
  return `<span class="card-lift"><span class="card-inner">${wordCardFrontHtml(word, opts)}</span></span>`
}

/**
 * 손패 밖에 한 장만 세우는 정적 카드. 손패 좌표 변수(--card-x/--card-z)를
 * 0으로 고정하므로 감싸는 칸이 크기만 잡아 주면 된다.
 */
export function wordCardHtml(word: Word, className = ''): string {
  const emotion = emotionOrNeutral(word.emotion)
  const rarity = word.rarity ?? 'common'
  return `<span class="word-card mood-${wordMood(word)} emotion-${emotion} rarity-${rarity}${className ? ` ${className}` : ''}"
      style="--card-x:0px;--card-z:1" aria-hidden="true">
      ${wordCardInnerHtml(word)}
    </span>`
}
