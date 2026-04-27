const TITLE_PATTERNS = [
  'vp operations',
  'director of property management',
  'head of asset management',
  'regional property manager',
  'coo',
  'property manager',
  'asset manager',
  'operations manager',
  'regional manager',
];

const MULTIFAMILY_KEYWORDS = [
  'multifamily',
  'property management',
  'apartment',
  'apartments',
  'resident',
  'leasing',
  'asset management',
  'portfolio',
  'proptech',
  'real estate',
];

const INTENT_TRIGGERS = [
  'portfolio expansion',
  'new regional manager',
  'system migration',
  'new pms rollout',
  'operational efficiency',
  'resident experience platform',
  'hiring',
  'expanding',
  'rollout',
  'implementation',
];

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function toScore(value) {
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

function scoreFit(lead) {
  const title = normalizeText(lead.title);
  const company = normalizeText(lead.company);
  const notes = normalizeText(lead.notes);
  const location = normalizeText(lead.location);
  const website = normalizeText(lead.website);
  const textBlob = `${title} ${company} ${notes} ${website}`;

  let score = 0;

  for (const pattern of TITLE_PATTERNS) {
    if (title.includes(pattern)) {
      score = Math.max(score, 40);
      break;
    }
  }

  let multifamilyHits = 0;
  for (const keyword of MULTIFAMILY_KEYWORDS) {
    if (textBlob.includes(keyword)) multifamilyHits++;
  }
  score += Math.min(35, multifamilyHits * 7);

  if (
    location.includes('us') ||
    location.includes('united states') ||
    location.includes('usa')
  ) {
    score += 10;
  }

  if (lead.linkedin_url) score += 8;
  if (lead.email) score += 7;

  return toScore(score);
}

function scoreIntent(lead) {
  const textBlob = normalizeText(`${lead.title} ${lead.company} ${lead.notes}`);
  let score = 0;

  for (const trigger of INTENT_TRIGGERS) {
    if (textBlob.includes(trigger)) score += 14;
  }

  if (textBlob.includes('hiring') || textBlob.includes('opening')) score += 10;
  if (textBlob.includes('new software') || textBlob.includes('switching')) score += 10;

  return toScore(score);
}

function scoreLead(lead) {
  const fitScore = scoreFit(lead);
  const intentScore = scoreIntent(lead);
  const totalScore = toScore(fitScore * 0.7 + intentScore * 0.3);

  let nextRecommendedAction = 'review';
  let status = 'new';

  if (totalScore >= 80) {
    nextRecommendedAction = 'start_outreach';
    status = 'qualified';
  } else if (totalScore >= 55) {
    nextRecommendedAction = 'draft_message';
    status = 'qualified';
  } else if (totalScore >= 35) {
    nextRecommendedAction = 'enrich_and_recheck';
    status = 'new';
  } else {
    nextRecommendedAction = 'deprioritize';
    status = 'disqualified';
  }

  return {
    fitScore,
    intentScore,
    totalScore,
    nextRecommendedAction,
    status,
  };
}

module.exports = {
  scoreLead,
};

