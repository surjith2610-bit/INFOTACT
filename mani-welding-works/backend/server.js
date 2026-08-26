import express from "express";
import cors from "cors";
import db from "./database.js";

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "Mani Welding Works API", port: PORT });
});

// POST /api/enquiry - Submit new customer lead
app.post("/api/enquiry", (req, res) => {
  const { name, mobile, email, service, message } = req.body;

  if (!name || !mobile || !service || !message) {
    return res.status(400).json({ error: "Missing required fields. Please fill name, mobile, service, and message." });
  }

  const query = `
    INSERT INTO enquiries (name, mobile, email, service, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'NEW', CURRENT_TIMESTAMP)
  `;

  db.run(query, [name.trim(), mobile.trim(), (email || "").trim(), service.trim(), message.trim()], function (err) {
    if (err) {
      console.error("Database insert error:", err);
      return res.status(500).json({ error: "Failed to store enquiry in database." });
    }

    res.status(201).json({
      message: "Enquiry submitted successfully! Our team will call you shortly.",
      enquiry_id: this.lastID,
      data: {
        id: this.lastID,
        name,
        mobile,
        email,
        service,
        message,
        status: "NEW",
        created_at: new Date().toISOString()
      }
    });
  });
});

// GET /api/enquiries - List all enquiries for Admin dashboard
app.get("/api/enquiries", (req, res) => {
  const query = `SELECT * FROM enquiries ORDER BY created_at DESC`;
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error("Database fetch error:", err);
      return res.status(500).json({ error: "Failed to retrieve enquiries." });
    }
    res.json({ enquiries: rows || [] });
  });
});

// PATCH /api/enquiries/:id/status - Update lead status
app.patch("/api/enquiries/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status field is required." });
  }

  const query = `UPDATE enquiries SET status = ? WHERE id = ?`;
  db.run(query, [status, id], function (err) {
    if (err) {
      return res.status(500).json({ error: "Failed to update enquiry status." });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Enquiry not found." });
    }
    res.json({ message: `Enquiry #${id} status updated to ${status}.`, id, status });
  });
});

// DELETE /api/enquiries/:id - Delete lead
app.delete("/api/enquiries/:id", (req, res) => {
  const { id } = req.params;
  const query = `DELETE FROM enquiries WHERE id = ?`;
  db.run(query, [id], function (err) {
    if (err) {
      return res.status(500).json({ error: "Failed to delete enquiry." });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "Enquiry not found." });
    }
    res.json({ message: `Enquiry #${id} deleted successfully.`, id });
  });
});

app.listen(PORT, () => {
  console.log(`🔥 Mani Welding Works API running at http://localhost:${PORT}`);
});
