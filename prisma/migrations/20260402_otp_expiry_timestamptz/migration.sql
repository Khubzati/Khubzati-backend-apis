-- Change otp_expiry to timestamptz for correct absolute time comparisons
ALTER TABLE "users"
    ALTER COLUMN "otp_expiry" TYPE TIMESTAMPTZ(3);
