import { execFileSync } from 'node:child_process';
const tracked=execFileSync('git',['ls-files'],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean);
const bad=tracked.filter(p=>/(^|\/)\.env($|\.)|(^|\/)node_modules\/|\.(sqlite|sqlite3|db|wal|shm)$/i.test(p));
if(bad.length){
  console.error('Release hygiene FAIL. Remove these tracked runtime/private artifacts before release:');
  for(const p of bad) console.error(` - ${p}`);
  process.exit(2);
}
console.log('MCP release hygiene PASS');
