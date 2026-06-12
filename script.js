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
  async update(path, payload) {
    const response = await fetch(path, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    });
    return handleResponse(response, "Update failed");
  },
  async delete(path) {
    const response = await fetch(path, {
      method: "DELETE",
      headers: authHeaders(false)
    });
    return handleResponse(response, "Delete failed");
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
  "Super Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "events", "exchange", "library", "vendorSignup", "vendors", "schoolNetwork"],
  "School Admin": ["dashboard", "userManagement", "schoolDashboard", "payments", "events", "exchange", "library", "vendors", "schoolNetwork"],
  Teacher: ["dashboard", "events", "exchange", "library", "vendors", "schoolNetwork"],
  Student: ["dashboard", "events", "exchange", "library", "schoolNetwork"],
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
    goal: "Download roster templates, validate Excel files, preview errors, and commit student or staff users.",
    challenge: "Pick Student Database or Staff Database, then inspect the validate and upload history panels.",
    target: "#userManagement .upload-engine-grid",
    actions: ["Choose Staff Database or Student Database.", "Click Download Template before preparing Excel.", "Use Validate Upload first; Commit users appears only when validation passes.", "Check Upload history after every commit."]
  },
  schoolDashboard: {
    title: "School dashboard",
    goal: "Review membership, school summary, invoices, events, and student invitations.",
    challenge: "Find where membership status and recent invoices will appear after onboarding.",
    target: "#schoolDashboard .school-dashboard-grid",
    actions: ["Review school summary and student count.", "Check membership status and renewal area.", "Use User management to onboard learners.", "Recent invoices appear in the finance panel."]
  },
  onboarding: {
    title: "School onboarding",
    goal: "Register a school and start membership activation through Razorpay or UPI.",
    challenge: "Look through school details, board affiliation, school type, and payment amount.",
    target: "#schoolForm",
    actions: ["Enter the real school name and billing email.", "Select board affiliation and school type.", "Set the membership fee, then collect the school's payment."]
  },
  payments: {
    title: "Payments and invoices",
    goal: "Record payments and review transaction history.",
    challenge: "Open the payment form and identify invoice, amount, status, and method fields.",
    target: "#payments .section-bar",
    actions: ["Click Record payment to add an offline or manual payment.", "Review invoice number, school, amount, and status."]
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
    goal: "Create, verify, match, coordinate, and close teacher or student exchanges.",
    challenge: "Scan the full exchange lifecycle from Draft to Feedback Submitted.",
    target: "#exchange .kanban",
    actions: ["Create a draft exchange request.", "Submit it for Yarra approval.", "Track applications, school approvals, coordination messages, activity updates, completion, and feedback."]
  },
  library: {
    title: "Content library",
    goal: "Search and filter workshops, podcasts, webinars, and articles.",
    challenge: "Try the search box and filter chips, then review member content by format.",
    target: "#library .section-bar",
    actions: ["Search by title, speaker, or tag.", "Use filter chips for workshops, podcasts, articles, and webinars.", "Review content by audience and age range."]
  },
  vendorSignup: {
    title: "Vendor sign-up",
    goal: "Submit a vendor application and wait for Super Admin approval before marketplace access opens.",
    challenge: "Review the three steps, submit the vendor details form, and note that products are blocked until approval.",
    target: "#vendorSignup .vendor-hero",
    actions: ["Read Apply, Get approved, and Sell to schools.", "Use Start application.", "Submit company details for Super Admin review.", "After submission, stay on this page until approval is granted."]
  },
  vendors: {
    title: "Vendor marketplace",
    goal: "Review vendors, approve listings, manage products, and track school requests.",
    challenge: "Super Admin approves pending vendors and products; schools request products; approved vendors respond and deliver.",
    target: "#vendors .section-bar",
    actions: ["Super Admin reviews pending vendors and clicks Approve vendor.", "Super Admin approves vendor products before schools see them.", "Schools send product requests and payment links.", "Approved vendors reply, confirm payment, and move paid requests to Delivered."]
  },
  schoolNetwork: {
    title: "School Network",
    goal: "Browse the public member-school directory across Yarra.",
    challenge: "Find active schools and compare board, city, and key offerings.",
    target: "#schoolNetwork .section-bar",
    actions: ["Open School Network.", "Review member-school cards.", "Compare board, city, type, and achievements."]
  }
};

const tutorialRoleIntro = {
  "Super Admin": "You are learning every control: schools, users, payments, vendors, content, events, and moderation-ready workflows.",
  "School Admin": "You are learning the school operating path: onboarding, dashboards, rosters, payments, students, events, and content.",
  Teacher: "You are learning the educator path: events, exchanges, content, and the school network.",
  Student: "You are learning the student path: safe events, exchange options, content, and the school network.",
  Vendor: "You are learning the vendor path: apply first, wait for Yarra approval, then add products and respond to school requests."
};

const tutorialIntroForRole = (role = currentRole()) => {
  if (role === "Vendor" && !isApprovedVendor()) {
    return "You are in vendor applicant mode: submit your application and wait for Super Admin approval before dashboard or marketplace access opens.";
  }
  return tutorialRoleIntro[role] || tutorialRoleIntro["School Admin"];
};

const currentRole = () => currentSession()?.role || getStoredJson(USER_STORAGE_KEY, {}).role || roleSelect?.value || "School Admin";

const vendorApprovalStatus = () => {
  if (currentRole() !== "Vendor") return "Approved";
  const session = currentSession() || {};
  const email = String(session.email || "").toLowerCase();
  const vendor = (state.vendors || []).find((item) => item.id === session.vendorId || String(item.contact || "").toLowerCase() === email);
  if (vendor?.status) return vendor.status;
  if (session.vendorApplicant) return "Pending approval";
  return vendor?.status || session.vendorStatus || "Pending approval";
};

const isApprovedVendor = () => currentRole() !== "Vendor" || vendorApprovalStatus() === "Approved";

const allowedViewsForRole = (role = currentRole()) => {
  if (role === "Vendor" && !isApprovedVendor()) return ["vendorSignup"];
  return rolePermissions[role] || rolePermissions["School Admin"];
};

const authHeaders = (json = true) => ({
  ...(json ? { "Content-Type": "application/json" } : {}),
  "X-User-Role": currentRole(),
  ...(currentSession()?.email ? { "X-User-Email": currentSession().email } : {}),
  ...(currentSession()?.id ? { "X-Session-Id": currentSession().id } : {}),
  "X-Session-Timeout-Minutes": String(selectedSessionTimeoutMinutes())
});

const navButtons = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const toast = document.querySelector("#toast");
const loginForm = document.querySelector("#loginForm");
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
const libraryCategoryFilter = document.querySelector("#libraryCategoryFilter");
const libraryAudienceFilter = document.querySelector("#libraryAudienceFilter");
const librarySort = document.querySelector("#librarySort");
const metricsGrid = document.querySelector(".metrics-grid");
const notificationButton = document.querySelector("#notificationButton");
const contentPostButton = document.querySelector("#contentPostButton");
const paymentPanel = document.querySelector(".payment-panel");
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
let libraryCategory = "All";
let libraryAudience = "All";
let librarySortMode = "latest";
let marketTab = "products";
let marketVendorFilter = "All";
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
  const allowed = allowedViewsForRole();
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
  if (window.location.hash !== `#${viewId}`) {
    window.history.replaceState(null, "", `#${viewId}`);
  }
};

const requestedView = () => window.location.hash.replace("#", "") || "dashboard";

