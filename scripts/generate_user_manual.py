from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "manuals"
OUT_FILE = OUT_DIR / "yarra-user-manual.pdf"
LOGO = ROOT / "assets" / "yarra-logo.jpeg"


ROLE_ACCESS = [
    ["Module", "Super Admin", "School Admin", "Teacher", "Student", "Vendor Applicant", "Approved Vendor"],
    ["Dashboard", "Full", "School view", "Limited", "Limited", "No", "Vendor view"],
    ["User management", "Full", "School users", "No", "No", "No", "No"],
    ["School onboarding", "Full", "No", "No", "No", "No", "No"],
    ["School dashboard", "Full", "Own school", "No", "No", "No", "No"],
    ["Payments & invoices", "Full", "Own school", "No", "No", "No", "No"],
    ["Events", "Full", "Create/manage", "Create/join", "Join/view", "No", "No"],
    ["Exchange programs", "Full", "Create/manage", "Create/join", "View/join", "No", "No"],
    ["Content library", "Create/manage", "Create/manage", "View only", "View only", "No", "No"],
    ["Vendor sign-up", "Review context", "No", "No", "No", "Apply only", "Profile context"],
    ["Vendor marketplace", "Approve/manage", "Request/pay", "Request/view", "No", "No", "Products/orders"],
    ["School network", "View", "View", "View", "View", "No", "No"],
]


