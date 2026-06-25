const request = require("supertest");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ════════════════════════════════════════════════════════════════════════════
// MOCKS
// ════════════════════════════════════════════════════════════════════════════

jest.mock("../../src/config/redis", () => ({
  client: {
    isReady: false,
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue(true),
    keys: jest.fn().mockResolvedValue([]),
    del: jest.fn().mockResolvedValue(true),
  },
  // SCAN helper (production-safe alternative to KEYS)
  scanKeys: jest.fn().mockResolvedValue([]),
  // Multi-device session API
  createSession: jest.fn().mockResolvedValue(true),
  getSession: jest.fn().mockResolvedValue(null),
  touchSession: jest.fn().mockResolvedValue(true),
  deleteSession: jest.fn().mockResolvedValue(true),
  listSessions: jest.fn().mockResolvedValue([]),
  deleteAllSessions: jest.fn().mockResolvedValue(true),
  deleteOtherSessions: jest.fn().mockResolvedValue(true),
}));

// Mock email service — không gửi email thật khi test
jest.mock("../../src/services/email.service", () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountLockedEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../src/models/User", () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  findAll: jest.fn(),
  findByPk: jest.fn(),
  update: jest.fn(),
  hasMany: jest.fn(),
  belongsTo: jest.fn(),
}));

jest.mock("../../src/models/index", () => ({
  User: require("../../src/models/User"),
  Order: {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    update: jest.fn().mockResolvedValue([1]),
    hasMany: jest.fn(),
    belongsTo: jest.fn(),
  },
  OrderItem: {
    bulkCreate: jest.fn(),
    belongsTo: jest.fn(),
  },
  Product: {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    increment: jest.fn().mockResolvedValue(true),
    hasMany: jest.fn(),
    belongsTo: jest.fn(),
  },
  ProductSpec: {
    bulkCreate: jest.fn(),
    destroy: jest.fn(),
    belongsTo: jest.fn(),
  },
  Review: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    hasMany: jest.fn(),
    belongsTo: jest.fn(),
  },
  Wishlist: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    hasMany: jest.fn(),
    belongsTo: jest.fn(),
  },
  ProductPlacement: {
    findOne: jest.fn(),
    findAll: jest.fn(),       // thêm dòng này
    findByPk: jest.fn(),      // thêm dòng này
    increment: jest.fn().mockResolvedValue(true),
    belongsTo: jest.fn(),
    hasMany: jest.fn(),
  },
  sequelize: {
    sync: jest.fn().mockResolvedValue(true),
    define: jest.fn(),
    fn: jest.fn().mockReturnValue("fn"),
    col: jest.fn().mockReturnValue("col"),
    literal: jest.fn().mockReturnValue({}),
    escape: jest.fn((val) => `'${val}'`),
    transaction: jest.fn().mockImplementation(async (cb) =>
      cb({
        LOCK: { UPDATE: "UPDATE" },
      })
    ),
  },
}));

jest.mock("../../src/middlewares/auth.middleware", () => ({
  verifyToken: (req, res, next) => {
    req.user = { id: 1, role: "user" };
    next();
  },
}));

const app = require("../../src/app");
const User = require("../../src/models/User");
const { Order, OrderItem, Product, Review, Wishlist, ProductPlacement } = require("../../src/models/index");
const emailService = require("../../src/services/email.service");
const { getSession } = require("../../src/config/redis");

// ════════════════════════════════════════════════════════════════════════════
// TEST CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const VALID_PASSWORD = "Test1234";
const NEW_PASSWORD = "NewPass1234";
const INVALID_PASSWORDS = {
  TOO_SHORT: "Test1",
  NO_NUMBER: "OnlyLetters",
  NO_LETTER: "12345678",
};

