import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { appendFile, copyFile, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, "data");
const dbPath = join(dataDir, "db.json");
const auditLogPath = join(dataDir, "audit.log");
const sessionStorePath = join(dataDir, "sessions.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.RENDER || process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const databaseUrl = process.env.DATABASE_URL || "";
const usePostgres = Boolean(databaseUrl);
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const awsRegion = process.env.AWS_REGION || "ap-south-1";
const s3Bucket = process.env.AWS_S3_BUCKET || "";
const s3PublicBaseUrl = process.env.AWS_S3_PUBLIC_BASE_URL || "";
let pgPoolPromise;
let googleClientPromise;
let s3ClientPromise;

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
const defaultSessionTimeoutMinutes = 20;
const sessionTimeoutOptions = [1, 5, 15, 30, 60, 120];
const maxRequestBytes = clampNumber(process.env.MAX_REQUEST_BYTES || 10 * 1024 * 1024, 1024, 50 * 1024 * 1024);
const authRateLimitWindowMs = clampNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60 * 1000, 1000, 60 * 60 * 1000);
const authRateLimitMax = clampNumber(process.env.AUTH_RATE_LIMIT_MAX || 10, 1, 200);
const apiRateLimitWindowMs = clampNumber(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000, 1000, 60 * 60 * 1000);
const apiRateLimitMax = clampNumber(process.env.API_RATE_LIMIT_MAX || 240, 10, 5000);
const sessions = new Map();
const rateLimits = new Map();

const yarraRoleAccounts = {
  "Super Admin": {
    email: "yarra.superadmin@akshararbol.edu.in",
    password: process.env.YARRA_SUPER_ADMIN_PASSWORD || "Yarra@Super123",
    name: "Yarra Super Admin"
  },
  "School Admin": {
    email: "yarra.schooladmin@akshararbol.edu.in",
    password: process.env.YARRA_SCHOOL_ADMIN_PASSWORD || "Yarra@School123",
    name: "Akshar Arbol School Admin"
  },
  Teacher: {
    email: "yarra.teacher@akshararbol.edu.in",
    password: process.env.YARRA_TEACHER_PASSWORD || "Yarra@Teacher123",
    name: "Akshar Arbol Teacher"
  },
  Student: {
    email: "yarra.student@akshararbol.edu.in",
    password: process.env.YARRA_STUDENT_PASSWORD || "Yarra@Student123",
    name: "Akshar Arbol Student"
  },
  Vendor: {
    email: "yarra.vendor@akshararbol.edu.in",
    password: process.env.YARRA_VENDOR_PASSWORD || "Yarra@Vendor123",
    name: "Yarra Vendor Partner"
  }
};

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
  teacherResources: [
    {
      id: "resource-pl-june",
      schoolId: "school-greenfield",
      title: "Inquiry-based assessment PL session",
      type: "Upcoming PL Session",
      presenter: "Isha Menon",
      sessionDate: "2026-06-18",
      sessionTime: "15:30",
      duration: "90 min",
      capacity: 40,
      link: "https://meet.google.com/example",
      uploadedBy: "admin@greenfield.edu",
      createdAt: "2026-05-20"
    }
  ],
  reviewCycles: [
    {
      id: "review-greenfield-2026",
      schoolId: "school-greenfield",
      title: "2026 School Improvement Review",
      startDate: "2026-06-01",
      endDate: "2026-11-30",
      selfStudyStatus: "In Progress",
      reviewVisitStatus: "Not Started",
      sipStatus: "Not Started",
      recommendationsStatus: "Not Started",
      notes: "Use this cycle to track documents, review visits, SIP work, and recommendation closure.",
      createdAt: "2026-05-20"
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

const emptyState = {
  schools: [],
  users: [],
  students: [],
  teachers: [],
  vendors: [],
  events: [],
  exchanges: [],
  content: [],
  promotions: [],
  teacherResources: [],
  reviewCycles: [],
  notifications: [],
  payments: [],
  eventRegistrations: [],
  uploadHistory: []
};

async function ensureDb() {
  if (!existsSync(dataDir)) {
    await mkdir(dataDir, { recursive: true });
  }
  if (usePostgres) {
    await queryDb("SELECT 1");
  }
  if (!existsSync(dbPath)) {
    await writeJson(dbPath, emptyState);
  }
  if (!existsSync(auditLogPath)) {
    await writeFile(auditLogPath, "", "utf8");
  }
  if (!existsSync(sessionStorePath)) {
    await writeFile(sessionStorePath, "[]\n", "utf8");
  }
  await loadPersistedSessions();
}

async function readJson(path) {
  if (usePostgres && path === dbPath) {
    return readStateFromPostgres();
  }
  const state = JSON.parse(await readFile(path, "utf8"));
  return { ...emptyState, ...state };
}

async function writeJson(path, value) {
  if (usePostgres && path === dbPath) {
    await persistStateToPostgres(value);
    return;
  }
  const tempPath = `${path}.${Date.now()}.tmp`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tempPath, contents, "utf8");
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rename(tempPath, path);
      return;
    } catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes(error.code)) {
        throw error;
      }
      lastError = error;
      await sleep(80 * (attempt + 1));
    }
  }
  try {
    await writeFile(path, contents, "utf8");
  } catch {
    throw lastError;
  }
}

async function loadPersistedSessions() {
  try {
    const records = JSON.parse(await readFile(sessionStorePath, "utf8"));
    sessions.clear();
    for (const record of Array.isArray(records) ? records : []) {
      if (!record?.hashedToken || !record?.session) continue;
      sessions.set(record.hashedToken, record.session);
    }
  } catch {
    sessions.clear();
  }
}

async function persistSessions() {
  const records = [];
  for (const [hashedToken, session] of sessions.entries()) {
    records.push({ hashedToken, session });
  }
  await writeJson(sessionStorePath, records);
}

async function pgPool() {
  if (!usePostgres) return null;
  if (!pgPoolPromise) {
    pgPoolPromise = import("pg").then(({ Pool }) => new Pool({
      connectionString: databaseUrl,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
    }));
  }
  return pgPoolPromise;
}

async function queryDb(text, params = []) {
  const pool = await pgPool();
  if (!pool) throw new Error("DATABASE_URL is required for PostgreSQL mode.");
  return pool.query(text, params);
}

async function withTransaction(work) {
  const pool = await pgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function rowDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

async function readStateFromPostgres() {
  const [
    schools,
    vendors,
    events,
    content,
    payments,
    users,
    teachers,
    exchanges,
    promotions,
    notifications,
    uploadHistory
  ] = await Promise.all([
    queryDb("SELECT * FROM schools ORDER BY created_at DESC"),
    queryDb("SELECT * FROM vendors ORDER BY created_at DESC"),
    queryDb("SELECT * FROM events ORDER BY event_date DESC"),
    queryDb("SELECT * FROM content_library ORDER BY published_at DESC"),
    queryDb("SELECT * FROM payments ORDER BY created_at DESC"),
    queryDb("SELECT * FROM users ORDER BY created_at DESC"),
    queryDb("SELECT * FROM teachers ORDER BY created_at DESC"),
    queryDb("SELECT * FROM exchanges ORDER BY created_at DESC"),
    queryDb("SELECT * FROM promotions ORDER BY created_at DESC"),
    queryDb("SELECT * FROM notifications ORDER BY created_at DESC"),
    queryDb("SELECT * FROM upload_history ORDER BY created_at DESC")
  ]);

  const students = users.rows.filter((user) => user.role === "Student").map((user) => ({
    id: user.id,
    name: user.display_name,
    grade: user.grade || "Grade 8",
    age: user.age || 13,
    schoolId: user.school_id,
    guardianEmail: user.guardian_email || "",
    status: user.status,
    access: ["Competitions", "Student exchange", "Age-gated content"]
  }));

  return {
    schools: schools.rows.map((school) => ({
      id: school.id,
      name: school.name,
      city: school.city || "",
      board: school.board_affiliation,
      type: school.school_type || "K-12",
      contact: school.contact_email || "",
      earlyYears: school.has_early_years_curriculum,
      status: school.membership_status,
      membershipExpiry: rowDate(school.membership_expiry),
      achievements: school.achievements || []
    })),
    students,
    teachers: teachers.rows.map((teacher) => ({
      id: teacher.id,
      employeeId: teacher.employee_id,
      name: teacher.name,
      email: teacher.email,
      role: teacher.role,
      designation: teacher.designation,
      isHrt: teacher.is_hrt,
      campus: teacher.campus,
      grades: teacher.grades || [],
      status: teacher.status
    })),
    vendors: vendors.rows.map((vendor) => ({
      id: vendor.id,
      name: vendor.company_name,
      category: vendor.category,
      contact: vendor.contact_email || "",
      offer: vendor.offer || "",
      status: vendor.is_approved ? "Approved" : "Pending approval",
      featured: vendor.is_featured
    })),
    events: events.rows.map((event) => ({
      id: event.id,
      title: event.title,
      type: event.event_type,
      format: event.format,
      date: rowDate(event.event_date),
      host: event.host,
      capacity: event.capacity,
      registered: event.registered,
      paid: event.is_paid,
      recording: event.has_recording,
      materials: event.has_materials
    })),
    exchanges: exchanges.rows.map((exchange) => ({
      id: exchange.id,
      title: exchange.title,
      type: exchange.exchange_type,
      subject: exchange.subject,
      duration: exchange.duration,
      fromSchool: exchange.from_school,
      status: exchange.status
    })),
    content: content.rows.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.content_type,
      speaker: item.speaker || "",
      tags: item.tags || [],
      audience: item.audience || ["School Admin", "Teacher"],
      minAge: item.min_age,
      maxAge: item.max_age,
      restrictedToEarlyYears: (item.tags || []).includes("Yarra Early Years"),
      ageGatedRestricted: item.age_gated_restricted,
      vendorPromotional: item.is_vendor_promotional,
      comments: 0
    })),
    promotions: promotions.rows.map((promotion) => ({
      id: promotion.id,
      vendorId: promotion.vendor_id,
      name: promotion.name,
      placement: promotion.placement,
      status: promotion.status
    })),
    notifications: notifications.rows.map((notification) => ({
      id: notification.id,
      title: notification.title,
      audience: notification.audience,
      unread: notification.unread
    })),
    payments: payments.rows.map((payment) => ({
      id: payment.id,
      schoolId: payment.school_id,
      vendorId: payment.vendor_id,
      type: payment.payment_type,
      amount: Number(payment.amount),
      status: payment.status,
      invoice: payment.invoice,
      method: payment.method,
      gatewayPaymentId: payment.gateway_payment_id,
      gatewayOrderId: payment.gateway_order_id,
      createdAt: rowDate(payment.created_at)
    })),
    uploadHistory: uploadHistory.rows.map((upload) => ({
      uploadType: upload.upload_type,
      fileName: upload.file_name,
      recordCount: upload.record_count,
      errorCount: upload.error_count,
      status: upload.status,
      createdAt: upload.created_at
    }))
  };
}

