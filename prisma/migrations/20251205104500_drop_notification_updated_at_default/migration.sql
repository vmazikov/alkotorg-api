-- Ensure Notification.updatedAt has no default to match @updatedAt behavior
ALTER TABLE "Notification"
  ALTER COLUMN "updatedAt" DROP DEFAULT;
