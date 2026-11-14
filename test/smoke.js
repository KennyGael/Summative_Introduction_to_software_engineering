"use strict";
// Automated checks for authentication, role-based access, validation and the audit trail.
const os = require("os");
const path = require("path");
const fs = require("fs");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "acadiq-")), "test.db");
const { start } = require("../server");

let passed = 0, failed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log((ok ? "PASS  " : "FAIL  ") + name); };

function client(base) {
  let cookie = "";
  return async (method, url, body) => {
    const r = await fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
}

(async () => {
  const server = await start(0);
  const base = "http://localhost:" + server.address().port;
  try {
    const anon = client(base);
    check("Unauthenticated data request is rejected (401)", (await anon("GET", "/api/data")).status === 401);
    check("Wrong password is rejected (401)", (await anon("POST", "/api/login", { username: "teacher1", password: "nope" })).status === 401);

    const t1 = client(base);
    check("Teacher can sign in", (await t1("POST", "/api/login", { username: "teacher1", password: "teach123" })).status === 200);
    const td = (await t1("GET", "/api/data")).body;
    check("Teacher data has no audit trail", td.audit === undefined);
    const math3 = td.assess.find((a) => a.sid === 1 && a.title === "Test 3");
    const eng3 = td.assess.find((a) => a.sid === 2 && a.title === "Test 3");
    check("Mark above the maximum is rejected (FR-08)", (await t1("POST", "/api/marks", { assessmentId: math3.id, scores: { 3: "150" } })).status === 400);
    check("Negative mark is rejected (FR-08)", (await t1("POST", "/api/marks", { assessmentId: math3.id, scores: { 3: "-5" } })).status === 400);
    check("Teacher cannot enter marks for another teacher's subject", (await t1("POST", "/api/marks", { assessmentId: eng3.id, scores: { 3: "50" } })).status === 403);
    check("Valid mark is saved (FR-07)", (await t1("POST", "/api/marks", { assessmentId: math3.id, scores: { 3: "35" } })).status === 200);
    check("Attendance can be recorded (FR-10)", (await t1("POST", "/api/attendance", { classId: 1, date: "2026-11-01", records: { 1: "P", 3: "A" } })).status === 200);
    check("Teacher cannot change thresholds", (await t1("PUT", "/api/config", { mark: 60, att: 80 })).status === 403);

    const st = client(base);
    check("Student can sign in", (await st("POST", "/api/login", { username: "diane", password: "learn123" })).status === 200);
    const sd = (await st("GET", "/api/data")).body;
    check("Student only receives their own record (business rule)", sd.students.length === 1 && sd.students[0].name === "Diane Ineza");
    check("Student data has no audit trail", sd.audit === undefined);
    check("Student cannot enter marks", (await st("POST", "/api/marks", { assessmentId: math3.id, scores: { 3: "99" } })).status === 403);
    check("Student cannot add students", (await st("POST", "/api/students", { name: "Test Person", classId: 1 })).status === 403);

    const ad = client(base);
    check("Administrator can sign in", (await ad("POST", "/api/login", { username: "admin", password: "admin123" })).status === 200);
    const add = (await ad("GET", "/api/data")).body;
    check("Administrator sees the audit trail with the mark change", add.audit.some((a) => a.x.includes("Mathematics Test 3 for Diane Ineza: 38 to 35")));
    check("Administrator can update thresholds (FR-15)", (await ad("PUT", "/api/config", { mark: 60, att: 75 })).status === 200);
    check("Invalid thresholds are rejected", (await ad("PUT", "/api/config", { mark: 150, att: 75 })).status === 400);
    const ns = await ad("POST", "/api/students", { name: "New Learner", classId: 1 });
    check("Administrator can add a student (FR-03)", ns.status === 200 && ns.body.username === "new");
    const arch = await ad("POST", "/api/students/" + ns.body.id + "/archive", {});
    check("Administrator can archive a student", arch.status === 200);
    check("Archived student no longer signs in", (await client(base)("POST", "/api/login", { username: "new", password: "learn123" })).status === 401);

    await t1("POST", "/api/logout", {});
    check("Session is closed after sign-out", (await t1("GET", "/api/data")).status === 401);
  } catch (e) {
    failed++;
    console.error("Test run crashed:", e);
  }
  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
