#!/usr/bin/env python3
"""
StarDownload Native Host
Receives download requests from Chrome extension and executes yt-dlp
"""

import json
import sys
import os
import subprocess
import re
import threading
import getpass
from pathlib import Path

# Configuration
APP_NAME = "com.stardownload.host"
MAX_PROGRESS = 100

def get_default_download_path():
    """Get default download path based on OS"""
    if sys.platform == "darwin":
        return Path.home() / "Downloads"
    elif sys.platform == "win32":
        return Path.home() / "Downloads"
    else:
        return Path.home() / "Downloads"

def get_ffmpeg_path():
    """Find ffmpeg in common locations"""
    common_paths = [
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        str(Path.home() / "Applications" / "ffmpeg" / "bin" / "ffmpeg")
    ]

    # Check if ffmpeg is in PATH
    try:
        result = subprocess.run(["which", "ffmpeg"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass

    # Check common paths
    for path in common_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path

    return "ffmpeg"  # Fallback to assuming it's in PATH

def get_ytdlp_path():
    """Find yt-dlp in common locations"""
    common_paths = [
        "/usr/local/bin/ytdlp",
        "/usr/local/bin/yt-dlp",
        "/usr/bin/ytdlp",
        "/usr/bin/yt-dlp",
        "/opt/homebrew/bin/ytdlp",
        "/opt/homebrew/bin/yt-dlp",
        str(Path.home() / "Applications" / "ytdlp" / "ytdlp"),
        str(Path.home() / "Applications" / "yt-dlp" / "yt-dlp")
    ]

    # Check if yt-dlp is in PATH
    try:
        result = subprocess.run(["which", "yt-dlp"], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip()
    except:
        pass

    # Check common paths
    for path in common_paths:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path

    return "yt-dlp"  # Fallback to assuming it's in PATH

def parse_progress(line):
    """Parse yt-dlp progress output"""
    # Match patterns like [download]  45.2% of 123.45MiB
    match = re.search(r'\[download\]\s+(\d+\.?\d*)%', line)
    if match:
        return float(match.group(1))

    # Match fragments
    match = re.search(r'\[download\]\s+Downloading fragment (\d+)', line)
    if match:
        return -1  # Special marker for fragment download

    return None

def build_ytdlp_command(url, quality, download_path, proxy, auto_update):
    """Build yt-dlp command with parameters"""
    ytdlp = get_ytdlp_path()

    cmd = [ytdlp]

    # Auto update if enabled
    if auto_update:
        cmd.append("-U")

    # Cookie from browser
    cmd.extend(["--cookies-from-browser", "chrome"])

    # Proxy if specified
    if proxy:
        cmd.extend(["--proxy", proxy])

    # Format selection based on quality
    if quality == "audio":
        cmd.extend(["-x", "--audio-format", "mp3"])
    elif quality == "best":
        cmd.extend(["-f", "bestvideo+bestaudio/best"])
    else:
        # Specific quality like 1080p, 720p, etc.
        cmd.extend(["-f", f"bestvideo[height<={quality[:-1]}]+bestaudio/best[height<={quality[:-1]}]"])

    # Merge to mp4
    if quality != "audio":
        cmd.extend(["--merge-output-format", "mp4"])

    # Output template
    output_template = os.path.join(download_path, "%(title)s.%(ext)s")
    cmd.extend(["-o", output_template])

    # Progress template for parsing
    cmd.extend(["--progress-template", "%(progress)s"])

    # Add URL
    cmd.append(url)

    return cmd

def send_message(message):
    """Send JSON message to stdout"""
    print(json.dumps(message), flush=True)

def handle_download(request):
    """Handle download request"""
    url = request.get("url")
    quality = request.get("quality", "best")
    title = request.get("title", "video")

    if not url:
        send_message({"type": "error", "message": "No URL provided"})
        return

    # Get settings (these would be loaded from config file in production)
    # For now, use defaults
    download_path = str(get_default_download_path())
    proxy = None  # Will be read from settings
    auto_update = True

    # Ensure download directory exists
    os.makedirs(download_path, exist_ok=True)

    # Build command
    cmd = build_ytdlp_command(url, quality, download_path, proxy, auto_update)

    send_message({"type": "progress", "percent": 0, "status": "正在解析视频信息..."})

    try:
        # Start process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        # Read output line by line
        for line in process.stdout:
            line = line.strip()
            progress = parse_progress(line)

            if progress is not None:
                if progress >= 0:
                    send_message({
                        "type": "progress",
                        "percent": progress,
                        "status": f"正在下载中... {progress:.1f}%"
                    })
                else:
                    send_message({
                        "type": "progress",
                        "percent": 0,
                        "status": "正在下载中..."
                    })

            # Check for completion keywords
            if "Merging" in line or "Merged" in line:
                send_message({
                    "type": "progress",
                    "percent": 95,
                    "status": "正在合并音视频..."
                })
            elif "Post-processing" in line:
                send_message({
                    "type": "progress",
                    "percent": 98,
                    "status": "正在处理..."
                })

        # Wait for process to complete
        return_code = process.wait()

        if return_code == 0:
            # Find the downloaded file
            file_path = find_downloaded_file(download_path, title)
            send_message({
                "type": "complete",
                "filePath": file_path,
                "status": "下载完成！"
            })
        else:
            send_message({
                "type": "error",
                "message": f"下载失败，错误码: {return_code}"
            })

    except FileNotFoundError:
        send_message({
            "type": "error",
            "message": "找不到 yt-dlp，请确保已安装并配置在 PATH 中"
        })
    except Exception as e:
        send_message({
            "type": "error",
            "message": f"下载出错: {str(e)}"
        })

def find_downloaded_file(directory, title):
    """Find the downloaded file matching the title"""
    try:
        # List files in download directory, sorted by modification time
        files = sorted(Path(directory).glob("*"), key=os.path.getmtime, reverse=True)

        for file in files:
            if file.is_file() and title.lower() in file.stem.lower():
                return str(file)

        # If no match, return the most recently modified file
        if files:
            return str(files[0])

    except Exception:
        pass

    return directory  # Fallback to directory path

def handle_open_file(request):
    """Open file with default application"""
    file_path = request.get("filePath")
    if not file_path:
        return

    try:
        if sys.platform == "darwin":
            subprocess.run(["open", file_path])
        elif sys.platform == "win32":
            os.startfile(file_path)
        else:
            subprocess.run(["xdg-open", file_path])
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}), flush=True)

def handle_open_folder(request):
    """Open containing folder and select file"""
    file_path = request.get("filePath")
    if not file_path:
        return

    try:
        folder = os.path.dirname(file_path)
        if sys.platform == "darwin":
            subprocess.run(["open", "-R", file_path])
        elif sys.platform == "win32":
            subprocess.run(["explorer", "/select,", file_path])
        else:
            subprocess.run(["xdg-open", folder])
    except Exception as e:
        print(json.dumps({"type": "error", "message": str(e)}), flush=True)

def main():
    """Main entry point - read messages from stdin"""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break

            request = json.loads(line.strip())
            action = request.get("action")

            if action == "download":
                handle_download(request)
            elif action == "openFile":
                handle_open_file(request)
            elif action == "openFolder":
                handle_open_folder(request)
            elif action == "ping":
                send_message({"type": "pong"})
            else:
                send_message({"type": "error", "message": f"Unknown action: {action}"})

        except json.JSONDecodeError:
            send_message({"type": "error", "message": "Invalid JSON input"})
        except Exception as e:
            send_message({"type": "error", "message": str(e)})

if __name__ == "__main__":
    main()