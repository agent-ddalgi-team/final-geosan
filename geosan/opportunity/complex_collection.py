"""C5: 선택 지역의 파일 단지와 추가 단지를 조회해 파일 원문 우선으로 합친다(#404).

전체 후보 찾기 실행·회사 등록·캐시 저장은 하지 않는다. 호출자는 미완료 사유를 보존해야 한다.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import InputError
from geosan.opportunity.complex_rows import (
    CombinedFactoryRows,
    ComplexSourceError,
    combine_factory_rows,
)
from geosan.opportunity.complex_source import (
    ComplexLookupResult,
    complex_settings,
    fetch_complex_list,
    validate_complex_name,
)
from geosan.opportunity.factory_csv import FactoryRow
from geosan.opportunity.ingest_errors import storage_failure


@dataclass(frozen=True)
class ComplexCollectionResult:
    combined: CombinedFactoryRows
    lookups: tuple[tuple[str, ComplexLookupResult], ...]
    skipped_reason: str | None
    batch_id: str | None = None
    regions: tuple[str, ...] = ()
    extra_names: tuple[str, ...] = ()


def collect_complex_rows(
    batch_id: str, file_rows: Sequence[FactoryRow], *, db_path: Path | str | None = None
) -> ComplexCollectionResult:
    """승인된 파일을 읽고 지역을 추린 뒤 부른다. 한 단지 실패 시 받은 데까지 유지한다.

    파일의 단지 순서, 설정의 추가 단지 순서대로 부르며 같은 이름은 한 번만 부른다.
    결과는 입력 파일 행과 추가 조회 행을 구분한다. 미완료를 회차에 기록하는 것은 호출자 책임.
    """
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    combined = combine_factory_rows(file_rows, ())
    try:
        regions, config = complex_settings(batch_id, db_path)
        if any(row.region not in regions for row in file_rows):
            raise InputError("회차의 찾기 지역으로 추린 공장 파일 행만 넘겨 주세요.")
        if not config.enabled:
            return ComplexCollectionResult(
                combined, (), "DISABLED", batch_id, regions, tuple(config.extra_names)
            )
        extra_names = tuple(config.extra_names)
        names = tuple(
            dict.fromkeys(
                validate_complex_name(name)
                for name in [
                    *(row.complex_name for row in file_rows if row.complex_name),
                    *extra_names,
                ]
            )
        )
        lookups, api_rows, all_rows, reason = [], (), (), None
        for name in names:
            current_regions, current_config = complex_settings(batch_id, db_path)
            if (
                set(current_regions) != set(regions)
                or tuple(current_config.extra_names) != extra_names
            ):
                raise InputError("조회하는 동안 찾기 지역이나 추가 단지 설정이 바뀌었습니다.")
            if not current_config.enabled:
                reason = "DISABLED"
                break
            result = fetch_complex_list(batch_id, name, db_path=db_path)
            lookups.append((name, result))
            try:
                incoming = result.all_rows if result.all_rows is not None else result.rows
                combine_factory_rows((), all_rows + incoming)
                combined = combine_factory_rows(file_rows, api_rows + result.rows)
            except ComplexSourceError:
                reason = "SOURCE_ERROR"
                lookups[-1] = (
                    name,
                    replace(
                        result, rows=(), all_rows=(), skipped_reason=reason, cached_fetch_id=None
                    ),
                )
                break
            # 파일과 겹치는 행도 다음 조회와 관리번호 충돌을 검사할 수 있게 보존한다.
            api_rows += result.rows
            all_rows += incoming
            if result.skipped_reason:
                reason = result.skipped_reason
                break
        current_regions, current_config = complex_settings(batch_id, db_path)
        if set(current_regions) != set(regions) or tuple(current_config.extra_names) != extra_names:
            raise InputError("조회하는 동안 찾기 지역이나 추가 단지 설정이 바뀌었습니다.")
        if not current_config.enabled:
            reason = "DISABLED"
        return ComplexCollectionResult(
            combined, tuple(lookups), reason, batch_id, regions, extra_names
        )
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="factory", message="단지 조회 설정을 읽지 못했습니다."
        ) from None
