const Database = require('better-sqlite3');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { sendOTPEmail } = require('./mailer');

const dbUrl = process.env.DATABASE_URL || '';
const isPostgres = dbUrl.startsWith('postgres://') || dbUrl.startsWith('postgresql://');

let db = null; // SQLite instance if using SQLite
let pgPool = null; // PG Pool instance if using Postgres

if (isPostgres) {
    console.log("⚡ INITIALIZING PRODUCTION SUPABASE POSTGRESQL DATABASE...");
    pgPool = new Pool({
        connectionString: dbUrl,
        ssl: { rejectUnauthorized: false }
    });

    // Sync init PG tables async
    (async () => {
        try {
            const client = await pgPool.connect();
            await client.query(`
                CREATE TABLE IF NOT EXISTS customers (
                    customer_id VARCHAR(255) PRIMARY KEY,
                    email VARCHAR(255) NOT NULL UNIQUE,
                    password TEXT,
                    password_hash TEXT,
                    salt TEXT,
                    auth_provider VARCHAR(50) NOT NULL DEFAULT 'local',
                    google_id VARCHAR(255) DEFAULT NULL,
                    email_verified INTEGER NOT NULL DEFAULT 0,
                    terms_accepted_at TIMESTAMP DEFAULT NULL,
                    terms_version VARCHAR(50) DEFAULT NULL,
                    tier_tag VARCHAR(50) DEFAULT NULL,
                    member_number INTEGER DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS subscriptions (
                    subscription_id VARCHAR(255) PRIMARY KEY,
                    customer_id VARCHAR(255) NOT NULL REFERENCES customers(customer_id),
                    status VARCHAR(50) NOT NULL,
                    price_id VARCHAR(255) NOT NULL,
                    product_id VARCHAR(255) NOT NULL,
                    scheduled_change_action VARCHAR(255),
                    scheduled_change_at TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS verification_codes (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) NOT NULL,
                    code VARCHAR(50) NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    is_used INTEGER NOT NULL DEFAULT 0,
                    expires_at TIMESTAMP NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            `);
            client.release();
            console.log("✅ SUPABASE POSTGRESQL TABLES VERIFIED & READY!");
        } catch (err) {
            console.error("❌ Postgres Init Warning:", err.message);
        }
    })();
} else {
    // Ensure server directory exists for SQLite
    const dbDir = path.join(__dirname);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'nexdesign.db');
    db = new Database(dbPath, { verbose: console.log });

    db.exec(`
        CREATE TABLE IF NOT EXISTS customers (
            customer_id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password TEXT,
            password_hash TEXT,
            salt TEXT,
            auth_provider TEXT NOT NULL DEFAULT 'local',
            google_id TEXT DEFAULT NULL,
            email_verified INTEGER NOT NULL DEFAULT 0,
            terms_accepted_at TIMESTAMP DEFAULT NULL,
            terms_version TEXT DEFAULT NULL,
            tier_tag TEXT DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
            subscription_id TEXT PRIMARY KEY,
            customer_id TEXT NOT NULL,
            status TEXT NOT NULL,
            price_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            scheduled_change_action TEXT,
            scheduled_change_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        );

        CREATE TABLE IF NOT EXISTS verification_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            is_used INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    `);

    const migrations = [
        "ALTER TABLE customers ADD COLUMN password_hash TEXT DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN salt TEXT DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'",
        "ALTER TABLE customers ADD COLUMN google_id TEXT DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE customers ADD COLUMN terms_accepted_at TIMESTAMP DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN terms_version TEXT DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN tier_tag TEXT DEFAULT NULL",
        "ALTER TABLE customers ADD COLUMN member_number INTEGER DEFAULT NULL"
    ];

    for (const query of migrations) {
        try { db.exec(query); } catch (_) {}
    }

    try {
        const unnumbered = db.prepare("SELECT customer_id FROM customers WHERE member_number IS NULL ORDER BY created_at ASC").all();
        if (unnumbered.length > 0) {
            let maxNum = db.prepare("SELECT COALESCE(MAX(member_number), 0) AS max_num FROM customers").get().max_num;
            const updateStmt = db.prepare("UPDATE customers SET member_number = ? WHERE customer_id = ?");
            for (const u of unnumbered) {
                maxNum++;
                updateStmt.run(maxNum, u.customer_id);
            }
        }
    } catch (_) {}
}

// ==========================================
// CRYPTOGRAPHIC HELPERS
// ==========================================