MODULES = [
    {
        "title": "Login, Roles, Sessions, and Tutorial",
        "purpose": "Give each user a role-specific workspace and a guided tour of the modules they can access.",
        "roles": "All signed-in users. Vendor applicants have a restricted sign-up-only experience.",
        "workflow": [
            "User selects a role and signs in with the invited account.",
            "The platform stores a session and filters navigation by role.",
            "User can open Tutorial to see only the modules available to that role.",
            "User can open Manual to download this PDF.",
            "User logs out to clear the session.",
        ],
        "stories": [
            "As a Super Admin, I want to switch between platform modules so that I can operate the consortium from one console.",
            "As a School Admin, I want only my school modules so that I do not see other schools' private operations.",
            "As a Vendor Applicant, I want to see only the application page so that I know approval is required before marketplace access.",
        ],
        "acceptance": [
            "Navigation hides unavailable modules.",
            "Tutorial text matches the user's role and approval state.",
            "Vendor applicants cannot open dashboard or marketplace before approval.",
        ],
    },
    {
        "title": "Dashboard",
        "purpose": "Show high-level metrics and recent activity for the user's permitted area.",
        "roles": "Super Admin, School Admin, Teacher, Student, Approved Vendor.",
        "workflow": [
            "User opens Dashboard after login.",
            "Metrics render from the current platform state.",
            "Role restrictions filter schools, payments, users, vendor data, and content.",
            "User moves into the next relevant module from the sidebar.",
        ],
        "stories": [
            "As a Super Admin, I want total schools, vendors, events, students, and revenue so that I can monitor the platform.",
            "As a School Admin, I want my school overview so that I can plan follow-up work.",
            "As a Vendor, I want vendor-specific metrics so that I can track marketplace activity after approval.",
        ],
        "acceptance": [
            "Metrics do not leak restricted data across roles.",
            "Vendor applicant does not receive dashboard access.",
        ],
    },
    {
        "title": "User Management",
        "purpose": "Manage school users, staff, and student roster uploads using downloadable Excel templates.",
        "roles": "Super Admin and School Admin.",
        "workflow": [
            "User opens User management.",
            "User downloads Student Database or Staff Database template.",
            "User fills the template on their own computer.",
            "User validates the upload before committing users.",
            "Valid rows are committed and upload history is shown.",
        ],
        "stories": [
            "As a School Admin, I want to download a student database template so that I can prepare a clean roster.",
            "As a School Admin, I want validation errors before commit so that bad rows do not create broken accounts.",
            "As a Super Admin, I want to support school user imports so that schools can onboard quickly.",
        ],
        "acceptance": [
            "Templates download through the browser to the user's own Downloads folder.",
            "Students do not receive vendor marketplace access.",
            "Upload history records the activity.",
        ],
    },
    {
        "title": "School Onboarding",
        "purpose": "Create member schools and start membership activation.",
        "roles": "Super Admin.",
        "workflow": [
            "Super Admin enters school name, board, type, billing email, and membership amount.",
            "System creates a payment request or records payment status.",
            "School Admin invite is associated with the billing email.",
            "After payment is confirmed, the school becomes active.",
        ],
        "stories": [
            "As a Super Admin, I want to onboard a new school with a billing email so that the school admin can later sign in.",
            "As a Super Admin, I want payment status tied to onboarding so that unpaid schools are not accidentally activated.",
        ],
        "acceptance": [
            "School Admin login is tied to the created school.",
            "Payment pending and active states are visible.",
        ],
    },
    {
        "title": "School Dashboard",
        "purpose": "Show school membership, invoices, events, and key school information.",
        "roles": "Super Admin and School Admin.",
        "workflow": [
            "User opens School dashboard.",
            "School Admin sees their own school only.",
            "Super Admin can review platform schools.",
            "Membership and invoice information is displayed for follow-up.",
        ],
        "stories": [
            "As a School Admin, I want my membership and invoices in one place so that I can track renewal/payment status.",
            "As a Super Admin, I want to inspect a school summary so that I can support that member school.",
        ],
        "acceptance": [
            "School Admin data is scoped to their school.",
            "Profile pages removed from navigation do not appear.",
        ],
    },
    {
        "title": "Payments and Invoices",
        "purpose": "Record payments and review payment history for schools and marketplace transactions.",
        "roles": "Super Admin and School Admin.",
        "workflow": [
            "User opens Payments & invoices.",
            "User reviews payment records, invoice numbers, method, amount, and status.",
            "Authorized user records offline/manual payment when needed.",
            "Vendor marketplace payments are added after Razorpay payment confirmation.",
        ],
        "stories": [
            "As a Super Admin, I want payment records across the platform so that finance can reconcile activity.",
            "As a School Admin, I want my school's payments so that I can verify paid and pending items.",
        ],
        "acceptance": [
            "Payments are role-filtered.",
            "Vendor marketplace payment becomes Paid only after Razorpay confirmation or approved manual action.",
        ],
    },
    {
        "title": "Events",
        "purpose": "Create, publish, register for, edit, and delete consortium events.",
        "roles": "Super Admin, School Admin, Teacher, Student.",
        "workflow": [
            "Authorized user creates an event with format, host, capacity, date, and optional paid entry.",
            "Users register or review event information according to role.",
            "Super Admin and the hosting School Admin can edit or delete events they manage.",
            "Deleting an event also clears linked registrations/payments.",
        ],
        "stories": [
            "As a School Admin, I want to create an event so that other members can join.",
            "As a Teacher, I want to register for a workshop so that I can participate.",
            "As a Student, I want to see safe student-accessible events so that I can join appropriate programs.",
        ],
        "acceptance": [
            "Edit/delete permissions exist for Super Admin and event owner school.",
            "Deleted events do not leave orphan registration records.",
        ],
    },
    {
        "title": "Exchange Programs",
        "purpose": "Run cross-school teacher/student exchanges from request to completion.",
        "roles": "Super Admin, School Admin, Teacher, Student.",
        "workflow": [
            "School creates an exchange request with type, subject, grade, duration, objective, dates, capacity, and mode.",
            "Yarra/Super Admin verifies the request.",
            "Other schools apply or review the exchange.",
            "Schools approve the match.",
            "Matched schools coordinate through in-platform messages.",
            "Exchange moves through Ongoing, Completed, and Feedback Submitted.",
        ],
        "stories": [
            "As a School Admin, I want to create an exchange request so that another school can participate.",
            "As a Teacher, I want to coordinate messages after matching so that the exchange can run smoothly.",
            "As a Super Admin, I want to verify exchanges before they open so that requests are safe and suitable.",
        ],
        "acceptance": [
            "Statuses follow Draft, Pending Yarra Approval, Open, Applied, School Review, Matched, Ongoing, Completed, Feedback Submitted.",
            "Parent consent and Scheduled steps are removed.",
            "Messages are visible only to matched/authorized schools and Super Admin.",
        ],
    },
    {
        "title": "Content Library",
        "purpose": "Share member learning content such as posts, stories, workshops, webinars, podcasts, videos, and articles.",
        "roles": "Super Admin, School Admin, Teacher, Student.",
        "workflow": [
            "Super Admin or School Admin creates content.",
            "Content is tagged by type, audience, speaker, age range, and media/recording link.",
            "Teachers and students browse/search/filter content.",
            "Non-admin roles view content only; they cannot create posts or comments.",
        ],
        "stories": [
            "As a School Admin, I want to post a workshop recording so that my school community can view it.",
            "As a Teacher, I want to filter webinars and articles so that I can find relevant resources.",
            "As a Student, I want age-appropriate content so that I only see suitable material.",
        ],
        "acceptance": [
            "Only Super Admin and School Admin can create/edit content.",
            "Vendors cannot see the content library.",
            "Teachers and students cannot comment or create posts.",
        ],
    },
    {
        "title": "Vendor Sign-up",
        "purpose": "Collect vendor applications and keep applicants restricted until approval.",
        "roles": "Vendor Applicant and Super Admin.",
        "workflow": [
            "New vendor clicks Vendor sign-up information on the login page.",
            "System opens only the Vendor sign-up page.",
            "Vendor submits company, category, contact email, and offer.",
            "Application is stored as Pending approval.",
            "Super Admin reviews the vendor in Vendor marketplace and approves or leaves pending.",
        ],
        "stories": [
            "As a Vendor Applicant, I want a simple application screen so that I know exactly what to submit.",
            "As a Super Admin, I want pending vendor applications visible for review so that only approved vendors get access.",
        ],
        "acceptance": [
            "Pending vendor sees only Vendor sign-up.",
            "Pending vendor cannot add products.",
            "Approval activates vendor access.",
        ],
    },
    {
        "title": "Vendor Marketplace",
        "purpose": "Let approved vendors list products and schools request, approve, pay, track, and close purchases.",
        "roles": "Super Admin, School Admin, Teacher, Approved Vendor.",
        "workflow": [
            "Approved vendor adds a product.",
            "Product is Pending approval until Super Admin approves it.",
            "School Admin or authorized school user requests the product.",
            "Vendor moves request from RFQ Submitted to Quote Sent.",
            "School approves quote and sends Razorpay payment link.",
            "After payment, Check payment confirms the link with Razorpay and moves request to Paid.",
            "Vendor moves paid request to Delivered; school/admin closes after delivery.",
        ],
        "stories": [
            "As an Approved Vendor, I want to add products so that schools can request them after approval.",
            "As a Super Admin, I want to approve vendor products before listing so that marketplace quality is controlled.",
            "As a School Admin, I want to request a product, approve the quote, send payment, and track delivery.",
            "As a Vendor, I want to see requests for my products only so that I can respond to the right schools.",
        ],
        "acceptance": [
            "Only one demo vendor/product may be used for simple demos when desired.",
            "Students do not have vendor marketplace access.",
            "Razorpay payment links are emailed to the configured recipient during testing.",
            "Request flow supports RFQ Submitted, Quote Sent, Approved by School, Paid, Delivered, Closed.",
        ],
    },
    {
        "title": "School Network",
        "purpose": "Show a member-school directory for browsing schools in the consortium.",
        "roles": "Super Admin, School Admin, Teacher, Student.",
        "workflow": [
            "User opens School network.",
            "User reviews school cards with board, city, type, and highlights.",
            "User uses school context for collaboration planning.",
        ],
        "stories": [
            "As a Teacher, I want to browse member schools so that I can identify collaboration opportunities.",
            "As a Student, I want to see school network information that is safe and public to members.",
        ],
        "acceptance": [
            "Vendor roles do not see the school network.",
            "School profile and my profile modules remain removed.",
        ],
    },
    {
        "title": "Notifications and Audit Awareness",
        "purpose": "Keep users aware of updates, messages, payment status changes, and pending tasks.",
        "roles": "All approved roles according to module access.",
        "workflow": [
            "Notification badge shows unread items.",
            "User opens relevant module to resolve the task.",
            "System records important state changes such as approval, payment confirmation, and deletion.",
        ],
        "stories": [
            "As a Super Admin, I want pending approvals visible so that I can act quickly.",
            "As a School Admin, I want payment/request status messages so that I know what to do next.",
            "As a Vendor, I want request messages so that I can coordinate with the school.",
        ],
        "acceptance": [
            "Notifications do not grant access to restricted modules.",
            "Users can only act where their role permits it.",
        ],
    },
]


