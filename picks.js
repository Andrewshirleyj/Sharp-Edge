// netlify/functions/picks.js
// SharpEdge — server-side pick generation
// Runs entirely on Netlify: Perplexity search + Claude generation
// No API keys in browser, no CORS issues, no model compatibility problems

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const PERPLEXITY_KEY = process.env.PERPLEXITY_API_KEY;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

// ── Perplexity search ──
async function pplxSearch(query) {
  if (!PERPLEXITY_KEY) return '';
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + PERPLEXITY_KEY },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }],
        max_tokens: 1200,
        search_recency_filter: 'day',
        return_citations: false
      })
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } catch(e) {
    console.log('[Picks] Perplexity failed:', e.message);
    return '';
  }
}

// ── Claude generation ──
async function generatePicks(context, today, dateStr, oddsContext) {
  const prompt = `Today is ${today} (${dateStr}). Generate NBA playoff picks for tonight's games only.

LIVE DATA:
${context || 'No live data available — use your knowledge of current NBA playoffs.'}
${oddsContext ? '\nVEGAS LINES:\n' + oddsContext : ''}

Return ONLY this JSON (no text before or after, start with {):
{"date":"${today}","games":[{"matchup":"AWAY vs HOME","game":"AWAY @ HOME","tipoff":"7:30 PM ET","series":"Game N — TEAM leads X-Y","picks":[{"rank":1,"betType":"Spread","bet":"TEAM -X","odds":"-110","confidence":80,"why":"specific reason with data","edge":"edge","lineMove":"","publicPct":"","stats":[{"l":"SPREAD","v":"val","c":"g"},{"l":"TOTAL","v":"val","c":"y"},{"l":"INJ","v":"val","c":"r"},{"l":"SHARP","v":"val","c":"g"}]},{"rank":2,"betType":"Over/Under","bet":"OVER X","odds":"-110","confidence":75,"why":"reason","edge":"edge","lineMove":"","publicPct":"","stats":[{"l":"TOTAL","v":"val","c":"y"},{"l":"PACE","v":"val","c":"g"}]},{"rank":3,"betType":"Moneyline","bet":"TEAM ML","odds":"-180","confidence":72,"why":"reason","edge":"edge","lineMove":"","publicPct":"","stats":[{"l":"ML","v":"val","c":"g"}]},{"rank":4,"betType":"Alt Spread","bet":"TEAM -1.5","odds":"+120","confidence":68,"why":"plus money value","edge":"edge","lineMove":"","publicPct":"","stats":[{"l":"ALT","v":"val","c":"g"}]}]}],"nba_props":[{"rank":1,"player":"FULL NAME","team":"TEAM","game":"GAME","bet":"OVER 24.5 Points","odds":"-115","confidence":78,"why":"playoff avg + matchup","edge":"edge","lineMove":"","stats":[{"l":"PO AVG","v":"26.1","c":"g"},{"l":"STATUS","v":"Active","c":"g"}],"dk6":"DraftKings Pick6"},{"rank":2,"player":"FULL NAME","team":"TEAM","game":"GAME","bet":"OVER 9.5 Rebounds","odds":"-112","confidence":75,"why":"reason","edge":"edge","lineMove":"","stats":[{"l":"REB","v":"10.2","c":"g"},{"l":"STATUS","v":"Active","c":"g"}],"dk6":"DraftKings Pick6"},{"rank":3,"player":"FULL NAME","team":"TEAM","game":"GAME","bet":"OVER 7.5 Assists","odds":"+105","confidence":72,"why":"reason","edge":"plus money","lineMove":"","stats":[{"l":"AST","v":"8.1","c":"g"},{"l":"STATUS","v":"Active","c":"g"}],"dk6":"DraftKings Pick6"},{"rank":4,"player":"FULL NAME","team":"TEAM","game":"GAME","bet":"OVER 22.5 Points","odds":"-108","confidence":70,"why":"reason","edge":"edge","lineMove":"","stats":[{"l":"PO AVG","v":"23.8","c":"g"},{"l":"STATUS","v":"Active","c":"g"}],"dk6":"DraftKings Pick6"},{"rank":5,"player":"FULL NAME","team":"TEAM","game":"GAME","bet":"OVER 3.5 Threes","odds":"+110","confidence":68,"why":"high volume shooter","edge":"plus money","lineMove":"","stats":[{"l":"3PM","v":"4.1","c":"g"},{"l":"STATUS","v":"Active","c":"g"}],"dk6":"DraftKings Pick6"}],"parlays":[{"id":1,"label":"Value Parlay","legs":[{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"},{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"},{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"}],"combined_odds":"+350","confidence":65,"why":"Three strong independent picks at plus money","payout_on_100":"$450"},{"id":2,"label":"Safer Parlay","legs":[{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"},{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"},{"game":"GAME","bet":"BET","odds":"ODDS","why":"reason"}],"combined_odds":"+190","confidence":70,"why":"Higher probability combo","payout_on_100":"$290"}],"injuries":[{"player":"NAME","team":"TEAM","s":"out","detail":"injury — timeline","imp":"high"}],"ticker":[{"sport":"NBA","match":"TM@TM","line":"TM -4.5","fav":true}],"x_signals":[{"handle":"@CoversExperts","name":"Covers","pick":"Best bet","conf":"74%","followers":"489k"}],"sharp_summary":"Where sharp money is going tonight.","daily_edge":"Best single bet of the night."}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 3500,
      system: 'You output ONLY raw JSON. No text before or after the JSON object. Start your response with { and end with }. Never explain, never add preamble.',
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const status = res.status;
    if (status === 401) throw new Error('Invalid Anthropic API key — check Netlify environment variables');
    if (status === 429) throw new Error('Rate limited — wait 30 seconds');
    throw new Error('Claude API error ' + status + ': ' + (err?.error?.message || ''));
  }

  const data = await res.json();
  return (data.content || []).filter(c => c.type === 'text').map(c => c.text || '').join('\n');
}

// ── JSON extractor — string-aware brace matching ──
function extractJSON(text) {
  const s = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  for (let start = 0; start < s.length; start++) {
    if (s[start] !== '{') continue;
    let depth = 0, inStr = false, escape = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0 && c === '}') {
          const candidate = s.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            if (parsed && (parsed.date || parsed.games || parsed.nba_props)) return parsed;
          } catch(e) {
            // Try fixing trailing commas
            try {
              const fixed = candidate.replace(/,\s*([}\]])/g, '$1');
              const parsed = JSON.parse(fixed);
              if (parsed && (parsed.date || parsed.games)) return parsed;
            } catch(e2) {}
          }
        }
      }
    }
  }
  return null;
}

// ── Main handler ──
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'POST only' }) };

  if (!ANTHROPIC_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set in Netlify environment variables. Go to Netlify → Site settings → Environment variables.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}

  const { today, dateStr, oddsContext, perplexityKey } = body;

  if (!today) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing today date' }) };

  try {
    // Step 1: Perplexity searches (in parallel)
    // Use key from request body if server key not set
    const pKey = PERPLEXITY_KEY || perplexityKey || '';
    let context = '';

    if (pKey) {
      const [r1, r2] = await Promise.allSettled([
        pplxSearch('NBA games tonight ' + today + ' ' + dateStr + ': tipoff times spreads totals moneylines injuries series standings playoff'),
        pplxSearch('NBA playoff best bets tonight ' + today + ' expert picks sharp money props')
      ]);
      if (r1.status === 'fulfilled' && r1.value) context += 'LIVE NBA DATA:\n' + r1.value.substring(0, 1500) + '\n\n';
      if (r2.status === 'fulfilled' && r2.value) context += 'EXPERT PICKS:\n' + r2.value.substring(0, 800) + '\n\n';
    }

    // Step 2: Generate picks with Claude
    const rawText = await generatePicks(context, today, dateStr || today, oddsContext || '');

    // Step 3: Parse JSON
    const picks = extractJSON(rawText);
    if (!picks) {
      console.error('[Picks] Parse failed. Raw:', rawText.substring(0, 400));
      return {
        statusCode: 422, headers: CORS,
        body: JSON.stringify({ error: 'JSON parse failed', raw: rawText.substring(0, 200) })
      };
    }

    picks.date = today;
    picks._source = pKey ? 'perplexity+claude' : 'claude';
    picks._generatedAt = new Date().toISOString();

    return { statusCode: 200, headers: CORS, body: JSON.stringify(picks) };

  } catch(err) {
    console.error('[Picks] Error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
