import json
import secrets
from datetime import datetime, timezone

from django.conf import settings
from django.http import FileResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .models import Entity


ROLE_ACCOUNTS = {
    "Super Admin": ("yarra.superadmin@akshararbol.edu.in", "Yarra@Super123"),
    "School Admin": ("yarra.schooladmin@akshararbol.edu.in", "Yarra@School123"),
    "Teacher": ("yarra.teacher@akshararbol.edu.in", "Yarra@Teacher123"),
    "Student": ("yarra.student@akshararbol.edu.in", "Yarra@Student123"),
    "Vendor": ("yarra.vendor@akshararbol.edu.in", "Yarra@Vendor123"),
}

RESOURCE_KIND = {
    "schools": "schools",
    "users": "users",
    "students": "students",
    "teachers": "teachers",
    "payments": "payments",
    "events": "events",
    "event-registrations": "eventRegistrations",
    "exchanges": "exchanges",
    "content": "content",
    "vendors": "vendors",
    "notifications": "notifications",
    "teacher-resources": "teacherResources",
    "review-cycles": "reviewCycles",
    "leadership-threads": "leadershipThreads",
    "market-orders": "marketOrders",
    "exchange-requests": "exchangeRequests",
}

STATE_KINDS = [
    "schools",
    "users",
    "students",
    "teachers",
    "vendors",
    "events",
    "eventRegistrations",
    "exchanges",
    "content",
    "promotions",
    "notifications",
    "payments",
    "teacherResources",
    "reviewCycles",
    "leadershipThreads",
    "marketOrders",
    "exchangeRequests",
    "products",
    "uploadHistory",
]


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def slug(value):
    text = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value or "item"))
    return "-".join(part for part in text.split("-") if part)[:48] or "item"


def create_id(prefix, value):
    return f"{prefix}-{slug(value)}-{secrets.token_hex(4)}"


def body_json(request):
    if not request.body:
        return {}
    return json.loads(request.body.decode("utf-8"))


def entities(kind):
    return [entity.data for entity in Entity.objects.filter(kind=kind).order_by("-created_at")]


def upsert(kind, data):
    external_id = data.get("id") or create_id(kind.rstrip("s"), data.get("name") or data.get("title") or kind)
    data["id"] = external_id
    Entity.objects.update_or_create(kind=kind, external_id=external_id, defaults={"data": data})
    return data


def delete_entity(kind, external_id):
    return Entity.objects.filter(kind=kind, external_id=external_id).delete()[0]


def find_one(kind, external_id):
    entity = Entity.objects.filter(kind=kind, external_id=external_id).first()
    return entity.data if entity else None


def save_existing(kind, data):
    Entity.objects.update_or_create(kind=kind, external_id=data["id"], defaults={"data": data})
    return data


def current_session(request):
    token = request.headers.get("X-Session-Id")
    if not token:
        return None
    entity = Entity.objects.filter(kind="sessions", external_id=token).first()
    return entity.data if entity else None


def current_user(request):
    session = current_session(request) or {}
    role = session.get("role") or request.headers.get("X-User-Role") or "School Admin"
    return {
        "role": role,
        "email": session.get("email") or "",
        "schoolId": session.get("schoolId") or "",
        "studentId": session.get("studentId") or "",
        "teacherId": session.get("teacherId") or "",
        "vendorId": session.get("vendorId") or "",
    }


def public_session(token, session):
    return {"id": token, **session}


def full_state():
    state = {kind: entities(kind) for kind in STATE_KINDS}
    state["exchanges"] = [normalize_exchange(item) for item in state.get("exchanges", [])]
    state.setdefault("settings", {})
    state["metrics"] = metrics(state)
    return state


def normalize_exchange(exchange):
    exchange = {**exchange}
    if exchange.get("status") in {"Consent Pending", "Scheduled"}:
        exchange["status"] = "Ongoing"
    exchange.setdefault("messages", [])
    return exchange


def metrics(data):
    schools = data.get("schools", [])
    payments = data.get("payments", [])
    vendors = data.get("vendors", [])
    return {
        "activeSchools": len([school for school in schools if school.get("status") == "Active"]),
        "vendors": len(vendors),
        "students": len(data.get("students", [])),
        "events": len(data.get("events", [])),
        "totalRevenue": sum(float(payment.get("amount") or 0) for payment in payments if payment.get("status") == "Paid"),
        "newSignups": len([school for school in schools if school.get("status") == "Pending approval"]),
        "reviewQueue": {
            "vendorUploads": len([vendor for vendor in vendors if vendor.get("status") != "Approved"]),
            "promotions": len([promo for promo in data.get("promotions", []) if promo.get("status") != "Live"]),
            "comments": 0,
        },
    }


