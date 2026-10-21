// 화면 뼈대 자리. 라우터·공통 틀(AppFrame)·목록(S1)·상세(S2)·의견(S3)은 Step 23(고선주)에서 채운다.
// 지금은 빌드·테스트 러너가 뜨는지 확인하는 최소 화면만 둔다.
import { Typography } from 'antd';
import { brand } from './config/brand';
import { banner, frame } from './labels/ko';

export default function App() {
  return (
    <main id="main">
      <Typography.Title level={1}>{brand.brandName}</Typography.Title>
      <p role="status">{banner.internalOnly}</p>
      <p>{frame.pageTitleList} 화면은 Step 23에서 만들어집니다.</p>
    </main>
  );
}
