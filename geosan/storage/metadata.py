"""모든 부품의 모델을 한 번에 불러와 metadata를 채운다(마이그레이션·테스트가 쓴다).

뒤 단위가 새 테이블을 더하면 자기 `models.py`를 여기 import 목록에 추가한다(접두사별 한 줄).
"""

from __future__ import annotations

from sqlalchemy import MetaData

from geosan.api import models as access_models  # noqa: F401 — web_ 모델 등록(#213 PM 승인)
from geosan.capability import models as capability_models
from geosan.config import models as config_models
from geosan.evaluation import models as evaluation_models
from geosan.evidence import models as evidence_models
from geosan.opportunity import models as opportunity_models
from geosan.questions import models as questions_models
from geosan.records import models as records_models
from geosan.storage.base import Base

MODEL_MODULES = (
    config_models,
    capability_models,
    opportunity_models,
    evidence_models,
    evaluation_models,
    questions_models,
    records_models,
)

TABLE_PREFIXES: tuple[str, ...] = ("cfg_", "cap_", "opp_", "ev_", "eval_", "q_", "rec_")
"""U1이 만드는 테이블 접두사(계약 C6 소유 순서)."""


def metadata() -> MetaData:
    return Base.metadata


def table_names(prefix: str | None = None) -> list[str]:
    names = sorted(Base.metadata.tables)
    if prefix is None:
        return names
    return [name for name in names if name.startswith(prefix)]
