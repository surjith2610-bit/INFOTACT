import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.resolve(__dirname, "enquiries.db");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Failed to connect to SQLite database:", err.message);
  } else {
    console.log("Connected to SQLite enquiries database at:", dbPath);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS enquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT DEFAULT 'NEW',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed default enquiries if database is empty
  db.get("SELECT COUNT(*) AS count FROM enquiries", (err, row) => {
    if (row && row.count === 0) {
      console.log("Seeding sample leads into enquiries table...");
      const stmt = db.prepare(`
        INSERT INTO enquiries (name, mobile, email, service, message, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run("Karthik Raja", "9876543210", "karthik@example.com", "Grill Gate Fabrication", "Need modern laser cut main entrance gate (12x7 feet). Please share price quote.", "NEW");
      stmt.run("Senthil Kumar", "9443210987", "senthil@gmail.com", "Staircase Railings", "Looking for stainless steel spiral staircase railing installation for 2 floors.", "CONTACTED");
      stmt.run("Anitha Ramesh", "9123456789", "anitha@hotmail.com", "Custom Steel Works", "Requirement for heavy duty compound wall safety spikes and custom window grills.", "NEW");
      stmt.finalize();
    }
  });
});

export default db;
