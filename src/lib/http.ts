import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import sanitizeHtml from 'sanitize-html';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return parsed.data;
}
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID không hợp lệ');
export const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const imageUrl = z.string().max(250).regex(/^\/(?:api\/media\/[a-f0-9-]+\.webp|assets\/[a-zA-Z0-9._/-]+)$/).optional().or(z.literal(''));
export const pagination = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) });
export function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const cssColor = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
export function cleanHtml(body: string) {
  return sanitizeHtml(body, {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'span', 'mark', 'hr', 'pre', 'code', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { p:['style'],h2:['style'],h3:['style'],h4:['style'],span:['style'],mark:['style'],th:['colspan','rowspan'],td:['colspan','rowspan'], a: ['href', 'title', 'rel', {name:'target',values:['_blank','_self']}], img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', {name:'data-align',values:['left','center','right']},{name:'data-size',values:['25','50','75','100']}] },
    // Inline text styles only come from the editor's fixed font, size and colour controls.
    allowedStyles: {'*': {'text-align': [/^(left|center|right|justify)$/]}, span: {color:[cssColor],'font-family':[/^[a-zA-Z0-9 ,'"-]{1,80}$/],'font-size':[/^(1[0-9]|2[0-9]|3[0-6])px$/]}, mark: {'background-color':[cssColor],color:[/^inherit$/]}},
    allowedSchemes: ['https', 'http', 'tel', 'mailto'],
    transformTags: {
      a: (tagName,attribs)=>{if(/^(blob|data):/i.test((attribs.href||'').trim()))throw new HttpError(400,'Liên kết phải là URL hợp lệ, không dùng Blob/base64.');return {tagName,attribs:{...attribs,rel:'noopener noreferrer'}};},
      img: (tagName,attribs)=>{if(/^(blob|data):/i.test((attribs.src||'').trim()))throw new HttpError(400,'Ảnh phải được upload lên máy chủ trước khi lưu bài.');return {tagName,attribs:{...attribs,loading:'lazy',decoding:'async'}};},
    },
    exclusiveFilter: frame => frame.tag === 'img' && !/^\/(api\/media\/[a-f0-9-]+\.webp|assets\/[a-zA-Z0-9._/-]+)$/.test(frame.attribs.src ?? ''),
  });
}
export function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
// Express identifies error handlers by all four parameters.
export function errors(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  void _next;
  if (error instanceof HttpError) { response.status(error.status).json({ message: error.message }); return; }
  const problem = error as { code?: number; name?: string; status?: number };
  if (problem.code === 11000) { response.status(409).json({ message: 'Dữ liệu đã tồn tại. Vui lòng kiểm tra lại.' }); return; }
  if (problem.name === 'MulterError' || problem.status === 413) { response.status(413).json({ message: 'Ảnh hoặc nội dung vượt dung lượng cho phép.' }); return; }
  if (problem.status === 400) { response.status(400).json({ message: 'Nội dung gửi lên không hợp lệ.' }); return; }
  if (problem.status === 404) { response.status(404).json({ message: 'Không tìm thấy tài nguyên.' }); return; }
  console.error('API error:', error instanceof Error ? error.name : 'UnknownError');
  response.status(500).json({ message: 'Hệ thống chưa xử lý được yêu cầu. Vui lòng thử lại sau.' });
}
