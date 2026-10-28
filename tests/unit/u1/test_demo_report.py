"""예비 경로 단위 테스트 (Step 32·33): 사례 파일 → 엔진 입력 변환기와 `demo-report` 명령.

계획의 5개(A정밀 기대값, 소개서 묶음 참고 점수, 연락처 거부, 두 번 같은 결과, 머리 표시)에
변환기 검사 4개를 더했다. DB를 쓰지 않는다. 모든 데이터는 가상이다.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.commands.demo_report import HEADER_MARK, VIRTUAL_MARK, build_report, run_demo_report
from geosan.config.errors import InputError
from geosan.evaluation.file_input import capability_snapshot, load_file_inputs, process_id_for
from geosan.rules.codes import DatasetKind
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
DATA = Path(__file__).resolve().parents[3] / "tests" / "data"
CAPABILITY = EXAMPLES / "capability-geosan.json"
BROCHURE_CAPABILITY = DATA / "capability-brochure.json"


def _write(directory: Path, name: str, data: dict[str, Any]) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _apjeong_dir(tmp_path: Path) -> Path:
    cases = tmp_path / "cases"
    _write(cases, "case-apjeong.json", factories.apjeong_case())
    return cases


def _run(*args: str) -> tuple[int, str]:
    result = CliRunner().invoke(app, list(args), catch_exceptions=False)
    return result.exit_code, result.output


# ---------------------------------------------------------------------------
# 변환기 (Step 32)
# ---------------------------------------------------------------------------


def test_converter_builds_apjeong_input_like_snapshot(tmp_path: Path) -> None:
    """A정밀 파일을 변환하면 ID·연결·운영 전제가 스냅샷 규칙대로 채워진다."""
    inputs = load_file_inputs(CAPABILITY, _apjeong_dir(tmp_path))
    assert inputs.dataset_kind == DatasetKind.VIRTUAL_REVIEWED
    case = inputs.cases[0]
    ei = case.evaluation_input
    assert ei.opportunity.opp_id == "opp-apjeong-valve-anodizing"
    assert ei.base_date == date(2026, 10, 20)  # 파일의 baseDate
    assert ei.process_links[0].process_id == process_id_for("ANODIZING") == "proc-anodizing"
    assert (
        ei.requirements[0].link_id == ei.process_links[0].link_id
    )  # PROCESS_LINK 요구는 연결에 묶인다
    assert ei.operational_ready is True
    by_code = {item.item_code: item for item in ei.item_inputs}
    assert by_code["NEW_MATERIAL"].match_rate == 1.0
    assert by_code["NEW_MATERIAL"].match_rate_step == "정확히 일치"
    assert by_code["NEW_MATERIAL"].used_capability_ids == ["cap-anodizing-02", "proc-anodizing"]
    assert by_code["NEW_RECORD"].used_capability_ids == ["rec-anodizing-01"]
    # 신호의 근거는 그 신호를 가리키는 항목 입력의 근거로 이어진다
    assert ei.signals[0].evidence_ids == ["ev-apjeong-valve-anodizing-0001"]
    assert ei.signals[1].evidence_ids == ["ev-apjeong-valve-anodizing-0004"]


def test_converter_base_date_argument_wins_and_missing_date_fails(tmp_path: Path) -> None:
    """기준일은 인자 > 파일 baseDate > 오류 순이다."""
    cases = _apjeong_dir(tmp_path)
    inputs = load_file_inputs(CAPABILITY, cases, base_date=date(2026, 10, 27))
    assert inputs.cases[0].evaluation_input.base_date == date(2026, 10, 27)

    data = factories.apjeong_case()
    data["baseDate"] = None
    no_date = tmp_path / "no-date"
    _write(no_date, "case.json", data)
    with pytest.raises(InputError, match="기준일이 없습니다"):
        load_file_inputs(CAPABILITY, no_date)


def test_converter_rejects_whole_run_when_one_file_has_contact(tmp_path: Path) -> None:
    """한 파일에 연락처가 있으면 나머지가 멀쩡해도 전체가 실패한다(건너뛰지 않음)."""
    cases = _apjeong_dir(tmp_path)
    bad = factories.brochure_case("b-company-zinc")
    bad["evidence"][0]["quote"] = "담당자에게 문의: sales@example.com (가상)"
    _write(cases, "b-company.json", bad)
    with pytest.raises(InputError) as info:
        load_file_inputs(CAPABILITY, cases)
    assert "b-company.json" in info.value.message
    assert any("연락처는 저장하지 않습니다" in f.message for f in info.value.fields)


def test_converter_dataset_kind_follows_capability_and_warns_on_mismatch(tmp_path: Path) -> None:
    """묶음은 역량 파일을 따르고, 사례 파일 묶음이 다르면 경고만 낸다. 자격 현재 상태도 채운다."""
    cases = tmp_path / "cases"
    _write(cases, "b.json", factories.brochure_case("b-company-zinc"))  # datasetKind BROCHURE
    inputs = load_file_inputs(CAPABILITY, cases)  # 역량 파일은 VIRTUAL_REVIEWED
    assert inputs.dataset_kind == DatasetKind.VIRTUAL_REVIEWED
    assert any("묶음" in w and "다릅니다" in w for w in inputs.warnings)
    snapshot = capability_snapshot(inputs.capability)
    assert {q.qual_id for q in snapshot.qualifications} == {"qual-01", "qual-02", "qual-03"}
    assert snapshot.qualifications[0].current_status == "ACTIVE"


# ---------------------------------------------------------------------------
# demo-report (Step 33)
# ---------------------------------------------------------------------------


def test_demo_report_apjeong_is_rank_one_contact_urgent_with_expected_scores(
    tmp_path: Path,
) -> None:
    """A정밀 1건으로 돌리면 순위 1·CONTACT_URGENT·E77/P95/S81.1/R82가 나온다."""
    report = build_report(CAPABILITY, _apjeong_dir(tmp_path))
    assert len(report.rows) == 1
    row = report.rows[0]
    assert row.rank == 1
    assert row.output.classification_code == "CONTACT_URGENT"
    totals = row.output.totals
    assert (totals.E, totals.P, totals.R) == (77, 95, 82)
    assert totals.S == pytest.approx(81.1)
    assert totals.C == pytest.approx(87.5)
    assert row.classification_label == "지금 바로 연락 검토"
    assert row.is_contact_candidate

    out = tmp_path / "out"
    code, output = _run(
        "demo-report",
        "--capability",
        str(CAPABILITY),
        "--cases",
        str(_apjeong_dir(tmp_path)),
        "--out",
        str(out),
    )
    assert code == 0, output
    assert "접촉 후보 1곳" in output
    csv_text = (out / "ranking.csv").read_text(encoding="utf-8-sig")
    assert "A정밀" in csv_text and "지금 바로 연락 검토" in csv_text and ",77점 · 7/8," in csv_text
    assert (out / "companies" / "01-A정밀.md").exists()
    assert (out / "facts" / "01-A정밀.md").exists()


def test_demo_report_brochure_dataset_gives_reference_scores_and_no_contact(tmp_path: Path) -> None:
    """소개서 묶음이면 점수는 '참고 N'으로 보이고 접촉 후보는 없다(BR5.6)."""
    cases = tmp_path / "cases"
    _write(cases, "b.json", factories.brochure_case("b-company-zinc"))
    _write(cases, "c.json", factories.brochure_case_with_lower_material("c-company-anod"))
    report = build_report(BROCHURE_CAPABILITY, cases, base_date=date(2026, 10, 27))
    assert report.dataset_kind == DatasetKind.BROCHURE
    assert [row.rank for row in report.rows] == [1, 2]
    assert all(not row.is_contact_candidate for row in report.rows)
    assert all(row.output.display.score_display.startswith("참고 ") for row in report.rows)
    assert all(row.output.display.blocks_approval for row in report.rows)
    # E가 높은 쪽(소재 정확히 일치)이 앞에 온다(소개서 묶음 OTHER 정렬: E 내림)
    assert report.rows[0].file_case.case_id == "b-company-zinc"

    out = tmp_path / "out"
    code, output = _run(
        "demo-report",
        "--capability",
        str(BROCHURE_CAPABILITY),
        "--cases",
        str(cases),
        "--out",
        str(out),
        "--base-date",
        "2026-10-27",
    )
    assert code == 0, output
    assert "접촉 후보 0곳" in output
    facts = (out / "facts" / "01-b-company-zinc-가상회사.md").read_text(encoding="utf-8")
    assert "소개서 기준·거산 확인 전" in facts
    assert (
        "ISO 9001" in facts and "VIRTUAL-BROCHURE-ISO9001-0001" in facts
    )  # 인증 번호·유효기간도 적는다


def test_demo_report_with_contact_writes_nothing_and_exits_1(tmp_path: Path) -> None:
    """연락처 패턴이 있으면 출력 폴더에 아무것도 쓰지 않고 종료 코드 1."""
    cases = _apjeong_dir(tmp_path)
    bad = factories.brochure_case("b-company-zinc")
    bad["customer"]["identityBasis"] = "대표 전화 02-1234-5678 (가상)"
    _write(cases, "b.json", bad)
    out = tmp_path / "out"
    code, output = _run(
        "demo-report", "--capability", str(CAPABILITY), "--cases", str(cases), "--out", str(out)
    )
    assert code == 1, output
    assert "연락처는 저장하지 않습니다" in output and "아무것도 쓰지 않았습니다" in output
    assert not out.exists() or not any(out.rglob("*"))


def test_demo_report_runs_twice_with_identical_output(tmp_path: Path) -> None:
    """같은 입력으로 두 번 돌리면 모든 파일이 바이트까지 같다(현재 시각을 쓰지 않음, NFR1)."""
    cases = _apjeong_dir(tmp_path)
    _write(cases, "b.json", factories.brochure_case("b-company-zinc"))
    outputs: list[dict[str, bytes]] = []
    for name in ("out-a", "out-b"):
        out = tmp_path / name
        assert run_demo_report(CAPABILITY, cases, out, "2026-10-27", echo=lambda _: None) == 0
        outputs.append(
            {
                p.relative_to(out).as_posix(): p.read_bytes()
                for p in sorted(out.rglob("*"))
                if p.is_file()
            }
        )
    assert outputs[0] == outputs[1]
    assert set(outputs[0]) == {
        "ranking.csv",
        "ranking.html",
        "companies/01-A정밀.md",
        "companies/02-b-company-zinc-가상회사.md",
        "facts/01-A정밀.md",
        "facts/02-b-company-zinc-가상회사.md",
    }


def test_demo_report_every_file_starts_with_header_mark(tmp_path: Path) -> None:
    """모든 출력 파일 머리에 '시연용 초안·거산 확인 전'이 있고, 가상 사례는 가상 표시가 있다."""
    cases = _apjeong_dir(tmp_path)
    out = tmp_path / "out"
    assert run_demo_report(CAPABILITY, cases, out, None, echo=lambda _: None) == 0
    files = [p for p in out.rglob("*") if p.is_file()]
    assert len(files) == 4
    for path in files:
        head = path.read_text(encoding="utf-8-sig")[:600]
        assert HEADER_MARK in head, path
    for path in (out / "companies" / "01-A정밀.md", out / "facts" / "01-A정밀.md"):
        assert VIRTUAL_MARK in path.read_text(encoding="utf-8")
    html_text = (out / "ranking.html").read_text(encoding="utf-8")
    assert html_text.startswith("<!doctype html>") and 'lang="ko"' in html_text
    for banned in ("단가", "견적", "납기 약속", "경쟁사"):
        assert (
            banned
            not in (out / "facts" / "01-A정밀.md").read_text(encoding="utf-8").split("## 1.")[1]
        )
