-- Add applyModifier flag to promos
ALTER TABLE "Promo"
  ADD COLUMN "applyModifier" BOOLEAN NOT NULL DEFAULT true;
