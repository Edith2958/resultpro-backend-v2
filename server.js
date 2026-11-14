const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Ensure the uploads directory exists on startup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import API Routes
const studentRouter = require('./routes/student');
const verifyRouter = require('./routes/verify');
const examOfficeRouter = require('./routes/exam-office');
const termSettingsRouter = require('./routes/term-settings');
const developerRouter = require('./routes/developer');
const teacherRouter = require('./routes/teacher');
const formTeacherRouter = require('./routes/form-teacher');
const settingsRouter = require('./routes/settings');

// Mount API Routes
app.use('/api/student', studentRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/exam-office', examOfficeRouter);
app.use('/api/term-settings', termSettingsRouter);
app.use('/api/developer', developerRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/form-teacher', formTeacherRouter);
app.use('/api/settings', settingsRouter);

// Frontend HTML Page Routes
app.get('/gateway', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gateway.html'));
});

app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.get('/exam-office', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'exam-office.html'));
});

app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/form-teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form-teacher.html'));
});

app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});