-- Add search vector column for full-text search
ALTER TABLE "messages" ADD COLUMN "search_vector" tsvector;

-- Create GIN index for fast full-text search
CREATE INDEX "messages_search_vector_idx" ON "messages" USING GIN("search_vector");

-- Create function to update search vector
CREATE OR REPLACE FUNCTION messages_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Create trigger to auto-populate search vector on insert/update
CREATE TRIGGER messages_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "messages"
  FOR EACH ROW EXECUTE FUNCTION messages_search_vector_update();

-- Backfill existing messages (if any)
UPDATE "messages" SET search_vector = to_tsvector('english', COALESCE(content, ''));