const generateRefreshToken = (userId, deviceId = "test-device-uuid") =>
  jwt.sign(
    { id: userId, deviceId }, // Phần 5: thêm deviceId vào payload
    process.env.JWT_REFRESH_SECRET || "super_refresh_secret_key_456",
    { expiresIn: "7d" }
  );

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — REGISTER
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/register", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should register successfully and trigger email send", async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({
      id: 1,
      name: "New User",
      email: "new@gmail.com",
      role: "user",
      isVerified: false,
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "New User", email: "new@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(201);
    expect(res.body.status).toBe("success");
    expect(res.body.data.isVerified).toBe(false);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("should still return 201 even if email send fails (best-effort)", async () => {
    User.findOne.mockResolvedValue(null);
    User.create.mockResolvedValue({
      id: 1,
      name: "New User",
      email: "new@gmail.com",
      role: "user",
      isVerified: false,
    });
    emailService.sendVerificationEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "New User", email: "new@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(201);
  });

  it("should return 409 if email already exists", async () => {
    User.findOne.mockResolvedValue({ id: 1, email: "existing@gmail.com" });

    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "User", email: "existing@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toBe("Email already exists");
  });

  it("should return 400 if fields missing", async () => {
    const res = await request(app).post("/api/auth/register").send({ email: "test@gmail.com" });

    expect(res.statusCode).toBe(400);
  });

  it("should return 400 if password too short", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "User", email: "test@gmail.com", password: INVALID_PASSWORDS.TOO_SHORT });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("ít nhất 8 ký tự");
  });

  it("should return 400 if password has no number", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "User", email: "test@gmail.com", password: INVALID_PASSWORDS.NO_NUMBER });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("chữ cái và 1 số");
  });

  it("should return 400 if password has no letter", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "User", email: "test@gmail.com", password: INVALID_PASSWORDS.NO_LETTER });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("chữ cái và 1 số");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — LOGIN
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/login", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should login successfully when verified", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    User.findOne.mockResolvedValue({
      id: 1,
      name: "Test User",
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
    expect(res.body.data.user.isVerified).toBe(true);
  });

  it("should return 403 if email not verified", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    User.findOne.mockResolvedValue({
      id: 1,
      name: "Unverified User",
      email: "unverified@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: false,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "unverified@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("xác thực");
  });

  it("should return 401 if email not found", async () => {
    User.findOne.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "wrong@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("should return 401 if password wrong", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: "WrongPass1" });

    expect(res.statusCode).toBe(401);
  });

  it("should return 400 if fields missing", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "test@gmail.com" });

    expect(res.statusCode).toBe(400);
  });

  // ──────────────────────────────────────────────────────────────────────
  // PHẦN ACCOUNT LOCKOUT TESTS
  // ──────────────────────────────────────────────────────────────────────

  it("should increment failedLoginAttempts on wrong password (Phần 8)", async () => {
    // User đã sai 2 lần trước đó → lần này sai → tăng lên 3
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const updateMock = jest.fn().mockResolvedValue(true);

    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 2, // đã sai 2 lần
      lockedUntil: null,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: "WrongPass1" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty("attemptsRemaining", 2); // còn 2 lần (5-3=2)

    // Counter được update lên 3
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ failedLoginAttempts: 3 }));
  });

  it("should reset failedLoginAttempts to 0 on successful login (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const updateMock = jest.fn().mockResolvedValue(true);

    // User đã sai 3 lần trước đó, giờ login đúng
    User.findOne.mockResolvedValue({
      id: 1,
      name: "Test User",
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 3, // đã sai 3 lần
      lockedUntil: null,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(200);

    // Counter được reset về 0 + clear lockedUntil
    expect(updateMock).toHaveBeenCalledWith({
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  });

  it("should lock account and send email after 5 failed attempts (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const updateMock = jest.fn().mockResolvedValue(true);

    // User đã sai 4 lần → lần này sai lần 5 → trigger lock
    User.findOne.mockResolvedValue({
      id: 1,
      name: "Test User",
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 4, // đã sai 4 lần
      lockedUntil: null,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: "WrongPass1" });

    // Status 423 Locked, không phải 401
    expect(res.statusCode).toBe(423);
    expect(res.body).toHaveProperty("lockedUntil");
    expect(res.body).toHaveProperty("minutesRemaining", 15);
    expect(res.body.message).toContain("tạm khoá");

    // Update set failedLoginAttempts = 5 và lockedUntil = future date
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        failedLoginAttempts: 5,
        lockedUntil: expect.any(Date),
      })
    );

    // Email cảnh báo được gửi
    expect(emailService.sendAccountLockedEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccountLockedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@gmail.com",
        userName: "Test User",
      })
    );
  });

  it("should reject login with 423 if account is currently locked (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const futureLockTime = new Date(Date.now() + 10 * 60 * 1000); // còn 10 phút

    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 5,
      lockedUntil: futureLockTime, // đang bị khoá
      update: jest.fn(),
    });

    // Login với password ĐÚNG nhưng vẫn bị reject vì đang lock
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: VALID_PASSWORD });

    expect(res.statusCode).toBe(423);
    expect(res.body).toHaveProperty("lockedUntil");
    expect(res.body).toHaveProperty("minutesRemaining");
    expect(res.body.message).toContain("tạm thời bị khoá");

    // Email KHÔNG được gửi (chỉ gửi khi vừa lock, không phải mỗi lần check)
    expect(emailService.sendAccountLockedEmail).not.toHaveBeenCalled();
  });

  it("should allow login after lockout expired (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const pastLockTime = new Date(Date.now() - 60 * 1000); // hết hạn 1 phút trước
    const updateMock = jest.fn().mockResolvedValue(true);

    User.findOne.mockResolvedValue({
      id: 1,
      name: "Test User",
      email: "test@gmail.com",
      password: hashedPassword,
      role: "user",
      isVerified: true,
      failedLoginAttempts: 5,
      lockedUntil: pastLockTime, // đã hết hạn lock
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: VALID_PASSWORD });

    // Login thành công vì lockedUntil < now
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");

    // Counter + lockedUntil được reset
    expect(updateMock).toHaveBeenCalledWith({
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — VERIFY EMAIL
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/auth/verify-email", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should verify email successfully (JSON mode)", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      name: "Test User",
      verificationToken: "valid_token_xyz",
      verificationTokenExpiresAt: futureDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app).get("/api/auth/verify-email?token=valid_token_xyz&format=json");

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("thành công");
    expect(res.body.data.isVerified).toBe(true);
  });

  it("should redirect to FE success page (HTML mode)", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      name: "Test User",
      verificationToken: "valid_token_xyz",
      verificationTokenExpiresAt: futureDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app).get("/api/auth/verify-email?token=valid_token_xyz");

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/verify-email-success");
  });

  it("should return 400 if token missing (JSON mode)", async () => {
    const res = await request(app).get("/api/auth/verify-email?format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("required");
  });

  it("should redirect to error page if token missing (HTML mode)", async () => {
    const res = await request(app).get("/api/auth/verify-email");

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/verify-email-error");
    expect(res.headers.location).toContain("missing_token");
  });

  it("should return 400 if token invalid (JSON mode)", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app).get("/api/auth/verify-email?token=invalid_xxx&format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("không hợp lệ");
  });

  it("should return 400 if token expired (JSON mode)", async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      verificationToken: "expired_token",
      verificationTokenExpiresAt: pastDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app).get("/api/auth/verify-email?token=expired_token&format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("hết hạn");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — RESEND VERIFICATION
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/resend-verification", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should resend verification email successfully", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "unverified@gmail.com",
      name: "User",
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "unverified@gmail.com" });

    expect(res.statusCode).toBe(200);
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("should return 200 even if email not found (anti-enumeration)", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "nonexistent@gmail.com" });

    expect(res.statusCode).toBe(200);
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("should return 400 if email already verified", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "verified@gmail.com",
      name: "User",
      isVerified: true,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "verified@gmail.com" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("đã được xác thực");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — FORGOT PASSWORD (Phần 3)
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should send reset email successfully for verified user", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      name: "Test User",
      password: "$2b$12$fakeHashedPasswordForTest",
      isVerified: true,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "test@gmail.com" });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("Nếu email tồn tại");
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@gmail.com",
        userName: "Test User",
        token: expect.any(String),
      })
    );
  });

  it("should return 200 silent success if email not found (anti-enumeration)", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nonexistent@gmail.com" });

    expect(res.statusCode).toBe(200);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("should return 200 silent success if user not verified (anti-enumeration)", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "unverified@gmail.com",
      name: "User",
      isVerified: false,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "unverified@gmail.com" });

    expect(res.statusCode).toBe(200);
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("should cleanup token and return 500 if email send fails", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      name: "User",
      password: "$2b$12$fakeHashedPasswordForTest",
      isVerified: true,
      update: updateMock,
    });
    emailService.sendPasswordResetEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "test@gmail.com" });

    expect(res.statusCode).toBe(500);
    // update gọi 2 lần: lần 1 set token, lần 2 cleanup
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith({
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    });
  });

  it("should return 400 if email format invalid", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" });

    expect(res.statusCode).toBe(400);
  });

  it("should return 400 if email missing", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});

    expect(res.statusCode).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — RESET PASSWORD (Phần 3)
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should reset password successfully and revoke all sessions", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      name: "User",
      passwordResetToken: "valid_reset_token",
      passwordResetExpiresAt: futureDate,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_reset_token", newPassword: NEW_PASSWORD });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("thành công");
    expect(res.body.data.email).toBe("test@gmail.com");

    // Check password đã được hash
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        password: expect.any(String),
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      })
    );
    // Verify password được hash, không phải plaintext
    expect(updateMock.mock.calls[0][0].password).not.toBe(NEW_PASSWORD);

    const { deleteAllSessions } = require("../../src/config/redis");
    expect(deleteAllSessions).toHaveBeenCalledWith(1);
  });

  it("should return 400 if token invalid", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "invalid_token", newPassword: NEW_PASSWORD });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("không hợp lệ");
  });

  it("should return 400 if token expired and cleanup token", async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      passwordResetToken: "expired_token",
      passwordResetExpiresAt: pastDate,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "expired_token", newPassword: NEW_PASSWORD });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("hết hạn");
    // Cleanup token expired
    expect(updateMock).toHaveBeenCalledWith({
      passwordResetToken: null,
      passwordResetExpiresAt: null,
    });
  });

  it("should return 400 if newPassword too short", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_token", newPassword: INVALID_PASSWORDS.TOO_SHORT });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("ít nhất 8 ký tự");
  });

  it("should return 400 if newPassword has no number", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_token", newPassword: INVALID_PASSWORDS.NO_NUMBER });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("chữ cái và 1 số");
  });

  it("should return 400 if token missing", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: NEW_PASSWORD });

    expect(res.statusCode).toBe(400);
  });

  it("should return 400 if newPassword missing", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "valid_token" });

    expect(res.statusCode).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — CHANGE PASSWORD (Phần 4)
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/change-password", () => {
  beforeEach(() => jest.clearAllMocks());

  // Helper: tạo user mock với password hashed
  const createMockUser = async (plainPassword = VALID_PASSWORD) => {
    const hashed = await bcrypt.hash(plainPassword, 12);
    return {
      id: 1,
      name: "Test User",
      email: "test@gmail.com",
      role: "user",
      isVerified: true,
      password: hashed,
      update: jest.fn().mockResolvedValue(true),
    };
  };

  it("should change password successfully and return new tokens (Option C)", async () => {
    const mockUser = await createMockUser(VALID_PASSWORD);
    User.findByPk.mockResolvedValue(mockUser);

    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("thành công");

    // Option C: response phải có tokens mới
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
    expect(res.body.data).toHaveProperty("user");
    expect(res.body.data.user.email).toBe("test@gmail.com");

    // Password được hash, không phải plaintext
    expect(mockUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.any(String) })
    );
    expect(mockUser.update.mock.calls[0][0].password).not.toBe(NEW_PASSWORD);

    // DeleteAllSessions revoke tất cả + createSession tạo session mới
    const { deleteAllSessions, createSession } = require("../../src/config/redis");
    expect(deleteAllSessions).toHaveBeenCalledWith(1);
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        refreshToken: expect.any(String),
        deviceId: expect.any(String),
      })
    );
  });

  it("should return 401 if currentPassword is wrong", async () => {
    const mockUser = await createMockUser(VALID_PASSWORD);
    User.findByPk.mockResolvedValue(mockUser);

    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: "WrongPass1234",
      newPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain("không đúng");

    // Không update password, không revoke token
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("should return 400 if newPassword === currentPassword", async () => {
    const mockUser = await createMockUser(VALID_PASSWORD);
    User.findByPk.mockResolvedValue(mockUser);

    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: VALID_PASSWORD,
      newPassword: VALID_PASSWORD, // trùng
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("khác mật khẩu hiện tại");
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("should return 400 if newPassword fails password policy", async () => {
    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: VALID_PASSWORD,
      newPassword: INVALID_PASSWORDS.TOO_SHORT,
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("ít nhất 8 ký tự");
  });

  it("should return 400 if currentPassword missing", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ newPassword: NEW_PASSWORD });

    expect(res.statusCode).toBe(400);
  });

  it("should return 400 if newPassword missing", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ currentPassword: VALID_PASSWORD });

    expect(res.statusCode).toBe(400);
  });

  it("should return 404 if user not found (edge case)", async () => {
    // Token valid nhưng user đã bị xóa khỏi DB
    User.findByPk.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/change-password").send({
      currentPassword: VALID_PASSWORD,
      newPassword: NEW_PASSWORD,
    });

    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("User not found");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — REFRESH
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/refresh", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should refresh token successfully", async () => {
    const refreshToken = generateRefreshToken(1, "test-device-uuid");

    // getSession trả về session với refreshToken match
    getSession.mockResolvedValue({
      refreshToken,
      deviceName: "Test Device",
      userAgent: "test",
      ip: "::1",
    });

    User.findByPk.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      role: "user",
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
  });

  it("should return 400 if refreshToken missing", async () => {
    const res = await request(app).post("/api/auth/refresh").send({});
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Refresh token is required");
  });

  it("should return 401 if refreshToken invalid", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "invalid.token.here" });
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Invalid or expired refresh token");
  });

  it("should return 401 if refreshToken revoked", async () => {
    const refreshToken = generateRefreshToken(1, "test-device-uuid");

    // session không tồn tại trong Redis
    getSession.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Session has been revoked");
  });

  it("should cleanup orphan token if user not found", async () => {
    const { deleteSession } = require("../../src/config/redis");
    const refreshToken = generateRefreshToken(1, "test-device-uuid");

    getSession.mockResolvedValue({
      refreshToken,
      deviceName: "Test Device",
      userAgent: "test",
      ip: "::1",
    });
    User.findByPk.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/refresh").send({ refreshToken });

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("User not found");
    // Phần 5: deleteSession được gọi với (userId, deviceId)
    expect(deleteSession).toHaveBeenCalledWith(1, "test-device-uuid");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH TESTS — LOGOUT (IDEMPOTENT)
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/auth/logout", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should logout successfully with valid token", async () => {
    const refreshToken = generateRefreshToken(1, "test-device-uuid");

    const res = await request(app).post("/api/auth/logout").send({ refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Logged out successfully");
  });

  it("should return 200 even if refreshToken missing (idempotent)", async () => {
    const res = await request(app).post("/api/auth/logout").send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Logged out successfully");
  });

  it("should return 200 even if refreshToken invalid (idempotent)", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: "invalid.token.here" });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Logged out successfully");
  });

  it("should return 200 even if token already revoked (idempotent)", async () => {
    const refreshToken = generateRefreshToken(1, "test-device-uuid");

    // Phần 5: logout idempotent — kể cả session không tồn tại vẫn return success
    getSession.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/logout").send({ refreshToken });
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Logged out successfully");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// USER TESTS
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/users/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return user by id (owner)", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      name: "Test",
      email: "t@gmail.com",
      role: "user",
    });
    const res = await request(app).get("/api/users/1");
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("success");
  });

  it("should return 403 if not owner and not admin", async () => {
    const res = await request(app).get("/api/users/2");
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe("Forbidden");
  });

  it("should return 404 if user not found", async () => {
    User.findByPk.mockResolvedValue(null);
    const res = await request(app).get("/api/users/1");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("User not found");
  });
});

