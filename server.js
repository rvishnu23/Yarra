import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash, randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { copyFile, readFile, writeFile, mkdir } from "node:fs/promises";
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
const defaultSessionTimeoutMinutes = clampNumber(process.env.SESSION_TIMEOUT_MINUTES || 30, 1, 240);
const sessionTimeoutOptions = [1, 5, 15, 30, 60, 120];
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  teachers: [
    {
      id: "teacher-isha",
      employeeId: "AAIS-T-014",
      name: "Isha Menon",
      email: "isha.menon@akshararbol.edu.in",
      role: "teacher",
      designation: "English Teacher",
      isHrt: true,
      campus: "TNG",
      grades: ["G8", "G9"],
      status: "Active"
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
    },
    {
      id: "event-innovation-challenge",
      title: "Inter-school Innovation Challenge",
      type: "Competition",
      format: "In-person",
      date: "2026-08-18",
      host: "Yaara Student Programs",
      capacity: 120,
      registered: 64,
      paid: false,
      recording: false,
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
      audience: ["School Admin", "Teacher"],
      minAge: 18,
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
      audience: ["School Admin", "Teacher", "Student"],
      minAge: 13,
      maxAge: 18,
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
      audience: ["School Admin", "Teacher"],
      minAge: 18,
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
  ],
  uploadHistory: []
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

async function readBuffer(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseMultipart(req, buffer) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!match) return {};
  const boundary = `--${match[1] || match[2]}`;
  const body = buffer.toString("binary");
  const parts = body.split(boundary).slice(1, -1);
  const result = {};

  for (const part of parts) {
    const cleaned = part.replace(/^\r\n/, "").replace(/\r\n$/, "");
    const headerEnd = cleaned.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const rawHeaders = cleaned.slice(0, headerEnd);
    const rawContent = cleaned.slice(headerEnd + 4);
    const name = rawHeaders.match(/name="([^"]+)"/)?.[1];
    const filename = rawHeaders.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;
    const content = Buffer.from(rawContent, "binary");
    result[name] = filename ? { filename, content } : content.toString("utf8");
  }
  return result;
}

function unzipEntries(buffer) {
  const entries = {};
  let offset = 0;
  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.slice(nameStart, nameStart + fileNameLength).toString("utf8");
    const dataStart = nameStart + fileNameLength + extraLength;
    const data = buffer.slice(dataStart, dataStart + compressedSize);
    if (compression === 0) entries[name] = data;
    if (compression === 8) entries[name] = inflateRawSync(data);
    offset = dataStart + compressedSize;
  }
  return entries;
}

