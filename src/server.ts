import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { connectDatabase } from './db/models.js';
import { createApp } from './app.js';
import { setupHomeManagement } from './setup-home.js';
import { importLegacyMedia, cleanupMedia } from './lib/media.js';

const config = readConfig();
await connectDatabase(config.MONGODB_URI);
await setupHomeManagement();
await importLegacyMedia(config.UPLOAD_DIR);
let cleaning = false;
async function sweepMedia() { if(cleaning)return;cleaning=true;try{await cleanupMedia(config.UPLOAD_DIR);}catch{console.error('Media cleanup failed; will retry.');}finally{cleaning=false;} }
void sweepMedia();
const mediaTimer=setInterval(()=>void sweepMedia(),60*60*1000);mediaTimer.unref();
const server = createApp(config).listen(config.PORT, '0.0.0.0', () => console.log(`Đại An API listening on port ${config.PORT}`));
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
async function shutdown() { clearInterval(mediaTimer); server.close(async () => { await mongoose.disconnect(); process.exit(0); }); setTimeout(() => process.exit(1), 10000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
