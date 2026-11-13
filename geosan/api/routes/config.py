"""화면에 필요한 공개 설정만 돌려준다. 내부 설정 파일 경로는 응답하지 않는다."""

from fastapi import APIRouter
from sqlalchemy import func, select

from geosan.api.deps import SessionDep, runtime_for
from geosan.api.process_catalog import load_process_catalog
from geosan.api.schemas import ConfigUi, ConfigUiEnvelope, Meta
from geosan.capability.models import Process
from geosan.config.models import AppSetting

router = APIRouter()


@router.get("/config/ui", response_model=ConfigUiEnvelope, response_model_exclude_unset=True)
def config_ui(session: SessionDep):
    runtime = runtime_for(session)
    settings = runtime.app_settings
    return ConfigUiEnvelope(
        data=ConfigUi(
            staff=[row.model_dump() for row in settings.staff],
            brand=settings.brand.model_dump(),
            classification_labels=runtime.rule_config.classification_labels,
            active_dataset_kind=settings.active_dataset_kind,
            access_protection_enabled=settings.access_protection.enabled,
            rule_version=runtime.rule_config.version,
            records=settings.records.model_dump(),
            export=settings.export.model_dump(),
            ingest_options={
                "processes": [
                    {"code": row.code, "name": row.name}
                    for row in load_process_catalog(session, settings.active_dataset_kind)
                ],
                "regions": settings.ingestion.regions,
                "industries": settings.industries,
            },
        ),
        meta=Meta(
            updated_at=session.scalar(select(func.max(AppSetting.updated_at))),
            has_virtual_data=bool(
                session.scalar(
                    select(Process.process_id)
                    .where(
                        Process.dataset_kind == settings.active_dataset_kind.value,
                        Process.is_virtual.is_(True),
                    )
                    .limit(1)
                )
            ),
            dataset_kind=settings.active_dataset_kind,
        ),
    )
