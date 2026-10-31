const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from public directory
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Import API Routes
const studentRouter = require('./routes/student');
const examOfficeRouter = require('./routes/exam-office');
const termSettingsRouter = require('./routes/term-settings');
const developerRouter = require('./routes/developer');
const teacherRouter = require('./routes/teacher');
const formTeacherRouter = require('./routes/form-teacher');
const settingsRouter = require('./routes/settings');

// Mount API Routes
app.use('/api/student', studentRouter);
app.use('/api/exam-office', examOfficeRouter);
app.use('/api/term-settings', termSettingsRouter);
app.use('/api/developer', developerRouter);
app.use('/api/teacher', teacherRouter);
app.use('/api/form-teacher', formTeacherRouter);
app.use('/api/settings', settingsRouter);

// Frontend HTML Page Routes
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

app.get('/exam-office', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'exam-office.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});