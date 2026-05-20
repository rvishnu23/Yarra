import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, "data");
const dbPath = join(dataDir, "db.json");
const port = Number(process.env.PORT || 4173);

async function loadEnvFile() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  const lines = (await readFile(envPath, "utf8")).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawKey, ...rawValue] = trimmed.split("=");
    const key = rawKey.trim();
    const value = rawValue.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

await loadEnvFile();

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || "";
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || "";
const upiPayeeId = process.env.UPI_PAYEE_ID || "vishnuaravindhr-1@okicici";
const upiPayeeName = process.env.UPI_PAYEE_NAME || "Yarra Education Group";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

const seed = {
  schools: [
    {
      id: "school-greenfield",
      name: "Greenfield Public School",
      city: "Bengaluru",
      board: "CBSE",
      type: "K-12",
      contact: "admin@greenfield.edu",
      earlyYears: true,
      status: "Active",
      membershipExpiry: "2027-05-18",
      achievements: ["STEM learning lab", "Teacher research circles", "Student leadership cohort"]
    },
    {
      id: "school-riverside",
      name: "Riverside International",
      city: "Pune",
      board: "IB",
      type: "Senior Secondary",
      contact: "principal@riverside.edu",
      earlyYears: false,
      status: "Pending approval",
      membershipExpiry: "2027-02-04",
      achievements: ["Global exchange partnerships", "Arts integration program"]
    }
  ],
  students: [
    {
      id: "student-anaya",
      name: "Anaya Rao",
      grade: "Grade 8",
      age: 13,
      schoolId: "school-greenfield",
      guardianEmail: "parent.anaya@example.com",
      status: "Active",
      access: ["Competitions", "Student exchange", "Age-gated content"]
    },
    {
      id: "student-kabir",
      name: "Kabir Menon",
      grade: "Grade 10",
      age: 15,
      schoolId: "school-greenfield",
      guardianEmail: "parent.kabir@example.com",
      status: "Invited",
      access: ["Webinars", "Competitions"]
    }
  ],
  vendors: [
    {
      id: "vendor-campuscraft",
      name: "CampusCraft Uniforms",
      category: "Uniforms",
      contact: "sales@campuscraft.example",
      offer: "12% consortium discount on annual procurement.",
      status: "Approved",
      featured: true
    },
    {
      id: "vendor-page-pencil",
      name: "Page & Pencil Supply Co.",
      category: "Books & Stationery",
      contact: "hello@pagepencil.example",
      offer: "Bundled academic kits with quarterly replenishment.",
      status: "Approved",
      featured: false
    },
    {
      id: "vendor-learngrid",
      name: "LearnGrid Labs",
      category: "EdTech",
      contact: "partners@learngrid.example",
      offer: "Pilot pricing for member schools and teacher onboarding.",
      status: "Pending approval",
      featured: true
    }
  ],
  events: [
    {
      id: "event-conclave-2026",
      title: "Leadership Conclave 2026",
      type: "Leadership Conclave",
      format: "Hybrid",
      date: "2026-07-12",
      host: "Dr. Prem Shankar",
      capacity: 100,
      registered: 84,
      paid: true,
      recording: false,
      materials: true
    },
    {
      id: "event-assessment-workshop",
      title: "Assessment Design Workshop",
      type: "Workshop",
      format: "Virtual",
      date: "2026-06-28",
      host: "Prabha Dixit",
      capacity: 250,
      registered: 146,
      paid: false,
      recording: true,
      materials: true
    }
  ],
  exchanges: [
    {
      id: "exchange-science-8",
      title: "Grade 8 Science Immersion",
      type: "Student",
      subject: "Science",
      duration: "5 days",
      fromSchool: "Greenfield Public School",
      status: "Open"
    },
    {
      id: "exchange-math-faculty",
      title: "Mathematics Faculty Visit",
      type: "Teacher",
      subject: "Mathematics",
      duration: "2 weeks",
      fromSchool: "Riverside International",
      status: "Under Review"
    },
    {
      id: "exchange-leadership",
      title: "Student Leadership Shadowing",
      type: "Student",
      subject: "Leadership",
      duration: "3 days",
      fromSchool: "Greenfield Public School",
      status: "Matched"
    }
  ],
  content: [
    {
      id: "content-learning-circles",
      title: "Building Teacher Learning Circles",
      type: "Recorded Workshop",
      speaker: "Dr. Prem Shankar",
      category: "Professional Development",
      tags: ["teacher", "video", "leadership"],
      restrictedToEarlyYears: false,
      comments: 12,
      saved: 42
    },
    {
      id: "content-future-classrooms",
      title: "Future-ready Classrooms",
      type: "Podcast",
      speaker: "Prabha Dixit",
      category: "EdTech",
      tags: ["audio", "edtech", "leadership"],
      restrictedToEarlyYears: false,
      comments: 7,
      saved: 31
    },
    {
      id: "content-early-years",
      title: "Early Years Curriculum Access",
      type: "Article",
      speaker: "Yaara Editorial",
      category: "Early Years",
      tags: ["early-years", "curriculum", "restricted"],
      restrictedToEarlyYears: true,
      comments: 3,
      saved: 18
    }
  ],
  promotions: [
    {
      id: "promo-back-school-2026",
      name: "Back to School - July 2026",
      vendorId: "vendor-learngrid",
      placement: "Homepage banner",
      startDate: "2026-07-01",
      endDate: "2026-07-31",
      status: "Awaiting approval",
      impressions: 0,
      clicks: 0
    }
  ],
  notifications: [
    {
      id: "note-renewal",
      audience: "School Admin",
      title: "Membership renewal reminders scheduled",
      unread: true
    },
    {
      id: "note-event",
      audience: "Teacher",
      title: "New workshop published",
      unread: true
    },
    {
      id: "note-vendor",
      audience: "School Admin",
      title: "New vendor deal alert",
      unread: true
    }
  ],
  payments: [
    {
      id: "pay-greenfield-membership",
      schoolId: "school-greenfield",
      type: "Membership",
      amount: 25000,
      status: "Paid",
      invoice: "YAARA-INV-1001",
      method: "UPI",
      createdAt: "2026-05-18"
    }
  ]
};

