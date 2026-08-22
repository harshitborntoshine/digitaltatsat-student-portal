require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const methodOverride = require('method-override');
const path = require('path');
const db = require('./db/database');

const app = express();
app.set('trust proxy', 1); // trust first proxy (Railway, Render, Nginx)
const PORT = process.env.PORT || 3000;

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: path.join(__dirname, 'db') }),
    secret: process.env.SESSION_SECRET || 'super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax'
    }
  })
);

// Make user + flash-style messages available in all views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.success = req.session.success || null;
  res.locals.error = req.session.error || null;
  req.session.success = null;
  req.session.error = null;
  next();
});

// ---------- Health check (for deployment platforms) ----------
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// ---------- Auth helpers ----------
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.error = 'Please login to continue.';
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      req.session.error = 'You are not authorized to view that page.';
      return res.redirect('/login');
    }
    next();
  };
}

// ================= PUBLIC ROUTES =================

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
  }
  res.redirect('/login');
});

// ---- Unified Auth Portal (Student Sign In, Student Sign Up, Admin Sign In) ----
app.get('/login', (req, res) => {
  const initialTab = req.query.tab || 'student';
  res.render('login', { initialTab });
});

app.get('/register', (req, res) => {
  res.redirect('/login?tab=register');
});

app.get('/admin/login', (req, res) => {
  res.redirect('/login?tab=admin');
});

app.post('/register', (req, res) => {
  const { name, email, password, confirm_password, roll_number, course } = req.body;

  if (!name || !email || !password || !confirm_password) {
    req.session.error = 'Please fill in all required fields.';
    return res.redirect('/login?tab=register');
  }

  if (password !== confirm_password) {
    req.session.error = 'Passwords do not match.';
    return res.redirect('/login?tab=register');
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) {
    req.session.error = 'An account with this email address already exists.';
    return res.redirect('/login?tab=register');
  }

  const hashed = bcrypt.hashSync(password, 10);

  db.prepare(
    `INSERT INTO users (name, email, password, roll_number, course, role)
     VALUES (?, ?, ?, ?, ?, 'student')`
  ).run(name.trim(), email.toLowerCase().trim(), hashed, roll_number ? roll_number.trim() : null, course ? course.trim() : null);

  req.session.success = 'Registration successful! You can now sign in.';
  res.redirect('/login?tab=student');
});

app.post('/login', (req, res) => {
  const { email, password, role, demo } = req.body;

  // Handle Demo 1-Click Login
  if (demo === 'student') {
    const demoStudent = db.prepare("SELECT * FROM users WHERE role = 'student' ORDER BY id ASC LIMIT 1").get();
    if (demoStudent) {
      req.session.user = { id: demoStudent.id, name: demoStudent.name, email: demoStudent.email, role: 'student' };
      req.session.success = `Welcome to Demo Student Portal! Logged in as ${demoStudent.name}.`;
      return res.redirect('/student/dashboard');
    }
  } else if (demo === 'admin') {
    const demoAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
    if (demoAdmin) {
      req.session.user = { id: demoAdmin.id, name: demoAdmin.name, email: demoAdmin.email, role: 'admin' };
      req.session.success = 'Welcome to Demo Admin Console!';
      return res.redirect('/admin/dashboard');
    }
  }

  const targetRole = role || 'student';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password || '', user.password)) {
    req.session.error = 'Invalid email address or password.';
    return res.redirect(`/login?tab=${targetRole}`);
  }

  if (targetRole === 'admin' && user.role !== 'admin') {
    req.session.error = 'This account does not have Admin credentials.';
    return res.redirect('/login?tab=admin');
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };

  res.redirect(user.role === 'admin' ? '/admin/dashboard' : '/student/dashboard');
});

