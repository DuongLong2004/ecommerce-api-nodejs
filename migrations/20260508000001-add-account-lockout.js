"use strict";

/**
 * Migration: Thêm fields cho Account Lockout (Phần 8)
 * - failedLoginAttempts: đếm số lần login sai liên tiếp
 * - lockedUntil: thời điểm hết khoá (NULL = không bị khoá)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Thêm cột failedLoginAttempts
    await queryInterface.addColumn("users", "failedLoginAttempts", {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "Số lần login sai liên tiếp (reset về 0 khi login thành công)",
    });

    // Thêm cột lockedUntil
    await queryInterface.addColumn("users", "lockedUntil", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      comment: "Thời điểm hết khoá. NULL = tài khoản không bị khoá",
    });

    // Index trên lockedUntil để query nhanh (optional nhưng tốt cho production)
    await queryInterface.addIndex("users", ["lockedUntil"], {
      name: "idx_users_locked_until",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("users", "idx_users_locked_until");
    await queryInterface.removeColumn("users", "lockedUntil");
    await queryInterface.removeColumn("users", "failedLoginAttempts");
  },
};