async function ensureDb() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (!existsSync(dbPath)) {
    await writeJson(dbPath, seed);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function postRazorpayOrder(order) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(order);
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const request = httpsRequest(
      {
        hostname: "api.razorpay.com",
        path: "/v1/orders",
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(body || "Razorpay order creation failed"));
          }
        });
      }
    );
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function postRazorpayPaymentLink(paymentLink) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(paymentLink);
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const request = httpsRequest(
      {
        hostname: "api.razorpay.com",
        path: "/v1/payment_links",
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload)
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(JSON.parse(body));
          } else {
            reject(new Error(body || "Razorpay payment link creation failed"));
          }
        });
      }
    );
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function slug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

function createId(prefix, name) {
  return `${prefix}-${slug(name)}-${Date.now().toString(36)}`;
}

function metrics(db) {
  const activeSchools = db.schools.filter((school) => school.status === "Active").length;
  const totalRevenue = db.payments
    .filter((payment) => payment.status === "Paid")
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

  return {
    activeSchools,
    vendors: db.vendors.length,
    students: (db.students || []).length,
    events: db.events.length,
    totalRevenue,
    newSignups: db.schools.filter((school) => school.status === "Pending approval").length,
    reviewQueue: {
      vendorUploads: db.vendors.filter((vendor) => vendor.status !== "Approved").length,
      promotions: db.promotions.filter((promotion) => promotion.status !== "Live").length,
      comments: db.content.reduce((sum, item) => sum + Math.min(item.comments || 0, 2), 0)
    }
  };
}

