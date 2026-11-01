import os
import time
import socket

def run(msg, history):
    rid = msg.get("id")
    items = sorted(history.items(), key=lambda kv: kv[1].get("ts", 0), reverse=True)[:30]
    lines = ["# webai-claw session summary", "", "generated: " + time.strftime("%Y-%m-%d %H:%M:%S")]
    for k, v in items:
        lines.append("- %s  %s  exit=%s  %sms  cmd_len=%s" % (
            v.get("id") or k,
            "ok" if v.get("ok") else "fail",
            v.get("exit_code"),
            v.get("duration_ms", 0),
            v.get("cmd_len", 0)))
    d = os.path.join(os.path.expanduser("~"), ".webai-claw")
    os.makedirs(d, exist_ok=True)
    sp = os.path.join(d, "session-summary.md")
    with open(sp, "w", encoding="utf-8") as fh:
        fh.write(chr(10).join(lines))
    return {"type": "result", "id": rid, "hostname": socket.gethostname(), "ok": True, "exit_code": 0, "stdout": "summary: " + sp, "stderr": "", "duration_ms": 0, "ts": int(time.time())}