function decodeXml(value = "") {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSharedStrings(xml = "") {
  return [...xml.matchAll(/<si[\s\S]*?<\/si>/g)].map(([si]) =>
    decodeXml([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""))
  );
}

function columnIndex(ref) {
  const letters = ref.replace(/[0-9]/g, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseWorksheet(xml = "", sharedStrings = []) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(([, rowXml]) => {
    const row = [];
    for (const cellMatch of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const ref = attrs.match(/r="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/t="([^"]+)"/)?.[1] || "";
      const idx = columnIndex(ref);
      let value = "";
      const inline = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (type === "s") value = sharedStrings[Number(raw)] || "";
      else value = inline !== undefined ? decodeXml(inline) : decodeXml(raw || "");
      row[idx] = value;
    }
    return row.map((value) => value ?? "");
  });
}

function parseXlsx(buffer) {
  const entries = unzipEntries(buffer);
  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"]?.toString("utf8") || "");
  const worksheet = entries["xl/worksheets/sheet1.xml"]?.toString("utf8") || "";
  return parseWorksheet(worksheet, sharedStrings).filter((row) => row.some((cell) => String(cell).trim()));
}

const uploadSchemas = {
  student_roster: ["student_id", "student_name", "grade", "section", "campus", "parent1_email", "parent1_name", "parent2_email", "parent2_name"],
  staff_roster: ["employee_id", "name", "email", "role", "designation", "is_hrt", "campus", "grades"]
};

function validateRoster(uploadType, rows) {
  const expected = uploadSchemas[uploadType];
  const errors = [];
  if (!expected) errors.push({ row: 0, field: "uploadType", message: "Unknown upload type." });
  const headers = (rows[0] || []).map((cell) => String(cell || "").trim());
  expected?.forEach((header, index) => {
    if (headers[index] !== header) {
      errors.push({ row: 1, field: header, message: `Expected column ${header} at position ${index + 1}.` });
    }
  });

  const records = rows.slice(1).map((row, index) => {
    const record = Object.fromEntries(expected.map((header, col) => [header, String(row[col] || "").trim()]));
    const rowNumber = index + 2;
    if (uploadType === "student_roster") {
      ["student_id", "student_name", "grade", "campus", "parent1_email"].forEach((field) => {
        if (!record[field]) errors.push({ row: rowNumber, field, message: `${field} is required.` });
      });
      if (record.parent1_email && !record.parent1_email.includes("@")) errors.push({ row: rowNumber, field: "parent1_email", message: "Invalid parent email." });
    }
    if (uploadType === "staff_roster") {
      ["employee_id", "name", "email", "role", "designation", "campus", "grades"].forEach((field) => {
        if (!record[field]) errors.push({ row: rowNumber, field, message: `${field} is required.` });
      });
      if (record.email && !record.email.includes("@")) errors.push({ row: rowNumber, field: "email", message: "Invalid email." });
    }
    return record;
  });

  return { headers, records, errors };
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

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function hashToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function normalizeTimeoutMinutes(value) {
  return clampNumber(value || defaultSessionTimeoutMinutes, 1, 240);
}

function publicSession(token, session) {
  return {
    id: token,
    email: session.email,
    name: session.name,
    provider: session.provider,
    role: session.role,
    timeoutMinutes: session.timeoutMinutes,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt
  };
}

function renewSession(session, timeoutMinutes = session.timeoutMinutes) {
  const now = Date.now();
  session.timeoutMinutes = normalizeTimeoutMinutes(timeoutMinutes);
  session.lastSeenAt = new Date(now).toISOString();
  session.expiresAt = new Date(now + session.timeoutMinutes * 60 * 1000).toISOString();
}

function createSession({ email, name, provider, role, timeoutMinutes }) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const session = {
    email,
    name,
    provider,
    role: normalizeRole(role),
    timeoutMinutes: normalizeTimeoutMinutes(timeoutMinutes),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now
  };
  renewSession(session, session.timeoutMinutes);
  sessions.set(hashToken(token), session);
  return { token, session };
}

function getSessionFromRequest(req, { renew = true } = {}) {
  const token = req.headers["x-session-id"];
  if (!token) return null;

  const hashedToken = hashToken(token);
  const session = sessions.get(hashedToken);
  if (!session) return null;

  if (Date.parse(session.expiresAt) <= Date.now()) {
    sessions.delete(hashedToken);
    return null;
  }

  if (renew) {
    renewSession(session);
  } else {
    session.lastSeenAt = new Date().toISOString();
  }

  return { token, hashedToken, session };
}

function requireSession(req, res, options) {
  const sessionContext = getSessionFromRequest(req, options);
  if (!sessionContext) {
    sendJson(res, 401, { error: "Your secure session has expired. Please sign in again." });
    return null;
  }
  res.setHeader("X-Session-Expires-At", sessionContext.session.expiresAt);
  res.setHeader("X-Session-Timeout-Minutes", String(sessionContext.session.timeoutMinutes));
  return sessionContext;
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

const roleViews = {
  "Super Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "library", "vendorSignup", "vendors", "profiles"],
  "School Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "library", "vendorSignup", "vendors", "profiles"],
  Teacher: ["dashboard", "events", "exchange", "library", "profiles"],
  Student: ["dashboard", "events", "exchange", "library"],
  Vendor: ["dashboard", "vendorSignup", "vendors"]
};

function normalizeRole(role) {
  return roleViews[role] ? role : "School Admin";
}

function userFromRequest(req, url, session) {
  const role = normalizeRole(session?.role || req.headers["x-user-role"] || url.searchParams.get("role"));
  return {
    role,
    schoolId: session?.schoolId || req.headers["x-school-id"] || "school-greenfield",
    studentId: session?.studentId || req.headers["x-student-id"] || "student-anaya",
    vendorId: session?.vendorId || req.headers["x-vendor-id"] || "vendor-learngrid"
  };
}

function deny(res) {
  sendJson(res, 403, { error: "You do not have permission for this action." });
}

function canWrite(user, resource, action = "") {
  if (user.role === "Super Admin") return true;
  if (resource === "students") return user.role === "School Admin";
  if (resource === "uploads") return ["Super Admin", "School Admin"].includes(user.role);
  if (resource === "payments") return user.role === "School Admin";
  if (resource === "schools") return user.role === "School Admin";
  if (resource === "exchanges") return ["School Admin", "Teacher"].includes(user.role);
  if (resource === "events") return user.role === "School Admin";
  if (resource === "vendors" && action === "approve") return false;
  if (resource === "vendors") return user.role === "Vendor";
  return false;
}

function filteredState(db, user) {
  const full = { ...db, metrics: metrics(db), permissions: { role: user.role, views: roleViews[user.role] } };

  if (user.role === "Vendor") {
    const vendor = db.vendors.find((item) => item.id === user.vendorId) || db.vendors[0];
    return {
      schools: [],
      students: [],
      vendors: vendor ? [vendor] : [],
      events: [],
      exchanges: [],
      content: [],
      promotions: db.promotions.filter((item) => item.vendorId === vendor?.id),
      notifications: db.notifications.filter((item) => item.audience === "Vendor"),
      payments: [],
      metrics: {
        activeSchools: 0,
        vendors: vendor ? 1 : 0,
        students: 0,
        events: 0,
        totalRevenue: 0,
        newSignups: 0,
        reviewQueue: { vendorUploads: vendor?.status === "Approved" ? 0 : 1, promotions: 0, comments: 0 }
      },
      permissions: { role: user.role, views: roleViews[user.role] }
    };
  }

  if (user.role === "Student") {
    const student = db.students.find((item) => item.id === user.studentId) || db.students[0];
    const age = Number(student?.age || 0);
    const allowedContent = db.content.filter((item) => {
      const audience = item.audience || ["School Admin", "Teacher", "Student"];
      const minAge = Number(item.minAge || 0);
      const maxAge = Number(item.maxAge || 18);
      return audience.includes("Student") && age >= minAge && age <= maxAge && !item.restrictedToEarlyYears;
    });
    return {
      ...full,
      schools: db.schools.filter((school) => school.id === student?.schoolId),
      students: student ? [student] : [],
      vendors: [],
      payments: [],
      promotions: [],
      content: allowedContent,
      events: db.events.filter((event) => ["Competition", "Webinar"].includes(event.type)),
      exchanges: db.exchanges.filter((exchange) => exchange.type === "Student"),
      metrics: {
        activeSchools: 1,
        vendors: 0,
        students: 1,
        events: db.events.filter((event) => ["Competition", "Webinar"].includes(event.type)).length,
        totalRevenue: 0,
        newSignups: 0,
        reviewQueue: { vendorUploads: 0, promotions: 0, comments: 0 }
      }
    };
  }

  if (user.role === "Teacher") {
    return {
      ...full,
      students: [],
      vendors: [],
      payments: [],
      promotions: [],
      content: db.content.filter((item) => (item.audience || ["School Admin", "Teacher"]).includes("Teacher"))
    };
  }

  if (user.role === "School Admin") {
    return {
      ...full,
      schools: db.schools.filter((school) => school.id === user.schoolId || school.status === "Active"),
      students: db.students.filter((student) => student.schoolId === user.schoolId),
      payments: db.payments.filter((payment) => payment.schoolId === user.schoolId)
    };
  }

  return full;
}

async function handleApi(req, res, url) {
  const db = await readJson(dbPath);
  const [, , resource, id, action] = url.pathname.split("/");

  if (req.method === "GET" && resource === "auth" && id === "session-config") {
    sendJson(res, 200, {
      defaultTimeoutMinutes: defaultSessionTimeoutMinutes,
      timeoutOptions: sessionTimeoutOptions,
      minTimeoutMinutes: 1,
      maxTimeoutMinutes: 240
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
    const name = email.split("@")[0].replace(/[._-]+/g, " ");
    const { token, session } = createSession({
      email,
      name,
      provider: "gmail",
      role: body.role || "School Admin",
      timeoutMinutes: body.timeoutMinutes
    });
    sendJson(res, 200, {
      email,
      name,
      provider: "gmail",
      role: session.role,
      session: publicSession(token, session)
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "extend") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    const body = await readBody(req);
    renewSession(sessionContext.session, body.timeoutMinutes);
    res.setHeader("X-Session-Expires-At", sessionContext.session.expiresAt);
    res.setHeader("X-Session-Timeout-Minutes", String(sessionContext.session.timeoutMinutes));
    sendJson(res, 200, { session: publicSession(sessionContext.token, sessionContext.session) });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "role") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    const body = await readBody(req);
    sessionContext.session.role = normalizeRole(body.role);
    renewSession(sessionContext.session, body.timeoutMinutes);
    res.setHeader("X-Session-Expires-At", sessionContext.session.expiresAt);
    res.setHeader("X-Session-Timeout-Minutes", String(sessionContext.session.timeoutMinutes));
    sendJson(res, 200, {
      email: sessionContext.session.email,
      name: sessionContext.session.name,
      provider: sessionContext.session.provider,
      role: sessionContext.session.role,
      session: publicSession(sessionContext.token, sessionContext.session)
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "logout") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    sessions.delete(sessionContext.hashedToken);
    sendJson(res, 200, { signedOut: true });
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

  const sessionContext = requireSession(req, res);
  if (!sessionContext) return;
  const user = userFromRequest(req, url, sessionContext.session);

  if (req.method === "GET" && resource === "state") {
    sendJson(res, 200, filteredState(db, user));
    return;
  }

  if (req.method === "POST" && resource === "templates" && id === "save") {
    const body = await readBody(req);
    const templateMap = {
      staff_roster: "staff_roster_template.xlsx",
      student_roster: "student_roster_template.xlsx"
    };
    const fileName = templateMap[body.uploadType] || templateMap.staff_roster;
    const source = join(root, "assets", "templates", fileName);
    const destinationRoot = process.env.USERPROFILE ? join(process.env.USERPROFILE, "Downloads") : "C:\\Users\\vishn\\Downloads";
    await mkdir(destinationRoot, { recursive: true });
    const destination = join(destinationRoot, fileName);
    await copyFile(source, destination);
    sendJson(res, 200, { fileName, path: destination });
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

  if (req.method === "POST" && resource === "uploads" && id === "validate") {
    if (!canWrite(user, "uploads")) return deny(res);
    const parts = parseMultipart(req, await readBuffer(req));
    const uploadType = parts.uploadType;
    const file = parts.file;
    if (!file?.content?.length) {
      sendJson(res, 400, { error: "Please choose an Excel file." });
      return;
    }
    const rows = parseXlsx(file.content);
    const validation = validateRoster(uploadType, rows);
    sendJson(res, 200, {
      uploadType,
      fileName: file.filename,
      recordCount: validation.records.length,
      errorCount: validation.errors.length,
      ...validation
    });
    return;
  }

  if (req.method === "POST" && resource === "uploads" && id === "commit") {
    if (!canWrite(user, "uploads")) return deny(res);
    const body = await readBody(req);
    const uploadType = body.uploadType;
    const records = Array.isArray(body.records) ? body.records : [];
    const committedAt = new Date().toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });

    if (uploadType === "student_roster") {
      for (const record of records) {
        db.students ||= [];
        db.students.unshift({
          id: `student-${slug(record.student_id)}`,
          studentId: record.student_id,
          name: record.student_name,
          grade: record.grade,
          section: record.section,
          campus: record.campus,
          schoolId: user.schoolId,
          guardianEmail: record.parent1_email,
          parent1Name: record.parent1_name,
          parent2Email: record.parent2_email,
          parent2Name: record.parent2_name,
          age: Number(record.age || 13),
          status: "Invited",
          access: ["Competitions", "Student exchange", "Age-gated content"]
        });
      }
    }

    if (uploadType === "staff_roster") {
      db.teachers ||= [];
      for (const record of records) {
        db.teachers.unshift({
          id: `teacher-${slug(record.employee_id)}`,
          employeeId: record.employee_id,
          name: record.name,
          email: record.email,
          role: record.role,
          designation: record.designation,
          isHrt: /^yes$/i.test(record.is_hrt),
          campus: record.campus,
          grades: record.grades.split(",").map((grade) => grade.trim()).filter(Boolean),
          schoolId: user.schoolId,
          status: "Active"
        });
      }
    }

    db.uploadHistory ||= [];
    db.uploadHistory.unshift({
      uploadType,
      fileName: body.fileName || "uploaded.xlsx",
      recordCount: records.length,
      errorCount: 0,
      status: "COMPLETED",
      createdAt: committedAt
    });
    await writeJson(dbPath, db);
    sendJson(res, 200, { status: "COMPLETED", recordCount: records.length, createdAt: committedAt });
    return;
  }

  if (req.method === "POST" && resource === "schools") {
    if (!canWrite(user, "schools")) return deny(res);
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
    if (!canWrite(user, "events")) return deny(res);
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
    if (!canWrite(user, "students")) return deny(res);
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
    if (!canWrite(user, "payments")) return deny(res);
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
    if (!canWrite(user, "exchanges")) return deny(res);
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
    if (!canWrite(user, "vendors", "approve")) return deny(res);
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
    if (!canWrite(user, "vendors")) return deny(res);
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
    const headers = {
      "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    };
    if (filePath.includes(`${normalize("assets/templates")}\\`) || filePath.includes(`${normalize("assets/templates")}/`)) {
      headers["Content-Disposition"] = `attachment; filename="${filePath.split(/[/\\]/).pop()}"`;
    }
    res.writeHead(200, headers);
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
