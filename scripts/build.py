"""#213: 화면을 빌드해 기존 FastAPI 정적 파일 제공 위치에 둔다."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if npm is None:
        raise SystemExit("Node.js와 npm을 먼저 설치해 주세요.")
    # 배포 빌드가 개발용 가짜 응답을 포함하지 않도록 명시한다.
    env = dict(os.environ, VITE_USE_FIXTURES="0")
    try:
        subprocess.run([npm, "ci"], cwd=ROOT / "web", env=env, check=True)
        subprocess.run([npm, "run", "build"], cwd=ROOT / "web", env=env, check=True)
    except subprocess.CalledProcessError as error:
        return error.returncode or 1
    if not (ROOT / "web" / "dist" / "index.html").is_file():
        raise SystemExit("화면 빌드 결과가 없습니다. 배포를 중단합니다.")
    print("빌드 완료: geosan serve가 화면과 API를 함께 제공합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
