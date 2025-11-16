-- Drop search_vector machinery and legacy trigram indexes
DROP TRIGGER IF EXISTS product_search_vector_trigger ON "Product";
DROP FUNCTION IF EXISTS set_product_search_vector();

-- Remove indexes if they are still present
DROP INDEX IF EXISTS "Product_search_vector_idx";
DROP INDEX IF EXISTS "Product_name_trgm_idx";
DROP INDEX IF EXISTS "Product_brand_trgm_idx";
DROP INDEX IF EXISTS "Product_type_trgm_idx";

-- Drop column that is no longer used
ALTER TABLE "Product" DROP COLUMN IF EXISTS "search_vector";
