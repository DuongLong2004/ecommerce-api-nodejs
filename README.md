# 🛍️ E-Commerce Backend API

A production-grade REST API for a phone & laptop e-commerce platform, built with Node.js, Express, MySQL, and Redis. Features JWT authentication with multi-device session management, Google OAuth, account lockout, full-text product search, Redis caching, and an admin dashboard.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com)
[![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)](https://www.mysql.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io)
[![Tests](https://img.shields.io/badge/tests-97%2F97_passing-brightgreen)](https://github.com/DuongLong2004/ecommerce-api-nodejs/actions)
[![License](https://img.shields.io/badge/license-ISC-blue)](LICENSE)

> **🔗 Repositories**
>
> - **Backend** (this repo): https://github.com/DuongLong2004/ecommerce-api-nodejs
> - **Frontend**: https://github.com/DuongLong2004/ecommerce-frontend

---

## 🌐 Live Demo

| Service                | URL                                                             |
| ---------------------- | --------------------------------------------------------------- |
| **Frontend (Vercel)**  | https://ecommerce-frontend-rust-zeta.vercel.app                 |
| **Backend (Railway)**  | https://backend-project-production-6fc9.up.railway.app          |
| **API Docs (Swagger)** | https://backend-project-production-6fc9.up.railway.app/api-docs |
| **Health Check**       | https://backend-project-production-6fc9.up.railway.app/health   |

> 💡 **Try it now:** Open the frontend demo, register a new account, verify your email, and explore the full shopping flow.

---

## ✨ Features

### 🔐 Authentication & Security

- **JWT Access + Refresh Token** với rotation strategy (token mới mỗi lần refresh, detect token reuse)
- **Multi-device session management** — login từ nhiều thiết bị, view active sessions, revoke từng device hoặc all-others
- **Google OAuth 2.0** — đăng nhập 1-click, auto-link với email existing nếu trùng
- **Email verification** với token 24h expiry, resend supported (rate-limited)
- **Password reset** qua email với token 1h expiry (OWASP recommended)
- **Account lockout** sau 5 lần sai password → khoá 15 phút + email cảnh báo (HTTP 423 Locked)
- **Bcrypt** với 12 salt rounds (OWASP 2024 standard)
- **Rate limiting** đa tầng theo endpoint sensitivity (login 5/15min, forgot-password 3/15min, global 500/15min)
- **Helmet** security headers, **XSS sanitization** trên tất cả request body, **CORS** multi-origin với Vercel preview support

### 🛒 E-Commerce Core

- **Products** — full CRUD với MySQL **FULLTEXT search** (`MATCH AGAINST` thay vì `LIKE`), filter theo brand/category/price/specs (ram/rom/chip/camera/battery), sort, pagination
- **Product placements** — Flash Sale (với stock tracking + time window), Featured Phones, Featured Laptops, Homepage banners
- **Cart + Orders** — atomic transaction với row-level locking (`SELECT ... FOR UPDATE`) chống overselling khi nhiều user mua flash sale cùng lúc
- **Order tracking** — status flow (pending → confirmed → shipping → completed/cancelled)
- **Reviews + Ratings** — chỉ user đã mua + đơn completed mới review được, auto-calculate `avgRating` + `totalReviews` cho mỗi product, admin reply support
- **Wishlist** — add/remove products, get user wishlist
- **File upload** với multer + **magic bytes verification** (chống MIME confusion attack qua `file-type` lib)

### 👨‍💼 Admin Dashboard

- Quản lý products (CRUD, change status active/draft/outofstock)
- Quản lý orders (view all, update status)
- Quản lý users (view all, change role)
- Quản lý placements (Flash Sale, Featured slots với drag-reorder)
- Dashboard statistics

### ⚡ Performance & Production-Ready

- **Redis caching** cho GET endpoints (5min default, 10min cho product detail) với auto-invalidation
- **MySQL FULLTEXT INDEX** trên `(title, brand, description)` — gõ vài ký tự có kết quả ngay
- **Cursor-based pagination** cho orders/reviews (scale tốt hơn offset-based khi data lớn)
- **SCAN** thay vì **KEYS** trên Redis (non-blocking, production-safe)
- **PM2 cluster** mode (4 instances) với graceful shutdown
- **Connection pooling** cho MySQL (max 5, retry 3 lần)
- **Winston logger** với log levels + file rotation
- **GitHub Actions CI** — auto-run 97 Jest tests trên mỗi push
- **Dual-mode configs** — Railway/cloud (DATABASE_URL, REDIS_URL) hoặc local (separate env vars)

---

## 🛠️ Tech Stack

### Backend Core

| Category            | Technology                                                        |
| ------------------- | ----------------------------------------------------------------- |
| **Runtime**         | Node.js 20 (Alpine in Docker)                                     |
| **Framework**       | Express 5                                                         |
| **Database**        | MySQL 8 (production: Railway, local: Docker Compose)              |
| **ORM**             | Sequelize 6 (with CLI migrations)                                 |
| **Cache / Session** | Redis 7 (production: Railway, local: Docker Compose)              |
| **Auth**            | JWT (access 15m + refresh 7d), bcrypt 12 rounds, Google OAuth 2.0 |
| **Email**           | Resend (production) + Nodemailer Gmail SMTP (development)         |
| **Validation**      | Joi 18                                                            |
| **File Upload**     | Multer 2 + file-type (magic bytes verification)                   |
| **Security**        | Helmet, express-rate-limit, xss (input sanitization)              |
| **Logging**         | Winston 3                                                         |
| **Docs**            | Swagger UI + swagger-jsdoc                                        |

### Testing & DevOps

| Category        | Technology                                         |
| --------------- | -------------------------------------------------- |
| **Testing**     | Jest 30 + Supertest 7 (97 test cases)              |
| **Linting**     | ESLint 8 + Prettier 3                              |
| **Process Mgr** | PM2 (cluster mode, 4 instances local)              |
| **Container**   | Docker + Docker Compose                            |
| **CI/CD**       | GitHub Actions (auto-test on push to main/develop) |
| **Deployment**  | Railway (BE + MySQL + Redis), Vercel (FE)          |

---

## 🏗️ Architecture

### Request Flow

```
┌─────────────┐
│   Client    │ (React + Vite)
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Express App                              │
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Helmet  │→ │  CORS   │→ │   Rate   │→ │  Request Logger  │   │
│  │ Headers │  │  Multi  │  │  Limit   │  │    (Winston)     │   │
│  └─────────┘  └─────────┘  └──────────┘  └────────┬─────────┘   │
│                                                   │             │
│                                                   ▼             │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Router                              │   │
│  │  /api/auth  /api/users  /api/products  /api/orders ...   │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                │
│                ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Middleware Pipeline                                     │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │   │
│  │  │ verify  │→ │   XSS    │→ │   Joi    │→ │  Cache   │   │   │
│  │  │  Token  │  │ Sanitize │  │ Validate │  │  Check   │   │   │
│  │  └─────────┘  └──────────┘  └──────────┘  └──────────┘   │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                │
│                ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Controller (thin — only req/res handling)               │   │
│  └─────────────┬────────────────────────────────────────────┘   │
│                │                                                │
│                ▼                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Service Layer (business logic, transactions)            │   │
│  └─────┬──────────────────────────────────┬─────────────────┘   │
│        │                                  │                     │
│        ▼                                  ▼                     │
│  ┌──────────┐                       ┌──────────────┐            │
│  │ Sequelize│                       │ Redis Client │            │
│  │ (Models) │                       │ (Sessions +  │            │
│  └────┬─────┘                       │   Cache)     │            │
│       │                             └──────┬───────┘            │
└───────┼────────────────────────────────────┼─────────────────── ┘
        ▼                                    ▼
   ┌─────────┐                          ┌─────────┐
   │  MySQL  │                          │  Redis  │
   └─────────┘                          └─────────┘

   ┌───────────────────────────────────────────────────────┐
   │  Error Middleware (catches everything via catchAsync) │
   │  → Logs to Winston → Returns standardized response    │
   └───────────────────────────────────────────────────────┘
```

### Layered Architecture

Project follows a **clean layered architecture** with strict separation of concerns:

```
src/
├── config/          # Configuration (DB, Redis, email, Swagger, constants)
├── controllers/     # HTTP layer — req/res handling only (thin)
├── services/        # Business logic + transactions (the brain)
├── models/          # Sequelize ORM models + associations
├── router/          # Route definitions + Swagger annotations
├── middlewares/     # Cross-cutting concerns (auth, cache, validate, error, logger, upload)
├── validations/     # Joi schemas
├── utils/           # Helpers (AppError, catchAsync, logger, response)
├── __tests__/       # Jest test suites
├── app.js           # Express app setup
└── server.js        # Entry point + graceful shutdown
```

**Design principles:**

- **Controllers stay thin** — only extract `req`, call service, send response. No business logic.
- **Services own business logic** — all DB operations, transactions, validations.
- **`catchAsync` wrapper** + **global error middleware** = no try-catch boilerplate in controllers.
- **`AppError` class** = consistent error shape (`status`, `message`, `statusCode`, optional metadata).
- **`sendResponse` utility** = standardized response shape `{ status, message, data }` everywhere.

---

## 🗄️ Database Schema

### Tables Overview

### Tables Overview

| Table                | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `users`              | User accounts (email/password + Google OAuth)    |
| `products`           | Phone & laptop catalog                           |
| `product_specs`      | Product specifications (1-to-many with products) |
| `product_placements` | Flash Sale + Featured slots                      |
| `orders`             | Customer orders                                  |
| `order_items`        | Line items (many-to-one with orders)             |
| `reviews`            | Product reviews + ratings                        |
| `wishlists`          | User wishlists                                   |

**Key indexes per table:**

- **`users`** — `email` (unique), `googleId`, `role`, `lockedUntil`
- **`products`** — **FULLTEXT** on `(title, brand, description)`, plus `status`
- **`product_specs`** — `productId`, `sortOrder`
- **`product_placements`** — `(productId, placement)` unique, `(placement, sortOrder)`
- **`orders`** — `userId`, `status`, `createdAt`
- **`order_items`** — `orderId`, `productId`
- **`reviews`** — `(userId, productId)` unique, `productId`
- **`wishlists`** — `(userId, productId)` unique

### Key Design Decisions

#### 1. FULLTEXT INDEX for search

```sql
ALTER TABLE products
ADD FULLTEXT INDEX ft_products_search (title, brand, description);
```

Why not `LIKE '%keyword%'`?

- `LIKE` with leading wildcard cannot use B-tree index → full table scan O(n)
- FULLTEXT uses inverted index → O(log n)
- Boolean mode + prefix wildcard (`+iph* +16*`) gives instant typeahead UX
- Input sanitized via `sanitizeFulltextSearch()` to strip dangerous chars before `MATCH AGAINST`

#### 2. Composite unique index on `product_placements`

```sql
UNIQUE (productId, placement)
```

Ensures 1 product can only be in 1 placement slot once (e.g., a product can't be added to Flash Sale twice).

#### 3. Sequelize Migrations only — no `sync()`

Schema is managed exclusively via `migrations/*.js` files:

- ✅ Version controlled like code
- ✅ `up`/`down` for safe rollback
- ✅ Same schema across dev / staging / production
- ❌ No `sequelize.sync()` to avoid conflicts with migrations

8 migrations track full schema evolution:

```
20260423115844-add-status-to-products.js
20260423124104-create-product-placements.js
20260428000001-fix-refresh-token-column.js
20260430071036-add-fulltext-search-products.js
20260430135606-remove-refresh-token-from-users.js
20260505000001-add-email-verification.js
20260506000001-add-password-reset.js
20260507000001-add-google-oauth.js
20260508000001-add-account-lockout.js
```

#### 4. User table evolution

The `users` table evolved through 4 features (each in its own migration):

- **Email verification:** `isVerified`, `verificationToken`, `verificationTokenExpiresAt`
- **Password reset:** `passwordResetToken`, `passwordResetExpiresAt`
- **Google OAuth:** `googleId` (stores Google's `sub`, not email — email can change, `sub` is permanent)
- **Account lockout:** `failedLoginAttempts`, `lockedUntil`

---

## 🔒 Security Highlights

This section deep-dives into the security decisions that go beyond "just basic auth."

### 1. JWT Refresh Token Rotation + Reuse Detection

```
Login → Issue access (15m) + refresh (7d) → Store refresh in Redis
                                            session:{userId}:{deviceId}
   ↓
Request → access token expired
   ↓
POST /api/auth/refresh with refresh token
   ↓
Verify refresh token signature + deviceId
   ↓
Look up session in Redis with key session:{userId}:{deviceId}
   ↓
If token DOES NOT match Redis value → SUSPICIOUS!
   → Revoke entire session, force user to re-login
   → Log warning for admin investigation
   ↓
If matches → Issue NEW access + NEW refresh
   → Overwrite Redis with new refresh token
   → Old refresh token is now invalid
```

**Why this matters:**

- Stolen refresh token → attacker tries to use it → if user already refreshed (got new token), attacker's old token mismatches Redis → session revoked.
- This is **token reuse detection**, a security pattern from OAuth 2.1 draft.

### 2. Multi-Device Session Management

Each device gets its own session in Redis:

```
session:42:abc-uuid-1  →  { refreshToken, deviceName: "Chrome on Windows", ip, userAgent, lastActive }
session:42:def-uuid-2  →  { refreshToken, deviceName: "Safari on iPhone",  ip, userAgent, lastActive }
session:42:ghi-uuid-3  →  { refreshToken, deviceName: "Chrome on macOS",   ip, userAgent, lastActive }
```

API supports:

- `GET /api/auth/sessions` — list all active sessions with `isCurrent` flag
- `DELETE /api/auth/sessions` — logout from all OTHER devices (keep current)
- `DELETE /api/auth/sessions/:deviceId` — logout from a specific device

Sessions are scanned using **Redis `SCAN`** (non-blocking) instead of `KEYS` (blocking) — production-safe.

### 3. Account Lockout with Anti-Enumeration

Order of checks (carefully designed to prevent info leakage):

1. **Find user by email** → if not found, return generic `"Invalid email or password"` (don't reveal whether email exists).
2. **Check if account locked** (`lockedUntil > now`) → return 423 with `minutesRemaining`. This check runs **before** Google-only check to prevent attacker from distinguishing Google-only users (never locked) from regular users (lockable).
3. **Check if Google-only user** (password is null) → return 401 suggesting Google login. Don't increment `failedAttempts` (no password to brute-force).
4. **`bcrypt.compare()`** → if wrong, increment `failedAttempts`; if reaches 5, set `lockedUntil = now + 15min` + send warning email. If correct, reset `failedAttempts` to 0.

**Industry comparison:**

| Service      | Limit per account     |
| ------------ | --------------------- |
| GitHub       | 10 attempts / IP      |
| Google       | ~5 attempts / account |
| Microsoft    | 10 attempts / account |
| **This app** | **5 attempts** ⚖️     |

### 4. File Upload Magic Bytes Verification

Defense-in-depth against MIME confusion / polyglot file attacks:

1. **Multer pre-filters** by mimetype header → reject obvious non-images early.
2. **Read file into memory** (`memoryStorage`, NOT `diskStorage`).
3. **Verify magic bytes** with `file-type` lib:
   - JPEG: starts with `FF D8 FF`
   - PNG: starts with `89 50 4E 47 0D 0A 1A 0A`
4. **Only after verification** → write to disk with random filename.

**Why this matters:** An attacker could upload `evil.php.png` with PHP code inside. Header `Content-Type: image/png` passes mimetype check, but magic bytes check catches it.

### 5. Rate Limiting by Endpoint Sensitivity

| Endpoint                         | Limit       | Why                          |
| -------------------------------- | ----------- | ---------------------------- |
| `POST /auth/login`               | 5 / 15min   | Brute-force protection       |
| `POST /auth/forgot-password`     | 3 / 15min   | Prevent email spam           |
| `POST /auth/reset-password`      | 5 / 15min   | Prevent token brute-force    |
| `POST /auth/change-password`     | 10 / 15min  | Looser (user already authed) |
| `POST /auth/google`              | 10 / 15min  | Looser (Google pre-verified) |
| `POST /auth/resend-verification` | 3 / 15min   | Prevent email spam           |
| Global (all routes)              | 500 / 15min | DDoS soft protection         |

### 6. Other Security Measures

- **`helmet()`** — sets 15+ security headers (X-Frame-Options, CSP, etc.).
- **`trust proxy: 1`** — correctly extracts client IP from `X-Forwarded-For` behind Railway's proxy, without trusting attacker-spoofed headers.
- **`xss()` sanitization** in `validate.middleware.js` — recursively cleans all string fields in `req.body` before Joi validation.
- **CORS** — exact-match for `CLIENT_URL` + regex for Vercel preview deploys (`*.vercel.app`).
- **Generic error messages** for auth failures — never reveal whether email exists or password is wrong specifically.
- **Password policy** — minimum 8 chars, must contain letter + number, maximum 128 chars (prevents bcrypt DoS).

---

## ⚡ Performance Optimizations

### 1. Redis Caching with Auto-Invalidation

```javascript
// GET /api/products → 5min cache
router.get("/", cache(60 * 5), productController.getProducts);

// GET /api/products/:id → 10min cache
router.get("/:id", cache(60 * 10), productController.getProductById);
```

On product create/update/delete, cache is cleared:

```javascript
await clearCache("/api/products"); // wildcard clear for all product queries
```

### 2. SCAN vs KEYS

```javascript
// ❌ Blocks Redis — single-threaded, scales with total keyspace
const keys = await client.keys(`session:${userId}:*`);

// ✅ Non-blocking — cursor-based, returns in batches
const keys = [];
for await (const key of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
  keys.push(key);
}
```

Used in: `listSessions`, `deleteAllSessions`, `deleteOtherSessions`, `clearCache`.

### 3. Transactions + Row-Level Locking for Orders

```javascript
await sequelize.transaction(async (t) => {
  // SELECT ... FOR UPDATE — locks the row until transaction commits
  const product = await Product.findByPk(productId, {
    lock: t.LOCK.UPDATE,
    transaction: t,
  });

  if (product.stock < quantity) throw new AppError("Out of stock", 400);

  // For flash sale: also lock the placement row
  const placement = await ProductPlacement.findOne({
    where: { id: placementId, placement: "flashsale" },
    lock: t.LOCK.UPDATE,
    transaction: t,
  });

  // ... atomic stock decrement + order creation
});
```

**Why this matters:** Without locking, 2 users buying the last Flash Sale item simultaneously would both succeed → oversell. With `FOR UPDATE`, the 2nd user waits for the 1st to commit, then sees `stock = 0` and gets 409 Conflict.

### 4. Cursor-Based Pagination

Instead of `OFFSET 1000 LIMIT 10` (which scans 1010 rows), uses:

```javascript
where: { createdAt: { [Op.lt]: parseCursor(cursor) } },
limit: safeLimit + 1,
order: [["createdAt", "DESC"]]
```

**Benefits:**

- Constant-time pagination regardless of offset depth.
- Consistent results even if new rows inserted between requests.
- The `+1` trick lets us know `hasMore` without a separate `COUNT` query.

### 5. Other Performance Wins

- **MySQL connection pool**: `max: 5, idle: 10s` — tuned for Railway free tier (which caps at ~10 connections).
- **PM2 cluster mode** (4 instances locally) — utilizes multiple CPU cores.
- **Sequelize `attributes`** — explicitly select only needed columns, never `SELECT *`.
- **`raw: true`** for aggregation queries (e.g., `syncProductRating`) — skips Sequelize model instantiation overhead.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+ (LTS recommended)
- **MySQL** 8+
- **Redis** 7+ (optional — app runs without cache if Redis unavailable)
- **npm** 10+

### 1. Clone & install

```bash
git clone https://github.com/DuongLong2004/ecommerce-api-nodejs.git
cd backend-project
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in required values. See [Environment Variables](#-environment-variables) below.

### 3. Setup database

Create the database in MySQL:

```sql
CREATE DATABASE backend_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Run migrations to create all tables + indexes:

```bash
npx sequelize-cli db:migrate
```

### 4. Run the app

**Development** (with nodemon auto-reload):

```bash
npm run dev
```

**Production** (single instance):

```bash
npm start
```

**Production** (PM2 cluster mode — 4 instances, load balanced):

```bash
pm2 start ecosystem.config.js --env production
pm2 logs        # view logs
pm2 monit       # interactive monitoring
pm2 stop all    # stop
```

Server starts at `http://localhost:5000`. Swagger UI at `http://localhost:5000/api-docs`.

### 5. Run with Docker (alternative)

```bash
docker-compose up -d
```

This starts the backend container. You still need MySQL + Redis running separately (or extend `docker-compose.yml`).

---

## 🔑 Environment Variables

Copy `.env.example` to `.env` and fill in:

### Server

| Variable   | Required | Default                 | Description                  |
| ---------- | -------- | ----------------------- | ---------------------------- |
| `PORT`     | No       | `5000`                  | Server port                  |
| `NODE_ENV` | No       | `development`           | `development` / `production` |
| `BASE_URL` | No       | `http://localhost:5000` | Used for absolute URLs       |

### Database (choose ONE mode)

**Mode 1 — Connection string** (Railway / Heroku / Aiven auto-injects this):

| Variable       | Required                  | Description                          |
| -------------- | ------------------------- | ------------------------------------ |
| `DATABASE_URL` | Yes (if no separate vars) | `mysql://user:pass@host:port/dbname` |

**Mode 2 — Separate variables** (local development):

| Variable      | Required | Default     | Description    |
| ------------- | -------- | ----------- | -------------- |
| `DB_HOST`     | Yes      | `localhost` | MySQL host     |
| `DB_PORT`     | No       | `3306`      | MySQL port     |
| `DB_NAME`     | Yes      | -           | Database name  |
| `DB_USER`     | Yes      | -           | MySQL user     |
| `DB_PASSWORD` | Yes      | -           | MySQL password |

### JWT

| Variable             | Required | Description                                                                     |
| -------------------- | -------- | ------------------------------------------------------------------------------- |
| `JWT_SECRET`         | Yes      | Secret for access token. Generate with `crypto.randomBytes(64).toString("hex")` |
| `JWT_REFRESH_SECRET` | Yes      | Secret for refresh token. Use a DIFFERENT value                                 |
| `JWT_EXPIRES_IN`     | No       | Default `15m`                                                                   |

### Frontend URL

| Variable     | Required | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `CLIENT_URL` | Yes      | Used for CORS + email links (verify, reset, etc.) |

### Redis (choose ONE mode — optional, app degrades gracefully without)

**Mode 1 — Connection string** (Railway / Upstash):

| Variable    | Required | Description                                       |
| ----------- | -------- | ------------------------------------------------- |
| `REDIS_URL` | No       | `redis://default:pass@host:port` (or `rediss://`) |

**Mode 2 — Separate variables:**

| Variable         | Required | Default     | Description    |
| ---------------- | -------- | ----------- | -------------- |
| `REDIS_HOST`     | No       | `localhost` | Redis host     |
| `REDIS_PORT`     | No       | `6379`      | Redis port     |
| `REDIS_PASSWORD` | No       | -           | Redis password |

### Email (dual-mode — auto-switches by `NODE_ENV`)

**Development** (Nodemailer + Gmail SMTP):

| Variable          | Required       | Description                                    |
| ----------------- | -------------- | ---------------------------------------------- |
| `EMAIL_USER`      | Yes (dev mode) | Gmail address                                  |
| `EMAIL_PASSWORD`  | Yes (dev mode) | Gmail App Password (NOT regular password)      |
| `EMAIL_FROM_NAME` | No             | Sender display name, default `Backend Project` |

> **How to get Gmail App Password:** Enable 2-Step Verification → https://myaccount.google.com/apppasswords → generate 16-char password.

**Production** (Resend API — bypasses cloud SMTP restrictions):

| Variable              | Required        | Description                                            |
| --------------------- | --------------- | ------------------------------------------------------ |
| `RESEND_API_KEY`      | Yes (prod mode) | API key from resend.com                                |
| `RESEND_FROM_ADDRESS` | No              | Verified domain email, default `onboarding@resend.dev` |

### Google OAuth

| Variable           | Required | Description                                                                  |
| ------------------ | -------- | ---------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID` | Yes      | From Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client |

Authorized JavaScript origins must include your FE URL (`http://localhost:5173` for dev, `https://your-app.vercel.app` for prod).

---

## 📚 API Documentation

### Swagger UI

Full interactive API docs available at:

- **Local**: http://localhost:5000/api-docs
- **Production**: https://backend-project-production-6fc9.up.railway.app/api-docs

### Endpoint Summary

#### 🔐 Auth (`/api/auth`)

| Method | Endpoint               | Auth | Description                               |
| ------ | ---------------------- | ---- | ----------------------------------------- |
| POST   | `/register`            | No   | Register new account + send verify email  |
| POST   | `/login`               | No   | Email/password login (rate-limited 5/15m) |
| POST   | `/refresh`             | No   | Refresh access token (token rotation)     |
| POST   | `/logout`              | No   | Logout current device                     |
| GET    | `/verify-email`        | No   | Verify email with token from email        |
| POST   | `/resend-verification` | No   | Resend verify email (rate-limited 3/15m)  |
| POST   | `/forgot-password`     | No   | Send password reset email (3/15m)         |
| POST   | `/reset-password`      | No   | Reset password with token (5/15m)         |
| POST   | `/change-password`     | Yes  | Change password (authenticated, 10/15m)   |
| POST   | `/google`              | No   | Login/register with Google ID token       |
| GET    | `/sessions`            | Yes  | List all active sessions                  |
| DELETE | `/sessions`            | Yes  | Logout all OTHER devices                  |
| DELETE | `/sessions/:deviceId`  | Yes  | Logout specific device                    |

#### 👤 Users (`/api/users`)

| Method | Endpoint    | Auth        | Description                               |
| ------ | ----------- | ----------- | ----------------------------------------- |
| GET    | `/`         | Admin       | List all users                            |
| GET    | `/:id`      | Owner/Admin | Get user by ID                            |
| POST   | `/`         | No          | Create user (legacy — use /register)      |
| PUT    | `/:id`      | Owner/Admin | Update user (cannot change role/password) |
| DELETE | `/:id`      | Admin       | Delete user                               |
| PATCH  | `/:id/role` | Admin       | Change user role                          |

#### 🛍️ Products (`/api/products`)

| Method | Endpoint | Auth  | Description                                           |
| ------ | -------- | ----- | ----------------------------------------------------- |
| GET    | `/`      | No    | List products (filter, search, paginate, cached 5min) |
| GET    | `/:id`   | No    | Get product detail with specs (cached 10min)          |
| POST   | `/`      | Admin | Create product                                        |
| PUT    | `/:id`   | Admin | Update product                                        |
| DELETE | `/:id`   | Admin | Delete product                                        |

**Query params for `GET /api/products`:**

- `page`, `limit` — pagination (default 1, 10)
- `search` — FULLTEXT search across title/brand/description
- `category` — filter by category (`phone`, `laptop`)
- `brand` — single or multiple (`Apple,Samsung`)
- `minPrice`, `maxPrice` — price range
- `ram`, `rom`, `chip`, `camera`, `battery`, `display` — spec filters
- `status` — `active` / `draft` / `outofstock`

#### 🎯 Placements (`/api/placements`)

| Method | Endpoint                | Auth  | Description                                             |
| ------ | ----------------------- | ----- | ------------------------------------------------------- |
| GET    | `/?placement=flashsale` | No    | Get placement items (homepage/phones/laptops/flashsale) |
| GET    | `/admin?placement=...`  | Admin | Get all items (including expired flash sales)           |
| POST   | `/`                     | Admin | Add product to placement                                |
| PATCH  | `/reorder`              | Admin | Reorder items in placement (bulk update)                |
| PUT    | `/:id`                  | Admin | Update placement (e.g., change flash sale price/time)   |
| DELETE | `/:id`                  | Admin | Remove product from placement                           |

#### 🛒 Orders (`/api/orders`)

| Method | Endpoint      | Auth  | Description                        |
| ------ | ------------- | ----- | ---------------------------------- |
| GET    | `/`           | Admin | List all orders                    |
| GET    | `/me`         | Yes   | List my orders (cursor pagination) |
| GET    | `/:id`        | Yes   | Get order detail (owner or admin)  |
| POST   | `/`           | Yes   | Create order (atomic transaction)  |
| PATCH  | `/:id/cancel` | Yes   | Cancel order (only pending)        |
| PATCH  | `/:id/status` | Admin | Update order status                |

#### ⭐ Reviews (`/api/products/:id/reviews`)

| Method | Endpoint      | Auth        | Description                                        |
| ------ | ------------- | ----------- | -------------------------------------------------- |
| GET    | `/`           | No          | List reviews for product (cursor pagination)       |
| POST   | `/`           | Yes         | Create review (only if user purchased + completed) |
| DELETE | `/:rid`       | Owner/Admin | Delete review                                      |
| POST   | `/:rid/reply` | Admin       | Admin reply to review                              |

#### ❤️ Wishlist (`/api/wishlist`)

| Method | Endpoint      | Auth | Description     |
| ------ | ------------- | ---- | --------------- |
| GET    | `/`           | Yes  | Get my wishlist |
| POST   | `/`           | Yes  | Add product     |
| DELETE | `/:productId` | Yes  | Remove product  |

#### 📤 Upload (`/api`)

| Method | Endpoint          | Auth  | Description                                                |
| ------ | ----------------- | ----- | ---------------------------------------------------------- |
| POST   | `/upload/avatar`  | Yes   | Upload user avatar (jpg/png, max 2MB, magic-byte verified) |
| POST   | `/upload/product` | Admin | Upload product image                                       |

### Response Shape

All endpoints return JSON with this consistent shape:

```json
{
  "status": "success",
  "message": "Optional human-readable message",
  "data": { "...": "actual payload here" }
}
```

Error response:

```json
{
  "status": "error",
  "message": "Description of what went wrong",
  "data": null
}
```

---

## 🧪 Testing

### Run tests

```bash
npm test                # run all tests
npm run test:coverage   # with coverage report
```

Current status: **97 / 97 tests passing** ✅

### Test architecture

- **Framework:** Jest 30 + Supertest 7
- **Strategy:** Integration tests with full Express stack, all external dependencies mocked
- **Mocked:** Redis, MySQL (Sequelize models), Email service, Auth middleware
- **Coverage:** Auth flows (register, login, lockout, OAuth, refresh, reset, change password), Orders, Reviews, Wishlist

### CI

GitHub Actions auto-runs tests on every push to `main` and `develop`:

- Spins up MySQL 8 service
- Sets up Node 22 with npm cache
- Runs `npm ci` + `npm test`
- Fails the build if any test fails

See `.github/workflows/test.yml`.

---

## 📦 Deployment

### Production stack

- **Backend** → Railway (Node.js service)
- **MySQL** → Railway (managed)
- **Redis** → Railway (managed)
- **Frontend** → Vercel
- **Email** → Resend (production), Gmail SMTP (dev)

### Railway deployment

1. Connect GitHub repo to Railway
2. Add MySQL + Redis services (Railway auto-injects `DATABASE_URL` + `REDIS_URL`)
3. Set required env vars in Railway dashboard:
   - `JWT_SECRET`, `JWT_REFRESH_SECRET`
   - `CLIENT_URL` (Vercel URL)
   - `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`
   - `GOOGLE_CLIENT_ID`
   - `NODE_ENV=production`
4. Deploy → Railway auto-builds from `Dockerfile`
5. Run migrations once on Railway:

```bash
   railway run npx sequelize-cli db:migrate --env production
```

### Health check

Railway pings `/health` for liveness. Endpoint returns:

```json
{ "status": "OK", "message": "Backend is alive 🚀" }
```

---

## 🗂️ Project Structure

```
backend-project/
├── .github/workflows/         # GitHub Actions CI
├── migrations/                # Sequelize CLI migrations (8 files)
├── src/
│   ├── __tests__/             # Jest test suites
│   ├── config/                # DB, Redis, email, Swagger, constants
│   ├── controllers/           # HTTP layer (thin)
│   ├── middlewares/           # auth, cache, validate, error, logger, upload
│   ├── models/                # Sequelize models + associations
│   ├── router/                # Routes + Swagger annotations
│   ├── services/              # Business logic
│   ├── uploads/               # Static file storage (gitignored)
│   ├── utils/                 # AppError, catchAsync, logger, response
│   ├── validations/           # Joi schemas
│   ├── app.js                 # Express setup
│   └── server.js              # Entry point + graceful shutdown
├── .env.example               # Env template
├── .eslintrc.json             # ESLint config
├── .prettierrc.json           # Prettier config
├── docker-compose.yml         # Local Docker setup
├── Dockerfile                 # Production image
├── ecosystem.config.js        # PM2 cluster config
├── package.json
├── sequelize.config.js        # Migration CLI config
└── README.md
```

---

## 🛣️ Roadmap

Improvements I'd build next given more time:

- [ ] **Real payment integration** — Stripe / MoMo / VNPay (currently `cod` / `banking` / `momo` are status-only)
- [ ] **Email queue** — switch from sync send to BullMQ + Redis queue (don't block API on email failures)
- [ ] **Image CDN** — upload to Cloudinary / S3 instead of local disk (Railway resets disk on redeploy)
- [ ] **Soft deletes** — `paranoid: true` in Sequelize for `users`, `products`, `orders`
- [ ] **Audit log** — track admin actions (who changed what, when) for compliance
- [ ] **WebSocket notifications** — real-time order status updates to FE
- [ ] **Elasticsearch** — for product search beyond MySQL FULLTEXT (typo tolerance, synonyms)
- [ ] **Load testing** — k6 / Artillery scripts to benchmark and tune connection pools
- [ ] **OpenTelemetry** — distributed tracing for production debugging
- [ ] **Stripe webhooks** — async order state machine (if real payment added)

---

## 🤝 Contributing

This is a personal portfolio project, but contributions are welcome. If you spot a bug or have a suggestion:

1. Open an issue describing the problem
2. Fork → branch → commit → PR
3. Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `style:`, `perf:`)
4. Make sure `npm test` and `npm run lint` pass

---

## 📄 License

ISC

---

## 👤 Author

**Duong Long** ([@DuongLong2004](https://github.com/DuongLong2004))

- GitHub: https://github.com/DuongLong2004
- Backend repo: https://github.com/DuongLong2004/ecommerce-api-nodejs
- Frontend repo: https://github.com/DuongLong2004/ecommerce-frontend

---

<div align="center">

**Built with ❤️ — and a lot of `console.log` removed.**

If this project helped you learn something, consider giving it a ⭐ on GitHub!

</div>