def school_for_user(data, user):
    return next((school for school in data.get("schools", []) if school.get("id") == user.get("schoolId")), None)


def filtered_state(data, user):
    role = user["role"]
    if role == "Super Admin":
        return data
    if role in {"School Admin", "Teacher"}:
        school_id = user.get("schoolId")
        school = school_for_user(data, user)
        school_name = school.get("name") if school else ""
        data = {**data}
        data["schools"] = [school] if school else []
        data["users"] = [item for item in data.get("users", []) if item.get("schoolId") == school_id or item.get("email") == user.get("email")]
        data["students"] = [item for item in data.get("students", []) if item.get("schoolId") == school_id]
        data["teachers"] = [item for item in data.get("teachers", []) if item.get("schoolId") == school_id]
        data["payments"] = [item for item in data.get("payments", []) if item.get("schoolId") == school_id]
        data["events"] = [item for item in data.get("events", []) if item.get("scope") == "Inter school" or item.get("schoolId") == school_id]
        data["eventRegistrations"] = [item for item in data.get("eventRegistrations", []) if item.get("schoolId") == school_id]
        data["exchanges"] = data.get("exchanges", [])
        data["teacherResources"] = [item for item in data.get("teacherResources", []) if item.get("schoolId") == school_id]
        data["reviewCycles"] = [item for item in data.get("reviewCycles", []) if item.get("schoolId") == school_id]
        data["metrics"] = metrics(data)
        return data
    if role == "Student":
        student_id = user.get("studentId")
        student = next((item for item in data.get("students", []) if item.get("id") == student_id), None)
        school_id = student.get("schoolId") if student else user.get("schoolId")
        data = {**data}
        data["schools"] = [item for item in data.get("schools", []) if item.get("id") == school_id]
        data["students"] = [student] if student else []
        data["payments"] = []
        data["metrics"] = metrics(data)
        return data
    if role == "Vendor":
        vendor_id = user.get("vendorId")
        data = {**data}
        data["schools"] = []
        data["students"] = []
        data["events"] = []
        data["vendors"] = [item for item in data.get("vendors", []) if item.get("id") == vendor_id] or data.get("vendors", [])
        data["metrics"] = metrics(data)
        return data
    return data


def can_write(user, resource):
    role = user["role"]
    if role == "Super Admin":
        return True
    if resource in {"uploads", "payments"}:
        return role == "School Admin"
    if resource == "schools":
        return False
    if resource in {"exchanges", "events"}:
        return role in {"School Admin", "Teacher"}
    if resource in {"event-registrations"}:
        return role in {"School Admin", "Teacher", "Student"}
    if resource in {"teacher-resources", "review-cycles"}:
        return role in {"Super Admin", "School Admin", "Teacher"}
    if resource == "content":
        return role in {"Super Admin", "School Admin"}
    return role in {"Super Admin", "School Admin"}


def index(_request):
    return FileResponse(open(settings.BASE_DIR / "index.html", "rb"), content_type="text/html")


def health(_request):
    return JsonResponse({"status": "ok", "app": "yaara-consortium-django", "storage": "sqlite"})


@csrf_exempt
def login(request):
    payload = body_json(request)
    email = str(payload.get("email") or "").strip().lower()
    role = payload.get("role") or "School Admin"
    password = str(payload.get("password") or "")
    builtin = ROLE_ACCOUNTS.get(role)
    if builtin and email == builtin[0] and password != builtin[1]:
        return JsonResponse({"error": "Invalid username, password, or role for this Yarra account."}, status=401)

    users = entities("users")
    user = next((item for item in users if str(item.get("email", "")).lower() == email and item.get("role") == role), None)
    if not user and role == "Super Admin":
        user = upsert("users", {"id": f"user-{slug(email)}", "email": email, "name": "Yarra Super Admin", "role": role, "status": "Active"})
    if not user:
        return JsonResponse({"error": "No Yarra invite was found for this Gmail account."}, status=403)

    token = secrets.token_urlsafe(32)
    session = {
        "email": email,
        "name": user.get("name") or email.split("@")[0],
        "provider": "gmail-dev",
        "role": role,
        "userId": user.get("id"),
        "schoolId": user.get("schoolId"),
        "studentId": user.get("studentId") or (user.get("id") if role == "Student" else None),
        "teacherId": user.get("teacherId"),
        "vendorId": user.get("vendorId"),
        "createdAt": now_iso(),
        "lastSeenAt": now_iso(),
    }
    upsert("sessions", {"id": token, **session})
    return JsonResponse({"email": email, "name": session["name"], "provider": "gmail", "role": role, "schoolId": session.get("schoolId"), "session": public_session(token, session)})


