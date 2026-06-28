const d = require('../services/outbound/deliverabilityService');

describe('deliverabilityService pure helpers', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const start = new Date('2026-06-01T00:00:00Z');

  test('domainOf extracts domain', () => {
    expect(d.domainOf('Foo@Bar.com')).toBe('bar.com');
    expect(d.domainOf('nope')).toBe('');
  });

  test('clampCap floors, rejects negatives, ceilings at safe max', () => {
    expect(d.clampCap(-5)).toBe(0);
    expect(d.clampCap(12.9)).toBe(12);
    expect(d.clampCap(999)).toBe(d.MAX_SAFE_DAILY_CAP);
  });

  test('warmupDaysElapsed counts whole days from start', () => {
    expect(d.warmupDaysElapsed(start, start)).toBe(0);
    expect(d.warmupDaysElapsed(start, new Date(start.getTime() + 3 * DAY))).toBe(3);
    // future start => 0
    expect(d.warmupDaysElapsed(new Date(start.getTime() + DAY), start)).toBe(0);
  });

  test('warmupCap ramps from initial by increment up to target', () => {
    const cfg = { warmupEnabled: true, warmupStartedAt: start, warmupInitialCap: 5, warmupIncrement: 5, dailyCapTarget: 40 };
    expect(d.warmupCap({ ...cfg, now: start })).toBe(5); // day 0
    expect(d.warmupCap({ ...cfg, now: new Date(start.getTime() + 2 * DAY) })).toBe(15); // day 2: 5+10
    expect(d.warmupCap({ ...cfg, now: new Date(start.getTime() + 30 * DAY) })).toBe(40); // capped at target
  });

  test('warmupCap disabled goes straight to target', () => {
    expect(d.warmupCap({ warmupEnabled: false, dailyCapTarget: 35 })).toBe(35);
  });

  test('engagementThrottleFactor: pauses on high bounce/complaint, halves on moderate', () => {
    expect(d.engagementThrottleFactor({ sent: 10, bounced: 10 })).toBe(1); // too little signal
    expect(d.engagementThrottleFactor({ sent: 100, bounced: 1 })).toBe(1); // clean
    expect(d.engagementThrottleFactor({ sent: 100, bounced: 6 })).toBe(0.5); // 6% bounce
    expect(d.engagementThrottleFactor({ sent: 100, bounced: 12 })).toBe(0); // 12% bounce => pause
    expect(d.engagementThrottleFactor({ sent: 1000, complained: 6 })).toBe(0); // 0.6% complaint => pause
  });

  test('healthScore drops with bounce/complaint rate', () => {
    expect(d.healthScore({ sent: 10, bounced: 5 })).toBe(100); // too little signal
    expect(d.healthScore({ sent: 100, bounced: 0, complained: 0 })).toBe(100);
    expect(d.healthScore({ sent: 100, bounced: 10 })).toBe(40); // full bounce penalty
    expect(d.healthScore({ sent: 100, bounced: 10, complained: 1 })).toBe(0);
  });

  test('effectiveDailyCap combines warmup and throttle, zero when paused', () => {
    const mailbox = {
      status: 'warming', warmup_enabled: true, warmup_started_at: start,
      warmup_initial_cap: 5, warmup_increment: 5, daily_cap_target: 40,
    };
    const now = new Date(start.getTime() + 4 * DAY); // warmup cap = 25
    expect(d.effectiveDailyCap(mailbox, { sent: 5 }, now)).toBe(25);
    expect(d.effectiveDailyCap(mailbox, { sent: 100, bounced: 6 }, now)).toBe(13); // 25 * 0.5 => 12.5 => 13
    expect(d.effectiveDailyCap({ ...mailbox, status: 'paused' }, {}, now)).toBe(0);
  });

  test('selectMailbox picks highest remaining*weight, null when no capacity', () => {
    expect(d.selectMailbox([])).toBeNull();
    expect(d.selectMailbox([{ id: 'a', remaining: 0, weight: 5 }])).toBeNull();
    const pick = d.selectMailbox([
      { id: 'a', remaining: 10, weight: 1 },
      { id: 'b', remaining: 5, weight: 3 }, // 15 > 10
      { id: 'c', remaining: 0, weight: 9 },
    ]);
    expect(pick.id).toBe('b');
  });

  test('parseSpf / parseDmarc / parseDkim classify TXT records', () => {
    expect(d.parseSpf([['v=spf1 include:_spf.google.com ~all']])).toBe('pass');
    expect(d.parseSpf([['something else']])).toBe('missing');

    expect(d.parseDmarc([['v=DMARC1; p=reject; rua=mailto:x@y.com']])).toBe('pass');
    expect(d.parseDmarc([['v=DMARC1;']])).toBe('fail'); // no policy tag
    expect(d.parseDmarc([])).toBe('missing');

    expect(d.parseDkim([['v=DKIM1; k=rsa; p=MIGfMA0G']])).toBe('pass');
    expect(d.parseDkim([['v=DKIM1; p=']])).toBe('fail'); // revoked
    expect(d.parseDkim([])).toBe('missing');
  });
});
