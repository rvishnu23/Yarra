import { createServer } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { appendFile, copyFile, readFile, rename, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, "data");
const dbPath = join(dataDir, "db.json");
const auditLogPath = join(dataDir, "audit.log");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
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
const defaultSessionTimeoutMinutes = clampNumber(process.env.SESSION_TIMEOUT_MINUTES || 30, 1, 240);
const sessionTimeoutOptions = [1, 5, 15, 30, 60, 120];
const maxRequestBytes = clampNumber(process.env.MAX_REQUEST_BYTES || 10 * 1024 * 1024, 1024, 50 * 1024 * 1024);
const authRateLimitWindowMs = clampNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS || 60 * 1000, 1000, 60 * 60 * 1000);
const authRateLimitMax = clampNumber(process.env.AUTH_RATE_LIMIT_MAX || 10, 1, 200);
const apiRateLimitWindowMs = clampNumber(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000, 1000, 60 * 60 * 1000);
const apiRateLimitMax = clampNumber(process.env.API_RATE_LIMIT_MAX || 240, 10, 5000);
const sessions = new Map();
const rateLimits = new Map();

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

const emptyState = {
  schools: [],
  students: [],
  teachers: [],
  vendors: [],
  events: [],
  exchanges: [],
  content: [],
  promotions: [],
  notifications: [],
  payments: [],
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
}

async function readJson(path) {
  if (usePostgres && path === dbPath) {
    return readStateFromPostgres();
  }
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  if (usePostgres && path === dbPath) {
    await persistStateToPostgres(value);
    return;
  }
  const tempPath = `${path}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, path);
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
  for (const [key, session] of sessions.entries()) {
    if (Date.parse(session.expiresAt) <= now) sessions.delete(key);
  }
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

function createSession({ email, name, provider, role, timeoutMinutes, userId, schoolId, vendorId }) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date().toISOString();
  const session = {
    email,
    name,
    provider,
    role: normalizeRole(role),
    userId: userId || null,
    schoolId: schoolId || "school-greenfield",
    vendorId: vendorId || "vendor-learngrid",
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
    id: session?.userId || null,
    email: session?.email || null,
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
    const visibleSchoolIds = db.schools
      .filter((school) => school.id === user.schoolId || ["Active", "Payment pending"].includes(school.status))
      .map((school) => school.id);
    return {
      ...full,
      schools: db.schools.filter((school) => visibleSchoolIds.includes(school.id)),
      students: db.students.filter((student) => student.schoolId === user.schoolId),
      payments: db.payments.filter((payment) => visibleSchoolIds.includes(payment.schoolId))
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
      defaultTimeoutMinutes: defaultSessionTimeoutMinutes,
      timeoutOptions: sessionTimeoutOptions,
      minTimeoutMinutes: 1,
      maxTimeoutMinutes: 240
    });
    return;
  }

  if (req.method === "POST" && resource === "auth" && id === "gmail") {
    const body = await readBody(req);
    const googleProfile = body.credential || body.idToken ? await verifyGoogleCredential(body.credential || body.idToken) : null;
    const email = googleProfile?.email || String(body.email || "").trim().toLowerCase();
    if (!email.endsWith("@gmail.com")) {
      sendJson(res, 400, { error: "Please use a Gmail account." });
      return;
    }
    if (googleClientId && !googleProfile) {
      sendJson(res, 401, { error: "Google OAuth credential is required." });
      return;
    }
    const dbUser = await resolveDbUser(email, body.role, body.schoolId, body.vendorId);
    const name = googleProfile?.name || dbUser?.display_name || email.split("@")[0].replace(/[._-]+/g, " ");
    const { token, session } = createSession({
      email,
      name,
      provider: googleProfile ? "google-oauth" : "gmail-dev",
      role: dbUser?.role || body.role || "School Admin",
      timeoutMinutes: body.timeoutMinutes,
      userId: dbUser?.id || null,
      schoolId: dbUser?.school_id || body.schoolId,
      vendorId: dbUser?.vendor_id || body.vendorId
    });
    await audit("auth.login", req, session, { email, role: session.role, timeoutMinutes: session.timeoutMinutes });
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
      staff_roster: "staff_roster_template.xlsx",
      student_roster: "student_roster_template.xlsx"
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
    await addNotification(`Payment received for ${school.name}. Membership activated.`, "Super Admin");
    await addNotification(`Payment received for ${school.name}. Membership activated.`, "School Admin");
    await writeJson(dbPath, db);
    await audit("schools.activate_membership", req, user, { schoolId: school.id, school: school.name });
    sendJson(res, 200, school);
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
    await audit("events.create", req, user, { eventId: event.id, title: event.title });
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
    await audit("students.invite", req, user, { studentId: student.id, schoolId: student.schoolId });
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
