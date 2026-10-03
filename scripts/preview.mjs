import { startPcServer } from '../src/pc-server.mjs';

const { url } = await startPcServer({ port: 4173 });
console.log(`Tickets: ${url}`);
