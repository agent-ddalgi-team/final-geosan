import type { ContactBucket, Meta } from '../../api/types';
import { contactBuckets } from '../../labels/ko';
import './LeadsStatTiles.css';

// 임시 화면(시연용): 참고 그림(Leads)의 맨 위 숫자 카드 줄. 기존 화면은 그대로 두고 그 위에 더해 본다.
// 숫자는 서버가 준 목록 응답(meta)의 값이다. 새 약속·새 API는 없다. 값이 없으면 칸을 그리지 않는다.
const ORDER: Array<[ContactBucket, string]> = [
  ['EVIDENCE_READY', 'ready'],
  ['EVIDENCE_SOME', 'some'],
  ['NO_HOMEPAGE', 'none'],
  ['NOT_RESEARCHED', 'before'],
  ['CLOSED', 'closed'],
];

export default function LeadsStatTiles({ meta }: { meta: Meta | null }) {
  const counts = meta?.bucketCounts;
  if (!counts) return null;
  return (
    <div className="lst" data-testid="leads-stat-tiles">
      {ORDER.map(([bucket, tone]) => (
        <div className="lst-tile" key={bucket}>
          <span className={`lst-icon lst-${tone}`} aria-hidden="true" />
          <div>
            <div className="lst-label">{contactBuckets.titles[bucket]}</div>
            <div className="lst-num">{String(counts[bucket] ?? 0).padStart(2, '0')}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
