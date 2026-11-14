# AcadIQ – Student Academic Progress Tracking System

AcadIQ is a full-stack web application that helps schools record, monitor, and understand student academic progress in one place. Teachers record marks and attendance, students see their own progress, and administrators manage the school setup and set the thresholds that raise early academic alerts.

**Author:** Kenny Gael Ishimwe Gatete, African Leadership University

## Links

| Item | Link |
|---|---|
| Live application | https://summative-introduction-to-software.onrender.com |
| Demo video | ADD VIDEO LINK |
| SRS document | https://github.com/KennyGael/Summative_Introduction_to_software_engineering/blob/main/docs/AcadIQ_SRS.pdf |

> The live application is on a free host. If it has been idle, the first page load can take up to a minute. Please wait for the sign-in page to appear.

## The problem

Many schools keep marks, attendance, and academic records in notebooks, spreadsheets, or separate files. A student's progress is hard to see in one place, and declining performance is often noticed too late to help. AcadIQ centralizes these records and flags problems early.

## Architecture

This follows the structure defined in the SRS: **User Interface → Application Services → Database → Reports and Analytics.**

| Layer | Implementation |
|---|---|
| User interface | HTML, CSS, and JavaScript in `public/index.html` (works on desktop and mobile browsers) |
| Application services | Node.js and Express in `server.js`: authentication, role-based access, validation, and audit logging |
| Database | SQLite relational database (file `data/acadiq.db`, created automatically on first start) |

## Features (mapped to the SRS)

| SRS requirement | Where to see it |
|---|---|
| FR-01 Authentication | Sign in and sign out; the session expires after 10 minutes of inactivity |
| FR-02 Role-based access | Student, Teacher, and Administrator have different menus, and the server enforces permissions |
| FR-03 Student records | Students tab: search, add, edit, and archive (records are never permanently deleted) |
| FR-04 Class management | Administrator: Classes and subjects tab |
| FR-05 Subject management | Administrator: add subjects and assign teachers |
| FR-06 Assessment management | Teacher: Marks tab, Create assessment |
| FR-07 Marks entry | Teacher: enter and update marks for assigned subjects only |
| FR-08 Mark validation | The server rejects scores outside 0 to the assessment maximum |
| FR-09 Performance calculation | Subject and overall averages are calculated automatically |
| FR-10 Attendance | Teacher: Attendance tab (present, late, absent) |
| FR-11 Student dashboard | Student: averages, attendance, alerts |
| FR-12 Teacher dashboard | Teacher: class performance per subject |
| FR-13 Administrator dashboard | Administrator: school overview |
| FR-14 Performance trends | Student: trend chart across assessments |
| FR-15 Academic alerts | Alerts for low averages, sharp drops, and low attendance, using thresholds set by the administrator |
| Auditability | Administrator: Audit trail tab records who changed what and when |
| Safety | Archive needs confirmation; printable reports |

## Security measures (from the SRS)

- Passwords are stored as bcrypt hashes, never as plain text.
- Every request is checked on the server for a valid session and the correct role.
- Each role only receives the data it may see: a student receives only their own record, and a teacher only receives their own classes.
- All database queries use parameterized statements.
- Marks and attendance are validated on the server before they are stored.
- Sessions use HTTP-only cookies and expire after 10 minutes of inactivity.
- Repeated failed sign-ins from one address are temporarily blocked.
- The audit trail records important changes with the user and time.
- On the deployed site, traffic uses HTTPS.

## How to run it on your computer

### What you need

- **Node.js version 18 or newer** (this includes npm). Download it from https://nodejs.org. To check, open a terminal and run `node -v`.
- A web browser (Chrome, Edge, Firefox, or Safari).

You do **not** need to install a database. SQLite is built in through the `sql.js` package.

### Steps

1. **Get the code.** Either run `git clone https://github.com/KennyGael/Summative_Introduction_to_software_engineering.git`, or click **Code**, then **Download ZIP** on GitHub and unzip it.
2. **Open a terminal in the project folder** (the folder that contains `package.json`).
   ```
   cd Summative_Introduction_to_software_engineering
   ```
3. **Install the dependencies:**
   ```
   npm install
   ```
4. **Start the application:**
   ```
   npm start
   ```
   You should see the message: `AcadIQ is running at http://localhost:3000`
5. **Open http://localhost:3000** in your browser.
6. **Sign in** with one of the demo accounts below. Sample data is created automatically the first time the app starts.
7. To stop the app, press `Ctrl + C` in the terminal.

### Optional

