"""#686: 목록이 느리던 원인(설정 파일 재읽기, 회사별 평가 하나씩 묻기)을 고친 것을 검사한다."""

import os
from pathlib import Path

from geosan.config import loader
from geosan.config.loader import load_document
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_confirmed_evaluations
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


def write(path: Path, text: str) -> Path:
    path.write_text(text, encoding="utf-8")
    return path


def test_same_file_is_parsed_once_and_callers_get_independent_copies(tmp_path, monkeypatch):
    """Given 바뀌지 않은 파일 / When 두 번 읽음 / Then 한 번만 해석, 고쳐도 서로 영향 없음."""
    path = write(tmp_path / "a.yaml", "items:\n  - 1\n  - 2\n")
    parsed = []
    original = loader._parse
    monkeypatch.setattr(loader, "_parse", lambda *a: parsed.append(1) or original(*a))
    first = load_document(path)
    first.data["items"].append(3)
    second = load_document(path)
    assert parsed == [1]
    assert second.data == {"items": [1, 2]}
    assert second.line_of("items[1]") == first.line_of("items[1]")


def test_changed_file_is_read_again(tmp_path):
    """Given 읽은 뒤 파일을 고침 / When 다시 읽음 / Then 새 내용(수정 시각·크기가 다름)."""
    path = write(tmp_path / "b.yaml", "value: 1\n")
    assert load_document(path).data == {"value": 1}
    write(path, "value: 22\n")
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000))
    assert load_document(path).data == {"value": 22}


def test_batch_latest_evaluation_matches_one_by_one(tmp_db, tmp_path):
    """한 번에 고른 최신 확정 평가가 회사마다 따로 고른 것과 같다(재평가로 행이 여럿이어도)."""
    from geosan.capability.importer import import_capability

    import_capability(_write(tmp_path, "capability.json", factories.capability_file()))
    first = import_case(_write(tmp_path, "one.json", factories.brochure_case("speed-one"))).opp_id
    second = import_case(_write(tmp_path, "two.json", factories.brochure_case("speed-two"))).opp_id
    assert run_evaluation().ok
    assert run_evaluation().ok
    with session_scope() as session:
        batch = latest_confirmed_evaluations(session, [first, second, "없는-기회"])
        assert set(batch) == {first, second}
        for opp_id in (first, second):
            assert batch[opp_id].eval_id == latest_confirmed_evaluation(session, opp_id).eval_id
        assert latest_confirmed_evaluations(session, []) == {}
        assert session.get(Opportunity, first) is not None
