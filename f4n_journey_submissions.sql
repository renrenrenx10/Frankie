-- F4N Journey / Case Studies feature
-- Members submit their F4N journey via members.html ("My F4N Journey" section),
-- staff review and turn it into a published case study via scc.html
-- ("F4N Journey / Case Studies" screen).
--
-- Run this in the Supabase SQL editor. Safe to re-run individual sections —
-- CREATE POLICY isn't idempotent in this Postgres version, so if you need to
-- re-run the policy statements, drop them first (see bottom of file).

CREATE TABLE IF NOT EXISTS f4n_journey_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  company_name text, submitted_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  website text,
  company_overview text,
  journey_reason text,
  starting_gaps text,
  milestones text,
  impact_narrative text,
  impact_metrics text,
  opportunities_ahead text,
  five_year_outlook text,
  testimonial_quote text, testimonial_name text, testimonial_role text,
  photo_url text,
  photo2_url text,
  consent_given boolean DEFAULT false,
  case_study_slug text,
  reviewer_notes text, reviewed_at timestamptz, reviewed_by text
);

-- If the table already existed before these columns were added:
ALTER TABLE f4n_journey_submissions ADD COLUMN IF NOT EXISTS photo2_url text;
ALTER TABLE f4n_journey_submissions ADD COLUMN IF NOT EXISTS consent_given boolean DEFAULT false;

ALTER TABLE f4n_journey_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own journey submissions" ON f4n_journey_submissions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own journey submissions" ON f4n_journey_submissions
  FOR SELECT USING (auth.uid() = user_id);

-- Needed for staff (scc.html) to approve/reject/publish/unpublish. There's no
-- separate staff-role claim in this schema, so this permits any authenticated
-- user to update any row (same trust model as nr_profile_updates) — access to
-- scc.html itself is the actual gate. Tighten with a real staff check later
-- if this becomes production-critical.
CREATE POLICY "Staff can update journey submissions" ON f4n_journey_submissions
  FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- Supabase Storage: create a public bucket called 'f4n-journey-photos' in the
-- Supabase dashboard (Storage tab). Member uploads go to
-- {member_user_id}/photo-*.ext and {member_user_id}/photo2-*.ext; staff photo
-- replacements from scc.html go to {staff_user_id}/staff-edit-*.ext — both
-- rely on the bucket's default "uploader's own uid as first path segment"
-- storage policy.

-- To re-run the CREATE POLICY statements above (e.g. to adjust them), drop
-- them first:
-- DROP POLICY IF EXISTS "Users can insert own journey submissions" ON f4n_journey_submissions;
-- DROP POLICY IF EXISTS "Users can view own journey submissions" ON f4n_journey_submissions;
-- DROP POLICY IF EXISTS "Staff can update journey submissions" ON f4n_journey_submissions;
