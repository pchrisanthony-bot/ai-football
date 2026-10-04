// Headless test runner: `npm test`
const suites = process.argv.slice(2).length ? process.argv.slice(2) : ['physics', 'movement', 'control', 'gait', 'gestures', 'gamebreaker', 'format', 'rules', 'offside', 'referee', 'passing', 'scale', 'match', 'drill'];
let failed = 0;
for (const s of suites) {
  let mod;
  try { mod = await import(`./${s}.test.mjs`); }
  catch (e) { if (e.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(`${s}.test.mjs`)) continue; throw e; }
  const results = await (typeof mod.default === 'function' ? mod.default() : mod.default);
  console.log(`\n== ${s} ==`);
  for (const r of results) {
    console.log(`${r.ok ? '  PASS' : '  FAIL'}  ${r.name}${r.info ? '  — ' + r.info : ''}`);
    if (!r.ok) failed++;
  }
}
console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