app.post('/admin/login', (req, res) => {
  req.body.role = 'admin';
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase().trim());

  if (!user || user.role !== 'admin' || !bcrypt.compareSync(password || '', user.password)) {
    req.session.error = 'Invalid admin credentials.';
    return res.redirect('/login?tab=admin');
  }

  req.session.user = { id: user.id, name: user.name, email: user.email, role: 'admin' };
  res.redirect('/admin/dashboard');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ================= STUDENT ROUTES =================
// Student Dashboard — includes analytics (teacher/subject/batch), feedback form, tracker
app.get('/student/dashboard', requireLogin, requireRole('student'), (req, res) => {
  const currentView = req.query.view || 'dashboard';

  // Student's own feedbacks
  const feedbacks = db
    .prepare('SELECT * FROM feedback WHERE student_id = ? ORDER BY created_at DESC')
    .all(req.session.user.id);

  const studentProfile = db
    .prepare("SELECT name, email, roll_number, course, created_at FROM users WHERE id = ?")
    .get(req.session.user.id);

  const total = feedbacks.length;
  const pending = feedbacks.filter((f) => f.status === 'Pending').length;
  const accepted = feedbacks.filter((f) => f.status === 'Accepted').length;
  const rejected = feedbacks.filter((f) => f.status === 'Rejected').length;
  const avgRating = total > 0 ? (feedbacks.reduce((acc, curr) => acc + Number(curr.rating), 0) / total).toFixed(1) : '0.0';

  const stats = { total, pending, accepted, rejected, avgRating };

  const ratingStats = [5, 4, 3, 2, 1].map((rating) => ({
    rating,
    value: feedbacks.filter((f) => Number(f.rating) === rating).length
  }));

  const categoryCountsMap = {};
  feedbacks.forEach((f) => {
    categoryCountsMap[f.category] = (categoryCountsMap[f.category] || 0) + 1;
  });
  const categoryStats = Object.keys(categoryCountsMap).map((cat) => ({
    label: cat,
    value: categoryCountsMap[cat]
  }));

  // ---- Global analytics for Teacher/Subject/Batch views (from ALL feedback, not just this student's) ----
  const teacherStats = db
    .prepare(
      `SELECT teacher,
              COUNT(*) AS total_feedback,
              ROUND(AVG(rating), 1) AS avg_rating,
              SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted_count,
              SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected_count,
              SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending_count
       FROM feedback
       WHERE teacher IS NOT NULL AND teacher != ''
       GROUP BY teacher
       ORDER BY avg_rating DESC`
    )
    .all();

  const subjectStats = db
    .prepare(
      `SELECT subject,
              COUNT(*) AS total_feedback,
              ROUND(AVG(rating), 1) AS avg_rating,
              SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted_count
       FROM feedback
       WHERE subject IS NOT NULL AND subject != ''
       GROUP BY subject
       ORDER BY total_feedback DESC`
    )
    .all();

  const batchStats = db
    .prepare(
      `SELECT batch,
              COUNT(*) AS total_feedback,
              ROUND(AVG(rating), 1) AS avg_rating,
              SUM(CASE WHEN status = 'Accepted' THEN 1 ELSE 0 END) AS accepted_count
       FROM feedback
       WHERE batch IS NOT NULL AND batch != ''
       GROUP BY batch
       ORDER BY total_feedback DESC`
    )
    .all();

  res.render('student_dashboard', {
    feedbacks, stats, ratingStats, categoryStats, studentProfile,
    teacherStats, subjectStats, batchStats, currentView
  });
});

app.get('/student/profile', requireLogin, requireRole('student'), (req, res) => {
  const profile = db
    .prepare("SELECT id, name, email, roll_number, course, created_at FROM users WHERE id = ? AND role = 'student'")
    .get(req.session.user.id);

  const feedbackCount = db
    .prepare("SELECT COUNT(*) AS c FROM feedback WHERE student_id = ?")
    .get(req.session.user.id).c;

  res.render('student_profile', { profile, feedbackCount });
});

app.get('/student/feedback', requireLogin, requireRole('student'), (req, res) => {
  res.render('student_feedback');
});

app.post('/student/feedback', requireLogin, requireRole('student'), (req, res) => {
  const { subject, teacher, batch, category, message, rating } = req.body;

  if (!subject || !message) {
    req.session.error = 'Subject name and detailed comments are required.';
    return res.redirect('/student/dashboard');
  }

  db.prepare(
    `INSERT INTO feedback (student_id, subject, teacher, batch, category, message, rating)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    req.session.user.id,
    subject.trim(),
    teacher ? teacher.trim() : 'General Faculty',
    batch ? batch.trim() : 'Batch 2023-2027',
    category || 'Academics',
    message.trim(),
    Number(rating) || 5
  );

  req.session.success = 'Feedback submitted successfully! You can track its live status in the Feedback Tracker below.';
  res.redirect('/student/dashboard?view=tracker');
});


app.delete('/student/feedback/:id', requireLogin, requireRole('student'), (req, res) => {
  const feedback = db.prepare('SELECT * FROM feedback WHERE id = ?').get(req.params.id);

  if (!feedback || feedback.student_id !== req.session.user.id) {
    req.session.error = 'Feedback entry not found.';
    return res.redirect('/student/dashboard');
  }

  if (feedback.status !== 'Pending') {
    req.session.error = 'Only pending feedback entries can be deleted.';
    return res.redirect('/student/dashboard');
  }

  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  req.session.success = 'Feedback entry deleted.';
  res.redirect('/student/dashboard?view=tracker');
});

// ================= ADMIN ROUTES =================
// Admin Dashboard — focused on student info viewing + feedback accept/reject
app.get('/admin/dashboard', requireLogin, requireRole('admin'), (req, res) => {
  const filter = req.query.status || 'All';
  const categoryFilter = req.query.category || 'All';
  const searchQuery = req.query.search || '';

  let query = `
    SELECT feedback.*, users.name AS student_name, users.email AS student_email, users.roll_number, users.course
    FROM feedback
    JOIN users ON feedback.student_id = users.id
  `;
  const conditions = [];
  const params = [];

  if (filter !== 'All') {
    conditions.push('feedback.status = ?');
    params.push(filter);
  }
  if (categoryFilter !== 'All') {
    conditions.push('feedback.category = ?');
    params.push(categoryFilter);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY feedback.created_at DESC';

  const feedbacks = db.prepare(query).all(...params);

  const allFeedbacks = db.prepare('SELECT status, rating, category FROM feedback').all();
  const total = allFeedbacks.length;
  const pending = allFeedbacks.filter((f) => f.status === 'Pending').length;
  const accepted = allFeedbacks.filter((f) => f.status === 'Accepted').length;
  const rejected = allFeedbacks.filter((f) => f.status === 'Rejected').length;
  const avgRating = total > 0 ? (allFeedbacks.reduce((acc, curr) => acc + Number(curr.rating), 0) / total).toFixed(1) : '0.0';
  const approvalRate = total > 0 ? Math.round((accepted / total) * 100) : 0;

  const stats = { total, pending, accepted, rejected, avgRating, approvalRate };

  const totalStudents = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'student'").get().c;

  const categoryStats = db
    .prepare(
      `SELECT category AS label, COUNT(*) AS value FROM feedback
       GROUP BY category ORDER BY value DESC`
    )
    .all();

  const statusStats = [
    { label: 'Pending', value: pending },
    { label: 'Approved', value: accepted },
    { label: 'Rejected', value: rejected }
  ];

  // Fetch all students for inline student directory
  const students = db
    .prepare(
      `SELECT users.*,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id) AS feedback_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Pending') AS pending_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Accepted') AS accepted_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Rejected') AS rejected_count,
        (SELECT AVG(rating) FROM feedback WHERE feedback.student_id = users.id) AS avg_rating
       FROM users WHERE role = 'student' ORDER BY created_at DESC`
    )
    .all();

  res.render('admin_dashboard', {
    feedbacks,
    stats,
    filter,
    categoryFilter,
    totalStudents,
    categoryStats,
    statusStats,
    students
  });
});

// CSV Export Endpoint (Excel Compatible)
app.get('/admin/export/csv', requireLogin, requireRole('admin'), (req, res) => {
  const feedbacks = db
    .prepare(
      `SELECT feedback.id, feedback.created_at, users.name AS student_name, users.roll_number, users.course,
              feedback.teacher, feedback.subject, feedback.batch, feedback.category, feedback.rating,
              feedback.status, feedback.message, feedback.admin_remark
       FROM feedback
       JOIN users ON feedback.student_id = users.id
       ORDER BY feedback.created_at DESC`
    )
    .all();

  let csvContent = 'ID,Date,Student Name,Roll No,Course,Teacher,Subject,Batch,Category,Rating,Status,Comments,Admin Remark\n';

  feedbacks.forEach(f => {
    const clean = (text) => `"${(text || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`;
    csvContent += [
      f.id,
      new Date(f.created_at).toLocaleDateString(),
      clean(f.student_name),
      clean(f.roll_number),
      clean(f.course),
      clean(f.teacher),
      clean(f.subject),
      clean(f.batch),
      clean(f.category),
      f.rating,
      clean(f.status),
      clean(f.message),
      clean(f.admin_remark)
    ].join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="campus_feedback_report.csv"');
  res.send(csvContent);
});

