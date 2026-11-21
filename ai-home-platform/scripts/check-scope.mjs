import { execFileSync } from "node:child_process";
import { ownerOf } from "./ownership.mjs";
const args=process.argv.slice(2);
const opt=name=>args[args.indexOf(name)+1];
const ci=args.includes("--ci");
const role=ci ? process.env.GITHUB_HEAD_REF?.match(/^feature\/([ABCD])-/)?.[1] : (args.includes("--role")?opt("--role"):undefined);
const base=ci ? "origin/"+process.env.GITHUB_BASE_REF : (args.includes("--base")?opt("--base"):"origin/main");
if(!role||!["A","B","C","D"].includes(role)) {console.error("用法：npm run scope -- --role A --base origin/main；PR 分支必须为 feature/A-主题 等格式。");process.exit(1);}
function git(...argv) {return execFileSync("git",argv,{encoding:"utf8"}).split("\0").filter(Boolean);}
let paths;
try { paths=new Set([...git("diff","--no-renames","--name-only","-z",base+"...HEAD"),...git("diff","--no-renames","--name-only","-z"),...git("diff","--cached","--no-renames","--name-only","-z"),...git("ls-files","--others","--exclude-standard","-z")]); }
catch { console.error("无法读取基准分支。先 git fetch origin；离线首提可用 --base HEAD。");process.exit(1); }
const foreign=[...paths].filter(p=>ownerOf(p)!==role);
if(foreign.length) {console.error("越界文件（提交变更请求或由负责人修改）：\n"+foreign.map(p=>ownerOf(p)+" "+p).join("\n"));process.exit(1);}
console.log("分工检查通过："+role+"，"+paths.size+" 个变更文件。");
