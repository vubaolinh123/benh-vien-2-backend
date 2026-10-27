import mongoose, { Schema } from 'mongoose';

const options = { timestamps: true, versionKey: false } as const;
const userSchema = new Schema({
  name: { type: String, required: true }, email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['administrator', 'communications', 'customer_service'], required: true },
  active: { type: Boolean, default: true }, tokenVersion: { type: Number, default: 0 },
  loginFailures: { type: Number, default: 0 }, lockedUntil: Date,
}, options);
export const User = mongoose.model('User', userSchema);

const sessionSchema = new Schema({ jti: { type: String, unique: true, required: true }, userId: { type: Schema.Types.ObjectId, required: true, index: true }, expiresAt: { type: Date, required: true } }, options);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = mongoose.model('Session', sessionSchema);

const postSchema = new Schema({
  slug: { type: String, unique: true, required: true }, title: { type: String, required: true },
  category: { type: String, enum: ['news', 'health', 'qa'], required: true },
  excerpt: { type: String, required: true }, body: { type: String, required: true }, image: String,
  topic: { type: String, default: '' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
  authorId: { type: Schema.Types.ObjectId, ref: 'User' }, publishedAt: Date,
}, options);
postSchema.index({ status: 1, category: 1, publishedAt: -1 });
postSchema.index({ status: 1, topic: 1, publishedAt: -1 });
export const Post = mongoose.model('Post', postSchema);

const contentSchema = new Schema({
  kind: { type: String, enum: ['service', 'specialty', 'doctor', 'page', 'banner', 'gallery', 'video', 'promotion', 'care_activity', 'support_link', 'editorial_link'], required: true },
  slug: { type: String, required: true }, name: { type: String, required: true }, summary: String,
  body: String, image: String, qualification: String, specialty: String, schedule: String,
  link: String, active: { type: Boolean, default: false }, order: { type: Number, default: 0 },
  placement: String, action: { type: String, enum: ['link','booking','feedback','gallery'], default: 'link' }, icon: String, buttonLabel: String, eyebrow: String, targetSlug: String,
}, options);
contentSchema.index({ kind: 1, slug: 1 }, { unique: true });
contentSchema.index({ kind: 1, active: 1, order: 1 });
export const Content = mongoose.model('Content', contentSchema);

const appointmentSchema = new Schema({
  reference: { type: String, unique: true, required: true }, requestId: { type: String, unique: true, required: true },
  name: { type: String, required: true }, phone: { type: String, required: true },
  service: { type: String, required: true }, date: { type: String, required: true }, session: { type: String, enum: ['morning', 'afternoon'], required: true },
  message: String, status: { type: String, enum: ['new', 'contacted', 'confirmed', 'cancelled'], default: 'new' },
  notes: { type: String, default: '' }, consentAt: { type: Date, required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, options);
appointmentSchema.index({ status: 1, date: -1 });
appointmentSchema.index({ date: -1, service: 1 });
appointmentSchema.index({ phone: 1 });
export const Appointment = mongoose.model('Appointment', appointmentSchema);

export const Feedback = mongoose.model('Feedback', new Schema({ name: String, phone: String, message: { type: String, required: true }, status: { type: String, enum: ['new', 'resolved'], default: 'new' }, notes: String }, options));
export const Settings = mongoose.model('Settings', new Schema({ key: { type: String, unique: true, default: 'site' }, name: String, phone: String, email: String, address: String, introduction: String, workingHours: String, privacy: String, facebook: String, tiktok: String }, options));
export const Homepage = mongoose.model('Homepage', new Schema({ key: { type: String, unique: true, default: 'home' }, configuration: { type: Schema.Types.Mixed, required: true } }, options));
export const Media = mongoose.model('Media', new Schema({
  filename: {type:String,required:true,unique:true}, originalName:String, bytes:Number, width:Number, height:Number,
  uploadedBy: {type:Schema.Types.ObjectId,ref:'User'},
  state:{type:String,enum:['ready','deleting'],default:'ready'},
  deleteAfter:{type:Date,index:true}, lastError:String,
  claimUntil:Date,
  leases:[{_id:false,id:String,expiresAt:Date}],
},options));

const visitSchema = new Schema({ day: { type: String, required: true }, path: { type: String, required: true }, count: { type: Number, default: 0 }, expiresAt: Date }, options);
visitSchema.index({ day: 1, path: 1 }, { unique: true });
visitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Visit = mongoose.model('Visit', visitSchema);
const dedupSchema = new Schema({ key: { type: String, unique: true, required: true }, expiresAt: { type: Date, required: true } });
dedupSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const VisitDedup = mongoose.model('VisitDedup', dedupSchema);
export const Audit = mongoose.model('Audit', new Schema({ userId: { type: Schema.Types.ObjectId, ref: 'User' }, action: String, resourceId: String, expiresAt: { type: Date, default: () => new Date(Date.now() + 180 * 86400000) } }, options));
Audit.schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export async function connectDatabase(uri: string) {
  await mongoose.connect(uri, { maxPoolSize: 10, minPoolSize: 1, serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
}
