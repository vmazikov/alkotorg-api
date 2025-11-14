CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

ALTER TABLE "Product"
ADD COLUMN "search_vector" tsvector;

CREATE OR REPLACE FUNCTION set_product_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))), 'A') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW."canonicalName", ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.brand, ''))), 'B') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW.type, ''))), 'C') ||
    setweight(to_tsvector('simple', unaccent(coalesce(NEW."countryOfOrigin", ''))), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER product_search_vector_trigger
BEFORE INSERT OR UPDATE OF name, "canonicalName", brand, type, "countryOfOrigin"
ON "Product"
FOR EACH ROW EXECUTE FUNCTION set_product_search_vector();

UPDATE "Product"
SET "search_vector" =
  setweight(to_tsvector('simple', unaccent(coalesce(name, ''))), 'A') ||
  setweight(to_tsvector('simple', unaccent(coalesce("canonicalName", ''))), 'B') ||
  setweight(to_tsvector('simple', unaccent(coalesce(brand, ''))), 'B') ||
  setweight(to_tsvector('simple', unaccent(coalesce(type, ''))), 'C') ||
  setweight(to_tsvector('simple', unaccent(coalesce("countryOfOrigin", ''))), 'D');

CREATE INDEX IF NOT EXISTS "Product_search_vector_idx"
  ON "Product"
  USING GIN ("search_vector");

CREATE INDEX IF NOT EXISTS "Product_name_trgm_idx"
  ON "Product"
  USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_brand_trgm_idx"
  ON "Product"
  USING GIN ("brand" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Product_type_trgm_idx"
  ON "Product"
  USING GIN ("type" gin_trgm_ops);
