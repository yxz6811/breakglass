"""Render the authored geometry examples with Pillow and an existing FFmpeg.

Requires Pillow and FFmpeg with libx264. No network access or dependency install.
The question frame remains unchanged from 2 through 8 seconds.
"""

from __future__ import annotations

import argparse
from functools import lru_cache
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT, SCALE, FPS = 1280, 720, 2, 30
INK = "#EEF5FF"
MUTED = "#A9BBD0"
ACCENT = "#71DDFF"
LINE = "#31465F"
CASES = ((3, 4, 5), (5, 12, 13), (8, 15, 17))


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    local_ffmpeg = Path(tempfile.gettempdir()) / "breakglass-005-test-tools" / "ffmpeg.exe"
    parser.add_argument("--ffmpeg", default=os.environ.get("FFMPEG") or shutil.which("ffmpeg") or str(local_ffmpeg))
    parser.add_argument("--font", default="C:/Windows/Fonts/msyh.ttc", help="An installed font supporting Simplified Chinese")
    parser.add_argument("--bold-font", default="C:/Windows/Fonts/msyhbd.ttc")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "extension/assets/video/geometry")
    parser.add_argument("--evidence-dir", type=Path, default=Path(tempfile.gettempdir()) / "breakglass-geometry-video-evidence")
    return parser.parse_args()


class Board:
    def __init__(self, regular: str, bold: str):
        self.regular, self.bold = regular, bold
        self.image = Image.new("RGB", (WIDTH * SCALE, HEIGHT * SCALE))
        self.draw = ImageDraw.Draw(self.image)
        for y in range(HEIGHT * SCALE):
            mix = y / (HEIGHT * SCALE - 1)
            colour = tuple(round(top + (bottom - top) * mix) for top, bottom in zip((11, 21, 38), (7, 13, 23)))
            self.draw.line((0, y, WIDTH * SCALE, y), fill=colour)

    @lru_cache(maxsize=64)
    def font(self, size: int, bold: bool = False):
        return ImageFont.truetype(self.bold if bold else self.regular, size * SCALE)

    def text_width(self, value: str, size: int, bold: bool = False) -> float:
        return self.font(size, bold).getlength(value) / SCALE

    def text(self, xy, value: str, size: int = 30, colour=INK, bold=False):
        self.draw.text(tuple(v * SCALE for v in xy), value, font=self.font(size, bold), fill=colour, anchor="lt")

    def line(self, points, fill=LINE, width=2):
        self.draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=fill, width=width * SCALE, joint="curve")

    def rounded(self, box, fill="#101F33", outline=LINE, radius=18, width=1):
        self.draw.rounded_rectangle(tuple(round(v * SCALE) for v in box), radius * SCALE, fill=fill, outline=outline, width=width * SCALE)

    def header(self, number: int):
        self.text((64, 36), "BREAKGLASS  /  几何实验", 22, MUTED, True)
        self.rounded((998, 28, 1216, 74), fill="#142A3F", outline="#3C6A82", radius=23)
        self.text((1027, 39), "自制教学示例", 24, ACCENT, True)
        self.text((64, 105), f"第 {number} 题 · 直角三角形", 42, INK, True)
        self.line(((64, 184), (1216, 184)))

    def save(self, path: Path):
        self.image.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS).save(path)


def vertices(ab: int, ac: int) -> dict:
    scale = 330 / max(ab, ac)
    return {"A": {"x": 292, "y": 590}, "B": {"x": 292 + ab * scale, "y": 590}, "C": {"x": 292, "y": 590 - ac * scale}}


def triangle(board: Board, ab: int, ac: int, bc: int | None):
    points = vertices(ab, ac)
    a, b, c = (tuple(points[name].values()) for name in ("A", "B", "C"))
    board.draw.polygon([(round(x * SCALE), round(y * SCALE)) for x, y in (a, b, c)], fill="#102B3B")
    board.line((a, b, c, a), ACCENT, 3)
    board.line(((a[0] + 26, a[1]), (a[0] + 26, a[1] - 26), (a[0], a[1] - 26)), MUTED, 2)
    for name, point in points.items():
        x, y = point.values()
        board.draw.ellipse(((x - 4) * SCALE, (y - 4) * SCALE, (x + 4) * SCALE, (y + 4) * SCALE), fill=INK)
        board.text((x - 36, y - 16) if name == "C" else (x - 13, y + 15), name, 34, INK, True)
    ab_text, ac_text = f"{ab} cm", f"{ac} cm"
    board.text(((a[0] + b[0] - board.text_width(ab_text, 30)) / 2, a[1] - 51), ab_text, 30, ACCENT)
    board.text((a[0] - board.text_width(ac_text, 30) - 34, (a[1] + c[1]) / 2 - 16), ac_text, 30, ACCENT)
    board.text(((b[0] + c[0]) / 2 + 36, (b[1] + c[1]) / 2 - 22), f"BC = {bc} cm" if bc is not None else "BC = ?", 30, ACCENT, True)


