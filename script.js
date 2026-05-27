const SESSION_STORAGE_KEY = "yaara-session";
const USER_STORAGE_KEY = "yaara-user";
const AUTH_STORAGE_KEY = "yaara-authenticated";
const defaultTimeoutMinutes = 0;
let activeSession = null;

const yarraLoginPresets = {
  "Super Admin": {
    email: "yarra.superadmin@akshararbol.edu.in",
    password: "Yarra@Super123"
  },
  "School Admin": {
    email: "yarra.schooladmin@akshararbol.edu.in",
    password: "Yarra@School123"
  },
  Teacher: {
    email: "yarra.teacher@akshararbol.edu.in",
    password: "Yarra@Teacher123"
  },
  Student: {
    email: "yarra.student@akshararbol.edu.in",
    password: "Yarra@Student123"
  },
  Vendor: {
    email: "yarra.vendor@akshararbol.edu.in",
    password: "Yarra@Vendor123"
  }
};

const getStoredJson = (key, fallback = {}) => {
  try {
    return JSON.parse(
      window.localStorage?.getItem(key) ||
        window.sessionStorage?.getItem(key) ||
        JSON.stringify(fallback)
    );
  } catch {
    return fallback;
  }
};

const setSessionValue = (key, value) => {
  try {
    window.sessionStorage?.setItem(key, value);
    window.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable in embedded preview modes.
  }
};

const getSessionValue = (key) => {
  try {
    return window.localStorage?.getItem(key) || window.sessionStorage?.getItem(key) || null;
  } catch {
    return null;
  }
};

const currentSession = () => activeSession || getStoredJson(SESSION_STORAGE_KEY, null);

const storeSession = (session) => {
  if (!session?.id) return;
  activeSession = session;
  try {
    window.sessionStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    window.localStorage?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // In-memory session still keeps the current tab authenticated.
  }
  updateSessionUi();
};

const updateSessionFromHeaders = (response) => {
  return response;
};

const handleResponse = async (response, fallbackError) => {
  const body = await response.json().catch(() => ({}));
  updateSessionFromHeaders(response);
  if (response.status === 401) {
    throw new Error(body.error || fallbackError);
  }
  if (!response.ok) {
    throw new Error(body.error || fallbackError);
  }
  if (body.session) {
    storeSession(body.session);
  }
  return body;
};

const api = {
  async state() {
    const response = await fetch(`/api/state?role=${encodeURIComponent(currentRole())}`, {
      headers: authHeaders(false)
    });
    return handleResponse(response, "Unable to load platform state");
  },
  async stateWithSession(session) {
    const response = await fetch(`/api/state?role=${encodeURIComponent(session?.role || currentRole())}`, {
      headers: {
        "X-User-Role": session?.role || currentRole(),
        "X-Session-Id": session?.id || "",
        "X-Session-Timeout-Minutes": String(session?.timeoutMinutes || selectedSessionTimeoutMinutes())
      }
    });
    return handleResponse(response, "Unable to load platform state");
  },
  async create(resource, payload) {
    const response = await fetch(`/api/${resource}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, `Unable to save ${resource}`);
  },
  async createRazorpayOrder(payload) {
    const response = await fetch("/api/payments/razorpay-order", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Unable to create Razorpay order");
  },
  async createRazorpayLink(payload) {
    const response = await fetch("/api/payments/razorpay-link", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Unable to create Razorpay payment link");
  },
  async paymentConfig() {
    const response = await fetch("/api/payments/config");
    return handleResponse(response, "Unable to load payment configuration");
  },
  async createUpiIntent(payload) {
    const response = await fetch("/api/payments/upi-intent", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Unable to create UPI payment");
  },
  async post(path, payload = null) {
    const response = await fetch(path, {
      method: "POST",
      headers: authHeaders(Boolean(payload)),
      ...(payload ? { body: JSON.stringify(payload) } : {})
    });
    return handleResponse(response, "Action failed");
  },
  async gmailLogin(payload) {
    const response = await fetch("/api/auth/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Gmail login failed");
  },
  async extendSession(timeoutMinutes) {
    const response = await fetch("/api/auth/extend", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ timeoutMinutes })
    });
    return handleResponse(response, "Unable to extend session");
  },
  async updateSessionRole(role) {
    const response = await fetch("/api/auth/role", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ role, timeoutMinutes: selectedSessionTimeoutMinutes() })
    });
    return handleResponse(response, "Unable to update session role");
  },
  async logout() {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: authHeaders(false)
    });
    return handleResponse(response, "Unable to sign out");
  },
  async validateUpload(formData) {
    const response = await fetch("/api/uploads/validate", {
      method: "POST",
      headers: authHeaders(false),
      body: formData
    });
    return handleResponse(response, "Upload validation failed");
  },
  async commitUpload(payload) {
    const response = await fetch("/api/uploads/commit", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Upload commit failed");
  },
  async saveTemplate(uploadTypeValue) {
    const response = await fetch("/api/templates/save", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ uploadType: uploadTypeValue })
    });
    return handleResponse(response, "Template save failed");
  }
};

const rolePermissions = {
  "Super Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "leadership", "myProfile", "teachersHub", "reviewCycle", "library", "vendorSignup", "vendors", "schoolNetwork", "profiles"],
  "School Admin": ["dashboard", "userManagement", "schoolDashboard", "payments", "students", "events", "exchange", "leadership", "myProfile", "teachersHub", "reviewCycle", "library", "vendors", "schoolNetwork", "profiles"],
  Teacher: ["dashboard", "events", "exchange", "myProfile", "teachersHub", "library", "vendors", "schoolNetwork", "profiles"],
  Student: ["dashboard", "events", "exchange", "myProfile", "library", "vendors", "schoolNetwork", "profiles"],
  Vendor: ["dashboard", "vendorSignup", "vendors"]
};

const tutorialModuleDetails = {
  dashboard: {
    title: "Command centre",
    goal: "Read platform metrics, spot empty areas, and choose your next module.",
    challenge: "Check the five metric tiles and confirm the current role workspace.",
    target: ".metrics-grid",
    actions: ["Read Active schools, Vendors, Events, Students, and Revenue.", "Use the sidebar to move into any module.", "When data is empty, treat zero values as setup tasks."]
  },
  userManagement: {
    title: "Excel Upload Engine",
    goal: "Download roster templates, validate Excel files, preview errors, and commit student or teacher users.",
    challenge: "Pick Student or Teacher Database, then inspect the validate and upload history panels.",
    target: "#userManagement .upload-engine-grid",
    actions: ["Choose Teacher Database or Student Database.", "Click Download Template before preparing Excel.", "Use Validate Upload first; Commit users appears only when validation passes.", "Check Upload history after every commit."]
  },
  schoolDashboard: {
    title: "School dashboard",
    goal: "Review membership, school summary, invoices, events, and student invitations.",
    challenge: "Find where membership status and recent invoices will appear after onboarding.",
    target: "#schoolDashboard .school-dashboard-grid",
    actions: ["Review school summary and student count.", "Check membership status and renewal area.", "Use Invite student when manually onboarding a learner.", "Recent invoices appear in the finance panel."]
  },
  onboarding: {
    title: "School onboarding",
    goal: "Register a school and start membership activation through Razorpay or UPI.",
    challenge: "Look through school details, board affiliation, school type, and payment amount.",
    target: "#schoolForm",
    actions: ["Enter the real school name and billing email.", "Select board affiliation and school type.", "Tick Early Years only for eligible schools.", "Set the membership fee, then collect the school's payment."]
  },
  payments: {
    title: "Payments and invoices",
    goal: "Record payments, review transaction history, and preview invoices.",
    challenge: "Open the payment form and identify invoice, amount, status, and method fields.",
    target: "#payments .section-bar",
    actions: ["Click Record payment to add an offline or manual payment.", "Review invoice number, school, amount, and status.", "Click View invoice to preview before download."]
  },
  students: {
    title: "Student users",
    goal: "Invite students and manage age-gated access.",
    challenge: "Find the Add student action and the guardian email/access details on student cards.",
    target: "#students .section-bar",
    actions: ["Click Add student for a single manual invite.", "Use User management for bulk Excel onboarding.", "Check age because student content is filtered by age.", "Guardian email is required for real student access."]
  },
  events: {
    title: "Events",
    goal: "Create events, track seats, and manage paid or member-only programs.",
    challenge: "Review event type, date, format, capacity, and recording/material states.",
    target: "#events .section-bar",
    actions: ["Click Create event.", "Choose type, format, date, host, and capacity.", "Use Paid entry only when payment tracking is needed."]
  },
  exchange: {
    title: "Exchange programs",
    goal: "Post and track teacher or student exchange opportunities.",
    challenge: "Scan the Open, Under Review, Matched, and Completed columns.",
    target: "#exchange .kanban",
    actions: ["Click Post exchange slot.", "Choose Teacher or Student exchange.", "Track opportunities across Open, Under Review, Matched, and Completed."]
  },
  leadership: {
    title: "Leadership Connect",
    goal: "Use principal-only forums for leadership prompts, takeaways, and discussion threads.",
    challenge: "Review forum details, add a takeaway, and start a leader discussion thread.",
    target: "#leadership .section-bar",
    actions: ["Read the monthly forum details.", "Use discussion prompts to guide leadership reflection.", "Add key takeaways after each forum.", "Start or reply to leader-only discussion threads."]
  },
  myProfile: {
    title: "My Profile",
    goal: "Review and maintain personal, academic, staff, and school identity details.",
    challenge: "Check how your role and school context shape what the platform shows you.",
    target: "#myProfile .section-bar",
    actions: ["Open My Profile.", "Review role, email, school, grade or designation.", "Use Update profile to add contact and context details."]
  },
  teachersHub: {
    title: "Teachers Hub",
    goal: "Keep staff resources, PL sessions, and recordings in one school-only workspace.",
    challenge: "Add a staff resource and confirm it appears under the correct resource type.",
    target: "#teachersHub .section-bar",
    actions: ["Click Add resource.", "Choose Upcoming PL Session, Past Recording, or Resource Document.", "Add a link or file name so staff know where to access it."]
  },
  reviewCycle: {
    title: "Review Cycle",
    goal: "Track school improvement stages from self-study through recommendations.",
    challenge: "Create a review cycle and inspect each stage status.",
    target: "#reviewCycle .section-bar",
    actions: ["Create cycle.", "Set start and end dates.", "Track self-study, review visit, SIP, and recommendations."]
  },
  library: {
    title: "Content library",
    goal: "Search and filter workshops, podcasts, webinars, and articles.",
    challenge: "Try the search box and filter chips, then notice Early Years tags.",
    target: "#library .section-bar",
    actions: ["Search by title, speaker, or tag.", "Use filter chips for workshops, podcasts, articles, and webinars.", "Early Years tagged content should only appear for entitled schools."]
  },
  vendorSignup: {
    title: "Vendor sign-up",
    goal: "Explain Yarra vendor procedures, benefits, contacts, and application steps.",
    challenge: "Review the procedure list and sample vendor workspace previews.",
    target: "#vendorSignup .vendor-hero",
    actions: ["Read the vendor hosting procedure.", "Check Akshar Arbol admin contact details.", "Use Apply as vendor to jump to the application form.", "Review sample platform images before applying."]
  },
  vendors: {
    title: "Vendor marketplace",
    goal: "Browse vendor categories, approvals, featured placements, and procurement opportunities.",
    challenge: "Use the category filter and find where approvals or promotions appear.",
    target: "#vendors .section-bar",
    actions: ["Use Category to filter vendors.", "Super Admin can approve pending vendors.", "Featured placements and promotions appear in marketplace campaigns."]
  },
  schoolNetwork: {
    title: "School Network",
    goal: "Browse the public member-school directory across Yarra.",
    challenge: "Find active schools and compare board, city, and key offerings.",
    target: "#schoolNetwork .section-bar",
    actions: ["Open School Network.", "Review public member-school cards.", "Only each school's admin should edit its own profile."]
  },
  profiles: {
    title: "School profiles",
    goal: "Review public member-school profile highlights and achievements.",
    challenge: "Find where school highlights will appear after you add real school data.",
    target: "#profiles .profile-layout",
    actions: ["Review the school profile summary.", "Check highlights and achievements.", "Use this as the member-facing school identity area."]
  }
};

const tutorialRoleIntro = {
  "Super Admin": "You are learning every control: schools, users, payments, vendors, content, events, and moderation-ready workflows.",
  "School Admin": "You are learning the school operating path: onboarding, dashboards, rosters, payments, students, events, and content.",
  Teacher: "You are learning the educator path: events, exchanges, content, and school profiles.",
  Student: "You are learning the student path: safe events, exchange options, content, and profiles.",
  Vendor: "You are learning the vendor path: application, marketplace presence, enquiries, and approved promotions."
};

const currentRole = () => currentSession()?.role || getStoredJson(USER_STORAGE_KEY, {}).role || roleSelect?.value || "School Admin";

const authHeaders = (json = true) => ({
  ...(json ? { "Content-Type": "application/json" } : {}),
  "X-User-Role": currentRole(),
  ...(currentSession()?.id ? { "X-Session-Id": currentSession().id } : {}),
  "X-Session-Timeout-Minutes": String(selectedSessionTimeoutMinutes())
});

const navButtons = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const toast = document.querySelector("#toast");
const loginForm = document.querySelector("#loginForm");
const gmailLoginButton = document.querySelector("#gmailLoginButton");
const vendorSignupOpenButton = document.querySelector("#vendorSignupOpenButton");
const roleSelect = document.querySelector("#roleSelect");
const loginSessionTimeout = null;
const sessionTimeoutSelect = null;
const sessionStatus = null;
const sessionWarning = null;
const extendSessionButton = null;
const tutorialButton = document.querySelector("#tutorialButton");
const vendorCategory = document.querySelector("#vendorCategory");
const vendorProductButton = document.querySelector("#vendorProductButton");
const marketCartButton = document.querySelector("#marketCartButton");
const librarySearch = document.querySelector("#librarySearch");
const metricsGrid = document.querySelector(".metrics-grid");
const notificationButton = document.querySelector("#notificationButton");
const contentPostButton = document.querySelector("#contentPostButton");
const leaderThreadButton = document.querySelector("#leaderThreadButton");
const leaderTakeawayButton = document.querySelector("#leaderTakeawayButton");
const profileEditButton = document.querySelector("#profileEditButton");
const teacherResourceButton = document.querySelector("#teacherResourceButton");
const reviewCycleButton = document.querySelector("#reviewCycleButton");
const paymentPanel = document.querySelector(".payment-panel");
const invoicePanel = document.querySelector(".invoice-panel");
const studentGrid = document.querySelector("#studentGrid");
const paymentConfig = document.querySelector("#paymentConfig");
const paymentRescueButton = document.querySelector("#paymentRescueButton");
const uploadType = document.querySelector("#uploadType");
const uploadForm = document.querySelector("#uploadForm");
const uploadPreview = document.querySelector("#uploadPreview");
const commitUploadButton = document.querySelector("#commitUploadButton");
const downloadTemplateLink = document.querySelector("#downloadTemplateLink");
const templateSaveStatus = document.querySelector("#templateSaveStatus");
const uploadHistoryBody = document.querySelector("#uploadHistoryBody");

let state = {};
let libraryFilter = "All";
let marketTab = "products";
let marketCart = [];
let paymentConfigState = {};
let pendingUpload = null;
let sessionClock = null;
let lastSessionActivityAt = 0;
let sessionExtendInFlight = false;
let suppressSessionExpiryToast = false;

const imageMap = {
  event: "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=900&q=80",
  workshop: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=900&q=80",
  content: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=900&q=80",
  podcast: "https://images.unsplash.com/photo-1590602847861-f357a9332bbc?auto=format&fit=crop&w=900&q=80",
  vendor: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
};

const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value);

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3000);
};

function selectedSessionTimeoutMinutes() {
  return 0;
}

function syncSessionTimeoutControls(value = selectedSessionTimeoutMinutes()) {
  return value;
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clearSessionClock() {
  window.clearInterval(sessionClock);
  sessionClock = null;
}

function updateSessionUi() {
  clearSessionClock();
}

function clearStoredSession() {
  activeSession = null;
  clearSessionClock();
  try {
    window.sessionStorage?.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage?.removeItem(USER_STORAGE_KEY);
    window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
    window.localStorage?.removeItem(AUTH_STORAGE_KEY);
    window.localStorage?.removeItem(USER_STORAGE_KEY);
    window.localStorage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in embedded preview modes.
  }
  toast?.classList.remove("is-visible");
  toast && (toast.textContent = "");
}

function expireSession(message, { silent = false } = {}) {
  clearStoredSession();
  document.body.classList.remove("is-authenticated");
  clearPaymentOverlay();
  document.querySelectorAll(".modal-backdrop").forEach((modalBackdrop) => modalBackdrop.remove());
  if (!silent) showToast(message);
}

async function extendSecureSession({ notify = false } = {}) {
  return null;
}

function recordSessionActivity() {
  return null;
}

const clearPaymentOverlay = () => {
  document.querySelectorAll(".razorpay-container, iframe[src*='razorpay']").forEach((item) => item.remove());
  document.body.style.overflow = "";
};

const setView = (viewId) => {
  const allowed = rolePermissions[currentRole()] || rolePermissions["School Admin"];
  if (!allowed.includes(viewId)) {
    showToast(`${currentRole()} cannot access that module.`);
    viewId = allowed[0];
  }
  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewId);
  });
  views.forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });
};

const tutorialStepsForRole = (role = currentRole()) => {
  const allowed = rolePermissions[role] || rolePermissions["School Admin"];
  return [
    {
      type: "intro",
      view: allowed[0],
      title: `${role} training quest`,
      goal: tutorialRoleIntro[role] || tutorialRoleIntro["School Admin"],
      challenge: "Use Next to tour each module. You can skip the tutorial anytime."
    },
    ...allowed.map((view) => ({ type: "module", view, ...tutorialModuleDetails[view] })),
    {
      type: "finish",
      view: allowed[0],
      title: "Training complete",
      goal: "You have toured the modules available to this role.",
      challenge: "Start adding real Yarra data manually, or rerun Tutorial from the top bar whenever needed."
    }
  ];
};

let activeTutorial = null;

const tutorialBadgeLabel = (index, total) => {
  if (index === 0) return "Start";
  if (index === total - 1) return "Complete";
  return `Level ${index}`;
};

const closeTutorial = ({ skipped = false } = {}) => {
  document.querySelector(".tutorial-backdrop")?.remove();
  document.querySelectorAll(".tutorial-focus").forEach((item) => item.classList.remove("tutorial-focus"));
  document.body.classList.remove("tutorial-is-running");
  activeTutorial = null;
  if (skipped) showToast("Tutorial skipped. You can reopen it from the top bar.");
};

const renderTutorialStep = () => {
  if (!activeTutorial) return;
  const { steps, index } = activeTutorial;
  const step = steps[index];
  const total = steps.length;
  const progress = Math.round(((index + 1) / total) * 100);
  const moduleButton = step.view ? document.querySelector(`.nav-item[data-view="${step.view}"]`) : null;
  const actionItems = step.actions || [];

  if (step.view && rolePermissions[currentRole()]?.includes(step.view)) {
    setView(step.view);
  }

  document.body.classList.add("tutorial-is-running");
  document.querySelectorAll(".tutorial-focus").forEach((item) => item.classList.remove("tutorial-focus"));
  const targetElement = step.target ? document.querySelector(step.target) : document.querySelector(`#${step.view}`);
  moduleButton?.classList.add("tutorial-focus");
  targetElement?.classList.add("tutorial-focus");
  targetElement?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

  const backdrop = document.querySelector(".tutorial-backdrop") || document.createElement("div");
  backdrop.className = "tutorial-backdrop";
  backdrop.innerHTML = `
    <section class="tutorial-card" role="dialog" aria-label="Role tutorial">
      <div class="tutorial-topline">
        <button class="tutorial-start-badge" type="button" data-tutorial-action="next">${tutorialBadgeLabel(index, total)}</button>
        <strong>${progress}%</strong>
      </div>
      <div class="tutorial-progress" aria-hidden="true"><span style="width: ${progress}%"></span></div>
      <p class="eyebrow">${currentRole()} tutorial</p>
      <h2>${step.title}</h2>
      <p>${step.goal}</p>
      <div class="tutorial-quest">
        <strong>Quest</strong>
        <span>${step.challenge}</span>
      </div>
      ${
        actionItems.length
          ? `<div class="tutorial-action-list">
              <strong>What to do here</strong>
              <ol>
                ${actionItems.map((item) => `<li>${item}</li>`).join("")}
              </ol>
            </div>`
          : ""
      }
      <p class="tutorial-pointer">The highlighted area on the page is the part to explore before pressing Next.</p>
      <div class="tutorial-rewards">
        ${steps
          .map((item, itemIndex) => `<span class="${itemIndex <= index ? "is-earned" : ""}">${itemIndex === 0 ? "Intro" : itemIndex === total - 1 ? "Done" : item.title}</span>`)
          .join("")}
      </div>
      <div class="tutorial-actions">
        <button class="ghost-button tutorial-skip" type="button" data-tutorial-action="skip">Skip</button>
        <button class="ghost-button tutorial-back" type="button" data-tutorial-action="back" ${index === 0 ? "disabled" : ""}>Back</button>
        <button class="primary-button tutorial-next" type="button" data-tutorial-action="next">${index === 0 ? "Start tutorial" : index === total - 1 ? "Finish" : "Next"}</button>
      </div>
    </section>
  `;

  if (!backdrop.isConnected) document.body.append(backdrop);
};

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tutorial-action]");
  if (!button || !activeTutorial) return;
  event.preventDefault();
  event.stopPropagation();

  const action = button.dataset.tutorialAction;
  if (action === "skip") {
    closeTutorial({ skipped: true });
    return;
  }

  if (action === "back") {
    if (activeTutorial.index > 0) {
      activeTutorial.index -= 1;
      renderTutorialStep();
    }
    return;
  }

  if (activeTutorial.index >= activeTutorial.steps.length - 1) {
    closeTutorial();
    showToast("Tutorial complete. Nice, you're ready to explore.");
    return;
  }

  activeTutorial.index += 1;
  renderTutorialStep();
});