@csrf_exempt
def logout(request):
    token = request.headers.get("X-Session-Id")
    if token:
        delete_entity("sessions", token)
    return JsonResponse({"signedOut": True})


@csrf_exempt
def extend_session(request):
    session = current_session(request)
    if not session:
        return JsonResponse({"error": "Please sign in again."}, status=401)
    token = request.headers.get("X-Session-Id")
    session["lastSeenAt"] = now_iso()
    upsert("sessions", {"id": token, **session})
    return JsonResponse({"session": public_session(token, session)})


@csrf_exempt
def switch_role(request):
    session = current_session(request)
    if not session:
        return JsonResponse({"error": "Please sign in again."}, status=401)
    payload = body_json(request)
    next_role = payload.get("role") or session["role"]
    if session.get("role") != "Super Admin" and next_role != session.get("role"):
        return JsonResponse({"error": "Only Super Admin can switch platform roles."}, status=403)
    token = request.headers.get("X-Session-Id")
    session["role"] = next_role
    session["lastSeenAt"] = now_iso()
    upsert("sessions", {"id": token, **session})
    return JsonResponse({"session": public_session(token, session), **session})


def payment_config(_request):
    return JsonResponse({"razorpayConfigured": False, "razorpayKeyId": "", "upiPayeeId": "vishnuaravindhr-1@okicici", "upiPayeeName": "Yarra Education Group"})


def state(request):
    return JsonResponse(filtered_state(full_state(), current_user(request)))


@csrf_exempt
def collection(request, resource):
    if request.method != "POST":
        return JsonResponse({"error": "API route not found"}, status=404)
    user = current_user(request)
    if not can_write(user, resource):
        return JsonResponse({"error": "You do not have permission for this action."}, status=403)
    payload = body_json(request)
    handler = CREATE_HANDLERS.get(resource)
    if handler:
        result = handler(payload, user)
        if result.get("error"):
            return JsonResponse(result, status=400)
        return JsonResponse(result, status=201)
    kind = RESOURCE_KIND.get(resource)
    if not kind:
        return JsonResponse({"error": "API route not found"}, status=404)
    return JsonResponse(upsert(kind, payload), status=201)


@csrf_exempt
def item(request, resource, item_id):
    user = current_user(request)
    kind = RESOURCE_KIND.get(resource)
    if not kind:
        return JsonResponse({"error": "API route not found"}, status=404)
    data = find_one(kind, item_id)
    if not data:
        return JsonResponse({"error": "Record not found."}, status=404)
    if request.method == "PATCH":
        if resource == "events" and not can_manage_event(user, data):
            return JsonResponse({"error": "You do not have permission for this action."}, status=403)
        if resource == "exchanges":
            if not can_alter_exchange(user, data):
                return JsonResponse({"error": "You do not have permission for this action."}, status=403)
            payload = body_json(request)
            title = str(payload.get("title") or "").strip()
            if not title:
                return JsonResponse({"error": "Exchange title is required."}, status=400)
            data.update(exchange_payload(payload, data, user))
            save_existing(kind, data)
            return JsonResponse(data)
        data.update(body_json(request))
        save_existing(kind, data)
        return JsonResponse(data)
    if request.method == "DELETE":
        if resource == "events" and not can_manage_event(user, data):
            return JsonResponse({"error": "You do not have permission for this action."}, status=403)
        if resource == "exchanges" and not can_alter_exchange(user, data):
            return JsonResponse({"error": "You do not have permission for this action."}, status=403)
        if resource == "schools":
            return JsonResponse(delete_school(data))
        if resource == "events":
            return JsonResponse(delete_event(data))
        if resource == "exchanges":
            return JsonResponse(delete_exchange(data))
        delete_entity(kind, item_id)
        return JsonResponse({"deleted": True, "removed": {kind: 1}})
    return JsonResponse(data)


