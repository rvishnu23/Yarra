const SESSION_STORAGE_KEY = "yaara-session";
const USER_STORAGE_KEY = "yaara-user";
const AUTH_STORAGE_KEY = "yaara-authenticated";
const SESSION_TIMEOUT_STORAGE_KEY = "yaara-session-timeout-minutes";
const defaultTimeoutMinutes = 30;
let activeSession = null;

const getStoredJson = (key, fallback = {}) => {
  try {
    return JSON.parse(window.sessionStorage?.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
};

const setSessionValue = (key, value) => {
  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable in embedded preview modes.
  }
};

const getSessionValue = (key) => {
  try {
    return window.sessionStorage?.getItem(key) || null;
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
  } catch {
    // In-memory session still keeps the current tab authenticated.
  }
  updateSessionUi();
};

const updateSessionFromHeaders = (response) => {
  const session = currentSession();
  const expiresAt = response.headers.get("X-Session-Expires-At");
  const timeoutMinutes = response.headers.get("X-Session-Timeout-Minutes");
  if (!session || !expiresAt) return;
  storeSession({
    ...session,
    expiresAt,
    timeoutMinutes: Number(timeoutMinutes || session.timeoutMinutes)
  });
};

const handleResponse = async (response, fallbackError) => {
  const body = await response.json().catch(() => ({}));
  updateSessionFromHeaders(response);
  if (response.status === 401) {
    expireSession(body.error || "Your secure session has expired. Please sign in again.", { silent: suppressSessionExpiryToast });
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
    const response = await fetch(`/api/state?role=${encodeURIComponent(currentRole())}`);
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
  async post(path) {
    const response = await fetch(path, { method: "POST", headers: authHeaders(false) });
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
  "Super Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "library", "vendorSignup", "vendors", "profiles"],
  "School Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "library", "vendorSignup", "vendors", "profiles"],
  Teacher: ["dashboard", "events", "exchange", "library", "profiles"],
  Student: ["dashboard", "events", "exchange", "library"],
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

const currentRole = () => roleSelect?.value || getStoredJson(USER_STORAGE_KEY, {}).role || "School Admin";

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
const loginSessionTimeout = document.querySelector("#loginSessionTimeout");
const sessionTimeoutSelect = document.querySelector("#sessionTimeoutSelect");
const sessionStatus = document.querySelector("#sessionStatus");
const sessionWarning = document.querySelector("#sessionWarning");
const extendSessionButton = document.querySelector("#extendSessionButton");
const tutorialButton = document.querySelector("#tutorialButton");
const vendorCategory = document.querySelector("#vendorCategory");
const librarySearch = document.querySelector("#librarySearch");
const metricsGrid = document.querySelector(".metrics-grid");
const notificationButton = document.querySelector("#notificationButton");
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
  const stored = Number(window.localStorage?.getItem(SESSION_TIMEOUT_STORAGE_KEY));
  const fromControl = Number(sessionTimeoutSelect?.value || loginSessionTimeout?.value);
  const value = Number.isFinite(stored) && stored > 0 ? stored : fromControl || defaultTimeoutMinutes;
  return Math.min(240, Math.max(1, Math.round(value)));
}

function syncSessionTimeoutControls(value = selectedSessionTimeoutMinutes()) {
  try {
    window.localStorage?.setItem(SESSION_TIMEOUT_STORAGE_KEY, String(value));
  } catch {
    // Timeout selector still works for the current page lifecycle.
  }
  [loginSessionTimeout, sessionTimeoutSelect].forEach((control) => {
    if (!control) return;
    if (![...control.options].some((option) => option.value === String(value))) {
      control.add(new Option(`${value} min`, String(value)));
    }
    control.value = String(value);
  });
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
  const session = currentSession();
  if (!session?.expiresAt) {
    clearSessionClock();
    sessionStatus && (sessionStatus.textContent = "Session --");
    sessionStatus?.classList.remove("is-warning");
    sessionWarning?.classList.add("hidden");
    return;
  }

  const remainingMs = Date.parse(session.expiresAt) - Date.now();
  if (remainingMs <= 0) {
    expireSession("Your secure session expired. Please sign in again.");
    return;
  }

  const timeoutMs = Number(session.timeoutMinutes || selectedSessionTimeoutMinutes()) * 60 * 1000;
  const warningMs = Math.min(60 * 1000, Math.max(20 * 1000, Math.round(timeoutMs / 3)));
  const warning = remainingMs <= warningMs;

  if (sessionStatus) {
    sessionStatus.textContent = `Session ${formatRemaining(remainingMs)}`;
    sessionStatus.classList.toggle("is-warning", warning);
  }
  sessionWarning?.classList.toggle("hidden", !warning);

  if (!sessionClock) {
    sessionClock = window.setInterval(updateSessionUi, 1000);
  }
}

function clearStoredSession() {
  activeSession = null;
  clearSessionClock();
  try {
    window.sessionStorage?.removeItem(AUTH_STORAGE_KEY);
    window.sessionStorage?.removeItem(USER_STORAGE_KEY);
    window.sessionStorage?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Storage may be unavailable in embedded preview modes.
  }
  toast?.classList.remove("is-visible");
  toast && (toast.textContent = "");
  sessionStatus && (sessionStatus.textContent = "Session --");
  sessionStatus?.classList.remove("is-warning");
  sessionWarning?.classList.add("hidden");
}

function expireSession(message, { silent = false } = {}) {
  clearStoredSession();
  document.body.classList.remove("is-authenticated");
  clearPaymentOverlay();
  document.querySelectorAll(".modal-backdrop").forEach((modalBackdrop) => modalBackdrop.remove());
  if (!silent) showToast(message);
}

async function extendSecureSession({ notify = false } = {}) {
  if (!currentSession()?.id || sessionExtendInFlight) return;
  sessionExtendInFlight = true;
  try {
    await api.extendSession(selectedSessionTimeoutMinutes());
    if (notify) showToast("Secure session extended.");
  } catch (error) {
    showToast(error.message);
  } finally {
    sessionExtendInFlight = false;
  }
}

function recordSessionActivity() {
  if (!currentSession()?.id) return;
  const now = Date.now();
  if (now - lastSessionActivityAt < 30000) return;
  lastSessionActivityAt = now;
  extendSecureSession();
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
  const allowed = rolePermissions[role] || rolePermissions["School Admin"];
  navButtons.forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.view);
  });
  document.querySelector("#eventButton").hidden = !["Super Admin", "School Admin"].includes(role);
  document.querySelector("#paymentButton").hidden = !["Super Admin", "School Admin"].includes(role);
  document.querySelector("#studentButton").hidden = !["Super Admin", "School Admin"].includes(role);
  document.querySelector("#inviteStudentButton").hidden = !["Super Admin", "School Admin"].includes(role);
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

const renderMetrics = () => {
  const metrics = state.metrics;
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
    <article class="metric">
      <span>Revenue</span>
      <strong>${money(metrics.totalRevenue)}</strong>
      <p>Memberships, events, promotions</p>
    </article>
  `;
};

const renderDashboard = () => {
  document.querySelector(".dashboard-welcome h2").textContent = `${currentRole()} workspace`;
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
  document.querySelector("#eventsGrid").innerHTML = state.events.length
    ? state.events
        .map((event) =>
          cardTemplate({
            eyebrow: event.type,
            title: event.title,
            body: `${event.format} - ${event.date} - ${event.registered}/${event.capacity} seats booked. Hosted by ${event.host}.`,
            tags: [
              event.paid ? "Paid entry" : "Member access",
              event.recording ? "Recording" : "Live",
              event.materials ? "Materials" : "Materials pending"
            ],
            image: event.type === "Workshop" ? imageMap.workshop : imageMap.event,
            className: "project-card"
          })
        )
        .join("")
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

const renderLibrary = () => {
  const query = librarySearch.value.trim().toLowerCase();
  const filtered = state.content.filter((item) => {
    const matchesType = libraryFilter === "All" || item.type === libraryFilter;
    const haystack = `${item.title} ${item.type} ${item.speaker} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
    return matchesType && haystack.includes(query);
  });

  document.querySelector("#libraryGrid").innerHTML = filtered.length
    ? filtered
        .map((item) =>
          cardTemplate({
            eyebrow: item.type,
            title: item.title,
            body: `${item.speaker} - ${item.category}. ${item.comments} comments and ${item.saved} saves.`,
            tags: [...item.tags, item.restrictedToEarlyYears ? "Early Years only" : "All members"],
            image: item.type === "Podcast" ? imageMap.podcast : imageMap.content,
            className: "content-card"
          })
        )
        .join("")
    : `<article class="panel"><h3>No matching content</h3><p>Try another type, speaker, title, or tag.</p></article>`;
};