const startTutorial = () => {
  activeTutorial = {
    role: currentRole(),
    steps: tutorialStepsForRole(currentRole()),
    index: 0
  };
  renderTutorialStep();
};

const applyRolePermissions = () => {
  const role = currentRole();
  if (roleSelect && roleSelect.value !== role) roleSelect.value = role;
  const allowed = rolePermissions[role] || rolePermissions["School Admin"];
  navButtons.forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.view);
  });
  document.querySelector("#eventButton").hidden = !["Super Admin", "School Admin", "Teacher"].includes(role);
  document.querySelector("#paymentButton").hidden = !["Super Admin", "School Admin"].includes(role);
  document.querySelector("#studentButton").hidden = !["Super Admin", "School Admin"].includes(role);
  document.querySelector("#inviteStudentButton").hidden = !["Super Admin", "School Admin"].includes(role);
  contentPostButton.hidden = !["Super Admin", "School Admin", "Teacher"].includes(role);
  leaderThreadButton.hidden = !["Super Admin", "School Admin"].includes(role);
  leaderTakeawayButton.hidden = !["Super Admin", "School Admin"].includes(role);
  vendorProductButton.hidden = currentRole() !== "Vendor";
  marketCartButton.hidden = currentRole() === "Vendor";
  document.querySelector("#exchangeButton").hidden = role === "Vendor";
  document.querySelector(".membership-card").hidden = role === "Vendor";

  const activeView = document.querySelector(".view.is-active")?.id || allowed[0];
  if (!allowed.includes(activeView)) {
    setView(allowed[0]);
  }
};

const tagList = (tags) => `
  <div class="tag-row">
    ${tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
  </div>
`;

const cardTemplate = ({ eyebrow, title, body, tags, image, className, action }) => `
  <article class="${className}">
    <img src="${image}" alt="">
    <div class="card-body">
      <p class="eyebrow">${eyebrow}</p>
      <h3>${title}</h3>
      <p>${body}</p>
      ${tagList(tags)}
      ${action || ""}
    </div>
  </article>
`;

const eventQuestionTypes = [
  { value: "short", label: "Short answer" },
  { value: "paragraph", label: "Paragraph" },
  { value: "multiple", label: "Multiple choice" },
  { value: "checkboxes", label: "Checkboxes" },
  { value: "dropdown", label: "Dropdown" },
  { value: "file", label: "File upload" }
];

const defaultEventQuestionFields = [
  { label: "Student full name", type: "short", required: true },
  { label: "Grade and section", type: "short", required: true },
  { label: "Parent/guardian contact number", type: "short", required: true },
  { label: "Emergency contact name and number", type: "short", required: true },
  { label: "Any medical conditions or allergies?", type: "paragraph", required: false },
  { label: "Transport required?", type: "multiple", options: ["Yes", "No"], required: true },
  { label: "Upload student photo or consent document", type: "file", accept: "image/*,.pdf,.doc,.docx", required: false },
  { label: "Parent consent confirmation", type: "checkboxes", options: ["I confirm parent/guardian consent"], required: true }
];

const normalizeEventQuestion = (question, index = 0) => {
  if (typeof question === "string") {
    return {
      id: `q-${index + 1}`,
      label: question,
      type: "short",
      options: [],
      accept: "",
      required: true
    };
  }
  return {
    id: question?.id || `q-${index + 1}`,
    label: question?.label || question?.question || `Question ${index + 1}`,
    type: eventQuestionTypes.some((item) => item.value === question?.type) ? question.type : "short",
    options: Array.isArray(question?.options) ? question.options.filter(Boolean) : [],
    accept: question?.accept || "",
    required: question?.required !== false
  };
};

const escapeAttribute = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const fileToDataUrl = (file) =>
  new Promise((resolve) => {
    if (!file?.name) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        dataUrl: reader.result
      });
    reader.onerror = () =>
      resolve({
        name: file.name,
        size: file.size,
        type: file.type || "unknown",
        dataUrl: ""
      });
    reader.readAsDataURL(file);
  });

