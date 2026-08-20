require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Paddle, Environment } = require('@paddle/paddle-node-sdk');
const db = require('./db');

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3001;

// Production Security Headers
app.use(helmet({
    contentSecurityPolicy: false, // Handled by frontend HTML for Google GIS / Paddle scripts
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Production Rate Limiter for API Security
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 30, // Limit each IP to 30 requests per 15 min
    message: { success: false, error: "Güvenlik nedeniyle çok fazla istek gönderdiniz. Lütfen 15 dakika sonra tekrar deneyin." },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/login', authRateLimiter);
app.use('/api/register', authRateLimiter);
app.use('/api/verify-otp', authRateLimiter);
app.use('/api/resend-otp', authRateLimiter);

// Initialize Paddle SDK
const isProd = process.env.PADDLE_ENVIRONMENT === 'production';
const paddle = new Paddle(process.env.PADDLE_API_KEY || 'sec_dummy_key_for_testing', {
    environment: isProd ? Environment.production : Environment.sandbox
});

// Configure CORS
app.use(cors({
    origin: '*', // Allow all origins for testing/Tauri client compatibility
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'paddle-signature']
}));

// 1. Paddle Webhook Handler (Uses express.text to preserve raw body signature)
app.post('/api/paddle-webhook', express.text({ type: '*/*' }), async (req, res) => {
    const signature = req.headers['paddle-signature'] || '';
    const rawBody = req.body;

    console.log("Received a webhook request from Paddle");

    if (!process.env.PADDLE_WEBHOOK_SECRET || process.env.PADDLE_WEBHOOK_SECRET === 'pdl_ntf_your_webhook_signing_secret_here') {
        console.warn("PADDLE_WEBHOOK_SECRET is not configured. Skipping signature verification (SIMULATION MODE).");
        // Simulation mode for testing purposes if secret not set
        try {
            const bodyObj = JSON.parse(rawBody);
            console.log(`Processing simulated event: ${bodyObj.eventType}`);
            await handlePaddleEvent(bodyObj);
            return res.status(200).send("Simulated event processed");
        } catch (err) {
            return res.status(400).send(`Simulation Error: ${err.message}`);
        }
    }

    try {
        // Verify Paddle Webhook Signature
        const event = paddle.webhooks.unmarshal(rawBody, process.env.PADDLE_WEBHOOK_SECRET, signature);
        console.log(`Successfully verified webhook signature! Event: ${event.eventType}`);
        
        await handlePaddleEvent(event);
        res.status(200).send("Event processed successfully");
    } catch (err) {
        console.error("Signature verification failed:", err.message);
        res.status(400).send(`Signature Verification Error: ${err.message}`);
    }
});

// Helper function to process verified Paddle events
async function handlePaddleEvent(event) {
    const data = event.data;
    const eventType = event.eventType;

    switch (eventType) {
        case 'customer.created':
        case 'customer.updated': {
            const email = data.email;
            const customerId = data.id;
            db.updateCustomerId(email, customerId);
            break;
        }

        case 'subscription.created':
        case 'subscription.updated': {
            const subId = data.id;
            const customerId = data.customerId;
            const status = data.status;
            const priceId = data.items[0]?.price?.id || '';
            const productId = data.items[0]?.price?.productId || '';
            const scheduledAction = data.scheduledChange?.action || null;
            const scheduledAt = data.scheduledChange?.effectiveAt || null;

            // Fetch customer email from Paddle API if not already cached
            let email = '';
            try {
                const customer = await paddle.customers.get(customerId);
                email = customer.email;
            } catch (err) {
                console.error(`Could not fetch customer ${customerId} from Paddle SDK:`, err.message);
            }

            if (email) {
                db.upsertSubscription(subId, email, customerId, status, priceId, productId, scheduledAction, scheduledAt);
            } else {
                console.warn(`Could not resolve email address for Paddle customer ID: ${customerId}`);
            }
            break;
        }

        case 'subscription.canceled': {
            const subId = data.id;
            const customerId = data.customerId;
            const status = 'canceled';
            const priceId = data.items[0]?.price?.id || '';
            const productId = data.items[0]?.price?.productId || '';

            let email = '';
            try {
                const customer = await paddle.customers.get(customerId);
                email = customer.email;
            } catch (err) {
                console.error(`Could not fetch customer ${customerId} from Paddle SDK:`, err.message);
            }

            if (email) {
                db.upsertSubscription(subId, email, customerId, status, priceId, productId, null, null);
            }
            break;
        }

        case 'transaction.completed': {
            const customerId = data.customerId;
            if (customerId) {
                let email = '';
                try {
                    const customer = await paddle.customers.get(customerId);
                    email = customer.email;
                } catch (err) {
                    console.error("Could not fetch customer from Paddle SDK for transaction:", err.message);
                }
                if (email) {
                    db.updateCustomerId(email, customerId);
                }
            }
            break;
        }

        default:
            console.log(`Ignored unhandled event type: ${eventType}`);
    }
}

// Global json middleware for other API routes
app.use(express.json());

// 1.5 Early Stage Quota and Status Route
app.get('/api/early-stage-status', (req, res) => {
    const email = req.query.email;
    const EARLY_STAGE_PHASE = process.env.EARLY_STAGE_PHASE || 'alpha';
    
    try {
        const alphaCounts = db.getTierCounts('alpha');
        const betaCounts = db.getTierCounts('beta');
        
        const alphaTotal = (alphaCounts.freeCount || 0) + (alphaCounts.paidCount || 0);
        const betaTotal = (betaCounts.freeCount || 0) + (betaCounts.paidCount || 0);

        let dynamicPhase = EARLY_STAGE_PHASE;
        if (!process.env.EARLY_STAGE_PHASE) {
            if (alphaTotal >= 150) {
                dynamicPhase = betaTotal >= 300 ? 'standard' : 'beta';
            } else {
                dynamicPhase = 'alpha';
            }
        }

        let userStatus = null;
        if (email) {
            const customer = db.getCustomerByEmail(email);
            if (customer) {
                const access = db.checkAccess(email);
                const badge = db.getCustomerBadge(email);
                userStatus = {
                    email: customer.email,
                    tier_tag: customer.tier_tag,
                    memberNumber: customer.member_number || 1,
                    badge: badge,
                    plan: access.plan,
                    hasActiveSubscription: access.hasAccess
                };
            }
        }
        
        res.json({
            phase: dynamicPhase,
            alpha: {
                freeCount: alphaCounts.freeCount,
                paidCount: alphaCounts.paidCount,
                freeLimit: 50,
                paidLimit: 100,
                total: alphaTotal,
                isFull: alphaTotal >= 150
            },
            beta: {
                freeCount: betaCounts.freeCount,
                paidCount: betaCounts.paidCount,
                freeLimit: 100,
                paidLimit: 200,
                total: betaTotal,
                isFull: betaTotal >= 300
            },
            user: userStatus
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. User Registration / Plan Update Route
app.post('/api/register', (req, res) => {
    const { email, password, termsAccepted } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: "Lütfen geçerli bir e-posta adresi girin." });
    }
    if (!password || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
        return res.status(400).json({ success: false, error: "Şifre en az 8 karakter uzunluğunda olmalı, en az 1 büyük harf ve 1 rakam içermelidir." });
    }
    if (termsAccepted === false) {
        return res.status(400).json({ success: false, error: "Devam etmek için Kullanım Koşulları ve KVKK Aydınlatma Metnini kabul etmelisiniz." });
    }

    const EARLY_STAGE_PHASE = process.env.EARLY_STAGE_PHASE || 'alpha';
    
    try {
        const existingUser = db.getCustomerByEmail(email.trim());

        // If user already exists and is verified or Google user, guide them to login
        if (existingUser && (existingUser.email_verified === 1 || existingUser.auth_provider === 'google')) {
            return res.status(409).json({ 
                success: false, 
                code: "USER_EXISTS", 
                error: "Bu e-posta adresine ait doğrulanmış bir hesap zaten mevcut. Giriş yap sekmesine yönlendiriliyorsunuz." 
            });
        }

        let tierTag = existingUser ? existingUser.tier_tag : null;

        if (!existingUser) {
            if (EARLY_STAGE_PHASE === 'expired') {
                return res.status(403).json({ success: false, error: "Erken aşama kayıtları sona ermiştir. Yeni hesap oluşturulamaz." });
            }

            const counts = db.getTierCounts(EARLY_STAGE_PHASE);
            const freeLimit = EARLY_STAGE_PHASE === 'alpha' ? 50 : 100;

            if (counts.freeCount >= freeLimit) {
                return res.status(403).json({ 
                    success: false, 
                    error: `${EARLY_STAGE_PHASE === 'alpha' ? 'Alpha' : 'Beta'} ücretsiz üye kotası (${freeLimit} kişi) dolmuştur. Yeni kayıt oluşturamazsınız.` 
                });
            }
            
            tierTag = EARLY_STAGE_PHASE;
        }

        const user = db.upsertCustomer(email.trim(), password, null, tierTag, 'v1.0');
        const otpCode = db.createOTP(email.trim());

        res.json({ 
            success: true, 
            requiresOTP: true, 
            email: user.email, 
            devCode: otpCode,
            message: "Kayıt işlemi başlatıldı. 6 haneli doğrulama kodunuz oluşturuldu." 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2.5 Verify OTP Route (With timingSafeEqual & Max Attempts Protection)
app.post('/api/verify-otp', (req, res) => {
    const { email, code } = req.body;
    if (!email || !code) {
        return res.status(400).json({ success: false, error: "E-posta adresi ve doğrulama kodu zorunludur." });
    }

    try {
        const result = db.verifyOTP(email, code);
        if (!result.success) {
            return res.status(400).json(result);
        }
        const user = db.getCustomerByEmail(email);
        const badge = db.getCustomerBadge(email);
        res.json({ success: true, customer: { ...user, badge }, message: "E-posta adresi başarıyla doğrulandı." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2.6 Resend OTP Route (With Backend Rate Limiting Cooldown Check)
app.post('/api/resend-otp', (req, res) => {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: "Geçerli bir e-posta adresi girin." });
    }

    try {
        const cooldownCheck = db.canResendOTP(email, 45);
        if (!cooldownCheck.canResend) {
            return res.status(429).json({ 
                success: false, 
                error: `Yeni doğrulama kodu istemek için lütfen ${cooldownCheck.secondsLeft} saniye bekleyin.`,
                secondsLeft: cooldownCheck.secondsLeft 
            });
        }

        const newCode = db.createOTP(email);
        res.json({ 
            success: true, 
            devCode: newCode,
            message: "Yeni 6 haneli doğrulama kodunuz oluşturuldu." 
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. User Login Route (scrypt verification + email_verified check)
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, error: "E-posta adresi ve şifre zorunludur." });
    }
    
    try {
        const user = db.getCustomerByEmail(email.trim());
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: "Bu e-posta adresine ait kayıtlı bir hesap bulunamadı. Lütfen 'Create Account' sekmesinden ücretsiz üye olun." 
            });
        }

        if (user.auth_provider === 'google' && !user.password_hash) {
            return res.status(400).json({
                success: false,
                isGoogleUser: true,
                error: "Bu hesap Google ile oluşturulmuştur. Lütfen üstteki 'Google ile Devam Et' butonunu kullanın."
            });
        }

        const isValid = db.verifyPasswordScrypt(password, user.password_hash, user.salt);
        if (!isValid && user.password !== password) {
            return res.status(401).json({ success: false, error: "Girdiğiniz şifre hatalıdır. Lütfen kontrol edip tekrar deneyin." });
        }

        // Unverified State Handling: Route to OTP Verification if email_verified === 0
        if (user.email_verified === 0) {
            const otpCode = db.createOTP(user.email);
            return res.json({ 
                success: true, 
                requiresOTP: true, 
                email: user.email, 
                devCode: otpCode,
                message: "E-posta adresiniz henüz doğrulanmamıştır. 6 haneli yeni doğrulama kodunuz e-postanıza gönderildi." 
            });
        }

        const badge = db.getCustomerBadge(user.email);
        res.json({ success: true, customer: { ...user, badge } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3.5 Google OAuth Backend Authentication & Account Linking Route
app.post('/api/auth/google', async (req, res) => {
    const { credential, email: inputEmail, googleId: inputGoogleId } = req.body;

    let email = inputEmail;
    let googleId = inputGoogleId || 'g_' + Math.random().toString(36).substr(2, 9);
    let name = 'Google User';

    if (credential) {
        try {
            const parts = credential.split('.');
            if (parts.length === 3) {
                const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
                const payload = JSON.parse(payloadJson);
                if (payload.email) {
                    email = payload.email;
                    googleId = payload.sub || googleId;
                    name = payload.name || name;
                }
            }
        } catch (err) {
            console.warn("Google JWT Token decode warning:", err.message);
        }
    }

    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: "Geçerli bir Google e-posta adresi alınamadı." });
    }

    try {
        const user = db.upsertGoogleUser(email, googleId, name, 'alpha');
        const badge = db.getCustomerBadge(email);
        res.json({ success: true, customer: { ...user, badge }, message: "Google hesabı ile başarıyla oturum açıldı." });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. License Check Endpoint (Used by website and Tauri desktop application)
app.get('/api/check-license', (req, res) => {
    const { email } = req.query;
    if (!email) {
        return res.status(400).json({ hasAccess: false, tier: 0, error: "Email parametresi zorunludur." });
    }

    try {
        const result = db.checkAccess(email);
        res.json(result);
    } catch (err) {
        res.status(500).json({ hasAccess: false, tier: 0, error: err.message });
    }
});

// 5. Customer Self-Service Portal Endpoint
app.post('/api/customer-portal', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: "E-posta adresi zorunludur." });
    }

    const customer = db.getCustomerByEmail(email);
    if (!customer) {
        return res.status(404).json({ error: "Müşteri veritabanında bulunamadı." });
    }

    if (customer.customer_id.startsWith('usr_')) {
        return res.status(400).json({ error: "Henüz Paddle üzerinden aktif bir abonelik başlatmadınız." });
    }

    try {
        // Mint Paddle Portal Session Link
        const session = await paddle.customerPortalSessions.create({
            customerId: customer.customer_id
        });

        const portalUrl = session.urls.general.url;
        res.json({ success: true, url: portalUrl });
    } catch (err) {
        console.error("Portal session creation failed:", err.message);
        res.status(500).json({ error: "Paddle portal oturumu oluşturulamadı: " + err.message });
    }
});

// 6. Admin Panel API Endpoints (For Database Inspector GUI)
app.get('/api/admin/users', (req, res) => {
    try {
        const users = db.getAllUsers();
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/clear', (req, res) => {
    try {
        db.clearDb();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/mock', (req, res) => {
    try {
        db.upsertCustomer('free@nex3dcore.com', '123456');
        db.upsertCustomer('student@nex3dcore.com', '123456');
        db.upsertCustomer('pro@nex3dcore.com', '123456');
        
        // Add sample subscriptions in SQLite
        db.upsertSubscription('sub_free_test', 'free@nex3dcore.com', 'ctm_free_test', 'active', 'pri_free', 'prod_free');
        db.upsertSubscription('sub_student_test', 'student@nex3dcore.com', 'ctm_student_test', 'active', 'pri_student', 'prod_student');
        db.upsertSubscription('sub_pro_test', 'pro@nex3dcore.com', 'ctm_pro_test', 'active', 'pri_pro', 'prod_pro');
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const path = require('path');
// Serve static frontend files (e.g. /account and /)
app.use(express.static(path.join(__dirname, '..')));

// Catch-all to log undefined routes
app.use((req, res) => {
    res.status(404).json({ error: "Route not found" });
});

// Start Server
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`NexDesign Backend Server running on port ${PORT}`);
    console.log(`License check: http://localhost:${PORT}/api/check-license`);
    console.log(`Webhook endpoint: http://localhost:${PORT}/api/paddle-webhook`);
    console.log(`==================================================`);
});

// Production Event Loop Keep-Alive
setInterval(() => {}, 60000);