@csrf_exempt
def action(request, resource, item_id, action):
    user = current_user(request)
    if resource == "exchanges" and action == "review":
        result = apply_exchange(item_id, user, body_json(request))
        return JsonResponse(result, status=400 if result.get("error") else 200)
    if resource == "exchanges" and action == "status":
        body = body_json(request)
        result = progress_exchange(item_id, user, body.get("status"), body)
        return JsonResponse(result, status=400 if result.get("error") else 200)
    if resource == "exchanges" and action == "approve":
        result = approve_exchange_school(item_id, user)
        return JsonResponse(result, status=400 if result.get("error") else 200)
    if resource == "exchanges" and action == "message":
        result = message_exchange(item_id, user, body_json(request))
        return JsonResponse(result, status=400 if result.get("error") else 200)
    if resource == "content" and action in {"like", "save", "comment"}:
        result = update_content_interaction(item_id, action, user, body_json(request))
        if result.get("permissionError"):
            return JsonResponse({"error": result["error"]}, status=403)
        return JsonResponse(result, status=400 if result.get("error") else 200)
    if resource == "event-registrations" and action in {"cancel", "mark-paid"}:
        return JsonResponse(update_registration(item_id, action, user))
    if resource == "notifications" and item_id == "read":
        for note in entities("notifications"):
            note["unread"] = False
            save_existing("notifications", note)
        return JsonResponse({"read": True})
    return JsonResponse({"error": "API route not found"}, status=404)


def create_school(payload, _user):
    school = {
        "id": create_id("school", payload.get("name")),
        "name": payload.get("name"),
        "city": payload.get("city") or "Bengaluru",
        "board": payload.get("board") or "CBSE",
        "type": payload.get("type") or "K-12",
        "contact": payload.get("contact") or "",
        "status": "Payment pending" if payload.get("paymentPending") else "Active",
        "membershipExpiry": "" if payload.get("paymentPending") else "2027-05-18",
        "achievements": [],
    }
    upsert("schools", school)
    upsert("users", {"id": f"user-school-admin-{slug(school['contact'])}", "email": school["contact"], "name": f"{school['name']} Admin", "role": "School Admin", "schoolId": school["id"], "status": "Invited" if payload.get("paymentPending") else "Active"})
    upsert("payments", {"id": create_id("pay", school["name"]), "schoolId": school["id"], "type": "Membership", "amount": payload.get("amount") or 1, "status": "Payment link sent" if payload.get("paymentPending") else "Paid", "invoice": f"YAARA-INV-{1000 + Entity.objects.filter(kind='payments').count() + 1}", "method": payload.get("paymentMethod") or "UPI", "createdAt": datetime.now().date().isoformat()})
    return school


def create_event(payload, user):
    event = {
        "id": create_id("event", payload.get("title")),
        "title": payload.get("title"),
        "type": payload.get("type") or "Workshop",
        "scope": payload.get("scope") or "Intra school",
        "schoolId": user.get("schoolId"),
        "format": payload.get("format") or "Virtual",
        "date": payload.get("date") or datetime.now().date().isoformat(),
        "host": payload.get("host") or "Yaara Consortium",
        "capacity": int(payload.get("capacity") or 100),
        "registered": 0,
        "paid": bool(payload.get("paid")),
        "fee": float(payload.get("fee") or 0) if payload.get("paid") else 0,
        "description": payload.get("description") or "",
        "venue": payload.get("venue") or "",
        "startTime": payload.get("startTime") or "",
        "endTime": payload.get("endTime") or "",
        "eligibility": payload.get("eligibility") or "",
        "registrationDeadline": payload.get("registrationDeadline") or "",
        "coordinatorName": payload.get("coordinatorName") or user.get("email") or "",
        "coordinatorEmail": payload.get("coordinatorEmail") or user.get("email") or "",
        "formHeaderImage": payload.get("formHeaderImage"),
        "registrationQuestions": payload.get("registrationQuestions") or [],
        "recording": False,
        "materials": False,
    }
    return upsert("events", event)


EXCHANGE_STATUSES = [
    "Draft",
    "Pending Yarra Approval",
    "Open",
    "Applied",
    "School Review",
    "Matched",
    "Ongoing",
    "Completed",
    "Feedback Submitted",
]


