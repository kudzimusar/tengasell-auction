#!/usr/bin/env python3
"""Restart the Tengasell trade engine (detached double-fork daemon, port 3002).

Mirrors restart-trailbase.py: kills any existing instance, then double-forks
so the engine ends up parented to init — it survives the sandbox's per-call
process-tree reaping. Verified pattern across dozens of bash calls.
"""
import os
import signal
import subprocess
import sys
import time

ENGINE_DIR = "/home/z/my-project/mini-services/trade-engine"
LOG = os.path.join(ENGINE_DIR, "trade-engine.log")


def find_pids():
    out = subprocess.run(["pgrep", "-f", "bun --hot index.ts"], capture_output=True, text=True)
    return [int(p) for p in out.stdout.split() if p]


def main():
    for pid in find_pids():
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    deadline = time.time() + 10
    while find_pids() and time.time() < deadline:
        time.sleep(0.3)
    for pid in find_pids():
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    pid = os.fork()
    if pid == 0:
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:
            os.chdir(ENGINE_DIR)
            fd = os.open(LOG, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            os.execvp("bun", ["bun", "--hot", "index.ts"])
        os._exit(0)
    os.waitpid(pid, 0)

    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            out = subprocess.run(
                ["ss", "-ltn", "sport = :3002"],
                capture_output=True,
                text=True,
            )
            if "LISTEN" in out.stdout:
                print("[engine] trade engine listening on :3002")
                return
        except Exception:
            pass
        time.sleep(0.5)
    print("[engine] WARNING: engine did not bind :3002 in 15s — check", LOG, file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
