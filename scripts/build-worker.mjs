import {mkdir,readFile,writeFile,cp,rm} from 'node:fs/promises';
import {toArticleDocument} from '../server/post-model.mjs';
await rm('dist',{recursive:true,force:true});
await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
await cp('out','dist/client',{recursive:true});
await cp('server/worker.mjs','dist/server/index.js');
await cp('server/post-model.mjs','dist/server/post-model.mjs');
await writeFile('dist/server/package.json',JSON.stringify({type:'module'}));
await writeFile('dist/server/seed.mjs',`export const seedArticles = ${JSON.stringify(JSON.parse(await readFile('content/posts.json','utf8')).map(toArticleDocument))};\nexport const seedWatchlist = ${await readFile('content/watchlist.json','utf8')};\n`);
await cp('.openai/hosting.json','dist/.openai/hosting.json');
await cp('drizzle','dist/.openai/drizzle',{recursive:true});
console.log('Worker, frontend assets and versioned migrations prepared.');

await cp('server/video-model.mjs','dist/server/video-model.mjs');
await writeFile('dist/server/library.mjs',`export const videos = ${await readFile('content/videos.json','utf8')};\nexport const courses = ${await readFile('content/courses.json','utf8')};`);

for(const file of ['image-storage.mjs','image-model.mjs'])await cp('server/'+file,'dist/server/'+file);
await cp('config/images.mjs','dist/server/image-config.mjs');

await cp('server/content-validation.mjs','dist/server/content-validation.mjs');
