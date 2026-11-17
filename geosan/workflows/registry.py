"""흐름 이름과 실행 함수는 이 표 한 곳에 등록한다."""

from geosan.workflows.flow_evaluate import run_evaluation
from geosan.workflows.flow_extract import run_extract

FLOWS = {"evaluate": run_evaluation, "extract": run_extract}
