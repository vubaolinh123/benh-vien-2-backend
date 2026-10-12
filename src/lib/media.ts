import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readdir, lstat, unlink, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { Content, Homepage, Media, Post, Settings } from '../db/models.js';
import { HttpError, escapeRegex } from './http.js';

export const MEDIA_GRACE_MS = 24 * 60 * 60 * 1000;
export const MEDIA_ORPHAN_MS = 7 * MEDIA_GRACE_MS;
const filenamePattern = /^[a-f0-9-]+\.webp$/;
export function mediaFiles(value: unknown): string[] {
  return [...new Set([...JSON.stringify(value ?? '').matchAll(/\/api\/media\/([a-f0-9-]+\.webp)/g)].map(match=>match[1]))];
}
export interface MediaUsage {type:string;id:string;label:string}
export async function mediaUsage(filename?:string) {
  const usage = new Map<string,MediaUsage[]>();
  const add=(value:unknown,entry:MediaUsage)=>{for(const filename of mediaFiles(value)) usage.set(filename,[...(usage.get(filename)||[]),entry]);};
  const filter=filename?{$or:[{image:`/api/media/${filename}`},{body:{$regex:escapeRegex(`/api/media/${filename}`)}}]}:{};
  for await (const item of Post.find(filter).select('title image body').lean().cursor()) add(item,{type:'post',id:String(item._id),label:`Bài viết: ${item.title}`});
  for await (const item of Content.find(filter).select('kind name image body').lean().cursor()) add(item,{type:'content',id:String(item._id),label:`Nội dung: ${item.name} (${item.kind})`});
  for await (const item of Settings.find().lean().cursor()) add(item,{type:'settings',id:String(item._id),label:'Thông tin bệnh viện / giới thiệu / bảo mật'});
  for await (const item of Homepage.find().lean().cursor()) add(item.configuration,{type:'homepage',id:String(item._id),label:'Cấu hình trang chủ / logo / menu'});
  return usage;
}
// Atomic reservations prevent cleanup from unlinking an image while a CMS save uses it.
export async function withMedia<T>(value:unknown, save:()=>Promise<T>):Promise<T> {
  const files=mediaFiles(value), id=randomUUID();
  try {
    for(const filename of files) {
      const asset=await Media.findOneAndUpdate({filename,state:'ready'},{$push:{leases:{id,expiresAt:new Date(Date.now()+30*60*1000)}}});
      if(!asset) throw new HttpError(409,'Ảnh đã bị xóa hoặc đang được dọn. Vui lòng chọn lại từ thư viện ảnh.');
    }
    return await save();
  } finally { if(files.length) await Media.updateMany({filename:{$in:files}},{$pull:{leases:{id}}}); }
}
export async function scheduleMedia(value:unknown) {
  const files=mediaFiles(value);
  if(files.length) await Media.updateMany({filename:{$in:files},state:'ready'},{$set:{deleteAfter:new Date(Date.now()+MEDIA_GRACE_MS)}});
}
export async function importLegacyMedia(directory:string) {
  let entries;try {entries=await readdir(directory,{withFileTypes:true});}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  for(const entry of entries) {
    if(!entry.isFile()||!filenamePattern.test(entry.name)||await Media.exists({filename:entry.name}))continue;
    const file=path.join(directory,entry.name);const stat=await lstat(file);let metadata;try{metadata=await sharp(await readFile(file)).metadata();}catch{console.error('Skipped unreadable legacy media file');continue;}
    await Media.updateOne({filename:entry.name},{$setOnInsert:{originalName:entry.name,bytes:stat.size,width:metadata.width,height:metadata.height,deleteAfter:new Date(Date.now()+MEDIA_ORPHAN_MS)}},{upsert:true});
  }
}
export async function cleanupMedia(directory:string) {
  let deleted=0;
  const available=()=>({$or:[{state:'ready' as const},{state:'deleting' as const,claimUntil:{$lte:new Date()}}]});
  const candidates=Media.find({deleteAfter:{$lte:new Date()},...available()}).select('_id filename').limit(100).lean();
  for(const candidate of await candidates) {
    const asset=await Media.findOneAndUpdate({_id:candidate._id,...available(),deleteAfter:{$lte:new Date()},leases:{$not:{$elemMatch:{expiresAt:{$gt:new Date()}}}}},{$set:{state:'deleting',claimUntil:new Date(Date.now()+30*60*1000)}},{returnDocument:'after'});
    if(!asset)continue;
    let fileRemoved=false;
    try {
      const usage=await mediaUsage(asset.filename);
      if(usage.has(asset.filename)){await Media.updateOne({_id:asset._id},{$set:{state:'ready',deleteAfter:new Date(Date.now()+MEDIA_GRACE_MS)},$unset:{lastError:1,claimUntil:1},$pull:{leases:{expiresAt:{$lte:new Date()}}}});continue;}
      if(!filenamePattern.test(asset.filename))throw new Error('Invalid media filename');
      const target=path.resolve(directory,asset.filename);
      if(path.dirname(target)!==path.resolve(directory))throw new Error('Media path escaped upload directory');
      try {await unlink(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      fileRemoved=true;
      await Media.deleteOne({_id:asset._id,state:'deleting'});deleted++;
    }catch {await Media.updateOne({_id:asset._id},{$set:{state:fileRemoved?'deleting':'ready',lastError:'Chưa hoàn tất dọn ảnh; hệ thống sẽ thử lại.'}});}
  }
  return {deleted};
}
