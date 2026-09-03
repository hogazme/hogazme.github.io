/* Houston exposure dashboard — the Methods & data panel.
   Pure: takes meta.json and returns HTML. The numbers here are read from meta
   where meta carries them; the ones it does not (family definitions, regime
   POI counts) are transcribed from HOUSTON_EMBEDDING_REPORT.md. */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.HX = root.HX || {};
  root.HX.methods = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CATEGORIES = [
    ['Grocery', 'NAICS 445'],
    ['Health & personal care', '446'],
    ['Gasoline', '447'],
    ['General merchandise', '452'],
    ['Other retail', '441–444, 448, 451, 453–454, 811–812'],
    ['Healthcare', '62'],
    ['Education', '61'],
    ['Restaurants', '7224–7225'],
    ['Parks', '712190'],
    ['Recreation', '71 excluding parks'],
    ['Religious & civic', '813']
  ];

  var FAMILIES = [
    ['Visit share', 'share of the month’s in-scope visits that go to this category'],
    ['Trip distance', 'visit-weighted mean distance from home to the places visited'],
    ['Trip spread', 'visit-weighted standard deviation of those distances'],
    ['Income exposure gap', 'expected median household income of the other visitors at the places visited, minus the community’s own'],
    ['Education exposure gap', 'the same, for bachelor’s-degree share'],
    ['Racial exposure dissimilarity', 'half the absolute difference between the racial mix of the crowds visited and the community’s own'],
    ['Dwell', 'visit-weighted median dwell time at the places visited'],
    ['Activity radius', 'radius of gyration of the places visited: how spread out the month’s destinations are, independent of distance from home']
  ];

  var PCS = [
    { key: 'PC1', name: 'Socioeconomic exposure gap', colour: '#60a5fa',
      reading: 'High values mean the community’s residents visit places whose typical visitor is richer and better educated than the community itself. Income and education gaps carry 71% of the loading, nearly equally across all eleven categories.' },
    { key: 'PC2', name: 'Trip reach', colour: '#a34842',
      reading: 'High values mean long, widely spread trips. Distance mean and spread carry 76% of the loading.' },
    { key: 'PC3', name: 'Racial exposure dissimilarity', colour: '#e8833a',
      reading: 'High values mean the crowds this community mixes with look racially unlike the community. That one family carries 83% of the loading.' }
  ];

  var REGIME_ROWS = [
    ['A', '2019-01 – 2022-11', '98,656, unchanged for 47 months', '14–47 M', 'baseline'],
    ['B', '2022-12', '32,774', '7.4 M', 'partial month, treat as missing'],
    ['C', '2023', '100,223 → 127,538 → 115,804', '19–46 M', 'roster grows; out-of-scope share steps from ~0.25 to ~0.36'],
    ['D', '2024', '115,804', '20–97 M', '3–4× the visits of 2023 on the same roster']
  ];

  function pct(x, d) { return (x * 100).toFixed(d === undefined ? 1 : d) + '%'; }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function prettyFeature(f) {
    return f.replace(/_/g, ' ')
      .replace('income exposure gap', 'income gap')
      .replace('education exposure gap', 'education gap')
      .replace('race exposure dissim', 'racial dissim.')
      .replace('dist mean', 'distance')
      .replace('dist disp', 'spread')
      .replace('health personal', 'health & personal')
      .replace('general merch', 'general merch.');
  }

  function render(meta) {
    var s = meta.stats;
    var h = [];

    h.push('<h2>Methods &amp; data</h2>');
    h.push('<p class="lede">What the colours are made of, what they are not, and where the data ' +
      'misbehaves. Everything on the map is a measurement; nothing here is a model of cause.</p>');

    h.push('<h3>The panel</h3>');
    h.push('<p>Advan monthly foot-traffic patterns for the Houston metro, aggregated to the ' +
      'visitors’ home census block groups. <b>' + meta.n_cbgs.toLocaleString() + '</b> block ' +
      'groups with a complete record in every one of <b>' + meta.n_months + '</b> months ' +
      '(2019-01 to 2024-12), so ' + (meta.n_cbgs * meta.n_months).toLocaleString() +
      ' block-group-months. Places are kept if they fall in one of eleven everyday ' +
      'categories; everything else (lodging, wholesale, offices, transport) is out of scope.</p>');

    h.push('<table><tr><th>Category</th><th>NAICS</th></tr>');
    CATEGORIES.forEach(function (c) {
      h.push('<tr><td>' + c[0] + '</td><td>' + c[1] + '</td></tr>');
    });
    h.push('</table>');

    h.push('<p>For each block-group-month, seven measures are computed within each category, ' +
      'giving 8 × 11 = 88 features; the first seven families (77 features) feed the projection. Exposure measures compare the block group’s own ' +
      'ACS profile to the visit-weighted profile of everyone else who visits the same places.</p>');
    h.push('<ul>');
    FAMILIES.forEach(function (f) {
      h.push('<li><b>' + f[0] + '</b> — ' + f[1] + '</li>');
    });
    h.push('</ul>');

    h.push('<h3>The projection</h3>');
    h.push('<p>Visit shares are centred-log-ratio transformed; every column is standardised; ' +
      'a single PCA is fit on all ' + (meta.n_cbgs * meta.n_months).toLocaleString() +
      ' rows and frozen. The first three components explain <b>' + pct(s.evr_cum3) +
      '</b> of the variance; ' + s.n_components_for_90pct + ' are needed for 90%. Three ' +
      'colour channels are a real compression of a 77-dimensional space, not a summary of it.</p>');

    PCS.forEach(function (pc, i) {
      var evr = s.evr[i];
      h.push('<div class="pc"><div class="bar" style="background:' + pc.colour + '"></div><div>');
      h.push('<b>' + pc.key + ' · ' + pc.name + '</b> <span style="color:#64748b">' + pct(evr) + ' of variance</span>');
      h.push('<p style="margin:4px 0 0">' + pc.reading + '</p>');
      h.push('<div class="loadings">');
      (meta.loadings[pc.key] || []).slice(0, 8).forEach(function (l) {
        h.push('<span>' + esc(prettyFeature(l.feature)) + ' ' + l.loading.toFixed(2) + '</span>');
      });
      h.push('</div></div></div>');
    });

    h.push('<p>The map’s “how far they go” view does not use PC2. It shows the activity radius ' +
      'directly: the radius of gyration of each block group’s visited places, weighted by visit ' +
      'share across the eleven categories, converted to a pooled percentile rank exactly like the ' +
      'components. Houston’s median is ' + s.reach_km.median_km + ' km; the 10th and 90th ' +
      'percentiles are ' + s.reach_km.p10_km + ' and ' + s.reach_km.p90_km + ' km.</p>');
    h.push('<p>Each component is close to a uniform average of one measure family across all ' +
      'eleven categories: the dominant structure in Houston’s movement is <em>which kind</em> ' +
      'of difference a community travels into, not <em>where</em> it goes. What kinds of places ' +
      'a community visits (the visit-share block) barely appears until the fifth component, ' +
      'so it is not on this map.</p>');

    h.push('<h3>From components to colour</h3>');
    h.push('<p>Each component is converted to a percentile rank pooled over all block-group-months, ' +
      'stored as a byte (0–255). The map view splits the exposure gap (PC1) and racial ' +
      'dissimilarity (PC3) into terciles at 85 and 170 and paints the 3 × 3 cell. Darkness ' +
      'is how unlike the encountered crowds are overall; hue is which kind of unlikeness. The ' +
      'reach view paints the activity radius alone on a seven-step diverging scale.</p>');
    h.push('<p><b>Relative</b> (the default) subtracts each month’s Houston-wide mean before ' +
      'cutting, so a block group’s colour says how it compares to the rest of Houston in ' +
      'that month. <b>Absolute</b> cuts the pooled ranks directly, so colours are comparable ' +
      'across months in principle, but see below for why that is not safe here.</p>');

    h.push('<h3>Where the data misbehaves</h3>');
    h.push('<div class="caveat"><p>The provider’s coverage changes underneath the panel three ' +
      'times. The set of places reporting visits is byte-identical for 47 months, then breaks ' +
      'for one month, then grows. These steps move the whole map’s mean colour by up to ' +
      '84 of 255 levels, and sixteen of the twenty-four months in 2023–2024 sit further from ' +
      'baseline than April 2020 did. They are supply, not behaviour.</p></div>');
    h.push('<table><tr><th>Regime</th><th>Months</th><th>Places reporting</th><th>Visits / month</th><th>Note</th></tr>');
    REGIME_ROWS.forEach(function (r) {
      h.push('<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td><td>' + r[4] + '</td></tr>');
    });
    h.push('</table>');
    h.push('<p>Between-month variance is only 1.4% (PC1), 6.0% (PC2) and 2.8% (PC3) of the total, ' +
      'and the cross-sectional ranking of block groups correlates at 0.94 or better across ' +
      'even the worst boundary, so the regime shift is a level shift, not a reshuffle. ' +
      'Subtracting the monthly mean removes it, which is why relative is the default and the ' +
      'strip under the month slider shows the Houston-wide mean in full.</p>');

    h.push('<h3>Other caveats</h3>');
    h.push('<ul>');
    h.push('<li><b>' + s.n_imputed_cbgs + ' block groups</b> report a median household income of 0 ' +
      'in the ACS. Their income-gap features are filled with the Houston median, so their ' +
      'exposure-gap colour is partly an artefact. They carry a dashed amber outline in every view.</li>');
    h.push('<li><b>Spatial clustering is strong in every month.</b> Moran’s I of the exposure ' +
      'gap averages ' + s.morans_I_mean.toFixed(2) + ' over the 72 months (z ≈ 65–78 under ' +
      'permutation), lowest in April 2020. ' + s.n_islands + ' block groups have no neighbour ' +
      'within 3 km and are excluded from that statistic; they are still coloured.</li>');
    h.push('<li><b>The ACS profile is fixed</b> (2019-vintage geography and demographics), so ' +
      'every month’s exposure gap is measured against the same home population. Change over ' +
      'time is change in where people go, not in who lives there.</li>');
    h.push('<li><b>This is a measurement layer.</b> No detection, no event attribution, no ' +
      'residuals. The paper this accompanies does that work.</li>');
    h.push('</ul>');

    h.push('<h3>Files</h3>');
    h.push('<ul>');
    h.push('<li><a href="data/meta.json">meta.json</a> — months, block-group ids, monthly means, loadings, summary statistics</li>');
    h.push('<li><a href="data/components.bin">components.bin</a> — five planes of 208,152 bytes, month-major: PC1, PC2, PC3 and the activity radius as pooled percentile ranks, then the radius in half-kilometres</li>');
    h.push('<li><a href="data/houston_cbgs.topo.json">houston_cbgs.topo.json</a> — block-group geometry with baked ACS properties</li>');
    h.push('<li><a href="https://mobix.blogs.rice.edu/" target="_blank" rel="noopener">Mobility-X Lab</a>, Rice University</li>');
    h.push('</ul>');

    return h.join('\n');
  }

  return { render: render, CATEGORIES: CATEGORIES, FAMILIES: FAMILIES };
});
