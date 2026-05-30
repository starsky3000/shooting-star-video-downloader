#!/usr/bin/env python3
"""
StarDownload Native Messaging Host for Chrome
Receives messages from Chrome extension via stdin, executes yt-dlp, returns progress via stdout
"""

import json
import sys
import os
import subprocess
import re
import struct
import shutil
import tempfile
import datetime
from pathlib import Path
from urllib.parse import urlparse

def get_log_path():
    if sys.platform == "darwin":
        return os.path.expanduser("~/Library/Logs/stardownload.log")
    elif sys.platform == "win32":
        localappdata = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
        return os.path.join(localappdata, "StarDownload", "stardownload.log")
    else:
        return os.path.expanduser("~/.cache/stardownload.log")

LOG_FILE = get_log_path()

def log(message):
    """Write log to file"""
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(f"[{datetime.datetime.now().isoformat()}] {message}\n")
    except:
        pass

REQUIRED_VERSION = "2026.03.17"
NATIVE_HOST_VERSION = "1.0.2"  # Bump only when this file changes

def get_ytdlp_path():
    """Find yt-dlp binary"""
    log("get_ytdlp_path called")
    # Use shutil.which() first (cross-platform, handles .exe on Windows)
    for cmd in ["yt-dlp", "ytdlp"]:
        found = shutil.which(cmd)
        if found:
            log(f"Found yt-dlp via shutil.which: {found}")
            return found

    # Check platform-specific paths
    if sys.platform == "darwin":
        specific_paths = [
            os.path.expanduser("~/.local/bin/yt-dlp"),
            os.path.expanduser("~/Library/Python/3.9/bin/yt-dlp"),
            "/usr/local/bin/yt-dlp",
            "/usr/local/bin/ytdlp",
            "/opt/homebrew/bin/yt-dlp",
        ]
    elif sys.platform == "win32":
        appdata = os.environ.get("APPDATA", "")
        localappdata = os.environ.get("LOCALAPPDATA", "")
        specific_paths = [
            os.path.join(appdata, "Python", "Scripts", "yt-dlp.exe"),
            os.path.join(localappdata, "Programs", "Python", "Scripts", "yt-dlp.exe"),
            os.path.join(localappdata, "Programs", "Python", "Python312", "Scripts", "yt-dlp.exe"),
            os.path.join(localappdata, "Programs", "Python", "Python311", "Scripts", "yt-dlp.exe"),
            os.path.join(localappdata, "Programs", "Python", "Python310", "Scripts", "yt-dlp.exe"),
            os.path.join(localappdata, "Microsoft", "WinGet", "Packages", "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe", "yt-dlp.exe"),
        ]
    else:
        specific_paths = []

    for path in specific_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            log(f"Found yt-dlp at: {path}")
            return path

    log("yt-dlp not found, returning 'yt-dlp' to rely on PATH")
    return "yt-dlp"

