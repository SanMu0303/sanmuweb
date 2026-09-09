// Dependency-free migration emission; journal follows the Drizzle D1 archive contract.
// This initial migration must never be rewritten after deployment.
import {readFile,mkdir,writeFile,access} from 'node:fs/promises';
import vm from 'node:vm';
await mkdir('drizzle/meta',{recursive:true});
try {await access('drizzle/0000_content.sql');throw new Error('Migration already exists. Append a new migration instead.');} catch(e){if(e.code!=='ENOENT')throw e;}
const source=await readFile('db/schema.ts','utf8');
const schema=vm.runInNewContext(source.replace('export const schema =','globalThis.schema =')+'\nschema');
await writeFile('drizzle/0000_content.sql',schema.join(';\n--> statement-breakpoint\n')+';\n');
await writeFile('drizzle/meta/_journal.json',JSON.stringify({version:'7',dialect:'sqlite',entries:[{idx:0,version:'6',when:1788969600000,tag:'0000_content',breakpoints:true}]},null,2));
