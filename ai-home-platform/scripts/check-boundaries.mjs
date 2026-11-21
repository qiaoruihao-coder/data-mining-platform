import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ownerOf } from "./ownership.mjs";
const shared=/^src\/(contracts\/|components\/ui\/|lib\/(api-client|api-response|mock-data|prisma|llm)\.ts$)/;
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.tsx?$/.test(p))files.push(p.replaceAll("\\","/"));}}
walk("src");
const failures=[];
export function canReadAcrossOwner(file, target, clientReachable = false) {
 const sessionInfrastructure = target === "src/lib/demo-provider-session.ts" || target === "src/lib/demo-session-handlers.ts" || target === "src/lib/owner-auth.ts";
 if (sessionInfrastructure) return !clientReachable && ownerOf(file) === "D" && (file.startsWith("src/lib/") || file.startsWith("src/app/api/"));
 const quoteInfrastructure = target === "src/lib/idempotency.ts" || target === "src/lib/quote-policy.ts" || target === "src/lib/server-auth.ts";
 if (quoteInfrastructure) {
  const quoteServer = file === "src/lib/quote-engine.ts" || file.startsWith("src/lib/quote-engine/") || file.startsWith("src/app/api/quote/");
  const dServer = ownerOf(file) === "D" && (file.startsWith("src/lib/") || file.startsWith("src/app/api/"));
  return !clientReachable && (quoteServer || dServer);
 }
 const matchCanReadDemand = (file.startsWith("src/lib/match/") || file.startsWith("src/app/api/match/")) && target === "src/lib/demand.ts";
 const matchCanReadProviderDirectory = (file.startsWith("src/lib/match/") || file.startsWith("src/app/api/match/")) && target === "src/lib/provider-directory.ts";
 if (target === "src/lib/matching-demand.ts") {
  const matchServer = file.startsWith("src/lib/match/") || file.startsWith("src/app/api/match/");
  const dServer = ownerOf(file) === "D" && (file.startsWith("src/lib/") || file.startsWith("src/app/api/"));
  return !clientReachable && (matchServer || dServer);
 }
 if (target === "src/lib/provider-directory.ts") {
  const dServer = ownerOf(file) === "D" && (file.startsWith("src/lib/") || file.startsWith("src/app/api/"));
  return !clientReachable && (matchCanReadProviderDirectory || dServer);
 }
 const quoteCanReadDemand = (file === "src/lib/quote-engine.ts" || file.startsWith("src/lib/quote-engine/") || file.startsWith("src/app/api/quote/")) && target === "src/lib/demand.ts";
 const serverOnlyDatabase = target === "src/lib/prisma.ts";
 const serverCanReadDatabase = file.startsWith("src/app/api/") || file.startsWith("src/lib/") || file.startsWith("prisma/");
 if (serverOnlyDatabase) return serverCanReadDatabase;
 return ownerOf(file)===ownerOf(target)||shared.test(target)||matchCanReadDemand||quoteCanReadDemand;
}
const imports = new Map();
const clientFiles = new Set();
for(const file of files){
 const ast=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
 const targets = [];
 imports.set(file, targets);
 for (const statement of ast.statements) {
  if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
  if (statement.expression.text === "use client") clientFiles.add(file);
 }
 function check(node){
  let spec;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)) spec=node.moduleSpecifier.text;
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])) spec=node.arguments[0].text;
  if(spec&&(spec.startsWith("@/")||spec.startsWith("."))){
   const raw=spec.startsWith("@/")?"src/"+spec.slice(2):path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
   const target=[raw,raw+".ts",raw+".tsx",raw+"/index.ts",raw+"/index.tsx"].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());
   if(target) targets.push(target);
  }
  ts.forEachChild(node,check);
 }
 check(ast);
}
// A shared helper can be reached through several client imports or re-exports.
// Check reachability before applying server exceptions, not just the file's path.
const pending = [...clientFiles];
while (pending.length) {
 const file = pending.pop();
 for (const target of imports.get(file) ?? []) {
  if (!clientFiles.has(target)) {
   clientFiles.add(target);
   pending.push(target);
  }
 }
}
for (const [file, targets] of imports) {
 for (const target of targets) {
  if (!canReadAcrossOwner(file, target, clientFiles.has(file))) failures.push(file+" -> "+target);
 }
}
if(failures.length){console.error("跨模块业务导入：\n"+failures.join("\n"));process.exit(1);}
console.log("业务模块导入边界检查通过（静态 import/export 和字符串动态 import）。");