async function handleApi(req, res, url) {
  const db = await readJson(dbPath);
  const [, , resource, id, action] = url.pathname.split("/");

  if (req.method === "GET" && resource === "state") {
    sendJson(res, 200, { ...db, metrics: metrics(db) });
    return;
  }

  if (req.method === "GET" && resource === "payments" && id === "config") {
    sendJson(res, 200, {
      razorpayConfigured: Boolean(razorpayKeyId && razorpayKeySecret),
      razorpayKeyId: razorpayKeyId ? `${razorpayKeyId.slice(0, 8)}...` : "",
      upiPayeeId,
      upiPayeeName
    });
    return;
  }

  if (req.method === "POST" && resource === "payments" && id === "razorpay-order") {
    const body = await readBody(req);
    const amount = Number(body.amount || 25000);
    const receipt = `yaara_${Date.now()}`;

    if (!razorpayKeyId || !razorpayKeySecret) {
      sendJson(res, 200, {
        id: `order_sim_${Date.now().toString(36)}`,
        amount: amount * 100,
        currency: "INR",
        receipt,
        key: "",
        simulated: true,
        reason: "Razorpay credentials are missing. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env, then restart npm start."
      });
      return;
    }

    const order = await postRazorpayOrder({
      amount: amount * 100,
      currency: "INR",
      receipt,
      notes: {
        school: body.schoolName || "Member school",
        payment_type: body.type || "Membership"
      }
    });

    sendJson(res, 200, {
      ...order,
      key: razorpayKeyId,
      simulated: false
    });
    return;
  }

  if (req.method === "POST" && resource === "payments" && id === "razorpay-link") {
    const body = await readBody(req);
    const amount = Number(body.amount || 1);

    if (!razorpayKeyId || !razorpayKeySecret) {
      sendJson(res, 400, {
        error: "Razorpay credentials are missing. Add keys to .env and restart npm start."
      });
      return;
    }

    const link = await postRazorpayPaymentLink({
      amount: amount * 100,
      currency: "INR",
      accept_partial: false,
      description: body.description || "Yaara Consortium membership test payment",
      customer: {
        name: body.schoolName || "Yaara member school",
        email: body.email || "admin@gmail.com"
      },
      notify: {
        sms: false,
        email: false
      },
      reminder_enable: false,
      notes: {
        school: body.schoolName || "Member school",
        payment_type: body.type || "Membership"
      }
    });

    sendJson(res, 200, link);
    return;
  }

  if (req.method === "POST" && resource === "payments" && id === "upi-intent") {
    const body = await readBody(req);
    const amount = Math.max(1, Number(body.amount || 1));
    const transactionNote = body.note || "Yaara Consortium test payment";
    const params = new URLSearchParams({
      pa: upiPayeeId,
      pn: upiPayeeName,
      am: amount.toFixed(2),
      cu: "INR",
      tn: transactionNote
    });

    sendJson(res, 200, {
      payeeId: upiPayeeId,
      payeeName: upiPayeeName,
      amount,
      uri: `upi://pay?${params.toString()}`
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "gmail") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email.endsWith("@gmail.com")) {
      sendJson(res, 400, { error: "Please use a Gmail account." });
      return;
    }
    sendJson(res, 200, {
      email,
      name: email.split("@")[0].replace(/[._-]+/g, " "),
      provider: "gmail",
      role: body.role || "School Admin"
    });
    return;
  }

  if (req.method === "POST" && resource === "schools") {
    const body = await readBody(req);
    const school = {
      id: createId("school", body.name),
      name: body.name,
      city: body.city || "",
      board: body.board || "CBSE",
      type: body.type || "K-12",
      contact: body.contact || "",
      earlyYears: Boolean(body.earlyYears),
      status: "Active",
      membershipExpiry: "2027-05-18",
      achievements: []
    };
    db.schools.unshift(school);
    db.payments.unshift({
      id: createId("pay", school.name),
      schoolId: school.id,
      type: "Membership",
      amount: Number(body.amount || 25000),
      status: "Paid",
      invoice: `YAARA-INV-${1000 + db.payments.length + 1}`,
      method: body.paymentMethod || "Razorpay",
      gatewayPaymentId: body.gatewayPaymentId || "",
      gatewayOrderId: body.gatewayOrderId || "",
      createdAt: new Date().toISOString().slice(0, 10)
    });
    await writeJson(dbPath, db);
    sendJson(res, 201, school);
    return;
  }

  if (req.method === "POST" && resource === "events") {
    const body = await readBody(req);
    const event = {
      id: createId("event", body.title),
      title: body.title,
      type: body.type || "Workshop",
      format: body.format || "Virtual",
      date: body.date || new Date().toISOString().slice(0, 10),
      host: body.host || "Yaara Consortium",
      capacity: Number(body.capacity || 100),
      registered: 0,
      paid: Boolean(body.paid),
      recording: false,
      materials: false
    };
    db.events.unshift(event);
    await writeJson(dbPath, db);
    sendJson(res, 201, event);
    return;
  }

  if (req.method === "POST" && resource === "students") {
    const body = await readBody(req);
    const student = {
      id: createId("student", body.name),
      name: body.name,
      grade: body.grade || "Grade 8",
      age: Number(body.age || 13),
      schoolId: body.schoolId || db.schools[0]?.id,
      guardianEmail: body.guardianEmail || "",
      status: "Invited",
      access: Array.isArray(body.access) ? body.access : ["Competitions", "Student exchange"]
    };
    db.students ||= [];
    db.students.unshift(student);
    await writeJson(dbPath, db);
    sendJson(res, 201, student);
    return;
  }

  if (req.method === "POST" && resource === "payments") {
    const body = await readBody(req);
    const payment = {
      id: createId("pay", body.type || "payment"),
      schoolId: body.schoolId || db.schools[0]?.id,
      type: body.type || "Membership",
      amount: Number(body.amount || 25000),
      status: body.status || "Paid",
      invoice: `YAARA-INV-${1000 + db.payments.length + 1}`,
      method: body.method || "UPI",
      createdAt: new Date().toISOString().slice(0, 10)
    };
    db.payments.unshift(payment);
    await writeJson(dbPath, db);
    sendJson(res, 201, payment);
    return;
  }

  if (req.method === "POST" && resource === "exchanges") {
    const body = await readBody(req);
    const exchange = {
      id: createId("exchange", body.title),
      title: body.title,
      type: body.type || "Teacher",
      subject: body.subject || "",
      duration: body.duration || "",
      fromSchool: body.fromSchool || db.schools[0]?.name || "Member school",
      status: "Open"
    };
    db.exchanges.unshift(exchange);
    await writeJson(dbPath, db);
    sendJson(res, 201, exchange);
    return;
  }

  if (req.method === "POST" && resource === "vendors" && action === "approve") {
    const vendor = db.vendors.find((item) => item.id === id);
    if (!vendor) {
      sendJson(res, 404, { error: "Vendor not found" });
      return;
    }
    vendor.status = "Approved";
    await writeJson(dbPath, db);
    sendJson(res, 200, vendor);
    return;
  }

  if (req.method === "POST" && resource === "vendors") {
    const body = await readBody(req);
    const vendor = {
      id: createId("vendor", body.name),
      name: body.name,
      category: body.category || "EdTech",
      contact: body.contact || "",
      offer: body.offer || "",
      status: "Pending approval",
      featured: false
    };
    db.vendors.unshift(vendor);
    await writeJson(dbPath, db);
    sendJson(res, 201, vendor);
    return;
  }

  if (req.method === "POST" && resource === "notifications" && id === "read") {
    db.notifications.forEach((notification) => {
      notification.unread = false;
    });
    await writeJson(dbPath, db);
    sendJson(res, 200, db.notifications);
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const normalized = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, normalized);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

await ensureDb();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Yaara Consortium app running at http://localhost:${port}`);
});