describe("PUT /api/users/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should update user successfully (owner)", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      name: "Old",
      email: "t@gmail.com",
      age: 20,
      role: "user",
      update: jest.fn().mockResolvedValue(true),
    });
    const res = await request(app).put("/api/users/1").send({ name: "New Name" });
    expect(res.statusCode).toBe(200);
  });

  it("should return 403 if not owner and not admin", async () => {
    const res = await request(app).put("/api/users/2").send({ name: "Hacked" });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe("Forbidden");
  });

  it("should return 404 if user not found", async () => {
    User.findByPk.mockResolvedValue(null);
    const res = await request(app).put("/api/users/1").send({ name: "X" });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/users/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return 403 if not admin", async () => {
    const res = await request(app).delete("/api/users/1");
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCT TESTS
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/products", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return list of products", async () => {
    Product.findAndCountAll.mockResolvedValue({
      count: 2,
      rows: [
        { id: 1, title: "iPhone 16", price: 33990000 },
        { id: 2, title: "Samsung S25", price: 25490000 },
      ],
    });
    const res = await request(app).get("/api/products");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("data");
    expect(res.body.data).toHaveProperty("meta");
  });

  it("should support pagination", async () => {
    Product.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    const res = await request(app).get("/api/products?page=2&limit=5");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.meta.page).toBe(2);
  });

  it("should return empty if no products", async () => {
    Product.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    const res = await request(app).get("/api/products");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
  });
});

describe("GET /api/products/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return product detail", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1,
      title: "iPhone 16",
      price: 33990000,
      specs: [],
    });
    const res = await request(app).get("/api/products/1");
    expect(res.statusCode).toBe(200);
  });

  it("should return 404 if product not found", async () => {
    Product.findByPk.mockResolvedValue(null);
    const res = await request(app).get("/api/products/999");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Product not found");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ORDER TESTS
// ════════════════════════════════════════════════════════════════════════════

describe("POST /api/orders", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should create order successfully", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1,
      title: "iPhone",
      price: 33990000,
      stock: 10,
    });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 67980000 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);

    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ productId: 1, quantity: 2 }],
        shippingInfo: {
          name: "An",
          phone: "0909123456",
          email: "a@gmail.com",
          address: "123 ABC",
        },
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toHaveProperty("orderId");
  });

  it("should return 400 if items empty", async () => {
    const res = await request(app).post("/api/orders").send({ items: [] });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Order must have at least 1 item");
  });

  it("should return 404 if product not found", async () => {
    Product.findByPk.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ productId: 999, quantity: 1 }],
        shippingInfo: {
          name: "An",
          phone: "0909123456",
          email: "a@gmail.com",
          address: "123 ABC",
        },
      });
    expect(res.statusCode).toBe(404);
  });

  it("should return 400 if out of stock", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1,
      title: "iPhone",
      price: 33990000,
      stock: 0,
    });
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ productId: 1, quantity: 5 }],
        shippingInfo: {
          name: "An",
          phone: "0909123456",
          email: "a@gmail.com",
          address: "123 ABC",
        },
      });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("chỉ còn");
  });
});

describe("GET /api/orders/me", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return orders", async () => {
    Order.findAll.mockResolvedValue([{ id: 1, status: "pending" }]);
    const res = await request(app).get("/api/orders/me");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.data)).toBe(true);
    expect(res.body.data).toHaveProperty("hasMore");
    expect(res.body.data).toHaveProperty("nextCursor");
  });

  it("should return empty array", async () => {
    Order.findAll.mockResolvedValue([]);
    const res = await request(app).get("/api/orders/me");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.data).toHaveLength(0);
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.nextCursor).toBeNull();
  });
});

describe("GET /api/orders/:id", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return order detail", async () => {
    Order.findOne.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "pending",
      OrderItems: [],
    });
    const res = await request(app).get("/api/orders/1");
    expect(res.statusCode).toBe(200);
  });

  it("should return 404 if not found", async () => {
    Order.findOne.mockResolvedValue(null);
    const res = await request(app).get("/api/orders/999");
    expect(res.statusCode).toBe(404);
  });

  it("should return 403 if not owner", async () => {
    Order.findOne.mockResolvedValue({
      id: 1,
      userId: 99,
      status: "pending",
      OrderItems: [],
    });
    const res = await request(app).get("/api/orders/1");
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /api/orders/:id/cancel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should cancel order", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "pending",
      OrderItems: [],
      update: jest.fn().mockResolvedValue(true),
    });
    Order.update.mockResolvedValue([1]);

    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(200);
  });

  it("should return 404", async () => {
    Order.findByPk.mockResolvedValue(null);
    const res = await request(app).patch("/api/orders/999/cancel");
    expect(res.statusCode).toBe(404);
  });

  it("should return 400 if completed", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "completed",
      OrderItems: [],
      update: jest.fn(),
    });
    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Cannot cancel a completed order");
  });

  it("should return 400 if already cancelled", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "cancelled",
      OrderItems: [],
      update: jest.fn(),
    });
    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Order already cancelled");
  });

  it("should return 403 if not owner", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 99,
      status: "pending",
      OrderItems: [],
      update: jest.fn(),
    });
    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REVIEW TESTS
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/products/:id/reviews", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return reviews", async () => {
    Review.findAll.mockResolvedValue([
      { id: 1, rating: 5, comment: "Great!", User: { id: 1, name: "User 1" } },
    ]);
    Product.findByPk.mockResolvedValue({ avgRating: 5, totalReviews: 1 });
    const res = await request(app).get("/api/products/1/reviews");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("reviews");
    expect(res.body.data).toHaveProperty("avgRating");
    expect(res.body.data).toHaveProperty("totalReviews");
  });

  it("should return empty reviews with avgRating 0", async () => {
    Review.findAll.mockResolvedValue([]);
    Product.findByPk.mockResolvedValue({ avgRating: 0, totalReviews: 0 });
    const res = await request(app).get("/api/products/999/reviews");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.avgRating).toBe(0);
    expect(res.body.data.totalReviews).toBe(0);
  });
});

