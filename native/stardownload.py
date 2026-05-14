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
import datetime
from pathlib import Path

LOG_FILE = os.path.expanduser("~/Library/Logs/stardownload.log")

def log(message):
    """Write log to file"""
    try:
        os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
        with open(LOG_FILE, "a") as f:
            f.write(f"[{datetime.datetime.now().isoformat()}] {message}\n")
    except:
        pass

REQUIRED_VERSION = "2026.03.17"

def get_ytdlp_path():
    """Find yt-dlp binary"""
    log("get_ytdlp_path called")
    # Check for newer version first (pipx-installed version at ~/.local/bin)
    newer_paths = [
        os.path.expanduser("~/.local/bin/yt-dlp"),
        os.path.expanduser("~/Library/Python/3.9/bin/yt-dlp"),
    ]
    for path in newer_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            log(f"Found yt-dlp at: {path}")
            return path

    # Check PATH first
    for cmd in ["yt-dlp", "ytdlp"]:
        try:
            result = subprocess.run(["which", cmd], capture_output=True, text=True)
            if result.returncode == 0:
                log(f"Found yt-dlp at: {result.stdout.strip()}")
                return result.stdout.strip()
        except:
            pass

    # Check common installation paths
    common_paths = [
        "/usr/local/bin/yt-dlp",
        "/usr/local/bin/ytdlp",
        "/opt/homebrew/bin/yt-dlp",
        str(Path.home() / ".local" / "bin" / "yt-dlp"),
    ]

    for path in common_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            log(f"Found yt-dlp at common path: {path}")
            return path

    log("yt-dlp not found in common paths, returning 'yt-dlp' to rely on PATH")
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
    paths = [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]
    log(f"get_ffmpeg_path: checking paths={paths}")
    for p in paths:
        exists = os.path.isfile(p)
        executable = exists and os.access(p, os.X_OK)
        log(f"  check {p}: exists={exists}, executable={executable}")
        if exists and executable:
            log(f"  => Found ffmpeg at: {p}")
            return (p, True)
    try:
        result = subprocess.run(["which", "ffmpeg"], capture_output=True, text=True)
        if result.returncode == 0:
            path = result.stdout.strip()
            if os.path.isfile(path):
                log(f"  => Found ffmpeg via which: {path}")
                return (path, True)
    except:
        pass
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
    # Try pipx first (for user-installed)
    try:
        result = subprocess.run(["pipx", "upgrade", "yt-dlp"], capture_output=True, text=True, timeout=60)
        if result.returncode == 0:
            log("yt-dlp updated via pipx")
            return True
    except:
        pass

    # Try direct pip install
    try:
        user_python = os.path.expanduser("~/Library/Python/3.9/bin/python3")
        if os.path.exists(user_python):
            result = subprocess.run([user_python, "-m", "pip", "install", "--user", "-U", "yt-dlp"],
                                  capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                log("yt-dlp updated via pip")
                return True
    except:
        pass

    # Try homebrew
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
    """Parse yt-dlp progress from stdout/stderr"""
    # Match: [download]  45.2% of 123.45MiB at  1.23MiB/s ETA 00:01
    match = re.search(r'\[download\]\s+(\d+\.?\d*)%', line)
    if match:
        return float(match.group(1))

    # Match fragments downloading
    if '[download] Downloading fragment' in line:
        return -1  # Indicate fragment download

    return None

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


def handle_list_formats(request):
    """List available formats for a video using yt-dlp JSON output"""
    url = request.get("url")
    if not url:
        send_message({"type": "error", "message": "No URL provided"})
        return

    ytdlp = get_ytdlp_path()
    # Use -j to get JSON output instead of parsing table format
    cmd = [ytdlp, "--no-playlist", "-j", "--no-download", url]

    log(f"Command to execute: {' '.join(cmd)}")

    try:
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=20
        )
        output = process.stdout
        log(f"JSON output length: {len(output)}")

        # Parse formats from JSON
        formats = parse_formats_from_json(output)
        log(f"Parsed {len(formats)} formats")

        send_message({
            "type": "formats",
            "formats": formats
        })
    except subprocess.TimeoutExpired:
        log("Format listing timed out")
        send_message({"type": "error", "message": "获取格式超时"})
    except json.JSONDecodeError as e:
        log(f"JSON parse error: {e}")
        # Fallback: try table-based parsing
        send_message({"type": "error", "message": f"解析格式信息失败: {e}"})
    except Exception as e:
        log(f"handle_list_formats error: {e}")
        send_message({"type": "error", "message": str(e)})


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
        filesize = fmt.get("filesize")

        # Check if this is a video format (has resolution)
        has_video = fmt.get("vcodec") and fmt.get("vcodec") != "none"
        if has_video and height:
            label = f"{height}p {ext.upper()}"
        elif fmt.get("acodec") and fmt.get("acodec") != "none" and not has_video:
            label = f"Audio {ext.upper()}"
        else:
            label = f"{ext.upper()}"

        formats.append({
            "id": format_id,
            "ext": ext,
            "height": height,
            "label": label,
            "filesize": filesize
        })

    log(f"Parsed {len(formats)} formats from JSON")

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

    log(f"handle_download called with url={url}, quality={quality}")

    if not url:
        send_message({"type": "error", "message": "No URL provided"})
        return

    download_path = request.get("downloadPath") or get_default_download_path()
    os.makedirs(download_path, exist_ok=True)

    ytdlp = get_ytdlp_path()
    log(f"Using yt-dlp at: {ytdlp}")

    # Build command
    cmd = [
        ytdlp,
        "--no-playlist",
        "--progress",
        "--newline",
        "-o", os.path.join(download_path, "%(title)s.%(ext)s")
    ]

    # Add proxy if specified
    if proxy:
        cmd.extend(["--proxy", proxy])

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
    format_string = None
    if quality == "audio":
        format_string = "audio-only"
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
        if can_merge:
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

    log(f"Quality={quality}, format_string={format_string}, can_merge={can_merge}")

    cmd.append(url)

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
                progress = parse_progress(line)
                if progress is not None and progress > 0:
                    if can_merge and download_phase >= 2:
                        total_progress = 80 + progress * 0.15
                    elif can_merge and download_phase >= 1:
                        total_progress = progress * 0.80
                    else:
                        total_progress = progress

                    if total_progress != last_progress and abs(total_progress - last_progress) > 0.5:
                        last_progress = total_progress
                        if not send_message({
                            "type": "progress",
                            "percent": total_progress,
                            "status": f"正在下载... {total_progress:.0f}%"
                        }):
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
                file_path = find_downloaded_file(download_path, title)
                log(f"Using find_downloaded_file result: {file_path}")
            log(f"Final returned file: {file_path}")
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

    except (BrokenPipeError, OSError):
        # Chrome disconnected the native messaging port
        # Kill the yt-dlp subprocess if still running
        log("BrokenPipeError: Chrome disconnected, killing yt-dlp subprocess")
        if process and process.poll() is None:
            try:
                process.kill()
                process.wait(timeout=5)
                log("yt-dlp subprocess terminated")
            except Exception as ke:
                log(f"Error killing yt-dlp: {ke}")
        # Don't try to send an error message - the pipe is broken
    except FileNotFoundError:
        send_message({"type": "error", "message": "找不到 yt-dlp，请确保已安装"})
    except Exception as e:
        log(f"handle_download exception: {e}")
        if process and process.poll() is None:
            try:
                process.kill()
                log("yt-dlp subprocess terminated due to error")
            except:
                pass
        send_message({"type": "error", "message": str(e)})

