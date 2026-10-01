import fs from 'node:fs';
const read=p=>fs.readFileSync(p,'utf8');
const server=read('src/server.mjs');
const client=read('src/ai-miner-client.mjs');
for(const name of ['brain2_resume_capsule','brain2_anti_reinvention','brain2_context_package']) if(!server.includes(name)) throw new Error(`Missing MCP tool ${name}`);
for(const method of ['resumeCapsule','antiReinvention','contextPackage']) if(!client.includes(`async ${method}`)) throw new Error(`Missing MCP client method ${method}`);
console.log('Global Context MCP contract PASS');
