-- DropIndex (idempotent для прод БД)
DROP INDEX IF EXISTS "Product_brand_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Product_name_trgm_idx";

-- DropIndex
DROP INDEX IF EXISTS "Product_search_vector_idx";

-- DropIndex
DROP INDEX IF EXISTS "Product_type_trgm_idx";
