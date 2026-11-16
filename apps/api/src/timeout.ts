/** 超时判定的纯逻辑，便于单测覆盖各种时序 */

export const TIMEOUT_GRACE_MS = 200;

export interface TimeoutCheck {
  now: number;
  deadline: number | undefined;
  /** 本次计时开始时的历史步数 */
  movesAtStart: number | undefined;
  /** 当前历史步数 */
  currentMoves: number;
  /** 是否已安排过宽限重预约 */
  graceScheduled: boolean | undefined;
}

export type TimeoutDecision =
  | { action: 'wait' } // 还没到期，或正在等宽限
  | { action: 'reschedule'; at: number } // 首次到期，安排一次宽限重预约
  | { action: 'judge' } // 确认超时，判负
  | { action: 'skip' }; // 已有新走子或状态变化，本次 alarm 作废

/** alarm 醒来时的判定 */
export function decideAlarm(c: TimeoutCheck): TimeoutDecision {
  if (c.deadline === undefined) return { action: 'skip' };

  // alarm 比 deadline 稍早触发：只重预约一次宽限，让在途走子有机会到达
  if (c.now < c.deadline + TIMEOUT_GRACE_MS && !c.graceScheduled) {
    return { action: 'reschedule', at: c.deadline + TIMEOUT_GRACE_MS };
  }
  // 宽限期内已有新走子——旧 alarm 作废，新走子已重新计时
  if (c.movesAtStart !== undefined && c.currentMoves > c.movesAtStart) {
    return { action: 'skip' };
  }
  return { action: 'judge' };
}

/** 走子到达时的判定：是否还在可接受的宽限窗口内 */
export function canMoveAt(now: number, deadline: number | undefined): boolean {
  if (deadline === undefined) return true;
  return now <= deadline + TIMEOUT_GRACE_MS;
}
