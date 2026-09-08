import { AiMinerClient } from './ai-miner-client.mjs';
const report = await new AiMinerClient().probe();
console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
