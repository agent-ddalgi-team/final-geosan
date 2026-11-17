"""#213 DB 없는 접속 판단 검사. 실제 API·세션 저장 검증과 구분한다."""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from geosan.api.access_policy import (
    FailureState,
    decide_access,
    password_matches,
    session_expires_at,
    session_is_active,
)

NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("GEOSAN_PASSWORD", "테스트 전용 비밀번호")


def test_fifth_failure_waits_then_correct_password_resets(configured):
    """Given 설정된 비밀번호 / When 5회 실패 후 30초 경계 / Then 그때부터 다시 판단한다."""
    state = FailureState()
    for count in range(1, 6):
        result = decide_access("틀린 값", state, now=NOW, protection_enabled=True)
        assert not result.allowed
        assert state.failures == count - 1  # 입력 상태를 덮어쓰지 않는다.
        assert result.state.failures == count
        assert result.retry_after_seconds == (30 if count == 5 else 0)
        state = result.state
    for elapsed, remaining in ((0, 30), (29, 1), (29.9, 1)):
        blocked = decide_access(
            "테스트 전용 비밀번호",
            state,
            now=NOW + timedelta(seconds=elapsed),
            protection_enabled=True,
        )
        assert not blocked.allowed and blocked.retry_after_seconds == remaining
        assert blocked.state == state  # 재요청으로 대기 시간을 연장하지 않는다.
    allowed = decide_access(
        "테스트 전용 비밀번호", state, now=NOW + timedelta(seconds=30), protection_enabled=True
    )
    assert allowed.allowed and allowed.state == FailureState()


def test_success_breaks_consecutive_failures(configured):
    """Given 4회 실패 / When 성공 뒤 다시 실패 / Then 1회부터 센다."""
    success = decide_access(
        "테스트 전용 비밀번호", FailureState(4), now=NOW, protection_enabled=True
    )
    assert success.allowed
    failed = decide_access("틀린 값", success.state, now=NOW, protection_enabled=True)
    assert failed.state == FailureState(1)


def test_wrong_password_after_wait_starts_new_count(configured):
    state = FailureState(5, NOW + timedelta(seconds=30))
    result = decide_access(
        "틀린 값", state, now=NOW + timedelta(seconds=30), protection_enabled=True
    )
    assert result.state == FailureState(1) and result.retry_after_seconds == 0


@pytest.mark.parametrize("value", [None, "", "   "])
def test_missing_secret_fails_closed_without_counting_as_user_failure(monkeypatch, value):
    """Given 서버 비밀번호 미설정 / When 접속 판단 / Then 설정 오류이며 허용하지 않는다."""
    if value is None:
        monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("GEOSAN_PASSWORD", value)
    with pytest.raises(RuntimeError, match="설정되지"):
        decide_access("", FailureState(), now=NOW, protection_enabled=True)


def test_disabled_protection_needs_no_secret(monkeypatch):
    monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    state = FailureState(5, NOW + timedelta(seconds=30))
    result = decide_access("", state, now=NOW, protection_enabled=False)
    assert result.allowed and result.state == state and result.retry_after_seconds == 0


def test_password_is_exact_and_never_in_result_or_output(monkeypatch, capsys):
    value = " 가상 비밀번호 ! "
    monkeypatch.setenv("GEOSAN_PASSWORD", value)
    assert password_matches(value)
    assert not password_matches(value.strip())
    assert not password_matches("")
    result = decide_access(value, FailureState(), now=NOW, protection_enabled=True)
    assert value not in repr(result)
    output = capsys.readouterr()
    assert output.out == output.err == ""


def test_expiry_uses_absolute_twelve_hours_and_boundary_is_expired():
    """Given 한국 시각 발급 / When 12시간 직전·정각 / Then 직전만 유효하다."""
    created = NOW.astimezone(timezone(timedelta(hours=9)))
    expiry = session_expires_at(created)
    assert expiry == NOW + timedelta(hours=12)
    assert session_is_active(expiry, now=expiry - timedelta(microseconds=1))
    assert not session_is_active(expiry, now=expiry)
    assert not session_is_active(expiry, now=expiry + timedelta(seconds=1))
    assert not session_is_active(None, now=NOW)


def test_naive_times_and_inconsistent_state_are_rejected():
    with pytest.raises(ValueError):
        session_expires_at(NOW.replace(tzinfo=None))
    with pytest.raises(ValueError):
        session_is_active(NOW.replace(tzinfo=None), now=NOW)
    for failures, blocked in ((-1, None), (6, None), (5, None), (0, NOW)):
        with pytest.raises(ValueError):
            FailureState(failures, blocked)