const eventQuestionsFor = (eventItem) => {
  const questions = eventItem?.registrationQuestions?.length ? eventItem.registrationQuestions : defaultEventQuestionFields;
  return questions.map(normalizeEventQuestion);
};

const renderMetrics = () => {
  const metrics = state.metrics;
  if (currentRole() === "Student") {
    const confirmed = (state.eventRegistrations || []).filter((registration) => registration.status === "Confirmed").length;
    const pending = (state.eventRegistrations || []).filter((registration) => registration.status === "Payment pending").length;
    const announcements = (state.notifications || []).length;
    metricsGrid.innerHTML = `
      <article class="metric">
        <span>My school</span>
        <strong>${state.schools[0]?.name || "School"}</strong>
        <p>${state.students[0]?.grade || "Student profile"}</p>
      </article>
      <article class="metric">
        <span>Upcoming events</span>
        <strong>${state.events.length}</strong>
        <p>${state.events.filter((event) => event.paid).length} paid events available</p>
      </article>
      <article class="metric">
        <span>My registrations</span>
        <strong>${confirmed}</strong>
        <p>${pending} waiting for payment</p>
      </article>
      <article class="metric">
        <span>Announcements</span>
        <strong>${announcements}</strong>
        <p>${(state.notifications || []).filter((notification) => notification.unread).length} unread</p>
      </article>
    `;
    return;
  }
  const revenueCard = currentRole() === "Super Admin"
    ? `
      <article class="metric">
        <span>Revenue</span>
        <strong>${money(metrics.totalRevenue)}</strong>
        <p>Memberships, events, promotions</p>
      </article>
    `
    : "";
  metricsGrid.innerHTML = `
    <article class="metric">
      <span>Active schools</span>
      <strong>${metrics.activeSchools}</strong>
      <p>${metrics.newSignups} awaiting approval</p>
    </article>
    <article class="metric">
      <span>Vendors</span>
      <strong>${metrics.vendors}</strong>
      <p>${state.vendors.filter((vendor) => vendor.featured).length} featured placements</p>
    </article>
    <article class="metric">
      <span>Upcoming events</span>
      <strong>${metrics.events}</strong>
      <p>${state.events.filter((event) => event.paid).length} paid registrations open</p>
    </article>
    <article class="metric">
      <span>Student users</span>
      <strong>${metrics.students || 0}</strong>
      <p>${(state.students || []).filter((student) => student.status === "Invited").length} invitations pending</p>
    </article>
    ${revenueCard}
  `;
};

