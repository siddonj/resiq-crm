-- server/migrations/verify-org-id-indexes.sql
-- Lists every table with an organization_id column and whether an index on
-- that column now exists. Run after applying 2026-07-10-org-id-indexes.sql
-- (and confirming migrations 063/064 have also been applied) — every row
-- should show has_org_index = true.
SELECT c.table_name,
       EXISTS (
         SELECT 1 FROM pg_index ix
         JOIN pg_class t ON t.oid = ix.indrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         WHERE t.relname = c.table_name AND a.attname = 'organization_id'
       ) AS has_org_index
FROM information_schema.columns c
WHERE c.column_name = 'organization_id' AND c.table_schema = 'public'
ORDER BY has_org_index, c.table_name;