async function persistStateToPostgres(state) {
  await withTransaction(async (client) => {
    for (const school of state.schools || []) {
      await client.query(
        `INSERT INTO schools (id, name, board_affiliation, city, school_type, contact_email, has_early_years_curriculum, membership_status, membership_expiry, achievements)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           board_affiliation = EXCLUDED.board_affiliation,
           city = EXCLUDED.city,
           school_type = EXCLUDED.school_type,
           contact_email = EXCLUDED.contact_email,
           has_early_years_curriculum = EXCLUDED.has_early_years_curriculum,
           membership_status = EXCLUDED.membership_status,
           membership_expiry = EXCLUDED.membership_expiry,
           achievements = EXCLUDED.achievements,
           updated_at = now()`,
        [school.id, school.name, school.board || school.boardAffiliation || "CBSE", school.city || "", school.type || "K-12", school.contact || "", Boolean(school.earlyYears), school.status || "Active", school.membershipExpiry || null, JSON.stringify(school.achievements || [])]
      );
    }

    for (const vendor of state.vendors || []) {
      await client.query(
        `INSERT INTO vendors (id, company_name, category, contact_email, offer, is_approved, is_featured, promotion_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           category = EXCLUDED.category,
           contact_email = EXCLUDED.contact_email,
           offer = EXCLUDED.offer,
           is_approved = EXCLUDED.is_approved,
           is_featured = EXCLUDED.is_featured,
           promotion_status = EXCLUDED.promotion_status,
           updated_at = now()`,
        [vendor.id, vendor.name || vendor.companyName, vendor.category || "EdTech", vendor.contact || "", vendor.offer || "", vendor.status === "Approved" || vendor.isApproved, Boolean(vendor.featured), vendor.promotionStatus || "Draft"]
      );
    }

    for (const student of state.students || []) {
      await client.query(
        `INSERT INTO users (id, email, display_name, role, school_id, grade, age, guardian_email, status)
         VALUES ($1,$2,$3,'Student',$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           school_id = EXCLUDED.school_id,
           grade = EXCLUDED.grade,
           age = EXCLUDED.age,
           guardian_email = EXCLUDED.guardian_email,
           status = EXCLUDED.status,
           updated_at = now()`,
        [student.id, `${student.id}@student.local`, student.name, student.schoolId || state.schools?.[0]?.id, student.grade || "", Number(student.age || 13), student.guardianEmail || "", student.status || "Invited"]
      );
    }

    for (const teacher of state.teachers || []) {
      await client.query(
        `INSERT INTO teachers (id, school_id, employee_id, name, email, role, designation, is_hrt, campus, grades, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           school_id = EXCLUDED.school_id,
           employee_id = EXCLUDED.employee_id,
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           role = EXCLUDED.role,
           designation = EXCLUDED.designation,
           is_hrt = EXCLUDED.is_hrt,
           campus = EXCLUDED.campus,
           grades = EXCLUDED.grades,
           status = EXCLUDED.status`,
        [teacher.id, teacher.schoolId || state.schools?.[0]?.id, teacher.employeeId || "", teacher.name, teacher.email || "", teacher.role || "teacher", teacher.designation || "", Boolean(teacher.isHrt), teacher.campus || "", teacher.grades || [], teacher.status || "Active"]
      );
    }

    for (const event of state.events || []) {
      await client.query(
        `INSERT INTO events (id, title, event_type, format, event_date, host, capacity, registered, is_paid, has_recording, has_materials)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           event_type = EXCLUDED.event_type,
           format = EXCLUDED.format,
           event_date = EXCLUDED.event_date,
           host = EXCLUDED.host,
           capacity = EXCLUDED.capacity,
           registered = EXCLUDED.registered,
           is_paid = EXCLUDED.is_paid,
           has_recording = EXCLUDED.has_recording,
           has_materials = EXCLUDED.has_materials`,
        [event.id, event.title, event.type || "Workshop", event.format || "Virtual", event.date || new Date().toISOString().slice(0, 10), event.host || "Yarra Consortium", Number(event.capacity || 100), Number(event.registered || 0), Boolean(event.paid), Boolean(event.recording), Boolean(event.materials)]
      );
    }

    for (const item of state.content || []) {
      await client.query(
        `INSERT INTO content_library (id, title, content_type, speaker, tags, audience, min_age, max_age, age_gated_restricted, is_vendor_promotional)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           content_type = EXCLUDED.content_type,
           speaker = EXCLUDED.speaker,
           tags = EXCLUDED.tags,
           audience = EXCLUDED.audience,
           min_age = EXCLUDED.min_age,
           max_age = EXCLUDED.max_age,
           age_gated_restricted = EXCLUDED.age_gated_restricted,
           is_vendor_promotional = EXCLUDED.is_vendor_promotional`,
        [item.id, item.title, item.type || "Article", item.speaker || "", item.tags || [], item.audience || ["School Admin", "Teacher"], Number(item.minAge || 0), Number(item.maxAge || 99), Boolean(item.ageGatedRestricted), Boolean(item.vendorPromotional)]
      );
    }

    for (const payment of state.payments || []) {
      await client.query(
        `INSERT INTO payments (id, school_id, vendor_id, payment_type, amount, status, invoice, method, gateway_payment_id, gateway_order_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status,
           invoice = EXCLUDED.invoice,
           method = EXCLUDED.method,
           gateway_payment_id = EXCLUDED.gateway_payment_id,
           gateway_order_id = EXCLUDED.gateway_order_id`,
        [payment.id, payment.schoolId || null, payment.vendorId || null, payment.type || "Membership", Number(payment.amount || 0), payment.status || "Created", payment.invoice || "", payment.method || "", payment.gatewayPaymentId || "", payment.gatewayOrderId || "", payment.createdAt || new Date().toISOString()]
      );
    }
  });
}

async function googleClient() {
  if (!googleClientId) return null;
  if (!googleClientPromise) {
    googleClientPromise = import("google-auth-library").then(({ OAuth2Client }) => new OAuth2Client(googleClientId));
  }
  return googleClientPromise;
}

async function verifyGoogleCredential(credential) {
  const client = await googleClient();
  if (!client) return null;
  const ticket = await client.verifyIdToken({ idToken: credential, audience: googleClientId });
  const payload = ticket.getPayload();
  if (!payload?.email_verified) {
    const error = new Error("Google account email is not verified.");
    error.statusCode = 401;
    throw error;
  }
  return {
    email: sanitizeEmail(payload.email),
    name: payload.name || payload.email?.split("@")[0] || "Yarra User"
  };
}

async function resolveDbUser(email, requestedRole, requestedSchoolId, requestedVendorId) {
  if (!usePostgres) return null;
  const existing = await queryDb("SELECT * FROM users WHERE email = $1 LIMIT 1", [email]);
  if (existing.rows[0]) return existing.rows[0];

  const role = normalizeRole(requestedRole || "Super Admin");
  const userId = `user-${slug(email)}`;
  if (role === "Super Admin") {
    await queryDb(
      "INSERT INTO users (id, email, display_name, role) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO NOTHING",
      [userId, email, email.split("@")[0], role]
    );
    return (await queryDb("SELECT * FROM users WHERE email = $1 LIMIT 1", [email])).rows[0];
  }

  const schoolId = requestedSchoolId || (await queryDb("SELECT id FROM schools ORDER BY created_at LIMIT 1")).rows[0]?.id;
  const vendorId = requestedVendorId || (await queryDb("SELECT id FROM vendors ORDER BY created_at LIMIT 1")).rows[0]?.id;
  await queryDb(
    `INSERT INTO users (id, email, display_name, role, school_id, vendor_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (email) DO NOTHING`,
    [userId, email, email.split("@")[0], role, ["School Admin", "Teacher", "Student"].includes(role) ? schoolId : null, role === "Vendor" ? vendorId : null]
  );
  return (await queryDb("SELECT * FROM users WHERE email = $1 LIMIT 1", [email])).rows[0];
}

function createLocalSchoolAdminUser(school, email, status = "Invited") {
  const safeEmail = sanitizeEmail(email || school?.contact || "");
  return {
    id: `user-school-admin-${slug(safeEmail || school?.id || school?.name)}`,
    email: safeEmail,
    name: `${school?.name || "School"} Admin`,
    role: "School Admin",
    schoolId: school?.id || null,
    vendorId: null,
    status,
    invitedAt: new Date().toISOString()
  };
}

function upsertLocalSchoolAdminUser(state, school, status = "Invited") {
  state.users ||= [];
  const email = sanitizeEmail(school.contact || "");
  if (!email) return null;
  const existing = state.users.find((user) => sanitizeEmail(user.email) === email);
  if (existing) {
    existing.role = "School Admin";
    existing.schoolId = school.id;
    existing.name ||= `${school.name} Admin`;
    existing.status = status;
    existing.invitedAt ||= new Date().toISOString();
    return existing;
  }
  const user = createLocalSchoolAdminUser(school, email, status);
  state.users.unshift(user);
  return user;
}

function upsertLocalStudentUser(state, student, email, status = "Invited") {
  state.users ||= [];
  const safeEmail = sanitizeEmail(email || student.email || student.studentEmail || student.guardianEmail || "");
  if (!safeEmail) return null;
  const existing = state.users.find((user) => sanitizeEmail(user.email) === safeEmail);
  if (existing) {
    existing.role = "Student";
    existing.schoolId = student.schoolId;
    existing.studentId = student.id;
    existing.name ||= student.name;
    existing.status = status;
    existing.invitedAt ||= new Date().toISOString();
    return existing;
  }
  const user = {
    id: `user-student-${slug(safeEmail || student.id || student.name)}`,
    email: safeEmail,
    name: student.name,
    role: "Student",
    schoolId: student.schoolId,
    studentId: student.id,
    vendorId: null,
    status,
    invitedAt: new Date().toISOString()
  };
  state.users.unshift(user);
  return user;
}

function upsertLocalTeacherUser(state, teacher, email, status = "Active") {
  state.users ||= [];
  const safeEmail = sanitizeEmail(email || teacher.email || "");
  if (!safeEmail) return null;
  const existing = state.users.find((user) => sanitizeEmail(user.email) === safeEmail);
  if (existing) {
    existing.role = "Teacher";
    existing.schoolId = teacher.schoolId;
    existing.teacherId = teacher.id;
    existing.name ||= teacher.name;
    existing.status = status;
    existing.invitedAt ||= new Date().toISOString();
    return existing;
  }
  const user = {
    id: `user-teacher-${slug(safeEmail || teacher.id || teacher.name)}`,
    email: safeEmail,
    name: teacher.name,
    role: "Teacher",
    schoolId: teacher.schoolId,
    teacherId: teacher.id,
    vendorId: null,
    status,
    invitedAt: new Date().toISOString()
  };
  state.users.unshift(user);
  return user;
}

