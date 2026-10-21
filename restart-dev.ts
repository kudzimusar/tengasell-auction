import { readFileSync, writeFileSync, openSync } from "fs"
try { process.kill(Number(readFileSync("/home/z/my-project/.zscripts/dev.pid", "utf8").trim()), "SIGTERM") } catch {}
await new Promise(r => setTimeout(r, 3000))
const old = Bun.spawnSync({ cmd: ["bash", "-c", "ss -ltnp | grep ':3000 '"] })
if (old.stdout.toString().includes(":3000")) {
  Bun.spawnSync({ cmd: ["bash", "-c", "pkill -f 'next dev -p 3000'; pkill -f 'next-server'"] })
  await new Promise(r => setTimeout(r, 2500))
}
const logFd = openSync("/home/z/my-project/dev.log", "a")
const p = Bun.spawn({
  cmd: ["bash", "-c", "cd /home/z/my-project && NODE_OPTIONS=--experimental-sqlite bun run dev"],
  stdout: logFd, stderr: logFd, stdin: "ignore",
  env: { ...process.env },
  detached: true,
})
try { Bun.spawnSync({ cmd: ["bash", "-c", `sleep 1; true`] }) } catch {}
writeFileSync("/home/z/my-project/.zscripts/dev.pid", String(p.pid))
console.log("orphaned dev server (sqlite flag) pid", p.pid)
process.exit(0)
