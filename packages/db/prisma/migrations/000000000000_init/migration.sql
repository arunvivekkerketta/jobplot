-- Enables the pgvector extension and exists so `prisma migrate deploy`
-- can order this before any migration that uses vector columns.
CREATE EXTENSION IF NOT EXISTS vector;