// Printable Monthly Governance Report View (PDF Exportable)
app.get('/admin/export/report', requireLogin, requireRole('admin'), (req, res) => {
  const feedbacks = db
    .prepare(
      `SELECT feedback.*, users.name AS student_name, users.email AS student_email, users.roll_number
       FROM feedback JOIN users ON feedback.student_id = users.id
       ORDER BY feedback.created_at DESC`
    )
    .all();

  const total = feedbacks.length;
  const accepted = feedbacks.filter((f) => f.status === 'Accepted').length;
  const pending = feedbacks.filter((f) => f.status === 'Pending').length;
  const rejected = feedbacks.filter((f) => f.status === 'Rejected').length;
  const avgRating = total > 0 ? (feedbacks.reduce((acc, curr) => acc + Number(curr.rating), 0) / total).toFixed(1) : '0.0';

  const teacherStats = db
    .prepare(
      `SELECT teacher, COUNT(*) AS total_feedback, ROUND(AVG(rating), 1) AS avg_rating
       FROM feedback WHERE teacher IS NOT NULL GROUP BY teacher ORDER BY avg_rating DESC`
    )
    .all();

  res.render('admin_report', { feedbacks, total, accepted, pending, rejected, avgRating, teacherStats });
});


app.put('/admin/feedback/:id/status', requireLogin, requireRole('admin'), (req, res) => {
  const { status, admin_remark } = req.body;

  if (!['Accepted', 'Rejected', 'Pending'].includes(status)) {
    req.session.error = 'Invalid status value.';
    return res.redirect(req.get('Referrer') || '/admin/dashboard');
  }

  db.prepare(
    `UPDATE feedback SET status = ?, admin_remark = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(status, admin_remark ? admin_remark.trim() : null, req.params.id);

  req.session.success = `Feedback #${req.params.id} marked as ${status}.`;
  const backUrl = req.get('Referrer') || '/admin/dashboard';
  res.redirect(backUrl);
});

app.delete('/admin/feedback/:id', requireLogin, requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM feedback WHERE id = ?').run(req.params.id);
  req.session.success = 'Feedback deleted permanently.';
  const backUrl = req.get('Referrer') || '/admin/dashboard';
  res.redirect(backUrl);
});