def exchange_payload(payload, existing=None, user=None):
    existing = existing or {}
    schools = entities("schools")
    school = next((item for item in schools if item.get("id") == (user or {}).get("schoolId")), None)
    return {
        "title": str(payload.get("title") or existing.get("title") or "").strip(),
        "type": payload.get("type") or existing.get("type") or "Teacher",
        "subject": str(payload.get("subject") or existing.get("subject") or "").strip(),
        "grade": str(payload.get("grade") or existing.get("grade") or "").strip(),
        "duration": str(payload.get("duration") or existing.get("duration") or "").strip(),
        "objective": str(payload.get("objective") or existing.get("objective") or "").strip(),
        "dateRange": str(payload.get("dateRange") or existing.get("dateRange") or "").strip(),
        "capacity": int(payload.get("capacity") or existing.get("capacity") or 20),
        "mode": payload.get("mode") or existing.get("mode") or "Online",
        "location": str(payload.get("location") or existing.get("location") or "").strip(),
        "fromSchool": payload.get("fromSchool") or existing.get("fromSchool") or (school or {}).get("name") or "Member school",
    }


def create_exchange(payload, user):
    title = str(payload.get("title") or "").strip()
    if not title:
        return {"error": "Exchange title is required."}
    exchange = {
        "id": create_id("exchange", title),
        **exchange_payload(payload, user=user),
        "fromSchoolId": user.get("schoolId") or "",
        "reviewSchoolId": "",
        "reviewSchool": "",
        "status": "Draft",
        "applications": [],
        "approvals": {},
        "messages": [],
        "activityUpdates": [],
        "feedback": [],
    }
    return upsert("exchanges", exchange)


def create_payment(payload, _user):
    payment = {"id": create_id("pay", payload.get("type") or "payment"), "invoice": f"YAARA-INV-{1000 + Entity.objects.filter(kind='payments').count() + 1}", "status": "Paid", "createdAt": datetime.now().date().isoformat(), **payload}
    return upsert("payments", payment)