const renderVendors = () => {
  const category = vendorCategory.value;
  const filtered = state.vendors.filter((vendor) => category === "All categories" || vendor.category === category);

  document.querySelector("#vendorGrid").innerHTML = filtered.length
    ? filtered
        .map((vendor) =>
          cardTemplate({
            eyebrow: vendor.category,
            title: vendor.name,
            body: vendor.offer,
            tags: [vendor.status, vendor.featured ? "Featured" : "Standard", "Enquiry inbox"],
            image: imageMap.vendor,
            className: "vendor-card",
            action:
              vendor.status === "Approved" || currentRole() !== "Super Admin"
                ? ""
                : `<button class="ghost-button approve-vendor" type="button" data-id="${vendor.id}">Approve vendor</button>`
          })
        )
        .join("")
    : `<article class="panel"><h3>No vendors in this category yet</h3><p>New listings appear after admin approval.</p></article>`;
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
  renderLibrary();
  renderVendors();
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
  const timeoutMinutes = Number(formData.get("timeoutMinutes") || selectedSessionTimeoutMinutes());
  syncSessionTimeoutControls(timeoutMinutes);
  const authUser = await api.gmailLogin({
    email: formData.get("email"),
    role: formData.get("role"),
    timeoutMinutes
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
          <p>The secure Razorpay payment link has been sent to ${school.contact}. The payment URL is hidden here so the school completes payment from its own mailbox.</p>
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
    syncSessionTimeoutControls();
    const authUser = await api.gmailLogin({
      email: "vendor@gmail.com",
      role: "Vendor",
      timeoutMinutes: selectedSessionTimeoutMinutes()
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
    contact: formData.get("billingEmail") || "admin@school.edu",
    earlyYears: event.currentTarget.querySelector('input[type="checkbox"]').checked
  };
  const amount = Math.max(1, Number(formData.get("amount") || 1));
  try {
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
      formStatus.textContent = `Payment link sent to ${payload.contact}. You will get a notification when Razorpay confirms ${payload.name}'s payment.`;
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
      `${payload.name} membership payment recorded. School dashboard unlocked and invoice generated.`;
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
      { label: "Grade", name: "grade", type: "select", options: ["Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"] },
      { label: "Age", name: "age", type: "number", value: "13", required: true },
      { label: "Guardian email", name: "guardianEmail", type: "email", required: true }
    ],
    async (payload) => {
      await api.create("students", {
        ...payload,
        schoolId: state.schools[0]?.id
      });
      showToast("Student invitation created with age-gated access.");
    }
  );
};

document.querySelector("#studentButton").addEventListener("click", openStudentModal);
document.querySelector("#inviteStudentButton").addEventListener("click", openStudentModal);

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

roleSelect.addEventListener("change", async () => {
  try {
    closeTutorial();
    const authUser = await api.updateSessionRole(roleSelect.value);
    setSessionValue(USER_STORAGE_KEY, JSON.stringify(authUser));
    await refresh();
    showToast(`${roleSelect.value} permissions applied to this secure session.`);
  } catch (error) {
    showToast(error.message);
  }
});

[loginSessionTimeout, sessionTimeoutSelect].forEach((control) => {
  control?.addEventListener("change", async () => {
    const value = Number(control.value || defaultTimeoutMinutes);
    syncSessionTimeoutControls(value);
    if (currentSession()?.id) {
      await extendSecureSession({ notify: true });
    }
  });
});

extendSessionButton?.addEventListener("click", () => extendSecureSession({ notify: true }));

["click", "keydown", "pointerdown", "touchstart"].forEach((eventName) => {
  window.addEventListener(eventName, recordSessionActivity, { passive: true });
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

document.querySelector("#eventButton").addEventListener("click", () => {
  modal(
    "Create event",
    [
      { label: "Title", name: "title", required: true },
      { label: "Type", name: "type", type: "select", options: ["Leadership Conclave", "Workshop", "Competition", "Webinar"] },
      { label: "Format", name: "format", type: "select", options: ["In-person", "Virtual", "Hybrid"] },
      { label: "Date", name: "date", type: "date", required: true },
      { label: "Host", name: "host", value: "Yaara Consortium" },
      { label: "Capacity", name: "capacity", type: "number", value: "100" },
      { label: "Paid entry", name: "paid", type: "checkbox" }
    ],
    async (payload) => {
      await api.create("events", payload);
      showToast("Event created and registration tracking is live.");
    }
  );
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

document.querySelector("#vendorGrid").addEventListener("click", async (event) => {
  const button = event.target.closest(".approve-vendor");
  if (!button) return;
  await api.post(`/api/vendors/${button.dataset.id}/approve`);
  showToast("Vendor approved and published to the directory.");
  await refresh();
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
    expireSession("Your secure session expired. Please sign in again.", { silent: true });
  } finally {
    suppressSessionExpiryToast = false;
  }
} else {
  setAuthenticated(false);
}
