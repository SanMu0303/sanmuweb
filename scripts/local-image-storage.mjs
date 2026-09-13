// Development-only R2 adapter. Production uses the managed IMAGES bucket.
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
export function localImageStorage(root='.local/objects'){
 const file=key=>{if(!/^posts\/[a-f0-9-]{36}$/.test(key))throw new Error('Invalid object key');return path.resolve(root,key)};
 return {async put(key,bytes){const p=file(key);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,bytes)},async get(key){try{return {body:await readFile(file(key))}}catch(e){if(e.code==='ENOENT')return null;throw e}},async delete(key){try{await unlink(file(key))}catch(e){if(e.code!=='ENOENT')throw e}}};
}
