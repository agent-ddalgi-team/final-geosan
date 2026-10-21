"""흐름 이름과 실행 함수는 이 표 한 곳에 등록한다."""

from geosan.workflows.flow_evaluate import run_evaluation

FLOWS = {"evaluate": run_evaluation}
