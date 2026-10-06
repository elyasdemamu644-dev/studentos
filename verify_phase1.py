
import json, urllib.request, urllib.error

BASE = "http://localhost:3001/api/v1"

def api(method, path, token=None, data=None):
    url = BASE + path
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())

# Login
login = api("POST", "/auth/login", data={"email":"demo@studentos.dev","password":"StudentPass123!"})
token = login["data"]["accessToken"]
print(f"Login: OK (token len={len(token)})")

COURSE_ID = "cmugpii0j000gu3t81iut6bas"  # CS-161 Algorithms

# TEST 1: Create task with courseId
print("\n=== TEST 1: Create task with courseId ===")
task = api("POST", "/tasks", token, {
    "title": "Phase1 Verification Task",
    "description": "Testing course context propagation",
    "courseId": COURSE_ID,
    "priority": "HIGH",
    "type": "ASSIGNMENT",
    "dueDate": "2026-10-10T23:59:59.000Z"
})
print(f"Create task: {task['success']}")
task_id = task["data"]["id"]
print(f"  task id={task_id}, courseId={task['data']['courseId']}")

# Verify task in course filter
tasks_in_course = api("GET", f"/tasks?courseId={COURSE_ID}", token)
items = tasks_in_course["data"]["items"]
match = [t for t in items if t["id"] == task_id]
print(f"  Found in course filter: {len(match)>0}")
if match:
    print(f"  courseId matches: {match[0]['courseId'] == COURSE_ID}")

# TEST 2: Create event with courseId
print("\n=== TEST 2: Create event with courseId ===")
event = api("POST", "/events", token, {
    "title": "Phase1 Verification Event",
    "type": "EXAM",
    "startAt": "2026-10-15T09:00:00.000Z",
    "endAt": "2026-10-15T11:00:00.000Z",
    "courseId": COURSE_ID
})
print(f"Create event: {event['success']}")
event_id = event["data"]["id"]
print(f"  event id={event_id}, courseId={event['data']['courseId']}")

events_in_course = api("GET", f"/events?courseId={COURSE_ID}", token)
eitems = events_in_course["data"]["items"]
ematch = [e for e in eitems if e["id"] == event_id]
print(f"  Found in course filter: {len(ematch)>0}")
if ematch:
    print(f"  courseId matches: {ematch[0]['courseId'] == COURSE_ID}")

# TEST 3: Create study session with courseId
print("\n=== TEST 3: Create study session with courseId ===")
study = api("POST", "/study-sessions", token, {
    "courseId": COURSE_ID,
    "topic": "Phase1 Verification Study",
    "startedAt": "2026-10-05T14:00:00.000Z",
    "endedAt": "2026-10-05T14:25:00.000Z",
    "durationMinutes": 25,
    "focusRating": 4
})
print(f"Create study session: {study['success']}")
study_id = study["data"]["id"]
print(f"  session id={study_id}, courseId={study['data']['courseId']}")

# TEST 4: Tasks filter
print("\n=== TEST 4: Tasks filter by courseId ===")
all_tasks = api("GET", "/tasks", token)
course_tasks = api("GET", f"/tasks?courseId={COURSE_ID}", token)
print(f"  All tasks: {len(all_tasks['data']['items'])}")
print(f"  Course tasks: {len(course_tasks['data']['items'])}")
for t in course_tasks["data"]["items"]:
    print(f"    {t['title']} -> courseId={t.get('courseId')}")

# TEST 5: Notes with courseId
print("\n=== TEST 5: Notes with courseId ===")
note = api("POST", "/notes", token, {
    "title": "Phase1 Verification Note",
    "content": "Testing note course context",
    "courseId": COURSE_ID
})
print(f"Create note: {note['success']}")
note_id = note["data"]["id"]
print(f"  note id={note_id}, courseId={note['data']['courseId']}")

notes_in_course = api("GET", f"/notes?courseId={COURSE_ID}", token)
nitems = notes_in_course["data"]["items"]
nmatch = [n for n in nitems if n["id"] == note_id]
print(f"  Found in course filter: {len(nmatch)>0}")
if nmatch:
    print(f"  courseId matches: {nmatch[0]['courseId'] == COURSE_ID}")

# CLEANUP
print("\n=== CLEANUP ===")
for method, path in [
    ("DELETE", f"/tasks/{task_id}"),
    ("DELETE", f"/events/{event_id}"),
    ("DELETE", f"/study-sessions/{study_id}"),
    ("DELETE", f"/notes/{note_id}"),
]:
    r = api(method, path, token)
    print(f"  {method} {path}: {r.get('success', r.get('error',{}).get('code','?'))}")

print("\n=== ALL API TESTS COMPLETE ===")
