"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const initSqlJs = require("sql.js");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "acadiq.db");
const DEFAULT_STUDENT_PASSWORD = "learn123";
let DB;

/* ---------- database helpers (all queries are parameterized) ---------- */
function persist() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(DB.export()));
}
function all(sql, params = []) {
  const st = DB.prepare(sql);
  st.bind(params);
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
}
const get = (sql, params) => all(sql, params)[0];
const run = (sql, params = []) => DB.run(sql, params);
const lastId = () => get("SELECT last_insert_rowid() AS id").id;
const audit = (who, action) =>
  run("INSERT INTO audit(at, user_name, action) VALUES (?,?,?)", [new Date().toISOString(), who, action]);
const inList = (ids) => ids.map(() => "?").join(",");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS classes (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, class_id INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS subjects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, class_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assessments (id INTEGER PRIMARY KEY, subject_id INTEGER NOT NULL, title TEXT NOT NULL, max_score REAL NOT NULL);
CREATE TABLE IF NOT EXISTS marks (assessment_id INTEGER NOT NULL, student_id INTEGER NOT NULL, score REAL NOT NULL, PRIMARY KEY (assessment_id, student_id));
CREATE TABLE IF NOT EXISTS attendance (date TEXT NOT NULL, student_id INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY (date, student_id));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, teacher_id INTEGER, student_id INTEGER);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_name TEXT NOT NULL, action TEXT NOT NULL);
`;

function seed() {
  if (get("SELECT COUNT(*) AS n FROM users").n > 0) return;
  const marks = {
    Mathematics: [[62, 55, 48], [80, 84, 88], [45, 42, 38], [74, 70, 77]],
    English: [[70, 72, 75], [65, 62, 60], [55, 58, 52], [82, 85, 80]],
    Science: [[58, 60, 63], [72, 75, 78], [48, 45, 41], [68, 71, 70]],
    History: [[66, 64, 68], [70, 74, 73], [60, 58, 57], [75, 72, 78]],
  };
  const students = ["Aline Uwase", "Eric Mugisha", "Diane Ineza", "Jean Bosco Niyonzima"];
  run("INSERT INTO teachers VALUES (1,'Mr. Habimana'),(2,'Ms. Uwera')");
  run("INSERT INTO classes VALUES (1,'S3A'),(2,'S3B')");
  students.forEach((n, i) => run("INSERT INTO students VALUES (?,?,1,1)", [i + 1, n]));
  Object.keys(marks).forEach((subject, i) => {
    run("INSERT INTO subjects VALUES (?,?,1,?)", [i + 1, subject, i % 2 ? 2 : 1]);
    for (let k = 0; k < 3; k++) {
      const aid = i * 3 + k + 1;
      run("INSERT INTO assessments VALUES (?,?,?,100)", [aid, i + 1, "Test " + (k + 1)]);
      marks[subject].forEach((row, si) => run("INSERT INTO marks VALUES (?,?,?)", [aid, si + 1, row[k]]));
    }
  });
  [1, 0, 3, 0].forEach((absences, si) => {
    for (let k = 1; k <= 10; k++) {
      const d = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
      run("INSERT INTO attendance VALUES (?,?,?)", [d, si + 1, k <= absences ? "A" : "P"]);
    }
  });
  run("INSERT INTO settings VALUES ('min_mark',50),('min_att',80)");
  const hash = (p) => bcrypt.hashSync(p, 10);
  run("INSERT INTO users(username,password_hash,role,name) VALUES ('admin',?, 'admin','Administrator')", [hash("admin123")]);
  run("INSERT INTO users(username,password_hash,role,name,teacher_id) VALUES ('teacher1',?, 'teacher','Mr. Habimana',1)", [hash("teach123")]);
  run("INSERT INTO users(username,password_hash,role,name,teacher_id) VALUES ('teacher2',?, 'teacher','Ms. Uwera',2)", [hash("teach123")]);
  const sh = hash(DEFAULT_STUDENT_PASSWORD);
  students.forEach((n, i) =>
    run("INSERT INTO users(username,password_hash,role,name,student_id) VALUES (?,?,'student',?,?)", [n.split(" ")[0].toLowerCase(), sh, n, i + 1])
  );
}

/* ---------- authorization helpers ---------- */
const teacherClasses = (u) => all("SELECT DISTINCT class_id FROM subjects WHERE teacher_id=?", [u.teacherId]).map((r) => r.class_id);
const need = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  if (roles.length && !roles.includes(req.session.user.role)) return res.status(403).json({ error: "You do not have permission to do that." });
  next();
};
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const cleanName = (s, min, max) => {
  const t = typeof s === "string" ? s.trim().replace(/\s+/g, " ") : "";
  return t.length >= min && t.length <= max ? t : null;
};
const classAllowed = (u, classId) =>
  !!get("SELECT id FROM classes WHERE id=?", [classId]) && (u.role === "admin" || teacherClasses(u).includes(classId));

/* ---------- app ---------- */
function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use((req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin", "Cache-Control": "no-store" });
    next();
  });
  app.use(
    session({
      secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 10 * 60 * 1000 },
    })
  );
  app.use(express.static(path.join(__dirname, "public"), { setHeaders: (r) => r.set("Cache-Control", "no-cache") }));

  const publicUser = (u) => ({ role: u.role, name: u.name, tid: u.teacherId, sid: u.studentId });
  const fails = new Map();

  app.post("/api/login", (req, res) => {
    const ip = req.ip, f = fails.get(ip);
    if (f && f.n >= 10 && Date.now() - f.t < 10 * 60 * 1000) return bad(res, "Too many failed attempts. Try again in 10 minutes.", 429);
    const username = typeof req.body?.username === "string" ? req.body.username.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const row = username ? get("SELECT * FROM users WHERE username=?", [username]) : null;
    const active = row && (!row.student_id || get("SELECT active FROM students WHERE id=?", [row.student_id])?.active === 1);
    if (!row || !active || !bcrypt.compareSync(password, row.password_hash)) {
      fails.set(ip, { n: (f && Date.now() - f.t < 10 * 60 * 1000 ? f.n : 0) + 1, t: Date.now() });
      return bad(res, "Incorrect username or password.", 401);
    }
    fails.delete(ip);
    req.session.regenerate((err) => {
      if (err) return bad(res, "Could not start a session.", 500);
      req.session.user = { id: row.id, role: row.role, name: row.name, teacherId: row.teacher_id, studentId: row.student_id };
      audit(row.name, "Signed in");
      persist();
      res.json({ user: publicUser(req.session.user) });
    });
  });

  app.post("/api/logout", (req, res) => {
    const u = req.session.user;
    if (u) { audit(u.name, "Signed out"); persist(); }
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/me", need(), (req, res) => res.json({ user: publicUser(req.session.user) }));

  /* Role-scoped data: each role only receives what it is allowed to see. */
  app.get("/api/data", need(), (req, res) => {
    const u = req.session.user;
    const cfg = { mark: get("SELECT value FROM settings WHERE key='min_mark'").value, att: get("SELECT value FROM settings WHERE key='min_att'").value };
    let classes = [], students = [], subjects = [];
    const SF = "SELECT id,name,class_id AS cid,teacher_id AS tid FROM subjects";
    const ST = "SELECT id,name,class_id AS cid FROM students WHERE active=1";
    if (u.role === "admin") {
      classes = all("SELECT id,name FROM classes");
      students = all(ST);
      subjects = all(SF);
    } else {
      const cids = u.role === "teacher" ? teacherClasses(u) : [get("SELECT class_id FROM students WHERE id=?", [u.studentId])?.class_id].filter(Boolean);
      if (cids.length) {
        classes = all(`SELECT id,name FROM classes WHERE id IN (${inList(cids)})`, cids);
        subjects = all(`${SF} WHERE class_id IN (${inList(cids)})`, cids);
        students = u.role === "teacher"
          ? all(`${ST} AND class_id IN (${inList(cids)})`, cids)
          : all(`${ST} AND id=?`, [u.studentId]);
      }
    }
    students = students.map((s) => ({ ...s, on: 1 }));
    const sids = students.map((s) => s.id), jids = subjects.map((j) => j.id);
    const assess = jids.length ? all(`SELECT id,subject_id AS sid,title,max_score AS max FROM assessments WHERE subject_id IN (${inList(jids)})`, jids) : [];
    const marks = {};
    if (assess.length && sids.length) {
      all(`SELECT assessment_id,student_id,score FROM marks WHERE assessment_id IN (${inList(assess.map((a) => a.id))}) AND student_id IN (${inList(sids)})`, [...assess.map((a) => a.id), ...sids])
        .forEach((m) => (marks[m.assessment_id + "-" + m.student_id] = m.score));
    }
    const att = {};
    if (sids.length) {
      all(`SELECT date,student_id,status FROM attendance WHERE student_id IN (${inList(sids)})`, sids)
        .forEach((a) => ((att[a.date] = att[a.date] || {})[a.student_id] = a.status));
    }
    const out = { cfg, classes, students, subjects, assess, marks, att, teachers: all("SELECT id,name FROM teachers") };
    if (u.role === "admin") out.audit = all("SELECT at, user_name AS w, action AS x FROM audit ORDER BY id DESC LIMIT 200");
    res.json(out);
  });

  /* FR-06 assessments */
  app.post("/api/assessments", need("teacher"), (req, res) => {
    const u = req.session.user, subj = get("SELECT * FROM subjects WHERE id=? AND teacher_id=?", [+req.body?.subjectId, u.teacherId]);
    if (!subj) return bad(res, "You can only create assessments for your assigned subjects.", 403);
    const title = cleanName(req.body.title, 1, 60), max = Number(req.body.max);
    if (!title || !(max >= 1 && max <= 1000)) return bad(res, "Enter a title and a maximum score from 1 to 1000.");
    run("INSERT INTO assessments(subject_id,title,max_score) VALUES (?,?,?)", [subj.id, title, max]);
    const id = lastId();
    audit(u.name, `Created assessment ${title} (max ${max}) for ${subj.name}`);
    persist();
    res.json({ id });
  });

  /* FR-07 / FR-08 marks entry and validation */
  app.post("/api/marks", need("teacher"), (req, res) => {
    const u = req.session.user;
    const a = get("SELECT a.id,a.title,a.max_score,s.name AS subject,s.class_id FROM assessments a JOIN subjects s ON s.id=a.subject_id WHERE a.id=? AND s.teacher_id=?", [+req.body?.assessmentId, u.teacherId]);
    if (!a) return bad(res, "You can only enter marks for your assigned subjects.", 403);
    const scores = req.body.scores && typeof req.body.scores === "object" ? req.body.scores : {};
    const todo = [];
    for (const [sid, raw] of Object.entries(scores)) {
      const st = get("SELECT id,name FROM students WHERE id=? AND class_id=? AND active=1", [+sid, a.class_id]);
      if (!st) return bad(res, "A student in the request does not belong to this class.", 403);
      const blank = raw === null || (typeof raw === "string" && raw.trim() === "");
      const n = Number(raw);
      if (!blank && (!Number.isFinite(n) || n < 0 || n > a.max_score)) return bad(res, `Rejected: ${st.name}'s score must be between 0 and ${a.max_score}. Nothing was saved.`);
      todo.push({ st, blank, n });
    }
    let changed = 0;
    todo.forEach(({ st, blank, n }) => {
      const old = get("SELECT score FROM marks WHERE assessment_id=? AND student_id=?", [a.id, st.id])?.score;
      if (blank) {
        if (old !== undefined) { run("DELETE FROM marks WHERE assessment_id=? AND student_id=?", [a.id, st.id]); audit(u.name, `${a.subject} ${a.title} for ${st.name}: ${old} removed`); changed++; }
      } else if (old !== n) {
        run("INSERT OR REPLACE INTO marks VALUES (?,?,?)", [a.id, st.id, n]);
        audit(u.name, `${a.subject} ${a.title} for ${st.name}: ${old ?? "none"} to ${n}`);
        changed++;
      }
    });
    persist();
    res.json({ changed });
  });

  /* FR-10 attendance */
  app.post("/api/attendance", need("teacher"), (req, res) => {
    const u = req.session.user, classId = +req.body?.classId, date = req.body?.date;
    if (!teacherClasses(u).includes(classId)) return bad(res, "You can only record attendance for your assigned classes.", 403);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) return bad(res, "Choose a valid date.");
    const rec = req.body.records && typeof req.body.records === "object" ? req.body.records : {};
    for (const [sid, status] of Object.entries(rec)) {
      if (!["P", "L", "A"].includes(status)) return bad(res, "Invalid attendance status.");
      if (!get("SELECT id FROM students WHERE id=? AND class_id=? AND active=1", [+sid, classId])) return bad(res, "A student in the request does not belong to this class.", 403);
    }
    Object.entries(rec).forEach(([sid, status]) => run("INSERT OR REPLACE INTO attendance VALUES (?,?,?)", [date, +sid, status]));
    audit(u.name, `Attendance recorded for ${get("SELECT name FROM classes WHERE id=?", [classId]).name} on ${date}`);
    persist();
    res.json({ ok: true });
  });

  /* FR-03 student records (create, update, archive; never deleted) */
  const uniqueUsername = (name) => {
    const base = (name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]/g, "") || "student");
    let u = base, i = 1;
    while (get("SELECT id FROM users WHERE username=?", [u])) u = base + ++i;
    return u;
  };
  app.post("/api/students", need("admin", "teacher"), (req, res) => {
    const u = req.session.user, name = cleanName(req.body?.name, 2, 80), classId = +req.body?.classId;
    if (!name) return bad(res, "Enter the student’s full name (2 to 80 characters).");
    if (!classAllowed(u, classId)) return bad(res, "Choose one of your classes.", 403);
    run("INSERT INTO students(name,class_id,active) VALUES (?,?,1)", [name, classId]);
    const sid = lastId(), username = uniqueUsername(name);
    run("INSERT INTO users(username,password_hash,role,name,student_id) VALUES (?,?,'student',?,?)", [username, bcrypt.hashSync(DEFAULT_STUDENT_PASSWORD, 10), name, sid]);
    audit(u.name, "Added student " + name);
    persist();
    res.json({ id: sid, username });
  });
  const manageable = (u, id) => {
    const s = get("SELECT * FROM students WHERE id=? AND active=1", [id]);
    return s && (u.role === "admin" || teacherClasses(u).includes(s.class_id)) ? s : null;
  };
  app.put("/api/students/:id", need("admin", "teacher"), (req, res) => {
    const u = req.session.user, s = manageable(u, +req.params.id), name = cleanName(req.body?.name, 2, 80), classId = +req.body?.classId;
    if (!s) return bad(res, "Student not found in your classes.", 403);
    if (!name) return bad(res, "Enter a valid name (2 to 80 characters).");
    if (!classAllowed(u, classId)) return bad(res, "Choose one of your classes.", 403);
    run("UPDATE students SET name=?, class_id=? WHERE id=?", [name, classId, s.id]);
    run("UPDATE users SET name=? WHERE student_id=?", [name, s.id]);
    audit(u.name, `Updated student record for ${name}`);
    persist();
    res.json({ ok: true });
  });
  app.post("/api/students/:id/archive", need("admin", "teacher"), (req, res) => {
    const u = req.session.user, s = manageable(u, +req.params.id);
    if (!s) return bad(res, "Student not found in your classes.", 403);
    run("UPDATE students SET active=0 WHERE id=?", [s.id]);
    audit(u.name, `Archived student ${s.name}`);
    persist();
    res.json({ ok: true });
  });

  /* FR-04 / FR-05 classes and subjects, plus alert thresholds (administrator only) */
  app.post("/api/classes", need("admin"), (req, res) => {
    const name = cleanName(req.body?.name, 1, 30);
    if (!name) return bad(res, "Enter a class name (up to 30 characters).");
    run("INSERT INTO classes(name) VALUES (?)", [name]);
    audit(req.session.user.name, "Created class " + name);
    persist();
    res.json({ ok: true });
  });
  app.post("/api/subjects", need("admin"), (req, res) => {
    const name = cleanName(req.body?.name, 1, 40), classId = +req.body?.classId, teacherId = +req.body?.teacherId;
    if (!name) return bad(res, "Enter a subject name (up to 40 characters).");
    const c = get("SELECT name FROM classes WHERE id=?", [classId]);
    if (!c || !get("SELECT id FROM teachers WHERE id=?", [teacherId])) return bad(res, "Choose a valid class and teacher.");
    run("INSERT INTO subjects(name,class_id,teacher_id) VALUES (?,?,?)", [name, classId, teacherId]);
    audit(req.session.user.name, `Created subject ${name} for ${c.name}`);
    persist();
    res.json({ ok: true });
  });
  app.put("/api/subjects/:id", need("admin"), (req, res) => {
    const subj = get("SELECT * FROM subjects WHERE id=?", [+req.params.id]), t = get("SELECT * FROM teachers WHERE id=?", [+req.body?.teacherId]);
    if (!subj || !t) return bad(res, "Choose a valid subject and teacher.");
    run("UPDATE subjects SET teacher_id=? WHERE id=?", [t.id, subj.id]);
    audit(req.session.user.name, `Assigned ${subj.name} to ${t.name}`);
    persist();
    res.json({ ok: true });
  });
  app.put("/api/config", need("admin"), (req, res) => {
    const m = Number(req.body?.mark), a = Number(req.body?.att);
    if (!(m >= 0 && m <= 100 && a >= 0 && a <= 100)) return bad(res, "Thresholds must be numbers from 0 to 100.");
    run("UPDATE settings SET value=? WHERE key='min_mark'", [m]);
    run("UPDATE settings SET value=? WHERE key='min_att'", [a]);
    audit(req.session.user.name, `Thresholds set to ${m}% marks and ${a}% attendance`);
    persist();
    res.json({ ok: true });
  });

  app.use("/api", (req, res) => bad(res, "Not found.", 404));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.status === 400 ? "Invalid request." : "Something went wrong on the server." });
  });
  return app;
}

async function start(port = process.env.PORT || 3000) {
  const SQL = await initSqlJs();
  DB = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  DB.exec(SCHEMA);
  seed();
  persist();
  return new Promise((resolve) => {
    const server = buildApp().listen(port, () => {
      console.log(`AcadIQ is running at http://localhost:${server.address().port}`);
      resolve(server);
    });
  });
}

if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });
module.exports = { start };
