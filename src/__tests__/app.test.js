const request = require("supertest");
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");

// ════════════════════════════════════════════════════════════════════════════
// MOCKS
// ════════════════════════════════════════════════════════════════════════════

jest.mock("../../src/config/redis", () => ({
  client: {
    isReady: false,
    get:     jest.fn().mockResolvedValue(null),
    setEx:   jest.fn().mockResolvedValue(true),
    keys:    jest.fn().mockResolvedValue([]),
    del:     jest.fn().mockResolvedValue(true),
  },
  // SCAN helper (production-safe alternative to KEYS)
  scanKeys: jest.fn().mockResolvedValue([]),
  // Multi-device session API
  createSession:       jest.fn().mockResolvedValue(true),
  getSession:          jest.fn().mockResolvedValue(null),
  touchSession:        jest.fn().mockResolvedValue(true),
  deleteSession:       jest.fn().mockResolvedValue(true),
  listSessions:        jest.fn().mockResolvedValue([]),
  deleteAllSessions:   jest.fn().mockResolvedValue(true),
  deleteOtherSessions: jest.fn().mockResolvedValue(true),
}));

// Mock email service — không gửi email thật khi test
jest.mock("../../src/services/email.service", () => ({
  sendVerificationEmail:  jest.fn().mockResolvedValue(true),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(true),
  sendAccountLockedEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../src/models/User", () => ({
  findOne:   jest.fn(),
  create:    jest.fn(),
  findAll:   jest.fn(),
  findByPk:  jest.fn(),
  update:    jest.fn(),
  hasMany:   jest.fn(),
  belongsTo: jest.fn(),
}));

jest.mock("../../src/models/index", () => ({
  User: require("../../src/models/User"),
  Order: {
    create:  jest.fn(), findAll: jest.fn(),
    findOne: jest.fn(), findByPk: jest.fn(),
    update:  jest.fn().mockResolvedValue([1]),
    hasMany: jest.fn(), belongsTo: jest.fn(),
  },
  OrderItem: {
    bulkCreate: jest.fn(), belongsTo: jest.fn(),
  },
  Product: {
    findByPk:        jest.fn(),
    findAll:         jest.fn(),
    findAndCountAll: jest.fn(),
    create:          jest.fn(),
    update:          jest.fn(),
    increment:       jest.fn().mockResolvedValue(true),
    hasMany:         jest.fn(),
    belongsTo:       jest.fn(),
  },
  ProductSpec: {
    bulkCreate: jest.fn(),
    destroy:    jest.fn(),
    belongsTo:  jest.fn(),
  },
  Review: {
    findAll:   jest.fn(),
    findOne:   jest.fn(),
    findByPk:  jest.fn(),
    create:    jest.fn(),
    hasMany:   jest.fn(),
    belongsTo: jest.fn(),
  },
  Wishlist: {
    findAll:      jest.fn(),
    findOne:      jest.fn(),
    findOrCreate: jest.fn(),
    hasMany:      jest.fn(),
    belongsTo:    jest.fn(),
  },
  ProductPlacement: {
    findOne:   jest.fn(),
    increment: jest.fn().mockResolvedValue(true),
    belongsTo: jest.fn(),
    hasMany:   jest.fn(),
  },
  sequelize: {
    sync:        jest.fn().mockResolvedValue(true),
    define:      jest.fn(),
    fn:          jest.fn().mockReturnValue("fn"),
    col:         jest.fn().mockReturnValue("col"),
    literal:     jest.fn().mockReturnValue({}),
    escape:      jest.fn((val) => `'${val}'`),
    transaction: jest.fn().mockImplementation(async (cb) => cb({
      LOCK: { UPDATE: "UPDATE" },
    })),
  },
}));

jest.mock("../../src/middlewares/auth.middleware", () => ({
  verifyToken: (req, res, next) => {
    req.user = { id: 1, role: "user" };
    next();
  },
}));

const app  = require("../../src/app");
const User = require("../../src/models/User");
const { Order, OrderItem, Product, Review, Wishlist } = require("../../src/models/index");
const emailService = require("../../src/services/email.service");
const {
  getSession,
  deleteAllSessions,
} = require("../../src/config/redis");