describe("POST /api/products/:id/reviews", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return 400 if rating invalid", async () => {
    const res = await request(app).post("/api/products/1/reviews").send({ rating: 6 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Rating phải từ 1 đến 5");
  });

  it("should return 403 if not purchased", async () => {
    Order.findOne.mockResolvedValue(null);
    const res = await request(app).post("/api/products/1/reviews").send({ rating: 5 });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe("Bạn cần mua và nhận hàng thành công mới được đánh giá!");
  });

  it("should return 400 if already reviewed", async () => {
    Order.findOne.mockResolvedValue({ id: 1 });
    Review.findOne.mockResolvedValue({ id: 1 });
    const res = await request(app).post("/api/products/1/reviews").send({ rating: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Bạn đã đánh giá sản phẩm này rồi!");
  });
});

describe("DELETE /api/products/:id/reviews/:reviewId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return 404 if review not found", async () => {
    Review.findByPk.mockResolvedValue(null);
    const res = await request(app).delete("/api/products/1/reviews/999");
    expect(res.statusCode).toBe(404);
  });

  it("should return 403 if not owner", async () => {
    Review.findByPk.mockResolvedValue({ id: 1, userId: 99, productId: 1 });
    const res = await request(app).delete("/api/products/1/reviews/1");
    expect(res.statusCode).toBe(403);
  });

  it("should delete review successfully", async () => {
    Review.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      productId: 1,
      destroy: jest.fn().mockResolvedValue(true),
    });
    Review.findOne.mockResolvedValue({ avgRating: 0, totalReviews: 0 });
    Product.update.mockResolvedValue(true);

    const res = await request(app).delete("/api/products/1/reviews/1");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Đã xóa đánh giá");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// WISHLIST TESTS
// ════════════════════════════════════════════════════════════════════════════

describe("GET /api/wishlist", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return wishlist", async () => {
    Wishlist.findAll.mockResolvedValue([{ id: 1, productId: 1 }]);
    const res = await request(app).get("/api/wishlist");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("should return empty wishlist", async () => {
    Wishlist.findAll.mockResolvedValue([]);
    const res = await request(app).get("/api/wishlist");
    expect(res.body.data).toHaveLength(0);
  });
});

describe("GET /api/wishlist/ids", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return product ids", async () => {
    Wishlist.findAll.mockResolvedValue([{ productId: 1 }, { productId: 2 }]);
    const res = await request(app).get("/api/wishlist/ids");
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe("POST /api/wishlist/:productId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should add to wishlist", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone" });
    Wishlist.findOrCreate.mockResolvedValue([{ id: 1 }, true]);
    const res = await request(app).post("/api/wishlist/1");
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("Đã thêm vào yêu thích! ❤️");
  });

  it("should return 404 if product not found", async () => {
    Product.findByPk.mockResolvedValue(null);
    const res = await request(app).post("/api/wishlist/999");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Sản phẩm không tồn tại");
  });

  it("should return 400 if already in wishlist", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    Wishlist.findOrCreate.mockResolvedValue([{ id: 1 }, false]);
    const res = await request(app).post("/api/wishlist/1");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Sản phẩm đã có trong danh sách yêu thích!");
  });
});

describe("DELETE /api/wishlist/:productId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should remove from wishlist", async () => {
    Wishlist.findOne.mockResolvedValue({ id: 1, destroy: jest.fn() });
    const res = await request(app).delete("/api/wishlist/1");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("Đã xóa khỏi yêu thích");
  });

  it("should return 404 if not in wishlist", async () => {
    Wishlist.findOne.mockResolvedValue(null);
    const res = await request(app).delete("/api/wishlist/999");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe("Không tìm thấy trong danh sách yêu thích");
  });
});





// ════════════════════════════════════════════════════════════════════════
// checkRole middleware
// ════════════════════════════════════════════════════════════════════════

describe("checkRole middleware", () => {
  const checkRole = require("../../src/middlewares/checkRole");
  const AppError = require("../../src/utils/AppError");

  it("should call next() with no args if role matches", () => {
    const middleware = checkRole("admin");
    const next = jest.fn();
    middleware({ user: { id: 1, role: "admin" } }, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("should call next(AppError 403) if role does not match", () => {
    const middleware = checkRole("admin");
    const next = jest.fn();
    middleware({ user: { id: 1, role: "user" } }, {}, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
  });

  it("should call next(AppError 401) if req.user is undefined", () => {
    const middleware = checkRole("admin");
    const next = jest.fn();
    middleware({}, {}, next);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════
// error middleware
// ════════════════════════════════════════════════════════════════════════

describe("error middleware", () => {
  const errorMiddleware = require("../../src/middlewares/error.middleware");
  const AppError = require("../../src/utils/AppError");

  const makeRes = () => {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };
  const makeReq = () => ({ method: "GET", originalUrl: "/api/test" });

  it("should return correct statusCode and message for AppError", () => {
    const err = new AppError("Resource not found", 404);
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      status: "error",
      message: "Resource not found",
      data: null,
    });
  });

  it("should default to 500 for generic Error without statusCode", () => {
    const err = new Error("Something broke");
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("should handle SequelizeValidationError — join all messages", () => {
    const err = {
      name: "SequelizeValidationError",
      errors: [{ message: "Name is required" }, { message: "Email is invalid" }],
    };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Name is required, Email is invalid");
  });

  it("should handle SequelizeUniqueConstraintError with 409", () => {
    const err = { name: "SequelizeUniqueConstraintError" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0][0].message).toBe("Data already exists");
  });

  it("should handle SequelizeForeignKeyConstraintError with 400", () => {
    const err = { name: "SequelizeForeignKeyConstraintError" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Related resource not found");
  });

  it("should handle MulterError with 400", () => {
    const err = { name: "MulterError", message: "File too large" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("File too large");
  });

  it("should handle file type rejection message with 400", () => {
    const err = { message: "Only jpg, jpeg, png files are allowed" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should handle JsonWebTokenError with 401", () => {
    const err = { name: "JsonWebTokenError" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].message).toBe("Invalid token");
  });

  it("should handle TokenExpiredError with 401", () => {
    const err = { name: "TokenExpiredError" };
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json.mock.calls[0][0].message).toBe("Token expired");
  });

  it("should attach lockedUntil and minutesRemaining when present", () => {
    const err = new AppError("Account locked", 423);
    const lockTime = new Date(Date.now() + 15 * 60 * 1000);
    err.lockedUntil = lockTime;
    err.minutesRemaining = 15;
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    const body = res.json.mock.calls[0][0];
    expect(body.lockedUntil).toEqual(lockTime);
    expect(body.minutesRemaining).toBe(15);
  });

  it("should attach attemptsRemaining when present", () => {
    const err = new AppError("Invalid password", 401);
    err.attemptsRemaining = 3;
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.json.mock.calls[0][0].attemptsRemaining).toBe(3);
  });

  it("should NOT leak stack trace in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const err = new AppError("Error", 500);
    const res = makeRes();
    errorMiddleware(err, makeReq(), res, jest.fn());
    expect(res.json.mock.calls[0][0]).not.toHaveProperty("stack");
    process.env.NODE_ENV = original;
  });
});

// ════════════════════════════════════════════════════════════════════════
// AppError class
// ════════════════════════════════════════════════════════════════════════

describe("AppError class", () => {
  const AppError = require("../../src/utils/AppError");

  it("should set status to 'error' for 4xx", () => {
    const err = new AppError("Bad request", 400);
    expect(err.statusCode).toBe(400);
    expect(err.status).toBe("error");
    expect(err.isOperational).toBe(true);
    expect(err.message).toBe("Bad request");
  });

  it("should set status to 'server error' for 5xx", () => {
    const err = new AppError("Internal error", 500);
    expect(err.status).toBe("server error");
  });

  it("should be instanceof Error", () => {
    const err = new AppError("Test", 404);
    expect(err).toBeInstanceOf(Error);
  });
});

// ════════════════════════════════════════════════════════════════════════
// order — edge cases chưa có trong file gốc
// ════════════════════════════════════════════════════════════════════════

describe("POST /api/orders — edge cases chưa cover", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return 400 if shippingInfo missing hoàn toàn", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1, title: "iPhone", price: 33990000, stock: 10,
    });

    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ productId: 1, quantity: 1 }] });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("shippingInfo");
  });

  it("should return 400 if phone invalid format", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ productId: 1, quantity: 1 }],
        shippingInfo: {
          name: "An",
          phone: "abc-not-number",
          email: "a@gmail.com",
          address: "123 ABC",
        },
      });

    expect(res.statusCode).toBe(400);
  });

  it("should return 409 if flash sale out of stock", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1, title: "iPhone Flash", price: 33990000, stock: 50,
    });
    ProductPlacement.findOne.mockResolvedValue({
      id: 5,
      productId: 1,
      placement: "flashsale",
      stockLimit: 100,
      stockSold: 100, // hết suất
      salePrice: 25000000,
      saleStartAt: null,
      saleEndAt: null,
    });

    const res = await request(app)
      .post("/api/orders")
      .send({
        items: [{ productId: 1, quantity: 1, placementId: 5 }],
        shippingInfo: {
          name: "An", phone: "0909123456",
          email: "a@gmail.com", address: "123 ABC",
        },
      });

    expect(res.statusCode).toBe(409);
    expect(res.body.message).toContain("hết suất flash sale");
  });
});