const renderDashboard = () => {
  const panel = document.querySelector(".dashboard-welcome");
  if (currentRole() === "Super Admin") {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;
  if (currentRole() !== "Student") {
    panel.innerHTML = `
      <p class="eyebrow">Workspace</p>
      <h2>${currentRole()} workspace</h2>
      <p class="panel-copy">
        Your available modules are controlled by your selected role. Students see age-gated learning areas,
        vendors see their marketplace workspace, and school teams see school operations.
      </p>
    `;
    return;
  }

  const school = state.schools[0];
  const student = state.students[0];
  const registrations = state.eventRegistrations || [];
  const announcements = state.notifications || [];
  panel.innerHTML = `
    <p class="eyebrow">Student home</p>
    <h2>${student?.name || "Student"} workspace</h2>
    <div class="student-home-grid">
      <section>
        <p class="eyebrow">School profile</p>
        <h3>${school?.name || "Your school"}</h3>
        <p>${school ? `${school.board} - ${school.city} - ${school.type}` : "School details will appear here."}</p>
        <p>${school ? `${school.name} has ${school.status.toLowerCase()} Yarra access.` : ""}</p>
      </section>
      <section>
        <p class="eyebrow">Upcoming events</p>
        <ul class="clean-list">
          ${state.events.slice(0, 4).map((event) => `<li>${event.title} <span>${event.date} - ${event.scope || "Intra school"}</span></li>`).join("") || "<li>No upcoming events yet</li>"}
        </ul>
      </section>
      <section>
        <p class="eyebrow">Announcements</p>
        <ul class="clean-list">
          ${announcements.slice(0, 4).map((item) => `<li>${item.title}</li>`).join("") || "<li>No announcements yet</li>"}
        </ul>
      </section>
      <section>
        <p class="eyebrow">My registrations</p>
        <ul class="clean-list">
          ${registrations.slice(0, 4).map((registration) => `<li>${registration.eventTitle} <span>${registration.status}</span></li>`).join("") || "<li>No registrations yet</li>"}
        </ul>
      </section>
    </div>
  `;
};

const schoolName = (id) => state.schools.find((school) => school.id === id)?.name || "Member school";

const renderSchoolDashboard = () => {
  const school = state.schools[0];
  if (!school) {
    document.querySelector(".school-summary-panel").innerHTML = `<p class="eyebrow">No school yet</p><h2>Add your first school</h2><p class="panel-copy">Use School onboarding to create the first Yarra member school.</p>`;
    document.querySelector(".school-membership-panel").innerHTML = `<p class="eyebrow">Membership</p><h2>Not started</h2><p class="panel-copy">Membership details appear after onboarding.</p>`;
    document.querySelector(".school-events-panel").innerHTML = `<p class="eyebrow">Upcoming</p><h2>No events yet</h2>`;
    document.querySelector(".school-invoices-panel").innerHTML = `<p class="eyebrow">Finance</p><h2>No invoices yet</h2>`;
    return;
  }
  const schoolStudents = (state.students || []).filter((student) => student.schoolId === school.id);
  const schoolPayments = state.payments.filter((payment) => payment.schoolId === school.id);
  const nextEvents = state.events.slice(0, 3);

  document.querySelector(".school-summary-panel").innerHTML = `
    <p class="eyebrow">${school.board} - ${school.city}</p>
    <h2>${school.name}</h2>
    <div class="summary-grid">
      <article><strong>${schoolStudents.length}</strong><span>Students</span></article>
      <article><strong>${state.exchanges.filter((item) => item.fromSchool === school.name).length}</strong><span>Exchange posts</span></article>
      <article><strong>${school.earlyYears ? "Yes" : "No"}</strong><span>Early Years</span></article>
    </div>
    <ul class="clean-list">
      ${school.achievements.map((item) => `<li>${item}</li>`).join("")}
    </ul>
  `;

  document.querySelector(".school-membership-panel").innerHTML = `
    <p class="eyebrow">Membership</p>
    <h2>${school.status}</h2>
    <p class="panel-copy">${
      school.status === "Payment pending"
        ? "Payment link has been sent. Activate membership after Razorpay confirms payment, or use local confirmation while testing."
        : `Valid until ${school.membershipExpiry}. Renewal reminders are scheduled at 30, 14, 7, 2, and 1 day before expiry.`
    }</p>
    ${
      school.status === "Payment pending"
        ? `<button class="primary-button" type="button" id="activateMembershipButton">Mark payment received</button>`
        : `<button class="primary-button" type="button" id="renewMembershipButton">Renew membership</button>`
    }
  `;

  document.querySelector(".school-events-panel").innerHTML = `
    <p class="eyebrow">Upcoming</p>
    <h2>Events for this school</h2>
    <div class="compact-list">
      ${nextEvents
        .map(
          (event) => `
            <article>
              <strong>${event.title}</strong>
              <span>${event.date} - ${event.format} - ${event.registered}/${event.capacity} seats</span>
            </article>
          `
        )
        .join("")}
    </div>
  `;

  document.querySelector(".school-invoices-panel").innerHTML = `
    <p class="eyebrow">Finance</p>
    <h2>Recent invoices</h2>
    <div class="compact-list">
      ${schoolPayments
        .slice(0, 3)
        .map(
          (payment) => `
            <article>
              <strong>${payment.invoice}</strong>
              <span>${payment.type} - ${money(payment.amount)} - ${payment.status}</span>
            </article>
          `
        )
        .join("")}
    </div>
  `;

  document.querySelector("#renewMembershipButton")?.addEventListener("click", async () => {
    await api.create("payments", {
      schoolId: school.id,
      type: "Membership Renewal",
      amount: 25000,
      method: "UPI"
    });
    showToast("Membership renewal payment recorded and invoice generated.");
    await refresh();
  });

  document.querySelector("#activateMembershipButton")?.addEventListener("click", async () => {
    await api.post(`/api/schools/${school.id}/activate-membership`);
    showToast("Membership activated and school dashboard unlocked.");
    await refresh();
  });
};

const renderEvents = () => {
  const registrations = state.eventRegistrations || [];
  const managedEvents = state.events.filter((event) => currentRole() === "Super Admin" || event.schoolId === currentSession()?.schoolId);
  const eventStats = managedEvents.reduce(
    (stats, event) => {
      const eventRegistrations = registrations.filter((registration) => registration.eventId === event.id);
      stats.confirmed += eventRegistrations.filter((registration) => registration.status === "Confirmed").length;
      stats.pending += eventRegistrations.filter((registration) => registration.status === "Payment pending").length;
      stats.cancelled += eventRegistrations.filter((registration) => registration.status === "Cancelled").length;
      return stats;
    },
    { confirmed: 0, pending: 0, cancelled: 0 }
  );
  document.querySelector("#eventsGrid").innerHTML = state.events.length
    ? `
        ${["School Admin", "Teacher", "Super Admin"].includes(currentRole()) ? `
          <article class="panel event-dashboard-card">
            <p class="eyebrow">Registration dashboard</p>
            <h3>${eventStats.confirmed} confirmed</h3>
            <p>${eventStats.pending} payment pending - ${eventStats.cancelled} cancelled</p>
          </article>
        ` : ""}
        ${state.events
        .map((event) =>
          cardTemplate({
            eyebrow: `${event.type} - ${event.scope || "Intra school"}`,
            title: event.title,
            body: `${event.format} - ${event.date} - ${event.registered}/${event.capacity} confirmed. Hosted by ${event.host}.${event.paid ? ` Fee ${money(event.fee || 0)}.` : ""}`,
            tags: [
              event.paid ? "Paid entry" : "Member access",
              event.scope || "Intra school",
              event.recording ? "Recording" : "Live",
              event.materials ? "Materials" : "Materials pending"
            ],
            image: event.type === "Workshop" ? imageMap.workshop : imageMap.event,
            className: "project-card",
            action: `
              ${currentRole() === "Student" ? `<button class="primary-button register-event" type="button" data-id="${event.id}">${event.paid ? "Register and pay" : "Register"}</button>` : ""}
              ${["School Admin", "Teacher", "Super Admin"].includes(currentRole()) && (currentRole() === "Super Admin" || event.schoolId === currentSession()?.schoolId) ? `<button class="ghost-button manage-event" type="button" data-id="${event.id}">Manage registrations</button>` : ""}
            `
          })
        )
        .join("")}
      `
    : `<article class="panel"><h3>No events yet</h3><p>Create the first Yarra event when you are ready.</p></article>`;
};

const renderExchange = () => {
  const columns = ["Open", "Under Review", "Matched", "Completed"];
  document.querySelector(".kanban").innerHTML = columns
    .map((status) => {
      const items = state.exchanges.filter((exchange) => exchange.status === status);
      return `
        <section>
          <h3>${status}</h3>
          ${
            items.length
              ? items
                  .map(
                    (exchange) => `
                      <article>
                        ${exchange.title}
                        <span>${exchange.type} - ${exchange.subject} - ${exchange.duration}</span>
                      </article>
                    `
                  )
                  .join("")
              : `<article>No items yet <span>Create one from this board</span></article>`
          }
        </section>
      `;
    })
    .join("");
};

const renderLeadership = () => {
  const threads = state.leadershipThreads || [];
  const takeaways = threads.flatMap((thread) =>
    (thread.takeaways || []).map((takeaway) => ({
      ...takeaway,
      threadTitle: thread.title
    }))
  );

  document.querySelector("#leadershipTakeaways").innerHTML = takeaways.length
    ? takeaways
        .slice(0, 6)
        .map((takeaway) => `
          <article>
            <strong>${takeaway.text}</strong>
            <span>${takeaway.threadTitle} - ${takeaway.author || "Leader"}</span>
          </article>
        `)
        .join("")
    : `<article><strong>No takeaways yet</strong><span>Add concise notes after each principal forum.</span></article>`;

  document.querySelector("#leadershipThreads").innerHTML = threads.length
    ? threads
        .map((thread) => `
          <article class="leader-thread" data-id="${thread.id}">
            <div class="thread-heading">
              <div>
                <p class="eyebrow">${thread.forumDate || "Leadership forum"}</p>
                <h3>${thread.title}</h3>
                <span>${thread.author || "School leader"} - ${thread.schoolName || schoolName(thread.schoolId)}</span>
              </div>
              <strong>${(thread.replies || []).length} replies</strong>
            </div>
            <p>${thread.prompt || "Open leadership discussion."}</p>
            ${(thread.takeaways || []).length ? `
              <div class="thread-takeaways">
                ${(thread.takeaways || []).slice(0, 3).map((takeaway) => `<span>${takeaway.text}</span>`).join("")}
              </div>
            ` : ""}
            ${(thread.replies || []).length ? `
              <div class="comment-preview">
                ${(thread.replies || []).slice(0, 2).map((reply) => `<p><strong>${reply.author}</strong> ${reply.text}</p>`).join("")}
              </div>
            ` : ""}
            <div class="post-actions">
              <button class="ghost-button reply-leader-thread" type="button" data-id="${thread.id}">Reply</button>
              <button class="ghost-button add-thread-takeaway" type="button" data-id="${thread.id}">Add takeaway</button>
            </div>
          </article>
        `)
        .join("")
    : `<article class="leader-thread"><h3>No leader threads yet</h3><p>Start the first principal discussion after your next forum.</p></article>`;
};

const signedInProfile = () => {
  const session = currentSession() || {};
  const role = currentRole();
  const school = state.schools?.[0] || {};
  const student = state.students?.[0] || {};
  const teacher = state.teachers?.[0] || {};
  const displayName =
    session.name ||
    student.name ||
    teacher.name ||
    (role === "Vendor" ? state.vendors?.[0]?.name : school.name) ||
    "Yarra member";
  return { session, role, school, student, teacher, displayName };
};

const renderMyProfile = () => {
  const grid = document.querySelector("#myProfileGrid");
  if (!grid) return;
  const { session, role, school, student, teacher, displayName } = signedInProfile();
  const details = [
    ["Role", role],
    ["Email", session.email || student.email || teacher.email || school.contact || "Not added"],
    ["School", school.name || "Not linked yet"],
    ["Grade / Designation", student.grade || teacher.designation || "Not added"],
    ["Contact", student.guardianEmail || teacher.mobile || school.contact || "Not added"],
    ["Access", (student.access || ["Yarra member"]).join(", ")]
  ];
  grid.innerHTML = `
    <article class="school-profile">
      <img src="assets/yarra-logo.jpeg" alt="Yarra Education Group">
      <div>
        <p class="eyebrow">${role}</p>
        <h3>${displayName}</h3>
        <p>${role === "Student" ? "Student access is curated by the school admin and filtered by age." : "This profile controls the identity and school context used across Yarra."}</p>
      </div>
    </article>
    <section class="panel">
      <h3>Profile details</h3>
      <div class="compact-list">
        ${details.map(([label, value]) => `<article><strong>${label}</strong><span>${value}</span></article>`).join("")}
      </div>
    </section>
  `;
};

const renderTeachersHub = () => {
  const grid = document.querySelector("#teacherResourceGrid");
  if (!grid) return;
  const buckets = ["Upcoming PL Session", "Past Recording", "Resource Document"];
  const resources = state.teacherResources || [];
  teacherResourceButton.hidden = currentRole() === "Student" || currentRole() === "Vendor";
  grid.innerHTML = buckets.map((bucket) => {
    const items = resources.filter((resource) => resource.type === bucket);
    return `
      <section class="panel">
        <p class="eyebrow">${bucket}</p>
        <h3>${items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "No items yet"}</h3>
        <div class="compact-list">
          ${items.length ? items.map((item) => `
            <article>
              <strong>${item.title}</strong>
              <span>${item.presenter || item.uploadedBy || "Staff"}${item.sessionDate ? ` - ${item.sessionDate}` : ""}${item.link ? ` - ${item.link}` : ""}</span>
            </article>
          `).join("") : `<article><strong>Ready for your first upload</strong><span>Add sessions, recordings, documents, or staff links.</span></article>`}
        </div>
      </section>
    `;
  }).join("");
};

const renderReviewCycle = () => {
  const grid = document.querySelector("#reviewCycleGrid");
  if (!grid) return;
  const cycles = state.reviewCycles || [];
  reviewCycleButton.hidden = currentRole() === "Student" || currentRole() === "Vendor";
  grid.innerHTML = cycles.length
    ? cycles.map((cycle) => {
        const stages = [
          ["Self-study", cycle.selfStudyStatus],
          ["Review visit", cycle.reviewVisitStatus],
          ["SIP", cycle.sipStatus],
          ["Recommendations", cycle.recommendationsStatus]
        ];
        return `
          <article class="panel">
            <p class="eyebrow">${cycle.startDate || "Start pending"} - ${cycle.endDate || "End pending"}</p>
            <h3>${cycle.title}</h3>
            <p>${cycle.notes || "Track review evidence, visits, improvement plans, and recommendation closure."}</p>
            <div class="compact-list">
              ${stages.map(([label, status]) => `<article><strong>${label}</strong><span>${status || "Not Started"}</span></article>`).join("")}
            </div>
          </article>
        `;
      }).join("")
    : `<article class="panel"><h3>No review cycle yet</h3><p>Create the first school improvement cycle when the school is ready.</p></article>`;
};

const renderSchoolNetwork = () => {
  const grid = document.querySelector("#schoolNetworkGrid");
  if (!grid) return;
  const schools = state.schools || [];
  grid.innerHTML = schools.length
    ? schools.map((school) => `
        <article class="panel">
          <p class="eyebrow">${school.board || "Board pending"} - ${school.city || "City pending"}</p>
          <h3>${school.name}</h3>
          <p>${school.type || "School type pending"} member profile. ${school.earlyYears ? "Early Years enabled." : "Early Years not enabled."}</p>
          <div class="tag-list">
            ${(school.achievements || ["Profile setup pending"]).map((item) => `<span>${item}</span>`).join("")}
          </div>
        </article>
      `).join("")
    : `<article class="panel"><h3>No schools yet</h3><p>Member-school cards appear here after onboarding and payment confirmation.</p></article>`;
};

const renderLibrary = () => {
  const query = librarySearch.value.trim().toLowerCase();
  const normalizedContent = (state.content || []).map((item) => ({
    ...item,
    type: item.type || "Article",
    speaker: item.speaker || item.author || "Yarra member",
    category: item.category || "Community",
    tags: Array.isArray(item.tags) ? item.tags : [],
    likes: Number(item.likes || 0),
    comments: Number(item.comments || item.commentThreads?.length || 0),
    saved: Number(item.saved || 0),
    views: Number(item.views || 0),
    body: item.body || "",
    mediaUrl: item.mediaUrl || item.thumbnailUrl || "",
    thumbnailUrl: item.thumbnailUrl || item.mediaUrl || ""
  }));
  const filtered = normalizedContent.filter((item) => {
    const matchesType = libraryFilter === "All" || item.type === libraryFilter;
    const haystack = `${item.title} ${item.type} ${item.speaker} ${item.category} ${item.body} ${item.tags.join(" ")}`.toLowerCase();
    return matchesType && haystack.includes(query);
  });
  const stories = normalizedContent.filter((item) => item.type === "Story").slice(0, 12);

  document.querySelector("#storyStrip").innerHTML = stories.length
    ? stories
        .map((item) => `
          <button class="story-bubble open-content" type="button" data-id="${item.id}">
            <img src="${item.thumbnailUrl || imageMap.content}" alt="">
            <span>${item.title}</span>
          </button>
        `)
        .join("")
    : `<article class="empty-story"><strong>No stories yet</strong><span>Create the first school story from this tab.</span></article>`;
  document.querySelector("#libraryGrid").innerHTML = filtered.length
    ? filtered
        .map((item) => {
          const isShort = item.type === "Short";
          const media = item.thumbnailUrl || (item.type === "Podcast" ? imageMap.podcast : imageMap.content);
          return `
            <article class="social-post ${isShort ? "is-short" : ""}" data-id="${item.id}">
              <div class="post-topline">
                <div>
                  <p class="eyebrow">${item.type}</p>
                  <h3>${item.title}</h3>
                  <span>${item.speaker} - ${item.category}</span>
                </div>
                <strong>${item.views} views</strong>
              </div>
              ${["Video", "Short", "Recorded Workshop", "Webinar"].includes(item.type)
                ? `<div class="post-media video-shell"><img src="${media}" alt=""><span>${item.type === "Short" ? "Short" : "Play video"}</span></div>`
                : item.type === "Article"
                  ? `<div class="article-preview"><h4>${item.title}</h4><p>${item.body || "Article summary will appear here."}</p></div>`
                  : item.type === "Podcast"
                    ? `<div class="podcast-preview"><span>Audio</span><p>${item.body || "Podcast episode"}</p></div>`
                    : `<div class="post-media"><img src="${media}" alt=""></div>`}
              <p class="post-copy">${item.body || "Shared with the Yarra community."}</p>
              ${tagList([...item.tags, item.restrictedToEarlyYears ? "Early Years only" : "All members"])}
              <div class="post-actions">
                <button class="ghost-button content-like" type="button" data-id="${item.id}">Like ${item.likes}</button>
                <button class="ghost-button content-comment" type="button" data-id="${item.id}">Comment ${item.comments}</button>
                <button class="ghost-button content-save" type="button" data-id="${item.id}">Save ${item.saved}</button>
              </div>
              ${item.commentThreads?.length ? `
                <div class="comment-preview">
                  ${item.commentThreads.slice(0, 2).map((comment) => `<p><strong>${comment.author}</strong> ${comment.text}</p>`).join("")}
                </div>
              ` : ""}
            </article>
          `;
        })
        .join("")
    : `<article class="panel"><h3>No matching content</h3><p>Try another type, speaker, title, or tag.</p></article>`;
};

const renderVendors = () => {
  const category = vendorCategory.value;
  const vendors = (state.vendors || []).filter((vendor) => category === "All categories" || vendor.category === category);
  const vendorName = (id) => (state.vendors || []).find((vendor) => vendor.id === id)?.name || "Vendor";
  const products = (state.vendorProducts || []).filter((product) => {
    const vendor = (state.vendors || []).find((item) => item.id === product.vendorId);
    return category === "All categories" || product.category === category || vendor?.category === category;
  });
  const orders = state.marketOrders || [];

  marketCartButton.textContent = `Cart ${marketCart.reduce((sum, item) => sum + item.quantity, 0)}`;
  document.querySelectorAll(".market-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.marketTab === marketTab));
  document.querySelector("#marketOrders").innerHTML = orders.length
    ? orders
        .slice(0, 5)
        .map((order) => `
          <article>
            <strong>${order.id}</strong>
            <span>${order.status} - ${money(order.total || 0)} - ${(order.items || []).length} items</span>
          </article>
        `)
        .join("")
    : `<article><strong>No orders yet</strong><span>Checkout orders will appear here.</span></article>`;

  if (marketTab === "vendors") {
    document.querySelector("#marketGrid").innerHTML = vendors.length
      ? vendors
          .map((vendor) =>
            cardTemplate({
              eyebrow: vendor.category,
              title: vendor.name,
              body: vendor.offer,
              tags: [vendor.status, vendor.featured ? "Featured" : "Standard", "Seller storefront"],
              image: imageMap.vendor,
              className: "vendor-card",
              action:
                vendor.status === "Approved" || currentRole() !== "Super Admin"
                  ? `<button class="ghost-button view-seller-products" type="button" data-id="${vendor.id}">View products</button>`
                  : `<button class="ghost-button approve-vendor" type="button" data-id="${vendor.id}">Approve vendor</button>`
            })
          )
          .join("")
      : `<article class="panel"><h3>No vendors in this category yet</h3><p>New listings appear after admin approval.</p></article>`;
    return;
  }

  if (marketTab === "orders") {
    document.querySelector("#marketGrid").innerHTML = orders.length
      ? orders
          .map((order) => `
            <article class="market-order-card">
              <p class="eyebrow">${order.status}</p>
              <h3>${order.id}</h3>
              <p>${order.buyerName || order.buyerRole} - ${money(order.total || 0)}</p>
              <ol class="order-steps">
                ${["Placed", "Confirmed", "Packed", "Shipped", "Delivered"].map((step) => `<li class="${order.tracking?.includes(step) ? "done" : ""}">${step}</li>`).join("")}
              </ol>
              <div class="compact-list">
                ${(order.items || []).map((item) => `<article><strong>${item.name}</strong><span>${item.quantity} x ${money(item.price)}</span></article>`).join("")}
              </div>
              ${currentRole() === "Vendor" && order.status !== "Delivered" ? `<button class="primary-button advance-order-status" type="button" data-id="${order.id}">Advance status</button>` : ""}
            </article>
          `)
          .join("")
      : `<article class="panel"><h3>No orders yet</h3><p>Shop products and checkout to create your first order.</p></article>`;
    return;
  }

  document.querySelector("#marketGrid").innerHTML = products.length
    ? products
        .map((product) => `
          <article class="product-card">
            <img src="${product.imageUrl || imageMap.vendor}" alt="">
            <div class="product-body">
              <p class="eyebrow">${product.category || "Marketplace"}</p>
              <h3>${product.name}</h3>
              <p>${vendorName(product.vendorId)} - ${product.description || "School-ready product"}</p>
              <strong>${money(product.price || 0)}</strong>
              ${tagList([product.stock > 0 ? `${product.stock} in stock` : "Out of stock", product.audience || "Schools", product.delivery || "Standard delivery"])}
              ${
                currentRole() === "Vendor"
                  ? `<button class="ghost-button update-order-status" type="button" data-id="${product.id}">Listed</button>`
                  : `<button class="primary-button add-to-cart" type="button" data-id="${product.id}">Add to cart</button>`
              }
            </div>
          </article>
        `)
        .join("")
    : `<article class="panel"><h3>No products yet</h3><p>Vendor uploaded products and pricing will appear here.</p></article>`;
};

const invoiceMarkup = (payment) => `
  <div class="invoice-preview">
    <div class="invoice-head">
      <img src="assets/yarra-logo.jpeg" alt="Yarra Education Group">
      <div>
        <p class="eyebrow">Tax invoice</p>
        <h3>${payment.invoice}</h3>
      </div>
    </div>
    <dl>
      <div><dt>School</dt><dd>${schoolName(payment.schoolId)}</dd></div>
      <div><dt>Payment type</dt><dd>${payment.type}</dd></div>
      <div><dt>Amount</dt><dd>${money(payment.amount)}</dd></div>
      <div><dt>Status</dt><dd>${payment.status}</dd></div>
      <div><dt>Date</dt><dd>${payment.createdAt}</dd></div>
      <div><dt>Method</dt><dd>${payment.method || "Razorpay"}</dd></div>
    </dl>
  </div>
`;

const renderPayments = () => {
  const latest = state.payments[0];
  paymentPanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Transactions</p>
        <h2>Payment history</h2>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>School</th>
            <th>Type</th>
            <th>Amount</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${state.payments
            .map(
              (payment) => `
                <tr>
                  <td>${payment.invoice}</td>
                  <td>${schoolName(payment.schoolId)}</td>
                  <td>${payment.type}</td>
                  <td>${money(payment.amount)}</td>
                  <td><span class="status-pill">${payment.status}</span></td>
                  <td><button class="ghost-button invoice-action" type="button" data-id="${payment.id}">View invoice</button></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  invoicePanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Invoice preview</p>
        <h2>Generated invoice</h2>
      </div>
    </div>
    ${latest ? invoiceMarkup(latest) : "<p>No invoices yet.</p>"}
    ${latest ? `<button class="primary-button" id="downloadInvoiceButton" type="button">Download invoice</button>` : ""}
  `;
};

const renderPaymentConfig = () => {
  if (!paymentConfig) return;
  if (paymentConfigState.razorpayConfigured) {
    paymentConfig.className = "payment-config is-live";
    paymentConfig.textContent = `Razorpay live: ${paymentConfigState.razorpayKeyId}`;
  } else {
    paymentConfig.className = "payment-config is-missing";
    paymentConfig.textContent =
      "Razorpay keys missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env, then restart npm start.";
  }
};

const renderStudents = () => {
  const students = state.students || [];
  studentGrid.innerHTML = students.length
    ? students
        .map(
          (student) => `
        <article class="student-card">
          <div>
            <p class="eyebrow">${student.grade} - age ${student.age}</p>
            <h3>${student.name}</h3>
            <p>${schoolName(student.schoolId)}</p>
          </div>
          <span class="status-pill">${student.status}</span>
          ${tagList(student.access || [])}
          <p class="panel-copy">Login: ${student.email || student.studentEmail || student.guardianEmail}</p>
          <p class="panel-copy">Guardian: ${student.guardianEmail}</p>
        </article>
      `
        )
        .join("")
    : `<article class="panel"><h3>No students yet</h3><p>Use User management or Add student to onboard learners manually.</p></article>`;
};

const renderProfiles = () => {
  const activeSchool = state.schools[0];
  if (!activeSchool) {
    document.querySelector(".school-profile div").innerHTML = `<p class="eyebrow">No profile yet</p><h3>Add your first school</h3><p>School profile details appear after onboarding.</p>`;
    document.querySelector(".clean-list").innerHTML = `<li>No highlights added yet</li>`;
    return;
  }
  document.querySelector(".school-profile div").innerHTML = `
    <p class="eyebrow">${activeSchool.board} - ${activeSchool.city}</p>
    <h3>${activeSchool.name}</h3>
    <p>${activeSchool.name} is a ${activeSchool.type} member school with ${activeSchool.status.toLowerCase()} consortium access.</p>
  `;
  document.querySelector(".clean-list").innerHTML = activeSchool.achievements
    .map((achievement) => `<li>${achievement}</li>`)
    .join("");
};

const renderNotifications = () => {
  const unread = state.notifications.filter((notification) => notification.unread).length;
  notificationButton.innerHTML = `<span aria-hidden="true">${unread}</span>`;
};

const renderUploadHistory = () => {
  const history = state.uploadHistory || [];
  uploadHistoryBody.innerHTML = history.length
    ? history
        .map(
          (item) => `
            <tr>
              <td>${item.uploadType}</td>
              <td>${item.fileName}</td>
              <td>${item.recordCount}</td>
              <td>${item.errorCount}</td>
              <td><span class="status-pill">${item.status}</span></td>
              <td>${item.createdAt}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="6">No uploads committed yet.</td></tr>`;
};

const renderAll = () => {
  applyRolePermissions();
  renderMetrics();
  renderDashboard();
  renderSchoolDashboard();
  renderEvents();
  renderExchange();
  renderLeadership();
  renderMyProfile();
  renderTeachersHub();
  renderReviewCycle();
  renderLibrary();
  renderVendors();
  renderSchoolNetwork();
  renderPayments();
  renderPaymentConfig();
  renderStudents();
  renderProfiles();
  renderNotifications();
  renderUploadHistory();
};

const refresh = async () => {
  const [nextState, nextPaymentConfig] = await Promise.all([api.state(), api.paymentConfig()]);
  state = nextState;
  paymentConfigState = nextPaymentConfig;
  renderAll();
};

const refreshWithSession = async (session) => {
  const [nextState, nextPaymentConfig] = await Promise.all([api.stateWithSession(session), api.paymentConfig()]);
  state = nextState;
  paymentConfigState = nextPaymentConfig;
  renderAll();
};

const setAuthenticated = (value) => {
  document.body.classList.toggle("is-authenticated", value);
  if (value) {
    setSessionValue(AUTH_STORAGE_KEY, "true");
    updateSessionUi();
  } else {
    clearStoredSession();
  }
};

const completeGmailLogin = async () => {
  const formData = new FormData(loginForm);
  const authUser = await api.gmailLogin({
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role")
  });
  roleSelect.value = authUser.role;
  setSessionValue(USER_STORAGE_KEY, JSON.stringify(authUser));
  storeSession(authUser.session);
  setAuthenticated(true);
  await refreshWithSession(authUser.session);
  showToast(`Signed in with Gmail as ${authUser.email}.`);
};

const loadRazorpayScript = () =>
  new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay Checkout"));
    document.head.append(script);
  });

const openUpiPayment = async (order, school) => {
  const intent = await api.createUpiIntent({
    amount: order.amount / 100,
    note: `Yarra membership fee from ${school.name}`
  });

  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-heading">
          <h2>Collect ₹${intent.amount} membership fee</h2>
          <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
        </div>
        <div class="upi-details">
          <p class="eyebrow">Yarra/Akshar receiving UPI ID</p>
          <strong>${intent.payeeId}</strong>
          <p>Use this payment link for ${school.name}'s membership fee. In production, send it to the school's admin or finance contact.</p>
          <a class="primary-button upi-link" href="${intent.uri}">Open school payment link</a>
          <button class="ghost-button copy-upi" type="button">Copy UPI link</button>
        </div>
        <button class="primary-button confirm-upi" type="button">Mark ${school.name} membership as paid</button>
        <p class="login-note">Local testing lets you confirm manually. Production should activate the school only after a verified Razorpay webhook or bank settlement confirmation.</p>
      </div>
    `;

    overlay.querySelector(".close-modal").addEventListener("click", () => {
      overlay.remove();
      reject(new Error("Payment cancelled"));
    });
    overlay.querySelector(".copy-upi").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(intent.uri);
        showToast("UPI payment link copied.");
      } catch {
        showToast(intent.uri);
      }
    });
    overlay.querySelector(".confirm-upi").addEventListener("click", () => {
      overlay.remove();
      resolve({
        razorpay_payment_id: `upi_manual_${Date.now().toString(36)}`,
        razorpay_order_id: order.id,
        simulated: true,
        method: "Direct UPI",
        upiId: intent.payeeId
      });
    });

    document.body.append(overlay);
  });
};

const openRazorpayHostedLink = (link, order, school) =>
  new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-backdrop";
    overlay.innerHTML = `
      <div class="modal-card">
        <div class="modal-heading">
          <h2>Payment email sent</h2>
          <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
        </div>
        <div class="upi-details">
          <p class="eyebrow">Razorpay email delivery</p>
          <strong>${school.name} - ₹${order.amount / 100}</strong>
          <p>The secure Razorpay payment link has been sent to ${school.contact}. This email is also invited as the School Admin login for ${school.name}.</p>
          <p class="login-note">If it does not arrive within a minute, check spam/promotions or confirm that this email address is the real school billing mailbox.</p>
        </div>
        <button class="primary-button confirm-razorpay-link" type="button">Done</button>
        <p class="login-note">When Razorpay confirms the payment through a verified webhook, Yarra will show a notification and activate the membership workflow.</p>
      </div>
    `;

    overlay.querySelector(".close-modal").addEventListener("click", () => {
      overlay.remove();
      reject(new Error("Payment cancelled"));
    });
    overlay.querySelector(".confirm-razorpay-link").addEventListener("click", () => {
      overlay.remove();
      resolve({
        razorpay_payment_id: link.id,
        razorpay_order_id: link.reference_id || link.id,
        method: "Razorpay emailed link",
        pending: true,
        schoolName: school.name
      });
    });

    document.body.append(overlay);
  });

const openRazorpayCheckout = (order, school) =>
  new Promise(async (resolve, reject) => {
    if (order.simulated || !window.Razorpay) {
      if (!order.simulated) {
        try {
          await loadRazorpayScript();
        } catch (error) {
          reject(error);
          return;
        }
      }
    }

    if (order.simulated) {
      try {
        resolve(await openUpiPayment(order, school));
        return;
      } catch (error) {
        reject(error);
        return;
      }
    }

    let settled = false;
    const checkout = new window.Razorpay({
      key: order.key,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "Yaara Education Group",
      description: `Yarra Consortium membership for ${school.name}`,
      image: "assets/yarra-logo.jpeg",
      order_id: order.id,
      method: {
        upi: true,
        card: false,
        netbanking: false,
        wallet: false,
        emi: false,
        paylater: false
      },
      config: {
        display: {
          blocks: {
            upi: {
              name: "Pay using UPI",
              instruments: [
                {
                  method: "upi"
                }
              ]
            }
          },
          sequence: ["block.upi"],
          preferences: {
            show_default_blocks: false
          }
        }
      },
      prefill: {
        name: school.name,
        email: school.contact
      },
      theme: {
        color: "#1e6b78"
      },
      handler: (response) => {
        settled = true;
        resolve(response);
      },
      modal: {
        ondismiss: () => {
          settled = true;
          reject(new Error("Payment cancelled"));
        }
      }
    });

    checkout.on("payment.failed", (response) => {
      settled = true;
      reject(new Error(response.error?.description || "Razorpay payment failed"));
    });

    checkout.open();
  });

const modal = (title, fields, onSubmit) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <form class="modal-card">
      <div class="modal-heading">
        <h2>${title}</h2>
        <button class="icon-button close-modal" type="button" aria-label="Close">×</button>
      </div>
      <div class="modal-fields">
        ${fields
          .map((field) => {
            if (field.type === "select") {
              return `
                <label>
                  ${field.label}
                  <select name="${field.name}">
                    ${field.options.map((option) => `<option>${option}</option>`).join("")}
                  </select>
                </label>
              `;
            }
            if (field.type === "checkbox") {
              return `
                <label class="checkbox-row">
                  <input name="${field.name}" type="checkbox">
                  ${field.label}
                </label>
              `;
            }
            if (field.type === "textarea") {
              return `
                <label>
                  ${field.label}
                  <textarea name="${field.name}" rows="${field.rows || 5}" ${field.required ? "required" : ""}>${field.value || ""}</textarea>
                </label>
              `;
            }
            return `
              <label>
                ${field.label}
                <input name="${field.name}" type="${field.type || "text"}" ${field.required ? "required" : ""} value="${field.value || ""}">
              </label>
            `;
          })
          .join("")}
      </div>
      <button class="primary-button" type="submit">Save</button>
    </form>
  `;

  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    fields
      .filter((field) => field.type === "checkbox")
      .forEach((field) => {
        payload[field.name] = formData.has(field.name);
      });
    await onSubmit(payload);
    overlay.remove();
    await refresh();
  });

  document.body.append(overlay);
};

navButtons.forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

tutorialButton?.addEventListener("click", startTutorial);

loginForm.querySelector('select[name="role"]').addEventListener("change", (event) => {
  const preset = yarraLoginPresets[event.target.value];
  if (!preset) return;
  loginForm.querySelector('input[name="email"]').value = preset.email;
  loginForm.querySelector('input[name="password"]').value = preset.password;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await completeGmailLogin();
  } catch (error) {
    showToast(error.message);
  }
});

