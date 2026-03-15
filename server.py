#!/usr/bin/env python3
"""Local server for LatchR static UI + ffmpeg clip export API."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT_DIR = Path(__file__).resolve().parent
DESKTOP_DIR = Path.home() / "Desktop"
EXPORT_ROOT = DESKTOP_DIR / "video_prototype"

INVALID_NAME_RE = re.compile(r"[<>:\"/\\|?*\x00-\x1f]+")


def sanitize_name(value: Any, fallback: str = "clip") -> str:
    text = str(value or "").strip()
    text = INVALID_NAME_RE.sub("_", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text or fallback


def json_response(handler: SimpleHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def resolve_source_video(path_text: Any) -> Path:
    raw = str(path_text or "").strip()
    if not raw:
        raise ValueError("source_video_path is required")

    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        resolved = candidate.resolve()
    else:
        resolved = (ROOT_DIR / candidate).resolve()

    if not resolved.exists():
        raise FileNotFoundError(f"Video not found: {resolved}")
    if not resolved.is_file():
        raise ValueError(f"Not a file: {resolved}")
    return resolved


def clip_command(src: Path, start_sec: float, end_sec: float, out_path: Path) -> list[str]:
    duration = end_sec - start_sec
    return [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_sec:.3f}",
        "-i",
        str(src),
        "-t",
        f"{duration:.3f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-avoid_negative_ts",
        "make_zero",
        str(out_path),
    ]


def resolve_ffmpeg_binary() -> tuple[str | None, list[str]]:
    env_hint = str(os.environ.get("LATCHR_FFMPEG_PATH") or os.environ.get("SPORT_TAGGER_FFMPEG_PATH") or "").strip()
    env_path = str(Path(env_hint).expanduser()) if env_hint else ""
    candidates_raw = [
        env_path,
        shutil.which("ffmpeg") or "",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/opt/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]
    candidates: list[str] = []
    seen: set[str] = set()
    for raw in candidates_raw:
        val = str(raw or "").strip()
        if not val or val in seen:
            continue
        seen.add(val)
        candidates.append(val)

    for candidate in candidates:
        p = Path(candidate).expanduser()
        if p.exists() and p.is_file() and os.access(p, os.X_OK):
            return (str(p), candidates)
    return (None, candidates)


def tail_text(text: str, max_chars: int = 500) -> str:
    text = (text or "").strip()
    if len(text) <= max_chars:
        return text
    return text[-max_chars:]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/export-clips":
            self.handle_export_clips()
            return
        if path == "/api/load-json-path":
            self.handle_load_json_path()
            return

        json_response(self, 404, {"error": "Not found"})

    def read_json_body(self) -> dict[str, Any]:
        length_raw = self.headers.get("Content-Length", "0")
        try:
            length = int(length_raw)
        except ValueError as exc:
            raise ValueError("Invalid Content-Length") from exc

        if length <= 0:
            raise ValueError("Empty body")

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON payload") from exc

        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object")
        return payload

    def handle_export_clips(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            json_response(self, 400, {"error": str(exc)})
            return

        ffmpeg_path, checked_paths = resolve_ffmpeg_binary()
        if not ffmpeg_path:
            json_response(
                self,
                500,
                {
                    "error": "ffmpeg not found. Install with `brew install ffmpeg` or set LATCHR_FFMPEG_PATH. "
                             "SPORT_TAGGER_FFMPEG_PATH is still accepted. "
                    + f"Checked: {', '.join(checked_paths)}"
                },
            )
            return

        try:
            source_video = resolve_source_video(payload.get("source_video_path"))
        except (ValueError, FileNotFoundError) as exc:
            json_response(self, 400, {"error": str(exc)})
            return

        clips_raw = payload.get("clips")
        if not isinstance(clips_raw, list) or len(clips_raw) == 0:
            json_response(self, 400, {"error": "clips must be a non-empty array"})
            return

        video_name = sanitize_name(payload.get("video_name") or source_video.name, fallback=source_video.stem)
        video_dir = sanitize_name(Path(video_name).stem, fallback="video")
        out_dir = EXPORT_ROOT / video_dir
        out_dir.mkdir(parents=True, exist_ok=True)

        created: list[str] = []
        failed: list[dict[str, Any]] = []

        for idx, clip in enumerate(clips_raw, start=1):
            if not isinstance(clip, dict):
                failed.append({"clip": idx, "error": "Clip entry must be object"})
                continue

            try:
                start_sec = float(clip.get("start_sec"))
                end_sec = float(clip.get("end_sec"))
            except (TypeError, ValueError):
                failed.append({"clip": idx, "error": "Invalid start_sec/end_sec"})
                continue

            if end_sec <= start_sec:
                failed.append({"clip": idx, "error": "end_sec must be > start_sec"})
                continue

            clip_name = sanitize_name(clip.get("name") or f"clip_{idx:03d}", fallback=f"clip_{idx:03d}")
            out_file = out_dir / f"clip_{idx:03d}_{clip_name}.mp4"

            cmd = clip_command(source_video, start_sec, end_sec, out_file)
            cmd[0] = ffmpeg_path
            proc = subprocess.run(cmd, capture_output=True, text=True)

            if proc.returncode == 0 and out_file.exists():
                created.append(out_file.name)
            else:
                failed.append(
                    {
                        "clip": idx,
                        "name": clip_name,
                        "error": tail_text(proc.stderr or proc.stdout or "ffmpeg failed"),
                    }
                )

        clips_json_path = out_dir / "clips.json"
        clips_json_path.write_text(json.dumps(clips_raw, indent=2, ensure_ascii=False), encoding="utf-8")

        sh_lines = [
            "#!/usr/bin/env bash",
            "set -euo pipefail",
            f'INPUT="{source_video}"',
            f'FFMPEG="{ffmpeg_path}"',
            "",
        ]
        for idx, clip in enumerate(clips_raw, start=1):
            if not isinstance(clip, dict):
                continue
            try:
                start_sec = float(clip.get("start_sec"))
                end_sec = float(clip.get("end_sec"))
            except (TypeError, ValueError):
                continue
            if end_sec <= start_sec:
                continue
            clip_name = sanitize_name(clip.get("name") or f"clip_{idx:03d}", fallback=f"clip_{idx:03d}")
            duration = end_sec - start_sec
            sh_lines.append(
                f'"$FFMPEG" -y -ss {start_sec:.3f} -i "$INPUT" -t {duration:.3f} -c:v libx264 -preset veryfast -crf 18 -bf 0 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart -avoid_negative_ts make_zero "clip_{idx:03d}_{clip_name}.mp4"'
            )

        sh_path = out_dir / "cut_clips.sh"
        sh_path.write_text("\n".join(sh_lines) + "\n", encoding="utf-8")
        os.chmod(sh_path, 0o755)

        readme_path = out_dir / "README.txt"
        readme_path.write_text(
            "Clips generated by LatchR export API.\n"
            "If any clip failed, inspect server terminal logs and clips.json.\n",
            encoding="utf-8",
        )

        json_response(
            self,
            200,
            {
                "ok": True,
                "source_video": str(source_video),
                "output_dir": str(out_dir),
                "created": len(created),
                "failed": len(failed),
                "files": created,
                "errors": failed,
                "ffmpeg": ffmpeg_path,
            },
        )

    def handle_load_json_path(self) -> None:
        try:
            payload = self.read_json_body()
        except ValueError as exc:
            json_response(self, 400, {"error": str(exc)})
            return

        raw_path = str(payload.get("path") or "").strip()
        if not raw_path:
            json_response(self, 400, {"error": "path is required"})
            return

        candidate = Path(raw_path).expanduser()
        if candidate.is_absolute():
            resolved = candidate.resolve()
        else:
            resolved = (ROOT_DIR / candidate).resolve()

        if not resolved.exists() or not resolved.is_file():
            json_response(self, 404, {"error": f"JSON file not found: {resolved}"})
            return
        if resolved.suffix.lower() != ".json":
            json_response(self, 400, {"error": "Only .json files are allowed"})
            return

        try:
            data = json.loads(resolved.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            json_response(self, 400, {"error": f"Invalid JSON file: {exc}"})
            return

        json_response(self, 200, {"ok": True, "path": str(resolved), "data": data})


def main() -> int:
    parser = argparse.ArgumentParser(description="LatchR local server with ffmpeg API")
    parser.add_argument("port", nargs="?", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"Serving {ROOT_DIR} on http://localhost:{args.port}")
    print("API: POST /api/export-clips")
    print("API: POST /api/load-json-path")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
