// 카드·상세 머리의 점수 글자와 화면 낭독 문구(#183). 서버가 준 scoreDisplay를 화면에서 다시 만들지 않는다.
import { cardRows, scoreAria } from '../../labels/ko';

// "50점 · 3/8", "참고 50점 · 3/8" (점수 · 조사한 항목 수/전체 항목 수)
const SCORE_PATTERN = /^(참고 )?(\d+)점 · (\d+)\/(\d+)$/;

/** 눈에 보이는 점수 글자. 서버 문자열 그대로 보이고, 값이 "--"일 때만 "점수 --"로 둔다. */
export function scoreText(scoreDisplay: string): string {
  return scoreDisplay === '--' ? `${cardRows.scorePrefix} ${scoreDisplay}` : scoreDisplay;
}

/** 화면 낭독 문구. 형식이 다르면 문자열을 그대로 읽게 한다. */
export function scoreAriaLabel(scoreDisplay: string): string {
  if (scoreDisplay === '--') return scoreAria.unavailable;
  const match = SCORE_PATTERN.exec(scoreDisplay);
  if (!match) return scoreDisplay;
  const [, reference, score, done, total] = match;
  return scoreAria.label(score, done, total, Boolean(reference));
}