gmailLoginButton.addEventListener("click", async () => {
  try {
    await completeGmailLogin();
  } catch (error) {
    showToast(error.message);
  }
});

vendorSignupOpenButton.addEventListener("click", async () => {
  try {
    const authUser = await api.gmailLogin({
      email: "yarra.vendor@akshararbol.edu.in",
      password: "Yarra@Vendor123",
      role: "Vendor"
    });
    roleSelect.value = authUser.role;
    setSessionValue(USER_STORAGE_KEY, JSON.stringify(authUser));
    storeSession(authUser.session);
    setAuthenticated(true);
    await refresh();
    setView("vendorSignup");
    showToast("Vendor sign-up information opened.");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#logoutButton").addEventListener("click", async () => {
  try {
    if (currentSession()?.id) await api.logout();
  } catch {
    // The local session is still cleared even if the server session already expired.
  }
  setAuthenticated(false);
  showToast("Signed out.");
});

document.querySelector("#schoolForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const formStatus = event.currentTarget.querySelector(".form-status");
  const payload = {
    name: formData.get("school"),
    board: formData.get("board"),
    type: formData.get("type"),
    city: "Bengaluru",
    contact: String(formData.get("billingEmail") || "admin@school.edu").trim().toLowerCase(),
    earlyYears: event.currentTarget.querySelector('input[type="checkbox"]').checked
  };
  const amount = Math.max(1, Number(formData.get("amount") || 1));
  try {
    if (!payload.contact.includes("@")) {
      throw new Error("Use the school admin's real business email address.");
    }
    paymentRescueButton.classList.remove("hidden");
    formStatus.textContent = `Creating membership payment request for ${payload.name}...`;
    const order = await api.createRazorpayOrder({
      amount,
      type: "Membership",
      schoolName: payload.name
    });
    formStatus.textContent = order.simulated
      ? order.reason || "Razorpay keys not configured. Running local payment simulation..."
      : "Creating Razorpay hosted school payment page...";
    const schoolForPayment = {
      name: payload.name,
      contact: payload.contact
    };
    let pendingSchool = null;
    const payment = order.simulated
      ? await openRazorpayCheckout(order, schoolForPayment)
      : await (async () => {
          pendingSchool = await api.create("schools", {
            ...payload,
            amount: order.amount / 100,
            paymentPending: true,
            paymentMethod: "Razorpay emailed link",
            gatewayOrderId: order.id
          });
          return openRazorpayHostedLink(
            await api.createRazorpayLink({
              amount,
              type: "Membership",
              schoolId: pendingSchool.id,
              schoolName: payload.name,
              email: payload.contact,
              description: `Yarra Consortium membership fee for ${payload.name}`
            }),
            order,
            schoolForPayment
          );
        })();

    if (payment.pending) {
      formStatus.textContent = `Payment link sent to ${payload.contact}. The same email is now invited as School Admin and will unlock after payment is marked received.`;
      showToast(`Payment link emailed to ${payload.contact}.`);
      await refresh();
      setView("schoolDashboard");
      return;
    }

    await api.create("schools", {
      ...payload,
      amount: order.amount / 100,
      paymentMethod: payment.method || (payment.simulated ? "Razorpay simulation" : "Razorpay"),
      gatewayPaymentId: payment.razorpay_payment_id,
      gatewayOrderId: payment.razorpay_order_id
    });
    formStatus.textContent =
      `${payload.name} membership payment recorded. ${payload.contact} can now sign in as School Admin and access only this school.`;
    await refresh();
    setView("schoolDashboard");
  } catch (error) {
    clearPaymentOverlay();
    formStatus.textContent = error.message;
  } finally {
    paymentRescueButton.classList.add("hidden");
  }
});