ROLE_STORIES = {
    "Super Admin": [
        "Onboard a school, collect membership payment, and activate the School Admin.",
        "Review pending vendor applications and approve qualified vendors.",
        "Approve vendor products before schools can request them.",
        "Create or edit events and remove events safely when cancelled.",
        "Verify exchange requests before they open to other schools.",
        "Create content library posts for all allowed school audiences.",
        "Monitor payments, invoices, requests, and platform metrics.",
    ],
    "School Admin": [
        "Manage school users with staff/student templates.",
        "Review own school dashboard and payment history.",
        "Create school events and manage registrations.",
        "Create exchange requests and coordinate matched exchanges.",
        "Create content library posts for school communities.",
        "Request vendor products, approve quotes, send payment links, and track delivery.",
    ],
    "Teacher": [
        "View dashboard, events, exchanges, content library, vendors, and school network where permitted.",
        "Create or participate in events and exchanges according to school workflow.",
        "Browse content resources without creating or commenting.",
        "Use marketplace visibility only for school-related product request context where enabled.",
    ],
    "Student": [
        "View safe dashboard information, events, exchanges, content, and school network.",
        "Access age-appropriate content only.",
        "Stay blocked from vendor marketplace and purchasing workflows.",
    ],
    "Vendor Applicant": [
        "Open Vendor sign-up from the login page.",
        "Submit company, category, contact, and offer.",
        "Remain on sign-up page while waiting for Super Admin approval.",
    ],
    "Approved Vendor": [
        "Access vendor dashboard and marketplace after approval.",
        "Add products for Super Admin approval.",
        "View requests for own products only.",
        "Message schools, move RFQs to Quote Sent, and deliver after payment is confirmed.",
    ],
}