const tutorialStepsForRole = (role = currentRole()) => {
  const allowed = allowedViewsForRole(role);
  return [
    {
      type: "intro",
      view: allowed[0],
      title: `${role} training quest`,
      goal: tutorialIntroForRole(role),
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

const canManageContent = () => ["Super Admin", "School Admin"].includes(currentRole());

const contentAudience = (item) =>
  Array.isArray(item.audience) && item.audience.length ? item.audience : ["School Admin", "Teacher", "Student"];

const contentAudienceText = (item) => contentAudience(item).join(", ");

const normalizeContent = (item) => ({
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
  mediaUrl: item.mediaUrl || "",
  attachmentUrl: item.attachmentUrl || "",
  thumbnailUrl: item.thumbnailUrl || item.mediaUrl || "",
  audience: contentAudience(item),
  minAge: Number(item.minAge || 5),
  maxAge: Number(item.maxAge || 18),
  commentThreads: Array.isArray(item.commentThreads) ? item.commentThreads : []
});

const normalizedContentList = () => (state.content || []).map(normalizeContent);

const isOwnContent = (item) => Boolean(currentRole() === "School Admin" && item.schoolId && item.schoolId === currentSession()?.schoolId);

const canAlterContent = (item) => Boolean(item && (currentRole() === "Super Admin" || isOwnContent(item)));

const contentMediaMarkup = (item, compact = false) => {
  const media = item.thumbnailUrl || (item.type === "Podcast" ? imageMap.podcast : imageMap.content);
  const mediaUrl = item.mediaUrl || "";
  const escapedMediaUrl = escapeAttribute(mediaUrl);
  if (item.type === "Podcast" && mediaUrl.match(/\.(mp3|wav|ogg)(\?|$)/i)) {
    return `<div class="podcast-preview"><span>Audio</span><audio controls src="${escapedMediaUrl}"></audio></div>`;
  }
  if (["Video", "Short", "Recorded Workshop", "Webinar"].includes(item.type) && mediaUrl.match(/\.(mp4|webm|ogg)(\?|$)/i)) {
    return `<div class="post-media video-shell"><video controls src="${escapedMediaUrl}" poster="${escapeAttribute(media)}"></video></div>`;
  }
  if (item.type === "Article") {
    return `<div class="article-preview"><h4>${escapeAttribute(item.title)}</h4><p>${escapeAttribute(item.body || "Article summary will appear here.")}</p></div>`;
  }
  if (item.type === "Podcast") {
    return `<div class="podcast-preview"><span>Audio</span><p>${escapeAttribute(item.body || "Podcast episode")}</p>${mediaUrl ? `<a href="${escapedMediaUrl}" target="_blank" rel="noreferrer">Open audio link</a>` : ""}</div>`;
  }
  return `
    <div class="post-media ${["Video", "Short", "Recorded Workshop", "Webinar"].includes(item.type) ? "video-shell" : ""}">
      <img src="${escapeAttribute(media)}" alt="">
      ${["Video", "Short", "Recorded Workshop", "Webinar"].includes(item.type) ? `<span>${compact ? item.type : "Open media"}</span>` : ""}
    </div>
    ${mediaUrl && !compact ? `<a class="media-link" href="${escapedMediaUrl}" target="_blank" rel="noreferrer">Open media or recording</a>` : ""}
  `;
};

const applyRolePermissions = () => {
  const role = currentRole();
  if (roleSelect && roleSelect.value !== role) roleSelect.value = role;
  const allowed = allowedViewsForRole(role);
  navButtons.forEach((button) => {
    button.hidden = !allowed.includes(button.dataset.view);
  });
  const eventButton = document.querySelector("#eventButton");
  const paymentButton = document.querySelector("#paymentButton");
  const exchangeButton = document.querySelector("#exchangeButton");
  const membershipCard = document.querySelector(".membership-card");
  if (eventButton) eventButton.hidden = !["Super Admin", "School Admin", "Teacher"].includes(role);
  if (paymentButton) paymentButton.hidden = !["Super Admin", "School Admin"].includes(role);
  if (contentPostButton) contentPostButton.hidden = !canManageContent();
  if (vendorProductButton) vendorProductButton.hidden = currentRole() !== "Vendor" || !isApprovedVendor();
  if (marketCartButton) marketCartButton.hidden = currentRole() === "Vendor";
  if (exchangeButton) exchangeButton.hidden = role === "Vendor";
  if (membershipCard) membershipCard.hidden = role === "Vendor";

  const activeView = document.querySelector(".view.is-active")?.id || allowed[0];
  if (!allowed.includes(activeView)) {
    setView(allowed[0]);
  }
};

const tagList = (tags) => `
  <div class="tag-row">
    ${tags.map((tag) => `<span class="tag">${escapeAttribute(tag)}</span>`).join("")}
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
      <span>Students</span>
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

const canManageEvent = (event) =>
  Boolean(
    event &&
      ["Super Admin", "School Admin"].includes(currentRole()) &&
      (currentRole() === "Super Admin" || event.schoolId === currentSession()?.schoolId)
  );

const currentSchool = () => state.schools[0] || null;

const exchangeOwnerName = (exchange) => exchange.fromSchool || schoolName(exchange.fromSchoolId);

const isOwnExchange = (exchange) => {
  const school = currentSchool();
  if (currentRole() === "Super Admin") return true;
  return Boolean(school && (exchange.fromSchoolId === school.id || exchange.fromSchool === school.name));
};

const canAlterExchange = (exchange) => Boolean(exchange && (currentRole() === "Super Admin" || isOwnExchange(exchange)));

const exchangeStatuses = [
  "Draft",
  "Pending Yarra Approval",
  "Open",
  "Applied",
  "School Review",
  "Matched",
  "Ongoing",
  "Completed",
  "Feedback Submitted"
];

const exchangeStatusCopy = {
  Draft: "Created by the hosting school before it is sent to Yarra.",
  "Pending Yarra Approval": "Yarra verifies safety, suitability, and completeness.",
  Open: "Visible to other schools for applications.",
  Applied: "Another school has applied with participant details and reason.",
  "School Review": "Both school admins must approve the match.",
  Matched: "Both schools approved. School admins can coordinate here.",
  Ongoing: "Schools record attendance and activity updates.",
  Completed: "Exchange finished. Both schools submit report and feedback.",
  "Feedback Submitted": "Completion report, outcomes, and feedback are stored."
};

const canReviewExchange = (exchange) =>
  Boolean(currentRole() === "School Admin" && currentSchool() && !isOwnExchange(exchange) && exchange.status === "Open");

const canProgressExchange = (exchange) =>
  Boolean(
    currentRole() === "Super Admin" ||
      (currentRole() === "School Admin" &&
        currentSchool() &&
        (isOwnExchange(exchange) || exchange.reviewSchoolId === currentSchool().id))
  );

const canApproveExchangeMatch = (exchange) =>
  Boolean(
    exchange &&
      ["Applied", "School Review"].includes(exchange.status) &&
      (currentRole() === "Super Admin" ||
        (currentRole() === "School Admin" && currentSchool() && [exchange.fromSchoolId, exchange.reviewSchoolId].includes(currentSchool().id)))
  );

const exchangeApprovalLabel = (exchange) => {
  const approvals = exchange.approvals || {};
  const owner = approvals[exchange.fromSchoolId] ? "host approved" : "host pending";
  const reviewer = exchange.reviewSchoolId ? (approvals[exchange.reviewSchoolId] ? "applicant approved" : "applicant pending") : "no applicant";
  return `${owner} - ${reviewer}`;
};

const exchangeNextStatus = (exchange) => {
  const transitions = {
    Draft: "Pending Yarra Approval",
    "Pending Yarra Approval": "Open",
    Matched: "Ongoing",
    Ongoing: "Completed",
    Completed: "Feedback Submitted"
  };
  return transitions[exchange.status];
};

const canMoveExchange = (exchange, nextStatus) => {
  if (!nextStatus) return false;
  if (nextStatus === "Open") return currentRole() === "Super Admin";
  return canProgressExchange(exchange);
};

const canCoordinateExchange = (exchange) =>
  Boolean(
    exchange &&
      ["Matched", "Ongoing", "Completed", "Feedback Submitted"].includes(exchange.status) &&
      (currentRole() === "Super Admin" ||
        (currentRole() === "School Admin" && currentSchool() && [exchange.fromSchoolId, exchange.reviewSchoolId].includes(currentSchool().id)))
  );

const schoolDeletionSummary = (school) => {
  const eventIds = (state.events || [])
    .filter((event) => event.schoolId === school.id || event.host === school.name)
    .map((event) => event.id);
  return {
    users: (state.users || []).filter((user) => user.schoolId === school.id).length,
    students: (state.students || []).filter((student) => student.schoolId === school.id).length,
    staff: (state.teachers || []).filter((teacher) => teacher.schoolId === school.id).length,
    payments: (state.payments || []).filter((payment) => payment.schoolId === school.id).length,
    events: eventIds.length,
    registrations: (state.eventRegistrations || []).filter((registration) => registration.schoolId === school.id || eventIds.includes(registration.eventId)).length,
    content: (state.content || []).filter((item) => item.schoolId === school.id).length,
    exchanges: (state.exchanges || []).filter((exchange) => exchange.schoolId === school.id || exchange.fromSchool === school.name).length,
    orders: (state.marketOrders || []).filter((order) => order.schoolId === school.id).length
  };
};

const renderSchoolDeletePanel = () => {
  const panel = document.querySelector(".school-delete-panel");
  if (!panel) return;
  if (currentRole() !== "Super Admin") {
    panel.hidden = true;
    panel.innerHTML = "";
    return;
  }
  panel.hidden = false;
  const schools = state.schools || [];
  panel.innerHTML = `
    <p class="eyebrow">Super Admin data control</p>
    <h2>Delete school and linked data</h2>
    <p class="panel-copy">Use this only for mistaken/test schools. The delete removes the school ID and linked local records.</p>
    <div class="compact-list school-delete-list">
      ${schools.length ? schools.map((school) => {
        const counts = schoolDeletionSummary(school);
        const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
        return `
          <article>
            <strong>${school.name}</strong>
            <span>Admin mail: ${school.contact || "Not added"}</span>
            <span>Linked records: ${total} (${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")})</span>
            <button class="ghost-button delete-school-button" type="button" data-id="${school.id}" data-name="${escapeAttribute(school.name)}">Delete school</button>
          </article>
        `;
      }).join("") : `<article><strong>No schools</strong><span>There are no school records to delete.</span></article>`}
    </div>
  `;
};

const renderSchoolDashboard = () => {
  const school = state.schools[0];
  if (!school) {
    document.querySelector(".school-summary-panel").innerHTML = `<p class="eyebrow">No school yet</p><h2>Add your first school</h2><p class="panel-copy">Use School onboarding to create the first Yarra member school.</p>`;
    document.querySelector(".school-membership-panel").innerHTML = `<p class="eyebrow">Membership</p><h2>Not started</h2><p class="panel-copy">Membership details appear after onboarding.</p>`;
    document.querySelector(".school-events-panel").innerHTML = `<p class="eyebrow">Upcoming</p><h2>No events yet</h2>`;
    document.querySelector(".school-invoices-panel").innerHTML = `<p class="eyebrow">Finance</p><h2>No invoices yet</h2>`;
    renderSchoolDeletePanel();
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
      <article><strong>${school.type || "K-12"}</strong><span>School type</span></article>
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

  renderSchoolDeletePanel();
};

document.querySelector("#schoolDashboard").addEventListener("click", async (event) => {
  const deleteButton = event.target.closest(".delete-school-button");
  if (!deleteButton) return;
  const schoolId = deleteButton.dataset.id;
  const school = (state.schools || []).find((item) => item.id === schoolId);
  if (!school) return;
  deleteButton.disabled = true;
  try {
    const result = await api.delete(`/api/schools/${school.id}`);
    const totalRemoved = Object.values(result.removed || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    showToast(`${school.name} deleted. ${totalRemoved} linked records removed.`);
    try {
      await refresh();
    } catch (refreshError) {
      console.warn(refreshError);
      window.setTimeout(() => window.location.reload(), 700);
    }
  } catch (error) {
    showToast(error.message || "School delete failed.");
  } finally {
    deleteButton.disabled = false;
  }
});

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
              ${canManageEvent(event) ? `<button class="ghost-button manage-event" type="button" data-id="${event.id}">Manage registrations</button>` : ""}
              ${canManageEvent(event) ? `<button class="ghost-button edit-event" type="button" data-id="${event.id}">Edit</button>` : ""}
              ${canManageEvent(event) ? `<button class="ghost-button delete-event" type="button" data-id="${event.id}">Delete</button>` : ""}
            `
          })
        )
        .join("")}
      `
    : `<article class="panel"><h3>No events yet</h3><p>Create the first Yarra event when you are ready.</p></article>`;
};

const renderExchange = () => {
  document.querySelector(".kanban").innerHTML = exchangeStatuses
    .map((status) => {
      const items = state.exchanges.filter((exchange) => exchange.status === status && exchange.title);
      return `
        <section>
          <h3>${status}</h3>
          <p>${exchangeStatusCopy[status]}</p>
          ${
            items.length
              ? items
                  .map(
                    (exchange) => {
                      const nextStatus = exchangeNextStatus(exchange);
                      return `
                      <article data-id="${exchange.id}">
                        <strong>${escapeAttribute(exchange.title || "Untitled exchange request")}</strong>
                        <span>${exchange.type || "Exchange"} - ${exchange.subject || "Subject pending"} - Grade ${exchange.grade || "any"} - ${exchange.duration || "Duration pending"}</span>
                        <span>${exchange.dateRange || "Dates pending"} - ${exchange.mode || "Mode pending"}${exchange.location ? ` - ${exchange.location}` : ""}</span>
                        <span>Objective: ${exchange.objective || "Objective pending"}</span>
                        <span>Capacity: ${exchange.capacity || "Not set"} - From ${exchangeOwnerName(exchange)}${exchange.reviewSchool ? ` - Applicant: ${exchange.reviewSchool}` : ""}</span>
                        ${["Applied", "School Review", "Matched"].includes(exchange.status) ? `<span>${exchangeApprovalLabel(exchange)}</span>` : ""}
                        ${exchange.participants ? `<span>Participants: ${exchange.participants}</span>` : ""}
                        ${exchange.contactPerson ? `<span>Contact: ${exchange.contactPerson}</span>` : ""}
                        ${
                          exchange.messages?.length
                            ? `<div class="exchange-messages">${exchange.messages
                                .slice(-3)
                                .map((message) => `<p><strong>${escapeAttribute(message.school || message.author || "School")}</strong>: ${escapeAttribute(message.message)}</p>`)
                                .join("")}</div>`
                            : canCoordinateExchange(exchange)
                              ? `<span>No coordination messages yet.</span>`
                              : ""
                        }
                        ${exchange.activityUpdates?.length ? `<span>Latest update: ${exchange.activityUpdates.at(-1).note}</span>` : ""}
                        ${exchange.feedback?.length ? `<span>Feedback: ${exchange.feedback.at(-1).notes}</span>` : ""}
                        <div class="kanban-actions">
                          ${canReviewExchange(exchange) ? `<button class="primary-button review-exchange" type="button" data-id="${exchange.id}">Apply from ${currentSchool()?.name}</button>` : ""}
                          ${canApproveExchangeMatch(exchange) ? `<button class="primary-button approve-exchange" type="button" data-id="${exchange.id}">Approve match</button>` : ""}
                          ${canCoordinateExchange(exchange) ? `<button class="primary-button message-exchange" type="button" data-id="${exchange.id}">Message</button>` : ""}
                          ${nextStatus && canMoveExchange(exchange, nextStatus) ? `<button class="ghost-button progress-exchange" type="button" data-id="${exchange.id}" data-status="${nextStatus}">${nextStatus === "Open" ? "Approve by Yarra" : `Move to ${nextStatus}`}</button>` : ""}
                          ${canAlterExchange(exchange) ? `<button class="ghost-button edit-exchange" type="button" data-id="${exchange.id}">Edit</button>` : ""}
                          ${canAlterExchange(exchange) ? `<button class="ghost-button delete-exchange" type="button" data-id="${exchange.id}">Delete</button>` : ""}
                          ${currentRole() === "School Admin" && exchange.status === "Draft" && isOwnExchange(exchange) ? `<span>Submit to Yarra when ready</span>` : ""}
                          ${currentRole() === "School Admin" && exchange.status === "Open" && isOwnExchange(exchange) ? `<span>Waiting for another school to apply</span>` : ""}
                        </div>
                      </article>
                    `;
                    }
                  )
                  .join("")
              : `<article>No items yet <span>${exchangeStatusCopy[status]}</span></article>`
          }
        </section>
      `;
    })
    .join("");
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
          <p>${school.type || "School type pending"} member profile.</p>
          <div class="tag-list">
            ${(school.achievements || ["Profile setup pending"]).map((item) => `<span>${item}</span>`).join("")}
          </div>
        </article>
      `).join("")
    : `<article class="panel"><h3>No schools yet</h3><p>Member-school cards appear here after onboarding and payment confirmation.</p></article>`;
};