paymentRescueButton.addEventListener("click", () => {
  clearPaymentOverlay();
  paymentRescueButton.classList.add("hidden");
  document.querySelector("#schoolForm .form-status").textContent =
    "Payment screen cancelled. Click Create school and collect membership payment to try again.";
});

document.querySelector("#paymentButton").addEventListener("click", () => {
  modal(
    "Record payment",
    [
      { label: "Payment type", name: "type", type: "select", options: ["Membership", "Membership Renewal", "Event Registration", "Vendor Featured Placement"] },
      { label: "Amount", name: "amount", type: "number", value: "25000", required: true },
      { label: "Method", name: "method", type: "select", options: ["UPI", "Card", "Net banking", "Wallet"] }
    ],
    async (payload) => {
      await api.create("payments", {
        ...payload,
        schoolId: state.schools[0]?.id
      });
      showToast("Payment recorded and invoice generated.");
    }
  );
});

const setTemplateSaveStatus = (message, status = "") => {
  if (!templateSaveStatus) return;
  templateSaveStatus.textContent = message;
  templateSaveStatus.classList.toggle("is-saved", status === "saved");
  templateSaveStatus.classList.toggle("is-error", status === "error");
};

const updateTemplateDownloadUi = () => {
  const isStudent = uploadType.value === "student_roster";
  downloadTemplateLink.href = isStudent
    ? "assets/templates/student_roster_template.xlsx"
    : "assets/templates/staff_roster_template.xlsx";
  downloadTemplateLink.textContent = `Download ${isStudent ? "Student" : "Teacher"} Template`;
  setTemplateSaveStatus("Saves directly to your Windows Downloads folder.");
};

uploadType.addEventListener("change", updateTemplateDownloadUi);

downloadTemplateLink.addEventListener("click", async (event) => {
  event.preventDefault();
  const href = downloadTemplateLink.getAttribute("href");
  const fileName = href.split("/").pop();
  setTemplateSaveStatus(`Saving ${fileName} to your Downloads folder...`);
  try {
    const saved = await api.saveTemplate(uploadType.value);
    setTemplateSaveStatus(`Saved on this computer: ${saved.path}`, "saved");
    showToast(`${fileName} saved to Downloads.`);

    try {
      const response = await fetch(href);
      if (!response.ok) throw new Error("Template download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      // The server-side save above is the reliable path in the desktop app.
    }
  } catch (error) {
    setTemplateSaveStatus(error.message, "error");
    showToast(error.message);
  }
});

updateTemplateDownloadUi();

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = document.querySelector("#uploadFile").files[0];
  if (!file) return;
  const formData = new FormData();
  formData.set("uploadType", uploadType.value);
  formData.set("file", file);
  uploadPreview.className = "empty-preview";
  uploadPreview.textContent = "Validating upload...";
  commitUploadButton.classList.add("hidden");
  try {
    pendingUpload = await api.validateUpload(formData);
    const rows = pendingUpload.records.slice(0, 6);
    uploadPreview.className = "";
    uploadPreview.innerHTML = `
      <div class="upload-summary">
        <span class="status-pill">${pendingUpload.errorCount ? "FAILED" : "READY"}</span>
        <strong>${pendingUpload.recordCount} records</strong>
        <span>${pendingUpload.errorCount} errors</span>
      </div>
      ${
        pendingUpload.errors.length
          ? `<div class="error-list">${pendingUpload.errors.map((error) => `<p>Row ${error.row}: ${error.field} - ${error.message}</p>`).join("")}</div>`
          : `<div class="table-wrap"><table><thead><tr>${pendingUpload.headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows
              .map((row) => `<tr>${pendingUpload.headers.map((header) => `<td>${row[header] || ""}</td>`).join("")}</tr>`)
              .join("")}</tbody></table></div>`
      }
    `;
    if (!pendingUpload.errorCount) commitUploadButton.classList.remove("hidden");
  } catch (error) {
    uploadPreview.className = "empty-preview";
    uploadPreview.textContent = error.message;
  }
});

commitUploadButton.addEventListener("click", async () => {
  if (!pendingUpload || pendingUpload.errorCount) return;
  const result = await api.commitUpload({
    uploadType: pendingUpload.uploadType,
    fileName: pendingUpload.fileName,
    records: pendingUpload.records
  });
  showToast(`${result.recordCount} users committed.`);
  pendingUpload = null;
  commitUploadButton.classList.add("hidden");
  uploadPreview.className = "empty-preview";
  uploadPreview.textContent = "Upload committed. Choose another file to continue.";
  await refresh();
});

studentGrid.addEventListener("click", () => {});

const openStudentModal = () => {
  modal(
    "Add student user",
    [
      { label: "Student name", name: "name", required: true },
      { label: "Student email for login", name: "email", type: "email", required: true },
      { label: "Grade", name: "grade", type: "select", options: ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"] },
      { label: "Age", name: "age", type: "number", value: "13", required: true },
      { label: "Guardian email", name: "guardianEmail", type: "email", required: true }
    ],
    async (payload) => {
      await api.create("students", {
        ...payload,
        email: String(payload.email || "").trim().toLowerCase(),
        schoolId: state.schools[0]?.id
      });
      showToast(`Student login invited for ${payload.email}.`);
    }
  );
};

document.querySelector("#studentButton").addEventListener("click", openStudentModal);
document.querySelector("#inviteStudentButton").addEventListener("click", openStudentModal);

profileEditButton.addEventListener("click", () => {
  const { role, school, student, teacher, displayName } = signedInProfile();
  modal(
    "Update profile",
    [
      { label: "Display name", name: "name", value: displayName, required: true },
      { label: "Role", name: "role", value: role },
      { label: "School", name: "school", value: school.name || "" },
      { label: "Grade or designation", name: "designation", value: student.grade || teacher.designation || "" },
      { label: "Mobile / guardian contact", name: "contact", value: student.guardianEmail || teacher.mobile || "" },
      { label: "Profile notes", name: "notes", type: "textarea", value: "Add profile context, interests, languages, or responsibilities." }
    ],
    async () => {
      showToast("Profile draft saved in this workspace. Full profile persistence will connect to user records next.");
    }
  );
});

teacherResourceButton.addEventListener("click", () => {
  modal(
    "Add Teachers Hub resource",
    [
      { label: "Title", name: "title", required: true },
      { label: "Type", name: "type", type: "select", options: ["Upcoming PL Session", "Past Recording", "Resource Document"] },
      { label: "Presenter", name: "presenter", value: currentSession()?.name || "" },
      { label: "Session date", name: "sessionDate", type: "date" },
      { label: "Session time", name: "sessionTime", type: "time" },
      { label: "Duration", name: "duration", value: "60 min" },
      { label: "Capacity", name: "capacity", type: "number", value: "40" },
      { label: "Meeting / recording link", name: "link", type: "url" },
      { label: "File name or document reference", name: "fileName" },
      { label: "Notes", name: "notes", type: "textarea", value: "Add staff instructions or access notes." }
    ],
    async (payload) => {
      await api.create("teacher-resources", payload);
      showToast("Teachers Hub resource added.");
      await refresh();
    }
  );
});

reviewCycleButton.addEventListener("click", () => {
  modal(
    "Create review cycle",
    [
      { label: "Cycle title", name: "title", value: "School improvement review", required: true },
      { label: "Start date", name: "startDate", type: "date" },
      { label: "End date", name: "endDate", type: "date" },
      { label: "Self-study", name: "selfStudyStatus", type: "select", options: ["Not Started", "In Progress", "Completed"] },
      { label: "Review visit", name: "reviewVisitStatus", type: "select", options: ["Not Started", "In Progress", "Completed"] },
      { label: "SIP", name: "sipStatus", type: "select", options: ["Not Started", "In Progress", "Completed"] },
      { label: "Recommendations", name: "recommendationsStatus", type: "select", options: ["Not Started", "In Progress", "Completed"] },
      { label: "Notes", name: "notes", type: "textarea", value: "Add evidence, visit, SIP, or recommendation notes." }
    ],
    async (payload) => {
      await api.create("review-cycles", payload);
      showToast("Review cycle created.");
      await refresh();
    }
  );
});

document.querySelectorAll(".filter-chip").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.remove("is-active"));
    button.classList.add("is-active");
    libraryFilter = button.dataset.filter;
    renderLibrary();
  });
});

librarySearch.addEventListener("input", renderLibrary);
vendorCategory.addEventListener("change", renderVendors);

const openVendorProductModal = () => {
  modal(
    "Upload product and pricing",
    [
      { label: "Product name", name: "name", required: true },
      { label: "Category", name: "category", type: "select", options: ["Uniforms", "Books & Stationery", "EdTech", "Furniture & Fixtures", "Transport", "Sports Equipment"] },
      { label: "Price", name: "price", type: "number", value: "999", required: true },
      { label: "Stock", name: "stock", type: "number", value: "100" },
      { label: "Audience", name: "audience", type: "select", options: ["Students", "Teachers", "Schools", "All members"] },
      { label: "Delivery", name: "delivery", type: "select", options: ["Standard delivery", "Express delivery", "Digital delivery", "School pickup"] },
      { label: "Image URL", name: "imageUrl", type: "url", value: "" },
      { label: "Description", name: "description", type: "textarea", value: "Describe what schools, teachers, or students will receive." }
    ],
    async (payload) => {
      await api.create("vendor-products", payload);
      showToast("Product published to marketplace.");
      await refresh();
      setView("vendors");
    }
  );
};