def para(text, style):
    return Paragraph(str(text).replace("&", "&amp;"), style)


def bullet_list(items, style):
    return ListFlowable(
        [ListItem(para(item, style), leftIndent=12) for item in items],
        bulletType="bullet",
        start="circle",
        leftIndent=18,
    )


def numbered_list(items, style):
    return ListFlowable(
        [ListItem(para(item, style), leftIndent=12) for item in items],
        bulletType="1",
        leftIndent=18,
    )


def header_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor("#b9dce3"))
    canvas.setLineWidth(0.5)
    canvas.line(doc.leftMargin, 0.55 * inch, A4[0] - doc.rightMargin, 0.55 * inch)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#526b73"))
    canvas.drawString(doc.leftMargin, 0.35 * inch, "Yarra Consortium User Manual")
    canvas.drawRightString(A4[0] - doc.rightMargin, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build_manual():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CoverTitle", parent=styles["Title"], fontSize=28, leading=34, alignment=TA_CENTER, textColor=colors.HexColor("#14343b"), spaceAfter=18))
    styles.add(ParagraphStyle(name="CoverSub", parent=styles["BodyText"], fontSize=12, leading=18, alignment=TA_CENTER, textColor=colors.HexColor("#526b73"), spaceAfter=8))
    styles.add(ParagraphStyle(name="H1Y", parent=styles["Heading1"], fontSize=18, leading=23, textColor=colors.HexColor("#14343b"), spaceBefore=10, spaceAfter=8))
    styles.add(ParagraphStyle(name="H2Y", parent=styles["Heading2"], fontSize=13, leading=17, textColor=colors.HexColor("#1e6b78"), spaceBefore=8, spaceAfter=5))
    styles.add(ParagraphStyle(name="BodyY", parent=styles["BodyText"], fontSize=9.4, leading=13.5, textColor=colors.HexColor("#223a42"), spaceAfter=5))
    styles.add(ParagraphStyle(name="SmallY", parent=styles["BodyText"], fontSize=8.2, leading=11.5, textColor=colors.HexColor("#526b73")))
    styles.add(ParagraphStyle(name="TableHead", parent=styles["BodyText"], fontSize=7.5, leading=9, textColor=colors.white, alignment=TA_CENTER))
    styles.add(ParagraphStyle(name="TableCell", parent=styles["BodyText"], fontSize=7.0, leading=8.2, textColor=colors.HexColor("#14343b")))

    story = []
    if LOGO.exists():
        story.append(Image(str(LOGO), width=1.25 * inch, height=1.25 * inch))
        story.append(Spacer(1, 0.25 * inch))
    story.extend([
        para("Yarra Consortium User Manual", styles["CoverTitle"]),
        para("Role-based operating guide with workflows, permissions, and user stories", styles["CoverSub"]),
        para("Prepared for Super Admins, School Admins, Teachers, Students, Vendor Applicants, and Approved Vendors.", styles["CoverSub"]),
        Spacer(1, 0.35 * inch),
        para("How to use this manual", styles["H1Y"]),
        para("Use this PDF as the working reference for the Yarra platform. Each module includes purpose, role access, workflow, user stories, and acceptance expectations.", styles["BodyY"]),
        para("The live app also includes an in-product Tutorial button. The tutorial is role-aware and follows the same approval rules described here.", styles["BodyY"]),
        PageBreak(),
    ])

    story.append(para("Table of Contents", styles["H1Y"]))
    contents = [
        "1. Role Access Matrix",
        "2. Role-Based User Stories",
        "3. Module Manuals",
        "4. Key Operating Lifecycles",
        "5. Administration Checklist",
    ]
    story.append(numbered_list(contents, styles["BodyY"]))
    story.append(PageBreak())

    story.append(para("1. Role Access Matrix", styles["H1Y"]))
    table_data = [[para(cell, styles["TableHead"] if row_index == 0 else styles["TableCell"]) for cell in row] for row_index, row in enumerate(ROLE_ACCESS)]
    table = Table(table_data, repeatRows=1, colWidths=[1.45 * inch, 0.75 * inch, 0.85 * inch, 0.7 * inch, 0.7 * inch, 0.95 * inch, 0.9 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e6b78")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#b9dce3")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef9fb")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(table)
    story.append(PageBreak())

    story.append(para("2. Role-Based User Stories", styles["H1Y"]))
    for role, stories in ROLE_STORIES.items():
        story.append(KeepTogether([para(role, styles["H2Y"]), bullet_list(stories, styles["BodyY"])]))
    story.append(PageBreak())

    story.append(para("3. Module Manuals", styles["H1Y"]))
    for index, module in enumerate(MODULES, start=1):
        story.append(KeepTogether([
            para(f"{index}. {module['title']}", styles["H1Y"]),
            para(f"<b>Purpose:</b> {module['purpose']}", styles["BodyY"]),
            para(f"<b>Roles:</b> {module['roles']}", styles["BodyY"]),
        ]))
        story.append(para("Workflow", styles["H2Y"]))
        story.append(numbered_list(module["workflow"], styles["BodyY"]))
        story.append(para("User Stories", styles["H2Y"]))
        story.append(bullet_list(module["stories"], styles["BodyY"]))
        story.append(para("Acceptance Expectations", styles["H2Y"]))
        story.append(bullet_list(module["acceptance"], styles["BodyY"]))
        story.append(Spacer(1, 0.08 * inch))

    story.append(PageBreak())
    story.append(para("4. Key Operating Lifecycles", styles["H1Y"]))
    lifecycles = [
        ("Vendor Approval", ["Vendor applies", "Status is Pending approval", "Super Admin reviews", "Super Admin approves vendor", "Vendor gains marketplace access", "Vendor products still require product approval"]),
        ("Vendor Purchase", ["School sends request", "Vendor sends quote", "School approves quote", "Payment link is sent by Razorpay", "Check payment confirms paid status", "Vendor delivers", "Request closes"]),
        ("Exchange Program", ["Draft", "Pending Yarra Approval", "Open", "Applied", "School Review", "Matched", "Ongoing", "Completed", "Feedback Submitted"]),
        ("Content Publishing", ["Super Admin or School Admin creates post", "Audience and format are set", "Teachers/students browse according to access", "Vendors do not see content library"]),
        ("Event Management", ["Create event", "Publish details", "Users register/view", "Owner or Super Admin edits/deletes", "Linked registrations/payments are cleared on delete"]),
    ]
    for title, steps in lifecycles:
        story.append(para(title, styles["H2Y"]))
        story.append(numbered_list(steps, styles["BodyY"]))

    story.append(PageBreak())
    story.append(para("5. Administration Checklist", styles["H1Y"]))
    checklist = [
        "Confirm each new school has the correct School Admin email.",
        "Keep vendor applicants pending until documents, category, and offer are reviewed.",
        "Approve vendor products only when school-facing description, price, and stock are clear.",
        "Use Check payment after Razorpay payment link is paid before marking marketplace orders delivered.",
        "Review exchange requests before making them open to other schools.",
        "Use role switching carefully; users only see modules allowed by their current role.",
        "Regenerate this PDF after major module changes by running python scripts/generate_user_manual.py.",
    ]
    story.append(bullet_list(checklist, styles["BodyY"]))

    doc = SimpleDocTemplate(
        str(OUT_FILE),
        pagesize=A4,
        rightMargin=0.45 * inch,
        leftMargin=0.45 * inch,
        topMargin=0.5 * inch,
        bottomMargin=0.7 * inch,
        title="Yarra Consortium User Manual",
        author="Yarra Consortium",
    )
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print("assets/manuals/yarra-user-manual.pdf")


if __name__ == "__main__":
    build_manual()