def render_images(folder: Path, ab: int, ac: int, bc: int, number: int, regular: str, bold: str) -> list[Path]:
    intro, question, reveal = (folder / f"{name}.png" for name in ("intro", "question", "reveal"))
    board = Board(regular, bold)
    board.header(number)
    board.text((64, 245), "A 处为直角。", 58, INK, True)
    board.text((64, 340), "AB、AC 已知，BC 怎么算？", 44, ACCENT, True)
    board.text((64, 435), f"AB = {ab} cm    AC = {ac} cm", 38)
    board.rounded((64, 540, 1216, 620))
    board.text((91, 563), "暂停在第 4 秒  →  校对条件  →  改变一条边  →  解释变化", 28, MUTED)
    board.text((64, 676), "本片为自制教学示例；示例条件载入与真实视觉识别分别验收。", 20, MUTED)
    board.save(intro)

    for is_reveal, path in ((False, question), (True, reveal)):
        board = Board(regular, bold)
        board.header(number)
        board.text((64, 202), "求斜边 BC 的长度。" if not is_reveal else "用勾股定理计算 BC。", 30, INK, True)
        triangle(board, ab, ac, bc if is_reveal else None)
        board.rounded((760, 232, 1216, 610))
        if is_reveal:
            square = ab * ab + ac * ac
            board.text((788, 259), "勾股计算", 30, MUTED, True)
            board.text((788, 322), "BC² = AB² + AC²", 32)
            board.text((788, 374), f"     = {ab}² + {ac}² = {square}", 32)
            board.text((788, 430), f"BC = √{square} = {bc} cm", 32)
            board.text((788, 507), f"{bc} cm", 58, ACCENT, True)
            board.text((784, 634), "直角不变，边长变化，答案随之变化。", 22, MUTED)
        else:
            board.text((788, 259), "题目条件", 30, MUTED, True)
            board.text((788, 322), "∠A = 90°", 38, INK, True)
            board.text((788, 381), f"AB = {ab} cm", 36)
            board.text((788, 434), f"AC = {ac} cm", 36)
            board.line(((788, 491), (1188, 491)))
            board.text((788, 516), "BC = ?", 54, ACCENT, True)
            board.text((784, 634), "第 4 秒：暂停，先核对题目条件。", 24, MUTED)
        board.text((64, 676), "AB、AC 是直角边；BC 是斜边。", 22, MUTED)
        board.text((914, 680), "示意图按比例绘制 · 单位 cm", 18, MUTED)
        board.save(path)
    return [intro, question, reveal]


def run(command: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stderr[-6000:])
    return result


def verify(ffmpeg: str, video: Path, frame: Path) -> dict:
    probe = run([ffmpeg, "-hide_banner", "-i", str(video), "-t", "0", "-f", "null", "-"]).stderr
    if "Video: h264" not in probe or "yuv420p" not in probe or "1280x720" not in probe or "30 fps" not in probe or "Audio:" in probe:
        raise RuntimeError(f"Unexpected media streams in {video.name}:\n{probe}")
    duration = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", probe)
    if not duration:
        raise RuntimeError("Cannot read generated duration")
    hours, minutes, seconds = map(float, duration.groups())
    total = hours * 3600 + minutes * 60 + seconds
    if not math.isclose(total, 12, abs_tol=0.05):
        raise RuntimeError(f"Unexpected duration: {total}")
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(video), "-f", "null", "-"])
    run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", "4", "-i", str(video), "-frames:v", "1", "-update", "1", str(frame)])
    with Image.open(frame) as still:
        if still.size != (WIDTH, HEIGHT):
            raise RuntimeError(f"Unexpected evidence frame size: {still.size}")
    return {"path": str(video), "fileBytes": video.stat().st_size, "width": WIDTH, "height": HEIGHT, "durationSeconds": total, "codec": "h264", "pixelFormat": "yuv420p", "fps": FPS, "audio": False, "frame4": str(frame)}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = arguments()
    if not Path(args.ffmpeg).is_file():
        raise SystemExit("FFmpeg missing; provide --ffmpeg with an existing libx264-enabled executable.")
    if not Path(args.font).is_file():
        raise SystemExit("Chinese font missing; provide --font with an installed font file.")
    bold = args.bold_font if Path(args.bold_font).is_file() else args.font
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    reports = []
    for number, (ab, ac, bc) in enumerate(CASES, start=1):
        video = args.output_dir / f"triangle-{ab}-{ac}-{bc}.mp4"
        frame = args.evidence_dir / f"triangle-{ab}-{ac}-{bc}-4s.png"
        with tempfile.TemporaryDirectory(prefix="breakglass-geometry-render-") as temp:
            images = render_images(Path(temp), ab, ac, bc, number, args.font, bold)
            command = [args.ffmpeg, "-hide_banner", "-loglevel", "error", "-y"]
            for image, duration in zip(images, (2, 6, 4)):
                command += ["-loop", "1", "-framerate", str(FPS), "-t", str(duration), "-i", str(image)]
            command += ["-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]", "-map", "[v]", "-an", "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", "12", str(video)]
            run(command)
        report = verify(args.ffmpeg, video, frame)
        report["frame4Vertices"] = vertices(ab, ac)
        reports.append(report)
        print(json.dumps(report, ensure_ascii=False), flush=True)
    print(f"Verified {len(reports)} authored examples. No visual-recognition claim.", flush=True)


if __name__ == "__main__":
    main()
