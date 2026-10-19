import type { ExclaimWord, StatKey } from '@data/items'

/** 원본 제련의 선택과 난수 결과를 재개하기 위한 데이터. DOM/타이머는 저장하지 않는다. */
export interface ItemForgeCheckpoint {
  picks: Record<string, string | undefined>
  slotIndex: number
  multipliers: [number, number, number]
  choices: Record<string, ExclaimWord[]>
  blessed: Array<[string, { stat: StatKey; n: number }]>
}
