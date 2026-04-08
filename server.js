const express = require("express");
const mysql = require("mysql2");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

require("dotenv").config(); // ✅ load .env (for local)

const app = express();
const SECRET = process.env.JWT_SECRET || "mysecretkey";

app.use(express.json());
app.use(express.static("public"));

/* ================= DATABASE ================= */

// ✅ Works for BOTH local + Railway
const db = mysql.createConnection({
  host: process.env.MYSQLHOST || "metro.proxy.rlwy.net",
  user: process.env.MYSQLUSER || "root",
  password: process.env.MYSQLPASSWORD || "UteoWMaLEWrSUvJUnJYbALnRsPtcaRcT",
  database: process.env.MYSQLDATABASE || "railway",
  port: process.env.MYSQLPORT || 20680
});

db.connect(err => {
  if (err) console.error("❌ DB ERROR:", err);
  else console.log("✅ MySQL Connected");
});


/* ================= AUTH ================= */

// 🔐 VERIFY TOKEN
function verifyToken(req, res, next) {
  const token = req.headers["authorization"];

  if (!token) {
    return res.status(403).json({ message: "No token provided" });
  }

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid token" });

    req.user = decoded;
    next();
  });
}


// 🔐 LOGIN
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE username=? AND password=?",
    [username, password],
    (err, result) => {

      if (err) return res.send(err);

      if (result.length > 0) {

        const token = jwt.sign(
          { username: result[0].username, role: result[0].role },
          SECRET,
          { expiresIn: "1h" }
        );

        res.json({
          success: true,
          token,
          role: result[0].role
        });

      } else {
        res.json({ success: false });
      }
    }
  );
});


/* ================= WORKERS ================= */

// 👷 GET ALL
app.get("/workers", verifyToken, (req, res) => {
  db.query("SELECT * FROM attendance", (err, result) => {
    if (err) return res.send(err);
    res.json(result);
  });
});

// 📧 EMAIL SETUP
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "yourgmail@gmail.com",
    pass: process.env.EMAIL_PASS || "your_app_password"
  }
});

// ➕ MARK ATTENDANCE
app.post("/mark", verifyToken, (req, res) => {
  const { id, name, status } = req.body;

  db.query(
    "INSERT INTO attendance (worker_id, name, date, status) VALUES (?, ?, CURDATE(), ?)",
    [id, name, status],
    (err) => {

      if (err) return res.send(err);

      // 📧 EMAIL ALERT
      transporter.sendMail({
        to: process.env.EMAIL_TO || "receiver@gmail.com",
        subject: "Attendance Update",
        text: `${name} marked ${status}`
      });

      res.json({ success: true });
    }
  );
});


/* ================= STATS ================= */

app.get("/stats/:id", verifyToken, (req, res) => {
  const id = req.params.id;

  db.query(
    "SELECT status, COUNT(*) as count FROM attendance WHERE worker_id=? GROUP BY status",
    [id],
    (err, result) => {

      if (err) return res.send(err);

      let present = 0, absent = 0;

      result.forEach(r => {
        if (r.status === "Present") present = r.count;
        if (r.status === "Absent") absent = r.count;
      });

      res.json({ present, absent });
    }
  );
});


/* ================= PDF REPORT ================= */

app.get("/report/:id", verifyToken, (req, res) => {
  const id = req.params.id;

  db.query(
    "SELECT * FROM attendance WHERE worker_id=?",
    [id],
    (err, data) => {

      if (err) return res.send(err);

      const doc = new PDFDocument();

      res.setHeader("Content-Type", "application/pdf");
      doc.pipe(res);

      doc.fontSize(18).text("Attendance Report\n\n");

      data.forEach(row => {
        doc.text(`${row.date} - ${row.status}`);
      });

      doc.end();
    }
  );
});


/* ================= DEFAULT ================= */

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/login.html");
});


/* ================= SERVER ================= */

// ✅ Railway uses PORT env
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});