const renderLibrary = () => {
  const query = librarySearch.value.trim().toLowerCase();
  const canInteract = canManageContent();
  const normalizedContent = normalizedContentList();
  const categories = ["All", ...new Set(normalizedContent.map((item) => item.category).filter(Boolean).sort())];
  if (libraryCategoryFilter) {
    libraryCategoryFilter.innerHTML = categories.map((category) => `<option value="${escapeAttribute(category)}">${category === "All" ? "All categories" : escapeAttribute(category)}</option>`).join("");
    libraryCategoryFilter.value = categories.includes(libraryCategory) ? libraryCategory : "All";
  }
  const filtered = normalizedContent.filter((item) => {
    const matchesType = libraryFilter === "All" || item.type === libraryFilter;
    const matchesCategory = libraryCategory === "All" || item.category === libraryCategory;
    const matchesAudience = libraryAudience === "All" || item.audience.includes(libraryAudience);
    const haystack = `${item.title} ${item.type} ${item.speaker} ${item.category} ${item.body} ${item.tags.join(" ")}`.toLowerCase();
    return matchesType && matchesCategory && matchesAudience && haystack.includes(query);
  });
  filtered.sort((a, b) => {
    if (librarySortMode === "popular") return b.views - a.views;
    if (librarySortMode === "saved") return b.saved - a.saved;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  const stories = normalizedContent.filter((item) => item.type === "Story").slice(0, 12);
  const totalViews = filtered.reduce((sum, item) => sum + item.views, 0);
  const totalSaves = filtered.reduce((sum, item) => sum + item.saved, 0);

  document.querySelector("#libraryInsights").innerHTML = `
    <article><strong>${filtered.length}</strong><span>visible posts</span></article>
    <article><strong>${totalViews}</strong><span>views in this filter</span></article>
    <article><strong>${totalSaves}</strong><span>saves in this filter</span></article>
    <article><strong>${new Set(filtered.map((item) => item.category)).size}</strong><span>active categories</span></article>
  `;

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
          return `
            <article class="social-post ${isShort ? "is-short" : ""}" data-id="${item.id}">
              <div class="post-topline">
                <div>
                  <p class="eyebrow">${escapeAttribute(item.type)}</p>
                  <h3>${escapeAttribute(item.title)}</h3>
                  <span>${escapeAttribute(item.speaker)} - ${escapeAttribute(item.category)}</span>
                </div>
                <strong>${item.views} views</strong>
              </div>
              ${contentMediaMarkup(item, true)}
              <p class="post-copy">${escapeAttribute(item.body || "Shared with the Yarra community.")}</p>
              ${tagList([...item.tags, `Visible to: ${contentAudienceText(item)}`, `Ages ${item.minAge}-${item.maxAge}`])}
              ${canInteract ? `
                <div class="post-actions">
                  <button class="ghost-button open-content-detail" type="button" data-id="${item.id}">View details</button>
                  <button class="ghost-button content-like" type="button" data-id="${item.id}">Like ${item.likes}</button>
                  <button class="ghost-button content-comment" type="button" data-id="${item.id}">Comment ${item.comments}</button>
                  <button class="ghost-button content-save" type="button" data-id="${item.id}">Save ${item.saved}</button>
                  ${canAlterContent(item) ? `<button class="ghost-button edit-content" type="button" data-id="${item.id}">Edit</button><button class="ghost-button danger-button delete-content" type="button" data-id="${item.id}">Delete</button>` : ""}
                </div>
              ` : `<button class="ghost-button open-content-detail" type="button" data-id="${item.id}">View details</button>`}
              ${item.commentThreads?.length ? `
                <div class="comment-preview">
                  ${item.commentThreads.slice(0, 2).map((comment) => `<p><strong>${escapeAttribute(comment.author)}</strong> ${escapeAttribute(comment.text)}</p>`).join("")}
                </div>
              ` : ""}
            </article>
          `;
        })
        .join("")
    : `<article class="panel"><h3>No matching content</h3><p>Try another type, speaker, title, or tag.</p></article>`;
};