const openCartModal = () => {
  const cartProducts = marketCart.map((cartItem) => {
    const product = (state.vendorProducts || []).find((item) => item.id === cartItem.productId);
    return product ? { ...product, quantity: cartItem.quantity } : null;
  }).filter(Boolean);
  const total = cartProducts.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">Marketplace checkout</p>
          <h2>Your cart</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      <div class="compact-list">
        ${cartProducts.length ? cartProducts.map((item) => `
          <article>
            <strong>${item.name}</strong>
            <span>${item.quantity} x ${money(item.price)} = ${money(item.quantity * item.price)}</span>
          </article>
        `).join("") : `<article><strong>Cart is empty</strong><span>Add products before checkout.</span></article>`}
      </div>
      <div class="invoice-preview">
        <dl><div><dt>Total</dt><dd>${money(total)}</dd></div></dl>
      </div>
      <button class="primary-button checkout-cart" type="button" ${cartProducts.length ? "" : "disabled"}>Place order</button>
    </div>
  `;
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", async (event) => {
    if (event.target === overlay) overlay.remove();
    if (event.target.closest(".checkout-cart")) {
      const order = await api.create("market-orders", {
        items: marketCart
      });
      marketCart = [];
      marketTab = "orders";
      overlay.remove();
      showToast(`Order placed: ${order.id}`);
      await refresh();
      setView("vendors");
    }
  });
  document.body.append(overlay);
};

vendorProductButton.addEventListener("click", openVendorProductModal);
marketCartButton.addEventListener("click", openCartModal);

document.querySelector("#vendors").addEventListener("click", async (event) => {
  const tab = event.target.closest(".market-tab");
  const addToCart = event.target.closest(".add-to-cart");
  const approve = event.target.closest(".approve-vendor");
  const sellerProducts = event.target.closest(".view-seller-products");
  const statusButton = event.target.closest(".advance-order-status");
  if (tab) {
    marketTab = tab.dataset.marketTab;
    renderVendors();
  }
  if (sellerProducts) {
    marketTab = "products";
    renderVendors();
  }
  if (addToCart) {
    const item = marketCart.find((cartItem) => cartItem.productId === addToCart.dataset.id);
    if (item) item.quantity += 1;
    else marketCart.push({ productId: addToCart.dataset.id, quantity: 1 });
    showToast("Added to cart.");
    renderVendors();
  }
  if (approve) {
    await api.post(`/api/vendors/${approve.dataset.id}/approve`);
    showToast("Vendor approved and published to the directory.");
    await refresh();
  }
  if (statusButton) {
    await api.post(`/api/market-orders/${statusButton.dataset.id}/advance`);
    showToast("Order status updated.");
    await refresh();
    setView("vendors");
  }
});

const openContentPostModal = () => {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <form class="modal-card social-compose-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">Content library</p>
          <h2>Create community post</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      <div class="modal-fields form-builder-grid">
        <label>Title<input name="title" type="text" required></label>
        <label>Post type
          <select name="type">
            <option>Story</option>
            <option>Short</option>
            <option>Video</option>
            <option>Article</option>
            <option>Webinar</option>
            <option>Recorded Workshop</option>
            <option>Podcast</option>
          </select>
        </label>
        <label>Author / speaker<input name="speaker" type="text" value="${currentSession()?.email || currentRole()}"></label>
        <label>Category<input name="category" type="text" value="Community"></label>
        <label>Media URL<input name="mediaUrl" type="url" placeholder="https://..."></label>
        <label>Upload thumbnail / story image<input name="thumbnailFile" type="file" accept="image/*"></label>
        <label>Tags<input name="tags" type="text" placeholder="leadership, student, sports"></label>
        <label>Audience
          <select name="audience">
            <option value="all">School Admin, Teacher, Student</option>
            <option value="staff">School Admin and Teacher</option>
            <option value="students">Students</option>
          </select>
        </label>
        <label>Minimum student age<input name="minAge" type="number" min="3" value="5"></label>
        <label>Maximum student age<input name="maxAge" type="number" min="3" value="18"></label>
        <label class="checkbox-line"><input name="restrictedToEarlyYears" type="checkbox"> Early Years only</label>
        <label class="wide-field">Caption / article body<textarea name="body" rows="6" placeholder="Write the story, article, video caption, or update..."></textarea></label>
      </div>
      <button class="primary-button" type="submit">Publish to feed</button>
    </form>
  `;
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (clickEvent) => {
    if (clickEvent.target === overlay) overlay.remove();
  });
  overlay.querySelector("form").addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const formData = new FormData(submitEvent.currentTarget);
    const thumbnailFile = await fileToDataUrl(formData.get("thumbnailFile"));
    const audienceMap = {
      all: ["School Admin", "Teacher", "Student"],
      staff: ["School Admin", "Teacher"],
      students: ["Student"]
    };
    try {
      await api.create("content", {
        title: formData.get("title"),
        type: formData.get("type"),
        speaker: formData.get("speaker"),
        category: formData.get("category"),
        body: formData.get("body"),
        mediaUrl: formData.get("mediaUrl"),
        thumbnailUrl: thumbnailFile?.dataUrl || formData.get("mediaUrl"),
        tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        audience: audienceMap[formData.get("audience")] || audienceMap.all,
        minAge: formData.get("minAge"),
        maxAge: formData.get("maxAge"),
        restrictedToEarlyYears: formData.get("restrictedToEarlyYears") === "on"
      });
      overlay.remove();
      showToast("Post published to the Content Library feed.");
      await refresh();
      setView("library");
    } catch (error) {
      showToast(error.message);
    }
  });
  document.body.append(overlay);
};

contentPostButton.addEventListener("click", openContentPostModal);

const openLeaderThreadModal = () => {
  modal(
    "Start leader discussion",
    [
      { label: "Thread title", name: "title", required: true },
      { label: "Forum date", name: "forumDate", type: "date" },
      { label: "Discussion prompt", name: "prompt", type: "textarea", value: "What should Yarra school leaders discuss or decide together?" },
      { label: "Initial key takeaway", name: "takeaway", type: "textarea", value: "" }
    ],
    async (payload) => {
      await api.create("leadership-threads", payload);
      showToast("Leadership thread started.");
      await refresh();
      setView("leadership");
    }
  );
};

const addLeaderTakeaway = async (threadId = null) => {
  const threads = state.leadershipThreads || [];
  const targetThreadId = threadId || threads[0]?.id;
  if (!targetThreadId) {
    openLeaderThreadModal();
    return;
  }
  const text = window.prompt("Add a key takeaway");
  if (!text?.trim()) return;
  await api.post(`/api/leadership-threads/${targetThreadId}/takeaway`, { text: text.trim() });
  showToast("Leadership takeaway added.");
  await refresh();
  setView("leadership");
};

leaderThreadButton.addEventListener("click", openLeaderThreadModal);
leaderTakeawayButton.addEventListener("click", () => addLeaderTakeaway());

document.querySelector("#leadershipThreads").addEventListener("click", async (event) => {
  const replyButton = event.target.closest(".reply-leader-thread");
  const takeawayButton = event.target.closest(".add-thread-takeaway");
  if (replyButton) {
    const text = window.prompt("Reply to this leader thread");
    if (!text?.trim()) return;
    await api.post(`/api/leadership-threads/${replyButton.dataset.id}/reply`, { text: text.trim() });
    showToast("Reply added.");
    await refresh();
    setView("leadership");
  }
  if (takeawayButton) {
    await addLeaderTakeaway(takeawayButton.dataset.id);
  }
});

document.querySelector("#libraryGrid").addEventListener("click", async (event) => {
  const likeButton = event.target.closest(".content-like");
  const saveButton = event.target.closest(".content-save");
  const commentButton = event.target.closest(".content-comment");
  if (likeButton) {
    await api.post(`/api/content/${likeButton.dataset.id}/like`);
    await refresh();
    setView("library");
  }
  if (saveButton) {
    await api.post(`/api/content/${saveButton.dataset.id}/save`);
    await refresh();
    setView("library");
  }
  if (commentButton) {
    const text = window.prompt("Write a comment");
    if (!text?.trim()) return;
    await api.post(`/api/content/${commentButton.dataset.id}/comment`, { text: text.trim() });
    await refresh();
    setView("library");
  }
});

document.querySelector("#storyStrip").addEventListener("click", (event) => {
  const storyButton = event.target.closest(".open-content");
  if (!storyButton) return;
  libraryFilter = "Story";
  document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.filter === "Story"));
  renderLibrary();
  showToast("Showing stories feed.");
});

roleSelect.addEventListener("change", async () => {
  try {
    closeTutorial();
    const authUser = await api.updateSessionRole(roleSelect.value);
    setSessionValue(USER_STORAGE_KEY, JSON.stringify(authUser));
    roleSelect.value = authUser.role;
    await refresh();
    showToast(`${roleSelect.value} permissions applied to this secure session.`);
  } catch (error) {
    roleSelect.value = currentRole();
    showToast(error.message);
  }
});

notificationButton.addEventListener("click", async () => {
  const unreadTitles = state.notifications
    .filter((notification) => notification.unread)
    .map((notification) => notification.title)
    .join(", ");
  showToast(unreadTitles || "No unread notifications.");
  await api.post("/api/notifications/read");
  await refresh();
});

const questionEditorTemplate = (question, index) => `
  <article class="form-builder-question" data-index="${index}">
    <div class="question-toolbar">
      <strong>Question ${index + 1}</strong>
      <button class="icon-button remove-question" type="button" aria-label="Remove question">x</button>
    </div>
    <label>
      Question text
      <input name="questionLabel" type="text" value="${escapeAttribute(question.label)}" required>
    </label>
    <div class="form-builder-row">
      <label>
        Answer type
        <select name="questionType">
          ${eventQuestionTypes.map((type) => `<option value="${type.value}" ${type.value === question.type ? "selected" : ""}>${type.label}</option>`).join("")}
        </select>
      </label>
      <label class="checkbox-line">
        <input name="questionRequired" type="checkbox" ${question.required ? "checked" : ""}>
        Required
      </label>
    </div>
    <label class="choice-options ${["multiple", "checkboxes", "dropdown"].includes(question.type) ? "" : "hidden"}">
      Options, one per line
      <textarea name="questionOptions" rows="3">${escapeAttribute((question.options || []).join("\n"))}</textarea>
    </label>
    <label class="file-options ${question.type === "file" ? "" : "hidden"}">
      Allowed files
      <select name="questionAccept">
        <option value="image/*,.pdf,.doc,.docx" ${question.accept === "image/*,.pdf,.doc,.docx" ? "selected" : ""}>Images, PDF, Word docs</option>
        <option value="image/*" ${question.accept === "image/*" ? "selected" : ""}>Images only</option>
        <option value=".pdf,.doc,.docx" ${question.accept === ".pdf,.doc,.docx" ? "selected" : ""}>Documents only</option>
      </select>
    </label>
  </article>
`;

const openEventBuilderModal = () => {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  let questions = defaultEventQuestionFields.map(normalizeEventQuestion);
  const renderQuestions = () => {
    overlay.querySelector(".form-builder-questions").innerHTML = questions.map(questionEditorTemplate).join("");
  };
  overlay.innerHTML = `
    <form class="modal-card form-builder-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">School Admin event setup</p>
          <h2>Create event and registration form</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      <div class="form-builder-section">
        <p class="eyebrow">Event details</p>
        <div class="modal-fields form-builder-grid">
          <label>Title<input name="title" type="text" required></label>
          <label>Type<select name="type"><option>Leadership Conclave</option><option>Workshop</option><option>Competition</option><option>Webinar</option></select></label>
          <label>Visibility<select name="scope"><option>Intra school</option><option>Inter school</option></select></label>
          <label>Format<select name="format"><option>In-person</option><option>Virtual</option><option>Hybrid</option></select></label>
          <label>Date<input name="date" type="date" required></label>
          <label>Registration deadline<input name="registrationDeadline" type="date"></label>
          <label>Start time<input name="startTime" type="time"></label>
          <label>End time<input name="endTime" type="time"></label>
          <label>Venue / link<input name="venue" type="text" value="School campus"></label>
          <label>Capacity<input name="capacity" type="number" min="1" value="100"></label>
          <label>Coordinator name<input name="coordinatorName" type="text"></label>
          <label>Coordinator email<input name="coordinatorEmail" type="email"></label>
          <label>Eligibility<input name="eligibility" type="text" value="Open to eligible member-school students"></label>
          <label>Registration fee<input name="fee" type="number" min="0" value="0"></label>
          <label class="wide-field">Form header image<input name="formHeaderImage" type="file" accept="image/*"></label>
          <label class="checkbox-line"><input name="paid" type="checkbox"> Paid entry</label>
          <label class="wide-field">Event description<textarea name="description" rows="4">Briefly describe the event, schedule, expectations, and materials required.</textarea></label>
        </div>
      </div>
      <div class="form-builder-section">
        <div class="form-builder-header">
          <div>
            <p class="eyebrow">Registration form</p>
            <h3>Questions students must complete</h3>
          </div>
          <div class="form-builder-actions">
            <button class="ghost-button add-question" type="button" data-type="short">Short answer</button>
            <button class="ghost-button add-question" type="button" data-type="multiple">Choice</button>
            <button class="ghost-button add-question" type="button" data-type="file">File upload</button>
          </div>
        </div>
        <div class="form-builder-questions"></div>
      </div>
      <button class="primary-button" type="submit">Publish event form</button>
    </form>
  `;
  renderQuestions();
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (clickEvent) => {
    const addButton = clickEvent.target.closest(".add-question");
    const removeButton = clickEvent.target.closest(".remove-question");
    if (clickEvent.target === overlay) overlay.remove();
    if (addButton) {
      const type = addButton.dataset.type;
      questions.push(normalizeEventQuestion({
        label: type === "file" ? "Upload supporting file" : "New question",
        type,
        options: type === "multiple" ? ["Option 1", "Option 2"] : [],
        accept: type === "file" ? "image/*,.pdf,.doc,.docx" : "",
        required: true
      }, questions.length));
      renderQuestions();
    }
    if (removeButton) {
      const questionCard = removeButton.closest(".form-builder-question");
      questions.splice(Number(questionCard.dataset.index), 1);
      renderQuestions();
    }
  });
  overlay.addEventListener("change", (changeEvent) => {
    const typeSelect = changeEvent.target.closest('select[name="questionType"]');
    if (!typeSelect) return;
    const questionCard = typeSelect.closest(".form-builder-question");
    questionCard.querySelector(".choice-options").classList.toggle("hidden", !["multiple", "checkboxes", "dropdown"].includes(typeSelect.value));
    questionCard.querySelector(".file-options").classList.toggle("hidden", typeSelect.value !== "file");
  });
  overlay.querySelector("form").addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const formData = new FormData(submitEvent.currentTarget);
    const registrationQuestions = [...overlay.querySelectorAll(".form-builder-question")].map((questionCard, index) => {
      const type = questionCard.querySelector('[name="questionType"]').value;
      return normalizeEventQuestion({
        id: `q-${Date.now()}-${index}`,
        label: questionCard.querySelector('[name="questionLabel"]').value.trim(),
        type,
        required: questionCard.querySelector('[name="questionRequired"]').checked,
        options: questionCard.querySelector('[name="questionOptions"]').value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        accept: questionCard.querySelector('[name="questionAccept"]').value
      }, index);
    }).filter((question) => question.label);
    const formHeaderImage = await fileToDataUrl(formData.get("formHeaderImage"));
    try {
      await api.create("events", {
        title: formData.get("title"),
        type: formData.get("type"),
        scope: formData.get("scope"),
        format: formData.get("format"),
        date: formData.get("date"),
        startTime: formData.get("startTime"),
        endTime: formData.get("endTime"),
        host: state.schools[0]?.name || "Yaara Consortium",
        venue: formData.get("venue"),
        capacity: formData.get("capacity"),
        fee: formData.get("fee"),
        eligibility: formData.get("eligibility"),
        registrationDeadline: formData.get("registrationDeadline"),
        coordinatorName: formData.get("coordinatorName"),
        coordinatorEmail: formData.get("coordinatorEmail"),
        description: formData.get("description"),
        paid: formData.get("paid") === "on",
        formHeaderImage,
        registrationQuestions
      });
      overlay.remove();
      showToast("Event form published. Students will complete it before registration.");
      await refresh();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.body.append(overlay);
};