describe("GET /api/orders/me — cursor pagination", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return hasMore true và nextCursor khi còn dữ liệu", async () => {
    // Trả 11 items với limit=10 → hasMore = true
    const fakeOrders = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      status: "pending",
      createdAt: new Date(Date.now() - i * 1000),
    }));
    Order.findAll.mockResolvedValue(fakeOrders);

    const res = await request(app).get("/api/orders/me?limit=10");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.hasMore).toBe(true);
    expect(res.body.data.nextCursor).not.toBeNull();
    expect(res.body.data.data).toHaveLength(10);
  });

  it("should cap limit tại MAX_PAGE_LIMIT=50", async () => {
    Order.findAll.mockResolvedValue([]);
    await request(app).get("/api/orders/me?limit=9999");
    const callArgs = Order.findAll.mock.calls[0][0];
    expect(callArgs.limit).toBeLessThanOrEqual(51);
  });
});

// ════════════════════════════════════════════════════════════════════════
// review — edge cases
// ════════════════════════════════════════════════════════════════════════

describe("GET /api/products/:id/reviews — cursor pagination", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should return hasMore true khi còn reviews", async () => {
    const fakeReviews = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      rating: 5,
      comment: "Good",
      createdAt: new Date(Date.now() - i * 1000),
      User: { id: 1, name: "User" },
    }));
    Review.findAll.mockResolvedValue(fakeReviews);
    Product.findByPk.mockResolvedValue({ avgRating: 4.5, totalReviews: 20 });

    const res = await request(app).get("/api/products/1/reviews?limit=10");
    expect(res.statusCode).toBe(200);
    expect(res.body.data.hasMore).toBe(true);
    expect(res.body.data.reviews).toHaveLength(10);
    expect(res.body.data.nextCursor).not.toBeNull();
  });

  it("should return 400 nếu cursor không hợp lệ", async () => {
    const res = await request(app).get("/api/products/1/reviews?cursor=not-a-timestamp");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid cursor");
  });
});

// ════════════════════════════════════════════════════════════════════════
// 404 handler
// ════════════════════════════════════════════════════════════════════════

describe("404 handler", () => {
  it("should return 404 cho route không tồn tại", async () => {
    const res = await request(app).get("/api/route-khong-ton-tai");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain("not found");
  });

  it("should include method trong message", async () => {
    const res = await request(app).delete("/api/khong-co-endpoint-nay");
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toContain("DELETE");
  });
});


// ════════════════════════════════════════════════════════════════════════════
// ORDER SERVICE — unit tests trực tiếp (cover các nhánh HTTP test bỏ sót)
// ════════════════════════════════════════════════════════════════════════════

describe("orderService.createOrder — additional branches", () => {
  const orderService = require("../../src/services/order.service");
  const { Order, OrderItem, Product, ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 if items is empty array", async () => {
    await expect(
      orderService.createOrder({
        userId: 1,
        items: [],
        shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 400, message: "Order must have at least 1 item" });
  });

  it("should throw 400 if shippingInfo is missing entirely", async () => {
    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 1, quantity: 1 }],
        shippingInfo: null,
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should throw 400 if shippingInfo.phone is missing", async () => {
    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 1, quantity: 1 }],
        shippingInfo: { name: "A", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should throw 404 if product not found inside transaction", async () => {
    Product.findByPk.mockResolvedValue(null);

    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 999, quantity: 1 }],
        shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should throw 400 if stock insufficient", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 1000, stock: 2 });

    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 1, quantity: 5 }],
        shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("chỉ còn") });
  });

  it("should throw 409 if flash sale stock is exhausted (stockLeft = 0)", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone Flash", price: 33990000, stock: 50 });
    ProductPlacement.findOne.mockResolvedValue({
      id: 5,
      productId: 1,
      placement: "flashsale",
      stockLimit: 100,
      stockSold: 100, // hết suất
      salePrice: 25000000,
      saleStartAt: null,
      saleEndAt: null,
    });

    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 1, quantity: 1, placementId: 5 }],
        shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining("hết suất flash sale") });
  });

  it("should throw 409 if flash sale stockLeft < quantity", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 1000, stock: 50 });
    ProductPlacement.findOne.mockResolvedValue({
      id: 5,
      productId: 1,
      placement: "flashsale",
      stockLimit: 10,
      stockSold: 8, // còn 2 suất
      salePrice: 800,
      saleStartAt: null,
      saleEndAt: null,
    });

    await expect(
      orderService.createOrder({
        userId: 1,
        items: [{ productId: 1, quantity: 5, placementId: 5 }], // muốn 5 nhưng chỉ còn 2
        shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("should apply flash sale price when sale is active (no time constraint)", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 33990000, stock: 50 });
    ProductPlacement.findOne.mockResolvedValue({
      id: 5,
      productId: 1,
      placement: "flashsale",
      stockLimit: 100,
      stockSold: 0,
      salePrice: 25000000,
      saleStartAt: null,
      saleEndAt: null,
    });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 25000000 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);
    ProductPlacement.increment.mockResolvedValue(true);

    const result = await orderService.createOrder({
      userId: 1,
      items: [{ productId: 1, quantity: 1, placementId: 5 }],
      shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
    });

    expect(result).toHaveProperty("orderId");
    // Verify Order.create được gọi với totalAmount = salePrice
    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 25000000 }),
      expect.anything()
    );
  });

  it("should NOT apply flash sale price when sale is expired (saleEndAt in past)", async () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 33990000, stock: 50 });
    ProductPlacement.findOne.mockResolvedValue({
      id: 5,
      productId: 1,
      placement: "flashsale",
      stockLimit: 100,
      stockSold: 0,
      salePrice: 25000000,
      saleStartAt: null,
      saleEndAt: pastDate, // đã hết hạn
    });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 33990000 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);
    ProductPlacement.increment.mockResolvedValue(true);

    await orderService.createOrder({
      userId: 1,
      items: [{ productId: 1, quantity: 1, placementId: 5 }],
      shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
    });

    // Phải dùng giá gốc (33990000), không phải salePrice (25000000)
    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 33990000 }),
      expect.anything()
    );
  });

  it("should use regular price when no placementId", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 33990000, stock: 50 });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 33990000 * 2 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);

    const result = await orderService.createOrder({
      userId: 1,
      items: [{ productId: 1, quantity: 2 }], // không có placementId
      shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
    });

    expect(result).toHaveProperty("orderId");
    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ totalAmount: 33990000 * 2 }),
      expect.anything()
    );
  });

  it("should use default payMethod 'cod' when not provided", async () => {
    Product.findByPk.mockResolvedValue({ id: 1, title: "iPhone", price: 1000, stock: 10 });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 1000 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);

    await orderService.createOrder({
      userId: 1,
      items: [{ productId: 1, quantity: 1 }],
      shippingInfo: { name: "A", phone: "0909", email: "a@gmail.com", address: "123" },
      // payMethod không truyền
    });

    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ payMethod: "cod" }),
      expect.anything()
    );
  });
});