const canAdvanceMarketOrder = (order) => {
  if (currentRole() === "Super Admin") return order.status !== "Closed";
  if (currentRole() === "Vendor") return ["RFQ Submitted", "Paid"].includes(order.status);
  if (currentRole() === "School Admin") return ["Quote Sent", "Delivered"].includes(order.status);
  return false;
};

const renderVendors = () => {
  const category = vendorCategory.value;
  const vendors = (state.vendors || []).filter((vendor) => category === "All categories" || vendor.category === category);
  const vendorName = (id) => (state.vendors || []).find((vendor) => vendor.id === id)?.name || "Vendor";
  const products = (state.vendorProducts || []).filter((product) => {
    const vendor = (state.vendors || []).find((item) => item.id === product.vendorId);
    const matchesCategory = category === "All categories" || product.category === category || vendor?.category === category;
    const matchesVendor = marketVendorFilter === "All" || product.vendorId === marketVendorFilter;
    const visibleStatus = currentRole() === "Super Admin" || currentRole() === "Vendor" || ["Active", "Approved"].includes(product.status || "Active");
    return matchesCategory && matchesVendor && visibleStatus;
  });
  const orders = state.marketOrders || [];
  const vendorStats = {
    vendors: vendors.length,
    products: products.length,
    pendingProducts: (state.vendorProducts || []).filter((product) => product.status === "Pending approval").length,
    orders: orders.length
  };

  if (marketCartButton) marketCartButton.textContent = `Request ${marketCart.reduce((sum, item) => sum + item.quantity, 0)}`;
  document.querySelectorAll(".market-tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.marketTab === marketTab));
  const existingInsights = document.querySelector("#marketInsights");
  if (existingInsights) {
    existingInsights.innerHTML = `
      <article><strong>${vendorStats.vendors}</strong><span>vendors</span></article>
      <article><strong>${vendorStats.products}</strong><span>products</span></article>
      <article><strong>${vendorStats.pendingProducts}</strong><span>waiting approval</span></article>
      <article><strong>${vendorStats.orders}</strong><span>school requests</span></article>
    `;
  }
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
    : `<article><strong>No requests yet</strong><span>School product requests will appear here.</span></article>`;

  if (marketTab === "vendors") {
    document.querySelector("#marketGrid").innerHTML = vendors.length
      ? vendors
          .map((vendor) =>
            cardTemplate({
              eyebrow: vendor.category,
              title: vendor.name,
              body: vendor.offer,
              tags: [vendor.status, vendor.featured ? "Featured" : "Standard"],
              image: imageMap.vendor,
              className: "vendor-card",
              action:
                vendor.status === "Approved" || currentRole() !== "Super Admin"
                  ? `<button class="ghost-button view-seller-products" type="button" data-id="${vendor.id}">See products</button>`
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
              <p>${order.buyerName || order.buyerRole} - ${money(order.total || 0)} - ${order.paymentStatus || "Payment pending after approval"}</p>
              <ol class="order-steps">
                ${["RFQ Submitted", "Quote Sent", "Approved by School", "Paid", "Delivered", "Closed"].map((step) => `<li class="${order.tracking?.includes(step) || order.status === step ? "done" : ""}">${step}</li>`).join("")}
              </ol>
              <div class="compact-list">
                ${(order.items || []).map((item) => `<article><strong>${item.name}</strong><span>${item.quantity} x ${money(item.price)}</span></article>`).join("")}
              </div>
              <div class="post-actions">
                <button class="ghost-button message-market-order" type="button" data-id="${order.id}">Message</button>
                ${["School Admin", "Super Admin"].includes(currentRole()) && order.status === "Approved by School" ? `<button class="primary-button pay-market-order" type="button" data-id="${order.id}">Send Razorpay link</button>` : ""}
                ${["School Admin", "Super Admin", "Vendor"].includes(currentRole()) && order.status === "Approved by School" && order.paymentLinkId ? `<button class="ghost-button confirm-market-payment" type="button" data-id="${order.id}">Check payment</button>` : ""}
                ${canAdvanceMarketOrder(order) ? `<button class="primary-button advance-order-status" type="button" data-id="${order.id}">Next step</button>` : ""}
              </div>
              ${order.messages?.length ? `<div class="comment-preview">${order.messages.slice(-2).map((message) => `<p><strong>${escapeAttribute(message.author)}</strong> ${escapeAttribute(message.message)}</p>`).join("")}</div>` : ""}
            </article>
          `)
          .join("")
      : `<article class="panel"><h3>No requests yet</h3><p>Add a product and send your first request.</p></article>`;
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
              ${tagList([product.status || "Active", product.stock > 0 ? `${product.stock} in stock` : "Out of stock", product.audience || "Schools", product.delivery || "Standard delivery"])}
              ${
                currentRole() === "Vendor"
                  ? `<div class="post-actions"><button class="ghost-button edit-vendor-product" type="button" data-id="${product.id}">Edit</button><button class="ghost-button danger-button delete-vendor-product" type="button" data-id="${product.id}">Delete</button></div>`
                  : `<div class="post-actions">${currentRole() === "Super Admin" && product.status === "Pending approval" ? `<button class="primary-button approve-vendor-product" type="button" data-id="${product.id}">Approve product</button>` : ""}<button class="primary-button add-to-cart" type="button" data-id="${product.id}">Request</button>${currentRole() === "Super Admin" ? `<button class="ghost-button edit-vendor-product" type="button" data-id="${product.id}">Edit</button>` : ""}</div>`
              }
            </div>
          </article>
        `)
        .join("")
    : `<article class="panel"><h3>No products yet</h3><p>Approved vendor products will appear here.</p></article>`;
};

const renderPayments = () => {
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
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
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
  renderSchoolNetwork();
  renderPayments();
  renderPaymentConfig();
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
  setView(requestedView());
  showToast(`Signed in as ${authUser.email}.`);
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
      description: order.description || `Yarra Consortium payment for ${school.name}`,
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
                    ${field.options.map((option) => `<option ${option === field.value ? "selected" : ""}>${option}</option>`).join("")}
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

window.addEventListener("hashchange", () => {
  if (document.body.classList.contains("is-authenticated")) {
    setView(requestedView());
  }
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

vendorSignupOpenButton.addEventListener("click", async () => {
  const applicantSession = {
    id: `vendor-applicant-${Date.now().toString(36)}`,
    email: "vendor.applicant@yarra.local",
    name: "Vendor applicant",
    role: "Vendor",
    vendorStatus: "Pending approval",
    vendorApplicant: true
  };
  roleSelect.value = "Vendor";
  setSessionValue(USER_STORAGE_KEY, JSON.stringify(applicantSession));
  storeSession(applicantSession);
  setAuthenticated(true);
  await refreshWithSession(applicantSession);
  setView("vendorSignup");
  showToast("Vendor application opened. Marketplace access starts after Super Admin approval.");
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
    contact: String(formData.get("billingEmail") || "admin@school.edu").trim().toLowerCase()
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
    ? "assets/templates/Student%20Database.xlsx"
    : "assets/templates/Staff%20Database.xlsx";
  downloadTemplateLink.download = isStudent ? "Student Database.xlsx" : "Staff Database.xlsx";
  downloadTemplateLink.textContent = `Download ${isStudent ? "Student Database" : "Staff Database"}`;
  setTemplateSaveStatus("Choose a database and download the matching template.");
};

uploadType.addEventListener("change", updateTemplateDownloadUi);

downloadTemplateLink.addEventListener("click", async (event) => {
  const href = downloadTemplateLink.getAttribute("href");
  const fileName = decodeURIComponent(href.split("/").pop());
  setTemplateSaveStatus(`${fileName} download started. Check your browser downloads.`, "saved");
  showToast(`${fileName} download started.`);
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

document.querySelectorAll("#library .filter-chip[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("#library .filter-chip[data-filter]").forEach((chip) => chip.classList.remove("is-active"));
    button.classList.add("is-active");
    libraryFilter = button.dataset.filter;
    renderLibrary();
  });
});

librarySearch?.addEventListener("input", renderLibrary);
libraryCategoryFilter?.addEventListener("change", (event) => {
  libraryCategory = event.target.value;
  renderLibrary();
});
libraryAudienceFilter?.addEventListener("change", (event) => {
  libraryAudience = event.target.value;
  renderLibrary();
});
librarySort?.addEventListener("change", (event) => {
  librarySortMode = event.target.value;
  renderLibrary();
});
vendorCategory?.addEventListener("change", renderVendors);

const openVendorProductModal = (existingProduct = null) => {
  const existing = existingProduct || {};
  modal(
    existingProduct ? "Edit product" : "Add product",
    [
      { label: "Product name", name: "name", value: existing.name || "", required: true },
      { label: "Category", name: "category", type: "select", value: existing.category || "EdTech", options: ["Uniforms", "Books & Stationery", "EdTech", "Furniture & Fixtures", "Transport", "Sports Equipment"] },
      { label: "Price", name: "price", type: "number", value: existing.price || "999", required: true },
      { label: "Stock", name: "stock", type: "number", value: existing.stock ?? "100" },
      { label: "Description", name: "description", type: "textarea", value: existing.description || "Describe what schools will receive." }
    ],
    async (payload) => {
      payload.audience = existing.audience || "Schools";
      payload.delivery = existing.delivery || "Standard delivery";
      payload.imageUrl = existing.imageUrl || "";
      if (existingProduct) {
        await api.update(`/api/vendor-products/${existingProduct.id}`, payload);
      } else {
        await api.create("vendor-products", payload);
      }
      showToast(currentRole() === "Vendor" ? "Product sent for approval." : "Product saved.");
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
          <p class="eyebrow">Vendor request</p>
          <h2>Products to request</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      <div class="compact-list">
        ${cartProducts.length ? cartProducts.map((item) => `
          <article>
            <strong>${item.name}</strong>
            <span>${item.quantity} x ${money(item.price)} = ${money(item.quantity * item.price)}</span>
          </article>
        `).join("") : `<article><strong>No products selected</strong><span>Add products before sending a request.</span></article>`}
      </div>
      <div class="cart-total-panel">
        <dl><div><dt>Total</dt><dd>${money(total)}</dd></div></dl>
      </div>
      <button class="primary-button checkout-cart" type="button" ${cartProducts.length ? "" : "disabled"}>Send request</button>
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
      showToast(`Request sent: ${order.id}`);
      await refresh();
      setView("vendors");
    }
  });
  document.body.append(overlay);
};

const openMarketMessageModal = (order) => {
  modal(
    `Message ${order.id}`,
    [
      {
        label: "Message",
        name: "message",
        type: "textarea",
        rows: 4,
        required: true,
        value: ""
      }
    ],
    async (payload) => {
      await api.post(`/api/market-orders/${order.id}/message`, { message: payload.message });
      showToast("Message added.");
    }
  );
};

const payMarketOrder = async (order) => {
  const email = "rkchelli43@gmail.com";
  await api.post(`/api/market-orders/${order.id}/payment-link`, {
    email,
    description: `Vendor marketplace payment for ${order.id}`
  });
  showToast(`Razorpay payment link sent to ${email}.`);
  await refresh();
  setView("vendors");
};

const confirmMarketPayment = async (order) => {
  const updated = await api.post(`/api/market-orders/${order.id}/confirm-payment`);
  showToast(updated.status === "Paid" ? "Payment confirmed. Vendor can deliver now." : updated.paymentStatus || "Payment not confirmed yet.");
  await refresh();
  setView("vendors");
};

vendorProductButton?.addEventListener("click", openVendorProductModal);
marketCartButton?.addEventListener("click", openCartModal);

document.querySelector("#vendors")?.addEventListener("click", async (event) => {
  const tab = event.target.closest(".market-tab");
  const addToCart = event.target.closest(".add-to-cart");
  const approve = event.target.closest(".approve-vendor");
  const approveProduct = event.target.closest(".approve-vendor-product");
  const editProduct = event.target.closest(".edit-vendor-product");
  const deleteProduct = event.target.closest(".delete-vendor-product");
  const sellerProducts = event.target.closest(".view-seller-products");
  const statusButton = event.target.closest(".advance-order-status");
  const messageOrder = event.target.closest(".message-market-order");
  const payOrder = event.target.closest(".pay-market-order");
  const confirmPayment = event.target.closest(".confirm-market-payment");
  if (tab) {
    marketTab = tab.dataset.marketTab;
    if (marketTab !== "products") marketVendorFilter = "All";
    renderVendors();
  }
  if (sellerProducts) {
    marketVendorFilter = sellerProducts.dataset.id;
    marketTab = "products";
    renderVendors();
  }
  if (addToCart) {
    const item = marketCart.find((cartItem) => cartItem.productId === addToCart.dataset.id);
    if (item) item.quantity += 1;
    else marketCart.push({ productId: addToCart.dataset.id, quantity: 1 });
    showToast("Added to request.");
    renderVendors();
  }
  if (approve) {
    await api.post(`/api/vendors/${approve.dataset.id}/approve`);
    showToast("Vendor approved and published to the directory.");
    await refresh();
  }
  if (approveProduct) {
    await api.post(`/api/vendor-products/${approveProduct.dataset.id}/approve`);
    showToast("Product approved and published.");
    await refresh();
    setView("vendors");
  }
  if (editProduct) {
    const product = (state.vendorProducts || []).find((item) => item.id === editProduct.dataset.id);
    if (product) openVendorProductModal(product);
  }
  if (deleteProduct) {
    const product = (state.vendorProducts || []).find((item) => item.id === deleteProduct.dataset.id);
    if (!product || !window.confirm(`Delete ${product.name}?`)) return;
    await api.delete(`/api/vendor-products/${product.id}`);
    showToast("Product deleted.");
    await refresh();
    setView("vendors");
  }
  if (statusButton) {
    await api.post(`/api/market-orders/${statusButton.dataset.id}/advance`);
    showToast("Request updated.");
    await refresh();
    setView("vendors");
  }
  if (payOrder) {
    const order = (state.marketOrders || []).find((item) => item.id === payOrder.dataset.id);
    if (order) await payMarketOrder(order);
  }
  if (confirmPayment) {
    const order = (state.marketOrders || []).find((item) => item.id === confirmPayment.dataset.id);
    if (order) await confirmMarketPayment(order);
  }
  if (messageOrder) {
    const order = (state.marketOrders || []).find((item) => item.id === messageOrder.dataset.id);
    if (order) openMarketMessageModal(order);
  }
});

const openContentPostModal = (existingContent = null) => {
  const existing = existingContent ? normalizeContent(existingContent) : null;
  const selected = (value, expected) => (value === expected ? "selected" : "");
  const audienceKey = existing?.audience?.length === 1 && existing.audience.includes("Student")
    ? "students"
    : existing?.audience?.length === 2 && existing.audience.includes("School Admin") && existing.audience.includes("Teacher")
      ? "staff"
      : "all";
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <form class="modal-card social-compose-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">Content library</p>
          <h2>${existing ? "Edit community post" : "Create community post"}</h2>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      <div class="modal-fields form-builder-grid">
        <label>Title<input name="title" type="text" value="${escapeAttribute(existing?.title || "")}" required></label>
        <label>Post type
          <select name="type">
            ${["Story", "Short", "Video", "Article", "Webinar", "Recorded Workshop", "Podcast"].map((type) => `<option ${selected(existing?.type, type)}>${type}</option>`).join("")}
          </select>
        </label>
        <label>Author / speaker<input name="speaker" type="text" value="${escapeAttribute(existing?.speaker || currentSession()?.email || currentRole())}"></label>
        <label>Category<input name="category" type="text" value="${escapeAttribute(existing?.category || "Community")}"></label>
        <label>Media URL<input name="mediaUrl" type="url" value="${escapeAttribute(existing?.mediaUrl || "")}" placeholder="https://..."></label>
        <label>Attachment / resource URL<input name="attachmentUrl" type="url" value="${escapeAttribute(existing?.attachmentUrl || "")}" placeholder="Slides, PDF, worksheet, recording notes"></label>
        <label>Upload thumbnail / story image<input name="thumbnailFile" type="file" accept="image/*"></label>
        <label>Tags<input name="tags" type="text" value="${escapeAttribute((existing?.tags || []).join(", "))}" placeholder="leadership, student, sports"></label>
        <label>Audience
          <select name="audience">
            <option value="all" ${selected(audienceKey, "all")}>School Admin, Teacher, Student</option>
            <option value="staff" ${selected(audienceKey, "staff")}>School Admin and Teacher</option>
            <option value="students" ${selected(audienceKey, "students")}>Students</option>
          </select>
        </label>
        <label>Minimum student age<input name="minAge" type="number" min="3" value="${escapeAttribute(existing?.minAge || 5)}"></label>
        <label>Maximum student age<input name="maxAge" type="number" min="3" value="${escapeAttribute(existing?.maxAge || 18)}"></label>
        <label class="wide-field">Caption / article body<textarea name="body" rows="6" placeholder="Write the story, article, video caption, or update...">${escapeAttribute(existing?.body || "")}</textarea></label>
      </div>
      <button class="primary-button" type="submit">${existing ? "Save changes" : "Publish to feed"}</button>
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
      const payload = {
        title: formData.get("title"),
        type: formData.get("type"),
        speaker: formData.get("speaker"),
        category: formData.get("category"),
        body: formData.get("body"),
        mediaUrl: formData.get("mediaUrl"),
        attachmentUrl: formData.get("attachmentUrl"),
        thumbnailUrl: thumbnailFile?.dataUrl || existing?.thumbnailUrl || formData.get("mediaUrl"),
        tags: String(formData.get("tags") || "").split(",").map((tag) => tag.trim()).filter(Boolean),
        audience: audienceMap[formData.get("audience")] || audienceMap.all,
        minAge: formData.get("minAge"),
        maxAge: formData.get("maxAge")
      };
      if (existing) {
        await api.update(`/api/content/${existing.id}`, payload);
      } else {
        await api.create("content", payload);
      }
      overlay.remove();
      showToast(existing ? "Post updated." : "Post published to the Content Library feed.");
      await refresh();
      setView("library");
    } catch (error) {
      showToast(error.message);
    }
  });
  document.body.append(overlay);
};

const openContentDetailModal = (contentId) => {
  const item = normalizedContentList().find((contentItem) => contentItem.id === contentId);
  if (!item) {
    showToast("Content item not found.");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  overlay.innerHTML = `
    <section class="modal-card content-detail-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">${escapeAttribute(item.type)}</p>
          <h2>${escapeAttribute(item.title)}</h2>
          <p>${escapeAttribute(item.speaker)} - ${escapeAttribute(item.category)}</p>
        </div>
        <button class="icon-button close-modal" type="button" aria-label="Close">x</button>
      </div>
      ${contentMediaMarkup(item)}
      <p class="post-copy">${escapeAttribute(item.body || "Shared with the Yarra community.")}</p>
      ${tagList([...item.tags, `Visible to: ${contentAudienceText(item)}`, `Ages ${item.minAge}-${item.maxAge}`, `${item.views} views`, `${item.saved} saves`])}
      ${item.attachmentUrl ? `<a class="primary-button attachment-link" href="${escapeAttribute(item.attachmentUrl)}" target="_blank" rel="noreferrer">Open attached resource</a>` : ""}
      <div class="detail-actions">
        ${canAlterContent(item) ? `<button class="ghost-button edit-content" type="button" data-id="${item.id}">Edit</button><button class="ghost-button danger-button delete-content" type="button" data-id="${item.id}">Delete</button>` : ""}
      </div>
      <section class="comment-thread-panel">
        <h3>Admin coordination comments</h3>
        ${canManageContent() ? `
          <form class="comment-form">
            <textarea name="comment" rows="3" placeholder="Add a moderation or coordination comment"></textarea>
            <button class="primary-button" type="submit">Add comment</button>
          </form>
        ` : ""}
        <div class="comment-list">
          ${item.commentThreads.length
            ? item.commentThreads.map((comment) => `<article><strong>${escapeAttribute(comment.author)}</strong><span>${escapeAttribute(comment.role || "Member")}</span><p>${escapeAttribute(comment.text)}</p></article>`).join("")
            : `<article><strong>No comments yet</strong><p>Admin comments will appear here.</p></article>`}
        </div>
      </section>
    </section>
  `;
  overlay.querySelector(".close-modal").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (clickEvent) => {
    if (clickEvent.target === overlay) overlay.remove();
  });
  overlay.querySelector(".comment-form")?.addEventListener("submit", async (submitEvent) => {
    submitEvent.preventDefault();
    const text = submitEvent.currentTarget.comment.value.trim();
    if (!text) return;
    await api.post(`/api/content/${item.id}/comment`, { text });
    overlay.remove();
    await refresh();
    setView("library");
    openContentDetailModal(item.id);
  });
  overlay.querySelector(".edit-content")?.addEventListener("click", () => {
    overlay.remove();
    openContentPostModal(item);
  });
  overlay.querySelector(".delete-content")?.addEventListener("click", async () => {
    if (!window.confirm(`Delete ${item.title}?`)) return;
    await api.delete(`/api/content/${item.id}`);
    overlay.remove();
    showToast("Post deleted.");
    await refresh();
    setView("library");
  });
  document.body.append(overlay);
};

contentPostButton?.addEventListener("click", () => openContentPostModal());

document.querySelector("#libraryGrid")?.addEventListener("click", async (event) => {
  const detailButton = event.target.closest(".open-content-detail");
  const likeButton = event.target.closest(".content-like");
  const saveButton = event.target.closest(".content-save");
  const commentButton = event.target.closest(".content-comment");
  const editButton = event.target.closest(".edit-content");
  const deleteButton = event.target.closest(".delete-content");
  if (detailButton) {
    openContentDetailModal(detailButton.dataset.id);
    return;
  }
  if ((likeButton || saveButton || commentButton || editButton || deleteButton) && !canManageContent()) {
    showToast("Only School Admins and Super Admin can interact with posts.");
    return;
  }
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
    openContentDetailModal(commentButton.dataset.id);
  }
  if (editButton) {
    const item = normalizedContentList().find((contentItem) => contentItem.id === editButton.dataset.id);
    if (item) openContentPostModal(item);
  }
  if (deleteButton) {
    const item = normalizedContentList().find((contentItem) => contentItem.id === deleteButton.dataset.id);
    if (!item || !window.confirm(`Delete ${item.title}?`)) return;
    await api.delete(`/api/content/${item.id}`);
    showToast("Post deleted.");
    await refresh();
    setView("library");
  }
});

document.querySelector("#storyStrip")?.addEventListener("click", (event) => {
  const storyButton = event.target.closest(".open-content");
  if (!storyButton) return;
  openContentDetailModal(storyButton.dataset.id);
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

const openEventBuilderModal = (existingEvent = null) => {
  const overlay = document.createElement("div");
  overlay.className = "modal-backdrop";
  const isEditing = Boolean(existingEvent);
  let questions = (existingEvent?.registrationQuestions?.length ? existingEvent.registrationQuestions : defaultEventQuestionFields).map(normalizeEventQuestion);
  const renderQuestions = () => {
    overlay.querySelector(".form-builder-questions").innerHTML = questions.map(questionEditorTemplate).join("");
  };
  overlay.innerHTML = `
    <form class="modal-card form-builder-modal">
      <div class="modal-heading">
        <div>
          <p class="eyebrow">${isEditing ? "Event controls" : "School Admin event setup"}</p>
          <h2>${isEditing ? "Edit event and registration form" : "Create event and registration form"}</h2>
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
      <button class="primary-button" type="submit">${isEditing ? "Save event changes" : "Publish event form"}</button>
    </form>
  `;
  if (existingEvent) {
    const form = overlay.querySelector("form");
    form.elements.title.value = existingEvent.title || "";
    form.elements.type.value = existingEvent.type || "Workshop";
    form.elements.scope.value = existingEvent.scope || "Intra school";
    form.elements.format.value = existingEvent.format || "Virtual";
    form.elements.date.value = existingEvent.date || "";
    form.elements.registrationDeadline.value = existingEvent.registrationDeadline || "";
    form.elements.startTime.value = existingEvent.startTime || "";
    form.elements.endTime.value = existingEvent.endTime || "";
    form.elements.venue.value = existingEvent.venue || "";
    form.elements.capacity.value = existingEvent.capacity || 100;
    form.elements.coordinatorName.value = existingEvent.coordinatorName || "";
    form.elements.coordinatorEmail.value = existingEvent.coordinatorEmail || "";
    form.elements.eligibility.value = existingEvent.eligibility || "";
    form.elements.fee.value = existingEvent.fee || 0;
    form.elements.paid.checked = Boolean(existingEvent.paid);
    form.elements.description.value = existingEvent.description || "";
  }
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
      const payload = {
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
        formHeaderImage: formHeaderImage || existingEvent?.formHeaderImage || null,
        registrationQuestions
      };
      if (isEditing) {
        await api.update(`/api/events/${existingEvent.id}`, payload);
      } else {
        await api.create("events", payload);
      }
      overlay.remove();
      showToast(isEditing ? "Event updated." : "Event form published. Students will complete it before registration.");
      await refresh();
    } catch (error) {
      showToast(error.message);
    }
  });
  document.body.append(overlay);
};

document.querySelector("#eventButton")?.addEventListener("click", openEventBuilderModal);

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

document.querySelector("#eventsGrid")?.addEventListener("click", async (event) => {
  const registerButton = event.target.closest(".register-event");
  const manageButton = event.target.closest(".manage-event");
  const editButton = event.target.closest(".edit-event");
  const deleteButton = event.target.closest(".delete-event");
  if (registerButton) {
    const eventItem = state.events.find((item) => item.id === registerButton.dataset.id);
    if (eventItem) openStudentEventRegistrationForm(eventItem);
  }
  if (manageButton) {
    openEventRegistrationsModal(manageButton.dataset.id);
  }
  if (editButton) {
    const eventItem = state.events.find((item) => item.id === editButton.dataset.id);
    if (eventItem) openEventBuilderModal(eventItem);
  }
  if (deleteButton) {
    const eventItem = state.events.find((item) => item.id === deleteButton.dataset.id);
    if (!eventItem) return;
    deleteButton.disabled = true;
    try {
      const result = await api.delete(`/api/events/${eventItem.id}`);
      showToast(`${eventItem.title} deleted. ${result.removed?.registrations || 0} registrations removed.`);
      await refresh();
    } catch (error) {
      showToast(error.message || "Event delete failed.");
    } finally {
      deleteButton.disabled = false;
    }
  }
});

document.querySelector("#exchangeButton")?.addEventListener("click", () => {
  modal(
    "Create exchange request",
    [
      { label: "Title", name: "title", required: true },
      { label: "Exchange type", name: "type", type: "select", options: ["Teacher", "Student"] },
      { label: "Subject", name: "subject", required: true },
      { label: "Grade", name: "grade", value: "8" },
      { label: "Duration", name: "duration", value: "5 days" },
      { label: "Objective", name: "objective", type: "textarea", rows: 3, required: true },
      { label: "Date range", name: "dateRange", value: "Next term" },
      { label: "Capacity", name: "capacity", type: "number", value: "20" },
      { label: "Mode", name: "mode", type: "select", options: ["Online", "In-person", "Hybrid"] },
      { label: "Location", name: "location", value: "Online" },
      { label: "From school", name: "fromSchool", value: state.schools[0]?.name || "" }
    ],
    async (payload) => {
      await api.create("exchanges", payload);
      showToast("Exchange request saved as Draft. Submit it to Yarra when ready.");
    }
  );
});

const openExchangeEditModal = (exchange) => {
  modal(
    "Edit exchange request",
    [
      { label: "Title", name: "title", value: exchange.title || "", required: true },
      { label: "Exchange type", name: "type", type: "select", value: exchange.type || "Teacher", options: ["Teacher", "Student"] },
      { label: "Subject", name: "subject", value: exchange.subject || "", required: true },
      { label: "Grade", name: "grade", value: exchange.grade || "8" },
      { label: "Duration", name: "duration", value: exchange.duration || "5 days" },
      { label: "Objective", name: "objective", type: "textarea", rows: 3, value: exchange.objective || "", required: true },
      { label: "Date range", name: "dateRange", value: exchange.dateRange || "Next term" },
      { label: "Capacity", name: "capacity", type: "number", value: exchange.capacity || "20" },
      { label: "Mode", name: "mode", type: "select", value: exchange.mode || "Online", options: ["Online", "In-person", "Hybrid"] },
      { label: "Location", name: "location", value: exchange.location || "Online" },
      { label: "From school", name: "fromSchool", value: exchange.fromSchool || currentSchool()?.name || "" }
    ],
    async (payload) => {
      await api.update(`/api/exchanges/${exchange.id}`, payload);
      showToast("Exchange request updated.");
    }
  );
};

const openExchangeApplicationModal = (exchange) => {
  modal(
    `Apply for ${exchange.title}`,
    [
      { label: "Proposed teacher/student details", name: "proposedParticipants", type: "textarea", rows: 3, required: true },
      { label: "Reason for applying", name: "reason", type: "textarea", rows: 3, required: true },
      { label: "Contact person", name: "contactPerson", value: currentSession()?.email || "" }
    ],
    async (payload) => {
      await api.post(`/api/exchanges/${exchange.id}/review`, payload);
      showToast(`${currentSchool()?.name || "Your school"} applied for ${exchange.title}.`);
    }
  );
};

const openExchangeMessageModal = (exchange) => {
  modal(
    `Message ${exchange.reviewSchool || "matched school"}`,
    [{ label: "Coordination message", name: "message", type: "textarea", rows: 4, required: true }],
    async (payload) => {
      await api.post(`/api/exchanges/${exchange.id}/message`, payload);
      showToast("Message posted to the exchange thread.");
    }
  );
};

const openExchangeActivityModal = (exchange, nextStatus) => {
  modal(
    `Start ${exchange.title}`,
    [{ label: "Attendance or activity update", name: "activityUpdate", type: "textarea", rows: 3, required: true }],
    async (payload) => {
      await api.post(`/api/exchanges/${exchange.id}/status`, { ...payload, status: nextStatus });
      showToast(`${exchange.title} moved to ${nextStatus}.`);
    }
  );
};

const openExchangeCompletionModal = (exchange, nextStatus) => {
  modal(
    `Complete ${exchange.title}`,
    [{ label: "Completion note", name: "completionNote", type: "textarea", rows: 3, required: true }],
    async (payload) => {
      await api.post(`/api/exchanges/${exchange.id}/status`, { ...payload, status: nextStatus });
      showToast(`${exchange.title} moved to ${nextStatus}.`);
    }
  );
};

const openExchangeFeedbackModal = (exchange, nextStatus) => {
  modal(
    `Feedback for ${exchange.title}`,
    [
      { label: "Feedback", name: "feedback", type: "textarea", rows: 3, required: true },
      { label: "Photos/report link or note", name: "photosReport", type: "textarea", rows: 3 },
      { label: "Outcome notes", name: "outcomes", type: "textarea", rows: 3, required: true }
    ],
    async (payload) => {
      await api.post(`/api/exchanges/${exchange.id}/status`, { ...payload, status: nextStatus });
      showToast(`${exchange.title} feedback submitted.`);
    }
  );
};

document.querySelector(".kanban")?.addEventListener("click", async (event) => {
  const reviewButton = event.target.closest(".review-exchange");
  const approveButton = event.target.closest(".approve-exchange");
  const messageButton = event.target.closest(".message-exchange");
  const progressButton = event.target.closest(".progress-exchange");
  const editButton = event.target.closest(".edit-exchange");
  const deleteButton = event.target.closest(".delete-exchange");
  try {
    if (reviewButton) {
      const exchange = state.exchanges.find((item) => item.id === reviewButton.dataset.id);
      if (exchange) openExchangeApplicationModal(exchange);
    }
    if (approveButton) {
      const result = await api.post(`/api/exchanges/${approveButton.dataset.id}/approve`);
      showToast(`${result.title} approval recorded. Status: ${result.status}.`);
      await refresh();
    }
    if (messageButton) {
      const exchange = state.exchanges.find((item) => item.id === messageButton.dataset.id);
      if (exchange) openExchangeMessageModal(exchange);
    }
    if (progressButton) {
      const exchange = state.exchanges.find((item) => item.id === progressButton.dataset.id);
      if (!exchange) return;
      if (progressButton.dataset.status === "Ongoing") {
        openExchangeActivityModal(exchange, progressButton.dataset.status);
        return;
      }
      if (progressButton.dataset.status === "Completed") {
        openExchangeCompletionModal(exchange, progressButton.dataset.status);
        return;
      }
      if (progressButton.dataset.status === "Feedback Submitted") {
        openExchangeFeedbackModal(exchange, progressButton.dataset.status);
        return;
      }
      const result = await api.post(`/api/exchanges/${exchange.id}/status`, { status: progressButton.dataset.status });
      showToast(`${result.title} moved to ${result.status}.`);
      await refresh();
    }
    if (editButton) {
      const exchange = state.exchanges.find((item) => item.id === editButton.dataset.id);
      if (exchange) openExchangeEditModal(exchange);
    }
    if (deleteButton) {
      const exchange = state.exchanges.find((item) => item.id === deleteButton.dataset.id);
      if (!exchange) return;
      deleteButton.disabled = true;
      const result = await api.delete(`/api/exchanges/${exchange.id}`);
      showToast(`${exchange.title || "Exchange slot"} deleted. ${result.removed?.requests || 0} linked requests removed.`);
      await refresh();
    }
  } catch (error) {
    showToast(error.message || "Exchange update failed.");
  } finally {
    if (deleteButton) deleteButton.disabled = false;
  }
});

document.querySelector("#vendorPreviewButton")?.addEventListener("click", () => {
  setView("vendors");
});

document.querySelector("#vendorApplyButton")?.addEventListener("click", () => {
  document.querySelector(".vendor-apply-panel").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#vendorSignupForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const status = form.querySelector(".form-status");
  try {
    const vendor = await api.create("vendors", Object.fromEntries(formData.entries()));
    const session = {
      ...(currentSession() || {}),
      email: vendor.contact,
      name: vendor.name,
      role: "Vendor",
      vendorId: vendor.id,
      vendorStatus: vendor.status,
      vendorApplicant: vendor.status !== "Approved"
    };
    setSessionValue(USER_STORAGE_KEY, JSON.stringify(session));
    storeSession(session);
    status.textContent = "Application submitted. Akshar Arbol admin will review and approve the listing.";
    await refresh();
    setView("vendorSignup");
  } catch (error) {
    status.textContent = error.message;
  }
});

syncSessionTimeoutControls();

if (getSessionValue(AUTH_STORAGE_KEY) === "true" && currentSession()?.id) {
  try {
    suppressSessionExpiryToast = true;
    setAuthenticated(true);
    roleSelect.value = currentRole();
    await refresh();
    setView(requestedView());
  } catch (error) {
    const message = String(error?.message || "");
    const authFailure =
      message.includes("sign in again") ||
      message.includes("Unable to load platform state") ||
      message.includes("401");
    if (authFailure) {
      setAuthenticated(false);
    } else {
      console.error(error);
      setAuthenticated(true);
      showToast("The page hit a local render hiccup. Refresh again to continue.");
    }
  } finally {
    suppressSessionExpiryToast = false;
  }
} else {
  setAuthenticated(false);
}
