"""기존 사례 투입 함수를 운영 명령에 연결한다. 자동 평가는 하지 않는다."""

from pathlib import Path

from geosan.commands.import_capability import run_import
from geosan.opportunity.importer import import_case


def run_import_case(file: Path) -> int:
    return run_import(file, import_case, "cmd.import_case")
