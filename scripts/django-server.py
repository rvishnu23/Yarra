import socket
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HOST = "127.0.0.1"
PORT = 4174


def port_open():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((HOST, PORT)) == 0


def main():
    if port_open():
        print(f"Django Yarra server is already running at http://{HOST}:{PORT}")
        return
    subprocess.Popen(
        [sys.executable, "manage.py", "runserver", f"{HOST}:{PORT}"],
        cwd=ROOT,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
    )
    for _ in range(30):
        time.sleep(0.25)
        if port_open():
            print(f"Django Yarra server started at http://{HOST}:{PORT}")
            return
    print("Django server launch requested, but the port did not respond yet.")


if __name__ == "__main__":
    main()
