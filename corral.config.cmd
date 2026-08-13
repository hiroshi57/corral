@echo off
rem ============================================================
rem  Corral settings (edit this file to change configuration)
rem  Loaded by start-corral.cmd at startup. Do not run directly.
rem  NOTE: Keep this file ASCII-only (Windows cmd limitation).
rem  Japanese docs: see README.md
rem ============================================================

rem Production mode: 0 = real agents run / 1 = demo (simulated)
set CORRAL_DEMO=0

rem Target git repository the agents work on
set CORRAL_REPO=C:\Users\hiroshi_takizawa\corral

rem Max concurrent agents (extra tasks wait in queue)
set CORRAL_MAX_CONCURRENT=3

rem Policy guardrails (block dangerous commands, mask secrets): 1 = on
set CORRAL_GUARDRAILS=1

rem Budget cap in USD. 0 = unlimited. HARDCAP=1 stops new tasks when reached
set CORRAL_BUDGET_USD=0
set CORRAL_BUDGET_HARDCAP=0

rem ---- Notifications (optional): Chatwork / Slack ----
rem set CORRAL_CHATWORK_TOKEN=xxxxxxxx
rem set CORRAL_CHATWORK_ROOM=123456789
rem set CORRAL_SLACK_WEBHOOK=https://hooks.slack.com/services/xxx

rem ---- Execution mode (optional): local / docker (sandbox) / ssh (remote) ----
rem set CORRAL_EXEC_MODE=local

rem ---- Extra repositories for multi-repo (optional, JSON) ----
rem set CORRAL_REPOS=[{"name":"web","path":"C:\\path\\to\\web","workspaceId":"default"}]
