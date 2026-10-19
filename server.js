require("dotenv").config();

const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const path = require("path");

const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 10000;

const pool = process.env.DATABASE_URL
    ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5
    })
    : null;

function generateToken() {
    return crypto.randomBytes(32).toString("hex");
}

function requireAdmin(req, res, next) {
    const key = req.headers["x-admin-key"];
    if (!process.env.ADMIN_KEY) {
        return res.status(500).json({ ok: false, error: "ADMIN_KEY is not configured" });
    }
    if (!key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
    }
    next();
}

function isExpired(expiresAt) {
    if (!expiresAt) return false;
    return new Date(expiresAt).getTime() <= Date.now();
}

function getSubscriptionUrl(req, token) {
    const host = req.get("host") || "localhost:10000";
    const protocol = req.headers["x-forwarded-proto"] || "http";
    return `${protocol}://${host}/sub/${token}`;
}

function getHysteriaUri(name) {
    const host = process.env.HY2_HOST;
    const port = process.env.HY2_PORT || "443";
    const auth = encodeURIComponent(process.env.HY2_AUTH || "");
    if (!host || !process.env.HY2_AUTH) return null;
    const safeName = encodeURIComponent(name || "VPN");
    return `hysteria2://${auth}@${host}:${port}/?sni=${encodeURIComponent(host)}#${safeName}`;
}

async function initDatabase() {
    if (!pool) {
        console.log("DATABASE_URL is not configured.");
        return;
    }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_users_token ON users(token);
        CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
    `);
    console.log("Database initialized.");
}

app.get("/health", async (req, res) => {
    try {
        if (!pool) return res.json({ ok: true, database: false });
        await pool.query("SELECT 1");
        res.json({ ok: true, database: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, database: false });
    }
});

app.post("/api/users", requireAdmin, async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ ok: false, error: "Database is not configured" });
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).json({ ok: false, error: "name is required" });
        const days = Number(req.body.days || 30);
        if (!Number.isFinite(days) || days <= 0 || days > 3650) {
            return res.status(400).json({ ok: false, error: "days must be between 1 and 3650" });
        }
        const token = generateToken();
        const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        const result = await pool.query(
            `INSERT INTO users (name, token, active, expires_at)
             VALUES ($1, $2, TRUE, $3)
             RETURNING id, name, token, active, expires_at, created_at`,
            [name, token, expiresAt]
        );
        const user = result.rows[0];
        const subscriptionUrl = getSubscriptionUrl(req, user.token);
        const happUrl = `happ://add/${subscriptionUrl}`;
        res.json({ ok: true, user, subscriptionUrl, happUrl });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Failed to create user" });
    }
});

app.get("/api/users", requireAdmin, async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ ok: false, error: "Database is not configured" });
        const result = await pool.query(
            `SELECT id, name, token, active, expires_at, created_at
             FROM users ORDER BY id DESC`
        );
        res.json({ ok: true, users: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Failed to load users" });
    }
});

app.post("/api/users/:id/disable", requireAdmin, async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ ok: false, error: "Database is not configured" });
        const result = await pool.query(
            `UPDATE users SET active = FALSE WHERE id = $1
             RETURNING id, name, active`, [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });
        res.json({ ok: true, user: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Failed to disable user" });
    }
});

app.post("/api/users/:id/enable", requireAdmin, async (req, res) => {
    try {
        if (!pool) return res.status(500).json({ ok: false, error: "Database is not configured" });
        const result = await pool.query(
            `UPDATE users SET active = TRUE WHERE id = $1
             RETURNING id, name, active`, [req.params.id]
        );
        if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });
        res.json({ ok: true, user: result.rows[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Failed to enable user" });
    }
});

app.get("/sub/:token", async (req, res) => {
    try {
        if (!pool) return res.status(503).send("Database unavailable");
        const result = await pool.query(
            `SELECT id, name, token, active, expires_at
             FROM users WHERE token = $1 LIMIT 1`, [req.params.token]
        );
        if (result.rowCount === 0) return res.status(404).send("Subscription not found");
        const user = result.rows[0];
        if (!user.active) return res.status(403).send("Subscription disabled");
        if (isExpired(user.expires_at)) return res.status(403).send("Subscription expired");
        const uri = getHysteriaUri(user.name);
        if (!uri) return res.status(503).send("Hysteria server is not configured");
        const content = Buffer.from(uri, "utf8").toString("base64");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.send(content);
    } catch (error) {
        console.error(error);
        res.status(500).send("Subscription error");
    }
});

app.get("/api/subscription/:token", async (req, res) => {
    try {
        if (!pool) return res.status(503).json({ ok: false, error: "Database unavailable" });
        const result = await pool.query(
            `SELECT id, name, active, expires_at
             FROM users WHERE token = $1 LIMIT 1`, [req.params.token]
        );
        if (result.rowCount === 0) return res.status(404).json({ ok: false, error: "Not found" });
        const user = result.rows[0];
        res.json({
            ok: true,
            name: user.name,
            active: user.active,
            expired: isExpired(user.expires_at),
            expiresAt: user.expires_at
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, error: "Failed" });
    }
});

initDatabase()
    .then(() => {
        app.listen(PORT, () => console.log(`VPN Manager listening on port ${PORT}`));
    })
    .catch((error) => {
        console.error("Database initialization failed:", error);
        process.exit(1);
    });