def create_content(payload, user):
    tags = payload.get("tags")
    if not isinstance(tags, list):
        tags = [tag.strip() for tag in str(tags or "").split(",") if tag.strip()]
    content = {
        "id": create_id("content", payload.get("title") or payload.get("type") or "post"),
        "title": payload.get("title") or "Untitled post",
        "type": payload.get("type") or "Article",
        "speaker": payload.get("speaker") or user.get("email") or "Yarra member",
        "authorRole": user.get("role"),
        "schoolId": user.get("schoolId") or None,
        "category": payload.get("category") or "Community",
        "body": payload.get("body") or "",
        "mediaUrl": payload.get("mediaUrl") or "",
        "thumbnailUrl": payload.get("thumbnailUrl") or payload.get("mediaUrl") or "",
        "tags": tags,
        "audience": payload.get("audience") if isinstance(payload.get("audience"), list) else ["School Admin", "Teacher", "Student"],
        "minAge": int(payload.get("minAge") or 5),
        "maxAge": int(payload.get("maxAge") or 18),
        "likes": 0,
        "likedBy": [],
        "saved": 0,
        "savedBy": [],
        "comments": 0,
        "commentThreads": [],
        "views": 0,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    return upsert("content", content)


CREATE_HANDLERS = {
    "schools": create_school,
    "events": create_event,
    "exchanges": create_exchange,
    "payments": create_payment,
    "content": create_content,
}


def can_manage_event(user, event):
    return user["role"] == "Super Admin" or (user["role"] == "School Admin" and event.get("schoolId") == user.get("schoolId"))


def can_alter_exchange(user, exchange):
    if user["role"] == "Super Admin":
        return True
    schools = entities("schools")
    school = next((item for item in schools if item.get("id") == user.get("schoolId")), None)
    return user["role"] == "School Admin" and (
        exchange.get("fromSchoolId") == user.get("schoolId") or exchange.get("fromSchool") == (school or {}).get("name")
    )


def delete_school(school):
    school_id = school.get("id")
    school_name = school.get("name")
    removed = {}
    for kind in ["schools", "users", "students", "teachers", "payments", "events", "eventRegistrations", "content", "teacherResources", "reviewCycles", "marketOrders"]:
        before = Entity.objects.filter(kind=kind).count()
        for item in entities(kind):
            if item.get("id") == school_id or item.get("schoolId") == school_id:
                delete_entity(kind, item["id"])
        removed[kind] = before - Entity.objects.filter(kind=kind).count()
    for item in entities("exchanges"):
        if item.get("schoolId") == school_id or item.get("fromSchoolId") == school_id or item.get("fromSchool") == school_name:
            delete_entity("exchanges", item["id"])
    return {"deleted": True, "school": school, "removed": removed}


def delete_event(event):
    event_id = event.get("id")
    delete_entity("events", event_id)
    registrations = 0
    payments = 0
    for registration in entities("eventRegistrations"):
        if registration.get("eventId") == event_id:
            delete_entity("eventRegistrations", registration["id"])
            registrations += 1
    for payment in entities("payments"):
        if payment.get("eventId") == event_id:
            delete_entity("payments", payment["id"])
            payments += 1
    return {"deleted": True, "event": event, "removed": {"events": 1, "registrations": registrations, "payments": payments}}


def delete_exchange(exchange):
    exchange_id = exchange.get("id")
    had_review_request = bool(exchange.get("reviewSchoolId") or exchange.get("reviewSchool"))
    delete_entity("exchanges", exchange_id)
    requests = 0
    for request in entities("exchangeRequests"):
        if request.get("exchangeId") == exchange_id:
            delete_entity("exchangeRequests", request["id"])
            requests += 1
    if had_review_request:
        requests += 1
    return {
        "deleted": True,
        "exchange": exchange,
        "removed": {
            "exchanges": 1,
            "requests": requests,
        },
    }


def apply_exchange(exchange_id, user, payload):
    if user["role"] != "School Admin":
        return {"error": "You do not have permission for this action."}
    exchange = find_one("exchanges", exchange_id)
    schools = entities("schools")
    school = next((item for item in schools if item.get("id") == user.get("schoolId")), None)
    if not exchange or not school or exchange.get("status") != "Open" or exchange.get("fromSchoolId") == school.get("id") or exchange.get("fromSchool") == school.get("name"):
        return {"error": "Exchange request cannot be applied to by this school."}
    application = {
        "schoolId": school["id"],
        "school": school["name"],
        "proposedParticipants": str(payload.get("proposedParticipants") or "").strip(),
        "reason": str(payload.get("reason") or "").strip(),
        "contactPerson": str(payload.get("contactPerson") or user.get("email") or "").strip(),
    }
    exchange["status"] = "Applied"
    exchange["reviewSchoolId"] = school["id"]
    exchange["reviewSchool"] = school["name"]
    exchange["applications"] = [item for item in exchange.get("applications", []) if item.get("schoolId") != school["id"]]
    exchange["applications"].append(application)
    exchange["approvals"] = {exchange.get("fromSchoolId"): False, school["id"]: False}
    return save_existing("exchanges", exchange)


def approve_exchange_school(exchange_id, user):
    exchange = find_one("exchanges", exchange_id)
    if not exchange or exchange.get("status") not in {"Applied", "School Review"}:
        return {"error": "You do not have permission for this action."}
    if user["role"] == "Super Admin":
        exchange["approvals"] = {exchange.get("fromSchoolId"): True, exchange.get("reviewSchoolId"): True}
    elif user["role"] == "School Admin" and user.get("schoolId") in {exchange.get("fromSchoolId"), exchange.get("reviewSchoolId")}:
        approvals = exchange.get("approvals") or {}
        approvals[user.get("schoolId")] = True
        exchange["approvals"] = approvals
    else:
        return {"error": "You do not have permission for this action."}
    approvals = exchange.get("approvals") or {}
    exchange["status"] = "Matched" if approvals.get(exchange.get("fromSchoolId")) and approvals.get(exchange.get("reviewSchoolId")) else "School Review"
    return save_existing("exchanges", exchange)


def can_coordinate_exchange(user, exchange):
    if user["role"] == "Super Admin":
        return True
    return user["role"] == "School Admin" and user.get("schoolId") in {exchange.get("fromSchoolId"), exchange.get("reviewSchoolId")}


def message_exchange(exchange_id, user, payload):
    exchange = find_one("exchanges", exchange_id)
    if exchange:
        exchange = normalize_exchange(exchange)
    if not exchange or exchange.get("status") not in {"Matched", "Ongoing", "Completed", "Feedback Submitted"}:
        return {"error": "Messages are available only after schools are matched."}
    if not can_coordinate_exchange(user, exchange):
        return {"error": "You do not have permission for this action."}
    message = str(payload.get("message") or "").strip()
    if not message:
        return {"error": "Message is required."}
    schools = entities("schools")
    school = next((item for item in schools if item.get("id") == user.get("schoolId")), None)
    messages = exchange.get("messages") or []
    messages.append({
        "id": create_id("msg", exchange.get("title") or "exchange"),
        "schoolId": user.get("schoolId") or "",
        "school": (school or {}).get("name") or ("Yarra" if user["role"] == "Super Admin" else "Member school"),
        "author": user.get("email") or user["role"],
        "message": message,
        "createdAt": now_iso(),
    })
    exchange["messages"] = messages
    return save_existing("exchanges", exchange)


def progress_exchange(exchange_id, user, status, payload=None):
    payload = payload or {}
    exchange = find_one("exchanges", exchange_id)
    if exchange:
        exchange = normalize_exchange(exchange)
    allowed = {
        "Draft": "Pending Yarra Approval",
        "Pending Yarra Approval": "Open",
        "Matched": "Ongoing",
        "Ongoing": "Completed",
        "Completed": "Feedback Submitted",
    }
    if not exchange or status not in EXCHANGE_STATUSES or allowed.get(exchange.get("status")) != status:
        return {"error": "Invalid exchange transition."}
    involved = {exchange.get("fromSchoolId"), exchange.get("reviewSchoolId")}
    if status == "Open":
        if user["role"] != "Super Admin":
            return {"error": "Only Yarra can approve an exchange request."}
        exchange["yarraVerifiedBy"] = user.get("email")
    elif user["role"] != "Super Admin" and user.get("schoolId") not in involved:
        return {"error": "You do not have permission for this action."}
    if status == "Ongoing" and payload.get("activityUpdate"):
        updates = exchange.get("activityUpdates") or []
        updates.append({"by": user.get("email"), "note": payload["activityUpdate"], "date": datetime.now().date().isoformat()})
        exchange["activityUpdates"] = updates
    if status == "Completed":
        exchange["completionNote"] = payload.get("completionNote") or exchange.get("completionNote") or "Exchange completed."
    if status == "Feedback Submitted":
        feedback = exchange.get("feedback") or []
        feedback.append({
            "by": user.get("email"),
            "schoolId": user.get("schoolId"),
            "notes": payload.get("feedback") or "Feedback submitted.",
            "photosReport": payload.get("photosReport") or "",
            "outcomes": payload.get("outcomes") or "",
            "date": datetime.now().date().isoformat(),
        })
        exchange["feedback"] = feedback
    exchange["status"] = status
    return save_existing("exchanges", exchange)


def update_registration(registration_id, action_name, user):
    registration = find_one("eventRegistrations", registration_id)
    if not registration:
        return {"error": "Registration not found."}
    registration["status"] = "Confirmed" if action_name == "mark-paid" else "Cancelled"
    registration["paymentStatus"] = "Paid" if action_name == "mark-paid" else registration.get("paymentStatus")
    return save_existing("eventRegistrations", registration)


def update_content_interaction(content_id, action_name, user, payload):
    if user["role"] not in {"Super Admin", "School Admin"}:
        return {"error": "Only School Admins and Super Admin can interact with posts.", "permissionError": True}
    content = find_one("content", content_id)
    if not content:
        return {"error": "Content not found."}
    actor = user.get("email") or user.get("schoolId") or user["role"]
    if action_name == "like":
        liked_by = content.get("likedBy") or []
        content["likedBy"] = [entry for entry in liked_by if entry != actor] if actor in liked_by else [*liked_by, actor]
        content["likes"] = len(content["likedBy"])
    if action_name == "save":
        saved_by = content.get("savedBy") or []
        content["savedBy"] = [entry for entry in saved_by if entry != actor] if actor in saved_by else [*saved_by, actor]
        content["saved"] = len(content["savedBy"])
    if action_name == "comment":
        text = str(payload.get("text") or "").strip()
        if not text:
            return {"error": "Comment cannot be empty."}
        comments = content.get("commentThreads") or []
        comments.insert(0, {
            "id": create_id("comment", text),
            "author": user.get("email") or user["role"],
            "role": user["role"],
            "text": text,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })
        content["commentThreads"] = comments
        content["comments"] = len(comments)
    return save_existing("content", content)