def get_ytdlp_version():
    """Get current yt-dlp version"""
    ytdlp = get_ytdlp_path()
    try:
        result = subprocess.run([ytdlp, "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            version = result.stdout.strip()
            log(f"yt-dlp version: {version}")
            return version
    except Exception as e:
        log(f"Error getting yt-dlp version: {e}")
    return None

def get_latest_ytdlp_version():
    """Get latest yt-dlp version from GitHub"""
    try:
        import urllib.request
        url = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
        req = urllib.request.Request(url, headers={'User-Agent': 'Python'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            tag = data.get('tag_name', '')
            # Remove 'v' prefix if present
            if tag.startswith('v'):
                tag = tag[1:]
            log(f"Latest yt-dlp version from GitHub: {tag}")
            return tag
    except Exception as e:
        log(f"Error getting latest version: {e}")
    return None

def needs_update():
    """Check if yt-dlp needs update"""
    current = get_ytdlp_version()
    latest = get_latest_ytdlp_version()
    log(f"Current: {current}, Latest: {latest}")
    if not current or not latest:
        return True
    # Simple version comparison
    return current != latest

def get_ffmpeg_path():
    """Find ffmpeg binary, returns (path, found) tuple"""
    # Use shutil.which() first (cross-platform)
    found = shutil.which("ffmpeg")
    if found:
        log(f"Found ffmpeg via shutil.which: {found}")
        return (found, True)

    # Platform-specific fallback paths
    if sys.platform == "darwin":
        paths = [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            os.path.expanduser("~/.local/bin/ffmpeg"),
            "/usr/bin/ffmpeg",
        ]
    elif sys.platform == "win32":
        localappdata = os.environ.get("LOCALAPPDATA", "")
        programfiles = os.environ.get("ProgramFiles", "")
        paths = [
            os.path.join(localappdata, "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(programfiles, "ffmpeg", "bin", "ffmpeg.exe"),
        ]
    else:
        paths = [
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg",
        ]

    log(f"get_ffmpeg_path: checking fallback paths={paths}")
    for p in paths:
        exists = os.path.isfile(p)
        executable = exists and os.access(p, os.X_OK)
        log(f"  check {p}: exists={exists}, executable={executable}")
        if exists and executable:
            log(f"  => Found ffmpeg at: {p}")
            return (p, True)

    log("  => ffmpeg NOT FOUND")
    return ("ffmpeg", False)

def get_default_download_path():
    """Get default download path based on OS"""
    if sys.platform == "darwin":
        return str(Path.home() / "Downloads")
    elif sys.platform == "win32":
        return str(Path.home() / "Downloads")
    else:
        return str(Path.home() / "Downloads")

def update_ytdlp():
    """Update yt-dlp to latest version"""
    log("Updating yt-dlp...")
    # Try pipx first (cross-platform)
    try:
        result = subprocess.run(["pipx", "upgrade", "yt-dlp"], capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            log("yt-dlp updated via pipx")
            return True
    except:
        pass

    if sys.platform == "win32":
        # Windows: try winget first
        try:
            result = subprocess.run(["winget", "upgrade", "yt-dlp"], capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                log("yt-dlp updated via winget")
                return True
        except:
            pass
        # Windows: try py launcher with pip
        try:
            result = subprocess.run(["py", "-m", "pip", "install", "-U", "yt-dlp"],
                                  capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                log("yt-dlp updated via py -m pip")
                return True
        except:
            pass
    else:
        # macOS: try homebrew
        try:
            result = subprocess.run(["brew", "upgrade", "yt-dlp"], capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                log("yt-dlp updated via homebrew")
                return True
        except:
            pass

    log("Failed to update yt-dlp via all methods")
    return False

def parse_progress(line):
    """Parse yt-dlp progress from stdout/stderr
    Returns (percent, speed_str) tuple, or (None, None) if no match."""
    # Match: [download]  45.2% of 123.45MiB at  1.23MiB/s ETA 00:01
    match = re.search(r'\[download\]\s+(\d+\.?\d*)%', line)
    if match:
        percent = float(match.group(1))
        speed = None
        speed_match = re.search(r'at\s+([\d.]+)\s*([KMGT]?)i?B/s', line)
        if speed_match:
            value = float(speed_match.group(1))
            unit = speed_match.group(2) or ''
            # Convert to bytes/s, then to MB/s
            mult = {'': 1, 'K': 1024, 'M': 1024 ** 2, 'G': 1024 ** 3}
            bytes_per_sec = value * mult.get(unit, 1)
            mb_per_sec = bytes_per_sec / 1_000_000
            speed = f'{mb_per_sec:.1f}MB/s' if mb_per_sec >= 1 else f'{mb_per_sec:.2f}MB/s'
        return (percent, speed)

    # Match fragments downloading
    if '[download] Downloading fragment' in line:
        return (-1, None)  # Indicate fragment download

    return (None, None)

def send_message(msg):
    """Send JSON message to stdout using Native Messaging protocol.
    Returns True if sent successfully, False if the pipe is broken."""
    try:
        log(f"Sending message: {msg}")
        message = json.dumps(msg)
        # Encode as UTF-8 (Chrome expects UTF-8 on macOS)
        encoded = message.encode('utf-8')
        # Write 4-byte little-endian length prefix
        length = struct.pack('<I', len(encoded))
        sys.stdout.buffer.write(length + encoded)
        sys.stdout.buffer.flush()
        return True
    except (BrokenPipeError, OSError):
        log("send_message: Broken pipe (Chrome disconnected)")
        return False


def cookie_str_to_netscape(cookie_str, domain):
    """Convert 'SESSDATA=xxx; bili_jct=xxx' to Netscape cookie file content."""
    lines = ["# Netscape HTTP Cookie File", ""]
    for item in cookie_str.split("; "):
        if "=" in item:
            name, value = item.split("=", 1)
            # domain, flag, path, secure, expiry, name, value
            lines.append(f"{domain}\tTRUE\t/\tTRUE\t0\t{name}\t{value}")
    return "\n".join(lines) + "\n"


def _cleanup_cookie_file(cookie_file):
    """Safely remove a temp cookie file."""
    if cookie_file:
        try:
            os.unlink(cookie_file.name)
        except OSError:
            pass


def handle_list_formats(request):
    """List available formats for a video using yt-dlp JSON output"""
    url = request.get("url")
    if not url:
        send_message({"type": "error", "message": "No URL provided"})
        return

    cookie = request.get("cookie")

    ytdlp = get_ytdlp_path()
    # Use -j to get JSON output instead of parsing table format
    cmd = [ytdlp, "--no-playlist", "-j", "--no-download"]

    cookie_file = None
    if cookie:
        netloc = urlparse(url).netloc.split(":")[0]
        parts = netloc.split(".")
        domain = "." + ".".join(parts[-2:]) if len(parts) > 2 else "." + netloc
        cookie_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, prefix="stardownload_cookies_"
        )
        cookie_file.write(cookie_str_to_netscape(cookie, domain))
        cookie_file.close()
        cmd.extend(["--cookies", cookie_file.name])

    cmd.append(url)

    log(f"Cookie provided: {bool(cookie)}")
    log(f"Command to execute: {' '.join(cmd)}")

    try:
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=20
        )

        # Clean up temp cookie file
        if cookie_file:
            try:
                os.unlink(cookie_file.name)
            except OSError:
                pass
        output = process.stdout
        stderr_output = process.stderr
        log(f"JSON output length: {len(output)}, stderr length: {len(stderr_output)}")

        if process.returncode != 0:
            # yt-dlp returned an error
            err_msg = stderr_output.strip() or output.strip()
            # Truncate long error messages
            if len(err_msg) > 500:
                err_msg = err_msg[:500] + "..."
            log(f"yt-dlp error (code {process.returncode}): {err_msg}")
            send_message({"type": "error", "message": f"yt-dlp 获取失败 (错误码: {process.returncode})\n{err_msg}"})
            return

        # Parse JSON output
        try:
            data = json.loads(output)
        except json.JSONDecodeError as e:
            log(f"JSON parse error: {e}")
            send_message({"type": "error", "message": f"解析格式信息失败: {e}"})
            return

        # Parse formats from JSON
        formats = parse_formats_from_json(output)
        log(f"Parsed {len(formats)} formats")

        send_message({
            "type": "formats",
            "formats": formats,
            "title": data.get("title", ""),
            "duration": data.get("duration") or 0,
            "thumbnail": data.get("thumbnail", ""),
            "webpage_url": data.get("webpage_url", ""),
        })
    except FileNotFoundError:
        log(f"yt-dlp not found at path: {ytdlp}")
        _cleanup_cookie_file(cookie_file)
        send_message({
            "type": "error",
            "message": (
                "未找到 yt-dlp\n\n"
                f"搜索路径: {ytdlp}\n\n"
                "请通过以下方式安装 yt-dlp:\n"
                "• pip: pip install yt-dlp\n"
                "• macOS: brew install yt-dlp\n"
                "• 或下载后放入系统 PATH 目录\n\n"
                "安装后请重启浏览器。"
            )
        })
    except subprocess.TimeoutExpired:
        log("Format listing timed out")
        _cleanup_cookie_file(cookie_file)
        send_message({"type": "error", "message": "获取格式超时，请检查网络连接后重试"})
    except Exception as e:
        log(f"handle_list_formats error: {type(e).__name__}: {e}")
        _cleanup_cookie_file(cookie_file)
        send_message({"type": "error", "message": f"获取失败: {type(e).__name__}: {str(e)[:200]}"})


def get_codec_name(codec):
    """Map raw codec string to human-readable name"""
    if not codec or codec == "none":
        return ""
    if codec.startswith("avc1"):
        return "H.264"
    if codec.startswith("av01"):
        return "AV1"
    if codec.startswith("vp9"):
        return "VP9"
    if codec.startswith("vp8"):
        return "VP8"
    if codec.startswith("mp4a"):
        return "AAC"
    if codec == "opus":
        return "Opus"
    if codec == "vorbis":
        return "Vorbis"
    return codec

def parse_formats_from_json(output):
    """Parse format list from yt-dlp JSON output"""
    data = json.loads(output)
    formats = []

    raw_formats = data.get("formats", [])
    if not raw_formats:
        return formats

    for fmt in raw_formats:
        format_id = fmt.get("format_id", "")
        ext = fmt.get("ext", "")
        height = fmt.get("height")
        filesize = fmt.get("filesize") or fmt.get("filesize_approx")
        vcodec = fmt.get("vcodec", "")
        acodec = fmt.get("acodec", "")

        # Check if this is a video format
        has_video = vcodec and vcodec != "none"
        if has_video and height:
            codec = get_codec_name(vcodec)
            label = f"{height}p {ext.upper()}"
        elif acodec and acodec != "none" and not has_video:
            codec = get_codec_name(acodec)
            label = f"Audio {ext.upper()}"
        else:
            codec = ""
            label = f"{ext.upper()}"

        formats.append({
            "id": format_id,
            "ext": ext,
            "height": height,
            "label": label,
            "filesize": filesize,
            "codec": codec
        })

    # Deduplicate: keep best entry per (height, ext, codec) — prefer one with filesize
    seen = {}
    deduped = []
    for f in formats:
        if f.get("height") and f.get("codec"):
            key = (f["height"], f["ext"], f["codec"])
        elif f.get("codec"):
            key = ("audio", f["ext"], f["codec"])
        else:
            key = ("other", f["ext"], f["id"])
        if key in seen:
            existing = seen[key]
            # Prefer entry with filesize > 0
            if f.get("filesize") and not existing.get("filesize"):
                deduped[deduped.index(existing)] = f
                seen[key] = f
        else:
            seen[key] = f
            deduped.append(f)
    formats = deduped

    log(f"Parsed {len(raw_formats)} raw formats, {len(formats)} after dedup")

    # Sort by height descending, audio at end
    video_formats = [f for f in formats if f.get("height")]
    audio_formats = [f for f in formats if not f.get("height")]
    video_formats.sort(key=lambda x: x["height"] if x["height"] else 0, reverse=True)
    audio_formats.sort(key=lambda x: x["ext"])

    return video_formats + audio_formats


def handle_download(request):
    """Execute yt-dlp download"""
    url = request.get("url")
    quality = request.get("quality", "best")
    title = request.get("title", "video")
    proxy = request.get("proxy")  # Optional proxy
    quality_meta = request.get("qualityMeta")  # Optional: {height, ext, filesize}
    is_resume = request.get("isResume", False)  # Whether this is a resume after pause
    cookie = request.get("cookie")  # Optional: login cookie for HD formats (B站 SESSDATA)

    log(f"handle_download called with url={url}, quality={quality}, cookie={bool(cookie)}")

    if not url:
        send_message({"type": "error", "message": "No URL provided"})
        return

    download_path = request.get("downloadPath") or get_default_download_path()
    os.makedirs(download_path, exist_ok=True)

    ytdlp = get_ytdlp_path()
    log(f"Using yt-dlp at: {ytdlp}")

    # Build command (without -o yet — will be set after format detection)
    cmd = [
        ytdlp,
        "--no-playlist",
        "--progress",
        "--newline",
    ]

    # Add proxy if specified
    if proxy:
        cmd.extend(["--proxy", proxy])

    # Add cookie for login-required HD formats (B站)
    cookie_file = None
    if cookie:
        netloc = urlparse(url).netloc.split(":")[0]
        parts = netloc.split(".")
        domain = "." + ".".join(parts[-2:]) if len(parts) > 2 else "." + netloc
        cookie_file = tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, prefix="stardownload_cookies_"
        )
        cookie_file.write(cookie_str_to_netscape(cookie, domain))
        cookie_file.close()
        cmd.extend(["--cookies", cookie_file.name])
        log(f"Added cookies file (length={len(cookie)})")

    # Find ffmpeg first to decide strategy
    ffmpeg, can_merge = get_ffmpeg_path()
    log(f"ffmpeg detection: path={ffmpeg}, can_merge={can_merge}")
    if can_merge:
        cmd.extend(["--ffmpeg-location", ffmpeg])
        log(f"Added --ffmpeg-location {ffmpeg}")
    else:
        log("WARNING: ffmpeg not usable, will NOT merge streams. If video has separate audio/video, it may lose audio.")

    # Format based on quality — always enforce MP4 video stream to avoid
    # WebM/VP9 in MP4 container which produces unplayable files.
    # Build output template with quality suffix to avoid filename collisions
    # when the same video is downloaded at different resolutions.
    format_string = None
    out_template = "%(title)s.%(ext)s"
    if quality == "audio":
        format_string = "audio-only"
        out_template = "%(title)s (audio).%(ext)s"
        cmd.extend(["-x", "--audio-format", "mp3"])
    elif quality == "best":
        if can_merge:
            format_string = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]"
            cmd.extend(["-f", format_string, "--merge-output-format", "mp4"])
        else:
            format_string = "best[ext=mp4]"
            cmd.extend(["-f", format_string])
            log("ffmpeg not found, using pre-muxed format (max 720p)")
    elif quality.isdigit():
        # Format ID directly from list-formats
        # Use quality_meta to add resolution suffix to output template
        # so different formats of the same video get unique filenames
        if quality_meta and quality_meta.get("height"):
            h = quality_meta["height"]
            label = "4K" if h == 2160 else f"{h}p"
            codec = quality_meta.get("codec", "")
            if codec:
                label += f" {codec}"
            out_template = f"%(title)s ({label}).%(ext)s"
        ext_meta2 = (quality_meta.get("ext") or "").lower() if quality_meta else ""
        is_webm = ext_meta2 == "webm"
        if can_merge:
            if is_webm:
                # WebM: use Opus audio, merge to WebM container
                format_string = f"{quality}+bestaudio[ext=webm]/best[ext=webm]"
                cmd.extend(["-f", format_string, "--merge-output-format", "webm"])
            else:
                format_string = f"{quality}+bestaudio[ext=m4a]/best[ext=mp4]"
                cmd.extend(["-f", format_string, "--merge-output-format", "mp4"])
        else:
            format_string = quality
            cmd.extend(["-f", quality])
            log("ffmpeg not found, downloading selected format without audio")
    else:
        # Parse quality like "1080p" -> height<=1080
        height = quality.rstrip('p')
        if height.isdigit():
            out_template = f"%(title)s ({height}p).%(ext)s"
            if can_merge:
                format_string = f"bestvideo[height<={height}][ext=mp4]+bestaudio[ext=m4a]/best[height<={height}][ext=mp4]"
                cmd.extend(["-f", format_string, "--merge-output-format", "mp4"])
            else:
                format_string = f"best[height<={height}][ext=mp4]"
                cmd.extend(["-f", format_string])
                log("ffmpeg not found, using pre-muxed format")
        else:
            format_string = "best[ext=mp4]"
            cmd.extend(["-f", format_string])

    log(f"Quality={quality}, format_string={format_string}, can_merge={can_merge}, out_template={out_template}")

    # Add -o AFTER format is determined so the template can include quality info
    cmd.extend(["-o", os.path.join(download_path, out_template)])
    cmd.append(url)

    # When resuming after a pause, force overwrite partial files from the previous attempt
    if is_resume:
        cmd.insert(1, "--force-overwrites")
        log("isResume=true, added --force-overwrites")

    send_message({"type": "progress", "percent": 0, "status": "正在解析视频信息..."})

    log(f"Command to execute: {' '.join(cmd)}")
    log(f"Can merge: {can_merge}")

    process = None
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        destination_file = None
        merged_file = None
        last_progress = -1
        download_phase = 0  # 0=idle, 1=video, 2=audio, 3=post

        for line in process.stdout:
            log(f"yt-dlp output: {line.strip()}")

            # Capture merged file path from "[Merger] Merging formats into "..."" or "[ffmpeg] ..."
            merger_match = re.search(r'(?:Merg\w+|ffmpeg)\]\s+.*?"([^"]+)"', line)
            if merger_match:
                merged_file = merger_match.group(1)
                log(f"Captured merged file: {merged_file}")
                download_phase = 3
                send_message({"type": "progress", "percent": 97, "status": "正在合并音视频..."})

            # Detect already-downloaded file path
            already_match = re.search(r'\[download\]\s+(.+) has already been downloaded', line)
            if already_match:
                already_file = already_match.group(1).strip()
                log(f"File already downloaded, path: {already_file}")
                if not destination_file:
                    destination_file = already_file

            # Detect download phase by "Destination:" lines
            if "Destination:" in line:
                dest_start = line.find("Destination:") + len("Destination: ")
                destination_file = line[dest_start:].strip()
                log(f"Captured destination ({download_phase}): {destination_file}")
                if can_merge and not destination_file.endswith('.mp4'):
                    download_phase += 1
                elif can_merge and destination_file.endswith('.mp4') and download_phase <= 1:
                    download_phase = max(download_phase + 1, 1)

            # Phase-based progress calculation
            if "[download]" in line:
                progress, speed = parse_progress(line)
                if progress is not None and progress > 0:
                    if can_merge and download_phase >= 2:
                        total_progress = 80 + progress * 0.15
                    elif can_merge and download_phase >= 1:
                        total_progress = progress * 0.80
                    else:
                        total_progress = progress

                    if total_progress != last_progress and abs(total_progress - last_progress) > 0.5:
                        last_progress = total_progress
                        msg = {
                            "type": "progress",
                            "percent": total_progress,
                            "status": f"正在下载... {total_progress:.0f}%",
                        }
                        if speed:
                            msg["speed"] = speed
                        if not send_message(msg):
                            pass

            if "Post-processing" in line or "Embedding" in line:
                send_message({"type": "progress", "percent": 99, "status": "正在处理..."})

        return_code = process.wait()

        log(f"yt-dlp return code: {return_code}")

        if return_code == 0:
            # List all files in download directory for debugging
            log(f"=== Download complete, listing files in {download_path} ===")
            try:
                all_files = sorted(Path(download_path).iterdir(),
                                   key=lambda f: os.path.getmtime(f), reverse=True)
                for f in all_files[:10]:
                    if f.is_file():
                        size_mb = f.stat().st_size / (1024 * 1024)
                        ext = f.suffix
                        log(f"  {f.name}  ({size_mb:.1f}MB, ext={ext})")
            except Exception as le:
                log(f"Error listing directory: {le}")
            log(f"=== End file listing ===")

            # Prioritize: merged_file > destination_file (if .mp4) > find_downloaded_file
            file_path = None
            if merged_file and os.path.exists(merged_file):
                file_path = merged_file
                log(f"Using merged file: {file_path}")
            elif destination_file and os.path.isfile(destination_file) and destination_file.endswith('.mp4'):
                file_path = destination_file
                log(f"Using mp4 destination: {file_path}")
            elif destination_file and os.path.isfile(destination_file):
                file_path = destination_file
                log(f"Using destination (may be audio-only): {file_path}")
            if not file_path:
                file_path = find_downloaded_file(download_path, title, quality, quality_meta)
                log(f"Using find_downloaded_file result: {file_path}")
            log(f"Final returned file: {file_path}")
            # Remove macOS quarantine attribute so the file can be opened directly
            if sys.platform == "darwin" and file_path and os.path.isfile(file_path):
                try:
                    subprocess.run(["xattr", "-d", "com.apple.quarantine", file_path],
                                   capture_output=True, timeout=5)
                    log(f"Removed quarantine from {file_path}")
                except Exception as qe:
                    log(f"Quarantine removal failed (non-fatal): {qe}")
            send_message({
                "type": "complete",
                "filePath": file_path,
                "filesize": os.path.getsize(file_path) if os.path.isfile(file_path) else 0,
                "status": "下载完成！"
            })
        else:
            log(f"yt-dlp failed with return code: {return_code}")
            ytdlp_ver = get_ytdlp_version() or "unknown"
            send_message({"type": "error", "message": f"下载失败，错误码: {return_code} (yt-dlp: {ytdlp_ver})"})

        _cleanup_cookie_file(cookie_file)
    except FileNotFoundError:
        _cleanup_cookie_file(cookie_file)
        send_message({"type": "error", "message": "找不到 yt-dlp，请确保已安装"})
    except (BrokenPipeError, OSError):
        # Chrome disconnected the native messaging port
        # Kill the yt-dlp subprocess if still running
        log("BrokenPipeError: Chrome disconnected, killing yt-dlp subprocess")
        _cleanup_cookie_file(cookie_file)
        if process and process.poll() is None:
            try:
                process.kill()
                process.wait(timeout=5)
                log("yt-dlp subprocess terminated")
            except Exception as ke:
                log(f"Error killing yt-dlp: {ke}")
        # Don't try to send an error message - the pipe is broken
    except Exception as e:
        log(f"handle_download exception: {e}")
        _cleanup_cookie_file(cookie_file)
        if process and process.poll() is None:
            try:
                process.kill()
                log("yt-dlp subprocess terminated due to error")
            except:
                pass
        send_message({"type": "error", "message": str(e)})

def sanitize_title_for_filename(title):
    """Perform basic character replacements similar to yt-dlp's sanitization"""
    safe = title
    safe = safe.replace('/', '_')
    safe = safe.replace('\\', '_')
    safe = safe.replace(':', '_')
    safe = safe.replace('*', '_')
    safe = safe.replace('?', '_')
    safe = safe.replace('"', '_')
    safe = safe.replace('<', '_')
    safe = safe.replace('>', '_')
    safe = safe.replace('|', '_')
    return safe

def find_downloaded_file(directory, title, quality=None, quality_meta=None):
    """Find the downloaded file by constructing expected filenames from title and quality.
    Uses os.path.isfile() which works even when directory listing is blocked by macOS TCC."""
    safe = sanitize_title_for_filename(title)
    candidates = []

    if quality == "audio":
        candidates = [f"{safe} (audio).mp3", f"{safe}.mp3"]
    elif quality_meta and quality_meta.get("height"):
        h = quality_meta["height"]
        label = "4K" if h == 2160 else f"{h}p"
        codec = quality_meta.get("codec", "")
        if codec:
            label += f" {codec}"
        ext_meta = (quality_meta.get("ext") or "").lower()
        if ext_meta == "webm":
            candidates = [f"{safe} ({label}).webm", f"{safe} ({label}).mkv"]
        else:
            candidates = [f"{safe} ({label}).mp4"]
    elif quality and quality != "best" and not quality.isdigit():
        h = quality.rstrip('p')
        if h.isdigit():
            candidates = [f"{safe} ({h}p).mp4"]

    candidates.extend([f"{safe}.mp4", f"{safe}.mkv", f"{safe}.webm"])

    for name in candidates:
        path = os.path.join(directory, name)
        try:
            if os.path.isfile(path) and os.path.getsize(path) > 1000000:
                log(f"Found constructed path: {path}")
                return path
        except OSError:
            continue
    log(f"Could not find file at any constructed path in {directory}")
    return directory

def handle_remove_quarantine(request):
    """Remove macOS quarantine attribute from file"""
    file_path = request.get("filePath")
    if not file_path or sys.platform != "darwin":
        return
    try:
        subprocess.run(["xattr", "-d", "com.apple.quarantine", file_path],
                       capture_output=True, timeout=5)
        log(f"Removed quarantine from {file_path}")
    except Exception as e:
        log(f"removeQuarantine failed: {e}")

def handle_open_file(request):
    """Open file with system default app"""
    file_path = request.get("filePath")
    if not file_path:
        return
    try:
        file_path = os.path.abspath(file_path)
        if sys.platform == "darwin":
            subprocess.run(["open", file_path], check=True)
        elif sys.platform == "win32":
            os.startfile(file_path)
        else:
            subprocess.run(["xdg-open", file_path], check=True)
    except Exception as e:
        send_message({"type": "error", "message": str(e)})

def handle_open_folder(request):
    """Open the containing folder and select the file"""
    file_path = request.get("filePath")
    if not file_path:
        return
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", file_path], check=True)
        elif sys.platform == "win32":
            # Open the containing folder directly
            folder = os.path.dirname(os.path.abspath(file_path))
            os.startfile(folder)
        else:
            subprocess.run(["xdg-open", os.path.dirname(file_path)], check=True)
    except Exception as e:
        send_message({"type": "error", "message": str(e)})

def main():
    """Read JSON messages from stdin and process"""
    log("main() started, waiting for input")
    while True:
        try:
            # Read 4-byte length prefix (Native Messaging protocol)
            length_bytes = sys.stdin.buffer.read(4)
            if not length_bytes or len(length_bytes) < 4:
                log("No data or incomplete length bytes, exiting")
                break

            # Unpack as little-endian unsigned int
            msg_length = struct.unpack('<I', length_bytes)[0]
            log(f"Message length: {msg_length}")

            # Read the actual message
            message_bytes = sys.stdin.buffer.read(msg_length)
            log(f"Raw message bytes: {message_bytes[:100]}...")

            # Try UTF-8 first
            try:
                line = message_bytes.decode('utf-8').strip()
            except UnicodeDecodeError:
                # Fallback to UTF-16-LE with BOM detection
                if message_bytes.startswith(b'\xff\xfe'):
                    message_bytes = message_bytes[2:]
                elif message_bytes.startswith(b'\xfe\xff'):
                    message_bytes = message_bytes[2:]
                try:
                    line = message_bytes.decode('utf-16-le').strip()
                except UnicodeDecodeError:
                    line = message_bytes.decode('utf-8', errors='replace').strip()

            log(f"Decoded line: {repr(line[:100])}")

            if not line:
                continue

            request = json.loads(line)
            log(f"Parsed request: {request}")
            action = request.get("action")
            log(f"Action: {action}")

            if action == "download":
                log("Calling handle_download")
                handle_download(request)
            elif action == "removeQuarantine":
                handle_remove_quarantine(request)
            elif action == "openFile":
                handle_open_file(request)
            elif action == "openFolder":
                handle_open_folder(request)
            elif action == "playFile":
                # Remove macOS quarantine then open the file
                file_path = request.get("filePath")
                if file_path and sys.platform == "darwin":
                    try:
                        subprocess.run(["xattr", "-d", "com.apple.quarantine", file_path],
                                       capture_output=True, timeout=5)
                        log(f"Removed quarantine for play: {file_path}")
                    except:
                        pass
                if file_path:
                    handle_open_file(request)
            elif action == "ping":
                log("Sending pong response")
                send_message({"type": "pong", "version": NATIVE_HOST_VERSION})
            elif action == "getVersion":
                # Quick check - just return current version, don't check latest
                version = get_ytdlp_version()
                send_message({
                    "type": "version",
                    "version": version,
                    "latestVersion": version,  # Assume current is latest if we can't check
                    "needsUpdate": False
                })
            elif action == "listFormats":
                log("Listing formats")
                handle_list_formats(request)
            elif action == "checkAndUpdate":
                # Check latest and update if needed - only called after download failure
                latest = get_latest_ytdlp_version()
                current = get_ytdlp_version()
                needs_upd = (not current or not latest or current != latest)
                send_message({
                    "type": "versionCheck",
                    "version": current,
                    "latestVersion": latest,
                    "needsUpdate": needs_upd
                })
                if needs_upd:
                    success = update_ytdlp()
                    if success:
                        new_version = get_ytdlp_version()
                        send_message({"type": "updateComplete", "success": True, "version": new_version})
                    else:
                        send_message({"type": "updateComplete", "success": False, "error": "更新失败"})
            elif action == "updateYtDlp":
                log("Request to update yt-dlp")
                success = update_ytdlp()
                if success:
                    new_version = get_ytdlp_version()
                    send_message({"type": "updateComplete", "success": True, "version": new_version})
                else:
                    send_message({"type": "updateComplete", "success": False, "error": "更新失败"})
            else:
                send_message({"type": "error", "message": f"Unknown action: {action}"})

        except (BrokenPipeError, OSError):
            # Chrome disconnected stdin/stdout, clean exit
            log("Chrome disconnected, exiting gracefully")
            break
        except json.JSONDecodeError as e:
            log(f"JSONDecodeError: {e}")
            send_message({"type": "error", "message": "Invalid JSON"})
        except Exception as e:
            log(f"Exception in main loop: {type(e).__name__}: {e}")
            try:
                send_message({"type": "error", "message": str(e)})
            except (BrokenPipeError, OSError):
                log("Cannot send error (broken pipe), exiting")
                break

if __name__ == "__main__":
    main()