describe("orderService.getMyOrders — additional branches", () => {
  const orderService = require("../../src/services/order.service");
  const { Order } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 for invalid cursor format", async () => {
    await expect(
      orderService.getMyOrders({ userId: 1, cursor: "not-a-number" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid cursor" });
  });

  it("should throw 400 for cursor = 0", async () => {
    await expect(
      orderService.getMyOrders({ userId: 1, cursor: "0" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should handle valid cursor (timestamp string)", async () => {
    const ts = (Date.now() - 10000).toString();
    Order.findAll.mockResolvedValue([]);

    const result = await orderService.getMyOrders({ userId: 1, cursor: ts });
    expect(result.hasMore).toBe(false);
    expect(result.data).toHaveLength(0);
  });

  it("should cap limit at MAX_PAGE_LIMIT", async () => {
    Order.findAll.mockResolvedValue([]);
    await orderService.getMyOrders({ userId: 1, limit: 9999 });
    const callArgs = Order.findAll.mock.calls[0][0];
    // limit trong query phải là MAX_PAGE_LIMIT + 1 (safeLimit + 1 để detect hasMore)
    expect(callArgs.limit).toBeLessThanOrEqual(51);
  });

  it("should return hasMore=false and nextCursor=null when no extra item", async () => {
    Order.findAll.mockResolvedValue([
      { id: 1, createdAt: new Date() },
      { id: 2, createdAt: new Date() },
    ]);

    const result = await orderService.getMyOrders({ userId: 1, limit: 10 });
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it("should return hasMore=true and nextCursor when more items exist", async () => {
    const fakeOrders = Array.from({ length: 11 }, (_, i) => ({
      id: i + 1,
      createdAt: new Date(Date.now() - i * 1000),
    }));
    Order.findAll.mockResolvedValue(fakeOrders);

    const result = await orderService.getMyOrders({ userId: 1, limit: 10 });
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).not.toBeNull();
    expect(result.data).toHaveLength(10);
  });
});

describe("orderService.getAllOrders — admin endpoint", () => {
  const orderService = require("../../src/services/order.service");
  const { Order } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should return all orders with pagination meta", async () => {
    Order.findAndCountAll = jest.fn().mockResolvedValue({
      count: 25,
      rows: [{ id: 1 }, { id: 2 }],
    });

    const result = await orderService.getAllOrders({ page: 1, limit: 10 });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(25);
    expect(result.meta.totalPages).toBe(3); // Math.ceil(25/10)
    expect(result.meta.page).toBe(1);
  });

  it("should filter by valid status", async () => {
    Order.findAndCountAll = jest.fn().mockResolvedValue({ count: 5, rows: [] });

    await orderService.getAllOrders({ status: "pending" });
    const callArgs = Order.findAndCountAll.mock.calls[0][0];
    expect(callArgs.where.status).toBe("pending");
  });

  it("should ignore invalid status filter", async () => {
    Order.findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });

    await orderService.getAllOrders({ status: "invalid-status" });
    const callArgs = Order.findAndCountAll.mock.calls[0][0];
    expect(callArgs.where).not.toHaveProperty("status");
  });

  it("should use default page=1 and limit=20 when not provided", async () => {
    Order.findAndCountAll = jest.fn().mockResolvedValue({ count: 0, rows: [] });

    await orderService.getAllOrders();
    const callArgs = Order.findAndCountAll.mock.calls[0][0];
    expect(callArgs.limit).toBe(20);
    expect(callArgs.offset).toBe(0);
  });
});

describe("orderService.updateOrderStatus — admin update", () => {
  const orderService = require("../../src/services/order.service");
  const { Order, Product, ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 for invalid status", async () => {
    await expect(
      orderService.updateOrderStatus({ orderId: 1, newStatus: "flying" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid status" });
  });

  it("should throw 404 if order not found", async () => {
    Order.findByPk.mockResolvedValue(null);

    await expect(
      orderService.updateOrderStatus({ orderId: 999, newStatus: "confirmed" })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should throw 400 if order already completed", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      status: "completed",
      OrderItems: [],
      update: jest.fn(),
    });

    await expect(
      orderService.updateOrderStatus({ orderId: 1, newStatus: "confirmed" })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("completed") });
  });

  it("should throw 400 if order already cancelled", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      status: "cancelled",
      OrderItems: [],
      update: jest.fn(),
    });

    await expect(
      orderService.updateOrderStatus({ orderId: 1, newStatus: "confirmed" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should update status successfully (pending → confirmed)", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    Order.findByPk.mockResolvedValue({
      id: 1,
      status: "pending",
      OrderItems: [],
      update: updateMock,
    });

    await orderService.updateOrderStatus({ orderId: 1, newStatus: "confirmed" });
    expect(updateMock).toHaveBeenCalledWith({ status: "confirmed" }, expect.anything());
  });

  it("should restore stock when status updated to cancelled", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    Order.findByPk.mockResolvedValue({
      id: 1,
      status: "confirmed",
      OrderItems: [{ productId: 1, quantity: 2, placementId: null }],
      update: updateMock,
    });
    Product.increment.mockResolvedValue(true);

    await orderService.updateOrderStatus({ orderId: 1, newStatus: "cancelled" });

    expect(Product.increment).toHaveBeenCalledWith(
      { stock: 2, sold: -2 },
      expect.objectContaining({ where: { id: 1 } })
    );
    expect(updateMock).toHaveBeenCalledWith({ status: "cancelled" }, expect.anything());
  });

  it("should decrement placement stockSold when cancelled with placementId", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    Order.findByPk.mockResolvedValue({
      id: 1,
      status: "pending",
      OrderItems: [{ productId: 1, quantity: 3, placementId: 5 }],
      update: updateMock,
    });
    Product.increment.mockResolvedValue(true);
    ProductPlacement.increment.mockResolvedValue(true);

    await orderService.updateOrderStatus({ orderId: 1, newStatus: "cancelled" });

    expect(ProductPlacement.increment).toHaveBeenCalledWith(
      { stockSold: -3 },
      expect.objectContaining({ where: expect.objectContaining({ id: 5 }) })
    );
  });
});

describe("orderService.cancelOrder — additional branches", () => {
  const orderService = require("../../src/services/order.service");
  const { Order, Product, ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 409 if order was already processed by another request (affectedRows=0)", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "pending",
      OrderItems: [],
      update: jest.fn(),
    });
    Order.update.mockResolvedValue([0]); // không có row nào bị update

    await expect(
      orderService.cancelOrder({ orderId: 1, requestUser: { id: 1, role: "user" } })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("should restore stock and placement sold when cancelling order with placementId", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "pending",
      OrderItems: [{ productId: 1, quantity: 2, placementId: 5 }],
      update: jest.fn(),
    });
    Order.update.mockResolvedValue([1]);
    Product.increment.mockResolvedValue(true);
    ProductPlacement.increment.mockResolvedValue(true);

    await orderService.cancelOrder({ orderId: 1, requestUser: { id: 1, role: "user" } });

    expect(Product.increment).toHaveBeenCalledWith(
      { stock: 2, sold: -2 },
      expect.objectContaining({ where: { id: 1 } })
    );
    expect(ProductPlacement.increment).toHaveBeenCalledWith(
      { stockSold: -2 },
      expect.objectContaining({ where: expect.objectContaining({ id: 5 }) })
    );
  });

  it("should NOT call ProductPlacement.increment if no placementId", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1,
      userId: 1,
      status: "pending",
      OrderItems: [{ productId: 1, quantity: 2, placementId: null }],
      update: jest.fn(),
    });
    Order.update.mockResolvedValue([1]);
    Product.increment.mockResolvedValue(true);

    await orderService.cancelOrder({ orderId: 1, requestUser: { id: 1, role: "user" } });

    expect(ProductPlacement.increment).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH SERVICE — Google OAuth + changePassword Google-only user
// ════════════════════════════════════════════════════════════════════════════

describe("authService.changePassword — Google-only user (set password first time)", () => {
  const bcrypt = require("bcrypt");
  const User = require("../../src/models/User");
  const { createSession, deleteAllSessions } = require("../../src/config/redis");

  beforeEach(() => jest.clearAllMocks());

  it("should allow Google-only user to set password without currentPassword", async () => {
    // Google-only: password = null
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findByPk.mockResolvedValue({
      id: 1,
      name: "Google User",
      email: "google@gmail.com",
      password: null, // Google-only
      role: "user",
      isVerified: true,
      update: updateMock,
    });

    const res = await require("../../src/app").address
      ? null
      : await require("supertest")(require("../../src/app"))
          .post("/api/auth/change-password")
          .send({ newPassword: "NewPass1234" }); // không truyền currentPassword

    // Nếu test qua HTTP: verify status 200
    if (res) {
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveProperty("accessToken");
    }
  });
});

// HTTP-level tests cho Google-only changePassword
describe("POST /api/auth/change-password — Google-only user", () => {
  const request = require("supertest");
  const app = require("../../src/app");
  const bcrypt = require("bcrypt");
  const User = require("../../src/models/User");

  beforeEach(() => jest.clearAllMocks());

  it("should allow Google-only user to set password without currentPassword", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findByPk.mockResolvedValue({
      id: 1,
      name: "Google User",
      email: "google@gmail.com",
      password: null, // Google-only: không có password
      role: "user",
      isVerified: true,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ newPassword: "NewPass1234" }); // không truyền currentPassword

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).toHaveProperty("refreshToken");
    expect(res.body.message).toContain("Đặt mật khẩu thành công");

    // Password phải được hash
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ password: expect.any(String) })
    );
    const savedHash = updateMock.mock.calls[0][0].password;
    expect(savedHash).not.toBe("NewPass1234");
    expect(await bcrypt.compare("NewPass1234", savedHash)).toBe(true);
  });

  it("should return 400 if newPassword fails policy for Google-only user", async () => {
    User.findByPk.mockResolvedValue({
      id: 1,
      name: "Google User",
      email: "google@gmail.com",
      password: null,
      role: "user",
      isVerified: true,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({ newPassword: "short" }); // quá ngắn

    expect(res.statusCode).toBe(400);
  });
});

