#!/usr/bin/env python3
"""A stand-in for `claude -p --input-format stream-json --output-format stream-json --permission-prompt-tool stdio`,
speaking the same messages, for the tests of the agents module (no network, no account)."""
import json, os, sys, time, uuid
session = str(uuid.uuid4())
def out(o):
    sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
inited = False
turn = 0
def read():
    line = sys.stdin.readline()
    return json.loads(line) if line else None
while True:
    m = read()
    if m is None:
        break
    if m.get("type") == "control_request":
        sub = m["request"].get("subtype")
        out({"type": "control_response", "response": {"subtype": "success", "request_id": m["request_id"], "response": {}}})
        if sub == "interrupt":
            out({"type": "result", "subtype": "error_during_execution", "is_error": True, "total_cost_usd": 0.0, "num_turns": 0, "usage": {}})
        continue
    if m.get("type") != "user":
        continue
    text = m["message"]["content"][0]["text"]
    if not inited:
        out({"type": "system", "subtype": "init", "session_id": session, "model": "claude-fake", "cwd": "."})
        inited = True
    turn += 1
    if "slow" in text:
        out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t-slow", "name": "Bash", "input": {"command": "sleep 100"}}]}})
        continue
    out({"type": "assistant", "message": {"content": [{"type": "text", "text": "Sure. I will look at the project and update README.md."}]}})
    out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": f"t{turn}", "name": "Write", "input": {"file_path": os.path.join(os.getcwd(), "README.md"), "content": "x"}}]}})
    out({"type": "rate_limit_event", "rate_limit_info": {"unifiedWindows": {"five_hour": {"utilization": 0.31, "resetsAt": int(time.time()) + 2 * 3600 + 17 * 60}, "seven_day": {"utilization": 0.5, "resetsAt": int(time.time()) + 3 * 86400}}}})
    rid = f"req-{turn}"
    out({"type": "control_request", "request_id": rid, "request": {"subtype": "can_use_tool", "tool_name": "Write", "display_name": "Write",
         "input": {"file_path": os.path.join(os.getcwd(), "README.md"), "content": "x"}, "description": "README.md", "permission_suggestions": [{"type": "setMode", "mode": "acceptEdits", "destination": "session"}], "tool_use_id": f"t{turn}"}})
    # wait for the answer
    while True:
        a = read()
        if a is None:
            sys.exit(0)
        if a.get("type") == "control_response" and a["response"]["request_id"] == rid:
            behavior = a["response"]["response"]["behavior"]
            break
    ok = behavior == "allow"
    out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": f"t{turn}", "content": "written" if ok else "denied", "is_error": not ok}]}})
    out({"type": "assistant", "message": {"content": [{"type": "text", "text": "README.md is updated." if ok else "I did not change README.md."}]}})
    out({"type": "result", "subtype": "success", "is_error": False, "total_cost_usd": 0.01 * turn, "num_turns": 2, "result": "README.md is updated." if ok else "Nothing was changed.",
         "usage": {"input_tokens": 10, "output_tokens": 5}, "session_id": session})
