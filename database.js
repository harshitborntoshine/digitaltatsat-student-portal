const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const db = new Database(path.join(__dirname, 'feedback.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Create Tables ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    roll_number TEXT,
    course TEXT,
    role TEXT NOT NULL DEFAULT 'student', -- 'student' or 'admin'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    teacher TEXT DEFAULT 'General Faculty',
    batch TEXT DEFAULT 'Batch 2023-2027',
    category TEXT NOT NULL DEFAULT 'General',
    message TEXT NOT NULL,
    rating INTEGER DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'Pending', -- 'Pending', 'Accepted', 'Rejected'
    admin_remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Add columns if table already existed without them
try { db.exec("ALTER TABLE feedback ADD COLUMN teacher TEXT DEFAULT 'General Faculty';"); } catch (e) {}
try { db.exec("ALTER TABLE feedback ADD COLUMN batch TEXT DEFAULT 'Batch 2023-2027';"); } catch (e) {}


// ---------- Seed default admin ----------
const adminEmail = process.env.ADMIN_EMAIL || 'admin@college.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';

const existingAdmin = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);

if (!existingAdmin) {
  const hashedPassword = bcrypt.hashSync(adminPassword, 10);
  db.prepare(
    `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')`
  ).run('System Admin', adminEmail, hashedPassword);
  console.log(`✔ Default admin created -> email: ${adminEmail} | password: ${adminPassword}`);
}

// ---------- Seed sample students & feedback for demo ----------
const studentCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'student'").get().c;

if (studentCount === 0) {
  const defaultPassword = bcrypt.hashSync('Student@123', 10);

  const sampleStudents = [
    { name: 'Rahul Sharma', email: 'rahul.sharma@college.com', roll: 'CS-2023-014', course: 'B.Tech Computer Science' },
    { name: 'Ananya Patel', email: 'ananya.patel@college.com', roll: 'EE-2023-028', course: 'B.Tech Electrical Eng' },
    { name: 'Vikramaditya Singh', email: 'vikram.singh@college.com', roll: 'ME-2023-005', course: 'B.Tech Mechanical Eng' },
    { name: 'Priya Verma', email: 'priya.verma@college.com', roll: 'MBA-2024-012', course: 'MBA Business Analytics' },
    { name: 'Rohan Das', email: 'rohan.das@college.com', roll: 'DS-2023-089', course: 'B.Sc Data Science' }
  ];

  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password, roll_number, course, role) VALUES (?, ?, ?, ?, ?, 'student')`
  );

  const studentIds = [];
  sampleStudents.forEach((student) => {
    const info = insertUser.run(student.name, student.email, defaultPassword, student.roll, student.course);
    studentIds.push(info.lastInsertRowid);
  });

  const insertFeedback = db.prepare(
    `INSERT INTO feedback (student_id, subject, teacher, batch, category, message, rating, status, admin_remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const sampleFeedbacks = [
    {
      student_id: studentIds[0],
      subject: 'Data Structures & Algorithms',
      teacher: 'Dr. A. K. Sharma',
      batch: 'CS-2023-A',
      category: 'Academics',
      message: 'The central library needs more recent editions of Machine Learning textbooks and expanded IEEE digital subscriptions for research.',
      rating: 5,
      status: 'Accepted',
      admin_remark: 'Approved! We have added 50 new ML copies and extended IEEE digital access licenses.'
    },
    {
      student_id: studentIds[0],
      subject: 'Computer Networks',
      teacher: 'Prof. Sunita Rao',
      batch: 'CS-2023-A',
      category: 'Hostel',
      message: 'Wi-Fi speeds drop drastically after 8 PM in Block B 3rd floor. Kindly upgrade access points.',
      rating: 2,
      status: 'Pending',
      admin_remark: null
    },
    {
      student_id: studentIds[1],
      subject: 'Operating Systems',
      teacher: 'Dr. Rajesh Verma',
      batch: 'EE-2023-B',
      category: 'Infrastructure',
      message: 'The HPC lab servers run hot because two AC units are malfunctioning during afternoon lab sessions.',
      rating: 4,
      status: 'Accepted',
      admin_remark: 'Maintenance team fixed the cooling units on Tuesday.'
    },
    {
      student_id: studentIds[1],
      subject: 'Circuit Theory',
      teacher: 'Prof. Meera Kapoor',
      batch: 'EE-2023-B',
      category: 'Canteen',
      message: 'Please introduce healthier options like fresh juices and salads in the central food court.',
      rating: 3,
      status: 'Pending',
      admin_remark: null
    },
    {
      student_id: studentIds[2],
      subject: 'Thermodynamics',
      teacher: 'Dr. Vikram Malhotra',
      batch: 'ME-2023-A',
      category: 'Academics',
      message: 'Safety goggles and welding shields in workshop 2 require replacement.',
      rating: 4,
      status: 'Accepted',
      admin_remark: 'New protective safety gear delivered to the workshop manager.'
    },
    {
      student_id: studentIds[2],
      subject: 'Fluid Mechanics',
      teacher: 'Prof. R. C. Gupta',
      batch: 'ME-2023-A',
      category: 'Sports',
      message: 'Floodlights on football ground turn off early at 7 PM. Requesting extension till 9 PM.',
      rating: 3,
      status: 'Rejected',
      admin_remark: 'Campus security policies mandate sports ground lights off at 7:30 PM.'
    },
    {
      student_id: studentIds[3],
      subject: 'Business Analytics & Statistics',
      teacher: 'Dr. Neha Kulkarni',
      batch: 'MBA-2024-B',
      category: 'Administration',
      message: 'During course registration, the portal crashed under peak load. Need better load handling.',
      rating: 2,
      status: 'Accepted',
      admin_remark: 'IT team scaled database connections and upgraded registration server capacity.'
    },
    {
      student_id: studentIds[3],
      subject: 'Corporate Governance',
      teacher: 'Prof. Alok Joshi',
      batch: 'MBA-2024-B',
      category: 'Faculty',
      message: 'Excellent session by Industry Experts last Friday! Requesting more interactive workshops.',
      rating: 5,
      status: 'Accepted',
      admin_remark: 'Thank you for the feedback! Monthly industry sessions have been scheduled.'
    },
    {
      student_id: studentIds[4],
      subject: 'Machine Learning & Python',
      teacher: 'Dr. Priyesh Patel',
      batch: 'DS-2023-A',
      category: 'Infrastructure',
      message: 'Morning shuttle frequency from North Gate to Academic Block 3 should be increased during 8:30-9:00 AM.',
      rating: 4,
      status: 'Pending',
      admin_remark: null
    }
  ];

  sampleFeedbacks.forEach((fb) => {
    insertFeedback.run(fb.student_id, fb.subject, fb.teacher, fb.batch, fb.category, fb.message, fb.rating, fb.status, fb.admin_remark);
  });


  console.log('✔ Sample students & feedback seeded successfully!');
}

module.exports = db;