def find_downloaded_file(directory, title):
    """Find the downloaded file - prefer largest recent file (merged result is biggest)"""
    try:
        files = [f for f in Path(directory).iterdir() if f.is_file()]
        # Sort by mod time descending, then by size descending (merged file is biggest and most recent)
        files.sort(key=lambda f: (os.path.getmtime(f), f.stat().st_size), reverse=True)
        log(f"Files in {directory}: {[f.name for f in files[:10]]}")
        # Prefer MP4 with reasonable size (>1MB = definitely has content)
        for f in files:
            if f.suffix == '.mp4' and f.stat().st_size > 1000000:
                log(f"Found merged mp4: {f.name} size={f.stat().st_size}")
                return str(f)
        # Fallback: any video file
        for f in files:
            if f.suffix in ['.mp4', '.mkv', '.webm', '.mp3']:
                return str(f)
    except Exception as e:
        log(f"Error finding file: {e}")
    return directory

def handle_open_file(request):
    """Open file with system default app"""
    file_path = request.get("filePath")
    if not file_path:
        return
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", file_path], check=True)
        elif sys.platform == "win32":
            os.startfile(file_path)
        else:
            subprocess.run(["xdg-open", file_path], check=True)
    except Exception as e:
        send_message({"type": "error", "message": str(e)})

def handle_open_folder(request):
    """Open folder and reveal file"""
    file_path = request.get("filePath")
    if not file_path:
        return
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", file_path], check=True)
        elif sys.platform == "win32":
            subprocess.run(["explorer", "/select,", file_path], check=True)
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
            elif action == "openFile":
                handle_open_file(request)
            elif action == "openFolder":
                handle_open_folder(request)
            elif action == "ping":
                log("Sending pong response")
                send_message({"type": "pong"})
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