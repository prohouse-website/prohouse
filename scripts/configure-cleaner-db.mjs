// Run after creating a real D1 database. Never insert a placeholder ID into deployment config.
import fs from 'node:fs';
const [id,previewId]=process.argv.slice(2);
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
if(!uuid.test(id||'')||(previewId&&!uuid.test(previewId))){console.error('Usage: node scripts/configure-cleaner-db.mjs <production-D1-id> [isolated-preview-D1-id]');process.exit(1);}
const filename=new URL('../wrangler.jsonc',import.meta.url);
// This repository currently uses plain JSON in its .jsonc config. Do not strip comments with regex.
const config=JSON.parse(fs.readFileSync(filename,'utf8'));
const binding={binding:'CLEANER_DB',database_name:'prohouse-cleaner-agreements',database_id:id,migrations_dir:'migrations',...(previewId?{preview_database_id:previewId}:{})};
config.d1_databases=[...(config.d1_databases||[]).filter(b=>b.binding!=='CLEANER_DB'),binding];
config.vars={...config.vars,PROHOUSE_ADMIN_EMAILS:'hi@prohouse.com.au',CLEANER_FROM_EMAIL:'ProHouse Agreements <reviews@prohouse.com.au>'};
if(previewId){config.previews={...config.previews,d1_databases:[{...binding,database_name:'prohouse-cleaner-agreements-preview',database_id:previewId,preview_database_id:previewId}]};}
fs.writeFileSync(filename,JSON.stringify(config,null,2)+'\n');
console.log('Configured CLEANER_DB. Review wrangler.jsonc, apply migrations to the selected databases, commit and push this branch.');
