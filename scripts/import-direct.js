const fs = require("fs");
const { Pool } = require("pg");
const url = require("url");

const dbUrl = process.env.DATABASE_URL;
const parsed = new URL(dbUrl);
const pool = new Pool({
  host: parsed.hostname,
  port: parseInt(parsed.port || "5432"),
  database: parsed.pathname.slice(1),
  user: parsed.username,
  password: parsed.password,
});

const filePath = process.argv[2];
if (!filePath) { console.error("Usage: node import-direct.js <leads.json>"); process.exit(1); }

const raw = fs.readFileSync(filePath, "utf8");
const leads = JSON.parse(raw);
if (!Array.isArray(leads) || leads.length === 0) {
  console.log("No leads found."); process.exit(0);
}
console.log("Found " + leads.length + " leads.");

const SDR_USER_ID = "8100955d-4bd1-4278-aba9-d73929bf4cfe";

async function main() {
  let imported = 0, skipped = 0, errors = 0;
  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    try {
      if (!lead.email && !lead.name) {
        console.log("  [SKIP] Row " + (i+1) + ": Missing name and email");
        skipped++; continue;
      }
      const dedupeKey = (lead.email || "") + "|" + (lead.company || "");
      const existing = await pool.query(
        "SELECT id FROM outbound_leads WHERE user_id = $1 AND dedupe_key = $2",
        [SDR_USER_ID, dedupeKey]
      );
      if (existing.rows.length > 0) {
        console.log("  [SKIP] Row " + (i+1) + ": Duplicate - " + (lead.name || "") + " (" + (lead.email || "") + ")");
        skipped++; continue;
      }

      const firstName = lead.name ? lead.name.split(" ")[0] : "";
      const lastName = lead.name ? lead.name.split(" ").slice(1).join(" ") : "";

      const inserted = await pool.query(
        `INSERT INTO outbound_leads
          (user_id, source_type, source_reference, source_confidence, is_synthetic,
           name, first_name, last_name, email, phone, company, title,
           website, location, notes, raw_data, dedupe_key,
           fit_score, intent_score, total_score, status, next_recommended_action)
         VALUES
          ($1, $2, $3, $4, FALSE,
           $5, $6, $7, $8, $9, $10, $11,
           $12, $13, $14, $15, $16,
           $17, $18, $19, $20, $21)
         RETURNING id`,
        [
          SDR_USER_ID, "web", lead.source_reference || "",
          Math.max(0, Math.min(100, lead.source_confidence || 50)),
          lead.name || "Unknown", firstName, lastName,
          lead.email || "", lead.phone || "", lead.company || "", lead.title || "",
          lead.website || "", lead.location || "", lead.notes || "",
          JSON.stringify(lead), dedupeKey,
          65, 70, 68, "new", "initial_outreach"
        ]
      );
      const leadId = inserted.rows[0].id;
      await pool.query(
        "INSERT INTO lead_score_history (user_id, lead_id, fit_score, intent_score, engagement_score, total_score, status, next_recommended_action, reasons, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)",
        [SDR_USER_ID, leadId, 65, 70, 0, 68, "new", "initial_outreach", JSON.stringify({}), "import"]
      );
      await pool.query(
        "INSERT INTO lead_source_events (user_id, lead_id, event_type, channel, metadata) VALUES ($1, $2, $3, $4, $5)",
        [SDR_USER_ID, leadId, "lead_imported", null, JSON.stringify({ sourceType: "web", sourceReference: lead.source_reference || "" })]
      );
      imported++;
      console.log("  [OK] Row " + (i+1) + ": Imported " + (lead.name || "") + " (" + (lead.email || "") + ")");
    } catch (err) {
      errors++;
      console.log("  [ERR] Row " + (i+1) + ": " + (lead.name || "") + " - " + err.message);
    }
  }
  console.log("\nSummary: " + imported + " imported, " + skipped + " skipped, " + errors + " errors");
  await pool.end();
  process.exit(0);
}
main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
