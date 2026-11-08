"""#317의 독립적인 조건 검사. 실제 찾기·저장·API 연결 검사는 후속으로 따로 수행한다."""

import pytest
from pydantic import ValidationError

from geosan.api.ingest_conditions import IngestRequest, validate_ingest_conditions
from geosan.config.app_settings import load_app_settings
from geosan.config.errors import InputError


@pytest.fixture
def settings(examples_dir):
    return load_app_settings(examples_dir / "app-settings-virtual.yaml")


def request(**values):
    return IngestRequest.model_validate({"processCodes": ["ANODIZING"], **values})


def validate(body, settings, codes=("ANODIZING",)):
    return validate_ingest_conditions(body, settings=settings, available_process_codes=codes)


def test_omitted_region_and_max_follow_current_settings_without_mutating_input(settings):
    """Given 공정만 선택 / When 검사 / Then 설정 전체 지역·최대 건수를 쓰고 원본은 보존한다."""
    body = request()
    original = body.model_dump()
    prepared = validate(body, settings)
    assert prepared.regions == settings.ingestion.regions
    assert prepared.max_candidates == settings.ingestion.max_candidates
    assert prepared.source_id == "kicox-factory-csv"
    assert prepared.industries == []
    assert body.model_dump() == original
    prepared.regions.append("새 지역")
    assert "새 지역" not in settings.ingestion.regions


def test_explicit_conditions_and_max_are_preserved(settings):
    """Given 설정 안의 조건 / When 검사 / Then 고른 조건과 최대 건수를 그대로 돌려준다."""
    selected = request(
        regions=settings.ingestion.regions[:1],
        industries=settings.industries[:1],
        max=settings.ingestion.max_candidates,
    )
    assert validate(selected, settings) == selected


def test_default_max_reads_changed_settings_instead_of_a_fixed_number(settings):
    settings.ingestion.max_candidates += 1
    assert validate(request(), settings).max_candidates == settings.ingestion.max_candidates


@pytest.mark.parametrize(
    "values,path",
    [
        ({"processCodes": ["ZINC_PLATING"]}, "processCodes[0]"),
        ({"regions": ["설정 밖 지역"]}, "regions[0]"),
        ({"industries": ["설정 밖 산업"]}, "industries[0]"),
    ],
)
def test_outside_settings_has_precise_field_error(settings, values, path):
    """Given 현재 역량·설정 밖 값 / When 검사 / Then 해당 칸의 입력 오류를 낸다."""
    with pytest.raises(InputError) as caught:
        validate(request(**values), settings)
    assert caught.value.status == 400
    assert [field.path for field in caught.value.fields] == [path]


def test_selected_process_must_exist_in_current_capability(settings):
    with pytest.raises(InputError):
        validate(request(), settings, codes=())
    assert validate(request(), settings, codes=("ANODIZING",)).process_codes == ["ANODIZING"]


def test_max_exceeding_current_setting_is_rejected(settings):
    with pytest.raises(InputError) as caught:
        validate(request(max=settings.ingestion.max_candidates + 1), settings)
    assert [field.path for field in caught.value.fields] == ["max"]


def test_all_invalid_conditions_are_reported_together(settings):
    with pytest.raises(InputError) as caught:
        validate(
            request(
                processCodes=["ZINC_PLATING"],
                regions=["설정 밖 지역"],
                industries=["설정 밖 산업"],
                max=settings.ingestion.max_candidates + 1,
            ),
            settings,
        )
    assert [field.path for field in caught.value.fields] == [
        "processCodes[0]",
        "regions[0]",
        "industries[0]",
        "max",
    ]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"processCodes": []},
        {"processCodes": "ANODIZING"},
        {"processCodes": ["UNKNOWN"]},
        {"processCodes": ["ANODIZING"], "regions": None},
        {"processCodes": ["ANODIZING"], "industries": [1]},
        {"processCodes": ["ANODIZING"], "max": 0},
        {"processCodes": ["ANODIZING"], "max": True},
        {"processCodes": ["ANODIZING"], "max": "10"},
        {"processCodes": ["ANODIZING"], "max": 1.5},
        {"processCodes": ["ANODIZING"], "sourceId": ""},
        {"processCodes": ["ANODIZING"], "extra": True},
    ],
)
def test_malformed_request_is_rejected_before_settings_check(body):
    with pytest.raises(ValidationError):
        IngestRequest.model_validate(body)
