// An isolated local MongoDB for verification; never connects to production data.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';

const mongo = await MongoMemoryServer.create();
const env = { ...process.env, MONGODB_URI: mongo.getUri(), JWT_SECRET: randomBytes(48).toString('hex'), SITE_ORIGIN: process.env.TEST_SITE_ORIGIN || 'http://127.0.0.1:3100', NODE_ENV: 'development', PORT: process.env.TEST_API_PORT || '4000', TRUST_PROXY: '0', UPLOAD_DIR: path.resolve('preview/uploads'), ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: 'Local-test-password-2026!', ADMIN_NAME: 'Quản trị kiểm thử' };
await mkdir('preview', { recursive: true });
await writeFile('preview/test-env.json', JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }));
function run(args) { return new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { env, stdio: 'inherit' }); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Fixture process failed: ${code}`))); }); }
await run(['--import', 'tsx', 'src/seed.ts']);
await run(['--import', 'tsx', 'scripts/seed-test-content.ts']);
const api = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { env, stdio: 'inherit' });
console.log('Isolated verification API is ready at port ' + env.PORT);
async function stop() { api.kill(); await mongo.stop(); process.exit(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
