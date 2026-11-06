-- ═══════════════════════════════════════════════════════════
-- nr_companies_archive.sql
-- Run once in the Supabase SQL editor.
--
-- Adds an "archived" state for members who have chosen not to renew.
--
-- This is deliberately NOT the same thing as the existing `hidden` flag:
--   hidden   = temporarily off the public NuclearReady Explorer
--   archived = this member has lapsed / did not renew
--
-- Archiving from scc.html sets hidden = true as well, so one action both
-- removes them from the Explorer and drops them out of the active CRM list.
-- Nothing is deleted — evidence, assessments and history stay attached, and
-- a company can be restored at any time.
-- ═══════════════════════════════════════════════════════════

alter table nr_companies
  add column if not exists archived       boolean not null default false,
  add column if not exists archived_at    timestamptz,
  add column if not exists archive_reason text;

-- The Companies screen filters on archived on every load.
create index if not exists nr_companies_archived_idx
  on nr_companies (archived);

comment on column nr_companies.archived is
  'True when the member did not renew. Hides them from the active Companies list, the Explorer and all company dropdowns. Not the same as hidden.';
comment on column nr_companies.archived_at is
  'When the company was archived (UTC).';
comment on column nr_companies.archive_reason is
  'Free-text note captured at archive time, e.g. "Did not renew".';