// Admin Student Directory & Personal Info Page
app.get('/admin/students', requireLogin, requireRole('admin'), (req, res) => {
  const students = db
    .prepare(
      `SELECT users.*,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id) AS feedback_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Pending') AS pending_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Accepted') AS accepted_count,
        (SELECT COUNT(*) FROM feedback WHERE feedback.student_id = users.id AND status = 'Rejected') AS rejected_count,
        (SELECT AVG(rating) FROM feedback WHERE feedback.student_id = users.id) AS avg_rating
       FROM users WHERE role = 'student' ORDER BY created_at DESC`
    )
    .all();

  // Fetch all student feedbacks for instant modal view
  const studentFeedbacks = db
    .prepare(
      `SELECT feedback.*, users.name AS student_name
       FROM feedback JOIN users ON feedback.student_id = users.id
       ORDER BY feedback.created_at DESC`
    )
    .all();

  res.render('admin_students', { students, studentFeedbacks });
});

// Admin API endpoint to fetch detailed student personal info + feedback JSON
app.get('/admin/students/:id/json', requireLogin, requireRole('admin'), (req, res) => {
  const student = db
    .prepare("SELECT id, name, email, roll_number, course, role, created_at FROM users WHERE id = ? AND role = 'student'")
    .get(req.params.id);

  if (!student) {
    return res.status(404).json({ error: 'Student not found' });
  }

  const feedbacks = db
    .prepare('SELECT * FROM feedback WHERE student_id = ? ORDER BY created_at DESC')
    .all(req.params.id);

  const stats = {
    total: feedbacks.length,
    pending: feedbacks.filter((f) => f.status === 'Pending').length,
    accepted: feedbacks.filter((f) => f.status === 'Accepted').length,
    rejected: feedbacks.filter((f) => f.status === 'Rejected').length,
    avgRating: feedbacks.length > 0 ? (feedbacks.reduce((acc, curr) => acc + Number(curr.rating), 0) / feedbacks.length).toFixed(1) : '0.0'
  };

  res.json({ student, stats, feedbacks });
});


// ================= 404 =================
app.use((req, res) => {
  res.status(404).send('<h1>404 - Page Not Found</h1><a href="/">Go Home</a>');
});

function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`🚀 Server running cleanly at http://localhost:${portToTry}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️ Port ${portToTry} in use, trying http://localhost:${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(PORT);
