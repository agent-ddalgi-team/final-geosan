// [엑셀 내려받기] 단추(#217): 누르면 받은 조건 그대로 내려받기를 부르고 파일을 저장 / 실패하면 서버 말·문의 번호를 보이고 저장하지 않음.
// 서버 호출(getListXlsx)은 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportButton from '../ExportButton';
import { ApiError } from '../../../api/client';
import { getListXlsx, saveFile } from '../../../api/exportXlsx';
import { errorTexts, listExport } from '../../../labels/ko';

vi.mock('../../../api/exportXlsx', () => ({ getListXlsx: vi.fn(), saveFile: vi.fn() }));

const mockedGet = vi.mocked(getListXlsx);
const mockedSave = vi.mocked(saveFile);
const FILTERS = { process: 'ANODIZING', region: '아산시', bookmarked: 'true' };
const FILE = { blob: new Blob(['x']), fileName: '거산_추천목록_20261113.xlsx' };

describe('ExportButton (#217)', () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedSave.mockReset();
  });

  it('단추 이름은 "엑셀 내려받기"이고 무엇이 담기는지 풀이가 붙는다', () => {
    render(<ExportButton filters={FILTERS} />);
    const button = screen.getByTestId('list-export-button');
    expect(button).toHaveTextContent('엑셀 내려받기');
    expect(button).toHaveAttribute('title', listExport.hint);
    expect(listExport.hint).toContain('영업 메모와 대표번호는 담지 않습니다');
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('누르면 지금 걸러 본 조건 그대로 한 번 부르고, 받은 파일을 저장한 뒤 파일 이름을 알린다', async () => {
    const user = userEvent.setup();
    mockedGet.mockResolvedValue(FILE);
    render(<ExportButton filters={FILTERS} />);
    await user.click(screen.getByTestId('list-export-button'));
    await screen.findByTestId('list-export-done');
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(FILTERS);
    expect(mockedSave).toHaveBeenCalledWith(FILE);
    expect(screen.getByTestId('list-export-done')).toHaveTextContent(
      '거산_추천목록_20261113.xlsx 파일을 내려받았습니다. 내부용이며 고객 제출용이 아닙니다.',
    );
    expect(screen.queryByTestId('list-export-error')).not.toBeInTheDocument();
  });

  it('만드는 동안에는 단추가 잠겨 두 번 부르지 않는다', async () => {
    const user = userEvent.setup();
    let finish: (file: typeof FILE) => void = () => {};
    mockedGet.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<ExportButton filters={FILTERS} />);
    await user.click(screen.getByTestId('list-export-button'));
    expect(screen.getByTestId('list-export-button')).toBeDisabled();
    await user.click(screen.getByTestId('list-export-button'));
    expect(mockedGet).toHaveBeenCalledTimes(1);
    finish(FILE);
    await waitFor(() => expect(screen.getByTestId('list-export-button')).toBeEnabled());
  });

  it('서버가 거부하면(422) 서버가 준 말·다음 행동·문의 번호를 보이고 파일을 저장하지 않는다', async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValue(
      new ApiError(422, {
        message: '내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.',
        nextAction: '아래 번호와 함께 운영자에게 알려 주세요.',
        ref: 'abc12345',
        kind: 'EXPORT_REJECTED',
      }),
    );
    render(<ExportButton filters={FILTERS} />);
    await user.click(screen.getByTestId('list-export-button'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(listExport.failed);
    expect(alert).toHaveTextContent('내보낼 수 없는 항목이 있어 엑셀 파일을 만들지 않았습니다.');
    expect(alert).toHaveTextContent('아래 번호와 함께 운영자에게 알려 주세요.');
    expect(alert).toHaveTextContent(`${errorTexts.refPrefix} abc12345`);
    expect(alert).not.toHaveTextContent('EXPORT_REJECTED');
    expect(mockedSave).not.toHaveBeenCalled();
    expect(screen.queryByTestId('list-export-done')).not.toBeInTheDocument();
  });

  it('서버에 닿지 못하면 연결 안내를 보이고, 다시 눌러 성공하면 안내가 사라진다', async () => {
    const user = userEvent.setup();
    mockedGet.mockRejectedValueOnce(new TypeError('failed'));
    mockedGet.mockResolvedValueOnce(FILE);
    render(<ExportButton filters={FILTERS} />);
    await user.click(screen.getByTestId('list-export-button'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(errorTexts.network);
    expect(alert).not.toHaveTextContent(errorTexts.refPrefix);
    await user.click(screen.getByTestId('list-export-button'));
    await screen.findByTestId('list-export-done');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedSave).toHaveBeenCalledTimes(1);
  });
});
