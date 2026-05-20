const api = {
  async state() {
    const response = await fetch("/api/state");
    return response.json();
  },
  async create(resource, payload) {
    const response = await fetch(`/api/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`Unable to save ${resource}`);
    }
    return response.json();
  },
  async createRazorpayOrder(payload) {
    const response = await fetch("/api/payments/razorpay-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Unable to create Razorpay order");
    }
    return body;
  },
  async post(path) {
    const response = await fetch(path, { method: "POST" });
    if (!response.ok) {
      throw new Error("Action failed");
    }
    return response.json();
  },
  async gmailLogin(payload) {
    const response = await fetch("/api/auth/gmail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Gmail login failed");
    }
    return body;
  }
};

const navButtons = document.querySelectorAll(".nav-item");
const views = document.querySelectorAll(".view");
const toast = document.querySelector("#toast");
const loginForm = document.querySelector("#loginForm");
const gmailLoginButton = document.querySelector("#gmailLoginButton");
const roleSelect = document.querySelector("#roleSelect");
const vendorCategory = document.querySelector("#vendorCategory");
const librarySearch = document.querySelector("#librarySearch");
const metricsGrid = document.querySelector(".metrics-grid");
const activityList = document.querySelector(".activity-list");
const queueList = document.querySelector(".queue-list");
const notificationButton = document.querySelector("#notificationButton");
const paymentPanel = document.querySelector(".payment-panel");
const invoicePanel = document.querySelector(".invoice-panel");
const studentGrid = document.querySelector("#studentGrid");

let state = {};
let libraryFilter = "All";

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

const setView = (viewId) => {
  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === viewId);
  });
  views.forEach((view) => {
    view.classList.toggle("is-active", view.id === viewId);
  });
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
  const latestPayment = state.payments[0];
  const latestPromotion = state.promotions[0];
  const latestEvent = state.events[0];

  activityList.innerHTML = `
    <article>
      <span class="status-dot green"></span>
      <div>
        <strong>${schoolName(latestPayment?.schoolId)}</strong>
        <p>${latestPayment?.type || "Membership"} payment ${latestPayment?.status || "received"} with invoice ${latestPayment?.invoice || "pending"}.</p>
      </div>
      <time>${latestPayment?.createdAt || "Today"}</time>
    </article>
    <article>
      <span class="status-dot amber"></span>
      <div>
        <strong>${latestPromotion?.name || "Promotion campaign"}</strong>
        <p>${latestPromotion?.placement || "Placement"} is ${latestPromotion?.status || "queued"}.</p>
      </div>
      <time>${latestPromotion?.startDate || "Queued"}</time>
    </article>
    <article>
      <span class="status-dot blue"></span>
      <div>
        <strong>${latestEvent?.title || "Event"}</strong>
        <p>${latestEvent?.registered || 0} registered of ${latestEvent?.capacity || 0}; ${latestEvent?.format || "Hybrid"} format.</p>
      </div>
      <time>${latestEvent?.date || "Scheduled"}</time>
    </article>
  `;

  queueList.innerHTML = `
    <button type="button">${state.metrics.reviewQueue.vendorUploads} vendor uploads</button>
    <button type="button">${state.metrics.reviewQueue.comments} comments flagged</button>
    <button type="button">${state.schools.filter((school) => school.status !== "Active").length} school approvals</button>
    <button type="button">${state.metrics.reviewQueue.promotions} promotion reviews</button>
  `;
};

const schoolName = (id) => state.schools.find((school) => school.id === id)?.name || "Member school";

const renderSchoolDashboard = () => {
  const school = state.schools[0];
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
    <p class="panel-copy">Valid until ${school.membershipExpiry}. Renewal reminders are scheduled at 30, 14, 7, 2, and 1 day before expiry.</p>
    <button class="primary-button" type="button" id="renewMembershipButton">Renew membership</button>
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
};

const renderEvents = () => {
  document.querySelector("#eventsGrid").innerHTML = state.events
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
    .join("");
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
              vendor.status === "Approved"
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

const renderStudents = () => {
  const students = state.students || [];
  studentGrid.innerHTML = students
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
    .join("");
};

const renderProfiles = () => {
  const activeSchool = state.schools[0];
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

const renderAll = () => {
  renderMetrics();
  renderDashboard();
  renderSchoolDashboard();
  renderEvents();
  renderExchange();
  renderLibrary();
  renderVendors();
  renderPayments();
  renderStudents();
  renderProfiles();
  renderNotifications();
};

const refresh = async () => {
  state = await api.state();
  renderAll();
};

const setAuthenticated = (value) => {
  document.body.classList.toggle("is-authenticated", value);
  if (value) {
    sessionStorage.setItem("yaara-authenticated", "true");
  } else {
    sessionStorage.removeItem("yaara-authenticated");
  }
};

const completeGmailLogin = async () => {
  const formData = new FormData(loginForm);
  const authUser = await api.gmailLogin({
    email: formData.get("email"),
    role: formData.get("role")
  });
  roleSelect.value = authUser.role;
  sessionStorage.setItem("yaara-user", JSON.stringify(authUser));
  setAuthenticated(true);
  await refresh();
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
      window.setTimeout(() => {
        resolve({
          razorpay_payment_id: `pay_sim_${Date.now().toString(36)}`,
          razorpay_order_id: order.id,
          simulated: true
        });
      }, 700);
      return;
    }

    const checkout = new window.Razorpay({
      key: order.key,
      amount: order.amount,
      currency: order.currency || "INR",
      name: "Yaara Education Group",
      description: "Yaara Consortium membership",
      image: "assets/yarra-logo.jpeg",
      order_id: order.id,
      prefill: {
        name: school.name,
        email: school.contact
      },
      theme: {
        color: "#1e6b78"
      },
      handler: (response) => resolve(response),
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled"))
      }
    });

    checkout.on("payment.failed", (response) => {
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

document.querySelector("#logoutButton").addEventListener("click", () => {
  setAuthenticated(false);
  sessionStorage.removeItem("yaara-user");
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
    contact: "admin@school.edu",
    earlyYears: event.currentTarget.querySelector('input[type="checkbox"]').checked
  };
  try {
    formStatus.textContent = "Creating Razorpay payment order...";
    const order = await api.createRazorpayOrder({
      amount: 25000,
      type: "Membership",
      schoolName: payload.name
    });
    formStatus.textContent = order.simulated
      ? "Razorpay keys not configured. Running local payment simulation..."
      : "Opening Razorpay checkout...";
    const payment = await openRazorpayCheckout(order, {
      name: payload.name,
      contact: payload.contact
    });

    await api.create("schools", {
      ...payload,
      amount: order.amount / 100,
      paymentMethod: payment.simulated ? "Razorpay simulation" : "Razorpay",
      gatewayPaymentId: payment.razorpay_payment_id,
      gatewayOrderId: payment.razorpay_order_id
    });
    formStatus.textContent =
      "Payment successful. School dashboard unlocked and invoice generated.";
    await refresh();
    setView("schoolDashboard");
  } catch (error) {
    formStatus.textContent = error.message;
  }
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

roleSelect.addEventListener("change", () => {
  showToast(`${roleSelect.value} view selected. API-backed RBAC is the next production integration layer.`);
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

document.querySelector("#exportButton").addEventListener("click", () => {
  const rows = [
    ["School", "City", "Board", "Status"],
    ...state.schools.map((school) => [school.name, school.city, school.board, school.status])
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "yaara-schools.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("CSV exported from live app data.");
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
  showToast(`${promotion.name}: ${promotion.placement} is ${promotion.status}.`);
});

if (sessionStorage.getItem("yaara-authenticated") === "true") {
  setAuthenticated(true);
  await refresh();
}
