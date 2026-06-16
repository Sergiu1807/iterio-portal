-- Recover ads stuck mid-analysis (e.g. interrupted by an HMR recompile) so the
-- analyze pass picks them up again.
update competitor_ads
set ai_analysis_status = 'queued', ai_attempts = 0, ai_error_message = null
where ai_analysis_status in ('processing', 'failed');
