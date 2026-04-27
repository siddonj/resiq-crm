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
  const reasons = [];

  for (const pattern of TITLE_PATTERNS) {
    if (title.includes(pattern)) {
      score = Math.max(score, 40);
      reasons.push(`Title match: ${pattern}`);
      break;
    }
  }

  let multifamilyHits = 0;
  for (const keyword of MULTIFAMILY_KEYWORDS) {
    if (textBlob.includes(keyword)) multifamilyHits++;
  }
  score += Math.min(35, multifamilyHits * 7);
  if (multifamilyHits > 0) {
    reasons.push(`Industry signal keywords matched (${multifamilyHits})`);
  }

  if (
    location.includes('us') ||
    location.includes('united states') ||
    location.includes('usa')
  ) {
    score += 10;
    reasons.push('Location fit: United States');
  }

  if (lead.linkedin_url) {
    score += 8;
    reasons.push('Lead has LinkedIn profile');
  }
  if (lead.email) {
    score += 7;
    reasons.push('Lead has email contact');
  }

  if (reasons.length === 0) {
    reasons.push('No strong fit signals detected');
  }

  return { score: toScore(score), reasons };
}

function scoreIntent(lead) {
  const textBlob = normalizeText(`${lead.title} ${lead.company} ${lead.notes}`);
  let score = 0;
  const reasons = [];

  for (const trigger of INTENT_TRIGGERS) {
    if (textBlob.includes(trigger)) {
      score += 14;
      reasons.push(`Intent trigger detected: ${trigger}`);
    }
  }

  if (textBlob.includes('hiring') || textBlob.includes('opening')) {
    score += 10;
    reasons.push('Hiring/opening activity detected');
  }
  if (textBlob.includes('new software') || textBlob.includes('switching')) {
    score += 10;
    reasons.push('Potential tool-change activity detected');
  }

  if (reasons.length === 0) {
    reasons.push('No active buying-intent triggers detected');
  }

  return { score: toScore(score), reasons };
}

function scoreLead(lead, options = {}) {
  const fit = scoreFit(lead);
  const intent = scoreIntent(lead);
  const engagementScore = toScore(Number(options.engagementScore || 0));
  const engagementReasons = Array.isArray(options.engagementReasons) && options.engagementReasons.length > 0
    ? options.engagementReasons
    : ['No engagement history yet'];

  const fitScore = fit.score;
  const intentScore = intent.score;
  const totalScore = toScore(fitScore * 0.6 + intentScore * 0.25 + engagementScore * 0.15);

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
    engagementScore,
    totalScore,
    nextRecommendedAction,
    status,
    reasons: {
      fit: fit.reasons,
      intent: intent.reasons,
      engagement: engagementReasons,
      summary: [`Total score ${totalScore} (fit 60%, intent 25%, engagement 15%)`],
    },
  };
}

module.exports = {
  scoreLead,
};
