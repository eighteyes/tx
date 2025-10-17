# TMUX Injection

Claude needs delays between send-keys commands to register modes.

The following are to be sent to the target claude session via sendkeys.

## File Injection
@
sleep 0.5
filepath/here/file.md
sleep 0.5
Enter

## Command Injection
/
sleep 0.5
commandname param1 param2
sleep 0.5
Enter

## Direct Injection
send-keys 2000 characters of raw content
sleep 0.5
Enter