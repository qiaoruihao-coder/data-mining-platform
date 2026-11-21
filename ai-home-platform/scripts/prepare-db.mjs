import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith('file:')) throw new Error('请先复制 .env.example 为 .env，配置 SQLite DATABASE_URL。');
const filePath = path.resolve('prisma', databaseUrl.slice(5));
fs.mkdirSync(path.dirname(filePath), { recursive: true });
// 只创建不存在的空文件，不截断已有数据库；避免部分 Windows 环境首次 db push 失败。
try { fs.closeSync(fs.openSync(filePath, 'wx')); } catch (error) { if (error.code !== 'EEXIST') throw error; }