function resolveLocalUser(state, email, requestedRole, requestedSchoolId, requestedVendorId) {
  state.users ||= [];
  const requested = normalizeRole(requestedRole || "School Admin");
  const yarraAccount = Object.entries(yarraRoleAccounts).find(([, account]) => sanitizeEmail(account.email) === email);
  if (yarraAccount) {
    const [accountRole, account] = yarraAccount;
    if (requested !== accountRole) return null;
    const internalSchool = state.schools.find((school) => /akshar|arbol/i.test(`${school.name} ${school.contact}`)) || state.schools.find((school) => school.status === "Active") || state.schools[0] || null;
    const vendor = accountRole === "Vendor" ? state.vendors.find((item) => item.status === "Approved") || state.vendors[0] || null : null;
    const student = accountRole === "Student" ? state.students.find((item) => item.schoolId === internalSchool?.id) || state.students[0] || null : null;
    const teacher = accountRole === "Teacher" ? state.teachers.find((item) => item.schoolId === internalSchool?.id) || state.teachers[0] || null : null;
    return {
      id: `user-yarra-${slug(accountRole)}`,
      email: account.email,
      display_name: account.name,
      role: accountRole,
      school_id: ["School Admin", "Teacher", "Student"].includes(accountRole) ? internalSchool?.id || null : null,
      student_id: accountRole === "Student" ? student?.id || null : null,
      teacher_id: accountRole === "Teacher" ? teacher?.id || null : null,
      vendor_id: accountRole === "Vendor" ? vendor?.id || null : null,
      status: "Active",
      is_yarra_builtin: true
    };
  }
  const existing = state.users.find((user) => sanitizeEmail(user.email) === email);
  if (existing) {
    if (["School Admin", "Teacher", "Student"].includes(existing.role)) {
      const school = state.schools.find((item) => item.id === existing.schoolId);
      if (!school || school.status !== "Active") return null;
    }
    return {
      id: existing.id,
      email: existing.email,
      display_name: existing.name || existing.displayName || email.split("@")[0],
      role: existing.role,
      school_id: existing.schoolId || null,
      student_id: existing.studentId || (existing.role === "Student" ? existing.id : null),
      teacher_id: existing.teacherId || null,
      vendor_id: existing.vendorId || null,
      status: existing.status || "Active"
    };
  }

  const role = requested;
  if (role === "Super Admin") {
    const user = {
      id: `user-${slug(email)}`,
      email,
      name: email.split("@")[0],
      role: "Super Admin",
      schoolId: null,
      vendorId: null,
      status: "Active",
      invitedAt: new Date().toISOString()
    };
    state.users.unshift(user);
    return {
      id: user.id,
      email: user.email,
      display_name: user.name,
      role: user.role,
      school_id: null,
      student_id: null,
      teacher_id: null,
      vendor_id: null,
      status: user.status
    };
  }

  const matchedSchool = state.schools.find((school) => sanitizeEmail(school.contact) === email);
  if (role === "School Admin" && matchedSchool) {
    const user = upsertLocalSchoolAdminUser(state, matchedSchool, matchedSchool.status === "Active" ? "Active" : "Invited");
    return {
      id: user.id,
      email: user.email,
      display_name: user.name,
      role: user.role,
      school_id: user.schoolId,
      student_id: null,
      teacher_id: null,
      vendor_id: null,
      status: user.status
    };
  }

  if (role === "Vendor") {
    const vendor = state.vendors.find((item) => sanitizeEmail(item.contact) === email) || state.vendors[0] || null;
    const user = {
      id: `user-vendor-${slug(email)}`,
      email,
      name: email.split("@")[0],
      role: "Vendor",
      schoolId: null,
      vendorId: vendor?.id || null,
      status: "Active",
      invitedAt: new Date().toISOString()
    };
    state.users.unshift(user);
    return {
      id: user.id,
      email: user.email,
      display_name: user.name,
      role: user.role,
      school_id: null,
      student_id: null,
      teacher_id: null,
      vendor_id: user.vendorId,
      status: user.status
    };
  }

  if (role === "Student") {
    const student = state.students.find((item) => sanitizeEmail(item.email || item.studentEmail || item.guardianEmail) === email);
    if (student) {
      const school = state.schools.find((item) => item.id === student.schoolId);
      if (school && school.status !== "Active") return null;
      const user = upsertLocalStudentUser(state, student, email, "Active");
      return {
        id: user.id,
        email: user.email,
        display_name: user.name,
        role: user.role,
        school_id: user.schoolId,
        student_id: user.studentId,
        teacher_id: null,
        vendor_id: null,
        status: user.status
      };
    }
  }

  if (role === "Teacher") {
    const teacher = state.teachers.find((item) => sanitizeEmail(item.email) === email);
    if (teacher) {
      const school = state.schools.find((item) => item.id === teacher.schoolId);
      if (!school || school.status !== "Active") return null;
      const user = upsertLocalTeacherUser(state, teacher, email, "Active");
      return {
        id: user.id,
        email: user.email,
        display_name: user.name,
        role: user.role,
        school_id: user.schoolId,
        student_id: null,
        teacher_id: user.teacherId,
        vendor_id: null,
        status: user.status
      };
    }
  }

  return null;
}

async function s3Client() {
  if (!s3Bucket) return null;
  if (!s3ClientPromise) {
    s3ClientPromise = import("@aws-sdk/client-s3").then(({ S3Client }) => new S3Client({ region: awsRegion }));
  }
  return s3ClientPromise;
}

async function uploadAssetToS3({ key, body, contentType, fileName, purpose, user }) {
  const client = await s3Client();
  if (!client) return null;
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  await client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: key,
    Body: body,
    ContentType: contentType
  }));

  if (usePostgres) {
    await queryDb(
      `INSERT INTO file_assets (owner_user_id, school_id, vendor_id, bucket, object_key, file_name, content_type, size_bytes, purpose)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user?.id || null, user?.schoolId || null, user?.vendorId || null, s3Bucket, key, fileName, contentType, Buffer.byteLength(body), purpose || "general"]
    );
  }

  return {
    bucket: s3Bucket,
    key,
    url: s3PublicBaseUrl ? `${s3PublicBaseUrl.replace(/\/$/, "")}/${key}` : `s3://${s3Bucket}/${key}`
  };
}

function verifyRazorpayWebhook(rawBody, signature) {
  if (!razorpayWebhookSecret) {
    const error = new Error("Razorpay webhook secret is not configured.");
    error.statusCode = 503;
    throw error;
  }
  const digest = createHmac("sha256", razorpayWebhookSecret).update(rawBody).digest("hex");
  const actual = Buffer.from(String(signature || ""), "hex");
  const expected = Buffer.from(digest, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    const error = new Error("Invalid Razorpay webhook signature.");
    error.statusCode = 401;
    throw error;
  }
}

function requestClientId(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function enforceRateLimit(req, res, scope, max, windowMs) {
  const key = `${scope}:${requestClientId(req)}`;
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > max) {
    res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
    sendJson(res, 429, { error: "Too many requests. Please wait and try again." });
    return false;
  }
  return true;
}

function cleanupRuntimeStores() {
  const now = Date.now();
  for (const [key, window] of rateLimits.entries()) {
    if (window.resetAt <= now) rateLimits.delete(key);
  }
}

async function readBuffer(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readBody(req) {
  const buffer = await readBuffer(req);
  if (!buffer.length) return {};
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON request body.");
    error.statusCode = 400;
    throw error;
  }
}

function safeAuditValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value.slice(0, 180);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeAuditValue);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/secret|token|password|key/i.test(key))
      .map(([key, entry]) => [key, safeAuditValue(entry)])
  );
}

async function audit(event, req, user, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    actor: user?.email || "anonymous",
    role: user?.role || null,
    ip: requestClientId(req),
    method: req.method,
    path: req.url?.split("?")[0],
    details: safeAuditValue(details)
  };
  await appendFile(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function isWriteRequest(req) {
  return !["GET", "HEAD", "OPTIONS"].includes(req.method);
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://checkout.razorpay.com; connect-src 'self' https://api.razorpay.com https://*.razorpay.com; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline'; frame-src https://api.razorpay.com https://*.razorpay.com; form-action 'self'");
}

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

function sanitizeText(value, fallback = "") {
  return String(value || fallback).trim().replace(/[<>]/g, "").slice(0, 180);
}

function sanitizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, 180);
}

function requireFields(body, fields) {
  return fields.filter((field) => !String(body[field] || "").trim());
}

function assertRequired(body, fields) {
  const missing = requireFields(body, fields);
  if (missing.length) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }
}

function validateEmailField(value, label = "email") {
  const email = sanitizeEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error(`Please provide a valid ${label}.`);
    error.statusCode = 400;
    throw error;
  }
  return email;
}