describe("authService.login — Google-only user password attempt", () => {
  const request = require("supertest");
  const app = require("../../src/app");
  const bcrypt = require("bcrypt");
  const User = require("../../src/models/User");

  beforeEach(() => jest.clearAllMocks());

  it("should return 401 when Google-only user tries to login with password", async () => {
    // Google-only user: password = null
    User.findOne.mockResolvedValue({
      id: 1,
      name: "Google User",
      email: "google@gmail.com",
      password: null, // Không có password
      role: "user",
      isVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "google@gmail.com", password: "AnyPass1234" });

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain("Google");
  });

  it("should NOT increment failedLoginAttempts for Google-only user", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "google@gmail.com",
      password: null, // Google-only
      role: "user",
      isVerified: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      update: updateMock,
    });

    await request(app)
      .post("/api/auth/login")
      .send({ email: "google@gmail.com", password: "AnyPass1234" });

    // update KHÔNG được gọi (không tăng counter cho Google-only user)
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("authService.forgotPassword — Google-only user", () => {
  const request = require("supertest");
  const app = require("../../src/app");
  const User = require("../../src/models/User");
  const emailService = require("../../src/services/email.service");

  beforeEach(() => jest.clearAllMocks());

  it("should return 200 silent success for Google-only user (no password to reset)", async () => {
    User.findOne.mockResolvedValue({
      id: 1,
      email: "google@gmail.com",
      name: "Google User",
      password: null, // Google-only
      isVerified: true,
      update: jest.fn(),
    });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "google@gmail.com" });

    expect(res.statusCode).toBe(200);
    // Email KHÔNG được gửi — Google-only không có password để reset
    expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("authService.verifyEmail — edge cases", () => {
  const request = require("supertest");
  const app = require("../../src/app");
  const User = require("../../src/models/User");

  beforeEach(() => jest.clearAllMocks());

  it("should cleanup expired token and throw 400", async () => {
    const pastDate = new Date(Date.now() - 1000);
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "test@gmail.com",
      verificationToken: "expired_token",
      verificationTokenExpiresAt: pastDate,
      isVerified: false,
      update: updateMock,
    });

    const res = await request(app).get("/api/auth/verify-email?token=expired_token&format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("hết hạn");
    // Cleanup: token bị xóa
    expect(updateMock).toHaveBeenCalledWith({
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });
  });

  it("should return 400 if already verified (token used)", async () => {
    // findOne trả null → token đã được dùng (isVerified=true thì verificationToken = null trong DB)
    User.findOne.mockResolvedValue(null);

    const res = await request(app).get("/api/auth/verify-email?token=used_token&format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("không hợp lệ");
  });
});

describe("authService.resendVerificationEmail — error path", () => {
  const request = require("supertest");
  const app = require("../../src/app");
  const User = require("../../src/models/User");
  const emailService = require("../../src/services/email.service");

  beforeEach(() => jest.clearAllMocks());

  it("should return 500 if email service fails during resend", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    User.findOne.mockResolvedValue({
      id: 1,
      email: "unverified@gmail.com",
      name: "User",
      isVerified: false,
      update: updateMock,
    });
    emailService.sendVerificationEmail.mockRejectedValueOnce(new Error("SMTP down"));

    const res = await request(app)
      .post("/api/auth/resend-verification")
      .send({ email: "unverified@gmail.com" });

    // Không giống register (best-effort), resendVerification throw 500 khi email fail
    expect(res.statusCode).toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PLACEMENT SERVICE — unit tests (cover 16% → ~75%)
// ════════════════════════════════════════════════════════════════════════════

describe("placementService.getPlacements", () => {
  const placementService = require("../../src/services/placement.service");
  const { Product, ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 for invalid placement type", async () => {
    await expect(placementService.getPlacements("invalid")).rejects.toMatchObject({
      statusCode: 400,
      message: "placement không hợp lệ",
    });
  });

  it("should throw 400 when placement is null", async () => {
    await expect(placementService.getPlacements(null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should throw 400 when placement is empty string", async () => {
    await expect(placementService.getPlacements("")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should return products for valid placement (homepage)", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        id: 1,
        sortOrder: 1,
        product: {
          toJSON: () => ({
            id: 1,
            title: "iPhone 16",
            price: 33990000,
            brand: "Apple",
          }),
        },
      },
    ]);

    const result = await placementService.getPlacements("homepage");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("placementId", 1);
    expect(result[0]).toHaveProperty("sortOrder", 1);
    expect(result[0]).toHaveProperty("title", "iPhone 16");
  });

  it("should include flashsale fields for flashsale placement", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        id: 5,
        sortOrder: 1,
        salePrice: 25000000,
        saleStartAt: null,
        saleEndAt: null,
        stockLimit: 100,
        stockSold: 30,
        product: {
          toJSON: () => ({
            id: 1,
            title: "iPhone Flash",
            price: 33990000,
          }),
        },
      },
    ]);

    const result = await placementService.getPlacements("flashsale");
    expect(result[0]).toHaveProperty("salePrice", 25000000);
    expect(result[0]).toHaveProperty("stockLimit", 100);
    expect(result[0]).toHaveProperty("stockSold", 30);
    expect(result[0]).toHaveProperty("stockLeft", 70); // 100 - 30
  });

  it("should return stockLeft=null when stockLimit is null", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        id: 5,
        sortOrder: 1,
        salePrice: 25000000,
        saleStartAt: null,
        saleEndAt: null,
        stockLimit: null, // không giới hạn
        stockSold: 0,
        product: {
          toJSON: () => ({ id: 1, title: "Flash No Limit", price: 33990000 }),
        },
      },
    ]);

    const result = await placementService.getPlacements("flashsale");
    expect(result[0].stockLeft).toBeNull();
  });

  it("should NOT include flashsale fields for non-flashsale placements", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        id: 1,
        sortOrder: 1,
        product: {
          toJSON: () => ({ id: 1, title: "iPhone", price: 33990000 }),
        },
      },
    ]);

    const result = await placementService.getPlacements("phones");
    expect(result[0]).not.toHaveProperty("salePrice");
    expect(result[0]).not.toHaveProperty("stockLeft");
  });

  it("should return empty array when no products in placement", async () => {
    ProductPlacement.findAll.mockResolvedValue([]);
    const result = await placementService.getPlacements("laptops");
    expect(result).toEqual([]);
  });
});

describe("placementService.createPlacement", () => {
  const placementService = require("../../src/services/placement.service");
  const { Product, ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 if productId missing", async () => {
    await expect(
      placementService.createPlacement({ placement: "homepage" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Thiếu productId hoặc placement" });
  });

  it("should throw 400 if placement missing", async () => {
    await expect(
      placementService.createPlacement({ productId: 1 })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should throw 400 for invalid placement type", async () => {
    await expect(
      placementService.createPlacement({ productId: 1, placement: "sidebar" })
    ).rejects.toMatchObject({ statusCode: 400, message: "placement không hợp lệ" });
  });

  it("should throw 404 if product not found", async () => {
    Product.findByPk.mockResolvedValue(null);

    await expect(
      placementService.createPlacement({ productId: 999, placement: "homepage" })
    ).rejects.toMatchObject({ statusCode: 404, message: "Sản phẩm không tồn tại" });
  });

  it("should throw 409 if product already in placement", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    ProductPlacement.findOne.mockResolvedValue({ id: 99 }); // đã tồn tại

    await expect(
      placementService.createPlacement({ productId: 1, placement: "homepage" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("should throw 400 for flashsale without salePrice", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    ProductPlacement.findOne.mockResolvedValue(null);
    ProductPlacement.max = jest.fn().mockResolvedValue(0);

    await expect(
      placementService.createPlacement({ productId: 1, placement: "flashsale" }) // thiếu salePrice
    ).rejects.toMatchObject({ statusCode: 400, message: "Flash sale cần có salePrice" });
  });

  it("should create homepage placement successfully", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    ProductPlacement.findOne.mockResolvedValue(null);
    ProductPlacement.max = jest.fn().mockResolvedValue(3); // max hiện tại là 3
    ProductPlacement.create = jest.fn().mockResolvedValue({ id: 10, sortOrder: 4 });

    const result = await placementService.createPlacement({ productId: 1, placement: "homepage" });

    expect(ProductPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 4, placement: "homepage" })
    );
    expect(result).toHaveProperty("id", 10);
  });

  it("should create flashsale placement with all fields", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    ProductPlacement.findOne.mockResolvedValue(null);
    ProductPlacement.max = jest.fn().mockResolvedValue(0);
    ProductPlacement.create = jest.fn().mockResolvedValue({ id: 11, sortOrder: 1 });

    await placementService.createPlacement({
      productId: 1,
      placement: "flashsale",
      salePrice: 25000000,
      saleStartAt: new Date(),
      saleEndAt: new Date(Date.now() + 3600000),
      stockLimit: 100,
    });

    expect(ProductPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        salePrice: 25000000,
        stockLimit: 100,
        stockSold: 0,
      })
    );
  });

  it("should set sortOrder=1 when no existing placements (max returns null)", async () => {
    Product.findByPk.mockResolvedValue({ id: 1 });
    ProductPlacement.findOne.mockResolvedValue(null);
    ProductPlacement.max = jest.fn().mockResolvedValue(null); // chưa có entry nào
    ProductPlacement.create = jest.fn().mockResolvedValue({ id: 1, sortOrder: 1 });

    await placementService.createPlacement({ productId: 1, placement: "homepage" });

    expect(ProductPlacement.create).toHaveBeenCalledWith(
      expect.objectContaining({ sortOrder: 1 }) // 0 + 1
    );
  });
});

