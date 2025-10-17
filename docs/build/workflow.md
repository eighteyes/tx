# File based message queue workflow
Enforced with a file watcher.

# Task Workflow
1. Spawn
2. Write message (type:task) to mesh inbox
3. If mesh next is empty move to mesh next
4. If mesh active is empty move to mesh active
5. From mesh active, if a file arrives, copy message to first agent inbox
6. From first agent inbox check if agent next is empty, if so, move message to agent next.
7. If agent active is empty, move to agent active.
8. If running, wait for agent to be idle, Inject File Path to first agent session
9. ... working ...
10. First agent writes message to outbox
11. Watcher sends message to target and moves outbox & active message to complete.
12. When final agent issues 'type: task-complete' then also move mesh active message to complete. 

# Ask Workflow
1. working ... needs information from other agent ... 
2. Write message to self outbox, ( to: <other-agent>, type: ask, id: abcd )
3. Message copied to other Agent inbox, and moves to active, fast-track.
4. Wait for Other Agent to be idle ( 1 min check ), Inject File Path
5. Other Agent Working... 
6. Writes message to other agent outbox ( type: ask-response, id: abcd )
7. Deliver message and move to complete. 