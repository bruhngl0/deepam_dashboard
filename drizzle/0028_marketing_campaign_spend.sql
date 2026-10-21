-- Ad spend from each lead sheet's "Campaign Summary" tab, saved by the sheet sync (lib/marketing/sheet-sync.ts)
-- whenever the sheets change, so the analytics database can work out cost per lead and payback. One row per
-- campaign, platform and week; replaced as a whole on each save.
CREATE TABLE IF NOT EXISTS marketing_campaign_spend (
  campaign text NOT NULL,
  platform text NOT NULL DEFAULT '',
  month text NOT NULL DEFAULT '',
  week text NOT NULL DEFAULT '',
  spend numeric(12,2) NOT NULL,
  leads integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign, platform, month, week)
);