document.querySelector("#eventButton").addEventListener("click", openEventBuilderModal);

const openEventRegistrationsModal = (eventId) => {
  const event = state.events.find((item) => item.id === eventId);
  const registrations = (state.eventRegistrations || []).filter((item) => item.eventId === eventId);
  const questions = eventQuestionsFor(event);
  const confirmed = registrations.filter((item) => item.status === "Confirmed").length;
  const pending = registrations.filter((item) => item.status === "Payment pending").length;
  const cancelled = registrations.filter((item) => item.status === "Cancelled").length;
  const answerValue = (registration, question) => {
    const value = registration.answers?.[question.label];
    return Array.isArray(value) ? value.join("; ") : value || "";
  };
  const exportRows = () => {
    const headers = ["Student", "Status", "Payment", "Files", ...questions.map((question) => question.label)];
    const rows = registrations.map((registration) => [
      registration.studentName,
      registration.status,
      registration.paymentStatus || "Not required",
      (registration.files || []).map((file) => file.name).join("; "),
      ...questions.map((question) => answerValue(registration, question))
    ]);
    return [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
      .join("\n");
  };
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <div class="modal-card responses-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">Form responses</p>
          <h2>${event?.title || "Event"} registrations</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      ${event?.formHeaderImage?.dataUrl ? `<img class="form-header-preview" src="${event.formHeaderImage.dataUrl}" alt="${escapeAttribute(event.title)} form header">` : ""}
      <div class="response-summary">
        <article><span>Total</span><strong>${registrations.length}</strong></article>
        <article><span>Confirmed</span><strong>${confirmed}</strong></article>
        <article><span>Payment pending</span><strong>${pending}</strong></article>
        <article><span>Cancelled</span><strong>${cancelled}</strong></article>
      </div>
      <div class="response-actions">
        <button class="primary-button export-responses" type="button">Download CSV / open in Sheets</button>
      </div>
      <div class="table-wrap">
        <table class="responses-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Files</th>
              ${questions.map((question) => `<th>${escapeAttribute(question.label)}</th>`).join("")}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${registrations.length ? registrations.map((registration) => `
              <tr>
                <td>${registration.studentName}</td>
                <td><span class="status-pill">${registration.status}</span></td>
                <td>${registration.paymentStatus || "Not required"}</td>
                <td>${registration.files?.length ? registration.files.map((file) => `<span class="file-chip">${escapeAttribute(file.name)}</span>`).join("") : "No files"}</td>
                ${questions.map((question) => `<td>${escapeAttribute(answerValue(registration, question))}</td>`).join("")}
                <td>
                  ${registration.status === "Payment pending" ? `<button class="ghost-button mark-event-paid" type="button" data-id="${registration.id}">Mark paid</button>` : ""}
                  ${registration.status === "Payment pending" ? `<button class="ghost-button cancel-event-registration" type="button" data-id="${registration.id}">Cancel unpaid</button>` : ""}
                  ${registration.status !== "Cancelled" && registration.status !== "Payment pending" ? `<button class="ghost-button cancel-event-registration" type="button" data-id="${registration.id}">Cancel</button>` : ""}
                </td>
              </tr>
            `).join("") : `<tr><td colspan="${5 + questions.length}">No registrations yet.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", async (eventClick) => {
    const markPaid = eventClick.target.closest(".mark-event-paid");
    const cancelRegistration = eventClick.target.closest(".cancel-event-registration");
    const exportResponses = eventClick.target.closest(".export-responses");
    if (exportResponses) {
      const blob = new Blob([exportRows()], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${(event?.title || "event").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-responses.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      showToast("Responses CSV downloaded. Open it in Excel or Google Sheets.");
    }
    if (markPaid) {
      await api.post(`/api/event-registrations/${markPaid.dataset.id}/mark-paid`);
      overlay.remove();
      showToast("Paid registration confirmed and seat counted.");
      await refresh();
    }
    if (cancelRegistration) {
      await api.post(`/api/event-registrations/${cancelRegistration.dataset.id}/cancel`);
      overlay.remove();
      showToast("Registration cancelled.");
      await refresh();
    }
  });
  document.body.append(overlay);
};

const studentQuestionInput = (question, index) => {
  const required = question.required ? "required" : "";
  if (question.type === "paragraph") {
    return `<textarea name="q${index}" rows="4" ${required}></textarea>`;
  }
  if (question.type === "multiple") {
    return `
      <div class="choice-list">
        ${(question.options?.length ? question.options : ["Yes", "No"]).map((option) => `
          <label class="checkbox-line"><input name="q${index}" type="radio" value="${escapeAttribute(option)}" ${required}> ${escapeAttribute(option)}</label>
        `).join("")}
      </div>
    `;
  }
  if (question.type === "checkboxes") {
    return `
      <div class="choice-list">
        ${(question.options?.length ? question.options : ["I agree"]).map((option) => `
          <label class="checkbox-line"><input name="q${index}" type="checkbox" value="${escapeAttribute(option)}"> ${escapeAttribute(option)}</label>
        `).join("")}
      </div>
    `;
  }
  if (question.type === "dropdown") {
    return `
      <select name="q${index}" ${required}>
        <option value="">Select an option</option>
        ${(question.options || []).map((option) => `<option value="${escapeAttribute(option)}">${escapeAttribute(option)}</option>`).join("")}
      </select>
    `;
  }
  if (question.type === "file") {
    return `<input name="q${index}" type="file" accept="${escapeAttribute(question.accept || "image/*,.pdf,.doc,.docx")}" ${required}>`;
  }
  return `<input name="q${index}" type="text" ${required}>`;
};

const openStudentEventRegistrationForm = (eventItem) => {
  const student = state.students[0];
  const questions = eventQuestionsFor(eventItem);
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <form class="modal-card">
      <div class="modal-heading">
        <h2>${eventItem.title}</h2>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      ${eventItem.formHeaderImage?.dataUrl ? `<img class="form-header-preview" src="${eventItem.formHeaderImage.dataUrl}" alt="${escapeAttribute(eventItem.title)} form header">` : ""}
      <p class="panel-copy">${eventItem.description || "Complete the registration form before submitting."}</p>
      <div class="modal-fields">
        <label>
          Student
          <input name="studentName" type="text" value="${student?.name || ""}" readonly>
        </label>
        <label>
          School
          <input name="schoolName" type="text" value="${state.schools[0]?.name || ""}" readonly>
        </label>
        ${questions.map((question, index) => `
          <label class="student-form-question">
            ${escapeAttribute(question.label)}${question.required ? " *" : ""}
            ${studentQuestionInput(question, index)}
          </label>
        `).join("")}
      </div>
      <button class="primary-button" type="submit">${eventItem.paid ? `Submit and continue to payment (${money(eventItem.fee || 0)})` : "Submit registration"}</button>
    </form>
  `;
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (clickEvent) => {
    if (clickEvent.target === overlay) overlay.remove();
  });
  overlay.querySelector("form").addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const formData = new FormData(submitEvent.currentTarget);
    const answers = {};
    const files = [];
    questions.forEach((question, index) => {
      if (question.type === "file") {
        const file = formData.get(`q${index}`);
        if (file?.name) {
          files.push({
            question: question.label,
            name: file.name,
            size: file.size,
            type: file.type || "unknown"
          });
          answers[question.label] = file.name;
        } else {
          answers[question.label] = "";
        }
        return;
      }
      if (question.type === "checkboxes") {
        answers[question.label] = formData.getAll(`q${index}`);
        return;
      }
      answers[question.label] = formData.get(`q${index}`) || "";
    });
    try {
      const registration = await api.create("event-registrations", {
        eventId: eventItem.id,
        answers,
        files
      });
      overlay.remove();
      showToast(registration.status === "Payment pending" ? "Form submitted. Payment pending before seat confirmation." : "Registration confirmed.");
      await refresh();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.body.append(overlay);
};

document.querySelector("#eventsGrid").addEventListener("click", async (event) => {
  const registerButton = event.target.closest(".register-event");
  const manageButton = event.target.closest(".manage-event");
  if (registerButton) {
    const eventItem = state.events.find((item) => item.id === registerButton.dataset.id);
    if (eventItem) openStudentEventRegistrationForm(eventItem);
  }
  if (manageButton) {
    openEventRegistrationsModal(manageButton.dataset.id);
  }
});

document.querySelector("#exchangeButton").addEventListener("click", () => {
  modal(
    "Post exchange slot",
    [
      { label: "Title", name: "title", required: true },
      { label: "Type", name: "type", type: "select", options: ["Teacher", "Student"] },
      { label: "Subject or grade", name: "subject", required: true },
      { label: "Duration", name: "duration", value: "5 days" },
      { label: "From school", name: "fromSchool", value: state.schools[0]?.name || "" }
    ],
    async (payload) => {
      await api.create("exchanges", payload);
      showToast("Exchange slot posted with Open status.");
    }
  );
});

document.querySelector("#vendorPreviewButton").addEventListener("click", () => {
  setView("vendors");
});

document.querySelector("#vendorApplyButton").addEventListener("click", () => {
  document.querySelector(".vendor-apply-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#vendorSignupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const status = form.querySelector(".form-status");
  try {
    await api.create("vendors", Object.fromEntries(formData.entries()));
    status.textContent = "Application submitted. Akshar Arbol admin will review and approve the listing.";
    await refresh();
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#payments").addEventListener("click", (event) => {
  const invoiceButton = event.target.closest(".invoice-action");
  if (invoiceButton) {
    const payment = state.payments.find((item) => item.id === invoiceButton.dataset.id);
    invoicePanel.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Invoice preview</p>
          <h2>Generated invoice</h2>
        </div>
      </div>
      ${invoiceMarkup(payment)}
      <button class="primary-button" id="downloadInvoiceButton" type="button">Download invoice</button>
    `;
  }

  if (event.target.closest("#downloadInvoiceButton")) {
    const invoiceText = invoicePanel.innerText;
    const blob = new Blob([invoiceText], { type: "text/plain" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "yaara-invoice.txt";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Invoice downloaded.");
  }
});

document.querySelector(".promotion-banner .ghost-button").addEventListener("click", () => {
  const promotion = state.promotions[0];
  showToast(promotion ? `${promotion.name}: ${promotion.placement} is ${promotion.status}.` : "No vendor promotions yet.");
});

syncSessionTimeoutControls();

if (getSessionValue(AUTH_STORAGE_KEY) === "true" && currentSession()?.id) {
  try {
    suppressSessionExpiryToast = true;
    setAuthenticated(true);
    roleSelect.value = currentRole();
    await refresh();
  } catch {
    setAuthenticated(false);
  } finally {
    suppressSessionExpiryToast = false;
  }
} else {
  setAuthenticated(false);
}
