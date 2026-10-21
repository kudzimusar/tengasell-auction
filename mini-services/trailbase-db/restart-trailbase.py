#!/usr/bin/env python3
"""Restart the Tengasell TrailBase service (detached double-fork daemon).

Usage: python3 restart-trailbase.py
"""
import os
import signal
import subprocess
import sys
import time

DEPOT_DIR = "/home/z/my-project/mini-services/trailbase-db"
TRAIL = "/home/z/.local/bin/trail"
LOG = os.path.join(DEPOT_DIR, "trailbase.log")


def find_trail_pids():
    out = subprocess.run(["pgrep", "-f", "trail --depot ./traildepot run"], capture_output=True, text=True)
    return [int(p) for p in out.stdout.split()]


def main():
    for pid in find_trail_pids():
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + 10
    while find_trail_pids() and time.time() < deadline:
        time.sleep(0.3)
    for pid in find_trail_pids():
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    pid = os.fork()
    if pid == 0:
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:
            os.chdir(DEPOT_DIR)
            fd = os.open(LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            os.execv(TRAIL, [TRAIL, "--depot", "./traildepot", "run", "--address", "0.0.0.0:3001"])
        os._exit(0)
    os.waitpid(pid, 0)

    # wait for the listener
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            import socket
            s = socket.create_connection(("127.0.0.1", 3001), timeout=1)
            s.close()
            print("trailbase listening on :3001")
            return 0
        except OSError:
            time.sleep(0.4)
    print("trailbase did not come up", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