- **Use a different port:** on macOS or Linux run `PORT=4000 npm start`. On Windows (PowerShell) run `$env:PORT=4000; npm start`.
- **Reset to the original sample data:** stop the app, delete the `data` folder, and start it again.
- **Run the automated tests:** `npm test`. This checks authentication, role-based access, mark validation, attendance, and the audit trail, and should end with `23 passed, 0 failed`.

## Demo accounts

| Role | Username | Password | Notes |
|---|---|---|---|
| Administrator | `admin` | `admin123` | Manages students, classes, subjects, thresholds, and the audit trail |
| Teacher | `teacher1` | `teach123` | Mr. Habimana: Mathematics and Science, class S3A |
| Teacher | `teacher2` | `teach123` | Ms. Uwera: English and History, class S3A |
| Student | `aline` | `learn123` | Aline Uwase |
| Student | `eric` | `learn123` | Eric Mugisha |
| Student | `diane` | `learn123` | Diane Ineza (has academic alerts) |
| Student | `jean` | `learn123` | Jean Bosco Niyonzima |

New students added in the app get a username made from their first name and the password `learn123`.

## Quick test scenarios

1. **Mark validation:** sign in as `teacher1`, open **Marks**, choose Mathematics and Test 3, type `150` for a student, and click **Save marks**. The score is rejected. Change it to `35` and save again; it is accepted.
2. **Alerts:** sign in as `diane`. The dashboard shows alerts for low subject averages and low attendance.
3. **Access control:** sign in as a student. Only that student's own information is shown, and there are no marks entry or management menus.
4. **Thresholds:** sign in as `admin`, change the minimum subject average to `60`, save, and see more students flagged on the overview.
5. **Audit trail:** after steps 1 and 4, open **Audit trail** as `admin` to see who changed what and when.
6. **Safe archiving:** in **Students**, click **Archive** and confirm. The record disappears from the lists but stays in the database.

## How to publish it online (public URL)

These steps use Render, which has a free plan.

1. Push this project to a **public** GitHub repository.
2. Create an account at https://render.com and sign in with GitHub.
3. Click **New**, then **Web Service**, and select your repository.
4. Set the following:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `SESSION_SECRET` = any long random text (for example 40 random characters)
6. Click **Create Web Service** and wait for the deploy to finish. Your public URL appears at the top of the page (for this project: `https://summative-introduction-to-software.onrender.com`).

Notes for the free plan: the service sleeps after about 15 minutes without visits, so open the URL once to wake it before showing or grading it. The database file is reset to the sample data whenever the service restarts or is redeployed.

## Project structure

```
Summative_Introduction_to_software_engineering/
├── server.js        Express server, API, database, authentication, validation, audit
├── package.json     Dependencies and scripts
├── public/
│   └── index.html   The user interface
├── docs/
│   └── AcadIQ_SRS.pdf   Proposal and SRS document
├── test/
│   └── smoke.js     Automated tests (npm test)
├── .gitignore
└── README.md
```

## Main API endpoints

| Method and path | Who can use it | Purpose |
|---|---|---|
| `POST /api/login`, `POST /api/logout` | Everyone | Start and end a session |
| `GET /api/data` | Signed-in users | Role-scoped data for the dashboards |
| `POST /api/assessments` | Teacher | Create an assessment |
| `POST /api/marks` | Teacher (own subjects) | Enter or update marks, with validation |
| `POST /api/attendance` | Teacher (own classes) | Record attendance |
| `POST /api/students`, `PUT /api/students/:id`, `POST /api/students/:id/archive` | Administrator, Teacher (own classes) | Manage student records |
| `POST /api/classes`, `POST /api/subjects`, `PUT /api/subjects/:id` | Administrator | Manage classes and subjects |
| `PUT /api/config` | Administrator | Set alert thresholds |

## Technology

Node.js, Express 5, express-session, bcryptjs, sql.js (SQLite), and plain HTML, CSS, and JavaScript. All dependencies are pure JavaScript, so installation does not need a compiler.

## Limitations and next steps

- Averages, trends, and alerts shown on the dashboards are calculated in the browser from the role-scoped data the server provides. Authentication, authorization, validation, and the audit trail are enforced on the server.
- Sessions are kept in server memory, so users are signed out when the server restarts.
- The database is a single SQLite file. For many schools, move to a hosted relational database such as PostgreSQL.
- New student accounts start with a default password. A production version should force a password change on first sign-in.
- Planned next increments: email notifications, report export, password reset, and feedback sessions with real teachers and students.