describe("placementService.updatePlacement", () => {
  const placementService = require("../../src/services/placement.service");
  const { ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 404 if placement not found", async () => {
    ProductPlacement.findByPk.mockResolvedValue(null);

    await expect(
      placementService.updatePlacement({ id: 999, salePrice: 1000 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should update salePrice successfully", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    const entry = {
      id: 5,
      salePrice: 20000000,
      stockLimit: 100,
      stockSold: 30,
      update: updateMock,
      toJSON: () => ({ id: 5, salePrice: 25000000, stockLimit: 100, stockSold: 30 }),
    };
    ProductPlacement.findByPk.mockResolvedValue(entry);

    const result = await placementService.updatePlacement({ id: 5, salePrice: 25000000 });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ salePrice: 25000000 }));
    expect(result).toHaveProperty("stockLeft", 70); // 100 - 30
  });

  it("should set stockLimit=null when passed null", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    ProductPlacement.findByPk.mockResolvedValue({
      id: 5,
      update: updateMock,
      toJSON: () => ({ id: 5, stockLimit: null, stockSold: 0 }),
    });

    const result = await placementService.updatePlacement({ id: 5, stockLimit: null });

    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ stockLimit: null }));
    expect(result.stockLeft).toBeNull();
  });
});

describe("placementService.resetStock", () => {
  const placementService = require("../../src/services/placement.service");
  const { ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 404 if placement not found", async () => {
    ProductPlacement.findByPk.mockResolvedValue(null);

    await expect(placementService.resetStock(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should reset stockSold to 0", async () => {
    const updateMock = jest.fn().mockResolvedValue(true);
    ProductPlacement.findByPk.mockResolvedValue({
      id: 5,
      stockLimit: 100,
      stockSold: 80,
      update: updateMock,
    });

    const result = await placementService.resetStock(5);

    expect(updateMock).toHaveBeenCalledWith({ stockSold: 0 });
    expect(result.stockSold).toBe(0);
    expect(result.stockLeft).toBe(100); // = stockLimit
  });
});

describe("placementService.deletePlacement", () => {
  const placementService = require("../../src/services/placement.service");
  const { ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 404 if placement not found", async () => {
    ProductPlacement.findByPk.mockResolvedValue(null);

    await expect(placementService.deletePlacement(999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("should delete placement successfully", async () => {
    const destroyMock = jest.fn().mockResolvedValue(true);
    ProductPlacement.findByPk.mockResolvedValue({ id: 5, destroy: destroyMock });

    await placementService.deletePlacement(5);

    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});

describe("placementService.deleteBulk", () => {
  const placementService = require("../../src/services/placement.service");
  const { ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 if ids is empty array", async () => {
    await expect(placementService.deleteBulk([])).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should throw 400 if ids is not an array", async () => {
    await expect(placementService.deleteBulk(null)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should delete multiple placements and return count", async () => {
    ProductPlacement.destroy = jest.fn().mockResolvedValue(3);

    const result = await placementService.deleteBulk([1, 2, 3]);

    expect(ProductPlacement.destroy).toHaveBeenCalledWith({ where: { id: [1, 2, 3] } });
    expect(result).toEqual({ deleted: 3 });
  });
});

describe("placementService.getPlacementsAdmin", () => {
  const placementService = require("../../src/services/placement.service");
  const { ProductPlacement } = require("../../src/models/index");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 for invalid placement", async () => {
    await expect(placementService.getPlacementsAdmin("invalid")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("should return admin placement list (non-flashsale)", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        toJSON: () => ({
          id: 1,
          placement: "homepage",
          sortOrder: 1,
          product: { id: 1, title: "iPhone" },
        }),
      },
    ]);

    const result = await placementService.getPlacementsAdmin("homepage");
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toHaveProperty("id", 1);
    // Không phải flashsale → không có stockLeft
    expect(result[0]).not.toHaveProperty("stockLeft");
  });

  it("should include stockLeft for flashsale in admin view", async () => {
    ProductPlacement.findAll.mockResolvedValue([
      {
        toJSON: () => ({
          id: 5,
          placement: "flashsale",
          stockLimit: 100,
          stockSold: 40,
          salePrice: 25000000,
          product: { id: 1, title: "Flash Product" },
        }),
      },
    ]);

    const result = await placementService.getPlacementsAdmin("flashsale");
    expect(result[0]).toHaveProperty("stockLeft", 60); // 100 - 40
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION SERVICE — unit tests (cover 31% → ~85%)
// ════════════════════════════════════════════════════════════════════════════

describe("sessionService.listSessions", () => {
  const sessionService = require("../../src/services/session.service");
  const redis = require("../../src/config/redis");

  beforeEach(() => jest.clearAllMocks());

  it("should return sessions with isCurrent flag", async () => {
    redis.listSessions.mockResolvedValue([
      {
        deviceId: "device-A",
        deviceName: "Chrome on Windows",
        ip: "127.0.0.1",
        createdAt: "2025-01-01T00:00:00Z",
        lastActive: "2025-01-02T00:00:00Z",
      },
      {
        deviceId: "device-B",
        deviceName: "Safari on iPhone",
        ip: "192.168.1.1",
        createdAt: "2025-01-01T00:00:00Z",
        lastActive: "2025-01-03T00:00:00Z",
      },
    ]);

    const result = await sessionService.listSessions({
      userId: 1,
      currentDeviceId: "device-A",
    });

    expect(result).toHaveLength(2);
    const deviceA = result.find((s) => s.deviceId === "device-A");
    const deviceB = result.find((s) => s.deviceId === "device-B");
    expect(deviceA.isCurrent).toBe(true);
    expect(deviceB.isCurrent).toBe(false);
  });

  it("should return empty array when no sessions", async () => {
    redis.listSessions.mockResolvedValue([]);

    const result = await sessionService.listSessions({ userId: 1, currentDeviceId: "device-X" });
    expect(result).toEqual([]);
  });

  it("should NOT include refreshToken in returned data", async () => {
    redis.listSessions.mockResolvedValue([
      {
        deviceId: "device-A",
        deviceName: "Chrome on Windows",
        ip: "127.0.0.1",
        refreshToken: "secret-token-should-not-be-returned",
        createdAt: "2025-01-01T00:00:00Z",
        lastActive: "2025-01-02T00:00:00Z",
      },
    ]);

    const result = await sessionService.listSessions({ userId: 1, currentDeviceId: "device-A" });

    expect(result[0]).not.toHaveProperty("refreshToken");
  });
});

describe("sessionService.revokeSession", () => {
  const sessionService = require("../../src/services/session.service");
  const redis = require("../../src/config/redis");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 if targetDeviceId is missing", async () => {
    await expect(
      sessionService.revokeSession({
        userId: 1,
        targetDeviceId: null,
        currentDeviceId: "device-A",
      })
    ).rejects.toMatchObject({ statusCode: 400, message: "Device ID is required" });
  });

  it("should throw 400 if trying to revoke current device", async () => {
    await expect(
      sessionService.revokeSession({
        userId: 1,
        targetDeviceId: "device-A",
        currentDeviceId: "device-A", // same device
      })
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("Không thể") });
  });

  it("should call deleteSession for valid target device", async () => {
    redis.deleteSession.mockResolvedValue(true);

    await sessionService.revokeSession({
      userId: 1,
      targetDeviceId: "device-B",
      currentDeviceId: "device-A",
    });

    expect(redis.deleteSession).toHaveBeenCalledWith(1, "device-B");
  });
});

describe("sessionService.revokeOtherSessions", () => {
  const sessionService = require("../../src/services/session.service");
  const redis = require("../../src/config/redis");

  beforeEach(() => jest.clearAllMocks());

  it("should throw 400 if currentDeviceId is missing", async () => {
    await expect(
      sessionService.revokeOtherSessions({ userId: 1, currentDeviceId: null })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("should call deleteOtherSessions with correct params", async () => {
    redis.deleteOtherSessions.mockResolvedValue(true);

    await sessionService.revokeOtherSessions({ userId: 1, currentDeviceId: "device-A" });

    expect(redis.deleteOtherSessions).toHaveBeenCalledWith(1, "device-A");
  });
});