// ════════════════════════════════════════════════════════════════════════════
// TEST CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const VALID_PASSWORD = "Test1234";
const NEW_PASSWORD   = "NewPass1234";
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
      id: 1, name: "New User", email: "new@gmail.com",
      role: "user", isVerified: false,
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
      id: 1, name: "New User", email: "new@gmail.com",
      role: "user", isVerified: false,
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
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "test@gmail.com" });

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
      id: 1, name: "Test User", email: "test@gmail.com",
      password: hashedPassword, role: "user",
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
      id: 1, name: "Unverified User", email: "unverified@gmail.com",
      password: hashedPassword, role: "user",
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
      id: 1, email: "test@gmail.com", password: hashedPassword, role: "user",
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
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com" });

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
      id: 1, email: "test@gmail.com", password: hashedPassword,
      role: "user", isVerified: true,
      failedLoginAttempts: 2,    // đã sai 2 lần
      lockedUntil: null,
      update: updateMock,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@gmail.com", password: "WrongPass1" });

    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty("attemptsRemaining", 2); // còn 2 lần (5-3=2)

    // Counter được update lên 3
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ failedLoginAttempts: 3 })
    );
  });

  it("should reset failedLoginAttempts to 0 on successful login (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const updateMock = jest.fn().mockResolvedValue(true);

    // User đã sai 3 lần trước đó, giờ login đúng
    User.findOne.mockResolvedValue({
      id: 1, name: "Test User", email: "test@gmail.com",
      password: hashedPassword, role: "user", isVerified: true,
      failedLoginAttempts: 3,    // đã sai 3 lần
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
      lockedUntil:         null,
    });
  });

  it("should lock account and send email after 5 failed attempts (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const updateMock = jest.fn().mockResolvedValue(true);

    // User đã sai 4 lần → lần này sai lần 5 → trigger lock
    User.findOne.mockResolvedValue({
      id: 1, name: "Test User", email: "test@gmail.com",
      password: hashedPassword, role: "user", isVerified: true,
      failedLoginAttempts: 4,    // đã sai 4 lần
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
        lockedUntil:         expect.any(Date),
      })
    );

    // Email cảnh báo được gửi
    expect(emailService.sendAccountLockedEmail).toHaveBeenCalledTimes(1);
    expect(emailService.sendAccountLockedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to:       "test@gmail.com",
        userName: "Test User",
      })
    );
  });

  it("should reject login with 423 if account is currently locked (Phần 8)", async () => {
    const hashedPassword = await bcrypt.hash(VALID_PASSWORD, 12);
    const futureLockTime = new Date(Date.now() + 10 * 60 * 1000); // còn 10 phút

    User.findOne.mockResolvedValue({
      id: 1, email: "test@gmail.com", password: hashedPassword,
      role: "user", isVerified: true,
      failedLoginAttempts: 5,
      lockedUntil: futureLockTime,    // đang bị khoá
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
      id: 1, name: "Test User", email: "test@gmail.com",
      password: hashedPassword, role: "user", isVerified: true,
      failedLoginAttempts: 5,
      lockedUntil: pastLockTime,    // đã hết hạn lock
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
      lockedUntil:         null,
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
      id: 1, email: "test@gmail.com", name: "Test User",
      verificationToken: "valid_token_xyz",
      verificationTokenExpiresAt: futureDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .get("/api/auth/verify-email?token=valid_token_xyz&format=json");

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("thành công");
    expect(res.body.data.isVerified).toBe(true);
  });

  it("should redirect to FE success page (HTML mode)", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    User.findOne.mockResolvedValue({
      id: 1, email: "test@gmail.com", name: "Test User",
      verificationToken: "valid_token_xyz",
      verificationTokenExpiresAt: futureDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .get("/api/auth/verify-email?token=valid_token_xyz");

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/verify-email-success");
  });

  it("should return 400 if token missing (JSON mode)", async () => {
    const res = await request(app)
      .get("/api/auth/verify-email?format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("required");
  });

  it("should redirect to error page if token missing (HTML mode)", async () => {
    const res = await request(app)
      .get("/api/auth/verify-email");

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("/verify-email-error");
    expect(res.headers.location).toContain("missing_token");
  });

  it("should return 400 if token invalid (JSON mode)", async () => {
    User.findOne.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/auth/verify-email?token=invalid_xxx&format=json");

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("không hợp lệ");
  });

  it("should return 400 if token expired (JSON mode)", async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    User.findOne.mockResolvedValue({
      id: 1, email: "test@gmail.com",
      verificationToken: "expired_token",
      verificationTokenExpiresAt: pastDate,
      isVerified: false,
      update: jest.fn().mockResolvedValue(true),
    });

    const res = await request(app)
      .get("/api/auth/verify-email?token=expired_token&format=json");

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
      id: 1, email: "unverified@gmail.com", name: "User",
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
      id: 1, email: "verified@gmail.com", name: "User",
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
      id: 1, email: "test@gmail.com", name: "Test User",
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
        to:       "test@gmail.com",
        userName: "Test User",
        token:    expect.any(String),
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
      id: 1, email: "unverified@gmail.com", name: "User",
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
      id: 1, email: "test@gmail.com", name: "User",
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
      passwordResetToken:     null,
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
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({});

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
      id: 1, email: "test@gmail.com", name: "User",
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
        password:               expect.any(String),
        passwordResetToken:     null,
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
      id: 1, email: "test@gmail.com",
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
      passwordResetToken:     null,
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
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid_token" });

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

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: VALID_PASSWORD,
        newPassword:     NEW_PASSWORD,
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

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: "WrongPass1234",
        newPassword:     NEW_PASSWORD,
      });

    expect(res.statusCode).toBe(401);
    expect(res.body.message).toContain("không đúng");

    // Không update password, không revoke token
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("should return 400 if newPassword === currentPassword", async () => {
    const mockUser = await createMockUser(VALID_PASSWORD);
    User.findByPk.mockResolvedValue(mockUser);

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: VALID_PASSWORD,
        newPassword:     VALID_PASSWORD, // trùng
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("khác mật khẩu hiện tại");
    expect(mockUser.update).not.toHaveBeenCalled();
  });

  it("should return 400 if newPassword fails password policy", async () => {
    const res = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: VALID_PASSWORD,
        newPassword:     INVALID_PASSWORDS.TOO_SHORT,
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

    const res = await request(app)
      .post("/api/auth/change-password")
      .send({
        currentPassword: VALID_PASSWORD,
        newPassword:     NEW_PASSWORD,
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
    id: 1, email: "test@gmail.com", role: "user",
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
      id: 1, name: "Test", email: "t@gmail.com", role: "user",
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
      id: 1, name: "Old", email: "t@gmail.com", age: 20, role: "user",
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
      id: 1, title: "iPhone 16", price: 33990000, specs: [],
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
      id: 1, title: "iPhone", price: 33990000, stock: 10,
    });
    Order.create.mockResolvedValue({ id: 1, totalAmount: 67980000 });
    OrderItem.bulkCreate.mockResolvedValue([]);
    Product.increment.mockResolvedValue(true);

    const res = await request(app).post("/api/orders").send({
      items: [{ productId: 1, quantity: 2 }],
      shippingInfo: {
        name: "An", phone: "0909123456", email: "a@gmail.com", address: "123 ABC",
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
    const res = await request(app).post("/api/orders").send({
      items: [{ productId: 999, quantity: 1 }],
      shippingInfo: {
        name: "An", phone: "0909123456", email: "a@gmail.com", address: "123 ABC",
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it("should return 400 if out of stock", async () => {
    Product.findByPk.mockResolvedValue({
      id: 1, title: "iPhone", price: 33990000, stock: 0,
    });
    const res = await request(app).post("/api/orders").send({
      items: [{ productId: 1, quantity: 5 }],
      shippingInfo: {
        name: "An", phone: "0909123456", email: "a@gmail.com", address: "123 ABC",
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
      id: 1, userId: 1, status: "pending", OrderItems: [],
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
      id: 1, userId: 99, status: "pending", OrderItems: [],
    });
    const res = await request(app).get("/api/orders/1");
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /api/orders/:id/cancel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("should cancel order", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1, userId: 1, status: "pending",
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
      id: 1, userId: 1, status: "completed", OrderItems: [], update: jest.fn(),
    });
    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Cannot cancel a completed order");
  });

  it("should return 400 if already cancelled", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1, userId: 1, status: "cancelled", OrderItems: [], update: jest.fn(),
    });
    const res = await request(app).patch("/api/orders/1/cancel");
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Order already cancelled");
  });

  it("should return 403 if not owner", async () => {
    Order.findByPk.mockResolvedValue({
      id: 1, userId: 99, status: "pending", OrderItems: [], update: jest.fn(),
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
    expect(res.body.message).toBe(
      "Bạn cần mua và nhận hàng thành công mới được đánh giá!"
    );
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
      id: 1, userId: 1, productId: 1,
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