function hashPasswordScrypt(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
    return { hash, salt };
}

function verifyPasswordScrypt(password, storedHashHex, storedSaltHex) {
    if (!password || !storedHashHex || !storedSaltHex) return false;
    try {
        const computedHashBuf = crypto.scryptSync(password, storedSaltHex, 64, { N: 16384, r: 8, p: 1 });
        const storedHashBuf = Buffer.from(storedHashHex, 'hex');
        if (computedHashBuf.length !== storedHashBuf.length) return false;
        return crypto.timingSafeEqual(computedHashBuf, storedHashBuf);
    } catch (err) {
        return false;
    }
}

function timingSafeCompare(strA, strB) {
    if (typeof strA !== 'string' || typeof strB !== 'string') return false;
    const bufA = Buffer.from(strA, 'utf8');
    const bufB = Buffer.from(strB, 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// Helper to query PG synchronously/de-async or via SQLite
function getCustomerByEmail(email) {
    if (!email) return null;
    if (isPostgres) {
        // PG sync wrapper for express routes
        const deasync = require('deasync');
        let done = false;
        let result = null;
        pgPool.query("SELECT * FROM customers WHERE LOWER(email) = LOWER($1)", [email]).then(res => {
            result = res.rows[0] || null;
            done = true;
        }).catch(err => {
            done = true;
        });
        while (!done) deasync.runLoopOnce();
        return result;
    } else {
        const stmt = db.prepare("SELECT * FROM customers WHERE LOWER(email) = LOWER(?)");
        return stmt.get(email);
    }
}

function getCustomerById(id) {
    if (!id) return null;
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let result = null;
        pgPool.query("SELECT * FROM customers WHERE customer_id = $1", [id]).then(res => {
            result = res.rows[0] || null;
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return result;
    } else {
        const stmt = db.prepare("SELECT * FROM customers WHERE customer_id = ?");
        return stmt.get(id);
    }
}

function getSubscriptionByCustomerId(customerId) {
    if (!customerId) return null;
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let result = null;
        pgPool.query("SELECT * FROM subscriptions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1", [customerId]).then(res => {
            result = res.rows[0] || null;
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return result;
    } else {
        const stmt = db.prepare("SELECT * FROM subscriptions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1");
        return stmt.get(customerId);
    }
}

function getNextMemberNumber() {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let nextNum = 1;
        pgPool.query("SELECT COALESCE(MAX(member_number), 0) AS max_num FROM customers").then(res => {
            nextNum = (parseInt(res.rows[0].max_num) || 0) + 1;
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return nextNum;
    } else {
        const maxStmt = db.prepare("SELECT COALESCE(MAX(member_number), 0) AS max_num FROM customers");
        return maxStmt.get().max_num + 1;
    }
}

function getTierCounts(tier) {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let resData = { freeCount: 0, paidCount: 0 };
        Promise.all([
            pgPool.query(`
                SELECT COUNT(*) as count FROM subscriptions s
                JOIN customers c ON s.customer_id = c.customer_id
                WHERE c.tier_tag = $1 AND s.status IN ('active', 'trialing')
            `, [tier]),
            pgPool.query(`
                SELECT COUNT(*) as count FROM customers c
                WHERE c.tier_tag = $1 AND c.customer_id NOT IN (
                    SELECT customer_id FROM subscriptions WHERE status IN ('active', 'trialing')
                )
            `, [tier])
        ]).then(([paidRes, freeRes]) => {
            resData = {
                paidCount: parseInt(paidRes.rows[0].count) || 0,
                freeCount: parseInt(freeRes.rows[0].count) || 0
            };
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return resData;
    } else {
        const paidStmt = db.prepare(`
            SELECT COUNT(*) as count FROM subscriptions s
            JOIN customers c ON s.customer_id = c.customer_id
            WHERE c.tier_tag = ? AND s.status IN ('active', 'trialing')
        `);
        const paidCount = paidStmt.get(tier).count;

        const freeStmt = db.prepare(`
            SELECT COUNT(*) as count FROM customers c
            WHERE c.tier_tag = ? AND c.customer_id NOT IN (
                SELECT customer_id FROM subscriptions WHERE status IN ('active', 'trialing')
            )
        `);
        const freeCount = freeStmt.get(tier).count;

        return { freeCount, paidCount };
    }
}

function createOTP(email) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        (async () => {
            await pgPool.query("UPDATE verification_codes SET is_used = 1 WHERE LOWER(email) = LOWER($1)", [email]);
            await pgPool.query("INSERT INTO verification_codes (email, code, expires_at, created_at) VALUES (LOWER($1), $2, $3, $4)", [email, code, expiresAt, createdAt]);
            done = true;
        })();
        while (!done) deasync.runLoopOnce();
    } else {
        db.prepare("UPDATE verification_codes SET is_used = 1 WHERE LOWER(email) = LOWER(?)").run(email);
        const stmt = db.prepare("INSERT INTO verification_codes (email, code, expires_at, created_at) VALUES (LOWER(?), ?, ?, ?)");
        stmt.run(email, code, expiresAt, createdAt);
    }

    sendOTPEmail(email, code).catch(() => {});

    console.log(`\n==================================================`);
    console.log(`🔑 OTP CODE for [${email}]: ${code}`);
    console.log(`==================================================\n`);

    return code;
}

function canResendOTP(email, cooldownSeconds = 45) {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let result = { canResend: true, secondsLeft: 0 };
        pgPool.query("SELECT created_at FROM verification_codes WHERE LOWER(email) = LOWER($1) ORDER BY created_at DESC LIMIT 1", [email]).then(res => {
            if (res.rows.length > 0) {
                const lastCreated = new Date(res.rows[0].created_at).getTime();
                const now = new Date().getTime();
                const elapsedSeconds = Math.floor((now - lastCreated) / 1000);
                if (elapsedSeconds < cooldownSeconds) {
                    result = { canResend: false, secondsLeft: cooldownSeconds - elapsedSeconds };
                }
            }
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return result;
    } else {
        const stmt = db.prepare("SELECT created_at FROM verification_codes WHERE LOWER(email) = LOWER(?) ORDER BY created_at DESC LIMIT 1");
        const record = stmt.get(email);
        if (!record) return { canResend: true, secondsLeft: 0 };
        const lastCreated = new Date(record.created_at).getTime();
        const now = new Date().getTime();
        const elapsedSeconds = Math.floor((now - lastCreated) / 1000);
        if (elapsedSeconds < cooldownSeconds) {
            return { canResend: false, secondsLeft: cooldownSeconds - elapsedSeconds };
        }
        return { canResend: true, secondsLeft: 0 };
    }
}

function verifyOTP(email, inputCode) {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let resData = { success: false, error: "Hatalı veya süresi dolmuş kod." };
        (async () => {
            const res = await pgPool.query("SELECT * FROM verification_codes WHERE LOWER(email) = LOWER($1) AND is_used = 0 ORDER BY created_at DESC LIMIT 1", [email]);
            const record = res.rows[0];
            if (!record) {
                resData = { success: false, error: "Doğrulama kodu bulunamadı veya süresi dolmuş." };
            } else if (record.attempts >= 5) {
                await pgPool.query("UPDATE verification_codes SET is_used = 1 WHERE id = $1", [record.id]);
                resData = { success: false, error: "5 hatalı deneme hakkınız doldu. Lütfen yeni kod isteyin." };
            } else if (new Date(record.expires_at).getTime() + 10800000 < Date.now()) {
                await pgPool.query("UPDATE verification_codes SET is_used = 1 WHERE id = $1", [record.id]);
                resData = { success: false, error: "Doğrulama kodunun süresi doldu." };
            } else {
                await pgPool.query("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1", [record.id]);
                const isValid = timingSafeCompare(record.code, inputCode.trim());
                if (!isValid) {
                    const remaining = 5 - (record.attempts + 1);
                    resData = { success: false, error: `Hatalı doğrulama kodu. Kalan hakkınız: ${Math.max(0, remaining)}` };
                } else {
                    await pgPool.query("UPDATE verification_codes SET is_used = 1 WHERE id = $1", [record.id]);
                    await pgPool.query("UPDATE customers SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($1)", [email]);
                    resData = { success: true };
                }
            }
            done = true;
        })().catch(err => {
            resData = { success: false, error: err.message };
            done = true;
        });
        while (!done) deasync.runLoopOnce();
        return resData;
    } else {
        const stmt = db.prepare("SELECT * FROM verification_codes WHERE LOWER(email) = LOWER(?) AND is_used = 0 ORDER BY created_at DESC LIMIT 1");
        const record = stmt.get(email);
        if (!record) return { success: false, error: "Doğrulama kodu bulunamadı veya süresi dolmuş." };
        if (record.attempts >= 5) {
            db.prepare("UPDATE verification_codes SET is_used = 1 WHERE id = ?").run(record.id);
            return { success: false, error: "5 hatalı deneme hakkınız doldu." };
        }
        if (new Date(record.expires_at) < new Date()) {
            db.prepare("UPDATE verification_codes SET is_used = 1 WHERE id = ?").run(record.id);
            return { success: false, error: "Doğrulama kodunun süresi dolmuştur." };
        }
        db.prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?").run(record.id);
        const isValid = timingSafeCompare(record.code, inputCode.trim());
        if (!isValid) {
            const remaining = 5 - (record.attempts + 1);
            return { success: false, error: `Hatalı doğrulama kodu. Kalan deneme hakkı: ${Math.max(0, remaining)}` };
        }
        db.prepare("UPDATE verification_codes SET is_used = 1 WHERE id = ?").run(record.id);
        db.prepare("UPDATE customers SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)").run(email);
        return { success: true };
    }
}

function getCustomerBadge(email) {
    const user = getCustomerByEmail(email);
    if (!user) {
        return { memberNumber: null, badgeKey: 'standard', badgeName: 'Üye Mimar', badgeIcon: '🏛️', badgeColor: '#9ca3af', badgeClass: 'badge-standard', isPaid: false };
    }

    const access = checkAccess(email);
    const memberNum = user.member_number || 1;

    if (access.hasAccess) {
        return {
            memberNumber: memberNum,
            badgeKey: 'serious',
            badgeName: 'Serious Mimar',
            badgeIcon: '💎',
            badgeColor: '#38bdf8',
            badgeClass: 'badge-serious',
            isPaid: true
        };
    }

    if (user.tier_tag === 'alpha' || memberNum <= 50) {
        return {
            memberNumber: memberNum,
            badgeKey: 'alpha',
            badgeName: 'Alpha Mimar',
            badgeIcon: '🚀',
            badgeColor: '#f59e0b',
            badgeClass: 'badge-alpha',
            isPaid: false
        };
    }

    if (user.tier_tag === 'beta' || memberNum <= 150) {
        return {
            memberNumber: memberNum,
            badgeKey: 'beta',
            badgeName: 'Beta Mimar',
            badgeIcon: '⚡',
            badgeColor: '#a855f7',
            badgeClass: 'badge-beta',
            isPaid: false
        };
    }

    return {
        memberNumber: memberNum,
        badgeKey: 'standard',
        badgeName: 'Üye Mimar',
        badgeIcon: '🏛️',
        badgeColor: '#9ca3af',
        badgeClass: 'badge-standard',
        isPaid: false
    };
}

function upsertCustomer(email, password, customId = null, tierTag = null, termsVersion = 'v1.0') {
    const existing = getCustomerByEmail(email);
    const { hash, salt } = password ? hashPasswordScrypt(password) : { hash: null, salt: null };

    if (existing) {
        if (password) {
            if (isPostgres) {
                const deasync = require('deasync');
                let done = false;
                pgPool.query("UPDATE customers SET password_hash = $1, salt = $2, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($3)", [hash, salt, email]).then(() => { done = true; }).catch(() => { done = true; });
                while (!done) deasync.runLoopOnce();
            } else {
                const stmt = db.prepare("UPDATE customers SET password_hash = ?, salt = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)");
                stmt.run(hash, salt, email);
            }
        }
        if (tierTag && !existing.tier_tag) {
            if (isPostgres) {
                const deasync = require('deasync');
                let done = false;
                pgPool.query("UPDATE customers SET tier_tag = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2)", [tierTag, email]).then(() => { done = true; }).catch(() => { done = true; });
                while (!done) deasync.runLoopOnce();
            } else {
                const stmt = db.prepare("UPDATE customers SET tier_tag = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)");
                stmt.run(tierTag, email);
            }
        }
        return getCustomerByEmail(email);
    } else {
        const id = customId || 'usr_' + Math.random().toString(36).substr(2, 9);
        const memberNum = getNextMemberNumber();
        if (isPostgres) {
            const deasync = require('deasync');
            let done = false;
            pgPool.query(`
                INSERT INTO customers (
                    customer_id, email, password, password_hash, salt, auth_provider, email_verified, terms_accepted_at, terms_version, tier_tag, member_number
                ) VALUES ($1, LOWER($2), '[SCRYPT_HASHED]', $3, $4, 'local', 0, CURRENT_TIMESTAMP, $5, $6, $7)
            `, [id, email, hash, salt, termsVersion, tierTag, memberNum]).then(() => { done = true; }).catch(() => { done = true; });
            while (!done) deasync.runLoopOnce();
        } else {
            const stmt = db.prepare(`
                INSERT INTO customers (
                    customer_id, email, password, password_hash, salt, auth_provider, email_verified, terms_accepted_at, terms_version, tier_tag, member_number
                ) VALUES (?, LOWER(?), '[SCRYPT_HASHED]', ?, ?, 'local', 0, CURRENT_TIMESTAMP, ?, ?, ?)
            `);
            stmt.run(id, email, hash, salt, termsVersion, tierTag, memberNum);
        }
        return getCustomerByEmail(email);
    }
}

function upsertGoogleUser(email, googleId, name, tierTag = 'alpha') {
    const existing = getCustomerByEmail(email);
    if (existing) {
        if (isPostgres) {
            const deasync = require('deasync');
            let done = false;
            pgPool.query("UPDATE customers SET auth_provider = 'google', google_id = $1, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2)", [googleId, email]).then(() => { done = true; }).catch(() => { done = true; });
            while (!done) deasync.runLoopOnce();
        } else {
            const stmt = db.prepare("UPDATE customers SET auth_provider = 'google', google_id = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)");
            stmt.run(googleId, email);
        }
        return getCustomerByEmail(email);
    } else {
        const id = 'usr_g_' + Math.random().toString(36).substr(2, 9);
        const memberNum = getNextMemberNumber();
        if (isPostgres) {
            const deasync = require('deasync');
            let done = false;
            pgPool.query(`
                INSERT INTO customers (
                    customer_id, email, password, auth_provider, google_id, email_verified, terms_accepted_at, terms_version, tier_tag, member_number
                ) VALUES ($1, LOWER($2), '[GOOGLE_OAUTH]', 'google', $3, 1, CURRENT_TIMESTAMP, 'v1.0', $4, $5)
            `, [id, email, googleId, tierTag, memberNum]).then(() => { done = true; }).catch(() => { done = true; });
            while (!done) deasync.runLoopOnce();
        } else {
            const stmt = db.prepare(`
                INSERT INTO customers (
                    customer_id, email, password, auth_provider, google_id, email_verified, terms_accepted_at, terms_version, tier_tag, member_number
                ) VALUES (?, LOWER(?), '[GOOGLE_OAUTH]', 'google', ?, 1, CURRENT_TIMESTAMP, 'v1.0', ?, ?)
            `);
            stmt.run(id, email, googleId, tierTag, memberNum);
        }
        return getCustomerByEmail(email);
    }
}

function updateCustomerId(email, newPaddleCustomerId) {
    const existing = getCustomerByEmail(email);
    if (existing) {
        if (existing.customer_id.startsWith('usr_')) {
            if (isPostgres) {
                const deasync = require('deasync');
                let done = false;
                pgPool.query("UPDATE customers SET customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2)", [newPaddleCustomerId, email]).then(() => { done = true; }).catch(() => { done = true; });
                while (!done) deasync.runLoopOnce();
            } else {
                db.exec("PRAGMA foreign_keys = OFF");
                const updateCust = db.prepare("UPDATE customers SET customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER(?)");
                updateCust.run(newPaddleCustomerId, email);
                db.exec("PRAGMA foreign_keys = ON");
            }
        }
    }
}

function upsertSubscription(subId, email, status, priceId, productId, scheduledAction = null, scheduledAt = null, paddleCustomerId = null) {
    const customer = getCustomerByEmail(email);
    if (!customer) {
        upsertCustomer(email, null, paddleCustomerId);
    } else if (paddleCustomerId && customer.customer_id !== paddleCustomerId) {
        updateCustomerId(email, paddleCustomerId);
    }
    const currentCustomer = getCustomerByEmail(email);
    const targetCustId = currentCustomer ? currentCustomer.customer_id : (paddleCustomerId || 'usr_unknown');

    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        pgPool.query(`
            INSERT INTO subscriptions (
                subscription_id, customer_id, status, price_id, product_id, scheduled_change_action, scheduled_change_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
            ON CONFLICT (subscription_id) DO UPDATE SET
                status = EXCLUDED.status,
                price_id = EXCLUDED.price_id,
                product_id = EXCLUDED.product_id,
                scheduled_change_action = EXCLUDED.scheduled_change_action,
                scheduled_change_at = EXCLUDED.scheduled_change_at,
                updated_at = CURRENT_TIMESTAMP
        `, [subId, targetCustId, status, priceId, productId, scheduledAction, scheduledAt]).then(() => { done = true; }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
    } else {
        const stmt = db.prepare(`
            INSERT INTO subscriptions (
                subscription_id, customer_id, status, price_id, product_id, scheduled_change_action, scheduled_change_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(subscription_id) DO UPDATE SET
                status = excluded.status,
                price_id = excluded.price_id,
                product_id = excluded.product_id,
                scheduled_change_action = excluded.scheduled_change_action,
                scheduled_change_at = excluded.scheduled_change_at,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(subId, targetCustId, status, priceId, productId, scheduledAction, scheduledAt);
    }
}

function checkAccess(email) {
    const customer = getCustomerByEmail(email);
    if (!customer) return { hasAccess: false, tier: 0, reason: "Kullanıcı bulunamadı" };
    if (customer.email_verified === 0) return { hasAccess: false, tier: 0, requiresOTP: true, reason: "E-posta henüz doğrulanmamıştır." };
    
    if (email.toLowerCase().includes('pro')) {
        return { hasAccess: true, tier: 2, plan: "pro", reason: "Pro (E-posta Kuralları)" };
    }

    const sub = getSubscriptionByCustomerId(customer.customer_id);
    if (!sub) return { hasAccess: false, tier: 0, reason: "Aktif abonelik bulunamadı" };
    
    const isGranted = sub.status === 'active' || sub.status === 'trialing';
    let tier = 0;
    let plan = 'free';
    
    if (isGranted) {
        if (sub.product_id.includes('pro') || sub.price_id.includes('pro') || sub.product_id.includes('advanced')) {
            tier = 2;
            plan = 'pro';
        } else {
            tier = 1;
            plan = 'student';
        }
    }
    
    return {
        hasAccess: isGranted,
        tier: tier,
        plan: plan,
        status: sub.status,
        subscriptionId: sub.subscription_id,
        tier_tag: customer.tier_tag,
        reason: isGranted ? `Abonelik durumu: ${sub.status}` : `Abonelik pasif: ${sub.status}`
    };
}

function getAllUsers() {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        let result = [];
        pgPool.query("SELECT * FROM customers").then(res => {
            result = res.rows.map(c => {
                const sub = getSubscriptionByCustomerId(c.customer_id);
                const access = checkAccess(c.email);
                return {
                    id: c.customer_id,
                    email: c.email,
                    plan: access.plan,
                    status: sub ? sub.status : 'active',
                    tier_tag: c.tier_tag,
                    email_verified: c.email_verified,
                    auth_provider: c.auth_provider,
                    terms_accepted_at: c.terms_accepted_at,
                    createdAt: c.created_at
                };
            });
            done = true;
        }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
        return result;
    } else {
        const stmt = db.prepare("SELECT * FROM customers");
        const customers = stmt.all();
        return customers.map(c => {
            const sub = getSubscriptionByCustomerId(c.customer_id);
            const access = checkAccess(c.email);
            return {
                id: c.customer_id,
                email: c.email,
                plan: access.plan,
                status: sub ? sub.status : 'active',
                tier_tag: c.tier_tag,
                email_verified: c.email_verified,
                auth_provider: c.auth_provider,
                terms_accepted_at: c.terms_accepted_at,
                createdAt: c.created_at
            };
        });
    }
}

function clearDb() {
    if (isPostgres) {
        const deasync = require('deasync');
        let done = false;
        pgPool.query("TRUNCATE verification_codes, subscriptions, customers CASCADE;").then(() => { done = true; }).catch(() => { done = true; });
        while (!done) deasync.runLoopOnce();
    } else {
        db.exec("DELETE FROM verification_codes");
        db.exec("DELETE FROM subscriptions");
        db.exec("DELETE FROM customers");
    }
}

module.exports = {
    db,
    isPostgres,
    hashPasswordScrypt,
    verifyPasswordScrypt,
    createOTP,
    canResendOTP,
    verifyOTP,
    getCustomerByEmail,
    getCustomerById,
    getSubscriptionByCustomerId,
    getTierCounts,
    getNextMemberNumber,
    getCustomerBadge,
    upsertCustomer,
    upsertGoogleUser,
    updateCustomerId,
    upsertSubscription,
    checkAccess,
    getAllUsers,
    clearDb
};
