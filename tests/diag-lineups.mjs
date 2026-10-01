// Every club's line-up in every formation (role:name), to eyeball the role fit.
import { TEAMS, buildLineup } from '../src/sim/squads.js';
import { FORMATIONS } from '../src/sim/formations.js';
for (const T of Object.values(TEAMS)) {
  for (const fid of Object.keys(FORMATIONS)) {
    const lu = buildLineup(T, fid);
    console.log(T.id.padEnd(8), fid.padEnd(8), lu.map(e => `${e.role}:${e.name}`).join(' '));
  }
}