async function readJsonBody(req, fields = []) {
  const body = await readBody(req);
  assertRequired(body, fields);
  return body;
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
  return [...xml.matchAll(/<(?:\w+:)?si[\s\S]*?<\/(?:\w+:)?si>/g)].map(([si]) =>
    decodeXml([...si.matchAll(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((match) => match[1]).join(""))
  );
}

function columnIndex(ref) {
  const letters = ref.replace(/[0-9]/g, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

function parseWorksheet(xml = "", sharedStrings = []) {
  return [...xml.matchAll(/<(?:\w+:)?row[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map(([, rowXml]) => {
    const row = [];
    for (const cellMatch of rowXml.matchAll(/<(?:\w+:)?c([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/g)) {
      const attrs = cellMatch[1];
      const cellXml = cellMatch[2];
      const ref = attrs.match(/r="([^"]+)"/)?.[1] || "";
      const type = attrs.match(/t="([^"]+)"/)?.[1] || "";
      const idx = columnIndex(ref);
      let value = "";
      const inline = cellXml.match(/<(?:\w+:)?t[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/)?.[1];
      const raw = cellXml.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
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
  student_roster: ["student_id", "student_name", "student_mail_id", "grade", "section", "campus"],
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
      ["student_id", "student_name", "student_mail_id", "grade", "campus"].forEach((field) => {
        if (!record[field]) errors.push({ row: rowNumber, field, message: `${field} is required.` });
      });
      if (record.student_mail_id && !record.student_mail_id.includes("@")) errors.push({ row: rowNumber, field: "student_mail_id", message: "Invalid student email." });
    }
    if (uploadType === "staff_roster") {
      ["employee_id", "name", "email", "role", "campus", "grades"].forEach((field) => {
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

function notifyRazorpayPaymentLink(linkId, medium = "email") {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64");
    const request = httpsRequest(
      {
        hostname: "api.razorpay.com",
        path: `/v1/payment_links/${encodeURIComponent(linkId)}/notify_by/${encodeURIComponent(medium)}`,
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          "Content-Length": 0
        }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body ? JSON.parse(body) : { notified: true });
          } else {
            reject(new Error(body || "Razorpay payment link email notification failed"));
          }
        });
      }
    );
    request.on("error", reject);
    request.end();
  });
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
    schoolId: session.schoolId,
    studentId: session.studentId,
    teacherId: session.teacherId,
    vendorId: session.vendorId,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt
  };
}

function renewSession(session, timeoutMinutes = session.timeoutMinutes) {
  const now = Date.now();
  session.lastSeenAt = new Date(now).toISOString();
}

function createSession({ email, name, provider, role, timeoutMinutes, userId, schoolId, studentId, teacherId, vendorId }) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const session = {
    email,
    name,
    provider,
    role: normalizeRole(role),
    userId: userId || null,
    schoolId: schoolId || "school-greenfield",
    studentId: studentId || null,
    teacherId: teacherId || null,
    vendorId: vendorId || "vendor-learngrid",
    createdAt: now,
    lastSeenAt: now
  };
  renewSession(session);
  const hashedToken = hashToken(token);
  sessions.set(hashedToken, session);
  persistSessions().catch(() => {});
  return { token, session };
}

function getSessionFromRequest(req, { renew = true } = {}) {
  const token = req.headers["x-session-id"];
  if (!token) return null;

  const hashedToken = hashToken(token);
  const session = sessions.get(hashedToken);
  if (!session) return null;

  if (renew) {
    renewSession(session);
    persistSessions().catch(() => {});
  } else {
    session.lastSeenAt = new Date().toISOString();
  }

  return { token, hashedToken, session };
}

function requireSession(req, res, options) {
  const sessionContext = getSessionFromRequest(req, options);
  if (!sessionContext) {
    sendJson(res, 401, { error: "Please sign in again." });
    return null;
  }
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

async function addNotification(title, audience = "Super Admin") {
  const notification = {
    id: createId("note", title),
    title,
    audience,
    unread: true,
    createdAt: new Date().toISOString()
  };
  if (usePostgres) {
    await queryDb(
      "INSERT INTO notifications (id, title, audience, unread) VALUES ($1,$2,$3,true)",
      [notification.id, notification.title, notification.audience]
    );
  } else {
    db.notifications ||= [];
    db.notifications.unshift(notification);
    await writeJson(dbPath, db);
  }
  return notification;
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

function visibleEventsForUser(db, user) {
  if (user.role === "Super Admin") return db.events || [];
  if (["School Admin", "Teacher"].includes(user.role)) {
    return (db.events || []).filter((event) =>
      event.scope === "Inter school" || !event.scope || event.schoolId === user.schoolId
    );
  }
  if (user.role === "Student") {
    return (db.events || []).filter((event) =>
      ["Competition", "Webinar", "Workshop", "Leadership Conclave"].includes(event.type) &&
      (event.scope === "Inter school" || !event.scope || event.schoolId === user.schoolId)
    );
  }
  return [];
}

function metricsForUser(db, user) {
  const base = metrics(db);
  if (user.role === "Super Admin") return base;
  const schoolIds = user.schoolId ? [user.schoolId] : [];
  const schoolStudents = (db.students || []).filter((student) => schoolIds.includes(student.schoolId)).length;
  const schoolEvents = visibleEventsForUser(db, user).length;
  return {
    ...base,
    activeSchools: schoolIds.length ? db.schools.filter((school) => schoolIds.includes(school.id) && school.status === "Active").length : 0,
    vendors: user.role === "Vendor" ? base.vendors : 0,
    students: ["School Admin", "Teacher", "Student"].includes(user.role) ? schoolStudents : 0,
    events: schoolEvents,
    newSignups: 0,
    totalRevenue: 0
  };
}

const roleViews = {
  "Super Admin": ["dashboard", "userManagement", "schoolDashboard", "onboarding", "payments", "students", "events", "exchange", "leadership", "myProfile", "teachersHub", "reviewCycle", "library", "vendorSignup", "vendors", "schoolNetwork", "profiles"],
  "School Admin": ["dashboard", "userManagement", "schoolDashboard", "payments", "students", "events", "exchange", "leadership", "myProfile", "teachersHub", "reviewCycle", "library", "vendors", "schoolNetwork", "profiles"],
  Teacher: ["dashboard", "events", "exchange", "myProfile", "teachersHub", "library", "vendors", "schoolNetwork", "profiles"],
  Student: ["dashboard", "events", "exchange", "myProfile", "library", "vendors", "schoolNetwork", "profiles"],
  Vendor: ["dashboard", "vendorSignup", "vendors"]
};

function normalizeRole(role) {
  return roleViews[role] ? role : "School Admin";
}

function userFromRequest(req, url, session) {
  const role = normalizeRole(session?.role || req.headers["x-user-role"] || url.searchParams.get("role"));
  return {
    id: session?.userId || null,
    email: session?.email || null,
    role,
    schoolId: session?.schoolId || req.headers["x-school-id"] || "school-greenfield",
    studentId: session?.studentId || req.headers["x-student-id"] || null,
    teacherId: session?.teacherId || req.headers["x-teacher-id"] || null,
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
  if (resource === "schools") return false;
  if (resource === "exchanges") return ["School Admin", "Teacher"].includes(user.role);
  if (resource === "events") return ["School Admin", "Teacher"].includes(user.role);
  if (resource === "event-registrations") return ["School Admin", "Teacher", "Student"].includes(user.role);
  if (resource === "leadership-threads") return ["Super Admin", "School Admin"].includes(user.role);
  if (resource === "teacher-resources") return ["Super Admin", "School Admin", "Teacher"].includes(user.role);
  if (resource === "review-cycles") return ["Super Admin", "School Admin", "Teacher"].includes(user.role);
  if (resource === "profile") return ["Super Admin", "School Admin", "Teacher", "Student", "Vendor"].includes(user.role);
  if (resource === "vendor-products") return user.role === "Vendor";
  if (resource === "market-orders" && action === "advance") return user.role === "Vendor";
  if (resource === "market-orders") return ["School Admin", "Teacher", "Student"].includes(user.role);
  if (resource === "content" && ["like", "save", "comment"].includes(action)) return ["Super Admin", "School Admin", "Teacher", "Student"].includes(user.role);
  if (resource === "content") return ["Super Admin", "School Admin", "Teacher"].includes(user.role);
  if (resource === "vendors" && action === "approve") return false;
  if (resource === "vendors") return user.role === "Vendor";
  return false;
}

function filteredState(db, user) {
  const full = { ...db, metrics: metricsForUser(db, user), permissions: { role: user.role, views: roleViews[user.role] } };
  const studentTeacherSchool = (school) => {
    if (!school) return school;
    const safeSchool = { ...school };
    delete safeSchool.membershipExpiry;
    return safeSchool;
  };

  if (user.role === "Vendor") {
    const vendor = db.vendors.find((item) => item.id === user.vendorId) || db.vendors[0];
    return {
      schools: [],
      students: [],
      vendors: vendor ? [vendor] : [],
      vendorProducts: (db.vendorProducts || []).filter((product) => product.vendorId === vendor?.id),
      marketOrders: (db.marketOrders || []).filter((order) => (order.items || []).some((item) => item.vendorId === vendor?.id)),
      events: [],
      exchanges: [],
      content: [],
      teacherResources: [],
      reviewCycles: [],
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
    const student = db.students.find((item) => item.id === user.studentId);
    const age = Number(student?.age || 0);
    const allowedContent = db.content.filter((item) => {
      const audience = item.audience || ["School Admin", "Teacher", "Student"];
      const minAge = Number(item.minAge || 0);
      const maxAge = Number(item.maxAge || 18);
      return audience.includes("Student") && age >= minAge && age <= maxAge && !item.restrictedToEarlyYears;
    });
    return {
      ...full,
      schools: db.schools.filter((school) => school.id === student?.schoolId).map(studentTeacherSchool),
      students: student ? [student] : [],
      vendors: db.vendors.filter((vendor) => vendor.status === "Approved"),
      vendorProducts: (db.vendorProducts || []).filter((product) => product.status !== "Inactive"),
      marketOrders: (db.marketOrders || []).filter((order) => order.buyerId === student?.id || order.buyerEmail === user.email),
      payments: [],
      promotions: [],
      notifications: db.notifications.filter((item) => ["Student", "All"].includes(item.audience)),
      content: allowedContent,
      events: visibleEventsForUser(db, { ...user, schoolId: student?.schoolId }),
      eventRegistrations: (db.eventRegistrations || []).filter((registration) => registration.studentId === student?.id),
      exchanges: db.exchanges.filter((exchange) => exchange.type === "Student"),
      teacherResources: [],
      reviewCycles: [],
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
    const school = db.schools.find((item) => item.id === user.schoolId);
    const teacher = db.teachers.find((item) => item.id === user.teacherId || sanitizeEmail(item.email) === sanitizeEmail(user.email));
    return {
      ...full,
      schools: school ? [studentTeacherSchool(school)] : [],
      teachers: teacher ? [teacher] : [],
      students: db.students.filter((student) => student.schoolId === user.schoolId),
      vendors: db.vendors.filter((vendor) => vendor.status === "Approved"),
      vendorProducts: (db.vendorProducts || []).filter((product) => product.status !== "Inactive"),
      marketOrders: (db.marketOrders || []).filter((order) => order.buyerEmail === user.email || order.schoolId === user.schoolId),
      payments: [],
      promotions: [],
      events: visibleEventsForUser(db, user),
      eventRegistrations: (db.eventRegistrations || []).filter((registration) => {
        const event = db.events.find((item) => item.id === registration.eventId);
        return event?.schoolId === user.schoolId;
      }),
      exchanges: db.exchanges.filter((exchange) => !exchange.schoolId || exchange.schoolId === user.schoolId),
      teacherResources: (db.teacherResources || []).filter((resource) => resource.schoolId === user.schoolId),
      reviewCycles: (db.reviewCycles || []).filter((cycle) => cycle.schoolId === user.schoolId),
      content: db.content.filter((item) => (item.audience || ["School Admin", "Teacher"]).includes("Teacher"))
    };
  }

  if (user.role === "School Admin") {
    const visibleSchoolIds = user.schoolId ? [user.schoolId] : [];
    return {
      ...full,
      schools: db.schools.filter((school) => visibleSchoolIds.includes(school.id)),
      students: db.students.filter((student) => student.schoolId === user.schoolId),
      payments: db.payments.filter((payment) => visibleSchoolIds.includes(payment.schoolId)),
      vendorProducts: (db.vendorProducts || []).filter((product) => product.status !== "Inactive"),
      marketOrders: (db.marketOrders || []).filter((order) => order.schoolId === user.schoolId),
      events: visibleEventsForUser(db, user),
      eventRegistrations: (db.eventRegistrations || []).filter((registration) => {
        const event = db.events.find((item) => item.id === registration.eventId);
        return event?.schoolId === user.schoolId || event?.scope === "Inter school";
      }),
      teacherResources: (db.teacherResources || []).filter((resource) => resource.schoolId === user.schoolId),
      reviewCycles: (db.reviewCycles || []).filter((cycle) => cycle.schoolId === user.schoolId)
    };
  }

  return full;
}

async function handleApi(req, res, url) {
  const db = await readJson(dbPath);
  const [, , resource, id, action] = url.pathname.split("/");

  if (req.method === "GET" && resource === "health") {
    sendJson(res, 200, {
      status: "ok",
      app: "yaara-consortium",
      time: new Date().toISOString(),
      sessions: sessions.size,
      storage: existsSync(dbPath) ? "ready" : "missing"
    });
    return;
  }

  if (req.method === "GET" && resource === "auth" && id === "session-config") {
    sendJson(res, 200, {
      enabled: false
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "gmail") {
    const body = await readBody(req);
    const googleProfile = body.credential || body.idToken ? await verifyGoogleCredential(body.credential || body.idToken) : null;
    const email = googleProfile?.email || validateEmailField(body.email, "login email");
    const submittedPassword = String(body.password || "");
    if (googleClientId && !googleProfile) {
      sendJson(res, 401, { error: "Google OAuth credential is required." });
      return;
    }
    if (!googleProfile) {
      const builtinEntry = Object.entries(yarraRoleAccounts).find(([, account]) => sanitizeEmail(account.email) === email);
      if (builtinEntry) {
        const [builtinRole, builtinAccount] = builtinEntry;
        if (normalizeRole(body.role) !== builtinRole || submittedPassword !== builtinAccount.password) {
          sendJson(res, 401, { error: "Invalid username, password, or role for this Yarra account." });
          return;
        }
      } else if (!submittedPassword.trim()) {
        sendJson(res, 401, { error: "Password is required." });
        return;
      }
    }
    const dbUser = usePostgres
      ? await resolveDbUser(email, body.role, body.schoolId, body.vendorId)
      : resolveLocalUser(db, email, body.role, body.schoolId, body.vendorId);
    if (!dbUser) {
      sendJson(res, 403, {
        error: "No Yarra invite was found for this Gmail account. Ask the Super Admin to onboard your school and use the same school admin email."
      });
      return;
    }
    const name = googleProfile?.name || dbUser?.display_name || email.split("@")[0].replace(/[._-]+/g, " ");
    const { token, session } = createSession({
      email,
      name,
      provider: googleProfile ? "google-oauth" : "gmail-dev",
      role: dbUser?.role || body.role || "School Admin",
      timeoutMinutes: body.timeoutMinutes,
      userId: dbUser?.id || null,
      schoolId: dbUser?.school_id || body.schoolId,
      studentId: dbUser?.student_id || (dbUser?.role === "Student" ? dbUser?.id : body.studentId),
      teacherId: dbUser?.teacher_id || body.teacherId,
      vendorId: dbUser?.vendor_id || body.vendorId
    });
    await audit("auth.login", req, session, { email, role: session.role });
    if (!usePostgres) await writeJson(dbPath, db);
    sendJson(res, 200, {
      email,
      name,
      provider: "gmail",
      role: session.role,
      schoolId: session.schoolId,
      studentId: session.studentId,
      teacherId: session.teacherId,
      vendorId: session.vendorId,
      session: publicSession(token, session)
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "extend") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    renewSession(sessionContext.session);
    await persistSessions();
    sendJson(res, 200, { session: publicSession(sessionContext.token, sessionContext.session) });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "role") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    const body = await readBody(req);
    const nextRole = normalizeRole(body.role);
    if (sessionContext.session.role !== "Super Admin" && nextRole !== sessionContext.session.role) {
      sendJson(res, 403, { error: "Only Super Admin can switch platform roles." });
      return;
    }
    sessionContext.session.role = nextRole;
    renewSession(sessionContext.session);
    await persistSessions();
    sendJson(res, 200, {
      email: sessionContext.session.email,
      name: sessionContext.session.name,
      provider: sessionContext.session.provider,
      role: sessionContext.session.role,
      schoolId: sessionContext.session.schoolId,
      studentId: sessionContext.session.studentId,
      teacherId: sessionContext.session.teacherId,
      vendorId: sessionContext.session.vendorId,
      session: publicSession(sessionContext.token, sessionContext.session)
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "logout") {
    const sessionContext = requireSession(req, res, { renew: false });
    if (!sessionContext) return;
    sessions.delete(sessionContext.hashedToken);
    await persistSessions();
    await audit("auth.logout", req, sessionContext.session);
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

  if (req.method === "POST" && resource === "payments" && id === "webhook") {
    const rawBody = await readBuffer(req);
    verifyRazorpayWebhook(rawBody, req.headers["x-razorpay-signature"]);
    const event = JSON.parse(rawBody.toString("utf8"));
    const payload = event.payload?.payment?.entity || event.payload?.payment_link?.entity || event.payload?.order?.entity || {};
    const notes = payload.notes || {};
    const gatewayPaymentId = payload.id || "";
    const gatewayOrderId = payload.order_id || payload.reference_id || "";
    const gatewayEventId = event.id || `${event.event}-${gatewayPaymentId || gatewayOrderId}`;
    const amount = Number(payload.amount || payload.amount_paid || 0) / 100;
    const schoolId = notes.school_id || notes.schoolId || null;
    const vendorId = notes.vendor_id || notes.vendorId || null;
    const schoolName = notes.school || notes.school_name || "member school";
    const isPaidEvent = ["payment.captured", "payment_link.paid", "order.paid"].includes(event.event);

    if (usePostgres && isPaidEvent) {
      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO payments (id, school_id, vendor_id, payment_type, amount, status, method, gateway_payment_id, gateway_order_id, gateway_event_id)
           VALUES ($1,$2,$3,$4,$5,'Paid','Razorpay',$6,$7,$8)
           ON CONFLICT (gateway_event_id) DO NOTHING`,
          [`pay-${slug(gatewayEventId)}`, schoolId, vendorId, notes.payment_type || "Membership", amount || 1, gatewayPaymentId, gatewayOrderId, gatewayEventId]
        );
        if (schoolId) {
          await client.query("UPDATE schools SET membership_status = 'Active', updated_at = now() WHERE id = $1", [schoolId]);
        }
        if (vendorId) {
          await client.query("UPDATE vendors SET promotion_status = 'Paid', updated_at = now() WHERE id = $1", [vendorId]);
        }
      });
    }

    if (!usePostgres && isPaidEvent) {
      const school = schoolId ? db.schools.find((item) => item.id === schoolId) : null;
      if (school) {
        school.status = "Active";
        school.membershipExpiry = "2027-05-18";
        upsertLocalSchoolAdminUser(db, school, "Active");
      }
      const existingPayment = db.payments.find((item) =>
        (gatewayEventId && item.gatewayEventId === gatewayEventId) ||
        (gatewayOrderId && item.gatewayOrderId === gatewayOrderId) ||
        (gatewayPaymentId && item.gatewayPaymentId === gatewayPaymentId)
      );
      if (existingPayment) {
        existingPayment.status = "Paid";
        existingPayment.method = "Razorpay";
        existingPayment.gatewayPaymentId = gatewayPaymentId || existingPayment.gatewayPaymentId || "";
        existingPayment.gatewayOrderId = gatewayOrderId || existingPayment.gatewayOrderId || "";
        existingPayment.gatewayEventId = gatewayEventId;
      } else {
        db.payments.unshift({
          id: createId("pay", school?.name || notes.payment_type || "payment"),
          schoolId,
          vendorId,
          type: notes.payment_type || "Membership",
          amount: amount || 1,
          status: "Paid",
          invoice: `YAARA-INV-${1000 + db.payments.length + 1}`,
          method: "Razorpay",
          gatewayPaymentId,
          gatewayOrderId,
          gatewayEventId,
          createdAt: new Date().toISOString().slice(0, 10)
        });
      }
      await writeJson(dbPath, db);
    }

    if (isPaidEvent) {
      await addNotification(`Payment received for ${schoolName}. Membership activation can be completed.`, "Super Admin");
      await addNotification(`Payment received for ${schoolName}. Membership activation can be completed.`, "School Admin");
    }

    await audit("payments.webhook", req, null, { event: event.event, gatewayEventId, schoolId, vendorId, verified: true });
    sendJson(res, 200, { received: true });
    return;
  }

  const sessionContext = requireSession(req, res);
  if (!sessionContext) return;
  const user = userFromRequest(req, url, sessionContext.session);

  if (req.method === "GET" && resource === "state") {
    sendJson(res, 200, filteredState(db, user));
    return;
  }

  if (req.method === "GET" && resource === "feed") {
    if (!usePostgres) {
      const state = filteredState(db, user);
      const items = [
        ...state.events.map((event) => ({ source: "event", id: event.id, title: event.title, body: `${event.type} - ${event.format}`, occurredAt: event.date })),
        ...state.content.map((item) => ({ source: "content", id: item.id, title: item.title, body: item.type, occurredAt: new Date().toISOString() }))
      ].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
      sendJson(res, 200, { items });
      return;
    }

    const schoolResult = user.schoolId ? await queryDb("SELECT has_early_years_curriculum FROM schools WHERE id = $1", [user.schoolId]) : { rows: [] };
    const hasEarlyYears = Boolean(schoolResult.rows[0]?.has_early_years_curriculum);
    const feed = await queryDb(
      `WITH unified AS (
         SELECT 'event' AS source, id, title, event_type AS body, event_date::timestamptz AS occurred_at, ARRAY[]::text[] AS tags, false AS age_gated_restricted, false AS is_vendor_promotional, ARRAY['School Admin','Teacher','Student']::text[] AS audience
         FROM events
         UNION ALL
         SELECT 'content' AS source, id, title, content_type AS body, published_at AS occurred_at, tags, age_gated_restricted, is_vendor_promotional, audience
         FROM content_library
         UNION ALL
         SELECT 'school_announcement' AS source, id, title, body, created_at AS occurred_at, ARRAY[]::text[] AS tags, false AS age_gated_restricted, false AS is_vendor_promotional, audience
         FROM school_announcements
       )
       SELECT source, id, title, body, occurred_at AS "occurredAt"
       FROM unified
       WHERE $1 = ANY(audience)
         AND NOT ($1 = 'Student' AND (age_gated_restricted = true OR is_vendor_promotional = true))
         AND NOT ($1 IN ('School Admin','Teacher') AND 'Yarra Early Years' = ANY(tags) AND $2 = false)
       ORDER BY occurred_at DESC
       LIMIT 80`,
      [user.role, hasEarlyYears]
    );
    sendJson(res, 200, { items: feed.rows });
    return;
  }

  if (req.method === "POST" && resource === "rfq" && id === "cart") {
    if (!usePostgres) {
      sendJson(res, 503, { error: "RFQ cart requires PostgreSQL mode." });
      return;
    }
    if (user.role !== "School Admin" && user.role !== "Super Admin") return deny(res);
    const body = await readJsonBody(req, ["vendorId"]);
    const cart = await withTransaction(async (client) => {
      const active = await client.query(
        `INSERT INTO rfq_carts (school_id, created_by)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [user.schoolId, user.id]
      );
      const cartRow = active.rows[0] || (await client.query(
        "SELECT * FROM rfq_carts WHERE school_id = $1 AND created_by = $2 AND status = 'Draft' ORDER BY created_at DESC LIMIT 1",
        [user.schoolId, user.id]
      )).rows[0];
      await client.query(
        `INSERT INTO rfq_cart_items (cart_id, vendor_id, notes, quantity)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (cart_id, vendor_id) DO UPDATE SET notes = EXCLUDED.notes, quantity = EXCLUDED.quantity`,
        [cartRow.id, body.vendorId, body.notes || "", clampNumber(body.quantity || 1, 1, 10000)]
      );
      return cartRow;
    });
    await audit("rfq.cart.add", req, user, { cartId: cart.id, vendorId: body.vendorId });
    sendJson(res, 201, { cartId: cart.id, vendorId: body.vendorId });
    return;
  }

  if (req.method === "POST" && resource === "vendors" && action === "reviews") {
    if (!usePostgres) {
      sendJson(res, 503, { error: "Vendor reviews require PostgreSQL mode." });
      return;
    }
    if (user.role !== "School Admin" && user.role !== "Super Admin") return deny(res);
    const body = await readJsonBody(req, ["rating", "comment"]);
    const review = await queryDb(
      `INSERT INTO vendor_reviews (vendor_id, school_id, author_user_id, rating, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (vendor_id, school_id, author_user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = now()
       RETURNING *`,
      [id, user.schoolId, user.id, clampNumber(body.rating, 1, 5), sanitizeText(body.comment)]
    );
    await audit("vendors.review", req, user, { vendorId: id, rating: body.rating });
    sendJson(res, 201, review.rows[0]);
    return;
  }

  if (req.method === "POST" && resource === "comments" && !id) {
    if (!usePostgres) {
      sendJson(res, 503, { error: "Threaded comments require PostgreSQL mode." });
      return;
    }
    const body = await readJsonBody(req, ["targetType", "targetId", "body"]);
    const comment = await queryDb(
      `INSERT INTO comments (target_type, target_id, parent_comment_id, author_user_id, body)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [body.targetType, body.targetId, body.parentCommentId || null, user.id, sanitizeText(body.body)]
    );
    await audit("comments.create", req, user, { targetType: body.targetType, targetId: body.targetId, parentCommentId: body.parentCommentId || null });
    sendJson(res, 201, comment.rows[0]);
    return;
  }

  if (req.method === "POST" && resource === "comments" && id === "flag") {
    if (!usePostgres) {
      sendJson(res, 503, { error: "Comment moderation requires PostgreSQL mode." });
      return;
    }
    const body = await readJsonBody(req, ["commentId"]);
    const comment = await queryDb(
      "UPDATE comments SET flagged_count = flagged_count + 1, updated_at = now() WHERE id = $1 RETURNING *",
      [body.commentId]
    );
    await audit("comments.flag", req, user, { commentId: body.commentId });
    sendJson(res, 200, comment.rows[0] || { flagged: false });
    return;
  }

  if (req.method === "POST" && resource === "templates" && id === "save") {
    const body = await readBody(req);
    const templateMap = {
      staff_roster: "Staff Database.xlsx",
      student_roster: "Student Database.xlsx"
    };
    const fileName = templateMap[body.uploadType] || templateMap.staff_roster;
    const source = join(root, "assets", "templates", fileName);
    if (s3Bucket) {
      const file = await readFile(source);
      const uploaded = await uploadAssetToS3({
        key: `templates/${fileName}`,
        body: file,
        contentType: mimeTypes[".xlsx"],
        fileName,
        purpose: "template",
        user
      });
      sendJson(res, 200, { fileName, path: uploaded.url, storage: "s3", ...uploaded });
      return;
    }
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
        school_id: body.schoolId || "",
        vendor_id: body.vendorId || "",
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
      description: body.description || `Yarra Consortium membership fee for ${body.schoolName || "member school"}`,
      customer: {
        name: body.schoolName || "Yaara member school",
        email: body.email || "admin@gmail.com"
      },
      notify: {
        sms: false,
        email: true
      },
      reminder_enable: false,
      notes: {
        school: body.schoolName || "Member school",
        school_name: body.schoolName || "Member school",
        school_id: body.schoolId || "",
        vendor_id: body.vendorId || "",
        payment_type: body.type || "Membership"
      }
    });

    let emailNotification;
    try {
      emailNotification = await notifyRazorpayPaymentLink(link.id, "email");
    } catch (error) {
      await audit("payments.link_email_failed", req, user, {
        school: body.schoolName || "member school",
        email: body.email || "",
        error: error.message
      });
      sendJson(res, 502, {
        error: `Razorpay created the payment link, but email delivery failed: ${error.message}`
      });
      return;
    }

    await addNotification(`Payment link emailed to ${body.email || "school billing contact"} for ${body.schoolName || "member school"}.`, "Super Admin");
    sendJson(res, 200, { ...link, emailNotification });
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
    if (s3Bucket) {
      await uploadAssetToS3({
        key: `uploads/rosters/${Date.now()}-${slug(file.filename) || "roster"}.xlsx`,
        body: file.content,
        contentType: mimeTypes[".xlsx"],
        fileName: file.filename || "roster.xlsx",
        purpose: "roster-upload",
        user
      });
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
        const student = {
          id: `student-${slug(record.student_id)}`,
          studentId: record.student_id,
          name: record.student_name,
          grade: record.grade,
          section: record.section,
          campus: record.campus,
          schoolId: user.schoolId,
          email: sanitizeEmail(record.student_mail_id),
          guardianEmail: "",
          age: Number(record.age || 13),
          status: "Invited",
          access: ["Competitions", "Student exchange", "Age-gated content"]
        };
        db.students.unshift(student);
        upsertLocalStudentUser(db, student, student.email, "Invited");
      }
    }

    if (uploadType === "staff_roster") {
      db.teachers ||= [];
      for (const record of records) {
        const teacher = {
          id: `teacher-${slug(record.employee_id)}`,
          employeeId: record.employee_id,
          name: record.name,
          email: sanitizeEmail(record.email),
          role: record.role,
          designation: record.designation,
          isHrt: /^yes$/i.test(record.is_hrt),
          campus: record.campus,
          grades: record.grades.split(",").map((grade) => grade.trim()).filter(Boolean),
          schoolId: user.schoolId,
          status: "Active"
        };
        db.teachers.unshift(teacher);
        upsertLocalTeacherUser(db, teacher, teacher.email, "Active");
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
    await audit("uploads.commit", req, user, { uploadType, recordCount: records.length, fileName: body.fileName });
    sendJson(res, 200, { status: "COMPLETED", recordCount: records.length, createdAt: committedAt });
    return;
  }

  if (req.method === "POST" && resource === "schools" && !id) {
    if (!canWrite(user, "schools")) return deny(res);
    const body = await readBody(req);
    const paymentPending = Boolean(body.paymentPending);
    const school = {
      id: createId("school", body.name),
      name: body.name,
      city: body.city || "",
      board: body.board || "CBSE",
      type: body.type || "K-12",
      contact: body.contact || "",
      earlyYears: Boolean(body.earlyYears),
      status: paymentPending ? "Payment pending" : "Active",
      membershipExpiry: paymentPending ? "" : "2027-05-18",
      achievements: []
    };
    db.schools.unshift(school);
    const invitedAdmin = upsertLocalSchoolAdminUser(db, school, paymentPending ? "Invited" : "Active");
    db.payments.unshift({
      id: createId("pay", school.name),
      schoolId: school.id,
      type: "Membership",
      amount: Number(body.amount || 25000),
      status: paymentPending ? "Payment link sent" : "Paid",
      invoice: `YAARA-INV-${1000 + db.payments.length + 1}`,
      method: body.paymentMethod || "Razorpay",
      gatewayPaymentId: body.gatewayPaymentId || "",
      gatewayOrderId: body.gatewayOrderId || "",
      createdAt: new Date().toISOString().slice(0, 10)
    });
    if (s3Bucket && !paymentPending) {
      await uploadAssetToS3({
        key: `invoices/${school.id}-${Date.now()}.txt`,
        body: Buffer.from(`Invoice for ${school.name}\nAmount: ${body.amount || 25000}\nStatus: Paid\n`, "utf8"),
        contentType: "text/plain; charset=utf-8",
        fileName: `${school.id}-invoice.txt`,
        purpose: "invoice-log",
        user
      });
    }
    if (invitedAdmin) {
      db.notifications ||= [];
      db.notifications.unshift(
        {
          id: createId("note", `${school.name}-admin-invite-superadmin`),
          audience: "Super Admin",
          title: `School Admin invite prepared for ${school.name}: ${invitedAdmin.email}.`,
          unread: true,
          createdAt: new Date().toISOString()
        },
        {
          id: createId("note", `${school.name}-admin-invite-schooladmin`),
          audience: "School Admin",
          title: `Your Yarra access is ready for ${school.name}. Sign in with ${invitedAdmin.email}.`,
          unread: true,
          createdAt: new Date().toISOString()
        }
      );
    }
    await writeJson(dbPath, db);
    await audit("schools.create", req, user, { schoolId: school.id, school: school.name, paymentPending });
    sendJson(res, 201, school);
    return;
  }

  if (req.method === "POST" && resource === "schools" && action === "activate-membership") {
    if (!canWrite(user, "schools")) return deny(res);
    const school = db.schools.find((item) => item.id === id);
    if (!school) {
      sendJson(res, 404, { error: "School not found" });
      return;
    }
    school.status = "Active";
    school.membershipExpiry = "2027-05-18";
    const payment = db.payments.find((item) => item.schoolId === school.id && item.type === "Membership");
    if (payment) {
      payment.status = "Paid";
      payment.method = payment.method || "Razorpay";
      payment.createdAt = new Date().toISOString().slice(0, 10);
    }
    const invitedAdmin = !usePostgres ? upsertLocalSchoolAdminUser(db, school, "Active") : null;
    if (usePostgres) {
      await addNotification(`Payment received for ${school.name}. Membership activated.`, "Super Admin");
      await addNotification(`Payment received for ${school.name}. Membership activated.`, "School Admin");
    } else {
      db.notifications ||= [];
      db.notifications.unshift(
        {
          id: createId("note", `${school.name}-payment-superadmin`),
          audience: "Super Admin",
          title: `Payment received for ${school.name}. Membership activated.`,
          unread: true,
          createdAt: new Date().toISOString()
        },
        {
          id: createId("note", `${school.name}-payment-schooladmin`),
          audience: "School Admin",
          title: `Payment received for ${school.name}. Membership activated.${invitedAdmin ? ` School Admin access is active for ${invitedAdmin.email}.` : ""}`,
          unread: true,
          createdAt: new Date().toISOString()
        }
      );
    }
    await writeJson(dbPath, db);
    await audit("schools.activate_membership", req, user, { schoolId: school.id, school: school.name });
    sendJson(res, 200, school);
    return;
  }

  if (req.method === "DELETE" && resource === "schools" && id) {
    if (!canWrite(user, "schools")) return deny(res);
    if (usePostgres) {
      sendJson(res, 501, { error: "School cascade delete is available in local JSON mode. Add database migrations before using it with PostgreSQL." });
      return;
    }

    const school = db.schools.find((item) => item.id === id);
    if (!school) {
      sendJson(res, 404, { error: "School not found." });
      return;
    }

    const eventIds = (db.events || [])
      .filter((event) => event.schoolId === school.id || event.host === school.name)
      .map((event) => event.id);
    const userIds = (db.users || [])
      .filter((item) => item.schoolId === school.id)
      .map((item) => item.id);
    const studentIds = (db.students || [])
      .filter((student) => student.schoolId === school.id)
      .map((student) => student.id);
    const teacherIds = (db.teachers || [])
      .filter((teacher) => teacher.schoolId === school.id)
      .map((teacher) => teacher.id);

    const before = {
      schools: (db.schools || []).length,
      users: (db.users || []).length,
      students: (db.students || []).length,
      teachers: (db.teachers || []).length,
      payments: (db.payments || []).length,
      events: (db.events || []).length,
      eventRegistrations: (db.eventRegistrations || []).length,
      content: (db.content || []).length,
      exchanges: (db.exchanges || []).length,
      notifications: (db.notifications || []).length,
      teacherResources: (db.teacherResources || []).length,
      reviewCycles: (db.reviewCycles || []).length,
      marketOrders: (db.marketOrders || []).length
    };

    db.schools = (db.schools || []).filter((item) => item.id !== school.id);
    db.users = (db.users || []).filter((item) => item.schoolId !== school.id && sanitizeEmail(item.email) !== sanitizeEmail(school.contact));
    db.students = (db.students || []).filter((student) => student.schoolId !== school.id);
    db.teachers = (db.teachers || []).filter((teacher) => teacher.schoolId !== school.id);
    db.payments = (db.payments || []).filter((payment) => payment.schoolId !== school.id);
    db.events = (db.events || []).filter((event) => event.schoolId !== school.id && event.host !== school.name);
    db.eventRegistrations = (db.eventRegistrations || []).filter((registration) =>
      registration.schoolId !== school.id &&
      !eventIds.includes(registration.eventId) &&
      !studentIds.includes(registration.studentId)
    );
    db.content = (db.content || []).filter((item) => item.schoolId !== school.id);
    db.exchanges = (db.exchanges || []).filter((exchange) => exchange.schoolId !== school.id && exchange.fromSchool !== school.name);
    db.notifications = (db.notifications || []).filter((notification) => {
      const text = `${notification.title || ""} ${notification.message || ""}`;
      return !text.includes(school.name) && !text.includes(school.contact || "");
    });
    db.teacherResources = (db.teacherResources || []).filter((resource) => resource.schoolId !== school.id);
    db.reviewCycles = (db.reviewCycles || []).filter((cycle) => cycle.schoolId !== school.id);
    db.marketOrders = (db.marketOrders || []).filter((order) =>
      order.schoolId !== school.id &&
      !studentIds.includes(order.buyerId) &&
      !teacherIds.includes(order.buyerId) &&
      !userIds.includes(order.buyerId)
    );

    for (const [hashedToken, session] of sessions.entries()) {
      if (session.schoolId === school.id || userIds.includes(session.userId) || studentIds.includes(session.studentId) || teacherIds.includes(session.teacherId)) {
        sessions.delete(hashedToken);
      }
    }

    const removed = {
      schools: before.schools - db.schools.length,
      users: before.users - db.users.length,
      students: before.students - db.students.length,
      teachers: before.teachers - db.teachers.length,
      payments: before.payments - db.payments.length,
      events: before.events - db.events.length,
      eventRegistrations: before.eventRegistrations - db.eventRegistrations.length,
      content: before.content - db.content.length,
      exchanges: before.exchanges - db.exchanges.length,
      notifications: before.notifications - db.notifications.length,
      teacherResources: before.teacherResources - db.teacherResources.length,
      reviewCycles: before.reviewCycles - db.reviewCycles.length,
      marketOrders: before.marketOrders - db.marketOrders.length
    };

    await writeJson(dbPath, db);
    await persistSessions();
    await audit("schools.delete", req, user, { schoolId: school.id, school: school.name, removed });
    sendJson(res, 200, { deleted: true, school, removed });
    return;
  }

  if (req.method === "POST" && resource === "events") {
    if (!canWrite(user, "events")) return deny(res);
    const body = await readBody(req);
    const event = {
      id: createId("event", body.title),
      title: body.title,
      type: body.type || "Workshop",
      scope: body.scope || "Intra school",
      schoolId: user.schoolId,
      format: body.format || "Virtual",
      date: body.date || new Date().toISOString().slice(0, 10),
      host: body.host || "Yaara Consortium",
      capacity: Number(body.capacity || 100),
      registered: 0,
      paid: Boolean(body.paid),
      fee: Boolean(body.paid) ? Number(body.fee || 0) : 0,
      description: body.description || "",
      venue: body.venue || "",
      startTime: body.startTime || "",
      endTime: body.endTime || "",
      eligibility: body.eligibility || "",
      registrationDeadline: body.registrationDeadline || "",
      coordinatorName: body.coordinatorName || user.email || "",
      coordinatorEmail: body.coordinatorEmail || user.email || "",
      formHeaderImage: body.formHeaderImage && typeof body.formHeaderImage === "object"
        ? {
            name: body.formHeaderImage.name || "event-header",
            size: Number(body.formHeaderImage.size || 0),
            type: body.formHeaderImage.type || "image",
            dataUrl: String(body.formHeaderImage.dataUrl || "")
          }
        : null,
      registrationQuestions: Array.isArray(body.registrationQuestions)
        ? body.registrationQuestions.map((question, index) => ({
            id: question.id || `q-${index + 1}`,
            label: question.label || question.question || `Question ${index + 1}`,
            type: question.type || "short",
            required: question.required !== false,
            options: Array.isArray(question.options) ? question.options.filter(Boolean) : [],
            accept: question.accept || ""
          }))
        : [],
      recording: false,
      materials: false
    };
    db.events.unshift(event);
    await writeJson(dbPath, db);
    await audit("events.create", req, user, { eventId: event.id, title: event.title });
    sendJson(res, 201, event);
    return;
  }

  if (req.method === "POST" && resource === "event-registrations" && !id) {
    if (!canWrite(user, "event-registrations")) return deny(res);
    const body = await readBody(req);
    const event = db.events.find((item) => item.id === body.eventId);
    if (!event) {
      sendJson(res, 404, { error: "Event not found." });
      return;
    }
    const isVisible = visibleEventsForUser(db, user).some((item) => item.id === event.id);
    if (!isVisible) return deny(res);

    const student = user.role === "Student"
      ? db.students.find((item) => item.id === user.studentId)
      : db.students.find((item) => item.id === body.studentId);
    if (!student) {
      sendJson(res, 400, { error: "Student account is required for registration." });
      return;
    }
    const existing = (db.eventRegistrations || []).find((item) => item.eventId === event.id && item.studentId === student.id && item.status !== "Cancelled");
    if (existing) {
      sendJson(res, 409, { error: "This student is already registered or waiting for payment." });
      return;
    }
    if (!event.paid && Number(event.registered || 0) >= Number(event.capacity || 0)) {
      sendJson(res, 409, { error: "Event capacity is full." });
      return;
    }

    const registration = {
      id: createId("event-reg", `${event.title}-${student.name}`),
      eventId: event.id,
      eventTitle: event.title,
      studentId: student.id,
      studentName: student.name,
      schoolId: student.schoolId,
      status: event.paid ? "Payment pending" : "Confirmed",
      paymentStatus: event.paid ? "Payment pending" : "Not required",
      amount: event.paid ? Number(event.fee || body.amount || 0) : 0,
      answers: body.answers && typeof body.answers === "object" ? body.answers : {},
      files: Array.isArray(body.files)
        ? body.files.map((file) => ({
            question: file.question || "File upload",
            name: file.name || "uploaded-file",
            size: Number(file.size || 0),
            type: file.type || "unknown"
          }))
        : [],
      createdAt: new Date().toISOString()
    };
    db.eventRegistrations ||= [];
    db.eventRegistrations.unshift(registration);
    if (!event.paid) {
      event.registered = Number(event.registered || 0) + 1;
    } else {
      db.payments ||= [];
      db.payments.unshift({
        id: createId("pay", `${event.title}-${student.name}`),
        schoolId: student.schoolId,
        type: "Event registration",
        amount: registration.amount,
        status: "Payment pending",
        invoice: `YAARA-EVT-${1000 + db.payments.length + 1}`,
        method: "Razorpay",
        eventId: event.id,
        registrationId: registration.id,
        createdAt: new Date().toISOString().slice(0, 10)
      });
    }
    await writeJson(dbPath, db);
    await audit("events.register", req, user, { eventId: event.id, registrationId: registration.id, paid: event.paid });
    sendJson(res, 201, registration);
    return;
  }

  if (req.method === "POST" && resource === "event-registrations" && action === "cancel") {
    if (!canWrite(user, "event-registrations")) return deny(res);
    const registration = (db.eventRegistrations || []).find((item) => item.id === id);
    if (!registration) {
      sendJson(res, 404, { error: "Registration not found." });
      return;
    }
    const event = db.events.find((item) => item.id === registration.eventId);
    const ownsEvent = ["School Admin", "Teacher"].includes(user.role) && event?.schoolId === user.schoolId;
    const ownsStudent = user.role === "Student" && registration.studentId === user.studentId;
    if (!ownsEvent && !ownsStudent) return deny(res);
    if (registration.status === "Confirmed" && event) {
      event.registered = Math.max(0, Number(event.registered || 0) - 1);
    }
    registration.status = "Cancelled";
    registration.cancelledAt = new Date().toISOString();
    await writeJson(dbPath, db);
    await audit("events.cancel_registration", req, user, { registrationId: registration.id, eventId: registration.eventId });
    sendJson(res, 200, registration);
    return;
  }

  if (req.method === "POST" && resource === "event-registrations" && action === "mark-paid") {
    if (!["School Admin", "Teacher"].includes(user.role)) return deny(res);
    const registration = (db.eventRegistrations || []).find((item) => item.id === id);
    if (!registration) {
      sendJson(res, 404, { error: "Registration not found." });
      return;
    }
    const event = db.events.find((item) => item.id === registration.eventId);
    if (!event || event.schoolId !== user.schoolId) return deny(res);
    if (Number(event.registered || 0) >= Number(event.capacity || 0)) {
      sendJson(res, 409, { error: "Event capacity is full." });
      return;
    }
    registration.status = "Confirmed";
    registration.paymentStatus = "Paid";
    registration.paidAt = new Date().toISOString();
    event.registered = Number(event.registered || 0) + 1;
    const payment = (db.payments || []).find((item) => item.registrationId === registration.id);
    if (payment) payment.status = "Paid";
    await writeJson(dbPath, db);
    await audit("events.mark_registration_paid", req, user, { registrationId: registration.id, eventId: event.id });
    sendJson(res, 200, registration);
    return;
  }

  if (req.method === "POST" && resource === "students") {
    if (!canWrite(user, "students")) return deny(res);
    const body = await readBody(req);
    const accessEmail = validateEmailField(body.email || body.studentEmail || body.guardianEmail, "student login email");
    const student = {
      id: createId("student", body.name),
      studentId: body.studentId || "",
      email: accessEmail,
      name: body.name,
      grade: body.grade || "Grade 8",
      age: Number(body.age || 13),
      schoolId: body.schoolId || db.schools[0]?.id,
      guardianEmail: body.guardianEmail || "",
      status: "Invited",
      access: Array.isArray(body.access) ? body.access : ["Competitions", "Student exchange", "Age-gated content"]
    };
    db.students ||= [];
    db.students.unshift(student);
    const invitedStudent = upsertLocalStudentUser(db, student, accessEmail, "Invited");
    db.notifications ||= [];
    db.notifications.unshift(
      {
        id: createId("note", `${student.name}-student-invite-schooladmin`),
        audience: "School Admin",
        title: `Student access invited for ${student.name}: ${invitedStudent.email}.`,
        unread: true,
        createdAt: new Date().toISOString()
      },
      {
        id: createId("note", `${student.name}-student-invite-student`),
        audience: "Student",
        title: `Your Yarra student access is ready. Sign in with ${invitedStudent.email}.`,
        unread: true,
        createdAt: new Date().toISOString()
      }
    );
    await writeJson(dbPath, db);
    await audit("students.invite", req, user, { studentId: student.id, schoolId: student.schoolId, email: invitedStudent.email });
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
    if (s3Bucket) {
      await uploadAssetToS3({
        key: `invoices/${payment.id}.txt`,
        body: Buffer.from(`Invoice: ${payment.invoice}\nType: ${payment.type}\nAmount: ${payment.amount}\nStatus: ${payment.status}\n`, "utf8"),
        contentType: "text/plain; charset=utf-8",
        fileName: `${payment.invoice}.txt`,
        purpose: "invoice-log",
        user
      });
    }
    await writeJson(dbPath, db);
    await audit("payments.record", req, user, { paymentId: payment.id, schoolId: payment.schoolId, amount: payment.amount });
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
    await audit("exchanges.create", req, user, { exchangeId: exchange.id, type: exchange.type });
    sendJson(res, 201, exchange);
    return;
  }

  if (req.method === "POST" && resource === "teacher-resources") {
    if (!canWrite(user, "teacher-resources")) return deny(res);
    const body = await readBody(req);
    const resourceItem = {
      id: createId("resource", body.title),
      schoolId: user.role === "Super Admin" ? body.schoolId || db.schools[0]?.id || "" : user.schoolId,
      title: body.title || "Teacher resource",
      type: body.type || "Resource Document",
      presenter: body.presenter || user.email || "",
      sessionDate: body.sessionDate || "",
      sessionTime: body.sessionTime || "",
      duration: body.duration || "",
      capacity: Number(body.capacity || 0),
      link: body.link || "",
      fileName: body.fileName || "",
      notes: body.notes || "",
      uploadedBy: user.email || user.role,
      createdAt: new Date().toISOString()
    };
    db.teacherResources ||= [];
    db.teacherResources.unshift(resourceItem);
    await writeJson(dbPath, db);
    await audit("teacher_resources.create", req, user, { resourceId: resourceItem.id, title: resourceItem.title });
    sendJson(res, 201, resourceItem);
    return;
  }

  if (req.method === "POST" && resource === "review-cycles") {
    if (!canWrite(user, "review-cycles")) return deny(res);
    const body = await readBody(req);
    const cycle = {
      id: createId("review", body.title),
      schoolId: user.role === "Super Admin" ? body.schoolId || db.schools[0]?.id || "" : user.schoolId,
      title: body.title || "School improvement review",
      startDate: body.startDate || "",
      endDate: body.endDate || "",
      selfStudyStatus: body.selfStudyStatus || "Not Started",
      reviewVisitStatus: body.reviewVisitStatus || "Not Started",
      sipStatus: body.sipStatus || "Not Started",
      recommendationsStatus: body.recommendationsStatus || "Not Started",
      notes: body.notes || "",
      createdAt: new Date().toISOString()
    };
    db.reviewCycles ||= [];
    db.reviewCycles.unshift(cycle);
    await writeJson(dbPath, db);
    await audit("review_cycles.create", req, user, { cycleId: cycle.id, title: cycle.title });
    sendJson(res, 201, cycle);
    return;
  }

  if (req.method === "POST" && resource === "leadership-threads" && !id) {
    if (!canWrite(user, "leadership-threads")) return deny(res);
    const body = await readBody(req);
    const thread = {
      id: createId("leader-thread", body.title),
      title: body.title || "Leadership discussion",
      prompt: body.prompt || "",
      forumDate: body.forumDate || new Date().toISOString().slice(0, 10),
      author: user.email || user.role,
      schoolId: user.schoolId || null,
      schoolName: db.schools.find((school) => school.id === user.schoolId)?.name || "Yarra Consortium",
      replies: [],
      takeaways: body.takeaway
        ? [{
            id: createId("takeaway", body.takeaway),
            text: sanitizeText(body.takeaway, ""),
            author: user.email || user.role,
            createdAt: new Date().toISOString()
          }]
        : [],
      createdAt: new Date().toISOString()
    };
    db.leadershipThreads ||= [];
    db.leadershipThreads.unshift(thread);
    await writeJson(dbPath, db);
    await audit("leadership.thread_create", req, user, { threadId: thread.id });
    sendJson(res, 201, thread);
    return;
  }

  if (req.method === "POST" && resource === "leadership-threads" && ["reply", "takeaway"].includes(action)) {
    if (!canWrite(user, "leadership-threads")) return deny(res);
    const thread = (db.leadershipThreads || []).find((item) => item.id === id);
    if (!thread) {
      sendJson(res, 404, { error: "Leadership thread not found." });
      return;
    }
    const body = await readBody(req);
    const text = sanitizeText(body.text || "", "");
    if (!text) {
      sendJson(res, 400, { error: "Text is required." });
      return;
    }
    if (action === "reply") {
      thread.replies ||= [];
      thread.replies.unshift({
        id: createId("leader-reply", text),
        text,
        author: user.email || user.role,
        role: user.role,
        createdAt: new Date().toISOString()
      });
    }
    if (action === "takeaway") {
      thread.takeaways ||= [];
      thread.takeaways.unshift({
        id: createId("takeaway", text),
        text,
        author: user.email || user.role,
        createdAt: new Date().toISOString()
      });
    }
    await writeJson(dbPath, db);
    await audit(`leadership.${action}`, req, user, { threadId: thread.id });
    sendJson(res, 200, thread);
    return;
  }

  if (req.method === "POST" && resource === "content" && !id) {
    if (!canWrite(user, "content")) return deny(res);
    const body = await readBody(req);
    const type = body.type || "Article";
    const contentItem = {
      id: createId("content", body.title || type),
      title: body.title || "Untitled post",
      type,
      speaker: body.speaker || user.email || "Yarra member",
      authorRole: user.role,
      schoolId: user.schoolId || null,
      category: body.category || "Community",
      body: body.body || "",
      mediaUrl: body.mediaUrl || "",
      thumbnailUrl: body.thumbnailUrl || body.mediaUrl || "",
      tags: Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
      audience: Array.isArray(body.audience) ? body.audience : ["School Admin", "Teacher", "Student"],
      minAge: Number(body.minAge || 5),
      maxAge: Number(body.maxAge || 18),
      restrictedToEarlyYears: Boolean(body.restrictedToEarlyYears),
      isVendorPromotional: false,
      likes: 0,
      likedBy: [],
      saved: 0,
      savedBy: [],
      comments: 0,
      commentThreads: [],
      views: 0,
      createdAt: new Date().toISOString()
    };
    db.content ||= [];
    db.content.unshift(contentItem);
    await writeJson(dbPath, db);
    await audit("content.create", req, user, { contentId: contentItem.id, type: contentItem.type });
    sendJson(res, 201, contentItem);
    return;
  }

  if (req.method === "POST" && resource === "content" && ["like", "save", "comment"].includes(action)) {
    if (!canWrite(user, "content", action)) return deny(res);
    const item = db.content.find((contentItem) => contentItem.id === id);
    if (!item) {
      sendJson(res, 404, { error: "Content not found." });
      return;
    }
    const actor = user.email || user.id || user.role;
    if (action === "like") {
      item.likedBy ||= [];
      if (item.likedBy.includes(actor)) {
        item.likedBy = item.likedBy.filter((entry) => entry !== actor);
      } else {
        item.likedBy.push(actor);
      }
      item.likes = item.likedBy.length;
    }
    if (action === "save") {
      item.savedBy ||= [];
      if (item.savedBy.includes(actor)) {
        item.savedBy = item.savedBy.filter((entry) => entry !== actor);
      } else {
        item.savedBy.push(actor);
      }
      item.saved = item.savedBy.length;
    }
    if (action === "comment") {
      const body = await readBody(req);
      const text = sanitizeText(body.text || "", "");
      if (!text) {
        sendJson(res, 400, { error: "Comment cannot be empty." });
        return;
      }
      item.commentThreads ||= [];
      item.commentThreads.unshift({
        id: createId("comment", text),
        author: user.email || user.role,
        role: user.role,
        text,
        createdAt: new Date().toISOString()
      });
      item.comments = item.commentThreads.length;
    }
    await writeJson(dbPath, db);
    await audit(`content.${action}`, req, user, { contentId: item.id });
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "POST" && resource === "vendor-products" && !id) {
    if (!canWrite(user, "vendor-products")) return deny(res);
    const body = await readBody(req);
    let vendor = db.vendors.find((item) => item.id === user.vendorId) || db.vendors.find((item) => sanitizeEmail(item.contact) === sanitizeEmail(user.email));
    if (!vendor) {
      vendor = {
        id: user.vendorId || createId("vendor", user.email || "vendor"),
        name: user.name || `${(user.email || "Vendor").split("@")[0]} Store`,
        category: body.category || "EdTech",
        contact: user.email || "",
        offer: "Marketplace seller storefront",
        status: "Approved",
        featured: false
      };
      db.vendors ||= [];
      db.vendors.unshift(vendor);
    }
    const product = {
      id: createId("product", body.name),
      vendorId: vendor.id,
      vendorName: vendor.name,
      name: body.name || "Marketplace product",
      category: body.category || vendor.category || "EdTech",
      description: body.description || "",
      price: Number(body.price || 0),
      stock: Number(body.stock || 0),
      audience: body.audience || "All members",
      delivery: body.delivery || "Standard delivery",
      imageUrl: body.imageUrl || "",
      status: "Active",
      rating: Number(body.rating || 4.5),
      createdAt: new Date().toISOString()
    };
    db.vendorProducts ||= [];
    db.vendorProducts.unshift(product);
    await writeJson(dbPath, db);
    await audit("market.product_create", req, user, { productId: product.id, vendorId: vendor.id });
    sendJson(res, 201, product);
    return;
  }

  if (req.method === "POST" && resource === "market-orders" && !id) {
    if (!canWrite(user, "market-orders")) return deny(res);
    const body = await readBody(req);
    const cartItems = Array.isArray(body.items) ? body.items : [];
    const items = cartItems.map((cartItem) => {
      const product = (db.vendorProducts || []).find((item) => item.id === cartItem.productId);
      if (!product) return null;
      const quantity = clampNumber(cartItem.quantity || 1, 1, Math.max(1, Number(product.stock || 9999)));
      return {
        productId: product.id,
        vendorId: product.vendorId,
        name: product.name,
        price: Number(product.price || 0),
        quantity
      };
    }).filter(Boolean);
    if (!items.length) {
      sendJson(res, 400, { error: "Cart is empty." });
      return;
    }
    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const order = {
      id: `YAARA-ORD-${1000 + (db.marketOrders || []).length + 1}`,
      buyerRole: user.role,
      buyerEmail: user.email || "",
      buyerId: user.studentId || user.teacherId || user.id || null,
      buyerName: user.email || user.role,
      schoolId: user.schoolId || null,
      items,
      total,
      status: "Placed",
      tracking: ["Placed"],
      paymentStatus: "Payment pending",
      createdAt: new Date().toISOString()
    };
    db.marketOrders ||= [];
    db.marketOrders.unshift(order);
    for (const item of items) {
      const product = db.vendorProducts.find((entry) => entry.id === item.productId);
      if (product) product.stock = Math.max(0, Number(product.stock || 0) - item.quantity);
    }
    await writeJson(dbPath, db);
    await audit("market.order_create", req, user, { orderId: order.id, total });
    sendJson(res, 201, order);
    return;
  }

  if (req.method === "POST" && resource === "market-orders" && action === "advance") {
    if (!canWrite(user, "market-orders", "advance")) return deny(res);
    const order = (db.marketOrders || []).find((item) => item.id === id);
    if (!order) {
      sendJson(res, 404, { error: "Order not found." });
      return;
    }
    if (!(order.items || []).some((item) => item.vendorId === user.vendorId)) return deny(res);
    const steps = ["Placed", "Confirmed", "Packed", "Shipped", "Delivered"];
    const currentIndex = Math.max(0, steps.indexOf(order.status));
    const next = steps[Math.min(steps.length - 1, currentIndex + 1)];
    order.status = next;
    order.tracking = steps.slice(0, steps.indexOf(next) + 1);
    if (next === "Confirmed") order.paymentStatus = "Payment requested";
    if (next === "Delivered") order.deliveredAt = new Date().toISOString();
    await writeJson(dbPath, db);
    await audit("market.order_advance", req, user, { orderId: order.id, status: order.status });
    sendJson(res, 200, order);
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
    await audit("vendors.approve", req, user, { vendorId: vendor.id });
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
    await audit("vendors.apply", req, user, { vendorId: vendor.id, category: vendor.category });
    sendJson(res, 201, vendor);
    return;
  }

  if (req.method === "POST" && resource === "notifications" && id === "read") {
    db.notifications.forEach((notification) => {
      notification.unread = false;
    });
    await writeJson(dbPath, db);
    await audit("notifications.read", req, user);
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
    setSecurityHeaders(res);
    cleanupRuntimeStores();

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      const isAuthRequest = url.pathname.startsWith("/api/auth/");
      if (!enforceRateLimit(
        req,
        res,
        isAuthRequest ? "auth" : "api",
        isAuthRequest ? authRateLimitMax : apiRateLimitMax,
        isAuthRequest ? authRateLimitWindowMs : apiRateLimitWindowMs
      )) {
        return;
      }
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Server error" });
  }
}).listen(port, host, () => {
  const shownHost = host === "0.0.0.0" ? "localhost" : host;
  console.log(`Yaara Consortium app running at http://${shownHost}:${port}`);
});
